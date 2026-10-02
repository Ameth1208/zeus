package main

import (
	"bufio"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	zeus "github.com/zeus-agent/zeus/gateway/internal"
)

func main() {
	loadEnv()

	addr := env("ZEUS_LISTEN_ADDR", ":8080")
	adminToken := os.Getenv("ZEUS_ADMIN_TOKEN")
	agentToken := os.Getenv("ZEUS_AGENT_TOKEN")
	if adminToken == "" {
		adminToken = "zeus-admin-dev-token"
		_ = os.Setenv("ZEUS_ADMIN_TOKEN", adminToken)
	}
	if agentToken == "" {
		agentToken = "zeus-agent-dev-token"
		_ = os.Setenv("ZEUS_AGENT_TOKEN", agentToken)
	}
	if agentToken == adminToken {
		agentToken = adminToken + "-agent"
		_ = os.Setenv("ZEUS_AGENT_TOKEN", agentToken)
	}

	logger := log.New(os.Stdout, "zeus-gateway ", log.LstdFlags|log.LUTC)
	server := zeus.NewServerWithTokens(adminToken, agentToken, logger)
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0, // SSE streams are intentionally long-lived.
		IdleTimeout:       75 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	logger.Printf("listening on %s", addr)
	log.Fatal(httpServer.ListenAndServe())
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadEnv() {
	candidates := []string{
		".env",
		"gateway/.env",
		"../gateway/.env",
		"../.env",
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(dir, ".env"), filepath.Join(dir, "..", ".env"), filepath.Join(dir, "..", "gateway", ".env"))
	}
	for _, path := range candidates {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				k := strings.TrimSpace(parts[0])
				v := strings.TrimSpace(parts[1])
				v = strings.Trim(v, `"'`)
				if os.Getenv(k) == "" {
					_ = os.Setenv(k, v)
				}
			}
		}
		_ = f.Close()
		break
	}
}
