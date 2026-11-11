package models

import "time"

type Project struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	ProjectGroup       string    `json:"project"`
	DBName             string    `json:"db_name"`
	AdminRole          string    `json:"admin_role"`
	ReadonlyRole       string    `json:"readonly_role"`
	AdminPassword      string    `json:"admin_password,omitempty"`
	ReadonlyPassword   string    `json:"readonly_password,omitempty"`
	Status             string    `json:"status"` // running, idle, provisioning
	Size               string    `json:"size"`
	Connections        string    `json:"conns"`
	Owner              string    `json:"owner"`
	Extensions         []string  `json:"extensions"`
	CreatedAt          time.Time `json:"created_at"`
	CreatedDisplay     string    `json:"created"`
	AdminURI           string    `json:"admin_uri"`
	ReadonlyURI        string    `json:"readonly_uri"`
	AdminPoolerURI     string    `json:"admin_pooler_uri"`
	ReadonlyPoolerURI  string    `json:"readonly_pooler_uri"`
}

type CreateProjectRequest struct {
	Name       string   `json:"name"`
	Project    string   `json:"project"`
	Extensions []string `json:"extensions"`
}

type RotateRoleRequest struct {
	Role                 string `json:"role"` // "admin", "readonly", "all"
	TerminateConnections bool   `json:"terminate_connections"`
}

type RotateRoleResponse struct {
	DBName                         string   `json:"db_name"`
	RotatedRoles                   []string `json:"rotated_roles"`
	AdminPassword                  string   `json:"admin_password,omitempty"`
	ReadonlyPassword               string   `json:"readonly_password,omitempty"`
	AdminConnectionString          string   `json:"admin_connection_string,omitempty"`
	ReadonlyConnectionString       string   `json:"readonly_connection_string,omitempty"`
	AdminPoolerConnectionString    string   `json:"admin_pooler_connection_string,omitempty"`
	ReadonlyPoolerConnectionString string   `json:"readonly_pooler_connection_string,omitempty"`
	TerminatedSessions             int      `json:"terminated_sessions"`
	RotatedAt                      string   `json:"rotated_at"`
}

type RotateAllRequest struct {
	Scope                string `json:"scope"` // "all" or project_group
	TerminateConnections bool   `json:"terminate_connections"`
}

type RotateAllResponse struct {
	Message            string   `json:"message"`
	DatabasesRotated   int      `json:"databases_rotated"`
	RedisRotated       int      `json:"redis_rotated"`
	BucketsRotated     int      `json:"buckets_rotated"`
	AIKeysRotated      int      `json:"ai_keys_rotated"`
	TerminatedSessions int      `json:"terminated_sessions"`
	RotatedResources   []string `json:"rotated_resources"`
}

type BranchProjectRequest struct {
	Name string `json:"name"`
}

type CreateProjectResponse struct {
	Project                      Project `json:"project"`
	AdminConnectionString        string  `json:"admin_connection_string"`
	ReadonlyConnectionString     string  `json:"readonly_connection_string"`
	AdminPoolerConnectionString  string  `json:"admin_pooler_connection_string"`
	ReadonlyPoolerConnectionString string `json:"readonly_pooler_connection_string"`
}

type ColumnSchema struct {
	Name       string `json:"name"`
	DataType   string `json:"type"`
	IsNullable bool   `json:"is_nullable"`
	Flag       string `json:"flag"` // PK, FK, UNIQ, ENUM, IDX, GIN, ""
	Color      string `json:"color,omitempty"`
}

type TableSchema struct {
	Name    string         `json:"name"`
	Rows    string         `json:"rows"`
	Columns []ColumnSchema `json:"cols"`
}

type SchemaResponse struct {
	Database string        `json:"database"`
	Schema   string        `json:"schema"`
	Tables   []TableSchema `json:"tables"`
}

type QueryRequest struct {
	Query string `json:"query"`
}

type QueryResponse struct {
	Columns    []string         `json:"columns"`
	Rows       []map[string]any `json:"rows"`
	RowCount   int64            `json:"row_count"`
	DurationMs float64          `json:"duration_ms"`
}

type RoleItem struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"` // owner, read-only
	DB        string `json:"db"`
	Grants    string `json:"grants"`
	Rotated   string `json:"rotated"`
	URI       string `json:"uri"`
	Secret    string `json:"secret"`
	Border    string `json:"border,omitempty"`
	BG        string `json:"bg,omitempty"`
	FG        string `json:"fg,omitempty"`
	CopyLabel string `json:"copyLabel,omitempty"`
}

type ActivityItem struct {
	ID     int    `json:"id"`
	Action string `json:"action"`
	Target string `json:"target"`
	Via    string `json:"via"`
	Color  string `json:"color"`
	Time   string `json:"time"`
}

type Meter struct {
	Label  string `json:"label"`
	Value  string `json:"value"`
	Pct    string `json:"pct"`
	Color  string `json:"color"`
	Detail string `json:"detail"`
}

type NodeMetrics struct {
	NodeHost         string            `json:"node_host"`
	PostgresVersion  string            `json:"postgres_version"`
	TotalDatabases   string            `json:"total_databases"`
	TotalConnections string            `json:"total_connections"`
	TotalDisk        string            `json:"total_disk"`
	P99Latency       string            `json:"p99_latency"`
	Meters           []Meter           `json:"meters"`
	Config           map[string]string `json:"config"`
	ControlPlane     map[string]string `json:"control_plane"`
}

type LogItem struct {
	Time  string `json:"time"`
	Level string `json:"level"`
	Msg   string `json:"msg"`
	Color string `json:"color"`
}

type LoginRequest struct {
	Endpoint string `json:"endpoint"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
	Email string `json:"email"`
}

type RedisInstance struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	ProjectGroup   string    `json:"project_group"`
	Username       string    `json:"username"`
	Password       string    `json:"password,omitempty"`
	KeyPrefix      string    `json:"key_prefix"`
	Status         string    `json:"status"`
	KeyCount       int64     `json:"key_count"`
	MemoryUsage    string    `json:"memory_usage"`
	URI            string    `json:"uri"`
	TLSURI         string    `json:"tls_uri,omitempty"`
	CLICommand     string    `json:"cli_command"`
	Host           string    `json:"host,omitempty"`
	Port           int       `json:"port,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	CreatedDisplay string    `json:"created"`
}

type CreateRedisRequest struct {
	Name         string `json:"name"`
	ProjectGroup string `json:"project_group,omitempty"`
}

type CreateRedisResponse struct {
	Instance            RedisInstance `json:"instance"`
	ConnectionString    string        `json:"connection_string"`
	TLSConnectionString string        `json:"tls_connection_string,omitempty"`
	CLICommand          string        `json:"cli_command"`
}

type RedisKeyItem struct {
	Key      string `json:"key"`
	CleanKey string `json:"clean_key"`
	Type     string `json:"type"`
	TTL      int64  `json:"ttl"`
	Value    any    `json:"value,omitempty"`
	Size     int64  `json:"size,omitempty"`
}

type RedisSetKeyRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	TTL   int    `json:"ttl,omitempty"`
}

type RedisMetrics struct {
	RedisVersion     string  `json:"redis_version"`
	UsedMemory       string  `json:"used_memory"`
	UsedMemoryPeak   string  `json:"used_memory_peak"`
	MaxMemory        string  `json:"max_memory"`
	ConnectedClients int     `json:"connected_clients"`
	TotalKeys        int64   `json:"total_keys"`
	OpsPerSec        int64   `json:"ops_per_sec"`
	HitRatePct       float64 `json:"hit_rate_pct"`
	UptimeDays       int     `json:"uptime_days"`
	Status           string  `json:"status"`
}

type AIKey struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	KeyHash         string     `json:"-"`
	KeyPrefix       string     `json:"key_prefix"`
	RawKey          string     `json:"raw_key,omitempty"`
	TenantID        string     `json:"tenant_id"`
	ProjectGroup    string     `json:"project_group"`
	AllowedTools    []string   `json:"allowed_tools"`
	AllowedServices []string   `json:"allowed_services"`
	IsActive        bool       `json:"is_active"`
	RateLimitRPM    int        `json:"rate_limit_rpm"`
	TotalRequests   int64      `json:"total_requests"`
	LastUsedAt      *time.Time `json:"last_used_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

type CreateAIKeyRequest struct {
	Name            string   `json:"name"`
	TenantID        string   `json:"tenant_id,omitempty"`
	ProjectGroup    string   `json:"project_group,omitempty"`
	AllowedTools    []string `json:"allowed_tools,omitempty"`
	AllowedServices []string `json:"allowed_services,omitempty"`
	RateLimitRPM    int      `json:"rate_limit_rpm,omitempty"`
}

type UpdateAIKeyRequest struct {
	Name            string    `json:"name,omitempty"`
	TenantID        string    `json:"tenant_id,omitempty"`
	AllowedTools    *[]string `json:"allowed_tools,omitempty"`
	AllowedServices *[]string `json:"allowed_services,omitempty"`
	RateLimitRPM    int       `json:"rate_limit_rpm,omitempty"`
	IsActive        *bool     `json:"is_active,omitempty"`
}

type AIWorkerStatus struct {
	Online          bool   `json:"online"`
	URL             string `json:"url,omitempty"`
	Model           string `json:"model,omitempty"`
	APIKeyMasked    string `json:"api_key_masked,omitempty"`
	Timestamp       int64  `json:"timestamp,omitempty"`
	TTL             int64  `json:"ttl,omitempty"`
	LastSeenSeconds int64  `json:"last_seen_seconds,omitempty"`
}

// Image Generation Models (OpenAI Standard Format)
type ImageGenerationRequest struct {
	Prompt         string `json:"prompt"`
	Model          string `json:"model,omitempty"`           // "flux" or "@cf/black-forest-labs/flux-1-schnell" or "sdxl"
	Steps          int    `json:"steps,omitempty"`           // default 4 for flux, 20 for sdxl
	ResponseFormat string `json:"response_format,omitempty"` // "url" (default) or "b64_json"
	Size           string `json:"size,omitempty"`            // "1024x1024", etc.
}

type ImageData struct {
	URL           string `json:"url,omitempty"`
	B64JSON       string `json:"b64_json,omitempty"`
	RevisedPrompt string `json:"revised_prompt,omitempty"`
}

type ImageGenerationResponse struct {
	Created int64       `json:"created"`
	Data    []ImageData `json:"data"`
}

// Backup & Snapshot Models
type BackupItem struct {
	Filename         string    `json:"filename"`
	Scope            string    `json:"scope"`
	SizeBytes        int64     `json:"size_bytes"`
	SizeFormatted    string    `json:"size_formatted"`
	CreatedAt        time.Time `json:"created_at"`
	CreatedAtDisplay string    `json:"created_at_display"`
	AgeDays          float64   `json:"age_days"`
	ExpiresInDays    int       `json:"expires_in_days"`
	Trigger          string    `json:"trigger"`       // "scheduler" | "manual"
	Status           string    `json:"status"`        // "completed" | "failed"
	RemoteStatus     string    `json:"remote_status"` // "local_only" | "synced" | "disabled"
	Notes            string    `json:"notes,omitempty"`
}

type CreateBackupRequest struct {
	Scope string `json:"scope"` // "all" or database name
	Notes string `json:"notes,omitempty"`
}

type BackupConfigResponse struct {
	BackupDir          string       `json:"backup_dir"`
	RetentionDays      int          `json:"retention_days"`
	ScheduleHour       int          `json:"schedule_hour"`
	ScheduleDisplay    string       `json:"schedule_display"`
	TotalBackups       int          `json:"total_backups"`
	TotalSizeBytes     int64        `json:"total_size_bytes"`
	TotalSizeFormatted string       `json:"total_size_formatted"`
	S3Config           S3ConfigInfo `json:"s3_config"`
}

type S3ConfigInfo struct {
	Enabled         bool   `json:"enabled"`
	Endpoint        string `json:"endpoint"`
	Bucket          string `json:"bucket"`
	Region          string `json:"region"`
	AccessKeyMasked string `json:"access_key_masked"`
	Status          string `json:"status"` // "ready_plug_and_play", "connected", "disabled"
}

// Storage (S3-Compliant Static Buckets) Models
type StorageBucket struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	ProjectGroup       string    `json:"project_group"`
	AccessKey          string    `json:"access_key"`
	SecretKey          string    `json:"secret_key,omitempty"`
	IsPublic           bool      `json:"is_public"`
	Status             string    `json:"status"` // "active"
	SizeBytes          int64     `json:"size_bytes"`
	SizeFormatted      string    `json:"size_formatted"`
	ObjectCount        int64     `json:"object_count"`
	Endpoint           string    `json:"endpoint"`
	S3URI              string    `json:"s3_uri"`
	PublicURLBase      string    `json:"public_url_base"`
	EnvSnippet         string    `json:"env_snippet"`
	CreatedAt          time.Time `json:"created_at"`
	CreatedDisplay     string    `json:"created"`
}

type CreateBucketRequest struct {
	Name         string `json:"name"`
	ProjectGroup string `json:"project_group,omitempty"`
	IsPublic     *bool  `json:"is_public,omitempty"`
}

type UpdateBucketRequest struct {
	ProjectGroup *string `json:"project_group,omitempty"`
	IsPublic     *bool   `json:"is_public,omitempty"`
}

type CreateBucketResponse struct {
	Bucket           StorageBucket `json:"bucket"`
	Endpoint         string        `json:"endpoint"`
	AccessKeyID      string        `json:"access_key_id"`
	SecretAccessKey  string        `json:"secret_access_key"`
	PublicURL        string        `json:"public_url"`
	EnvSnippet       string        `json:"env_snippet"`
}

type StorageObject struct {
	ID             string    `json:"id"`
	BucketName     string    `json:"bucket_name"`
	Key            string    `json:"key"`
	SizeBytes      int64     `json:"size_bytes"`
	SizeFormatted  string    `json:"size_formatted"`
	ContentType    string    `json:"content_type"`
	ETag           string    `json:"etag"`
	IsPublic       bool      `json:"is_public"`
	PublicURL      string    `json:"public_url"`
	CreatedAt      time.Time `json:"created_at"`
	CreatedDisplay string    `json:"created"`
}

type ListObjectsResponse struct {
	Bucket     string          `json:"bucket"`
	Prefix     string          `json:"prefix"`
	Objects    []StorageObject `json:"objects"`
	TotalCount int64           `json:"total_count"`
	TotalBytes int64           `json:"total_bytes"`
}

type StorageMetrics struct {
	TotalBuckets       int     `json:"total_buckets"`
	TotalObjects       int64   `json:"total_objects"`
	TotalSizeBytes     int64   `json:"total_size_bytes"`
	TotalSizeFormatted string  `json:"total_size_formatted"`
	StorageDir         string  `json:"storage_dir"`
	PublicBaseURL      string  `json:"public_base_url"`
}

// Grouped Project Models for unified multi-resource management
type GroupedProject struct {
	ID             string          `json:"id,omitempty"`
	Name           string          `json:"name"`
	Description    string          `json:"description,omitempty"`
	Color          string          `json:"color,omitempty"`
	Databases      []Project       `json:"databases"`
	Redis          []RedisInstance `json:"redis"`
	Buckets        []StorageBucket `json:"buckets"`
	AIKeys         []AIKey         `json:"ai_keys"`
	TotalResources int             `json:"total_resources"`
}

type GroupedResourcesResponse struct {
	Projects       []GroupedProject `json:"projects"`
	TotalProjects  int              `json:"total_projects"`
	TotalResources int              `json:"total_resources"`
}

type CreateProjectGroupRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Color       string `json:"color,omitempty"`
}

type AttachResourceRequest struct {
	ResourceType string `json:"resource_type"` // "database", "redis", "storage", "ai"
	ResourceID   string `json:"resource_id"`   // Name or ID of the resource
}



