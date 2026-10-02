package internal

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestOpenAICompatibleProvider(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("auth=%s", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "model-x",
			"choices": []any{map[string]any{"message": map[string]any{"content": "hello from Zeus"}}},
			"usage":   map[string]any{"total_tokens": 12},
		})
	}))
	defer upstream.Close()

	dir := t.TempDir()
	cfg := filepath.Join(dir, "providers.json")
	payload := map[string]any{"providers": []any{map[string]any{
		"id": "test", "name": "Test", "kind": "openai-compatible",
		"base_url": upstream.URL + "/v1", "api_key_env": "ZEUS_TEST_PROVIDER_KEY",
		"default_model": "model-x", "enabled": true,
	}}}
	b, _ := json.Marshal(payload)
	if err := os.WriteFile(cfg, b, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ZEUS_TEST_PROVIDER_KEY", "test-key")
	r := NewProviderRegistry(cfg, log.New(io.Discard, "", 0))
	resp, err := r.Chat(ChatRequest{ProviderID: "test", Messages: []ChatMessage{{Role: "user", Content: "hello"}}})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Text != "hello from Zeus" {
		t.Fatalf("text=%q", resp.Text)
	}
}
