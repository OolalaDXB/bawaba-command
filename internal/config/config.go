package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config is the top-level bawaba.yaml configuration.
type Config struct {
	Server   ServerConfig              `yaml:"server"`
	Database DatabaseConfig            `yaml:"database"`
	Agents   map[string]AgentConfig    `yaml:"agents"`
	Routing  RoutingConfig             `yaml:"routing"`
	Audit    AuditConfig               `yaml:"audit"`
	Signing  SigningConfig             `yaml:"signing"`
}

type ServerConfig struct {
	Port        int    `yaml:"port"`
	MetricsPort int    `yaml:"metrics_port"`
	LogLevel    string `yaml:"log_level"`
}

type DatabaseConfig struct {
	URL             string `yaml:"url"`
	MaxOpenConns    int    `yaml:"max_open_conns"`
	MaxIdleConns    int    `yaml:"max_idle_conns"`
	ConnMaxLifetime string `yaml:"conn_max_lifetime"`
}

type AgentConfig struct {
	Auth         string   `yaml:"auth"`
	AllowedTools []string `yaml:"allowed_tools"`
	DeniedTools  []string `yaml:"denied_tools"`
	PIIMode      string   `yaml:"pii_mode"`
	RateLimit    string   `yaml:"rate_limit"`
	MaxResults   int      `yaml:"max_results"`
}

type RoutingConfig struct {
	DefaultBackend string        `yaml:"default_backend"`
	Rules          []RoutingRule `yaml:"rules"`
}

type RoutingRule struct {
	Jurisdiction string   `yaml:"jurisdiction"`
	Backend      string   `yaml:"backend"`
	Compliance   []string `yaml:"compliance"`
}

type AuditConfig struct {
	MerkleWindowHours int           `yaml:"merkle_window_hours"`
	SIEMExport        SIEMConfig    `yaml:"siem_export"`
	RetentionDays     int           `yaml:"retention_days"`
}

type SIEMConfig struct {
	Format   string `yaml:"format"`
	Endpoint string `yaml:"endpoint"`
}

type SigningConfig struct {
	KeyPath string `yaml:"key_path"`
}

// Load reads and parses a bawaba.yaml configuration file.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: read %s: %w", path, err)
	}

	cfg := &Config{}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("config: parse %s: %w", path, err)
	}

	applyDefaults(cfg)

	if err := validate(cfg); err != nil {
		return nil, fmt.Errorf("config: validate: %w", err)
	}

	return cfg, nil
}

func applyDefaults(cfg *Config) {
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.MetricsPort == 0 {
		cfg.Server.MetricsPort = 9090
	}
	if cfg.Server.LogLevel == "" {
		cfg.Server.LogLevel = "info"
	}
	if cfg.Database.MaxOpenConns == 0 {
		cfg.Database.MaxOpenConns = 25
	}
	if cfg.Database.MaxIdleConns == 0 {
		cfg.Database.MaxIdleConns = 5
	}
	if cfg.Audit.MerkleWindowHours == 0 {
		cfg.Audit.MerkleWindowHours = 24
	}
	if cfg.Audit.RetentionDays == 0 {
		cfg.Audit.RetentionDays = 2555 // ~7 years
	}
	for name, agent := range cfg.Agents {
		if agent.PIIMode == "" {
			agent.PIIMode = "tokenize"
		}
		if agent.MaxResults == 0 {
			agent.MaxResults = 50
		}
		cfg.Agents[name] = agent
	}
}

func validate(cfg *Config) error {
	if cfg.Database.URL == "" {
		return fmt.Errorf("database.url is required")
	}
	for name, agent := range cfg.Agents {
		switch agent.Auth {
		case "api_key", "oauth2", "mtls":
			// valid
		default:
			return fmt.Errorf("agent %q: invalid auth method %q (must be api_key, oauth2, or mtls)", name, agent.Auth)
		}
		switch agent.PIIMode {
		case "tokenize", "mask", "none":
			// valid
		default:
			return fmt.Errorf("agent %q: invalid pii_mode %q", name, agent.PIIMode)
		}
	}
	return nil
}
