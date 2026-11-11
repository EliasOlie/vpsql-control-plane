package backupmanager

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/vpsql/api/internal/config"
	"github.com/vpsql/api/internal/database"
	"github.com/vpsql/api/internal/models"
)

type BackupManager struct {
	cfg        *config.Config
	db         *database.DBManager
	s3         *S3Uploader
	mu         sync.Mutex
	isCreating bool
}

func New(cfg *config.Config, db *database.DBManager) *BackupManager {
	backupDir := cfg.BackupDir
	if backupDir == "" {
		backupDir = "/data/backups"
	}
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		log.Printf("[VPSQL Backup] Warning: unable to create backup directory %s: %v", backupDir, err)
	}

	mgr := &BackupManager{
		cfg: cfg,
		db:  db,
		s3:  NewS3Uploader(cfg),
	}

	// Run initial retention check on startup
	if purged, err := mgr.EnforceRetention(); err == nil && purged > 0 {
		log.Printf("[VPSQL Backup] Startup retention: purged %d expired backups (older than %d days)", purged, cfg.BackupRetentionDays)
	}

	return mgr
}

// StartScheduler launches the daily background backup task and periodic retention purge
func (m *BackupManager) StartScheduler(ctx context.Context) {
	go func() {
		log.Printf("[VPSQL Backup] Automated daily scheduler started (Schedule: %02d:00, Retention: %d days)",
			m.cfg.BackupScheduleHour, m.cfg.BackupRetentionDays)

		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("[VPSQL Backup] Scheduler stopped.")
				return
			case now := <-ticker.C:
				// Always enforce retention periodically
				_, _ = m.EnforceRetention()

				// Check if current hour matches scheduled backup hour
				if now.Hour() == m.cfg.BackupScheduleHour {
					// Check if a backup was already created in the last 20 hours to prevent duplicate runs
					recent, err := m.hasRecentBackup(20 * time.Hour)
					if err != nil {
						log.Printf("[VPSQL Backup] Error checking recent backups: %v", err)
						continue
					}
					if !recent {
						log.Printf("[VPSQL Backup] Triggering automated daily backup (Target hour: %02d:00)...", m.cfg.BackupScheduleHour)
						item, err := m.CreateBackup(context.Background(), "all", "scheduler", "Backup diário automatizado")
						if err != nil {
							log.Printf("[VPSQL Backup] ERROR during automated daily backup: %v", err)
						} else {
							log.Printf("[VPSQL Backup] SUCCESS: Automated backup '%s' completed (%s)", item.Filename, item.SizeFormatted)
						}
					}
				}
			}
		}
	}()
}

func (m *BackupManager) hasRecentBackup(maxAge time.Duration) (bool, error) {
	backups, err := m.ListBackups()
	if err != nil {
		return false, err
	}
	if len(backups) == 0 {
		return false, nil
	}
	// ListBackups is sorted descending by CreatedAt
	newest := backups[0]
	return time.Since(newest.CreatedAt) < maxAge, nil
}

// CreateBackup generates a gzip-compressed SQL dump of the PostgreSQL cluster or single database
func (m *BackupManager) CreateBackup(ctx context.Context, scope, trigger, notes string) (*models.BackupItem, error) {
	m.mu.Lock()
	if m.isCreating {
		m.mu.Unlock()
		return nil, fmt.Errorf("outro backup já está em andamento. Aguarde a conclusão")
	}
	m.isCreating = true
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		m.isCreating = false
		m.mu.Unlock()
	}()

	cleanScope := strings.TrimSpace(scope)
	if cleanScope == "" {
		cleanScope = "all"
	}
	cleanTrigger := strings.TrimSpace(trigger)
	if cleanTrigger == "" {
		cleanTrigger = "manual"
	}

	backupDir := m.cfg.BackupDir
	if backupDir == "" {
		backupDir = "/data/backups"
	}
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		return nil, fmt.Errorf("falha ao criar diretório de backups: %w", err)
	}

	timestamp := time.Now().Format("2006-01-02_150405")
	filename := fmt.Sprintf("vpsql_backup_%s_%s.sql.gz", cleanScope, timestamp)
	targetFilePath := filepath.Join(backupDir, filename)

	// Create output file
	outFile, err := os.Create(targetFilePath)
	if err != nil {
		return nil, fmt.Errorf("falha ao criar arquivo de backup: %w", err)
	}

	gzipWriter := gzip.NewWriter(outFile)

	var cmd *exec.Cmd
	var stderrBuf bytes.Buffer

	// Choose pg_dumpall for cluster-wide or pg_dump for specific database
	if cleanScope == "all" {
		cmd = exec.CommandContext(ctx, "pg_dumpall",
			"-h", m.cfg.PostgresHost,
			"-p", strconv.Itoa(m.cfg.PostgresPort),
			"-U", m.cfg.PostgresUser,
			"--clean",
			"--if-exists",
		)
	} else {
		cmd = exec.CommandContext(ctx, "pg_dump",
			"-h", m.cfg.PostgresHost,
			"-p", strconv.Itoa(m.cfg.PostgresPort),
			"-U", m.cfg.PostgresUser,
			"-d", cleanScope,
			"--clean",
			"--if-exists",
		)
	}

	cmd.Env = append(os.Environ(), "PGPASSWORD="+m.cfg.PostgresPassword)
	cmd.Stdout = gzipWriter
	cmd.Stderr = &stderrBuf

	cmdErr := cmd.Run()
	_ = gzipWriter.Close()
	_ = outFile.Close()

	if cmdErr != nil {
		// Clean up failed partial file
		_ = os.Remove(targetFilePath)
		errMsg := strings.TrimSpace(stderrBuf.String())
		if errMsg == "" {
			errMsg = cmdErr.Error()
		}
		return nil, fmt.Errorf("falha ao executar comando de dump do PostgreSQL: %s", errMsg)
	}

	// Inspect generated file
	stat, err := os.Stat(targetFilePath)
	if err != nil {
		return nil, fmt.Errorf("falha ao obter estatísticas do arquivo gerado: %w", err)
	}

	remoteStatus := "disabled"
	if m.s3.IsEnabled() {
		// Upload to Cloudflare R2 / AWS S3
		if uploadErr := m.s3.Upload(ctx, targetFilePath, filename); uploadErr != nil {
			log.Printf("[VPSQL Backup] Warning: S3 sync failed for %s: %v", filename, uploadErr)
			remoteStatus = "failed"
		} else {
			log.Printf("[VPSQL Backup] Successfully synced %s to Cloudflare R2 / S3", filename)
			remoteStatus = "synced"
		}
	} else {
		remoteStatus = "local_only"
	}

	// Enforce 7-day retention immediately
	_, _ = m.EnforceRetention()

	createdAt := stat.ModTime()
	ageDays := time.Since(createdAt).Hours() / 24.0
	expiresIn := m.cfg.BackupRetentionDays - int(ageDays)
	if expiresIn < 0 {
		expiresIn = 0
	}

	return &models.BackupItem{
		Filename:         filename,
		Scope:            cleanScope,
		SizeBytes:        stat.Size(),
		SizeFormatted:    formatBytes(stat.Size()),
		CreatedAt:        createdAt,
		CreatedAtDisplay: createdAt.Format("2006-01-02 15:04:05"),
		AgeDays:          ageDays,
		ExpiresInDays:    expiresIn,
		Trigger:          cleanTrigger,
		Status:           "completed",
		RemoteStatus:     remoteStatus,
		Notes:            notes,
	}, nil
}

// ListBackups returns all available backups sorted by newest first
func (m *BackupManager) ListBackups() ([]*models.BackupItem, error) {
	backupDir := m.cfg.BackupDir
	if backupDir == "" {
		backupDir = "/data/backups"
	}

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []*models.BackupItem{}, nil
		}
		return nil, fmt.Errorf("erro ao ler diretório de backups: %w", err)
	}

	var items []*models.BackupItem
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, "vpsql_backup_") || !strings.HasSuffix(name, ".sql.gz") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		scope := "all"
		parts := strings.Split(name, "_")
		if len(parts) >= 3 {
			scope = parts[2]
		}

		createdAt := info.ModTime()
		ageDays := time.Since(createdAt).Hours() / 24.0
		expiresIn := m.cfg.BackupRetentionDays - int(ageDays)
		if expiresIn < 0 {
			expiresIn = 0
		}

		trigger := "scheduler"
		if strings.Contains(name, "manual") {
			trigger = "manual"
		}

		remoteStatus := "local_only"
		if m.s3.IsEnabled() {
			remoteStatus = "synced"
		}

		items = append(items, &models.BackupItem{
			Filename:         name,
			Scope:            scope,
			SizeBytes:        info.Size(),
			SizeFormatted:    formatBytes(info.Size()),
			CreatedAt:        createdAt,
			CreatedAtDisplay: createdAt.Format("2006-01-02 15:04:05"),
			AgeDays:          ageDays,
			ExpiresInDays:    expiresIn,
			Trigger:          trigger,
			Status:           "completed",
			RemoteStatus:     remoteStatus,
		})
	}

	// Sort newest first
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})

	return items, nil
}

// DeleteBackup permanently removes a backup file
func (m *BackupManager) DeleteBackup(filename string) error {
	cleanName := filepath.Base(filepath.Clean(filename))
	if !strings.HasPrefix(cleanName, "vpsql_backup_") || !strings.HasSuffix(cleanName, ".sql.gz") {
		return fmt.Errorf("nome de arquivo de backup inválido")
	}

	backupDir := m.cfg.BackupDir
	if backupDir == "" {
		backupDir = "/data/backups"
	}
	targetPath := filepath.Join(backupDir, cleanName)

	if _, err := os.Stat(targetPath); err != nil {
		return fmt.Errorf("arquivo de backup não encontrado: %w", err)
	}

	if err := os.Remove(targetPath); err != nil {
		return fmt.Errorf("falha ao remover backup: %w", err)
	}

	return nil
}

// GetBackupFilePath validates and returns the absolute local path for downloading
func (m *BackupManager) GetBackupFilePath(filename string) (string, error) {
	cleanName := filepath.Base(filepath.Clean(filename))
	if !strings.HasPrefix(cleanName, "vpsql_backup_") || !strings.HasSuffix(cleanName, ".sql.gz") {
		return "", fmt.Errorf("nome de arquivo de backup inválido")
	}

	backupDir := m.cfg.BackupDir
	if backupDir == "" {
		backupDir = "/data/backups"
	}
	targetPath := filepath.Join(backupDir, cleanName)

	if _, err := os.Stat(targetPath); err != nil {
		return "", fmt.Errorf("arquivo de backup não encontrado")
	}

	return targetPath, nil
}

// EnforceRetention deletes backups older than BackupRetentionDays (default 7 days)
func (m *BackupManager) EnforceRetention() (int, error) {
	backupDir := m.cfg.BackupDir
	if backupDir == "" {
		backupDir = "/data/backups"
	}

	retentionDays := m.cfg.BackupRetentionDays
	if retentionDays <= 0 {
		retentionDays = 7
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour)

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return 0, err
	}

	purgedCount := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, "vpsql_backup_") || !strings.HasSuffix(name, ".sql.gz") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		if info.ModTime().Before(cutoff) {
			path := filepath.Join(backupDir, name)
			if err := os.Remove(path); err == nil {
				purgedCount++
				log.Printf("[VPSQL Backup] Purged expired backup: %s (created %s, older than %d days)",
					name, info.ModTime().Format("2006-01-02"), retentionDays)
			}
		}
	}

	return purgedCount, nil
}

// GetConfig returns the current backup configuration and metrics summary
func (m *BackupManager) GetConfig() (*models.BackupConfigResponse, error) {
	items, err := m.ListBackups()
	if err != nil {
		return nil, err
	}

	var totalBytes int64
	for _, item := range items {
		totalBytes += item.SizeBytes
	}

	retentionDays := m.cfg.BackupRetentionDays
	if retentionDays <= 0 {
		retentionDays = 7
	}

	schedHour := m.cfg.BackupScheduleHour
	scheduleDisplay := fmt.Sprintf("Diariamente às %02d:00", schedHour)

	return &models.BackupConfigResponse{
		BackupDir:          m.cfg.BackupDir,
		RetentionDays:      retentionDays,
		ScheduleHour:       schedHour,
		ScheduleDisplay:    scheduleDisplay,
		TotalBackups:       len(items),
		TotalSizeBytes:     totalBytes,
		TotalSizeFormatted: formatBytes(totalBytes),
		S3Config:           m.s3.GetInfo(),
	}, nil
}

func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
