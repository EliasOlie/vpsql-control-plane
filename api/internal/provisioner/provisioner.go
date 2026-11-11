package provisioner

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/vpsql/api/internal/config"
	"github.com/vpsql/api/internal/database"
	"github.com/vpsql/api/internal/models"
)

var validNameRegex = regexp.MustCompile(`^[a-z0-9_]{2,60}$`)

type Provisioner struct {
	cfg *config.Config
	db  *database.DBManager
}

func New(cfg *config.Config, db *database.DBManager) *Provisioner {
	return &Provisioner{
		cfg: cfg,
		db:  db,
	}
}

// GenerateStrongPassword produces a cryptographically secure random alphanumeric string
func GenerateStrongPassword(length int) string {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		// fallback to timestamp uuid
		return strings.ReplaceAll(uuid.New().String(), "-", "")
	}
	raw := base64.URLEncoding.EncodeToString(bytes)
	// clean up non-alphanumeric chars for smooth connection string usage
	clean := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return 'x'
	}, raw)
	if len(clean) > length {
		return clean[:length]
	}
	return clean
}

// SanitizeName converts any project name to a valid postgres identifier
func SanitizeName(input string) string {
	lower := strings.ToLower(strings.TrimSpace(input))
	// replace dashes and spaces with underscore
	re := regexp.MustCompile(`[^a-z0-9_]`)
	cleaned := re.ReplaceAllString(lower, "_")
	if len(cleaned) > 50 {
		cleaned = cleaned[:50]
	}
	if len(cleaned) < 2 {
		cleaned = "app_" + cleaned
	}
	return cleaned
}

// Provision implements the full VPSQL SQL transactional engine
func (p *Provisioner) Provision(req models.CreateProjectRequest) (*models.CreateProjectResponse, error) {
	rawName := strings.TrimSpace(req.Name)
	if rawName == "" {
		return nil, fmt.Errorf("project name is required")
	}

	cleanBase := SanitizeName(rawName)
	var dbName string
	if strings.HasPrefix(cleanBase, "app_") {
		dbName = cleanBase
	} else {
		dbName = "app_" + cleanBase
	}

	// Roles format: app_<name>_admin and app_<name>_readonly
	adminRole := fmt.Sprintf("%s_admin", dbName)
	readonlyRole := fmt.Sprintf("%s_readonly", dbName)

	adminPassword := GenerateStrongPassword(24)
	readonlyPassword := GenerateStrongPassword(24)

	projectGroup := strings.TrimSpace(req.Project)
	if projectGroup == "" {
		projectGroup = cleanBase
	}

	adminDB := p.db.AdminDB()

	// 1. Criar os usuários (Roles) com senhas geradas dinamicamente
	// Note: DROP existing roles/db if re-provisioning with clean state or check existence
	createAdminRoleSQL := fmt.Sprintf(
		"CREATE ROLE %s WITH LOGIN PASSWORD %s",
		pq.QuoteIdentifier(adminRole), pq.QuoteLiteral(adminPassword),
	)
	if _, err := adminDB.Exec(createAdminRoleSQL); err != nil {
		// If role already exists, alter password
		alterSQL := fmt.Sprintf("ALTER ROLE %s WITH LOGIN PASSWORD %s", pq.QuoteIdentifier(adminRole), pq.QuoteLiteral(adminPassword))
		if _, alterErr := adminDB.Exec(alterSQL); alterErr != nil {
			return nil, fmt.Errorf("failed to create or alter admin role: %w", err)
		}
	}

	createRoRoleSQL := fmt.Sprintf(
		"CREATE ROLE %s WITH LOGIN PASSWORD %s",
		pq.QuoteIdentifier(readonlyRole), pq.QuoteLiteral(readonlyPassword),
	)
	if _, err := adminDB.Exec(createRoRoleSQL); err != nil {
		alterSQL := fmt.Sprintf("ALTER ROLE %s WITH LOGIN PASSWORD %s", pq.QuoteIdentifier(readonlyRole), pq.QuoteLiteral(readonlyPassword))
		if _, alterErr := adminDB.Exec(alterSQL); alterErr != nil {
			return nil, fmt.Errorf("failed to create or alter readonly role: %w", err)
		}
	}

	// 2. Criar o banco de dados do app
	// Note: In Postgres, CREATE DATABASE cannot run inside a transaction block.
	createDbSQL := fmt.Sprintf("CREATE DATABASE %s", pq.QuoteIdentifier(dbName))
	if _, err := adminDB.Exec(createDbSQL); err != nil {
		// If database already exists, fail or log
		return nil, fmt.Errorf("failed to create database %s: %w", dbName, err)
	}

	// 3. Revogar acessos públicos por segurança
	revokeSQL := fmt.Sprintf("REVOKE ALL PRIVILEGES ON DATABASE %s FROM PUBLIC", pq.QuoteIdentifier(dbName))
	if _, err := adminDB.Exec(revokeSQL); err != nil {
		log.Printf("[WARN] Failed to revoke public privileges on database %s: %v", dbName, err)
	}

	// 4. Dar permissão de dono ao admin e permitir connect ao readonly
	alterOwnerSQL := fmt.Sprintf("ALTER DATABASE %s OWNER TO %s", pq.QuoteIdentifier(dbName), pq.QuoteIdentifier(adminRole))
	if _, err := adminDB.Exec(alterOwnerSQL); err != nil {
		return nil, fmt.Errorf("failed to alter database owner: %w", err)
	}

	grantConnectSQL := fmt.Sprintf("GRANT CONNECT ON DATABASE %s TO %s", pq.QuoteIdentifier(dbName), pq.QuoteIdentifier(readonlyRole))
	if _, err := adminDB.Exec(grantConnectSQL); err != nil {
		return nil, fmt.Errorf("failed to grant connect to readonly role: %w", err)
	}

	// 5. O DETALHE CRÍTICO:
	// Fechar a conexão, conectar-se no novo banco criado (dbName) e aplicar os privilégios nos schemas
	targetDB, err := p.db.ConnectTarget(dbName)
	if err != nil {
		return nil, fmt.Errorf("critical step: failed to connect to newly created database %s: %w", dbName, err)
	}
	defer targetDB.Close()

	schemaQueries := []string{
		fmt.Sprintf("GRANT USAGE ON SCHEMA public TO %s", pq.QuoteIdentifier(readonlyRole)),
		fmt.Sprintf("GRANT SELECT ON ALL TABLES IN SCHEMA public TO %s", pq.QuoteIdentifier(readonlyRole)),
		fmt.Sprintf("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO %s", pq.QuoteIdentifier(readonlyRole)),
	}

	for _, q := range schemaQueries {
		if _, err := targetDB.Exec(q); err != nil {
			log.Printf("[WARN] Failed executing schema grant in %s: %v (query: %s)", dbName, err, q)
		}
	}

	// Enable requested extensions inside the target database
	for _, ext := range req.Extensions {
		extClean := strings.ToLower(strings.TrimSpace(ext))
		if extClean != "" {
			extSQL := fmt.Sprintf("CREATE EXTENSION IF NOT EXISTS %s", pq.QuoteIdentifier(extClean))
			if _, err := targetDB.Exec(extSQL); err != nil {
				log.Printf("[WARN] Failed to enable extension %s in %s: %v", extClean, dbName, err)
			}
		}
	}

	// Save to metadata table
	projectID := uuid.New().String()
	insertSQL := `
	INSERT INTO vpsql_projects (
		id, name, project_group, db_name, admin_role, readonly_role, 
		admin_password, readonly_password, status, extensions, created_at, updated_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
	ON CONFLICT (name) DO UPDATE SET
		project_group = EXCLUDED.project_group,
		admin_password = EXCLUDED.admin_password,
		readonly_password = EXCLUDED.readonly_password,
		updated_at = NOW()
	`
	extensionsArray := pq.Array(req.Extensions)
	if _, err := adminDB.Exec(insertSQL, projectID, rawName, projectGroup, dbName, adminRole, readonlyRole, adminPassword, readonlyPassword, "running", extensionsArray); err != nil {
		log.Printf("[WARN] Failed to record project in metadata: %v", err)
	}

	// Record activity
	p.LogActivity("db.create", dbName, "API", "#4BFF8F")

	// Build connection strings
	publicHost := p.cfg.PublicHost
	if publicHost == "" {
		publicHost = p.cfg.PgBouncerHost
	}

	adminPoolerURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		adminRole, adminPassword, publicHost, p.cfg.PublicPort, dbName)
	readonlyPoolerURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		readonlyRole, readonlyPassword, publicHost, p.cfg.PublicPort, dbName)

	adminURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		adminRole, adminPassword, publicHost, p.cfg.PublicDirectPort, dbName)
	readonlyURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		readonlyRole, readonlyPassword, publicHost, p.cfg.PublicDirectPort, dbName)

	resp := &models.CreateProjectResponse{
		Project: models.Project{
			ID:                projectID,
			Name:              rawName,
			ProjectGroup:      projectGroup,
			DBName:            dbName,
			AdminRole:         adminRole,
			ReadonlyRole:      readonlyRole,
			AdminPassword:     adminPassword,
			ReadonlyPassword:  readonlyPassword,
			Status:            "running",
			Size:              "8.2 MB",
			Connections:       "1/100",
			Owner:             adminRole,
			Extensions:        req.Extensions,
			CreatedAt:         time.Now(),
			CreatedDisplay:    "just now",
			AdminURI:          adminURI,
			ReadonlyURI:       readonlyURI,
			AdminPoolerURI:    adminPoolerURI,
			ReadonlyPoolerURI: readonlyPoolerURI,
		},
		AdminConnectionString:        adminURI,
		ReadonlyConnectionString:     readonlyURI,
		AdminPoolerConnectionString:  adminPoolerURI,
		ReadonlyPoolerConnectionString: readonlyPoolerURI,
	}

	return resp, nil
}

// Drop deletes the database and drops the associated roles
func (p *Provisioner) Drop(identifier string) error {
	adminDB := p.db.AdminDB()

	// Find project in metadata
	var dbName, adminRole, readonlyRole string
	err := adminDB.QueryRow(
		"SELECT db_name, admin_role, readonly_role FROM vpsql_projects WHERE id = $1 OR name = $1 OR db_name = $1",
		identifier,
	).Scan(&dbName, &adminRole, &readonlyRole)

	if err != nil {
		if err == sql.ErrNoRows {
			// Try directly using identifier as dbName
			dbName = identifier
			adminRole = fmt.Sprintf("%s_admin", dbName)
			readonlyRole = fmt.Sprintf("%s_readonly", dbName)
		} else {
			return fmt.Errorf("failed to lookup project: %w", err)
		}
	}

	// 1. Terminate all active connections to the database
	terminateSQL := `
	SELECT pg_terminate_backend(pid) 
	FROM pg_stat_activity 
	WHERE datname = $1 AND pid <> pg_backend_pid()
	`
	_, _ = adminDB.Exec(terminateSQL, dbName)

	// 2. Drop database
	dropDbSQL := fmt.Sprintf("DROP DATABASE IF EXISTS %s", pq.QuoteIdentifier(dbName))
	if _, err := adminDB.Exec(dropDbSQL); err != nil {
		return fmt.Errorf("failed to drop database %s: %w", dbName, err)
	}

	// 3. Drop roles
	if adminRole != "" {
		dropAdminSQL := fmt.Sprintf("DROP ROLE IF EXISTS %s", pq.QuoteIdentifier(adminRole))
		_, _ = adminDB.Exec(dropAdminSQL)
	}
	if readonlyRole != "" {
		dropRoSQL := fmt.Sprintf("DROP ROLE IF EXISTS %s", pq.QuoteIdentifier(readonlyRole))
		_, _ = adminDB.Exec(dropRoSQL)
	}

	// 4. Delete from metadata
	_, _ = adminDB.Exec("DELETE FROM vpsql_projects WHERE id = $1 OR name = $1 OR db_name = $1", identifier)

	// 5. Record activity
	p.LogActivity("db.drop", dbName, "API", "#FF5C5C")

	return nil
}

// Branch clones an existing database into a new tenant branch using PostgreSQL TEMPLATE
func (p *Provisioner) Branch(sourceIdentifier string, req models.BranchProjectRequest) (*models.CreateProjectResponse, error) {
	rawName := strings.TrimSpace(req.Name)
	if rawName == "" {
		return nil, fmt.Errorf("branch name is required")
	}

	adminDB := p.db.AdminDB()

	// 1. Lookup source project
	var sourceDBName, projectGroup string
	var extensions pq.StringArray
	err := adminDB.QueryRow(
		"SELECT db_name, project_group, extensions FROM vpsql_projects WHERE id = $1 OR name = $1 OR db_name = $1",
		sourceIdentifier,
	).Scan(&sourceDBName, &projectGroup, &extensions)

	if err != nil {
		if err == sql.ErrNoRows {
			var exists bool
			_ = adminDB.QueryRow("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)", sourceIdentifier).Scan(&exists)
			if exists {
				sourceDBName = sourceIdentifier
				projectGroup = "atlas"
				extensions = pq.StringArray{"uuid-ossp", "pgcrypto"}
			} else {
				return nil, fmt.Errorf("source database %s not found", sourceIdentifier)
			}
		} else {
			return nil, fmt.Errorf("failed looking up source database: %w", err)
		}
	}

	// 2. Prepare branch names
	cleanBase := SanitizeName(rawName)
	var newDBName string
	if strings.HasPrefix(cleanBase, "app_") {
		newDBName = cleanBase
	} else {
		newDBName = "app_" + cleanBase
	}

	adminRole := fmt.Sprintf("%s_admin", newDBName)
	readonlyRole := fmt.Sprintf("%s_readonly", newDBName)
	adminPassword := GenerateStrongPassword(24)
	readonlyPassword := GenerateStrongPassword(24)

	// 3. Create or alter roles in adminDB
	createAdminRoleSQL := fmt.Sprintf(
		"CREATE ROLE %s WITH LOGIN PASSWORD %s",
		pq.QuoteIdentifier(adminRole), pq.QuoteLiteral(adminPassword),
	)
	if _, err := adminDB.Exec(createAdminRoleSQL); err != nil {
		alterSQL := fmt.Sprintf("ALTER ROLE %s WITH LOGIN PASSWORD %s", pq.QuoteIdentifier(adminRole), pq.QuoteLiteral(adminPassword))
		if _, alterErr := adminDB.Exec(alterSQL); alterErr != nil {
			return nil, fmt.Errorf("failed to create admin role for branch: %w", err)
		}
	}

	createRoRoleSQL := fmt.Sprintf(
		"CREATE ROLE %s WITH LOGIN PASSWORD %s",
		pq.QuoteIdentifier(readonlyRole), pq.QuoteLiteral(readonlyPassword),
	)
	if _, err := adminDB.Exec(createRoRoleSQL); err != nil {
		alterSQL := fmt.Sprintf("ALTER ROLE %s WITH LOGIN PASSWORD %s", pq.QuoteIdentifier(readonlyRole), pq.QuoteLiteral(readonlyPassword))
		if _, alterErr := adminDB.Exec(alterSQL); alterErr != nil {
			return nil, fmt.Errorf("failed to create readonly role for branch: %w", err)
		}
	}

	// 4. Terminate active sessions on source database so PostgreSQL allows template cloning
	terminateSQL := `
	SELECT pg_terminate_backend(pid) 
	FROM pg_stat_activity 
	WHERE datname = $1 AND pid <> pg_backend_pid()
	`
	_, _ = adminDB.Exec(terminateSQL, sourceDBName)

	// 5. Clone database using template
	createBranchSQL := fmt.Sprintf("CREATE DATABASE %s WITH TEMPLATE %s", pq.QuoteIdentifier(newDBName), pq.QuoteIdentifier(sourceDBName))
	if _, err := adminDB.Exec(createBranchSQL); err != nil {
		return nil, fmt.Errorf("failed to clone branch database with template %s: %w", sourceDBName, err)
	}

	// 6. Revoke public privileges & alter owner
	revokeSQL := fmt.Sprintf("REVOKE ALL PRIVILEGES ON DATABASE %s FROM PUBLIC", pq.QuoteIdentifier(newDBName))
	_, _ = adminDB.Exec(revokeSQL)

	alterOwnerSQL := fmt.Sprintf("ALTER DATABASE %s OWNER TO %s", pq.QuoteIdentifier(newDBName), pq.QuoteIdentifier(adminRole))
	if _, err := adminDB.Exec(alterOwnerSQL); err != nil {
		log.Printf("[WARN] Failed to alter branch database owner: %v", err)
	}

	grantConnectSQL := fmt.Sprintf("GRANT CONNECT ON DATABASE %s TO %s", pq.QuoteIdentifier(newDBName), pq.QuoteIdentifier(readonlyRole))
	_, _ = adminDB.Exec(grantConnectSQL)

	// 7. Connect to newly branched database and set permissions
	targetDB, err := p.db.ConnectTarget(newDBName)
	if err == nil {
		defer targetDB.Close()
		branchGrants := []string{
			fmt.Sprintf("GRANT ALL ON SCHEMA public TO %s", pq.QuoteIdentifier(adminRole)),
			fmt.Sprintf("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %s", pq.QuoteIdentifier(adminRole)),
			fmt.Sprintf("GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %s", pq.QuoteIdentifier(adminRole)),
			fmt.Sprintf("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %s", pq.QuoteIdentifier(adminRole)),
			fmt.Sprintf("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %s", pq.QuoteIdentifier(adminRole)),
			fmt.Sprintf("GRANT USAGE ON SCHEMA public TO %s", pq.QuoteIdentifier(readonlyRole)),
			fmt.Sprintf("GRANT SELECT ON ALL TABLES IN SCHEMA public TO %s", pq.QuoteIdentifier(readonlyRole)),
			fmt.Sprintf("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO %s", pq.QuoteIdentifier(readonlyRole)),
		}
		for _, q := range branchGrants {
			_, _ = targetDB.Exec(q)
		}
	}

	// 8. Save metadata
	projectID := uuid.New().String()
	insertSQL := `
	INSERT INTO vpsql_projects (
		id, name, project_group, db_name, admin_role, readonly_role, 
		admin_password, readonly_password, status, extensions, created_at, updated_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
	`
	if _, err := adminDB.Exec(insertSQL, projectID, rawName, projectGroup, newDBName, adminRole, readonlyRole, adminPassword, readonlyPassword, "running", pq.Array(extensions)); err != nil {
		log.Printf("[WARN] Failed to record branched project in metadata: %v", err)
	}

	// 9. Activity audit
	p.LogActivity("db.branch", fmt.Sprintf("%s -> %s", sourceDBName, newDBName), "API", "#5B8CFF")

	// 10. Return response with connection strings
	publicHost := p.cfg.PublicHost
	if publicHost == "" {
		publicHost = p.cfg.PgBouncerHost
	}

	adminPoolerURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		adminRole, adminPassword, publicHost, p.cfg.PublicPort, newDBName)
	readonlyPoolerURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		readonlyRole, readonlyPassword, publicHost, p.cfg.PublicPort, newDBName)

	adminURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		adminRole, adminPassword, publicHost, p.cfg.PublicDirectPort, newDBName)
	readonlyURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		readonlyRole, readonlyPassword, publicHost, p.cfg.PublicDirectPort, newDBName)

	return &models.CreateProjectResponse{
		Project: models.Project{
			ID:                projectID,
			Name:              rawName,
			ProjectGroup:      projectGroup,
			DBName:            newDBName,
			AdminRole:         adminRole,
			ReadonlyRole:      readonlyRole,
			AdminPassword:     adminPassword,
			ReadonlyPassword:  readonlyPassword,
			Status:            "running",
			Size:              "8.2 MB",
			Connections:       "1/100",
			Owner:             adminRole,
			Extensions:        extensions,
			CreatedAt:         time.Now(),
			CreatedDisplay:    "just now",
			AdminURI:          adminURI,
			ReadonlyURI:       readonlyURI,
			AdminPoolerURI:    adminPoolerURI,
			ReadonlyPoolerURI: readonlyPoolerURI,
		},
		AdminConnectionString:        adminURI,
		ReadonlyConnectionString:     readonlyURI,
		AdminPoolerConnectionString:  adminPoolerURI,
		ReadonlyPoolerConnectionString: readonlyPoolerURI,
	}, nil
}

// RotateRole rotates credentials for a project database (admin, readonly, or both)
func (p *Provisioner) RotateRole(identifier string, roleKind string, terminateConnections bool) (*models.RotateRoleResponse, error) {
	adminDB := p.db.AdminDB()

	var (
		id, name, dbName, adminRole, readonlyRole, adminPwd, readonlyPwd string
	)
	query := `SELECT id, name, db_name, admin_role, readonly_role, admin_password, readonly_password FROM vpsql_projects WHERE id = $1 OR name = $1 OR db_name = $1 LIMIT 1`
	err := adminDB.QueryRow(query, identifier).Scan(&id, &name, &dbName, &adminRole, &readonlyRole, &adminPwd, &readonlyPwd)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("project or database '%s' not found", identifier)
		}
		return nil, fmt.Errorf("failed to find project '%s': %w", identifier, err)
	}

	roleKind = strings.ToLower(strings.TrimSpace(roleKind))
	if roleKind == "" {
		roleKind = "all"
	}

	rotatedRoles := make([]string, 0)
	totalTerminated := 0

	rotateAdmin := roleKind == "all" || roleKind == "admin" || roleKind == "owner"
	rotateReadonly := roleKind == "all" || roleKind == "readonly" || roleKind == "read-only"

	if !rotateAdmin && !rotateReadonly {
		return nil, fmt.Errorf("invalid role kind '%s': choose 'admin', 'readonly', or 'all'", roleKind)
	}

	if rotateAdmin {
		newPwd := GenerateStrongPassword(24)
		alterSQL := fmt.Sprintf("ALTER ROLE %s WITH LOGIN PASSWORD %s", pq.QuoteIdentifier(adminRole), pq.QuoteLiteral(newPwd))
		if _, err := adminDB.Exec(alterSQL); err != nil {
			return nil, fmt.Errorf("failed to alter password for admin role %s: %w", adminRole, err)
		}

		if terminateConnections {
			termQuery := `SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()) as t;`
			var termCount int
			_ = adminDB.QueryRow(termQuery, adminRole).Scan(&termCount)
			totalTerminated += termCount
		}

		updateSQL := `UPDATE vpsql_projects SET admin_password = $1, admin_rotated_at = NOW(), updated_at = NOW() WHERE id = $2`
		if _, err := adminDB.Exec(updateSQL, newPwd, id); err != nil {
			log.Printf("[WARN] Failed to update admin_password metadata for %s: %v", dbName, err)
		}
		adminPwd = newPwd
		rotatedRoles = append(rotatedRoles, adminRole)
	}

	if rotateReadonly {
		newPwd := GenerateStrongPassword(24)
		alterSQL := fmt.Sprintf("ALTER ROLE %s WITH LOGIN PASSWORD %s", pq.QuoteIdentifier(readonlyRole), pq.QuoteLiteral(newPwd))
		if _, err := adminDB.Exec(alterSQL); err != nil {
			return nil, fmt.Errorf("failed to alter password for readonly role %s: %w", readonlyRole, err)
		}

		if terminateConnections {
			termQuery := `SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()) as t;`
			var termCount int
			_ = adminDB.QueryRow(termQuery, readonlyRole).Scan(&termCount)
			totalTerminated += termCount
		}

		updateSQL := `UPDATE vpsql_projects SET readonly_password = $1, readonly_rotated_at = NOW(), updated_at = NOW() WHERE id = $2`
		if _, err := adminDB.Exec(updateSQL, newPwd, id); err != nil {
			log.Printf("[WARN] Failed to update readonly_password metadata for %s: %v", dbName, err)
		}
		readonlyPwd = newPwd
		rotatedRoles = append(rotatedRoles, readonlyRole)
	}

	// Audit activity
	p.LogActivity("role.rotate", fmt.Sprintf("%s (%s)", dbName, strings.Join(rotatedRoles, ", ")), "API", "#FFB020")

	publicHost := p.cfg.PublicHost
	if publicHost == "" {
		publicHost = p.cfg.PgBouncerHost
	}

	adminPoolerURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		adminRole, adminPwd, publicHost, p.cfg.PublicPort, dbName)
	readonlyPoolerURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		readonlyRole, readonlyPwd, publicHost, p.cfg.PublicPort, dbName)

	adminURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		adminRole, adminPwd, publicHost, p.cfg.PublicDirectPort, dbName)
	readonlyURI := fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		readonlyRole, readonlyPwd, publicHost, p.cfg.PublicDirectPort, dbName)

	return &models.RotateRoleResponse{
		DBName:                         dbName,
		RotatedRoles:                   rotatedRoles,
		AdminPassword:                  adminPwd,
		ReadonlyPassword:               readonlyPwd,
		AdminConnectionString:          adminURI,
		ReadonlyConnectionString:       readonlyURI,
		AdminPoolerConnectionString:    adminPoolerURI,
		ReadonlyPoolerConnectionString: readonlyPoolerURI,
		TerminatedSessions:             totalTerminated,
		RotatedAt:                      time.Now().Format(time.RFC3339),
	}, nil
}

// RotateRoleByName rotates a role by its direct PostgreSQL username
func (p *Provisioner) RotateRoleByName(roleName string, terminateConnections bool) (*models.RotateRoleResponse, error) {
	adminDB := p.db.AdminDB()

	// Check if this role belongs to a managed vpsql_project
	var (
		id, adminRole, readonlyRole string
	)
	err := adminDB.QueryRow("SELECT id, admin_role, readonly_role FROM vpsql_projects WHERE admin_role = $1 OR readonly_role = $1 LIMIT 1", roleName).Scan(&id, &adminRole, &readonlyRole)
	if err == nil {
		roleKind := "admin"
		if roleName == readonlyRole {
			roleKind = "readonly"
		}
		return p.RotateRole(id, roleKind, terminateConnections)
	}

	// Otherwise, it could be a standalone role created directly on Postgres
	var exists bool
	_ = adminDB.QueryRow("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1)", roleName).Scan(&exists)
	if !exists {
		return nil, fmt.Errorf("role '%s' not found on cluster", roleName)
	}

	newPwd := GenerateStrongPassword(24)
	alterSQL := fmt.Sprintf("ALTER ROLE %s WITH LOGIN PASSWORD %s", pq.QuoteIdentifier(roleName), pq.QuoteLiteral(newPwd))
	if _, err := adminDB.Exec(alterSQL); err != nil {
		return nil, fmt.Errorf("failed to alter password for standalone role %s: %w", roleName, err)
	}

	totalTerminated := 0
	if terminateConnections {
		termQuery := `SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()) as t;`
		_ = adminDB.QueryRow(termQuery, roleName).Scan(&totalTerminated)
	}

	p.LogActivity("role.rotate", roleName, "API", "#FFB020")

	return &models.RotateRoleResponse{
		DBName:             "cluster",
		RotatedRoles:       []string{roleName},
		AdminPassword:      newPwd,
		TerminatedSessions: totalTerminated,
		RotatedAt:          time.Now().Format(time.RFC3339),
	}, nil
}

// LogActivity writes an audit entry
func (p *Provisioner) LogActivity(action, target, via, color string) {
	adminDB := p.db.AdminDB()
	_, _ = adminDB.Exec(
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		action, target, via, color,
	)
}
