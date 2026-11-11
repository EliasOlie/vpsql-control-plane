package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port             int
	PostgresHost     string
	PostgresPort     int
	PostgresUser     string
	PostgresPassword string
	PostgresDB       string
	PostgresSSLMode  string

	PgBouncerHost    string
	PgBouncerPort    int

	PublicHost       string
	PublicPort       int
	PublicDirectPort int

	RedisHost        string
	RedisPort        int
	RedisPassword    string
	PublicRedisPort  int
	PublicRedisTLS   bool

	NodeHost           string
	AdminToken         string

	CFAccountID        string
	CFAPIToken         string
	AIImagesDir        string
	AIImagesPublicBase string

	AuthServiceURL string
	AuthMasterKey  string

	BackupDir           string
	BackupRetentionDays int
	BackupScheduleHour  int

	// S3 Storage (Persistent static files volume)
	StorageDir        string
	StoragePublicBase string

	// S3 / R2 Plug & Play
	S3Enabled        bool
	S3Endpoint       string
	S3Bucket         string
	S3Region         string
	S3AccessKey      string
	S3SecretKey      string
	S3ForcePathStyle bool
}

func Load() *Config {
	return &Config{
		Port:             getEnvAsInt("PORT", 8080),
		PostgresHost:     getEnv("POSTGRES_HOST", "localhost"),
		PostgresPort:     getEnvAsInt("POSTGRES_PORT", 5432),
		PostgresUser:     getEnv("POSTGRES_USER", "postgres"),
		PostgresPassword: getEnv("POSTGRES_PASSWORD", "postgres"),
		PostgresDB:       getEnv("POSTGRES_DB", "postgres"),
		PostgresSSLMode:  getEnv("POSTGRES_SSLMODE", "disable"),

		PgBouncerHost:    getEnv("PGBOUNCER_HOST", "localhost"),
		PgBouncerPort:    getEnvAsInt("PGBOUNCER_PORT", 6432),

		PublicHost:       getEnv("PUBLIC_HOST", "db.example.com"),
		PublicPort:       getEnvAsInt("PUBLIC_PORT", 6432),
		PublicDirectPort: getEnvAsInt("PUBLIC_DIRECT_PORT", 5434),

		RedisHost:        getEnv("REDIS_HOST", "vpsql-redis"),
		RedisPort:        getEnvAsInt("REDIS_PORT", 6379),
		RedisPassword:    getEnv("REDIS_PASSWORD", "change-me"),
		PublicRedisPort:  getEnvAsInt("PUBLIC_REDIS_PORT", 6380),
		PublicRedisTLS:   getEnvAsBool("PUBLIC_REDIS_TLS", false),

		NodeHost:         getEnv("NODE_HOST", "db.example.com"),
		AdminToken:       getEnv("ADMIN_TOKEN", "change-me"),

		CFAccountID:        getEnvAny([]string{"CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"}, ""),
		CFAPIToken:         getEnvAny([]string{"CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"}, ""),
		AIImagesDir:        getEnv("AI_IMAGES_DIR", "/data/images"),
		AIImagesPublicBase: getEnv("AI_IMAGES_PUBLIC_BASE", "https://vpsql.example.com"),
		AuthServiceURL:     getEnv("AUTH_SERVICE_URL", "https://auth.example.com"),
		AuthMasterKey:      getEnv("ADMIN_MASTER_KEY", "eo_master_live_d84f912b7a0e44319c72e293817a0b6e"),

		BackupDir:           getEnv("BACKUP_DIR", "/data/backups"),
		BackupRetentionDays: getEnvAsInt("BACKUP_RETENTION_DAYS", 7),
		BackupScheduleHour:  getEnvAsInt("BACKUP_SCHEDULE_HOUR", 3),

		StorageDir:        getEnv("STORAGE_DIR", "/data/storage"),
		StoragePublicBase: getEnv("STORAGE_PUBLIC_BASE", "https://vpsql.example.com"),

		S3Enabled:        getEnvAsBool("S3_ENABLED", false),
		S3Endpoint:       getEnvAny([]string{"S3_ENDPOINT", "R2_ENDPOINT", "AWS_ENDPOINT"}, ""),
		S3Bucket:         getEnvAny([]string{"S3_BUCKET", "R2_BUCKET", "AWS_BUCKET"}, ""),
		S3Region:         getEnvAny([]string{"S3_REGION", "R2_REGION", "AWS_REGION"}, "auto"),
		S3AccessKey:      getEnvAny([]string{"S3_ACCESS_KEY", "R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"}, ""),
		S3SecretKey:      getEnvAny([]string{"S3_SECRET_KEY", "R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"}, ""),
		S3ForcePathStyle: getEnvAsBool("S3_FORCE_PATH_STYLE", true),
	}
}

func cleanVal(val string) string {
	trimmed := strings.TrimSpace(val)
	trimmed = strings.Trim(trimmed, "\"'")
	return strings.TrimSpace(trimmed)
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return cleanVal(val)
	}
	return fallback
}

func getEnvAny(keys []string, fallback string) string {
	for _, k := range keys {
		if val := os.Getenv(k); val != "" {
			return cleanVal(val)
		}
	}
	return fallback
}

func getEnvAsInt(key string, fallback int) int {
	valStr := os.Getenv(key)
	if valStr == "" {
		return fallback
	}
	val, err := strconv.Atoi(valStr)
	if err != nil {
		return fallback
	}
	return val
}

func getEnvAsBool(key string, fallback bool) bool {
	valStr := os.Getenv(key)
	if valStr == "" {
		return fallback
	}
	val, err := strconv.ParseBool(valStr)
	if err != nil {
		return fallback
	}
	return val
}
