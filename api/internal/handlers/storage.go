package handlers

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/vpsql/api/internal/models"
	"github.com/vpsql/api/internal/storagemanager"
)

// ==========================================
// REST Management API (Dashboard / CLI)
// ==========================================

func (h *Handler) CreateBucket(c *fiber.Ctx) error {
	var req models.CreateBucketRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON body"})
	}

	if strings.TrimSpace(req.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "bucket name is required"})
	}

	resp, err := h.storageManager.Create(c.Context(), req)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.Status(fiber.StatusCreated).JSON(resp)
}

func (h *Handler) ListBuckets(c *fiber.Ctx) error {
	projectFilter := c.Query("project")
	list, err := h.storageManager.List(c.Context(), projectFilter)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(list)
}

func (h *Handler) GetBucket(c *fiber.Ctx) error {
	id := c.Params("id")
	item, err := h.storageManager.Get(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(item)
}

func (h *Handler) UpdateBucket(c *fiber.Ctx) error {
	id := c.Params("id")
	var req models.UpdateBucketRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	updated, err := h.storageManager.Update(c.Context(), id, req)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(updated)
}

func (h *Handler) DeleteBucket(c *fiber.Ctx) error {
	id := c.Params("id")
	if err := h.storageManager.Delete(c.Context(), id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "deleted", "id": id})
}

func (h *Handler) ListBucketObjects(c *fiber.Ctx) error {
	id := c.Params("id")
	prefix := c.Query("prefix")
	delimiter := c.Query("delimiter")
	marker := c.Query("marker")
	maxKeys := 1000
	if mkStr := c.Query("max_keys"); mkStr != "" {
		if mk, err := strconv.Atoi(mkStr); err == nil && mk > 0 {
			maxKeys = mk
		}
	}

	resp, commonPrefixes, err := h.storageManager.ListObjects(c.Context(), id, prefix, delimiter, maxKeys, marker)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"bucket":          resp.Bucket,
		"prefix":          resp.Prefix,
		"objects":         resp.Objects,
		"common_prefixes": commonPrefixes,
		"total_count":     resp.TotalCount,
		"total_bytes":     resp.TotalBytes,
	})
}

func (h *Handler) UploadBucketObject(c *fiber.Ctx) error {
	id := c.Params("id")

	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Form field 'file' is required"})
	}

	key := c.FormValue("key")
	if key == "" {
		key = fileHeader.Filename
	}

	src, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to read uploaded file"})
	}
	defer src.Close()

	contentType := fileHeader.Header.Get("Content-Type")
	obj, err := h.storageManager.PutObject(c.Context(), id, key, src, fileHeader.Size, contentType)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.Status(fiber.StatusCreated).JSON(obj)
}

func (h *Handler) PresignBucketObject(c *fiber.Ctx) error {
	id := c.Params("id")
	var req struct {
		Key              string `json:"key"`
		Method           string `json:"method"`
		ExpiresInSeconds int64  `json:"expires_in_seconds"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if strings.TrimSpace(req.Key) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "key is required"})
	}

	if req.ExpiresInSeconds <= 0 {
		req.ExpiresInSeconds = 3600
	}

	duration := time.Duration(req.ExpiresInSeconds) * time.Second
	presignedURL, err := h.storageManager.GeneratePresignedURL(c.Context(), id, req.Key, req.Method, duration)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"url":                presignedURL,
		"bucket":             id,
		"key":                req.Key,
		"method":             req.Method,
		"expires_in_seconds": req.ExpiresInSeconds,
		"expires_at":         time.Now().UTC().Add(duration).Format(time.RFC3339),
	})
}

func (h *Handler) DeleteBucketObject(c *fiber.Ctx) error {
	id := c.Params("id")
	key := c.Params("*")
	if key == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "key is required"})
	}

	if err := h.storageManager.DeleteObject(c.Context(), id, key); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"status": "deleted", "key": key})
}

func (h *Handler) GetStorageMetrics(c *fiber.Ctx) error {
	metrics, err := h.storageManager.GetMetrics(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(metrics)
}

// ==========================================
// Native S3 Protocol Implementation (/s3)
// ==========================================

func (h *Handler) HandleS3ListBuckets(c *fiber.Ctx) error {
	_, isAdmin, err := h.s3Auth.Authenticate(c, "")
	if err != nil && !isAdmin {
		return h.sendS3Error(c, fiber.StatusForbidden, "AccessDenied", "Access Denied")
	}

	buckets, err := h.storageManager.List(c.Context(), "")
	if err != nil {
		return h.sendS3Error(c, fiber.StatusInternalServerError, "InternalError", err.Error())
	}

	var xmlBuckets []storagemanager.S3BucketItem
	for _, b := range buckets {
		xmlBuckets = append(xmlBuckets, storagemanager.S3BucketItem{
			Name:         b.Name,
			CreationDate: b.CreatedAt.UTC().Format(time.RFC3339),
		})
	}

	res := storagemanager.ListAllMyBucketsResult{
		Owner: storagemanager.S3Owner{
			ID:          "vpsql",
			DisplayName: "vpsql",
		},
		Buckets: xmlBuckets,
	}

	c.Set("Content-Type", "application/xml")
	return c.XML(res)
}

func (h *Handler) HandleS3GetBucketOrList(c *fiber.Ctx) error {
	bucketName := c.Params("bucket")
	if bucketName == "" {
		return h.HandleS3ListBuckets(c)
	}

	if c.Query("location") != "" {
		c.Set("Content-Type", "application/xml")
		return c.SendString(`<?xml version="1.0" encoding="UTF-8"?>
<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">auto</LocationConstraint>`)
	}

	// Authenticate
	_, _, err := h.s3Auth.Authenticate(c, bucketName)
	if err != nil {
		return h.sendS3Error(c, fiber.StatusForbidden, "AccessDenied", "Access Denied")
	}

	prefix := c.Query("prefix")
	delimiter := c.Query("delimiter")
	marker := c.Query("marker")
	if marker == "" {
		marker = c.Query("continuation-token")
	}
	maxKeys := 1000
	if mkStr := c.Query("max-keys"); mkStr != "" {
		if mk, err := strconv.Atoi(mkStr); err == nil && mk > 0 {
			maxKeys = mk
		}
	}

	res, commonPrefixes, err := h.storageManager.ListObjects(c.Context(), bucketName, prefix, delimiter, maxKeys, marker)
	if err != nil {
		return h.sendS3Error(c, fiber.StatusNotFound, "NoSuchBucket", err.Error())
	}

	var contents []storagemanager.S3ObjectContent
	for _, o := range res.Objects {
		contents = append(contents, storagemanager.S3ObjectContent{
			Key:          o.Key,
			LastModified: o.CreatedAt.UTC().Format(time.RFC3339),
			ETag:         o.ETag,
			Size:         o.SizeBytes,
			StorageClass: "STANDARD",
		})
	}

	var cpList []storagemanager.S3CommonPrefix
	for _, cp := range commonPrefixes {
		cpList = append(cpList, storagemanager.S3CommonPrefix{Prefix: cp})
	}

	xmlRes := storagemanager.ListBucketResult{
		Name:           bucketName,
		Prefix:         prefix,
		Marker:         marker,
		MaxKeys:        maxKeys,
		Delimiter:      delimiter,
		IsTruncated:    false,
		Contents:       contents,
		CommonPrefixes: cpList,
	}

	c.Set("Content-Type", "application/xml")
	return c.XML(xmlRes)
}

func (h *Handler) HandleS3CreateBucket(c *fiber.Ctx) error {
	bucketName := c.Params("bucket")
	_, isAdmin, err := h.s3Auth.Authenticate(c, "")
	if err != nil && !isAdmin {
		return h.sendS3Error(c, fiber.StatusForbidden, "AccessDenied", "Only admin can create buckets via S3 API")
	}

	resp, err := h.storageManager.Create(c.Context(), models.CreateBucketRequest{
		Name: bucketName,
	})
	if err != nil {
		return h.sendS3Error(c, fiber.StatusBadRequest, "BucketAlreadyExists", err.Error())
	}

	c.Set("Location", "/"+resp.Bucket.Name)
	return c.SendStatus(fiber.StatusOK)
}

func (h *Handler) HandleS3DeleteBucket(c *fiber.Ctx) error {
	bucketName := c.Params("bucket")
	_, isAdmin, err := h.s3Auth.Authenticate(c, bucketName)
	if err != nil && !isAdmin {
		return h.sendS3Error(c, fiber.StatusForbidden, "AccessDenied", "Access Denied")
	}

	if err := h.storageManager.Delete(c.Context(), bucketName); err != nil {
		return h.sendS3Error(c, fiber.StatusNotFound, "NoSuchBucket", err.Error())
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) HandleS3HeadBucket(c *fiber.Ctx) error {
	bucketName := c.Params("bucket")
	_, err := h.storageManager.Get(c.Context(), bucketName)
	if err != nil {
		return c.SendStatus(fiber.StatusNotFound)
	}
	return c.SendStatus(fiber.StatusOK)
}

func (h *Handler) HandleS3GetObject(c *fiber.Ctx) error {
	bucketName := c.Params("bucket")
	key := c.Params("*")

	_, _, err := h.s3Auth.Authenticate(c, bucketName)
	if err != nil {
		return h.sendS3Error(c, fiber.StatusForbidden, "AccessDenied", "Access Denied")
	}

	filePath, obj, err := h.storageManager.GetObject(c.Context(), bucketName, key)
	if err != nil {
		return h.sendS3Error(c, fiber.StatusNotFound, "NoSuchKey", "The specified key does not exist.")
	}

	c.Set("Content-Type", obj.ContentType)
	c.Set("ETag", obj.ETag)
	c.Set("Accept-Ranges", "bytes")
	if obj.IsPublic {
		c.Set("Cache-Control", "public, max-age=31536000")
	}

	return c.SendFile(filePath)
}

func (h *Handler) HandleS3HeadObject(c *fiber.Ctx) error {
	bucketName := c.Params("bucket")
	key := c.Params("*")

	_, _, err := h.s3Auth.Authenticate(c, bucketName)
	if err != nil {
		return c.SendStatus(fiber.StatusForbidden)
	}

	_, obj, err := h.storageManager.GetObject(c.Context(), bucketName, key)
	if err != nil {
		return c.SendStatus(fiber.StatusNotFound)
	}

	c.Set("Content-Type", obj.ContentType)
	c.Set("Content-Length", fmt.Sprintf("%d", obj.SizeBytes))
	c.Set("ETag", obj.ETag)
	c.Set("Last-Modified", obj.CreatedAt.UTC().Format(http.TimeFormat))
	c.Set("Accept-Ranges", "bytes")
	if obj.IsPublic {
		c.Set("Cache-Control", "public, max-age=31536000")
	}

	return c.SendStatus(fiber.StatusOK)
}

func (h *Handler) HandleS3PutObject(c *fiber.Ctx) error {
	bucketName := c.Params("bucket")
	key := c.Params("*")
	if key == "" {
		return h.sendS3Error(c, fiber.StatusBadRequest, "InvalidKey", "Key is required")
	}

	_, _, err := h.s3Auth.Authenticate(c, bucketName)
	if err != nil {
		return h.sendS3Error(c, fiber.StatusForbidden, "AccessDenied", "Access Denied")
	}

	contentType := c.Get("Content-Type")
	body := bytes.NewReader(c.Body())

	obj, err := h.storageManager.PutObject(c.Context(), bucketName, key, body, int64(len(c.Body())), contentType)
	if err != nil {
		return h.sendS3Error(c, fiber.StatusInternalServerError, "InternalError", err.Error())
	}

	c.Set("ETag", obj.ETag)
	return c.SendStatus(fiber.StatusOK)
}

func (h *Handler) HandleS3DeleteObject(c *fiber.Ctx) error {
	bucketName := c.Params("bucket")
	key := c.Params("*")

	_, _, err := h.s3Auth.Authenticate(c, bucketName)
	if err != nil {
		return h.sendS3Error(c, fiber.StatusForbidden, "AccessDenied", "Access Denied")
	}

	_ = h.storageManager.DeleteObject(c.Context(), bucketName, key)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) HandleS3PostBucket(c *fiber.Ctx) error {
	bucketName := c.Params("bucket")
	if c.Query("delete") != "" {
		_, _, err := h.s3Auth.Authenticate(c, bucketName)
		if err != nil {
			return h.sendS3Error(c, fiber.StatusForbidden, "AccessDenied", "Access Denied")
		}

		type DeleteObjectItem struct {
			Key string `xml:"Key"`
		}
		type DeletePayload struct {
			Quiet   bool               `xml:"Quiet"`
			Objects []DeleteObjectItem `xml:"Object"`
		}
		var payload DeletePayload
		if err := xml.Unmarshal(c.Body(), &payload); err == nil {
			type DeletedItem struct {
				Key string `xml:"Key"`
			}
			type DeleteResult struct {
				XMLName xml.Name      `xml:"http://s3.amazonaws.com/doc/2006-03-01/ DeleteResult"`
				Deleted []DeletedItem `xml:"Deleted"`
			}
			var deleted []DeletedItem
			for _, item := range payload.Objects {
				if item.Key != "" {
					_ = h.storageManager.DeleteObject(c.Context(), bucketName, item.Key)
					deleted = append(deleted, DeletedItem{Key: item.Key})
				}
			}
			c.Set("Content-Type", "application/xml")
			return c.XML(DeleteResult{Deleted: deleted})
		}
	}
	return c.SendStatus(fiber.StatusBadRequest)
}

func (h *Handler) sendS3Error(c *fiber.Ctx, status int, code, message string) error {
	c.Set("Content-Type", "application/xml")
	errResp := storagemanager.S3Error{
		Code:      code,
		Message:   message,
		Resource:  c.Path(),
		RequestId: fmt.Sprintf("%x", time.Now().UnixNano()),
	}
	return c.Status(status).XML(errResp)
}

// ==========================================
// Unified Grouped Projects Handler
// ==========================================

func (h *Handler) ensureProjectTables(ctx context.Context) {
	adminDB := h.db.AdminDB()
	statements := []string{
		`CREATE TABLE IF NOT EXISTS vpsql_project_groups (
			id VARCHAR(64) PRIMARY KEY,
			name VARCHAR(63) NOT NULL UNIQUE,
			description TEXT DEFAULT '',
			color VARCHAR(32) DEFAULT '#5B8CFF',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`INSERT INTO vpsql_project_groups (id, name, description, color, created_at, updated_at)
		VALUES ('default', 'default', 'Default workspace', '#5B8CFF', NOW(), NOW())
		ON CONFLICT (name) DO NOTHING`,
		`ALTER TABLE vpsql_projects ADD COLUMN IF NOT EXISTS project_group VARCHAR(64) NOT NULL DEFAULT 'default'`,
		`ALTER TABLE vpsql_redis ADD COLUMN IF NOT EXISTS project_group VARCHAR(64) NOT NULL DEFAULT 'default'`,
		`ALTER TABLE vpsql_ai_keys ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default'`,
		`ALTER TABLE vpsql_ai_keys ADD COLUMN IF NOT EXISTS project_group VARCHAR(64) NOT NULL DEFAULT 'default'`,
		`ALTER TABLE vpsql_buckets ADD COLUMN IF NOT EXISTS project_group VARCHAR(64) NOT NULL DEFAULT 'default'`,
	}
	for _, stmt := range statements {
		_, _ = adminDB.ExecContext(ctx, stmt)
	}
}

func (h *Handler) GetGroupedProjects(c *fiber.Ctx) error {
	ctx := c.Context()
	h.ensureProjectTables(ctx)
	adminDB := h.db.AdminDB()

	// Group map by project name
	groups := make(map[string]*models.GroupedProject)

	ensureGroup := func(name string) *models.GroupedProject {
		cleanName := strings.TrimSpace(name)
		if cleanName == "" {
			cleanName = "default"
		}
		if _, ok := groups[cleanName]; !ok {
			groups[cleanName] = &models.GroupedProject{
				Name:        cleanName,
				Description: "",
				Color:       "#5B8CFF",
				Databases:   []models.Project{},
				Redis:       []models.RedisInstance{},
				Buckets:     []models.StorageBucket{},
				AIKeys:      []models.AIKey{},
			}
		}
		return groups[cleanName]
	}

	// Always ensure "default" exists
	ensureGroup("default")

	// 0. Fetch explicit project groups from database
	pgRows, err := adminDB.QueryContext(ctx, "SELECT id, name, COALESCE(description, ''), COALESCE(color, '#5B8CFF') FROM vpsql_project_groups ORDER BY created_at ASC")
	if err != nil {
		log.Printf("[Projects] ERROR querying vpsql_project_groups: %v", err)
	} else {
		defer pgRows.Close()
		for pgRows.Next() {
			var id, name, desc, color string
			if err := pgRows.Scan(&id, &name, &desc, &color); err != nil {
				log.Printf("[Projects] ERROR scanning project group row: %v", err)
			} else {
				g := ensureGroup(name)
				g.ID = id
				g.Description = desc
				g.Color = color
			}
		}
	}

	// 1. Fetch all databases
	databases, err := h.getAllProjects()
	if err != nil {
		databases = []models.Project{}
	}

	// 2. Fetch all Redis instances
	redisList, err := h.redisManager.List(ctx)
	if err != nil {
		redisList = []models.RedisInstance{}
	}

	// 3. Fetch all Storage buckets
	bucketList, err := h.storageManager.List(ctx, "")
	if err != nil {
		bucketList = []models.StorageBucket{}
	}

	// 4. Fetch all AI keys
	aiKeys, err := h.aiManager.ListKeys(ctx)
	if err != nil {
		aiKeys = []models.AIKey{}
	}

	for _, d := range databases {
		grpName := strings.TrimSpace(d.ProjectGroup)
		if grpName == "" {
			grpName = "default"
		}
		g := ensureGroup(grpName)
		g.Databases = append(g.Databases, d)
		g.TotalResources++
	}

	for _, r := range redisList {
		grpName := r.ProjectGroup
		if grpName == "" {
			grpName = "default"
		}
		g := ensureGroup(grpName)
		g.Redis = append(g.Redis, r)
		g.TotalResources++
	}

	for _, b := range bucketList {
		grpName := b.ProjectGroup
		if grpName == "" {
			grpName = "default"
		}
		g := ensureGroup(grpName)
		g.Buckets = append(g.Buckets, b)
		g.TotalResources++
	}

	for _, k := range aiKeys {
		grpName := k.ProjectGroup
		if grpName == "" {
			grpName = k.TenantID
		}
		if grpName == "" {
			grpName = "default"
		}
		g := ensureGroup(grpName)
		g.AIKeys = append(g.AIKeys, k)
		g.TotalResources++
	}

	var result []models.GroupedProject
	for _, g := range groups {
		result = append(result, *g)
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Name == "default" {
			return true
		}
		if result[j].Name == "default" {
			return false
		}
		return result[i].Name < result[j].Name
	})

	totalResources := len(databases) + len(redisList) + len(bucketList) + len(aiKeys)

	return c.JSON(models.GroupedResourcesResponse{
		Projects:       result,
		TotalProjects:  len(result),
		TotalResources: totalResources,
	})
}

func (h *Handler) CreateProjectGroup(c *fiber.Ctx) error {
	var req models.CreateProjectGroupRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	rawName := strings.TrimSpace(req.Name)
	if rawName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "project name is required"})
	}

	cleanName := strings.ToLower(rawName)
	re := regexp.MustCompile(`[^a-z0-9_-]`)
	cleanName = re.ReplaceAllString(cleanName, "-")
	cleanName = strings.Trim(cleanName, "-_")
	if len(cleanName) < 2 {
		cleanName = "proj-" + cleanName
	}

	color := req.Color
	if color == "" {
		colors := []string{"#5B8CFF", "#4BFF8F", "#FF5C5C", "#00E5FF", "#C77DFF", "#FFB020"}
		color = colors[len(cleanName)%len(colors)]
	}

	id := uuid.New().String()
	h.ensureProjectTables(c.Context())
	adminDB := h.db.AdminDB()

	query := `
		INSERT INTO vpsql_project_groups (id, name, description, color, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, color = EXCLUDED.color, updated_at = NOW()
	`
	if _, err := adminDB.ExecContext(c.Context(), query, id, cleanName, req.Description, color); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	_, _ = adminDB.ExecContext(c.Context(),
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"project.create", cleanName, "API", color,
	)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":          id,
		"name":        cleanName,
		"description": req.Description,
		"color":       color,
		"status":      "created",
	})
}

func (h *Handler) DeleteProjectGroup(c *fiber.Ctx) error {
	name := strings.TrimSpace(c.Params("name"))
	if name == "" || name == "default" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot delete default project group"})
	}

	adminDB := h.db.AdminDB()
	ctx := c.Context()
	h.ensureProjectTables(ctx)

	// 1. Delete group
	_, err := adminDB.ExecContext(ctx, "DELETE FROM vpsql_project_groups WHERE name = $1", name)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// 2. Reassign orphaned resources to 'default'
	_, _ = adminDB.ExecContext(ctx, "UPDATE vpsql_projects SET project_group = 'default' WHERE project_group = $1", name)
	_, _ = adminDB.ExecContext(ctx, "UPDATE vpsql_redis SET project_group = 'default' WHERE project_group = $1", name)
	_, _ = adminDB.ExecContext(ctx, "UPDATE vpsql_buckets SET project_group = 'default' WHERE project_group = $1", name)
	_, _ = adminDB.ExecContext(ctx, "UPDATE vpsql_ai_keys SET project_group = 'default' WHERE project_group = $1", name)

	_, _ = adminDB.ExecContext(ctx,
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"project.delete", name, "API", "#FF5C5C",
	)

	return c.JSON(fiber.Map{"status": "deleted", "name": name})
}

func (h *Handler) AttachResourceToProject(c *fiber.Ctx) error {
	projectName := strings.TrimSpace(c.Params("name"))
	if projectName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "project name is required"})
	}

	var req models.AttachResourceRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	resID := strings.TrimSpace(req.ResourceID)
	if resID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "resource_id is required"})
	}

	adminDB := h.db.AdminDB()
	ctx := c.Context()
	h.ensureProjectTables(ctx)

	// Ensure project group exists
	_, _ = adminDB.ExecContext(ctx,
		"INSERT INTO vpsql_project_groups (id, name, description, color, created_at, updated_at) VALUES ($1, $2, '', '#5B8CFF', NOW(), NOW()) ON CONFLICT (name) DO NOTHING",
		uuid.New().String(), projectName,
	)

	var updateErr error
	switch strings.ToLower(req.ResourceType) {
	case "database", "postgres", "db":
		_, updateErr = adminDB.ExecContext(ctx, "UPDATE vpsql_projects SET project_group = $1 WHERE id = $2 OR name = $2 OR db_name = $2", projectName, resID)
	case "redis", "cache":
		_, updateErr = adminDB.ExecContext(ctx, "UPDATE vpsql_redis SET project_group = $1 WHERE id = $2 OR name = $2 OR username = $2", projectName, resID)
	case "storage", "s3", "bucket":
		_, updateErr = adminDB.ExecContext(ctx, "UPDATE vpsql_buckets SET project_group = $1 WHERE id = $2 OR name = $2", projectName, resID)
	case "ai", "ai_key", "key":
		_, updateErr = adminDB.ExecContext(ctx, "UPDATE vpsql_ai_keys SET project_group = $1, tenant_id = $1 WHERE id = $2 OR name = $2", projectName, resID)
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unsupported resource_type. Use database, redis, storage, or ai."})
	}

	if updateErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": updateErr.Error()})
	}

	_, _ = adminDB.ExecContext(ctx,
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"project.attach", fmt.Sprintf("%s -> %s", resID, projectName), "API", "#5B8CFF",
	)

	return c.JSON(fiber.Map{
		"status":        "attached",
		"project":       projectName,
		"resource_type": req.ResourceType,
		"resource_id":   resID,
	})
}

func (h *Handler) DetachResourceFromProject(c *fiber.Ctx) error {
	projectName := strings.TrimSpace(c.Params("name"))
	var req models.AttachResourceRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	resID := strings.TrimSpace(req.ResourceID)
	if resID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "resource_id is required"})
	}

	adminDB := h.db.AdminDB()
	ctx := c.Context()
	h.ensureProjectTables(ctx)

	var updateErr error
	switch strings.ToLower(req.ResourceType) {
	case "database", "postgres", "db":
		_, updateErr = adminDB.ExecContext(ctx, "UPDATE vpsql_projects SET project_group = 'default' WHERE (id = $1 OR name = $1 OR db_name = $1) AND project_group = $2", resID, projectName)
	case "redis", "cache":
		_, updateErr = adminDB.ExecContext(ctx, "UPDATE vpsql_redis SET project_group = 'default' WHERE (id = $1 OR name = $1 OR username = $1) AND project_group = $2", resID, projectName)
	case "storage", "s3", "bucket":
		_, updateErr = adminDB.ExecContext(ctx, "UPDATE vpsql_buckets SET project_group = 'default' WHERE (id = $1 OR name = $1) AND project_group = $2", resID, projectName)
	case "ai", "ai_key", "key":
		_, updateErr = adminDB.ExecContext(ctx, "UPDATE vpsql_ai_keys SET project_group = 'default' WHERE (id = $1 OR name = $1) AND project_group = $2", resID, projectName)
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unsupported resource_type"})
	}

	if updateErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": updateErr.Error()})
	}

	return c.JSON(fiber.Map{
		"status":        "detached",
		"project":       projectName,
		"resource_type": req.ResourceType,
		"resource_id":   resID,
	})
}
