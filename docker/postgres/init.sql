-- PostgreSQL init script for VPSQL Control Plane
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Ensure 'postgres' superuser exists if custom POSTGRES_USER is provided
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'postgres') THEN
        CREATE ROLE postgres WITH SUPERUSER LOGIN PASSWORD 'postgres';
    END IF;
END
$$;

-- Metadata table for the VPSQL Control Plane
CREATE TABLE IF NOT EXISTS vpsql_projects (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(63) NOT NULL UNIQUE,
    project_group VARCHAR(64) NOT NULL DEFAULT 'default',
    db_name VARCHAR(63) NOT NULL UNIQUE,
    admin_role VARCHAR(63) NOT NULL,
    readonly_role VARCHAR(63) NOT NULL,
    admin_password TEXT NOT NULL,
    readonly_password TEXT NOT NULL,
    admin_rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    readonly_rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(32) NOT NULL DEFAULT 'running',
    extensions TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vpsql_project_groups (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(63) NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    color VARCHAR(32) DEFAULT '#5B8CFF',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default project group
INSERT INTO vpsql_project_groups (id, name, description, color, created_at, updated_at)
VALUES ('default', 'default', 'Default workspace', '#5B8CFF', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

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
    project_group VARCHAR(64) NOT NULL DEFAULT 'default',
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
    project_group VARCHAR(64) NOT NULL DEFAULT 'default',
    allowed_tools TEXT[] DEFAULT '{"*"}',
    allowed_services TEXT[] DEFAULT '{"*"}',
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

-- Seed some initial activity
INSERT INTO vpsql_activity (action, target, via, color, created_at)
VALUES 
    ('node.boot', 'vpsql control plane ready', 'system', '#4BFF8F', NOW()),
    ('pgbouncer.connect', 'transaction pooler active', 'system', '#5B8CFF', NOW());
