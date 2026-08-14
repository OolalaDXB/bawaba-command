package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config is the top-level bawaba.yaml configuration.
type Config struct {
	Server   ServerConfig           `yaml:"server"`
	Database DatabaseConfig         `yaml:"database"`
	Agents   map[string]AgentConfig `yaml:"agents"`
	Routing  RoutingConfig          `yaml:"routing"`
	Audit    AuditConfig            `yaml:"audit"`
	Signing  SigningConfig          `yaml:"signing"`
	Quotas   QuotaConfig            `yaml:"quotas"`
	SIEM     SIEMForwarderConfig    `yaml:"siem"`
}

// QuotaConfig controls per-agent call quotas.
type QuotaConfig struct {
	DefaultLimit int            `yaml:"default_limit"` // calls per period (default: 1000)
	Period       string         `yaml:"period"`        // duration string (default: "1h")
	Overrides    map[string]int `yaml:"overrides"`     // per-agent overrides
}

// SIEMForwarderConfig controls the SIEM event forwarding.
type SIEMForwarderConfig struct {
	Enabled  bool   `yaml:"enabled"`
	Type     string `yaml:"type"` // "webhook" or "noop"
	Endpoint string `yaml:"endpoint"`
	Token    string `yaml:"token"`
	Format   string `yaml:"format"` // "json"
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

// ConditionalRule is a REAL attribute-based policy rule (P1): it scopes a
// tool to an envelope of call-argument conditions. Inside the envelope →
// Effect; outside → the inverse, with the failed condition named in the
// decision. This is the honest version of "amount <= 10 000" — evaluated on
// the actual MCP call arguments, never simulated.
type ConditionalRule struct {
	Tool          string   `yaml:"tool" json:"tool"`
	Effect        string   `yaml:"effect" json:"effect"` // "allow" (P1 supports allow envelopes)
	AmountLTE     *float64 `yaml:"amount_lte" json:"amount_lte,omitempty"`
	Currencies    []string `yaml:"currencies" json:"currencies,omitempty"`
	Jurisdictions []string `yaml:"jurisdictions" json:"jurisdictions,omitempty"`
}

type AgentConfig struct {
	Auth             string            `yaml:"auth"`
	AllowedTools     []string          `yaml:"allowed_tools"`
	DeniedTools      []string          `yaml:"denied_tools"`
	PIIMode          string            `yaml:"pii_mode"`
	RateLimit        string            `yaml:"rate_limit"`
	MaxResults       int               `yaml:"max_results"`
	Jurisdiction     string            `yaml:"jurisdiction"`
	ConditionalRules []ConditionalRule `yaml:"conditional_rules" json:"conditional_rules,omitempty"`
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
	MerkleWindowHours int        `yaml:"merkle_window_hours"` // TODO P2: Merkle window
	SIEMExport        SIEMConfig `yaml:"siem_export"`
	RetentionDays     int        `yaml:"retention_days"`
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

	// Quota defaults
	if cfg.Quotas.DefaultLimit == 0 {
		cfg.Quotas.DefaultLimit = 1000
	}
	if cfg.Quotas.Period == "" {
		cfg.Quotas.Period = "1h"
	}
	if cfg.Quotas.Overrides == nil {
		cfg.Quotas.Overrides = map[string]int{}
	}

	// SIEM defaults
	if cfg.SIEM.Type == "" {
		cfg.SIEM.Type = "webhook"
	}
	if cfg.SIEM.Format == "" {
		cfg.SIEM.Format = "json"
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
