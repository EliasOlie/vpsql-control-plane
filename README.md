# VPSQL — Single-Node PostgreSQL Control Plane & Multi-Tenant Provisioner

VPSQL is an automated control plane for provisioning isolated PostgreSQL databases on a single VPS or dedicated instance. It features automated least-privilege role management, connection pooling via **PgBouncer**, live schema introspection, a powerful **Go CLI (`vpsql`)**, and a **Next.js Control Plane Dashboard**.

---

## Architecture

```
                                  +-----------------------------+
                                  |     Next.js Control Plane   |
                                  |      (Port 3000 / Web)      |
                                  +--------------+--------------+
                                                 |
                                                 v
+--------------------------+        +------------+--------------+
|        vpsql CLI         | -----> |   Go Fiber API (Manager)  |
| (Cobra binary / Terminal)|        |         (Port 8080)       |
+--------------------------+        +---+-------------------+---+
                                        |                   |
                     Superadmin Control |                   | Pooler Route
                                        v                   v
                             +----------+-----+    +--------+--------+
                             | PostgreSQL 16  | <--| PgBouncer Pooler|
                             |  (Port 5432)   |    |   (Port 6432)   |
                             +----------------+    +-----------------+
```

### 1. Control Plane Components

1. **Manager API (`/api`)**: Written in **Go (Fiber v2)** for high-throughput, low-latency concurrent operations. Manages the superadmin connection to the PostgreSQL instance, coordinates database provisioning transactions, schema introspections, proxy queries, audit logs, and metrics.
2. **Proxy / Connection Pooler (`/docker/pgbouncer`)**: **PgBouncer** configured in transaction pooling mode to prevent connection exhaustion across multi-tenant applications sharing a single VPS.
3. **CLI (`/cli`)**: Single static binary written in **Go (Cobra)** (`vpsql`) supporting provisioning, schema pulling, proxy SQL queries, role rotation, and node health checks.
4. **Dashboard Frontend (`/frontend`)**: **Next.js 14** application with Geist & JetBrains Mono typography, interactive database provisioning, ⌘K command palette, credentials inspector, and schema introspection views.

---

## The Provisioning Workflow (The SQL Engine)

When `POST /v1/projects` (or `/apps`, `/v1/databases`) is called, the API runs the transactional provisioning sequence:

```sql
-- 1. Create isolated roles with strong dynamically generated passwords
CREATE ROLE "app_meuprojeto_admin" WITH LOGIN PASSWORD 'strong_random_secret_admin';
CREATE ROLE "app_meuprojeto_readonly" WITH LOGIN PASSWORD 'strong_random_secret_ro';

-- 2. Create the application database
CREATE DATABASE "app_meuprojeto";

-- 3. Revoke all public privileges for security
REVOKE ALL PRIVILEGES ON DATABASE "app_meuprojeto" FROM PUBLIC;

-- 4. Transfer ownership to admin and grant connect to read-only role
ALTER DATABASE "app_meuprojeto" OWNER TO "app_meuprojeto_admin";
GRANT CONNECT ON DATABASE "app_meuprojeto" TO "app_meuprojeto_readonly";
```

### Critical Detail: Target Database Connection

Because grants are **not** inherited across databases, the API immediately establishes a direct connection inside the newly created database `app_meuprojeto` to configure the schemas:

```sql
-- Executed directly INSIDE the new database:
GRANT USAGE ON SCHEMA public TO "app_meuprojeto_readonly";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO "app_meuprojeto_readonly";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "app_meuprojeto_readonly";

-- Optional: Enable requested extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

---

## Schema Introspection

The engine connects directly to the target application database and performs introspection using Postgres catalogs:

```sql
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable 
FROM information_schema.columns 
WHERE table_schema = 'public' 
ORDER BY table_name, ordinal_position;
```

It also correlates `information_schema.table_constraints` and `information_schema.key_column_usage` to identify `PRIMARY KEY` (PK), `FOREIGN KEY` (FK), and `UNIQUE` (UNIQ) constraints.

---

## REST API Specification

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/projects` | Provision a new database and roles, returns admin and read-only connection strings (direct + pooler) |
| `GET` | `/v1/projects` | List all databases with sizes, connection counts, status, and owner |
| `GET` | `/v1/projects/:id` | Get details and connection strings for a specific database |
| `DELETE` | `/v1/projects/:id` | Terminate active connections, drop the database, and drop roles |
| `GET` | `/v1/projects/:id/schema` | Pull structured DDL / JSON schema of public tables and columns |
| `POST` | `/v1/projects/:id/query` | Secure query proxy route to run SQL statements against the target database |
| `GET` | `/v1/roles` | List all roles, permissions, and status |
| `GET` | `/v1/activity` | Audit trail of all control-plane mutations |
| `GET` | `/v1/node/metrics` | Host resource meters and `postgresql.conf` parameters |
| `POST` | `/v1/storage/buckets` | Provision an S3-compliant storage bucket on persistent volume |
| `GET` | `/v1/storage/buckets` | List storage buckets with disk usage and object count |
| `ALL` | `/s3/:bucket/*` | S3-compliant REST protocol (AWS4-HMAC-SHA256 SigV4 & Public Read) |
| `GET` | `/v1/projects/grouped` | Project Hub: consolidated resources (DB, Redis, S3, AI) by project |
| `POST` | `/v1/projects/:id/rotate` | Rotate credentials for database roles (`admin`, `readonly`, or `all`) with active connection termination |
| `POST` | `/v1/roles/:name/rotate` | Rotate credentials for a specific PostgreSQL role |
| `POST` | `/v1/rotate/all` | Emergency bulk rotation across all databases, Redis, S3, and AI keys (global or workspace scope) |
| `POST` | `/v1/redis/:id/rotate` | Rotate Redis ACL tenant password and disconnect active sessions |
| `POST` | `/v1/storage/buckets/:id/rotate` | Rotate S3 SecretAccessKey for persistent storage bucket |
| `POST` | `/v1/ai/keys/:id/rotate` | Rotate AI Gateway virtual API token (`vpsql_sk_...`) |
| `POST` | `/v1/auth/login` | Authenticate and obtain API token |
| `GET` | `/health` | Control plane and PostgreSQL health status |

---

## CLI Reference (`vpsql`)

> 📖 **Documentação Completa:** Consulte o guia detalhado em [docs/CLI.md](docs/CLI.md) para todos os subcomandos, exemplos práticos com `jq`, automações e variáveis de ambiente.

### Installation & PATH Setup

```bash
cd cli
go build -o vpsql .
./vpsql --help
```

### Commands

```bash
# Authenticate
vpsql auth login --endpoint http://localhost:8080 --email dev@vpsql.io

# Provision a new database
vpsql db create my_app --project core --ext uuid-ossp,pgcrypto

# List databases
vpsql db ls
vpsql db ls --json | jq '.[] | {name, size, conns}'

# Inspect schema
vpsql schema pull my_app --format table
vpsql schema pull my_app --format json

# Execute a query via proxy
vpsql query my_app "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"

# Check node status
vpsql node status
```

---

## Running with Docker Compose

To start the complete stack (PostgreSQL, PgBouncer, Go API, and Next.js Frontend):

```bash
docker compose up -d --build
```

### Services & Ports

- **Frontend Dashboard**: `http://localhost:3000`
- **Control Plane API**: `http://localhost:8080`
- **PgBouncer Pooler**: `localhost:6432`
- **PostgreSQL**: `localhost:5433` (mapped to 5432 internally)

To shut down:
```bash
docker compose down
```

---

## Monorepo Layout

```
vpsql/
├── api/                     # Go Fiber backend (Control Plane API)
│   ├── cmd/server/          # Main entrypoint
│   ├── internal/
│   │   ├── config/          # Environment configuration
│   │   ├── database/        # Connection manager & pools
│   │   ├── handlers/        # REST route handlers
│   │   ├── introspect/      # Schema introspection engine
│   │   ├── models/          # Data types and DTOs
│   │   └── provisioner/     # Transactional SQL provisioning engine
│   └── Dockerfile
├── cli/                     # Go Cobra CLI (vpsql)
│   ├── cmd/                 # auth, db, schema, query, role, node commands
│   ├── internal/            # API client & local config (~/.vpsql/config.json)
│   └── main.go
├── frontend/                # Next.js 14 Control Plane Dashboard
│   ├── src/
│   │   ├── app/             # App Router pages & styles
│   │   └── lib/             # API client & models
│   └── Dockerfile
├── docker/
│   ├── pgbouncer/           # pgbouncer.ini & userlist.txt
│   └── postgres/            # init.sql metadata tables
├── docker-compose.yml       # Production compose specification
├── Makefile                 # Build & run automation
└── README.md
```
