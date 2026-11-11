package storagemanager

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/vpsql/api/internal/config"
	"github.com/vpsql/api/internal/database"
	"github.com/vpsql/api/internal/models"
)

var validBucketNameRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

// S3 XML structures for AWS S3 compatibility
type S3Owner struct {
	ID          string `xml:"ID"`
	DisplayName string `xml:"DisplayName"`
}

type S3BucketItem struct {
	Name         string `xml:"Name"`
	CreationDate string `xml:"CreationDate"`
}

type ListAllMyBucketsResult struct {
	XMLName xml.Name       `xml:"http://s3.amazonaws.com/doc/2006-03-01/ ListAllMyBucketsResult"`
	Owner   S3Owner        `xml:"Owner"`
	Buckets []S3BucketItem `xml:"Buckets>Bucket"`
}

type S3ObjectContent struct {
	Key          string `xml:"Key"`
	LastModified string `xml:"LastModified"`
	ETag         string `xml:"ETag"`
	Size         int64  `xml:"Size"`
	StorageClass string `xml:"StorageClass"`
}

type S3CommonPrefix struct {
	Prefix string `xml:"Prefix"`
}

type ListBucketResult struct {
	XMLName        xml.Name          `xml:"http://s3.amazonaws.com/doc/2006-03-01/ ListBucketResult"`
	Name           string            `xml:"Name"`
	Prefix         string            `xml:"Prefix"`
	Marker         string            `xml:"Marker,omitempty"`
	NextMarker     string            `xml:"NextMarker,omitempty"`
	MaxKeys        int               `xml:"MaxKeys"`
	Delimiter      string            `xml:"Delimiter,omitempty"`
	IsTruncated    bool              `xml:"IsTruncated"`
	Contents       []S3ObjectContent `xml:"Contents"`
	CommonPrefixes []S3CommonPrefix  `xml:"CommonPrefixes,omitempty"`
}

type S3Error struct {
	XMLName   xml.Name `xml:"Error"`
	Code      string   `xml:"Code"`
	Message   string   `xml:"Message"`
	Resource  string   `xml:"Resource,omitempty"`
	RequestId string   `xml:"RequestId"`
}

type StorageManager struct {
	cfg *config.Config
	db  *database.DBManager
}

func New(cfg *config.Config, db *database.DBManager) *StorageManager {
	// Ensure root storage directory exists on the persistent volume
	dir := cfg.StorageDir
	if dir == "" {
		dir = "/data/storage"
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Printf("[WARN] Failed to create storage dir %s: %v\n", dir, err)
	}

	return &StorageManager{
		cfg: cfg,
		db:  db,
	}
}

// GenerateAccessKeys produces S3 compliant AccessKeyID (20 chars) and SecretAccessKey (40 chars)
func GenerateAccessKeys() (string, string) {
	akBytes := make([]byte, 10)
	skBytes := make([]byte, 20)
	_, _ = rand.Read(akBytes)
	_, _ = rand.Read(skBytes)

	ak := fmt.Sprintf("vpsql_ak_%s", hex.EncodeToString(akBytes))
	sk := fmt.Sprintf("vpsql_sk_%s", hex.EncodeToString(skBytes))
	return ak, sk
}

// FormatBytes formats byte counts into human-readable strings
func FormatBytes(b int64) string {
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

// SanitizeBucketName ensures the bucket identifier follows S3 naming conventions
func SanitizeBucketName(name string) string {
	cleaned := strings.ToLower(strings.TrimSpace(name))
	re := regexp.MustCompile(`[^a-z0-9.-]`)
	cleaned = re.ReplaceAllString(cleaned, "-")
	reDashes := regexp.MustCompile(`-+`)
	cleaned = reDashes.ReplaceAllString(cleaned, "-")
	cleaned = strings.Trim(cleaned, ".-")
	if len(cleaned) < 3 {
		cleaned = "app-" + cleaned
	}
	if len(cleaned) > 63 {
		cleaned = cleaned[:63]
	}
	return cleaned
}

// Create provisions a new S3 bucket with isolated folder and credentials
func (m *StorageManager) Create(ctx context.Context, req models.CreateBucketRequest) (*models.CreateBucketResponse, error) {
	rawName := strings.TrimSpace(req.Name)
	if rawName == "" {
		return nil, fmt.Errorf("bucket name is required")
	}

	bucketName := SanitizeBucketName(rawName)

	projectGroup := strings.TrimSpace(req.ProjectGroup)
	if projectGroup == "" {
		projectGroup = bucketName
	}

	isPublic := true
	if req.IsPublic != nil {
		isPublic = *req.IsPublic
	}

	ak, sk := GenerateAccessKeys()
	id := uuid.New().String()

	// Create bucket directory inside persistent storage volume
	bucketPath := filepath.Join(m.cfg.StorageDir, bucketName)
	if err := os.MkdirAll(bucketPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create bucket directory on volume: %w", err)
	}

	adminDB := m.db.AdminDB()
	query := `
		INSERT INTO vpsql_buckets (id, name, project_group, access_key, secret_key, is_public, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW())
	`
	if _, err := adminDB.ExecContext(ctx, query, id, bucketName, projectGroup, ak, sk, isPublic); err != nil {
		return nil, fmt.Errorf("failed to insert bucket metadata: %w", err)
	}

	// Record activity
	_, _ = adminDB.ExecContext(ctx,
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"storage.bucket.create", bucketName, "API", "#00E5FF",
	)

	bucket := models.StorageBucket{
		ID:             id,
		Name:           bucketName,
		ProjectGroup:   projectGroup,
		AccessKey:      ak,
		SecretKey:      sk,
		IsPublic:       isPublic,
		Status:         "active",
		SizeBytes:      0,
		SizeFormatted:  "0 B",
		ObjectCount:    0,
		CreatedAt:      time.Now(),
		CreatedDisplay: "just now",
	}
	m.populateBucketInfo(&bucket)

	return &models.CreateBucketResponse{
		Bucket:          bucket,
		Endpoint:        bucket.Endpoint,
		AccessKeyID:     ak,
		SecretAccessKey: sk,
		PublicURL:       bucket.PublicURLBase,
		EnvSnippet:      bucket.EnvSnippet,
	}, nil
}

func (m *StorageManager) populateBucketInfo(b *models.StorageBucket) {
	endpoint := m.cfg.StoragePublicBase
	if endpoint == "" {
		host := m.cfg.PublicHost
		if host == "" {
			host = "localhost"
		}
		endpoint = fmt.Sprintf("http://%s:%d", host, m.cfg.Port)
	}
	endpoint = strings.TrimRight(endpoint, "/")

	b.Endpoint = fmt.Sprintf("%s/s3", endpoint)
	b.S3URI = fmt.Sprintf("s3://%s", b.Name)
	b.PublicURLBase = fmt.Sprintf("%s/s3/%s/", endpoint, b.Name)
	b.CreatedDisplay = b.CreatedAt.Format("02 Jan 15:04")
	b.SizeFormatted = FormatBytes(b.SizeBytes)

	b.EnvSnippet = fmt.Sprintf(`AWS_ACCESS_KEY_ID=%s
AWS_SECRET_ACCESS_KEY=%s
AWS_ENDPOINT_URL_S3=%s/s3
AWS_REGION=auto
AWS_BUCKET=%s`, b.AccessKey, b.SecretKey, endpoint, b.Name)
}

// RotateCredentials generates a new secret_key for a storage bucket and updates metadata
func (m *StorageManager) RotateCredentials(ctx context.Context, idOrName string) (*models.CreateBucketResponse, error) {
	adminDB := m.db.AdminDB()
	var (
		id, name, projectGroup, accessKey, oldSecretKey string
		isPublic                                        bool
		status                                          string
		createdAt                                       time.Time
		sizeBytes, objectCount                          int64
	)

	query := `
		SELECT b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at,
		       COALESCE(SUM(o.size_bytes), 0) as size_bytes,
		       COALESCE(COUNT(o.id), 0) as object_count
		FROM vpsql_buckets b
		LEFT JOIN vpsql_objects o ON o.bucket_name = b.name
		WHERE b.id = $1 OR b.name = $1
		GROUP BY b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at
		LIMIT 1
	`
	err := adminDB.QueryRowContext(ctx, query, idOrName).Scan(
		&id, &name, &projectGroup, &accessKey, &oldSecretKey, &isPublic, &status, &createdAt,
		&sizeBytes, &objectCount,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("storage bucket '%s' not found", idOrName)
		}
		return nil, fmt.Errorf("failed to query bucket '%s': %w", idOrName, err)
	}

	_, newSK := GenerateAccessKeys()

	_, err = adminDB.ExecContext(ctx,
		"UPDATE vpsql_buckets SET secret_key = $1, rotated_at = NOW(), updated_at = NOW() WHERE id = $2",
		newSK, id,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update bucket secret key: %w", err)
	}

	_, _ = adminDB.ExecContext(ctx,
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"storage.rotate", name, "API", "#FFB020",
	)

	bucket := models.StorageBucket{
		ID:             id,
		Name:           name,
		ProjectGroup:   projectGroup,
		AccessKey:      accessKey,
		SecretKey:      newSK,
		IsPublic:       isPublic,
		Status:         status,
		SizeBytes:      sizeBytes,
		ObjectCount:    objectCount,
		CreatedAt:      createdAt,
		CreatedDisplay: createdAt.Format("02 Jan 15:04"),
	}
	m.populateBucketInfo(&bucket)

	return &models.CreateBucketResponse{
		Bucket:          bucket,
		Endpoint:        bucket.Endpoint,
		AccessKeyID:     accessKey,
		SecretAccessKey: newSK,
		PublicURL:       bucket.PublicURLBase,
		EnvSnippet:      bucket.EnvSnippet,
	}, nil
}

// List returns all provisioned buckets, optionally filtered by projectGroup
func (m *StorageManager) List(ctx context.Context, projectGroup string) ([]models.StorageBucket, error) {
	adminDB := m.db.AdminDB()

	var rows *sql.Rows
	var err error

	if projectGroup != "" {
		rows, err = adminDB.QueryContext(ctx, `
			SELECT b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at,
			       COALESCE(SUM(o.size_bytes), 0) as size_bytes,
			       COALESCE(COUNT(o.id), 0) as object_count
			FROM vpsql_buckets b
			LEFT JOIN vpsql_objects o ON b.name = o.bucket_name
			WHERE b.project_group = $1
			GROUP BY b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at
			ORDER BY b.created_at DESC
		`, projectGroup)
	} else {
		rows, err = adminDB.QueryContext(ctx, `
			SELECT b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at,
			       COALESCE(SUM(o.size_bytes), 0) as size_bytes,
			       COALESCE(COUNT(o.id), 0) as object_count
			FROM vpsql_buckets b
			LEFT JOIN vpsql_objects o ON b.name = o.bucket_name
			GROUP BY b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at
			ORDER BY b.created_at DESC
		`)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.StorageBucket
	for rows.Next() {
		var b models.StorageBucket
		if err := rows.Scan(&b.ID, &b.Name, &b.ProjectGroup, &b.AccessKey, &b.SecretKey, &b.IsPublic, &b.Status, &b.CreatedAt, &b.SizeBytes, &b.ObjectCount); err != nil {
			continue
		}
		m.populateBucketInfo(&b)
		list = append(list, b)
	}

	if list == nil {
		list = []models.StorageBucket{}
	}
	return list, nil
}

// Get returns details for a bucket by ID or Name
func (m *StorageManager) Get(ctx context.Context, idOrName string) (*models.StorageBucket, error) {
	adminDB := m.db.AdminDB()
	var b models.StorageBucket
	query := `
		SELECT b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at,
		       COALESCE(SUM(o.size_bytes), 0) as size_bytes,
		       COALESCE(COUNT(o.id), 0) as object_count
		FROM vpsql_buckets b
		LEFT JOIN vpsql_objects o ON b.name = o.bucket_name
		WHERE b.id = $1 OR b.name = $1
		GROUP BY b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at
	`
	err := adminDB.QueryRowContext(ctx, query, idOrName).Scan(
		&b.ID, &b.Name, &b.ProjectGroup, &b.AccessKey, &b.SecretKey, &b.IsPublic, &b.Status, &b.CreatedAt, &b.SizeBytes, &b.ObjectCount,
	)
	if err != nil {
		return nil, fmt.Errorf("bucket '%s' not found: %w", idOrName, err)
	}

	m.populateBucketInfo(&b)
	return &b, nil
}

// GetBucketByAccessKey finds bucket associated with a given S3 access key
func (m *StorageManager) GetBucketByAccessKey(ctx context.Context, accessKey string) (*models.StorageBucket, error) {
	adminDB := m.db.AdminDB()
	var b models.StorageBucket
	query := `
		SELECT b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at,
		       COALESCE(SUM(o.size_bytes), 0) as size_bytes,
		       COALESCE(COUNT(o.id), 0) as object_count
		FROM vpsql_buckets b
		LEFT JOIN vpsql_objects o ON b.name = o.bucket_name
		WHERE b.access_key = $1
		GROUP BY b.id, b.name, b.project_group, b.access_key, b.secret_key, b.is_public, b.status, b.created_at
	`
	err := adminDB.QueryRowContext(ctx, query, accessKey).Scan(
		&b.ID, &b.Name, &b.ProjectGroup, &b.AccessKey, &b.SecretKey, &b.IsPublic, &b.Status, &b.CreatedAt, &b.SizeBytes, &b.ObjectCount,
	)
	if err != nil {
		return nil, fmt.Errorf("invalid access key: %w", err)
	}

	m.populateBucketInfo(&b)
	return &b, nil
}

// Update modifies bucket settings (project group or public visibility)
func (m *StorageManager) Update(ctx context.Context, idOrName string, req models.UpdateBucketRequest) (*models.StorageBucket, error) {
	bucket, err := m.Get(ctx, idOrName)
	if err != nil {
		return nil, err
	}

	adminDB := m.db.AdminDB()

	if req.ProjectGroup != nil && *req.ProjectGroup != "" {
		bucket.ProjectGroup = *req.ProjectGroup
	}
	if req.IsPublic != nil {
		bucket.IsPublic = *req.IsPublic
	}

	query := `
		UPDATE vpsql_buckets
		SET project_group = $1, is_public = $2, updated_at = NOW()
		WHERE id = $3
	`
	if _, err := adminDB.ExecContext(ctx, query, bucket.ProjectGroup, bucket.IsPublic, bucket.ID); err != nil {
		return nil, fmt.Errorf("failed to update bucket: %w", err)
	}

	m.populateBucketInfo(bucket)
	return bucket, nil
}

// Delete drops the bucket, all metadata, and clears files from volume
func (m *StorageManager) Delete(ctx context.Context, idOrName string) error {
	bucket, err := m.Get(ctx, idOrName)
	if err != nil {
		return err
	}

	// 1. Remove bucket files from volume
	bucketDir := filepath.Join(m.cfg.StorageDir, bucket.Name)
	_ = os.RemoveAll(bucketDir)

	// 2. Remove from database
	adminDB := m.db.AdminDB()
	_, err = adminDB.ExecContext(ctx, "DELETE FROM vpsql_buckets WHERE id = $1", bucket.ID)
	if err != nil {
		return fmt.Errorf("failed to delete bucket metadata: %w", err)
	}

	// 3. Log activity
	_, _ = adminDB.ExecContext(ctx,
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"storage.bucket.delete", bucket.Name, "API", "#FF5C5C",
	)

	return nil
}

// SafeKeyPath resolves and prevents path traversal outside the bucket directory
func (m *StorageManager) safeKeyPath(bucketName, key string) (string, error) {
	cleanKey := filepath.Clean(strings.TrimPrefix(key, "/"))
	if strings.HasPrefix(cleanKey, "..") || strings.Contains(cleanKey, "../") {
		return "", fmt.Errorf("invalid object key: path traversal detected")
	}

	bucketDir := filepath.Join(m.cfg.StorageDir, bucketName)
	fullPath := filepath.Join(bucketDir, cleanKey)

	// Ensure fullPath is inside bucketDir
	rel, err := filepath.Rel(bucketDir, fullPath)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("invalid path: resolved path is outside bucket boundary")
	}

	return fullPath, nil
}

// PutObject stores a file into disk volume and updates metadata table
func (m *StorageManager) PutObject(ctx context.Context, bucketName, key string, body io.Reader, size int64, contentType string) (*models.StorageObject, error) {
	bucket, err := m.Get(ctx, bucketName)
	if err != nil {
		return nil, err
	}

	fullPath, err := m.safeKeyPath(bucket.Name, key)
	if err != nil {
		return nil, err
	}

	// Ensure parent directory exists
	parentDir := filepath.Dir(fullPath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory structure on volume: %w", err)
	}

	// Create file on volume
	f, err := os.Create(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create file on volume: %w", err)
	}
	defer f.Close()

	// Hash MD5 while writing (S3 ETag standard)
	hasher := md5.New()
	writer := io.MultiWriter(f, hasher)

	written, err := io.Copy(writer, body)
	if err != nil {
		_ = os.Remove(fullPath)
		return nil, fmt.Errorf("failed to write object data: %w", err)
	}

	etag := fmt.Sprintf("\"%s\"", hex.EncodeToString(hasher.Sum(nil)))

	// Infer content-type if not specified
	if contentType == "" || contentType == "application/octet-stream" {
		ext := filepath.Ext(key)
		if detected := mime.TypeByExtension(ext); detected != "" {
			contentType = detected
		} else {
			// Sniff first bytes
			sniffBuf := make([]byte, 512)
			_, _ = f.ReadAt(sniffBuf, 0)
			contentType = http.DetectContentType(sniffBuf)
		}
	}

	id := uuid.New().String()
	adminDB := m.db.AdminDB()
	query := `
		INSERT INTO vpsql_objects (id, bucket_name, key, size_bytes, content_type, etag, is_public, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		ON CONFLICT (bucket_name, key) DO UPDATE
		SET size_bytes = EXCLUDED.size_bytes,
		    content_type = EXCLUDED.content_type,
		    etag = EXCLUDED.etag,
		    updated_at = NOW()
	`
	cleanKey := strings.TrimPrefix(key, "/")
	if _, err := adminDB.ExecContext(ctx, query, id, bucket.Name, cleanKey, written, contentType, etag, bucket.IsPublic); err != nil {
		return nil, fmt.Errorf("failed to update object metadata: %w", err)
	}

	endpoint := m.cfg.StoragePublicBase
	if endpoint == "" {
		endpoint = fmt.Sprintf("http://%s:%d", m.cfg.PublicHost, m.cfg.Port)
	}
	publicURL := fmt.Sprintf("%s/s3/%s/%s", strings.TrimRight(endpoint, "/"), bucket.Name, cleanKey)

	return &models.StorageObject{
		ID:             id,
		BucketName:     bucket.Name,
		Key:            cleanKey,
		SizeBytes:      written,
		SizeFormatted:  FormatBytes(written),
		ContentType:    contentType,
		ETag:           etag,
		IsPublic:       bucket.IsPublic,
		PublicURL:      publicURL,
		CreatedAt:      time.Now(),
		CreatedDisplay: "just now",
	}, nil
}

// GetObject locates object file on volume and returns file path and metadata
func (m *StorageManager) GetObject(ctx context.Context, bucketName, key string) (string, *models.StorageObject, error) {
	cleanKey := strings.TrimPrefix(key, "/")
	fullPath, err := m.safeKeyPath(bucketName, cleanKey)
	if err != nil {
		return "", nil, err
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		return "", nil, fmt.Errorf("NoSuchKey: the specified key does not exist")
	}

	adminDB := m.db.AdminDB()
	var obj models.StorageObject
	query := `
		SELECT id, bucket_name, key, size_bytes, content_type, etag, is_public, created_at
		FROM vpsql_objects
		WHERE bucket_name = $1 AND key = $2
	`
	err = adminDB.QueryRowContext(ctx, query, bucketName, cleanKey).Scan(
		&obj.ID, &obj.BucketName, &obj.Key, &obj.SizeBytes, &obj.ContentType, &obj.ETag, &obj.IsPublic, &obj.CreatedAt,
	)
	if err != nil {
		// Fallback from disk stat
		obj = models.StorageObject{
			ID:          uuid.New().String(),
			BucketName:  bucketName,
			Key:         cleanKey,
			SizeBytes:   info.Size(),
			ContentType: mime.TypeByExtension(filepath.Ext(cleanKey)),
			ETag:        fmt.Sprintf("\"%x\"", md5.Sum([]byte(cleanKey))),
			IsPublic:    true,
			CreatedAt:   info.ModTime(),
		}
	}

	endpoint := m.cfg.StoragePublicBase
	if endpoint == "" {
		endpoint = fmt.Sprintf("http://%s:%d", m.cfg.PublicHost, m.cfg.Port)
	}
	obj.PublicURL = fmt.Sprintf("%s/s3/%s/%s", strings.TrimRight(endpoint, "/"), bucketName, cleanKey)
	obj.SizeFormatted = FormatBytes(obj.SizeBytes)
	obj.CreatedDisplay = obj.CreatedAt.Format("02 Jan 15:04")

	return fullPath, &obj, nil
}

// DeleteObject deletes an object from persistent volume and metadata table
func (m *StorageManager) DeleteObject(ctx context.Context, bucketName, key string) error {
	cleanKey := strings.TrimPrefix(key, "/")
	fullPath, err := m.safeKeyPath(bucketName, cleanKey)
	if err == nil {
		_ = os.Remove(fullPath)
	}

	adminDB := m.db.AdminDB()
	_, err = adminDB.ExecContext(ctx, "DELETE FROM vpsql_objects WHERE bucket_name = $1 AND key = $2", bucketName, cleanKey)
	return err
}

// ListObjects returns objects in bucket matching prefix, with support for delimiter (folder simulation)
func (m *StorageManager) ListObjects(ctx context.Context, bucketName, prefix, delimiter string, maxKeys int, marker string) (*models.ListObjectsResponse, []string, error) {
	if maxKeys <= 0 || maxKeys > 1000 {
		maxKeys = 1000
	}

	bucket, err := m.Get(ctx, bucketName)
	if err != nil {
		return nil, nil, err
	}

	adminDB := m.db.AdminDB()
	query := `
		SELECT id, bucket_name, key, size_bytes, content_type, etag, is_public, created_at
		FROM vpsql_objects
		WHERE bucket_name = $1 AND key LIKE $2 AND key > $3
		ORDER BY key ASC
		LIMIT $4
	`
	likePattern := prefix + "%"
	rows, err := adminDB.QueryContext(ctx, query, bucket.Name, likePattern, marker, maxKeys)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	endpoint := m.cfg.StoragePublicBase
	if endpoint == "" {
		endpoint = fmt.Sprintf("http://%s:%d", m.cfg.PublicHost, m.cfg.Port)
	}
	endpoint = strings.TrimRight(endpoint, "/")

	var objects []models.StorageObject
	var commonPrefixes []string
	prefixSet := make(map[string]bool)

	var totalBytes int64

	for rows.Next() {
		var o models.StorageObject
		if err := rows.Scan(&o.ID, &o.BucketName, &o.Key, &o.SizeBytes, &o.ContentType, &o.ETag, &o.IsPublic, &o.CreatedAt); err != nil {
			continue
		}

		// Handle delimiter for virtual directories
		if delimiter != "" {
			subKey := strings.TrimPrefix(o.Key, prefix)
			if idx := strings.Index(subKey, delimiter); idx >= 0 {
				dirPrefix := prefix + subKey[:idx+len(delimiter)]
				if !prefixSet[dirPrefix] {
					prefixSet[dirPrefix] = true
					commonPrefixes = append(commonPrefixes, dirPrefix)
				}
				continue
			}
		}

		o.PublicURL = fmt.Sprintf("%s/s3/%s/%s", endpoint, bucket.Name, o.Key)
		o.SizeFormatted = FormatBytes(o.SizeBytes)
		o.CreatedDisplay = o.CreatedAt.Format("02 Jan 15:04")
		totalBytes += o.SizeBytes
		objects = append(objects, o)
	}

	if objects == nil {
		objects = []models.StorageObject{}
	}

	resp := &models.ListObjectsResponse{
		Bucket:     bucket.Name,
		Prefix:     prefix,
		Objects:    objects,
		TotalCount: int64(len(objects)),
		TotalBytes: totalBytes,
	}

	return resp, commonPrefixes, nil
}

// GetMetrics returns storage cluster meters and volume info
func (m *StorageManager) GetMetrics(ctx context.Context) (*models.StorageMetrics, error) {
	adminDB := m.db.AdminDB()

	var totalBuckets int
	var totalObjects int64
	var totalSizeBytes int64

	_ = adminDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM vpsql_buckets").Scan(&totalBuckets)
	_ = adminDB.QueryRowContext(ctx, "SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(size_bytes), 0) FROM vpsql_objects").Scan(&totalObjects, &totalSizeBytes)

	endpoint := m.cfg.StoragePublicBase
	if endpoint == "" {
		endpoint = fmt.Sprintf("http://%s:%d", m.cfg.PublicHost, m.cfg.Port)
	}

	return &models.StorageMetrics{
		TotalBuckets:       totalBuckets,
		TotalObjects:       totalObjects,
		TotalSizeBytes:     totalSizeBytes,
		TotalSizeFormatted: FormatBytes(totalSizeBytes),
		StorageDir:         m.cfg.StorageDir,
		PublicBaseURL:      endpoint,
	}, nil
}

// GeneratePresignedURL creates a standard S3 AWS SigV4 presigned URL for GET or PUT operations
func (m *StorageManager) GeneratePresignedURL(ctx context.Context, bucketName, key, method string, expiresIn time.Duration) (string, error) {
	bucket, err := m.Get(ctx, bucketName)
	if err != nil {
		return "", err
	}

	if method == "" {
		method = "GET"
	}
	method = strings.ToUpper(method)
	cleanKey := strings.TrimPrefix(key, "/")

	if expiresIn <= 0 {
		expiresIn = 1 * time.Hour
	}
	if expiresIn > 7*24*time.Hour {
		expiresIn = 7 * 24 * time.Hour
	}

	endpoint := m.cfg.StoragePublicBase
	if endpoint == "" {
		endpoint = fmt.Sprintf("http://%s:%d", m.cfg.PublicHost, m.cfg.Port)
	}
	endpoint = strings.TrimRight(endpoint, "/")

	parsedURL, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	hostHeader := parsedURL.Host
	if hostHeader == "" {
		hostHeader = m.cfg.PublicHost
	}

	now := time.Now().UTC()
	dateStamp := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	region := "auto"
	credential := fmt.Sprintf("%s/%s/%s/s3/aws4_request", bucket.AccessKey, dateStamp, region)
	expiresSec := int64(expiresIn.Seconds())

	canonicalURI := fmt.Sprintf("/s3/%s/%s", bucket.Name, cleanKey)

	// Query params to sign
	params := url.Values{}
	params.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	params.Set("X-Amz-Credential", credential)
	params.Set("X-Amz-Date", amzDate)
	params.Set("X-Amz-Expires", strconv.FormatInt(expiresSec, 10))
	params.Set("X-Amz-SignedHeaders", "host")

	// Canonical Query String
	var queryKeys []string
	for k := range params {
		queryKeys = append(queryKeys, k)
	}
	sort.Strings(queryKeys)

	var queryParts []string
	for _, k := range queryKeys {
		queryParts = append(queryParts, fmt.Sprintf("%s=%s", url.QueryEscape(k), url.QueryEscape(params.Get(k))))
	}
	canonicalQuery := strings.Join(queryParts, "&")

	// Canonical Headers
	canonicalHeaders := fmt.Sprintf("host:%s\n", hostHeader)
	signedHeaders := "host"
	payloadHash := "UNSIGNED-PAYLOAD"

	canonicalRequest := fmt.Sprintf("%s\n%s\n%s\n%s\n%s\n%s",
		method, canonicalURI, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash)

	hReq := sha256.Sum256([]byte(canonicalRequest))
	canonicalRequestHash := hex.EncodeToString(hReq[:])

	stringToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s/%s/s3/aws4_request\n%s",
		amzDate, dateStamp, region, canonicalRequestHash)

	kDate := hmacSHA256([]byte("AWS4"+bucket.SecretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte("s3"))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))

	signature := hex.EncodeToString(hmacSHA256(kSigning, []byte(stringToSign)))
	params.Set("X-Amz-Signature", signature)

	fullURL := fmt.Sprintf("%s%s?%s", endpoint, canonicalURI, params.Encode())
	return fullURL, nil
}
