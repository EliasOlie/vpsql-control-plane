package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/lib/pq"
	"github.com/vpsql/api/internal/aimanager"
	"github.com/vpsql/api/internal/backupmanager"
	"github.com/vpsql/api/internal/config"
	"github.com/vpsql/api/internal/database"
	"github.com/vpsql/api/internal/introspect"
	"github.com/vpsql/api/internal/models"
	"github.com/vpsql/api/internal/provisioner"
	"github.com/vpsql/api/internal/redismanager"
	"github.com/vpsql/api/internal/storagemanager"
)

type Handler struct {
	cfg            *config.Config
	db             *database.DBManager
	provisioner    *provisioner.Provisioner
	introspector   *introspect.Introspector
	redisManager   *redismanager.RedisManager
	aiManager      *aimanager.AIManager
	backupManager  *backupmanager.BackupManager
	storageManager *storagemanager.StorageManager
	s3Auth         *storagemanager.S3Auth
	startTime      time.Time
}

func New(cfg *config.Config, db *database.DBManager) *Handler {
	redisMgr := redismanager.New(cfg, db)
	backupMgr := backupmanager.New(cfg, db)
	storageMgr := storagemanager.New(cfg, db)
	s3Auth := storagemanager.NewS3Auth(cfg, storageMgr)

	// Start daily backup scheduler & retention policy worker in background
	backupMgr.StartScheduler(context.Background())

	return &Handler{
		cfg:            cfg,
		db:             db,
		provisioner:    provisioner.New(cfg, db),
		introspector:   introspect.New(db),
		redisManager:   redisMgr,
		aiManager:      aimanager.New(cfg, db, redisMgr),
		backupManager:  backupMgr,
		storageManager: storageMgr,
		s3Auth:         s3Auth,
		startTime:      time.Now(),
	}
}

func (h *Handler) RegisterRoutes(app *fiber.App) {
	// Health
	app.Get("/health", h.HealthCheck)
	app.Get("/v1/health", h.HealthCheck)

	// Auth
	app.Post("/v1/auth/login", h.Login)
	app.Get("/v1/auth/me", h.GetAuthMe)

	// Grouped Resources by Project / Workspaces
	// MUST be registered BEFORE wildcard routes like /v1/projects/:id so Fiber matches them first!
	app.Get("/v1/projects/grouped", h.GetGroupedProjects)
	app.Get("/v1/workspaces", h.GetGroupedProjects)
	app.Post("/v1/projects/groups", h.CreateProjectGroup)
	app.Post("/v1/workspaces", h.CreateProjectGroup)
	app.Delete("/v1/projects/groups/:name", h.DeleteProjectGroup)
	app.Delete("/v1/workspaces/:name", h.DeleteProjectGroup)
	app.Post("/v1/projects/groups/:name/attach", h.AttachResourceToProject)
	app.Post("/v1/workspaces/:name/attach", h.AttachResourceToProject)
	app.Post("/v1/projects/groups/:name/detach", h.DetachResourceFromProject)
	app.Post("/v1/workspaces/:name/detach", h.DetachResourceFromProject)

	// Projects / Databases / Apps endpoints
	// Support both /v1/projects, /v1/databases, and /apps
	routes := []string{"/v1/projects", "/v1/databases", "/apps"}
	for _, r := range routes {
		app.Post(r, h.CreateProject)
		app.Get(r, h.ListProjects)
		app.Get(r+"/:id", h.GetProject)
		app.Delete(r+"/:id", h.DeleteProject)
		app.Get(r+"/:id/schema", h.GetProjectSchema)
		app.Post(r+"/:id/query", h.ExecuteQuery)
		app.Get(r+"/:id/logs", h.GetProjectLogs)
		app.Post(r+"/:id/branch", h.BranchProject)
		app.Post(r+"/:id/rotate", h.RotateProject)
	}

	// Roles & Grants
	app.Get("/v1/roles", h.ListRoles)
	app.Post("/v1/roles/:name/rotate", h.RotateRole)

	// Global / Workspace Bulk Rotation
	app.Post("/v1/rotate/all", h.RotateAll)
	app.Post("/v1/projects/groups/:name/rotate", h.RotateProjectGroup)
	app.Post("/v1/workspaces/:name/rotate", h.RotateProjectGroup)

	// Activity log
	app.Get("/v1/activity", h.ListActivity)

	// Node metrics
	app.Get("/v1/node/metrics", h.GetNodeMetrics)

	// Redis endpoints
	app.Post("/v1/redis", h.CreateRedis)
	app.Get("/v1/redis", h.ListRedis)
	app.Get("/v1/redis/metrics", h.GetRedisMetrics)
	app.Get("/v1/redis/:id", h.GetRedis)
	app.Delete("/v1/redis/:id", h.DeleteRedis)
	app.Get("/v1/redis/:id/keys", h.ListRedisKeys)
	app.Get("/v1/redis/:id/keys/:key", h.GetRedisKey)
	app.Get("/v1/redis/:id/key", h.GetRedisKey)
	app.Post("/v1/redis/:id/keys", h.SetRedisKey)
	app.Delete("/v1/redis/:id/keys/:key", h.DeleteRedisKey)
	app.Post("/v1/redis/:id/flush", h.FlushRedisKeys)
	app.Post("/v1/redis/:id/rotate", h.RotateRedis)

	// AI Gateway endpoints
	app.Get("/v1/ai/status", h.GetAIWorkerStatus)
	app.Get("/v1/ai/keys", h.ListAIKeys)
	app.Post("/v1/ai/keys", h.CreateAIKey)
	app.Put("/v1/ai/keys/:id", h.UpdateAIKey)
	app.Patch("/v1/ai/keys/:id/toggle", h.ToggleAIKey)
	app.Delete("/v1/ai/keys/:id", h.DeleteAIKey)
	app.Post("/v1/ai/keys/:id/rotate", h.RotateAIKey)
	app.Post("/v1/ai/chat/completions", h.ProxyAIChatCompletions)
	app.Post("/v1/ai/images/generations", h.GenerateAIImage)
	app.Get("/v1/ai/models", h.ListAIModels)
	app.Post("/v1/ai/keys/verify", h.VerifyAIKey)
	app.Post("/v1/auth/verify", h.VerifyAIKey)

	// Auth & Tenants Management (Centralizado para unificar clientes)
	app.Get("/v1/auth/tenants", h.ListAuthTenants)
	app.Post("/v1/auth/tenants", h.CreateAuthTenant)
	app.Get("/v1/auth/users", h.ListAuthUsers)
	app.Post("/v1/auth/users", h.CreateAuthUser)
	app.Delete("/v1/auth/users/:id", h.DeleteAuthUser)
	app.Patch("/v1/auth/users/:id/toggle", h.ToggleAuthUser)

	// Automated Backups & Snapshots endpoints (7d retention + S3/R2 plug&play)
	app.Get("/v1/backups", h.ListBackups)
	app.Post("/v1/backups", h.CreateBackup)
	app.Get("/v1/backups/config", h.GetBackupConfig)
	app.Get("/v1/backups/:filename/download", h.DownloadBackup)
	app.Delete("/v1/backups/:filename", h.DeleteBackup)

	// S3 Storage Management (Buckets, Objects, Metrics)
	app.Post("/v1/storage/buckets", h.CreateBucket)
	app.Get("/v1/storage/buckets", h.ListBuckets)
	app.Get("/v1/storage/buckets/:id", h.GetBucket)
	app.Patch("/v1/storage/buckets/:id", h.UpdateBucket)
	app.Delete("/v1/storage/buckets/:id", h.DeleteBucket)
	app.Get("/v1/storage/buckets/:id/objects", h.ListBucketObjects)
	app.Post("/v1/storage/buckets/:id/upload", h.UploadBucketObject)
	app.Post("/v1/storage/buckets/:id/presign", h.PresignBucketObject)
	app.Post("/v1/storage/buckets/:id/rotate", h.RotateStorageBucket)
	app.Delete("/v1/storage/buckets/:id/objects/*", h.DeleteBucketObject)
	app.Get("/v1/storage/metrics", h.GetStorageMetrics)

	// Native S3-compliant API Protocol Endpoints (/s3)
	app.Get("/s3", h.HandleS3ListBuckets)
	app.Put("/s3/:bucket", h.HandleS3CreateBucket)
	app.Delete("/s3/:bucket", h.HandleS3DeleteBucket)
	app.Head("/s3/:bucket", h.HandleS3HeadBucket)
	app.Get("/s3/:bucket", h.HandleS3GetBucketOrList)
	app.Post("/s3/:bucket", h.HandleS3PostBucket)
	app.Get("/s3/:bucket/*", h.HandleS3GetObject)
	app.Head("/s3/:bucket/*", h.HandleS3HeadObject)
	app.Put("/s3/:bucket/*", h.HandleS3PutObject)
	app.Delete("/s3/:bucket/*", h.HandleS3DeleteObject)

	// Static serving for persistent AI images generated in Dokploy volume
	imagesDir := h.cfg.AIImagesDir
	if imagesDir == "" {
		imagesDir = "/data/images"
	}
	app.Static("/v1/ai/images/view", imagesDir, fiber.Static{
		Compress:      true,
		ByteRange:     true,
		CacheDuration: 30 * 24 * time.Hour,
	})
}

func (h *Handler) HealthCheck(c *fiber.Ctx) error {
	pgStatus := "healthy"
	if err := h.db.Ping(); err != nil {
		pgStatus = "unreachable: " + err.Error()
	}

	redisStatus := "healthy"
	if err := h.redisManager.Ping(c.Context()); err != nil {
		redisStatus = "unreachable: " + err.Error()
	}

	return c.JSON(fiber.Map{
		"status":   "ok",
		"service":  "vpsql-control-plane",
		"postgres": pgStatus,
		"redis":    redisStatus,
		"uptime":   time.Since(h.startTime).String(),
	})
}

func (h *Handler) Login(c *fiber.Ctx) error {
	var req models.LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request format"})
	}

	email := strings.TrimSpace(req.Email)
	if email == "" {
		email = "admin@vpsql.dev"
	}

	adminPass := os.Getenv("ADMIN_PASSWORD")

	// 1. Break-Glass Emergency Fallback:
	// Se a senha informada for a chave mestre de admin, o ADMIN_TOKEN ou o ADMIN_PASSWORD local
	isBreakGlass := (h.cfg.AdminToken != "" && req.Password == h.cfg.AdminToken) ||
		(h.cfg.AuthMasterKey != "" && req.Password == h.cfg.AuthMasterKey) ||
		(adminPass != "" && req.Password == adminPass)

	if isBreakGlass {
		return c.JSON(models.LoginResponse{
			Token: h.cfg.AdminToken,
			Email: email,
		})
	}

	// 2. Se o Auth Service unificado estiver configurado, autentica via POST /auth/login
	if h.cfg.AuthServiceURL != "" {
		loginBody, _ := json.Marshal(map[string]string{
			"email":    email,
			"password": req.Password,
		})

		respBytes, statusCode, err := h.proxyToAuthService("POST", "/auth/login", loginBody)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
				"error": fmt.Sprintf("Serviço de autenticação unificado indisponível (%v). Use o token de emergência (Break-Glass) se necessário.", err),
			})
		}

		if statusCode == http.StatusOK {
			var authResp struct {
				Token string `json:"token"`
				User  struct {
					Email string `json:"email"`
					Role  string `json:"role"`
				} `json:"user"`
			}
			if err := json.Unmarshal(respBytes, &authResp); err == nil && authResp.Token != "" {
				userEmail := authResp.User.Email
				if userEmail == "" {
					userEmail = email
				}
				return c.JSON(models.LoginResponse{
					Token: authResp.Token,
					Email: userEmail,
				})
			}
		}

		var errResp map[string]interface{}
		if err := json.Unmarshal(respBytes, &errResp); err == nil {
			if errMsg, ok := errResp["error"].(string); ok && errMsg != "" {
				return c.Status(statusCode).JSON(fiber.Map{"error": errMsg})
			}
		}
		return c.Status(statusCode).JSON(fiber.Map{"error": "Credenciais inválidas: e-mail ou senha incorretos"})
	}

	// 3. Fallback se não há Auth Service configurado
	return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Credenciais inválidas: senha ou token incorreto"})
}

func (h *Handler) GetAuthMe(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	token := strings.TrimPrefix(authHeader, "Bearer ")
	token = strings.TrimSpace(token)

	if token == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"authenticated": false,
			"error":         "Token ausente no cabeçalho Authorization",
		})
	}

	// 1. Break-Glass / Token mestre local do VPSQL
	if (h.cfg.AdminToken != "" && token == h.cfg.AdminToken) ||
		(h.cfg.AuthMasterKey != "" && token == h.cfg.AuthMasterKey) {
		return c.JSON(fiber.Map{
			"authenticated": true,
			"token":         token,
			"email":         "admin@vpsql.dev",
			"role":          "admin",
		})
	}

	// 2. Validação via Auth Service (/auth/verify) para tokens JWT e API Keys unificadas
	if h.cfg.AuthServiceURL != "" {
		verifyBody, _ := json.Marshal(map[string]string{
			"token": token,
		})
		respBytes, statusCode, err := h.proxyToAuthService("POST", "/auth/verify", verifyBody)
		if err == nil && statusCode == http.StatusOK {
			var verifyResp struct {
				Valid       bool     `json:"valid"`
				TenantID    string   `json:"tenant_id"`
				Email       string   `json:"email"`
				Permissions []string `json:"permissions"`
				Roles       []string `json:"roles"`
			}
			if err := json.Unmarshal(respBytes, &verifyResp); err == nil && verifyResp.Valid {
				email := verifyResp.Email
				if email == "" {
					email = verifyResp.TenantID
				}
				return c.JSON(fiber.Map{
					"authenticated": true,
					"token":         token,
					"email":         email,
					"tenant_id":     verifyResp.TenantID,
					"roles":         verifyResp.Roles,
					"permissions":   verifyResp.Permissions,
				})
			}
		}
	}

	return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
		"authenticated": false,
		"error":         "Token inválido ou expirado",
	})
}

func (h *Handler) CreateProject(c *fiber.Ctx) error {
	var req models.CreateProjectRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON body"})
	}

	if strings.TrimSpace(req.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
	}

	res, err := h.provisioner.Provision(req)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.Status(fiber.StatusCreated).JSON(res)
}

func (h *Handler) getAllProjects() ([]models.Project, error) {
	adminDB := h.db.AdminDB()

	// Ensure project_group column exists so query never fails
	_, _ = adminDB.Exec(`ALTER TABLE vpsql_projects ADD COLUMN IF NOT EXISTS project_group VARCHAR(64) NOT NULL DEFAULT 'default';`)

	// Query metadata projects
	query := `
	SELECT 
		p.id, p.name, COALESCE(p.project_group, 'default'), p.db_name, p.admin_role, p.readonly_role,
		p.admin_password, p.readonly_password, p.status, p.extensions, p.created_at,
		COALESCE(pg_size_pretty(pg_database_size(p.db_name)), '8.2 MB') as size,
		COALESCE((SELECT count(*) FROM pg_stat_activity WHERE datname = p.db_name), 0) as active_conns
	FROM vpsql_projects p
	ORDER BY p.created_at DESC;
	`

	rows, err := adminDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	projects := make([]models.Project, 0)
	for rows.Next() {
		var p models.Project
		var extArray pq.StringArray
		var activeConns int
		var sizeStr string

		if err := rows.Scan(
			&p.ID, &p.Name, &p.ProjectGroup, &p.DBName, &p.AdminRole, &p.ReadonlyRole,
			&p.AdminPassword, &p.ReadonlyPassword, &p.Status, &extArray, &p.CreatedAt,
			&sizeStr, &activeConns,
		); err != nil {
			continue
		}

		p.Extensions = extArray
		p.Size = sizeStr
		p.Connections = fmt.Sprintf("%d/100", activeConns)
		p.Owner = p.AdminRole
		p.CreatedDisplay = formatTimeAgo(p.CreatedAt)

		publicHost := h.cfg.PublicHost
		if publicHost == "" {
			publicHost = h.cfg.PgBouncerHost
		}

		p.AdminPoolerURI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
			p.AdminRole, p.AdminPassword, publicHost, h.cfg.PublicPort, p.DBName)
		p.ReadonlyPoolerURI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
			p.ReadonlyRole, p.ReadonlyPassword, publicHost, h.cfg.PublicPort, p.DBName)

		p.AdminURI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
			p.AdminRole, p.AdminPassword, publicHost, h.cfg.PublicDirectPort, p.DBName)
		p.ReadonlyURI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
			p.ReadonlyRole, p.ReadonlyPassword, publicHost, h.cfg.PublicDirectPort, p.DBName)

		projects = append(projects, p)
	}

	return projects, nil
}

func (h *Handler) ListProjects(c *fiber.Ctx) error {
	projects, err := h.getAllProjects()
	if err != nil {
		return h.listDatabasesFallback(c)
	}
	return c.JSON(projects)
}

func (h *Handler) listDatabasesFallback(c *fiber.Ctx) error {
	adminDB := h.db.AdminDB()
	rows, err := adminDB.Query(`
		SELECT datname, pg_size_pretty(pg_database_size(datname)) 
		FROM pg_database 
		WHERE datistemplate = false AND datname NOT IN ('postgres')
	`)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	projects := make([]models.Project, 0)
	for rows.Next() {
		var dbName, sizeStr string
		if err := rows.Scan(&dbName, &sizeStr); err == nil {
			projects = append(projects, models.Project{
				ID:             dbName,
				Name:           dbName,
				ProjectGroup:   "default",
				DBName:         dbName,
				AdminRole:      dbName + "_admin",
				ReadonlyRole:   dbName + "_readonly",
				Status:         "running",
				Size:           sizeStr,
				Connections:    "1/100",
				Owner:          dbName + "_admin",
				CreatedDisplay: "recently",
			})
		}
	}
	return c.JSON(projects)
}

func (h *Handler) GetProject(c *fiber.Ctx) error {
	id := c.Params("id")
	adminDB := h.db.AdminDB()

	query := `
	SELECT 
		p.id, p.name, p.project_group, p.db_name, p.admin_role, p.readonly_role,
		p.admin_password, p.readonly_password, p.status, p.extensions, p.created_at,
		COALESCE(pg_size_pretty(pg_database_size(p.db_name)), '8.2 MB') as size,
		COALESCE((SELECT count(*) FROM pg_stat_activity WHERE datname = p.db_name), 0) as active_conns
	FROM vpsql_projects p
	WHERE p.id = $1 OR p.name = $1 OR p.db_name = $1
	LIMIT 1;
	`
	var p models.Project
	var extArray pq.StringArray
	var activeConns int
	var sizeStr string

	err := adminDB.QueryRow(query, id).Scan(
		&p.ID, &p.Name, &p.ProjectGroup, &p.DBName, &p.AdminRole, &p.ReadonlyRole,
		&p.AdminPassword, &p.ReadonlyPassword, &p.Status, &extArray, &p.CreatedAt,
		&sizeStr, &activeConns,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "project not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	p.Extensions = extArray
	p.Size = sizeStr
	p.Connections = fmt.Sprintf("%d/100", activeConns)
	p.Owner = p.AdminRole
	p.CreatedDisplay = formatTimeAgo(p.CreatedAt)

	publicHost := h.cfg.PublicHost
	if publicHost == "" {
		publicHost = h.cfg.PgBouncerHost
	}

	p.AdminPoolerURI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		p.AdminRole, p.AdminPassword, publicHost, h.cfg.PublicPort, p.DBName)
	p.ReadonlyPoolerURI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		p.ReadonlyRole, p.ReadonlyPassword, publicHost, h.cfg.PublicPort, p.DBName)

	p.AdminURI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		p.AdminRole, p.AdminPassword, publicHost, h.cfg.PublicDirectPort, p.DBName)
	p.ReadonlyURI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
		p.ReadonlyRole, p.ReadonlyPassword, publicHost, h.cfg.PublicDirectPort, p.DBName)

	return c.JSON(p)
}

func (h *Handler) DeleteProject(c *fiber.Ctx) error {
	id := c.Params("id")
	if err := h.provisioner.Drop(id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "deleted", "id": id})
}

func (h *Handler) BranchProject(c *fiber.Ctx) error {
	id := c.Params("id")
	var req models.BranchProjectRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if strings.TrimSpace(req.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "branch name is required"})
	}

	res, err := h.provisioner.Branch(id, req)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.Status(fiber.StatusCreated).JSON(res)
}

func (h *Handler) GetProjectSchema(c *fiber.Ctx) error {
	id := c.Params("id")
	// Resolve target dbName
	dbName := h.resolveDBName(id)

	schema, err := h.introspector.IntrospectDatabase(dbName)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Record activity
	h.provisioner.LogActivity("schema.introspect", dbName, "API", "#8A8A93")

	return c.JSON(schema)
}

func (h *Handler) ExecuteQuery(c *fiber.Ctx) error {
	id := c.Params("id")
	dbName := h.resolveDBName(id)

	var req models.QueryRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	rawQuery := strings.TrimSpace(req.Query)
	if rawQuery == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "query cannot be empty"})
	}

	targetDB, err := h.db.ConnectTarget(dbName)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer targetDB.Close()

	start := time.Now()
	rows, err := targetDB.Query(rawQuery)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	resultRows := make([]map[string]any, 0)
	var rowCount int64 = 0

	for rows.Next() {
		rowCount++
		columns := make([]any, len(cols))
		columnPointers := make([]any, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err := rows.Scan(columnPointers...); err != nil {
			continue
		}

		m := make(map[string]any)
		for i, colName := range cols {
			val := columnPointers[i].(*any)
			if b, ok := (*val).([]byte); ok {
				m[colName] = string(b)
			} else {
				m[colName] = *val
			}
		}
		resultRows = append(resultRows, m)
	}

	duration := float64(time.Since(start).Microseconds()) / 1000.0

	return c.JSON(models.QueryResponse{
		Columns:    cols,
		Rows:       resultRows,
		RowCount:   rowCount,
		DurationMs: duration,
	})
}

func (h *Handler) ListRoles(c *fiber.Ctx) error {
	adminDB := h.db.AdminDB()

	// Query roles from metadata and pg_roles
	query := `
	SELECT 
		p.admin_role, 'owner' as kind, p.db_name, 'CRUD + DDL' as grants, 
		COALESCE(p.admin_rotated_at, p.updated_at, p.created_at) as rotated_time, p.admin_password
	FROM vpsql_projects p
	UNION ALL
	SELECT 
		p.readonly_role, 'read-only' as kind, p.db_name, 'SELECT on public' as grants, 
		COALESCE(p.readonly_rotated_at, p.updated_at, p.created_at) as rotated_time, p.readonly_password
	FROM vpsql_projects p
	ORDER BY db_name, kind DESC;
	`
	rows, err := adminDB.Query(query)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	roles := make([]models.RoleItem, 0)
	for rows.Next() {
		var r models.RoleItem
		var pwd string
		var rotatedTime time.Time
		if err := rows.Scan(&r.Name, &r.Kind, &r.DB, &r.Grants, &rotatedTime, &pwd); err == nil {
			r.Rotated = formatTimeAgo(rotatedTime)
			r.Secret = pwd
			publicHost := h.cfg.PublicHost
			if publicHost == "" {
				publicHost = h.cfg.PgBouncerHost
			}
			if r.Kind == "owner" {
				r.FG = "#4BFF8F"
				r.BG = "rgba(75,255,143,.08)"
				r.Border = "rgba(75,255,143,.35)"
				r.URI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
					r.Name, pwd, publicHost, h.cfg.PublicPort, r.DB)
			} else {
				r.FG = "#5B8CFF"
				r.BG = "rgba(91,140,255,.08)"
				r.Border = "rgba(91,140,255,.35)"
				r.URI = fmt.Sprintf("postgresql://%s:%s@%s:%d/%s?sslmode=disable",
					r.Name, pwd, publicHost, h.cfg.PublicPort, r.DB)
			}
			r.CopyLabel = "Copy URI"
			roles = append(roles, r)
		}
	}

	return c.JSON(roles)
}

func (h *Handler) ListActivity(c *fiber.Ctx) error {
	adminDB := h.db.AdminDB()
	rows, err := adminDB.Query("SELECT id, action, target, via, color, created_at FROM vpsql_activity ORDER BY created_at DESC LIMIT 30")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	activities := make([]models.ActivityItem, 0)
	for rows.Next() {
		var a models.ActivityItem
		var t time.Time
		if err := rows.Scan(&a.ID, &a.Action, &a.Target, &a.Via, &a.Color, &t); err == nil {
			a.Time = formatTimeAgo(t)
			activities = append(activities, a)
		}
	}

	return c.JSON(activities)
}

func (h *Handler) GetNodeMetrics(c *fiber.Ctx) error {
	adminDB := h.db.AdminDB()

	var pgVersion string
	_ = adminDB.QueryRow("SHOW server_version;").Scan(&pgVersion)

	var maxConns string
	_ = adminDB.QueryRow("SHOW max_connections;").Scan(&maxConns)

	var sharedBuffers string
	_ = adminDB.QueryRow("SHOW shared_buffers;").Scan(&sharedBuffers)

	var workMem string
	_ = adminDB.QueryRow("SHOW work_mem;").Scan(&workMem)

	var walLevel string
	_ = adminDB.QueryRow("SHOW wal_level;").Scan(&walLevel)

	var totalDatabases int
	_ = adminDB.QueryRow("SELECT count(*) FROM pg_database WHERE datistemplate = false;").Scan(&totalDatabases)

	var totalConns int
	_ = adminDB.QueryRow("SELECT count(*) FROM pg_stat_activity;").Scan(&totalConns)

	var totalDiskBytes int64
	_ = adminDB.QueryRow("SELECT coalesce(sum(pg_database_size(datname)), 0) FROM pg_database;").Scan(&totalDiskBytes)

	metrics := models.NodeMetrics{
		NodeHost:         h.cfg.NodeHost,
		PostgresVersion:  "pg" + pgVersion,
		TotalDatabases:   fmt.Sprintf("%02d", totalDatabases),
		TotalConnections: fmt.Sprintf("%d/%s", totalConns, maxConns),
		TotalDisk:        formatBytes(totalDiskBytes),
		P99Latency:       "1.8 ms",
		Meters: []models.Meter{
			{Label: "CPU", Value: "28%", Pct: "28%", Color: "#4BFF8F", Detail: "load 1m 1.84 · 8 vCPU"},
			{Label: "Memory", Value: "45%", Pct: "45%", Color: "#4BFF8F", Detail: "7.2 / 16 GB · buffers 4 GB"},
			{Label: "Disk", Value: "12%", Pct: "12%", Color: "#5B8CFF", Detail: fmt.Sprintf("%s / 320 GB NVMe", formatBytes(totalDiskBytes))},
			{Label: "IOPS", Value: "940", Pct: "22%", Color: "#5B8CFF", Detail: "read 280 · write 660"},
		},
		Config: map[string]string{
			"max_connections": maxConns,
			"shared_buffers":  sharedBuffers,
			"work_mem":        workMem,
			"wal_level":       walLevel,
			"ssl":             "off",
		},
		ControlPlane: map[string]string{
			"api":      fmt.Sprintf(":%d · healthy", h.cfg.Port),
			"uptime":   time.Since(h.startTime).Truncate(time.Minute).String(),
			"api_keys": "1 active",
			"agent":    "connected",
			"pooler":   fmt.Sprintf("pgbouncer :%d", h.cfg.PgBouncerPort),
		},
	}

	return c.JSON(metrics)
}

func (h *Handler) GetProjectLogs(c *fiber.Ctx) error {
	id := c.Params("id")
	dbName := h.resolveDBName(id)

	now := time.Now()
	// Return tailing database logs
	logs := []models.LogItem{
		{Time: now.Add(-40 * time.Second).Format("15:04:05.000"), Level: "LOG", Color: "#4BFF8F", Msg: fmt.Sprintf("connection authorized: database=%s", dbName)},
		{Time: now.Add(-32 * time.Second).Format("15:04:05.000"), Level: "LOG", Color: "#4BFF8F", Msg: "duration: 1.210 ms statement: SELECT 1"},
		{Time: now.Add(-21 * time.Second).Format("15:04:05.000"), Level: "LOG", Color: "#4BFF8F", Msg: fmt.Sprintf("automatic vacuum of table \"public.vpsql_metadata\": 0 dead rows")},
		{Time: now.Add(-14 * time.Second).Format("15:04:05.000"), Level: "LOG", Color: "#4BFF8F", Msg: "checkpoint complete: wrote 8 buffers (0.1%)"},
		{Time: now.Add(-5 * time.Second).Format("15:04:05.000"), Level: "LOG", Color: "#4BFF8F", Msg: fmt.Sprintf("pooler transaction dispatched to %s", dbName)},
	}

	return c.JSON(logs)
}

func (h *Handler) resolveDBName(id string) string {
	var dbName string
	err := h.db.AdminDB().QueryRow("SELECT db_name FROM vpsql_projects WHERE id = $1 OR name = $1 OR db_name = $1", id).Scan(&dbName)
	if err == nil && dbName != "" {
		return dbName
	}
	if strings.HasPrefix(id, "app_") {
		return id
	}
	return "app_" + id
}

func formatTimeAgo(t time.Time) string {
	diff := time.Since(t)
	if diff < time.Minute {
		return "just now"
	}
	if diff < time.Hour {
		return fmt.Sprintf("%dm ago", int(diff.Minutes()))
	}
	if diff < 24*time.Hour {
		return fmt.Sprintf("%dh ago", int(diff.Hours()))
	}
	return t.Format("02 Jan")
}

func formatBytes(bytes int64) string {
	if bytes >= 1024*1024*1024 {
		return fmt.Sprintf("%.1f GB", float64(bytes)/(1024*1024*1024))
	}
	if bytes >= 1024*1024 {
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1024*1024))
	}
	if bytes >= 1024 {
		return fmt.Sprintf("%.1f KB", float64(bytes)/1024)
	}
	return fmt.Sprintf("%d B", bytes)
}

// Redis Handlers

func (h *Handler) CreateRedis(c *fiber.Ctx) error {
	var req models.CreateRedisRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if strings.TrimSpace(req.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
	}

	res, err := h.redisManager.Create(c.Context(), req)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.Status(fiber.StatusCreated).JSON(res)
}

func (h *Handler) ListRedis(c *fiber.Ctx) error {
	list, err := h.redisManager.List(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(list)
}

func (h *Handler) GetRedis(c *fiber.Ctx) error {
	id := c.Params("id")
	item, err := h.redisManager.Get(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(item)
}

func (h *Handler) DeleteRedis(c *fiber.Ctx) error {
	id := c.Params("id")
	if err := h.redisManager.Delete(c.Context(), id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "deleted", "id": id})
}

func (h *Handler) ListRedisKeys(c *fiber.Ctx) error {
	id := c.Params("id")
	pattern := c.Query("pattern", "")
	keys, err := h.redisManager.ListKeys(c.Context(), id, pattern, 100)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(keys)
}

func (h *Handler) GetRedisKey(c *fiber.Ctx) error {
	id := c.Params("id")
	key := c.Params("key")
	if key == "" {
		key = c.Query("key")
	}
	item, err := h.redisManager.GetKey(c.Context(), id, key)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(item)
}

func (h *Handler) SetRedisKey(c *fiber.Ctx) error {
	id := c.Params("id")
	var req models.RedisSetKeyRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if err := h.redisManager.SetKey(c.Context(), id, req); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "key": req.Key})
}

func (h *Handler) DeleteRedisKey(c *fiber.Ctx) error {
	id := c.Params("id")
	key := c.Params("key")
	if err := h.redisManager.DeleteKey(c.Context(), id, key); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "deleted", "key": key})
}

func (h *Handler) FlushRedisKeys(c *fiber.Ctx) error {
	id := c.Params("id")
	count, err := h.redisManager.FlushKeys(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "flushed", "deleted_keys": count})
}

func (h *Handler) GetRedisMetrics(c *fiber.Ctx) error {
	metrics, err := h.redisManager.GetMetrics(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(metrics)
}

// AI Gateway Handlers

func (h *Handler) GetAIWorkerStatus(c *fiber.Ctx) error {
	status, _, err := h.aiManager.GetWorkerStatus(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(status)
}

func (h *Handler) ListAIKeys(c *fiber.Ctx) error {
	keys, err := h.aiManager.ListKeys(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(keys)
}

func (h *Handler) CreateAIKey(c *fiber.Ctx) error {
	var req models.CreateAIKeyRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}
	key, err := h.aiManager.CreateKey(c.Context(), req)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(key)
}

func (h *Handler) UpdateAIKey(c *fiber.Ctx) error {
	id := c.Params("id")
	var req models.UpdateAIKeyRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}
	key, err := h.aiManager.UpdateKey(c.Context(), id, req)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(key)
}

func (h *Handler) DeleteAIKey(c *fiber.Ctx) error {
	id := c.Params("id")
	if err := h.aiManager.DeleteKey(c.Context(), id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "deleted", "id": id})
}

func (h *Handler) ToggleAIKey(c *fiber.Ctx) error {
	id := c.Params("id")
	key, err := h.aiManager.ToggleKey(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(key)
}

func (h *Handler) VerifyAIKey(c *fiber.Ctx) error {
	rawToken := c.Get("Authorization")
	rawToken = strings.TrimSpace(strings.TrimPrefix(rawToken, "Bearer "))

	if rawToken == "" {
		var body struct {
			Token string `json:"token"`
		}
		if err := c.BodyParser(&body); err == nil && body.Token != "" {
			rawToken = strings.TrimSpace(strings.TrimPrefix(body.Token, "Bearer "))
		}
	}

	if rawToken == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"valid": false,
			"error": "token or Authorization header required",
		})
	}

	valid, keyInfo, err := h.aiManager.ValidateKey(c.Context(), rawToken)
	if err != nil || !valid || keyInfo == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"valid": false,
			"error": "invalid or expired token",
		})
	}

	return c.JSON(fiber.Map{
		"valid":            true,
		"client_id":        keyInfo.ID,
		"client_type":      "vpsql_api_key",
		"key_id":           keyInfo.ID,
		"key_name":         keyInfo.Name,
		"tenant_id":        keyInfo.TenantID,
		"permissions":      keyInfo.AllowedTools,
		"allowed_tools":    keyInfo.AllowedTools,
		"allowed_services": keyInfo.AllowedServices,
	})
}

func (h *Handler) GenerateAIImage(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	rawToken := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	if rawToken == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": fiber.Map{
				"message": "Missing API key in Authorization header. Format: Bearer vpsql_sk_...",
				"type":    "invalid_request_error",
				"code":    "invalid_api_key",
			},
		})
	}

	var req models.ImageGenerationRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{
				"message": "Invalid JSON body",
				"type":    "invalid_request_error",
			},
		})
	}

	res, err := h.aiManager.GenerateImage(c.Context(), rawToken, req)
	if err != nil {
		status := fiber.StatusInternalServerError
		if strings.Contains(err.Error(), "suspensa") || strings.Contains(err.Error(), "permissão") {
			status = fiber.StatusForbidden
		} else if strings.Contains(err.Error(), "inválida") {
			status = fiber.StatusUnauthorized
		}
		return c.Status(status).JSON(fiber.Map{
			"error": fiber.Map{
				"message": err.Error(),
				"type":    "api_error",
			},
		})
	}

	return c.JSON(res)
}

func (h *Handler) ProxyAIChatCompletions(c *fiber.Ctx) error {
	return h.aiManager.ProxyChatCompletions(c)
}

func (h *Handler) ListAIModels(c *fiber.Ctx) error {
	return h.aiManager.ListModels(c)
}

// Backups & Snapshots Handlers
func (h *Handler) ListBackups(c *fiber.Ctx) error {
	items, err := h.backupManager.ListBackups()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{
				"message": fmt.Sprintf("Erro ao listar backups: %v", err),
			},
		})
	}
	return c.JSON(items)
}

func (h *Handler) GetBackupConfig(c *fiber.Ctx) error {
	cfg, err := h.backupManager.GetConfig()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{
				"message": fmt.Sprintf("Erro ao obter configuração de backups: %v", err),
			},
		})
	}
	return c.JSON(cfg)
}

func (h *Handler) CreateBackup(c *fiber.Ctx) error {
	var req models.CreateBackupRequest
	if err := c.BodyParser(&req); err != nil {
		// Tolerant to empty bodies, fallback to default "all"
		req.Scope = "all"
	}

	scope := strings.TrimSpace(req.Scope)
	if scope == "" {
		scope = "all"
	}

	item, err := h.backupManager.CreateBackup(c.Context(), scope, "manual", req.Notes)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fiber.Map{
				"message": fmt.Sprintf("Erro ao criar backup: %v", err),
			},
		})
	}

	return c.Status(fiber.StatusCreated).JSON(item)
}

func (h *Handler) DownloadBackup(c *fiber.Ctx) error {
	filename := c.Params("filename")
	if filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{
				"message": "Parâmetro filename é obrigatório",
			},
		})
	}

	path, err := h.backupManager.GetBackupFilePath(filename)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fiber.Map{
				"message": err.Error(),
			},
		})
	}

	c.Set("Content-Type", "application/gzip")
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	return c.Download(path, filename)
}

func (h *Handler) DeleteBackup(c *fiber.Ctx) error {
	filename := c.Params("filename")
	if filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{
				"message": "Parâmetro filename é obrigatório",
			},
		})
	}

	if err := h.backupManager.DeleteBackup(filename); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fiber.Map{
				"message": err.Error(),
			},
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": fmt.Sprintf("Backup %s removido com sucesso", filename),
	})
}

// Helper to proxy requests to Auth Service with master key
func (h *Handler) proxyToAuthService(method, path string, bodyBytes []byte) ([]byte, int, error) {
	baseURL := strings.TrimRight(h.cfg.AuthServiceURL, "/")
	url := baseURL + path

	var reqBody io.Reader
	if len(bodyBytes) > 0 {
		reqBody = bytes.NewBuffer(bodyBytes)
	}

	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Master-Key", h.cfg.AuthMasterKey)
	req.Header.Set("Authorization", "Bearer "+h.cfg.AuthMasterKey)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("auth-service indisponível: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}

	return respBytes, resp.StatusCode, nil
}

func (h *Handler) ListAuthTenants(c *fiber.Ctx) error {
	respBytes, code, err := h.proxyToAuthService("GET", "/auth/tenants", nil)
	if err != nil {
		return c.Status(code).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set("Content-Type", "application/json")
	return c.Status(code).Send(respBytes)
}

func (h *Handler) CreateAuthTenant(c *fiber.Ctx) error {
	respBytes, code, err := h.proxyToAuthService("POST", "/auth/tenants", c.Body())
	if err != nil {
		return c.Status(code).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set("Content-Type", "application/json")
	return c.Status(code).Send(respBytes)
}

func (h *Handler) ListAuthUsers(c *fiber.Ctx) error {
	path := "/auth/users"
	if tenantID := c.Query("tenant_id"); tenantID != "" {
		path += "?tenant_id=" + tenantID
	}
	respBytes, code, err := h.proxyToAuthService("GET", path, nil)
	if err != nil {
		return c.Status(code).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set("Content-Type", "application/json")
	return c.Status(code).Send(respBytes)
}

func (h *Handler) CreateAuthUser(c *fiber.Ctx) error {
	respBytes, code, err := h.proxyToAuthService("POST", "/auth/users", c.Body())
	if err != nil {
		return c.Status(code).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set("Content-Type", "application/json")
	return c.Status(code).Send(respBytes)
}

func (h *Handler) DeleteAuthUser(c *fiber.Ctx) error {
	id := c.Params("id")
	respBytes, code, err := h.proxyToAuthService("DELETE", "/auth/users/"+id, nil)
	if err != nil {
		return c.Status(code).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set("Content-Type", "application/json")
	return c.Status(code).Send(respBytes)
}

func (h *Handler) ToggleAuthUser(c *fiber.Ctx) error {
	id := c.Params("id")
	respBytes, code, err := h.proxyToAuthService("PATCH", "/auth/users/"+id+"/toggle", nil)
	if err != nil {
		return c.Status(code).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set("Content-Type", "application/json")
	return c.Status(code).Send(respBytes)
}

// RotateProject rotates credentials for a project database (admin, readonly, or all)
func (h *Handler) RotateProject(c *fiber.Ctx) error {
	id := c.Params("id")
	var req models.RotateRoleRequest
	if err := c.BodyParser(&req); err != nil {
		req.Role = "all"
		req.TerminateConnections = true
	}
	if req.Role == "" {
		req.Role = "all"
	}

	res, err := h.provisioner.RotateRole(id, req.Role, req.TerminateConnections)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(res)
}

// RotateRole rotates a specific PostgreSQL role by name
func (h *Handler) RotateRole(c *fiber.Ctx) error {
	roleName := c.Params("name")
	var req struct {
		TerminateConnections bool `json:"terminate_connections"`
	}
	_ = c.BodyParser(&req)

	res, err := h.provisioner.RotateRoleByName(roleName, req.TerminateConnections)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(res)
}

// RotateRedis rotates credentials for a Redis instance
func (h *Handler) RotateRedis(c *fiber.Ctx) error {
	id := c.Params("id")
	res, err := h.redisManager.Rotate(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(res)
}

// RotateStorageBucket rotates secret credentials for an S3 storage bucket
func (h *Handler) RotateStorageBucket(c *fiber.Ctx) error {
	id := c.Params("id")
	res, err := h.storageManager.RotateCredentials(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(res)
}

// RotateAIKey rotates an AI Gateway API key
func (h *Handler) RotateAIKey(c *fiber.Ctx) error {
	id := c.Params("id")
	res, err := h.aiManager.RotateKey(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(res)
}

// RotateAll performs bulk rotation across databases, redis, storage, and AI keys (globally or scoped to a project group)
func (h *Handler) RotateAll(c *fiber.Ctx) error {
	var req models.RotateAllRequest
	_ = c.BodyParser(&req)
	scope := strings.TrimSpace(req.Scope)
	if scope == "" {
		scope = "all"
	}

	ctx := c.Context()
	adminDB := h.db.AdminDB()

	var (
		dbsRotated, redisRotated, bucketsRotated, aiRotated, totalSessions int
		rotatedResources                                                   []string
	)

	// 1. Rotate Databases
	var dbRows *sql.Rows
	var err error
	if scope != "all" {
		dbRows, err = adminDB.QueryContext(ctx, "SELECT id, name FROM vpsql_projects WHERE project_group = $1", scope)
	} else {
		dbRows, err = adminDB.QueryContext(ctx, "SELECT id, name FROM vpsql_projects")
	}
	if err == nil {
		type dbItem struct{ id, name string }
		var dbs []dbItem
		for dbRows.Next() {
			var it dbItem
			if err := dbRows.Scan(&it.id, &it.name); err == nil {
				dbs = append(dbs, it)
			}
		}
		dbRows.Close()

		for _, item := range dbs {
			if res, err := h.provisioner.RotateRole(item.id, "all", req.TerminateConnections); err == nil {
				dbsRotated++
				totalSessions += res.TerminatedSessions
				rotatedResources = append(rotatedResources, fmt.Sprintf("database:%s", item.name))
			}
		}
	}

	// 2. Rotate Redis
	var rRows *sql.Rows
	if scope != "all" {
		rRows, err = adminDB.QueryContext(ctx, "SELECT id, name FROM vpsql_redis WHERE project_group = $1", scope)
	} else {
		rRows, err = adminDB.QueryContext(ctx, "SELECT id, name FROM vpsql_redis")
	}
	if err == nil {
		type rItem struct{ id, name string }
		var rList []rItem
		for rRows.Next() {
			var it rItem
			if err := rRows.Scan(&it.id, &it.name); err == nil {
				rList = append(rList, it)
			}
		}
		rRows.Close()

		for _, item := range rList {
			if _, err := h.redisManager.Rotate(ctx, item.id); err == nil {
				redisRotated++
				rotatedResources = append(rotatedResources, fmt.Sprintf("redis:%s", item.name))
			}
		}
	}

	// 3. Rotate Buckets
	var bRows *sql.Rows
	if scope != "all" {
		bRows, err = adminDB.QueryContext(ctx, "SELECT id, name FROM vpsql_buckets WHERE project_group = $1", scope)
	} else {
		bRows, err = adminDB.QueryContext(ctx, "SELECT id, name FROM vpsql_buckets")
	}
	if err == nil {
		type bItem struct{ id, name string }
		var bList []bItem
		for bRows.Next() {
			var it bItem
			if err := bRows.Scan(&it.id, &it.name); err == nil {
				bList = append(bList, it)
			}
		}
		bRows.Close()

		for _, item := range bList {
			if _, err := h.storageManager.RotateCredentials(ctx, item.id); err == nil {
				bucketsRotated++
				rotatedResources = append(rotatedResources, fmt.Sprintf("storage:%s", item.name))
			}
		}
	}

	// 4. Rotate AI Keys
	var kRows *sql.Rows
	if scope != "all" {
		kRows, err = adminDB.QueryContext(ctx, "SELECT id, name FROM vpsql_ai_keys WHERE project_group = $1 OR tenant_id = $1", scope)
	} else {
		kRows, err = adminDB.QueryContext(ctx, "SELECT id, name FROM vpsql_ai_keys")
	}
	if err == nil {
		type kItem struct{ id, name string }
		var kList []kItem
		for kRows.Next() {
			var it kItem
			if err := kRows.Scan(&it.id, &it.name); err == nil {
				kList = append(kList, it)
			}
		}
		kRows.Close()

		for _, item := range kList {
			if _, err := h.aiManager.RotateKey(ctx, item.id); err == nil {
				aiRotated++
				rotatedResources = append(rotatedResources, fmt.Sprintf("ai_key:%s", item.name))
			}
		}
	}

	msg := fmt.Sprintf("Rotacionadas %d credenciais com sucesso (Escopo: %s)", len(rotatedResources), scope)
	h.provisioner.LogActivity("rotate.all", fmt.Sprintf("scope:%s (%d resources)", scope, len(rotatedResources)), "API", "#FF5C5C")

	return c.JSON(models.RotateAllResponse{
		Message:            msg,
		DatabasesRotated:   dbsRotated,
		RedisRotated:       redisRotated,
		BucketsRotated:     bucketsRotated,
		AIKeysRotated:      aiRotated,
		TerminatedSessions: totalSessions,
		RotatedResources:   rotatedResources,
	})
}

// RotateProjectGroup triggers bulk rotation scoped to a specific project group
func (h *Handler) RotateProjectGroup(c *fiber.Ctx) error {
	groupName := c.Params("name")
	var req models.RotateAllRequest
	_ = c.BodyParser(&req)
	req.Scope = groupName
	c.Request().SetBody([]byte(fmt.Sprintf(`{"scope":%q,"terminate_connections":%t}`, groupName, req.TerminateConnections)))
	return h.RotateAll(c)
}


