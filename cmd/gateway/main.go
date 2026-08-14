package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"

	"github.com/OolalaDXB/bawaba-command/internal/api"
	"github.com/OolalaDXB/bawaba-command/internal/audit"
	"github.com/OolalaDXB/bawaba-command/internal/auth"
	"github.com/OolalaDXB/bawaba-command/internal/config"
	"github.com/OolalaDXB/bawaba-command/internal/policy"
	"github.com/OolalaDXB/bawaba-command/internal/proxy"
	"github.com/OolalaDXB/bawaba-command/internal/ratelimit"
	"github.com/OolalaDXB/bawaba-command/internal/router"
	"github.com/OolalaDXB/bawaba-command/internal/siem"
	"github.com/OolalaDXB/bawaba-command/internal/tokenizer"
)

func main() {
	// Setup logger
	logLevel := envOrDefault("BAWABA_LOG_LEVEL", "info")
	var level slog.Level
	switch logLevel {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	logger.Info("starting bawaba gateway", "version", "0.1.0")

	// Load config
	configPath := envOrDefault("BAWABA_CONFIG_PATH", "./configs/bawaba.yaml")
	cfg, err := config.Load(configPath)
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Override DB URL from env if set
	if dbURL := os.Getenv("BAWABA_DB_URL"); dbURL != "" {
		cfg.Database.URL = dbURL
	}

	// Connect to PostgreSQL
	var db *sql.DB
	db, err = sql.Open("postgres", cfg.Database.URL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	db.SetMaxOpenConns(cfg.Database.MaxOpenConns)
	db.SetMaxIdleConns(cfg.Database.MaxIdleConns)

	// Retry DB connection
	for i := 0; i < 10; i++ {
		if err := db.Ping(); err == nil {
			logger.Info("database connected")
			break
		} else {
			logger.Warn("waiting for database", "attempt", i+1, "error", err)
			time.Sleep(2 * time.Second)
		}
	}
	if err := db.Ping(); err != nil {
		logger.Error("database connection failed after retries", "error", err)
		os.Exit(1)
	}

	// Init PII tokenizer vault
	tokenizer.InitVault(3600) // 1 hour TTL
	logger.Info("PII tokenizer vault initialized")

	// Init auth engine
	authEngine := auth.NewEngine()

	// Register agents from config
	for agentID, agentCfg := range cfg.Agents {
		if err := authEngine.RegisterAgent(agentID, "default", agentCfg.Auth); err != nil {
			logger.Error("failed to register agent", "agent", agentID, "error", err)
			os.Exit(1)
		}
		logger.Info("registered agent", "agent", agentID, "auth", agentCfg.Auth)
	}

	// Register API keys from environment
	// Format: BAWABA_AGENT_KEY_<AGENT_ID>=<key>
	for agentID := range cfg.Agents {
		envKey := fmt.Sprintf("BAWABA_AGENT_KEY_%s", agentID)
		if key := os.Getenv(envKey); key != "" {
			if err := authEngine.RegisterAPIKey(agentID, "default", key, nil); err != nil {
				logger.Error("failed to register API key", "agent", agentID, "error", err)
			}
		}
	}

	// Init policy engine
	policyEngine := policy.NewEngine(cfg.Agents)
	logger.Info("policy engine initialized")

	// Init rate limiter
	limiter := ratelimit.NewLimiter()
	for agentID, agentCfg := range cfg.Agents {
		if agentCfg.RateLimit != "" {
			rlCfg, err := ratelimit.ParseRateLimit(agentCfg.RateLimit)
			if err != nil {
				logger.Error("invalid rate limit", "agent", agentID, "error", err)
				continue
			}
			limiter.Configure(agentID, rlCfg.Limit, rlCfg.Window)
			logger.Info("rate limit configured", "agent", agentID, "limit", agentCfg.RateLimit)
		}
	}

	// Init anomaly detector
	anomaly := ratelimit.NewAnomalyDetector(20, 5*time.Minute)

	// Init audit trail
	sigKeyPath := envOrDefault("BAWABA_SIGNING_KEY_PATH", cfg.Signing.KeyPath)
	trail, err := audit.NewTrail(db, sigKeyPath)
	if err != nil {
		logger.Error("failed to init audit trail", "error", err)
		os.Exit(1)
	}
	logger.Info("audit trail initialized")

	// Init SIEM forwarder
	siemForwarder, err := siem.NewForwarder(cfg.SIEM)
	if err != nil {
		logger.Error("failed to init SIEM forwarder", "error", err)
		os.Exit(1)
	}
	trail.SetForwarder(&siemAdapter{fwd: siemForwarder})
	logger.Info("SIEM forwarder initialized", "enabled", cfg.SIEM.Enabled, "type", cfg.SIEM.Type)

	// Init sovereign router
	routerEngine := router.NewEngine(cfg.Routing, trail.PrivateKey())
	logger.Info("sovereign router initialized")

	// Create gateway
	allowHeaderJurisdiction := os.Getenv("BAWABA_ALLOW_HEADER_JURISDICTION") == "true"
	if allowHeaderJurisdiction {
		logger.Warn("header jurisdiction override enabled (BAWABA_ALLOW_HEADER_JURISDICTION=true)")
	}

	gateway := proxy.NewGateway(
		authEngine,
		policyEngine,
		limiter,
		anomaly,
		trail,
		routerEngine,
		cfg.Agents,
		logger,
		true, // PII enabled
		allowHeaderJurisdiction,
		cfg.Routing.Rules,
	)

	// Start MCP proxy server
	port := cfg.Server.Port
	if p := os.Getenv("BAWABA_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &port)
	}

	mcpServer := &http.Server{
		Addr:         fmt.Sprintf(":%d", port),
		Handler:      gateway.NewHTTPHandler(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start REST API server
	apiPort := 8081
	if p := os.Getenv("BAWABA_API_PORT"); p != "" {
		fmt.Sscanf(p, "%d", &apiPort)
	}

	apiSrv := api.NewServer(db, cfg, configPath, trail, policyEngine, logger)
	apiSrv.Start() // Start SSE hub

	apiServer := &http.Server{
		Addr:         fmt.Sprintf(":%d", apiPort),
		Handler:      apiSrv.Handler(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second, // longer for SSE
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		logger.Info("MCP proxy listening", "port", port)
		if err := mcpServer.ListenAndServe(); err != http.ErrServerClosed {
			logger.Error("mcp server error", "error", err)
			os.Exit(1)
		}
	}()

	go func() {
		logger.Info("REST API listening", "port", apiPort)
		if err := apiServer.ListenAndServe(); err != http.ErrServerClosed {
			logger.Error("api server error", "error", err)
			os.Exit(1)
		}
	}()

	<-done
	logger.Info("shutting down gateway")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	mcpServer.Shutdown(ctx)
	apiServer.Shutdown(ctx)
	apiSrv.Stop()

	logger.Info("gateway stopped")
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// siemAdapter bridges audit.SIEMForwarder interface with siem.Forwarder.
type siemAdapter struct {
	fwd siem.Forwarder
}

func (a *siemAdapter) Forward(evt audit.SIEMEvent) {
	a.fwd.Forward(siem.AuditEvent{
		EventID:      evt.EventID,
		Timestamp:    evt.Timestamp,
		EventType:    evt.EventType,
		AgentID:      evt.AgentID,
		TenantID:     evt.TenantID,
		Jurisdiction: evt.Jurisdiction,
		Tool:         evt.Tool,
		PolicyResult: evt.PolicyResult,
		PIIMode:      evt.PIIMode,
		LatencyMS:    evt.LatencyMS,
	})
}
