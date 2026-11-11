package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type CLIConfig struct {
	Endpoint string `json:"endpoint"`
	Token    string `json:"token"`
	Email    string `json:"email,omitempty"`
}

func GetConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".vpsql.json"
	}
	return filepath.Join(home, ".vpsql", "config.json")
}

func LoadConfig() (*CLIConfig, error) {
	cfg := &CLIConfig{
		Endpoint: "http://localhost:8080",
	}

	path := GetConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, nil
	}

	_ = json.Unmarshal(data, cfg)
	if cfg.Endpoint == "" {
		cfg.Endpoint = "http://localhost:8080"
	}
	return cfg, nil
}

func SaveConfig(cfg *CLIConfig) error {
	path := GetConfigPath()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}
