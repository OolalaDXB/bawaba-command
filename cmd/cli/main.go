package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	cmd := os.Args[1]

	switch cmd {
	case "config":
		handleConfig()
	case "agents":
		handleAgents()
	case "health":
		handleHealth()
	case "version":
		fmt.Println("bawaba-cli v0.1.0")
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", cmd)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println(`bawaba-cli — Bawaba Control Plane CLI

Usage:
  bawaba-cli <command> [args]

Commands:
  config    Validate and display configuration
  agents    List configured agents
  health    Check gateway health
  version   Print version
  help      Show this help message

Examples:
  bawaba-cli config validate ./configs/bawaba.yaml
  bawaba-cli agents list
  bawaba-cli health`)
}

func handleConfig() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: bawaba-cli config <validate|show> [path]")
		os.Exit(1)
	}

	subCmd := os.Args[2]
	configPath := "./configs/bawaba.yaml"
	if len(os.Args) > 3 {
		configPath = os.Args[3]
	}

	switch subCmd {
	case "validate":
		cfg, err := config.Load(configPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "INVALID: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("VALID: %d agents configured\n", len(cfg.Agents))
		for name, agent := range cfg.Agents {
			fmt.Printf("  - %s (auth: %s, tools: %d allowed, %d denied)\n",
				name, agent.Auth, len(agent.AllowedTools), len(agent.DeniedTools))
		}
	case "show":
		cfg, err := config.Load(configPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		data, _ := json.MarshalIndent(cfg, "", "  ")
		fmt.Println(string(data))
	default:
		fmt.Fprintf(os.Stderr, "Unknown config subcommand: %s\n", subCmd)
		os.Exit(1)
	}
}

func handleAgents() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: bawaba-cli agents <list>")
		os.Exit(1)
	}

	configPath := os.Getenv("BAWABA_CONFIG_PATH")
	if configPath == "" {
		configPath = "./configs/bawaba.yaml"
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config: %v\n", err)
		os.Exit(1)
	}

	switch os.Args[2] {
	case "list":
		fmt.Printf("%-20s %-10s %-30s %-15s %-10s\n", "AGENT", "AUTH", "ALLOWED TOOLS", "RATE LIMIT", "PII MODE")
		fmt.Println(strings.Repeat("-", 90))
		for name, agent := range cfg.Agents {
			tools := strings.Join(agent.AllowedTools, ", ")
			fmt.Printf("%-20s %-10s %-30s %-15s %-10s\n",
				name, agent.Auth, tools, agent.RateLimit, agent.PIIMode)
		}
	default:
		fmt.Fprintf(os.Stderr, "Unknown agents subcommand: %s\n", os.Args[2])
		os.Exit(1)
	}
}

func handleHealth() {
	gatewayURL := os.Getenv("BAWABA_URL")
	if gatewayURL == "" {
		gatewayURL = "http://localhost:8080"
	}
	fmt.Printf("Checking health at %s/healthz ...\n", gatewayURL)
	fmt.Printf("(Use curl or httpie to check: curl %s/healthz)\n", gatewayURL)
}
