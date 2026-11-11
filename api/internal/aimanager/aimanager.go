package aimanager

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/vpsql/api/internal/config"
	"github.com/vpsql/api/internal/database"
	"github.com/vpsql/api/internal/models"
	"github.com/vpsql/api/internal/redismanager"
)

const (
	DefaultWorkerKey = "app_ia:llm:local:endpoint"
)

type WorkerPayload struct {
	URL    string `json:"url"`
	APIKey string `json:"api_key"`
	Key    string `json:"key"`
	Model  string `json:"model"`
	TS     int64  `json:"ts"`
}

type KeyInfo struct {
	ID              string
	Name            string
	TenantID        string
	AllowedTools    []string
	AllowedServices []string
	IsActive        bool
}

type AIManager struct {
	cfg          *config.Config
	db           *database.DBManager
	redisManager *redismanager.RedisManager
	httpClient   *http.Client
}

func New(cfg *config.Config, db *database.DBManager, redisManager *redismanager.RedisManager) *AIManager {
	return &AIManager{
		cfg:          cfg,
		db:           db,
		redisManager: redisManager,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

// GenerateRandomKey produces a secure random API key with format vpsql_sk_live_<32 hex chars>
func generateRandomKey() (string, string) {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	hexPart := hex.EncodeToString(bytes)
	rawKey := fmt.Sprintf("vpsql_sk_live_%s", hexPart)
	prefix := fmt.Sprintf("vpsql_sk_...%s", hexPart[len(hexPart)-6:])
	return rawKey, prefix
}

func hashKey(rawKey string) string {
	h := sha256.Sum256([]byte(strings.TrimSpace(rawKey)))
	return hex.EncodeToString(h[:])
}

// CreateKey provisions a new AI Gateway API key with tenant, tool and service scoping
func (m *AIManager) CreateKey(ctx context.Context, req models.CreateAIKeyRequest) (*models.AIKey, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Default AI Key"
	}

	tenantID := strings.TrimSpace(req.TenantID)
	if tenantID == "" {
		tenantID = "default"
	}

	projGroup := strings.TrimSpace(req.ProjectGroup)
	if projGroup == "" {
		projGroup = tenantID
	}

	allowedTools := req.AllowedTools
	if len(allowedTools) == 0 {
		allowedTools = []string{"*"}
	}

	allowedServices := req.AllowedServices
	if len(allowedServices) == 0 {
		allowedServices = []string{"*"}
	}

	rateLimit := req.RateLimitRPM
	if rateLimit <= 0 {
		rateLimit = 60
	}

	rawKey, prefix := generateRandomKey()
	keyHash := hashKey(rawKey)
	id := uuid.New().String()
	now := time.Now()

	query := `
		INSERT INTO vpsql_ai_keys (id, name, key_hash, key_prefix, tenant_id, project_group, allowed_tools, allowed_services, is_active, rate_limit_rpm, total_requests, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, 0, $10)
	`
	_, err := m.db.AdminDB().ExecContext(ctx, query, id, name, keyHash, prefix, tenantID, projGroup, pq.Array(allowedTools), pq.Array(allowedServices), rateLimit, now)
	if err != nil {
		return nil, fmt.Errorf("failed to save AI key: %w", err)
	}

	return &models.AIKey{
		ID:              id,
		Name:            name,
		KeyPrefix:       prefix,
		RawKey:          rawKey,
		TenantID:        tenantID,
		ProjectGroup:    projGroup,
		AllowedTools:    allowedTools,
		AllowedServices: allowedServices,
		IsActive:        true,
		RateLimitRPM:    rateLimit,
		TotalRequests:   0,
		CreatedAt:       now,
	}, nil
}

// ListKeys returns all AI Gateway API keys
func (m *AIManager) ListKeys(ctx context.Context) ([]models.AIKey, error) {
	query := `
		SELECT id, name, key_prefix, tenant_id, COALESCE(project_group, tenant_id), allowed_tools, allowed_services, is_active, rate_limit_rpm, total_requests, last_used_at, created_at
		FROM vpsql_ai_keys
		ORDER BY created_at DESC
	`
	rows, err := m.db.AdminDB().QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query AI keys: %w", err)
	}
	defer rows.Close()

	var keys []models.AIKey
	for rows.Next() {
		var k models.AIKey
		var lastUsed sql.NullTime
		if err := rows.Scan(&k.ID, &k.Name, &k.KeyPrefix, &k.TenantID, &k.ProjectGroup, pq.Array(&k.AllowedTools), pq.Array(&k.AllowedServices), &k.IsActive, &k.RateLimitRPM, &k.TotalRequests, &lastUsed, &k.CreatedAt); err != nil {
			return nil, err
		}
		if lastUsed.Valid {
			k.LastUsedAt = &lastUsed.Time
		}
		keys = append(keys, k)
	}

	if keys == nil {
		keys = []models.AIKey{}
	}
	return keys, nil
}

// UpdateKey updates tenant, allowed tools, allowed services, status or rate limit for an existing AI key
func (m *AIManager) UpdateKey(ctx context.Context, id string, req models.UpdateAIKeyRequest) (*models.AIKey, error) {
	var current models.AIKey
	var lastUsed sql.NullTime
	query := `
		SELECT id, name, key_prefix, tenant_id, COALESCE(project_group, tenant_id), allowed_tools, allowed_services, is_active, rate_limit_rpm, total_requests, last_used_at, created_at
		FROM vpsql_ai_keys
		WHERE id = $1
	`
	err := m.db.AdminDB().QueryRowContext(ctx, query, id).Scan(
		&current.ID, &current.Name, &current.KeyPrefix, &current.TenantID, &current.ProjectGroup,
		pq.Array(&current.AllowedTools), pq.Array(&current.AllowedServices), &current.IsActive, &current.RateLimitRPM,
		&current.TotalRequests, &lastUsed, &current.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("AI key not found: %w", err)
	}

	if strings.TrimSpace(req.Name) != "" {
		current.Name = strings.TrimSpace(req.Name)
	}
	if strings.TrimSpace(req.TenantID) != "" {
		current.TenantID = strings.TrimSpace(req.TenantID)
	}
	if req.AllowedTools != nil {
		current.AllowedTools = *req.AllowedTools
	}
	if req.AllowedServices != nil {
		current.AllowedServices = *req.AllowedServices
	}
	if req.RateLimitRPM > 0 {
		current.RateLimitRPM = req.RateLimitRPM
	}
	if req.IsActive != nil {
		current.IsActive = *req.IsActive
	}

	updateQuery := `
		UPDATE vpsql_ai_keys
		SET name = $1, tenant_id = $2, allowed_tools = $3, allowed_services = $4, rate_limit_rpm = $5, is_active = $6
		WHERE id = $7
	`
	_, err = m.db.AdminDB().ExecContext(ctx, updateQuery, current.Name, current.TenantID, pq.Array(current.AllowedTools), pq.Array(current.AllowedServices), current.RateLimitRPM, current.IsActive, id)
	if err != nil {
		return nil, fmt.Errorf("failed to update AI key: %w", err)
	}

	if lastUsed.Valid {
		current.LastUsedAt = &lastUsed.Time
	}
	return &current, nil
}

// ToggleKey flips the is_active status of an AI key (for suspending or reactivating)
func (m *AIManager) ToggleKey(ctx context.Context, id string) (*models.AIKey, error) {
	query := `
		UPDATE vpsql_ai_keys
		SET is_active = NOT is_active
		WHERE id = $1
		RETURNING id, name, key_prefix, tenant_id, allowed_tools, allowed_services, is_active, rate_limit_rpm, total_requests, last_used_at, created_at
	`
	var current models.AIKey
	var lastUsed sql.NullTime
	err := m.db.AdminDB().QueryRowContext(ctx, query, id).Scan(
		&current.ID, &current.Name, &current.KeyPrefix, &current.TenantID,
		pq.Array(&current.AllowedTools), pq.Array(&current.AllowedServices), &current.IsActive, &current.RateLimitRPM,
		&current.TotalRequests, &lastUsed, &current.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to toggle AI key: %w", err)
	}
	if lastUsed.Valid {
		current.LastUsedAt = &lastUsed.Time
	}
	return &current, nil
}

// DeleteKey revokes and permanently deletes an AI Gateway key
func (m *AIManager) DeleteKey(ctx context.Context, id string) error {
	query := `DELETE FROM vpsql_ai_keys WHERE id = $1`
	res, err := m.db.AdminDB().ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete AI key: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("AI key not found")
	}
	return nil
}

// RotateKey invalidates the existing AI Key and generates a new secret token for the same scope
func (m *AIManager) RotateKey(ctx context.Context, id string) (*models.AIKey, error) {
	var current models.AIKey
	var lastUsed sql.NullTime
	query := `
		SELECT id, name, key_prefix, tenant_id, COALESCE(project_group, tenant_id), allowed_tools, allowed_services, is_active, rate_limit_rpm, total_requests, last_used_at, created_at
		FROM vpsql_ai_keys
		WHERE id = $1
	`
	err := m.db.AdminDB().QueryRowContext(ctx, query, id).Scan(
		&current.ID, &current.Name, &current.KeyPrefix, &current.TenantID, &current.ProjectGroup,
		pq.Array(&current.AllowedTools), pq.Array(&current.AllowedServices), &current.IsActive, &current.RateLimitRPM,
		&current.TotalRequests, &lastUsed, &current.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("AI key '%s' not found: %w", id, err)
	}

	rawKey, prefix := generateRandomKey()
	newHash := hashKey(rawKey)

	_, err = m.db.AdminDB().ExecContext(ctx,
		"UPDATE vpsql_ai_keys SET key_hash = $1, key_prefix = $2, rotated_at = NOW() WHERE id = $3",
		newHash, prefix, id,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to rotate AI key: %w", err)
	}

	_, _ = m.db.AdminDB().ExecContext(ctx,
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"ai.rotate_key", current.Name, "API", "#FFB020",
	)

	current.KeyPrefix = prefix
	current.RawKey = rawKey
	if lastUsed.Valid {
		current.LastUsedAt = &lastUsed.Time
	}
	return &current, nil
}

// ValidateKeyForService validates an API token, checks active status and authorized service ("chat" or "images")
func (m *AIManager) ValidateKeyForService(ctx context.Context, rawToken string, requiredService string) (bool, *KeyInfo, error) {
	trimmed := strings.TrimSpace(rawToken)
	if trimmed == "" {
		return false, nil, nil
	}

	// 1. Allow master admin token
	if m.cfg.AdminToken != "" && trimmed == m.cfg.AdminToken {
		return true, &KeyInfo{
			ID:              "admin-master",
			Name:            "Admin Master Token",
			TenantID:        "admin",
			AllowedTools:    []string{"*"},
			AllowedServices: []string{"*"},
			IsActive:        true,
		}, nil
	}

	// 2. Hash and check in vpsql_ai_keys
	keyHash := hashKey(trimmed)
	query := `SELECT id, name, tenant_id, allowed_tools, allowed_services, is_active FROM vpsql_ai_keys WHERE key_hash = $1`
	var info KeyInfo
	err := m.db.AdminDB().QueryRowContext(ctx, query, keyHash).Scan(
		&info.ID, &info.Name, &info.TenantID, pq.Array(&info.AllowedTools), pq.Array(&info.AllowedServices), &info.IsActive,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil, nil
		}
		return false, nil, err
	}

	if !info.IsActive {
		return false, &info, fmt.Errorf("Chave de API suspensa por motivos administrativos. Entre em contato com o suporte.")
	}

	// 3. Check service permission
	if requiredService != "" {
		allowed := false
		for _, s := range info.AllowedServices {
			if s == "*" || s == requiredService {
				allowed = true
				break
			}
		}
		if !allowed {
			serviceLabel := requiredService
			if requiredService == "chat" {
				serviceLabel = "Chat & Texto"
			} else if requiredService == "images" {
				serviceLabel = "Geração de Imagens"
			}
			return false, &info, fmt.Errorf("Esta chave de API não possui permissão para o serviço de %s. Serviços permitidos: %v", serviceLabel, info.AllowedServices)
		}
	}

	// Update usage asynchronously
	go func(keyID string) {
		updateQuery := `UPDATE vpsql_ai_keys SET total_requests = total_requests + 1, last_used_at = NOW() WHERE id = $1`
		_, _ = m.db.AdminDB().Exec(updateQuery, keyID)
	}(info.ID)

	return true, &info, nil
}

// ValidateKey validates an API token without service filtering
func (m *AIManager) ValidateKey(ctx context.Context, rawToken string) (bool, *KeyInfo, error) {
	return m.ValidateKeyForService(ctx, rawToken, "")
}

// GetWorkerStatus checks Redis for active Colab/GPU worker heartbeats
func (m *AIManager) GetWorkerStatus(ctx context.Context) (*models.AIWorkerStatus, *WorkerPayload, error) {
	rdb := m.redisManager.Client()
	if rdb == nil {
		return &models.AIWorkerStatus{
			Online: false,
			Model:  "Qwen/Qwen2.5-14B-Instruct",
		}, nil, nil
	}

	// Check keys in priority
	candidateKeys := []string{DefaultWorkerKey, "llm:local:endpoint"}

	var val string
	var ttl time.Duration
	var foundKey string
	var err error

	for _, k := range candidateKeys {
		exists, _ := rdb.Exists(ctx, k).Result()
		if exists > 0 {
			val, err = rdb.Get(ctx, k).Result()
			if err == nil && val != "" {
				ttl, _ = rdb.TTL(ctx, k).Result()
				foundKey = k
				break
			}
		}
	}

	// Fallback scan if candidate keys not found directly
	if foundKey == "" {
		keys, _ := rdb.Keys(ctx, "*:llm:local:endpoint").Result()
		for _, k := range keys {
			val, err = rdb.Get(ctx, k).Result()
			if err == nil && val != "" {
				ttl, _ = rdb.TTL(ctx, k).Result()
				foundKey = k
				break
			}
		}
	}

	if foundKey == "" || val == "" {
		// If Cloudflare Workers AI credentials are configured, report Cloudflare AI as ONLINE!
		if m.cfg.CFAccountID != "" && m.cfg.CFAPIToken != "" {
			maskedAcc := m.cfg.CFAccountID
			if len(maskedAcc) > 8 {
				maskedAcc = maskedAcc[:6] + "..."
			}
			return &models.AIWorkerStatus{
				Online:          true,
				URL:             fmt.Sprintf("Cloudflare Workers AI (%s)", maskedAcc),
				Model:           "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
				APIKeyMasked:    "••••••••",
				Timestamp:       time.Now().Unix(),
				TTL:             86400,
				LastSeenSeconds: 0,
			}, &WorkerPayload{
				URL:   fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/ai", m.cfg.CFAccountID),
				Model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
			}, nil
		}

		return &models.AIWorkerStatus{
			Online: false,
			Model:  "Qwen/Qwen2.5-14B-Instruct",
		}, nil, nil
	}

	var payload WorkerPayload
	if err := json.Unmarshal([]byte(val), &payload); err != nil {
		return &models.AIWorkerStatus{
			Online: false,
			Model:  "Qwen/Qwen2.5-14B-Instruct",
		}, nil, nil
	}

	if payload.APIKey == "" && payload.Key != "" {
		payload.APIKey = payload.Key
	}
	if payload.APIKey == "" {
		if envKey := os.Getenv("AI_UPSTREAM_KEY"); envKey != "" {
			payload.APIKey = envKey
		}
	}

	maskedKey := ""
	if len(payload.APIKey) > 8 {
		maskedKey = fmt.Sprintf("%s...%s", payload.APIKey[:4], payload.APIKey[len(payload.APIKey)-4:])
	} else if payload.APIKey != "" {
		maskedKey = "••••••••"
	}

	ttlSec := int64(ttl.Seconds())
	if ttl < 0 {
		ttlSec = int64(ttl)
	}

	lastSeen := int64(0)
	if payload.TS > 0 {
		lastSeen = time.Now().Unix() - payload.TS
		if lastSeen < 0 {
			lastSeen = 0
		}
	}

	status := &models.AIWorkerStatus{
		Online:          true,
		URL:             payload.URL,
		Model:           payload.Model,
		APIKeyMasked:    maskedKey,
		Timestamp:       payload.TS,
		TTL:             ttlSec,
		LastSeenSeconds: lastSeen,
	}

	return status, &payload, nil
}

// ProxyChatCompletions forwards OpenAI-compatible completions request to the active Colab worker with Tool & Tenant validation
func (m *AIManager) ProxyChatCompletions(c *fiber.Ctx) error {
	// 1. Authenticate Request
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

	valid, keyInfo, err := m.ValidateKeyForService(c.Context(), rawToken, "chat")
	if err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": fiber.Map{
				"message": err.Error(),
				"type":    "permission_denied",
				"code":    "access_denied",
			},
		})
	}
	if !valid || keyInfo == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": fiber.Map{
				"message": "Chave de API do VPSQL inválida ou revogada.",
				"type":    "authentication_error",
				"code":    "invalid_api_key",
			},
		})
	}

	// 2. Resolve Upstream Provider (Colab GPU Worker or Cloudflare Workers AI)
	var targetEndpoint string
	var authHeaderVal string
	var defaultModel string

	_, payload, _ := m.GetWorkerStatus(c.Context())

	if payload != nil && payload.URL != "" && !strings.Contains(payload.URL, "cloudflare.com") {
		// Active local/Colab GPU worker has priority for local tool calling
		targetEndpoint = fmt.Sprintf("%s/v1/chat/completions", strings.TrimRight(payload.URL, "/"))
		if payload.APIKey != "" {
			authHeaderVal = "Bearer " + payload.APIKey
		}
		defaultModel = payload.Model
	} else if m.cfg.CFAccountID != "" && m.cfg.CFAPIToken != "" {
		// Cloudflare Workers AI
		targetEndpoint = fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/ai/v1/chat/completions", m.cfg.CFAccountID)
		authHeaderVal = "Bearer " + m.cfg.CFAPIToken
		defaultModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
	} else {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": fiber.Map{
				"message": "Nenhum provedor de IA disponível. Configure o Cloudflare AI no Dokploy (CF_ACCOUNT_ID e CF_API_TOKEN) ou inicie um worker local no Colab.",
				"type":    "worker_offline_error",
				"code":    "service_unavailable",
			},
		})
	}

	// 3. Inspect body for Tool Calling permissions (Tenant / Tool Gating)
	bodyBytes := c.Body()
	var bodyMap map[string]any
	isStream := false
	if err := json.Unmarshal(bodyBytes, &bodyMap); err == nil {
		if s, ok := bodyMap["stream"].(bool); ok && s {
			isStream = true
		}

		// Enforce allowed tools if key has restrictions
		if rawTools, ok := bodyMap["tools"].([]any); ok && len(rawTools) > 0 {
			hasWildcard := false
			for _, t := range keyInfo.AllowedTools {
				if t == "*" {
					hasWildcard = true
					break
				}
			}

			if !hasWildcard {
				for _, rawTool := range rawTools {
					toolMap, ok := rawTool.(map[string]any)
					if !ok {
						continue
					}
					fnMap, ok := toolMap["function"].(map[string]any)
					if !ok {
						continue
					}
					fnName, _ := fnMap["name"].(string)

					allowed := false
					for _, allowedTool := range keyInfo.AllowedTools {
						if allowedTool == fnName {
							allowed = true
							break
						}
					}

					if !allowed {
						return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
							"error": fiber.Map{
								"message": fmt.Sprintf("A chave '%s' (Tenant: '%s') não possui permissão para acionar a ferramenta '%s'. Ferramentas permitidas: %v", keyInfo.Name, keyInfo.TenantID, fnName, keyInfo.AllowedTools),
								"type":    "permission_denied",
								"code":    "tool_not_allowed",
							},
						})
					}
				}
			}
		}

		// If model is missing, generic ("qwen"/"default"), or invalid Cloudflare slug, inject the active upstream model
		modelVal, _ := bodyMap["model"].(string)
		if strings.Contains(targetEndpoint, "cloudflare.com") {
			if modelVal == "" || modelVal == "default" || modelVal == "qwen" ||
				modelVal == "@cf/meta/llama-3.3-70b-instruct" || !strings.HasPrefix(modelVal, "@cf/") {
				bodyMap["model"] = defaultModel
				bodyBytes, _ = json.Marshal(bodyMap)
			}
		} else {
			if modelVal == "" || modelVal == "default" || modelVal == "qwen" {
				bodyMap["model"] = defaultModel
				bodyBytes, _ = json.Marshal(bodyMap)
			}
		}
	}

	// 4. Prepare Forwarding Request
	httpReq, err := http.NewRequestWithContext(c.Context(), "POST", targetEndpoint, strings.NewReader(string(bodyBytes)))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if authHeaderVal != "" {
		httpReq.Header.Set("Authorization", authHeaderVal)
	}
	httpReq.Header.Set("User-Agent", "VPSQL-AI-Gateway/0.5.0")

	// 5. Handle Streaming SSE vs Non-Streaming
	if isStream {
		resp, err := m.httpClient.Do(httpReq)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
				"error": fmt.Sprintf("Failed to connect to worker tunnel: %v", err),
			})
		}

		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache")
		c.Set("Connection", "keep-alive")
		c.Set("Transfer-Encoding", "chunked")
		c.Set("X-Accel-Buffering", "no")
		c.Status(resp.StatusCode)

		c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
			defer resp.Body.Close()
			buf := make([]byte, 1024)
			for {
				n, readErr := resp.Body.Read(buf)
				if n > 0 {
					_, _ = w.Write(buf[:n])
					_ = w.Flush()
				}
				if readErr != nil {
					break
				}
			}
		})
		return nil
	}

	// Non-streaming execution
	resp, err := m.httpClient.Do(httpReq)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to communicate with AI worker: %v", err),
		})
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read response from AI worker",
		})
	}

	log.Printf("[VPSQL-AI] Completed request for key=%s tenant=%s model=%s status=%d", keyInfo.Name, keyInfo.TenantID, defaultModel, resp.StatusCode)
	c.Status(resp.StatusCode)
	c.Set("Content-Type", "application/json")
	return c.Send(respBytes)
}

// ListModels returns OpenAI-compatible models list
func (m *AIManager) ListModels(c *fiber.Ctx) error {
	status, payload, _ := m.GetWorkerStatus(c.Context())

	currentModel := "Qwen/Qwen2.5-14B-Instruct"
	if payload != nil && payload.Model != "" {
		currentModel = payload.Model
	}

	return c.JSON(fiber.Map{
		"object": "list",
		"data": []fiber.Map{
			{
				"id":       currentModel,
				"object":   "model",
				"created":  time.Now().Unix(),
				"owned_by": "vpsql-ephemeral",
				"status":   status.Online,
			},
			{
				"id":       "qwen",
				"object":   "model",
				"created":  time.Now().Unix(),
				"owned_by": "vpsql-alias",
				"status":   status.Online,
			},
		},
	})
}

// GenerateImage invokes Cloudflare Workers AI FLUX/SDXL model, saves the result to the Dokploy volume, and returns OpenAI-compatible JSON
func (m *AIManager) GenerateImage(ctx context.Context, rawKey string, req models.ImageGenerationRequest) (*models.ImageGenerationResponse, error) {
	if strings.TrimSpace(req.Prompt) == "" {
		return nil, fmt.Errorf("o campo 'prompt' é obrigatório")
	}

	// 1. Validate key with image service scope
	valid, keyInfo, err := m.ValidateKeyForService(ctx, rawKey, "images")
	if err != nil {
		return nil, err
	}
	if !valid || keyInfo == nil {
		return nil, fmt.Errorf("chave de API inválida ou revogada")
	}

	// 2. Check Cloudflare Credentials
	cfAccount := strings.TrimSpace(m.cfg.CFAccountID)
	cfToken := strings.TrimSpace(m.cfg.CFAPIToken)
	if cfAccount == "" || cfToken == "" {
		return nil, fmt.Errorf("Cloudflare AI não configurado no Dokploy. Defina CF_ACCOUNT_ID e CF_API_TOKEN nas variáveis de ambiente da aplicação")
	}

	// 3. Choose Model
	model := "@cf/black-forest-labs/flux-1-schnell"
	steps := 4
	if req.Model == "sdxl" || strings.Contains(req.Model, "stable-diffusion") {
		model = "@cf/stabilityai/stable-diffusion-xl-base-1.0"
		steps = 20
	}
	if req.Steps > 0 {
		steps = req.Steps
	}

	// 4. Request Cloudflare Workers AI
	cfURL := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/ai/run/%s", cfAccount, model)
	bodyData := map[string]any{
		"prompt": req.Prompt,
		"steps":  steps,
	}
	payloadBytes, _ := json.Marshal(bodyData)

	httpReq, err := http.NewRequestWithContext(ctx, "POST", cfURL, bytes.NewBuffer(payloadBytes))
	if err != nil {
		return nil, fmt.Errorf("falha ao criar requisição para Cloudflare: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+cfToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("erro de rede ao chamar Cloudflare Workers AI: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Cloudflare AI retornou status %d: %s", resp.StatusCode, string(errBody))
	}

	// 5. Read image bytes (handle JSON or binary stream)
	var imgBytes []byte
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "application/json") {
		var cfResp struct {
			Success bool `json:"success"`
			Result  struct {
				Image string `json:"image"`
			} `json:"result"`
			Errors []any `json:"errors"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&cfResp); err != nil {
			return nil, fmt.Errorf("falha ao decodificar JSON do Cloudflare: %w", err)
		}
		if cfResp.Result.Image == "" {
			return nil, fmt.Errorf("nenhuma imagem retornada pelo Cloudflare Workers AI")
		}
		decoded, err := base64.StdEncoding.DecodeString(cfResp.Result.Image)
		if err != nil {
			return nil, fmt.Errorf("falha ao decodificar base64 da imagem: %w", err)
		}
		imgBytes = decoded
	} else {
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("falha ao ler bytes da imagem: %w", err)
		}
		imgBytes = raw
	}

	if len(imgBytes) == 0 {
		return nil, fmt.Errorf("imagem vazia gerada pelo modelo")
	}

	// 6. Save image to Dokploy mapped volume
	imagesDir := m.cfg.AIImagesDir
	if imagesDir == "" {
		imagesDir = "/data/images"
	}
	_ = os.MkdirAll(imagesDir, 0755)

	u := uuid.New()
	imageID := fmt.Sprintf("img_%s.png", hex.EncodeToString(u[:8]))
	targetPath := filepath.Join(imagesDir, imageID)
	if err := os.WriteFile(targetPath, imgBytes, 0644); err != nil {
		return nil, fmt.Errorf("falha ao salvar imagem no volume do VPSQL (%s): %w", targetPath, err)
	}

	// 7. Format Public URL
	baseURL := strings.TrimRight(m.cfg.AIImagesPublicBase, "/")
	if baseURL == "" {
		baseURL = "https://vpsql.example.com"
	}
	publicURL := fmt.Sprintf("%s/v1/ai/images/view/%s", baseURL, imageID)

	item := models.ImageData{
		URL:           publicURL,
		RevisedPrompt: req.Prompt,
	}
	if req.ResponseFormat == "b64_json" {
		item.B64JSON = base64.StdEncoding.EncodeToString(imgBytes)
	}

	log.Printf("[VPSQL-AI] Image generated successfully for key=%s id=%s path=%s", keyInfo.Name, imageID, targetPath)
	return &models.ImageGenerationResponse{
		Created: time.Now().Unix(),
		Data:    []models.ImageData{item},
	}, nil
}

