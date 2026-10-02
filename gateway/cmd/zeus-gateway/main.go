package main

import (
	"log"
	"net/http"
	"os"
	"time"

	zeus "github.com/zeus-agent/zeus/gateway/internal"
)

func main() {
	addr := env("ZEUS_LISTEN_ADDR", ":8080")
	adminToken := os.Getenv("ZEUS_ADMIN_TOKEN")
	agentToken := os.Getenv("ZEUS_AGENT_TOKEN")
	if adminToken == "" {
		log.Fatal("ZEUS_ADMIN_TOKEN is required")
	}
	if agentToken == "" {
		log.Fatal("ZEUS_AGENT_TOKEN is required and should be different from ZEUS_ADMIN_TOKEN")
	}
	if agentToken == adminToken {
		log.Fatal("ZEUS_AGENT_TOKEN must be different from ZEUS_ADMIN_TOKEN")
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
