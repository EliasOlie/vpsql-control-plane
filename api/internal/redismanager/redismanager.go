package redismanager

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/vpsql/api/internal/config"
	"github.com/vpsql/api/internal/database"
	"github.com/vpsql/api/internal/models"
	"github.com/vpsql/api/internal/provisioner"
)

type RedisManager struct {
	cfg *config.Config
	db  *database.DBManager
	rdb *redis.Client
}

func New(cfg *config.Config, db *database.DBManager) *RedisManager {
	addr := fmt.Sprintf("%s:%d", cfg.RedisHost, cfg.RedisPort)
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: cfg.RedisPassword,
		DB:       0,
	})

	return &RedisManager{
		cfg: cfg,
		db:  db,
		rdb: rdb,
	}
}

func (m *RedisManager) Ping(ctx context.Context) error {
	if m.rdb == nil {
		return fmt.Errorf("redis client not initialized")
	}
	return m.rdb.Ping(ctx).Err()
}

func (m *RedisManager) Client() *redis.Client {
	return m.rdb
}

// Create provisions a new Redis tenant using Redis 7+ ACL
func (m *RedisManager) Create(ctx context.Context, req models.CreateRedisRequest) (*models.CreateRedisResponse, error) {
	rawName := strings.TrimSpace(req.Name)
	if rawName == "" {
		return nil, fmt.Errorf("redis instance name is required")
	}

	cleanBase := provisioner.SanitizeName(rawName)
	var username string
	if strings.HasPrefix(cleanBase, "app_") {
		username = cleanBase
	} else {
		username = "app_" + cleanBase
	}

	keyPrefix := fmt.Sprintf("%s:", username)
	password := provisioner.GenerateStrongPassword(24)

	projGroup := strings.TrimSpace(req.ProjectGroup)
	if projGroup == "" {
		projGroup = cleanBase
	}

	// 1. Create Redis ACL User
	// User is permitted all commands on keys matching "~<username>:*" and channels "&*" except dangerous commands
	err := m.rdb.Do(ctx, "ACL", "SETUSER", username, "on", ">"+password, "~"+keyPrefix+"*", "&*", "+@all", "-FLUSHALL", "-CONFIG", "-SHUTDOWN").Err()
	if err != nil {
		return nil, fmt.Errorf("failed to create redis ACL user: %w", err)
	}

	// 2. Record in PostgreSQL metadata
	adminDB := m.db.AdminDB()
	id := uuid.New().String()
	insertSQL := `
	INSERT INTO vpsql_redis (id, name, project_group, username, password, key_prefix, status, created_at, updated_at)
	VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
	`
	if _, err := adminDB.ExecContext(ctx, insertSQL, id, rawName, projGroup, username, password, keyPrefix, "running"); err != nil {
		return nil, fmt.Errorf("failed to save redis metadata: %w", err)
	}

	// 3. Log activity
	_, _ = adminDB.ExecContext(ctx,
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"redis.create", username, "API", "#FF5C5C",
	)

	instance := models.RedisInstance{
		ID:             id,
		Name:           rawName,
		ProjectGroup:   projGroup,
		Username:       username,
		Password:       password,
		KeyPrefix:      keyPrefix,
		Status:         "running",
		KeyCount:       0,
		MemoryUsage:    "0 B",
		CreatedAt:      time.Now(),
		CreatedDisplay: "just now",
	}
	m.populateURIs(&instance)

	return &models.CreateRedisResponse{
		Instance:            instance,
		ConnectionString:    instance.URI,
		TLSConnectionString: instance.TLSURI,
		CLICommand:          instance.CLICommand,
	}, nil
}

// Rotate regenerates the Redis ACL user password, updates metadata and disconnects existing clients
func (m *RedisManager) Rotate(ctx context.Context, identifier string) (*models.CreateRedisResponse, error) {
	adminDB := m.db.AdminDB()
	var (
		id, name, projectGroup, username, keyPrefix, status string
		createdAt time.Time
	)
	query := `
		SELECT id, name, COALESCE(project_group, 'default'), username, key_prefix, status, created_at
		FROM vpsql_redis
		WHERE id = $1 OR name = $1 OR username = $1
		LIMIT 1
	`
	err := adminDB.QueryRowContext(ctx, query, identifier).Scan(&id, &name, &projectGroup, &username, &keyPrefix, &status, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("redis instance '%s' not found", identifier)
		}
		return nil, fmt.Errorf("failed to query redis instance '%s': %w", identifier, err)
	}

	newPassword := provisioner.GenerateStrongPassword(24)

	// 1. Update Redis ACL user password with resetpass to remove old credentials
	err = m.rdb.Do(ctx, "ACL", "SETUSER", username, "on", "resetpass", ">"+newPassword, "~"+keyPrefix+"*", "&*", "+@all", "-FLUSHALL", "-CONFIG", "-SHUTDOWN").Err()
	if err != nil {
		return nil, fmt.Errorf("failed to update redis ACL password: %w", err)
	}

	// 2. Kill all active client connections for this user to invalidate leaked sessions
	_ = m.rdb.Do(ctx, "CLIENT", "KILL", "USER", username).Err()

	// 3. Update PostgreSQL metadata
	_, err = adminDB.ExecContext(ctx,
		"UPDATE vpsql_redis SET password = $1, rotated_at = NOW(), updated_at = NOW() WHERE id = $2",
		newPassword, id,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update redis metadata: %w", err)
	}

	// 4. Activity log
	_, _ = adminDB.ExecContext(ctx,
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"redis.rotate", username, "API", "#FFB020",
	)

	instance := models.RedisInstance{
		ID:             id,
		Name:           name,
		ProjectGroup:   projectGroup,
		Username:       username,
		Password:       newPassword,
		KeyPrefix:      keyPrefix,
		Status:         status,
		CreatedAt:      createdAt,
		CreatedDisplay: createdAt.Format("02 Jan 15:04"),
	}
	m.populateURIs(&instance)

	return &models.CreateRedisResponse{
		Instance:            instance,
		ConnectionString:    instance.URI,
		TLSConnectionString: instance.TLSURI,
		CLICommand:          instance.CLICommand,
	}, nil
}

func (m *RedisManager) populateURIs(item *models.RedisInstance) {
	publicHost := m.cfg.PublicHost
	if publicHost == "" {
		publicHost = "db.example.com"
	}
	port := m.cfg.PublicRedisPort
	if port <= 0 {
		port = 6379
	}

	item.Host = publicHost
	item.Port = port

	scheme := "redis"
	cliTLS := ""
	if m.cfg.PublicRedisTLS {
		scheme = "rediss"
		cliTLS = " --tls --insecure"
	}

	item.URI = fmt.Sprintf("%s://%s:%s@%s:%d", scheme, item.Username, item.Password, publicHost, port)
	item.TLSURI = fmt.Sprintf("rediss://%s:%s@%s:%d", item.Username, item.Password, publicHost, port)
	item.CLICommand = fmt.Sprintf("redis-cli%s -h %s -p %d --user %s -a %s", cliTLS, publicHost, port, item.Username, item.Password)
	item.CreatedDisplay = item.CreatedAt.Format("02 Jan 15:04")
}

// List returns all provisioned Redis tenant namespaces
func (m *RedisManager) List(ctx context.Context) ([]models.RedisInstance, error) {
	adminDB := m.db.AdminDB()
	rows, err := adminDB.QueryContext(ctx, `
		SELECT id, name, COALESCE(project_group, 'default'), username, password, key_prefix, status, created_at
		FROM vpsql_redis
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.RedisInstance
	for rows.Next() {
		var item models.RedisInstance
		if err := rows.Scan(&item.ID, &item.Name, &item.ProjectGroup, &item.Username, &item.Password, &item.KeyPrefix, &item.Status, &item.CreatedAt); err != nil {
			continue
		}

		m.populateURIs(&item)

		// Count keys matching key_prefix
		if m.rdb != nil {
			var count int64
			var cursor uint64
			for {
				var keys []string
				var nextCursor uint64
				keys, nextCursor, err = m.rdb.Scan(ctx, cursor, item.KeyPrefix+"*", 100).Result()
				if err == nil {
					count += int64(len(keys))
				}
				cursor = nextCursor
				if cursor == 0 || count > 5000 {
					break
				}
			}
			item.KeyCount = count
		}

		list = append(list, item)
	}

	if list == nil {
		list = []models.RedisInstance{}
	}
	return list, nil
}

// Get returns details for a specific Redis tenant
func (m *RedisManager) Get(ctx context.Context, identifier string) (*models.RedisInstance, error) {
	adminDB := m.db.AdminDB()
	var item models.RedisInstance
	err := adminDB.QueryRowContext(ctx, `
		SELECT id, name, COALESCE(project_group, 'default'), username, password, key_prefix, status, created_at
		FROM vpsql_redis
		WHERE id = $1 OR name = $1 OR username = $1
	`, identifier).Scan(&item.ID, &item.Name, &item.ProjectGroup, &item.Username, &item.Password, &item.KeyPrefix, &item.Status, &item.CreatedAt)

	if err != nil {
		return nil, fmt.Errorf("redis instance not found: %w", err)
	}

	m.populateURIs(&item)

	if m.rdb != nil {
		var count int64
		var cursor uint64
		for {
			var keys []string
			var nextCursor uint64
			keys, nextCursor, _ = m.rdb.Scan(ctx, cursor, item.KeyPrefix+"*", 100).Result()
			count += int64(len(keys))
			cursor = nextCursor
			if cursor == 0 || count > 5000 {
				break
			}
		}
		item.KeyCount = count
	}

	return &item, nil
}

// Delete drops the Redis ACL user and deletes its keys
func (m *RedisManager) Delete(ctx context.Context, identifier string) error {
	item, err := m.Get(ctx, identifier)
	if err != nil {
		return err
	}

	// 1. Delete all keys under tenant namespace
	if m.rdb != nil {
		var cursor uint64
		for {
			keys, nextCursor, err := m.rdb.Scan(ctx, cursor, item.KeyPrefix+"*", 250).Result()
			if err == nil && len(keys) > 0 {
				_ = m.rdb.Del(ctx, keys...).Err()
			}
			cursor = nextCursor
			if cursor == 0 {
				break
			}
		}
		// 2. Delete ACL user
		_ = m.rdb.Do(ctx, "ACL", "DELUSER", item.Username).Err()
	}

	// 3. Remove metadata
	adminDB := m.db.AdminDB()
	_, _ = adminDB.ExecContext(ctx, "DELETE FROM vpsql_redis WHERE id = $1", item.ID)

	// 4. Log activity
	_, _ = adminDB.ExecContext(ctx,
		"INSERT INTO vpsql_activity (action, target, via, color, created_at) VALUES ($1, $2, $3, $4, NOW())",
		"redis.drop", item.Username, "API", "#FF5C5C",
	)

	return nil
}

// ListKeys returns keys belonging to this tenant
func (m *RedisManager) ListKeys(ctx context.Context, identifier, pattern string, limit int) ([]models.RedisKeyItem, error) {
	item, err := m.Get(ctx, identifier)
	if err != nil {
		return nil, err
	}

	if limit <= 0 || limit > 200 {
		limit = 100
	}

	searchPattern := item.KeyPrefix + "*"
	if pattern != "" {
		searchPattern = item.KeyPrefix + strings.TrimPrefix(pattern, item.KeyPrefix)
	}

	var result []models.RedisKeyItem
	if m.rdb == nil {
		return result, nil
	}

	var cursor uint64
	var foundKeys []string
	for {
		keys, nextCursor, err := m.rdb.Scan(ctx, cursor, searchPattern, 100).Result()
		if err != nil {
			break
		}
		foundKeys = append(foundKeys, keys...)
		cursor = nextCursor
		if cursor == 0 || len(foundKeys) >= limit {
			break
		}
	}

	for _, fullKey := range foundKeys {
		kType, _ := m.rdb.Type(ctx, fullKey).Result()
		ttlDuration, _ := m.rdb.TTL(ctx, fullKey).Result()
		ttlSec := int64(ttlDuration.Seconds())
		if ttlDuration < 0 {
			ttlSec = int64(ttlDuration)
		}

		cleanKey := strings.TrimPrefix(fullKey, item.KeyPrefix)

		var valPreview any
		if kType == "string" {
			val, _ := m.rdb.Get(ctx, fullKey).Result()
			if len(val) > 100 {
				val = val[:100] + "..."
			}
			valPreview = val
		}

		result = append(result, models.RedisKeyItem{
			Key:      fullKey,
			CleanKey: cleanKey,
			Type:     kType,
			TTL:      ttlSec,
			Value:    valPreview,
		})
	}

	return result, nil
}

// GetKey returns the full untruncated details and value of a specific key
func (m *RedisManager) GetKey(ctx context.Context, identifier, keyName string) (*models.RedisKeyItem, error) {
	item, err := m.Get(ctx, identifier)
	if err != nil {
		return nil, err
	}

	if m.rdb == nil {
		return nil, fmt.Errorf("redis not initialized")
	}

	fullKey := item.KeyPrefix + strings.TrimPrefix(keyName, item.KeyPrefix)
	cleanKey := strings.TrimPrefix(fullKey, item.KeyPrefix)

	exists, err := m.rdb.Exists(ctx, fullKey).Result()
	if err != nil || exists == 0 {
		return nil, fmt.Errorf("key not found: %s", keyName)
	}

	kType, _ := m.rdb.Type(ctx, fullKey).Result()
	ttlDuration, _ := m.rdb.TTL(ctx, fullKey).Result()
	ttlSec := int64(ttlDuration.Seconds())
	if ttlDuration < 0 {
		ttlSec = int64(ttlDuration)
	}

	var val any
	switch kType {
	case "string":
		valStr, err := m.rdb.Get(ctx, fullKey).Result()
		if err == nil {
			val = valStr
		}
	case "hash":
		valHash, err := m.rdb.HGetAll(ctx, fullKey).Result()
		if err == nil {
			val = valHash
		}
	case "list":
		valList, err := m.rdb.LRange(ctx, fullKey, 0, 100).Result()
		if err == nil {
			val = valList
		}
	case "set":
		valSet, err := m.rdb.SMembers(ctx, fullKey).Result()
		if err == nil {
			val = valSet
		}
	case "zset":
		valZSet, err := m.rdb.ZRangeWithScores(ctx, fullKey, 0, 100).Result()
		if err == nil {
			val = valZSet
		}
	default:
		valStr, _ := m.rdb.Get(ctx, fullKey).Result()
		val = valStr
	}

	return &models.RedisKeyItem{
		Key:      fullKey,
		CleanKey: cleanKey,
		Type:     kType,
		TTL:      ttlSec,
		Value:    val,
	}, nil
}

// SetKey stores a key for this tenant
func (m *RedisManager) SetKey(ctx context.Context, identifier string, req models.RedisSetKeyRequest) error {
	item, err := m.Get(ctx, identifier)
	if err != nil {
		return err
	}

	cleanKey := strings.TrimSpace(req.Key)
	if cleanKey == "" {
		return fmt.Errorf("key name cannot be empty")
	}

	fullKey := item.KeyPrefix + strings.TrimPrefix(cleanKey, item.KeyPrefix)
	var ttl time.Duration
	if req.TTL > 0 {
		ttl = time.Duration(req.TTL) * time.Second
	}

	return m.rdb.Set(ctx, fullKey, req.Value, ttl).Err()
}

// DeleteKey removes a key for this tenant
func (m *RedisManager) DeleteKey(ctx context.Context, identifier, keyName string) error {
	item, err := m.Get(ctx, identifier)
	if err != nil {
		return err
	}

	fullKey := item.KeyPrefix + strings.TrimPrefix(keyName, item.KeyPrefix)
	return m.rdb.Del(ctx, fullKey).Err()
}

// FlushKeys deletes all keys for this tenant
func (m *RedisManager) FlushKeys(ctx context.Context, identifier string) (int64, error) {
	item, err := m.Get(ctx, identifier)
	if err != nil {
		return 0, err
	}

	var count int64
	var cursor uint64
	for {
		keys, nextCursor, err := m.rdb.Scan(ctx, cursor, item.KeyPrefix+"*", 250).Result()
		if err == nil && len(keys) > 0 {
			delCount, _ := m.rdb.Del(ctx, keys...).Result()
			count += delCount
		}
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
	return count, nil
}

// GetMetrics returns global Redis instance stats parsed from INFO
func (m *RedisManager) GetMetrics(ctx context.Context) (*models.RedisMetrics, error) {
	if m.rdb == nil {
		return nil, fmt.Errorf("redis not initialized")
	}

	infoStr, err := m.rdb.Info(ctx).Result()
	if err != nil {
		return nil, err
	}

	info := parseRedisInfo(infoStr)
	version := info["redis_version"]
	usedMem := info["used_memory_human"]
	usedMemPeak := info["used_memory_peak_human"]
	maxMem := info["maxmemory_human"]
	if maxMem == "0B" || maxMem == "" {
		maxMem = "512M (default)"
	}

	clients, _ := strconv.Atoi(info["connected_clients"])
	ops, _ := strconv.ParseInt(info["instantaneous_ops_per_sec"], 10, 64)
	uptimeDays, _ := strconv.Atoi(info["uptime_in_days"])

	hits, _ := strconv.ParseFloat(info["keyspace_hits"], 64)
	misses, _ := strconv.ParseFloat(info["keyspace_misses"], 64)
	var hitRate float64
	if (hits + misses) > 0 {
		hitRate = (hits / (hits + misses)) * 100
	}

	return &models.RedisMetrics{
		RedisVersion:     version,
		UsedMemory:       usedMem,
		UsedMemoryPeak:   usedMemPeak,
		MaxMemory:        maxMem,
		ConnectedClients: clients,
		OpsPerSec:        ops,
		HitRatePct:       hitRate,
		UptimeDays:       uptimeDays,
		Status:           "healthy",
	}, nil
}

func parseRedisInfo(raw string) map[string]string {
	result := make(map[string]string)
	lines := strings.Split(raw, "\n")
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "#") || !strings.Contains(l, ":") {
			continue
		}
		parts := strings.SplitN(l, ":", 2)
		if len(parts) == 2 {
			result[parts[0]] = parts[1]
		}
	}
	return result
}
