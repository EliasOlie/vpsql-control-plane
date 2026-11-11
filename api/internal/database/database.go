package database

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
	"github.com/vpsql/api/internal/config"
)

type DBManager struct {
	cfg   *config.Config
	admin *sql.DB
}

func NewDBManager(cfg *config.Config) (*DBManager, error) {
	connStr := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s connect_timeout=5",
		cfg.PostgresHost, cfg.PostgresPort, cfg.PostgresUser, cfg.PostgresPassword, cfg.PostgresDB, cfg.PostgresSSLMode,
	)

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open admin database connection: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	mgr := &DBManager{
		cfg:   cfg,
		admin: db,
	}

	// Try ping in background or init tables
	if err := mgr.Ping(); err != nil {
		log.Printf("[WARN] Admin database ping failed (will retry as needed): %v", err)
	} else {
		if err := mgr.InitMetadataTables(); err != nil {
			log.Printf("[WARN] Failed to init metadata tables: %v", err)
		}
	}

	return mgr, nil
}

func (m *DBManager) Ping() error {
	return m.admin.Ping()
}

func (m *DBManager) AdminDB() *sql.DB {
	return m.admin
}

// ConnectTarget opens a direct connection to a specific database
func (m *DBManager) ConnectTarget(dbName string) (*sql.DB, error) {
	connStr := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s connect_timeout=5",
		m.cfg.PostgresHost, m.cfg.PostgresPort, m.cfg.PostgresUser, m.cfg.PostgresPassword, dbName, m.cfg.PostgresSSLMode,
	)
	return sql.Open("postgres", connStr)
}

// ConnectWithUser opens a connection with a specific user & password to a specific database
func (m *DBManager) ConnectWithUser(user, password, dbName string) (*sql.DB, error) {
	connStr := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s connect_timeout=5",
		m.cfg.PostgresHost, m.cfg.PostgresPort, user, password, dbName, m.cfg.PostgresSSLMode,
	)
	return sql.Open("postgres", connStr)
}

// InitMetadataTables ensures VPSQL control-plane tables exist
func (m *DBManager) InitMetadataTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS vpsql_projects (
		id VARCHAR(64) PRIMARY KEY,
		name VARCHAR(63) NOT NULL UNIQUE,
		project_group VARCHAR(64) NOT NULL DEFAULT 'default',
		db_name VARCHAR(63) NOT NULL UNIQUE,
		admin_role VARCHAR(63) NOT NULL,
		readonly_role VARCHAR(63) NOT NULL,
		admin_password TEXT NOT NULL,
		readonly_password TEXT NOT NULL,
		status VARCHAR(32) NOT NULL DEFAULT 'running',
		extensions TEXT[] DEFAULT '{}',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS vpsql_activity (
		id SERIAL PRIMARY KEY,
		action VARCHAR(64) NOT NULL,
		target VARCHAR(128) NOT NULL,
		via VARCHAR(32) NOT NULL DEFAULT 'API',
		color VARCHAR(32) NOT NULL DEFAULT '#4BFF8F',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS vpsql_redis (
		id VARCHAR(64) PRIMARY KEY,
		name VARCHAR(63) NOT NULL UNIQUE,
		username VARCHAR(63) NOT NULL UNIQUE,
		password TEXT NOT NULL,
		key_prefix VARCHAR(63) NOT NULL,
		status VARCHAR(32) NOT NULL DEFAULT 'running',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS vpsql_ai_keys (
		id VARCHAR(64) PRIMARY KEY,
		name VARCHAR(63) NOT NULL,
		key_hash VARCHAR(64) NOT NULL UNIQUE,
		key_prefix VARCHAR(32) NOT NULL,
		tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
		allowed_tools TEXT[] DEFAULT '{"*"}',
		is_active BOOLEAN NOT NULL DEFAULT TRUE,
		rate_limit_rpm INT NOT NULL DEFAULT 60,
		total_requests BIGINT NOT NULL DEFAULT 0,
		last_used_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS vpsql_buckets (
		id VARCHAR(64) PRIMARY KEY,
		name VARCHAR(63) NOT NULL UNIQUE,
		project_group VARCHAR(64) NOT NULL DEFAULT 'default',
		access_key VARCHAR(64) NOT NULL UNIQUE,
		secret_key TEXT NOT NULL,
		is_public BOOLEAN NOT NULL DEFAULT TRUE,
		status VARCHAR(32) NOT NULL DEFAULT 'active',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS vpsql_objects (
		id VARCHAR(64) PRIMARY KEY,
		bucket_name VARCHAR(63) NOT NULL REFERENCES vpsql_buckets(name) ON DELETE CASCADE,
		key TEXT NOT NULL,
		size_bytes BIGINT NOT NULL DEFAULT 0,
		content_type VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
		etag VARCHAR(64) NOT NULL,
		is_public BOOLEAN NOT NULL DEFAULT TRUE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		UNIQUE(bucket_name, key)
	);

	CREATE TABLE IF NOT EXISTS vpsql_project_groups (
		id VARCHAR(64) PRIMARY KEY,
		name VARCHAR(63) NOT NULL UNIQUE,
		description TEXT DEFAULT '',
		color VARCHAR(32) DEFAULT '#5B8CFF',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	INSERT INTO vpsql_project_groups (id, name, description, color, created_at, updated_at)
	VALUES ('default', 'default', 'Default workspace', '#5B8CFF', NOW(), NOW())
	ON CONFLICT (name) DO NOTHING;

	ALTER TABLE vpsql_projects ADD COLUMN IF NOT EXISTS project_group VARCHAR(64) NOT NULL DEFAULT 'default';
	ALTER TABLE vpsql_projects ADD COLUMN IF NOT EXISTS admin_rotated_at TIMESTAMPTZ DEFAULT NOW();
	ALTER TABLE vpsql_projects ADD COLUMN IF NOT EXISTS readonly_rotated_at TIMESTAMPTZ DEFAULT NOW();
	ALTER TABLE vpsql_redis ADD COLUMN IF NOT EXISTS project_group VARCHAR(64) NOT NULL DEFAULT 'default';
	ALTER TABLE vpsql_redis ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ DEFAULT NOW();
	ALTER TABLE vpsql_ai_keys ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
	ALTER TABLE vpsql_ai_keys ADD COLUMN IF NOT EXISTS project_group VARCHAR(64) NOT NULL DEFAULT 'default';
	ALTER TABLE vpsql_ai_keys ADD COLUMN IF NOT EXISTS allowed_tools TEXT[] DEFAULT '{"*"}';
	ALTER TABLE vpsql_ai_keys ADD COLUMN IF NOT EXISTS allowed_services TEXT[] DEFAULT '{"*"}';
	ALTER TABLE vpsql_ai_keys ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ DEFAULT NOW();
	ALTER TABLE vpsql_buckets ADD COLUMN IF NOT EXISTS project_group VARCHAR(64) NOT NULL DEFAULT 'default';
	ALTER TABLE vpsql_buckets ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ DEFAULT NOW();
	`
	_, err := m.admin.Exec(schema)
	return err
}

func (m *DBManager) Close() error {
	if m.admin != nil {
		return m.admin.Close()
	}
	return nil
}
