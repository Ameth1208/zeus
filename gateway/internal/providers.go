package internal

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type Provider struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	BaseURL      string `json:"base_url"`
	APIKeyEnv    string `json:"api_key_env,omitempty"`
	DefaultModel string `json:"default_model,omitempty"`
	Enabled      bool   `json:"enabled"`
}

type PublicProvider struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	BaseURL      string `json:"base_url"`
	DefaultModel string `json:"default_model,omitempty"`
	Configured   bool   `json:"configured"`
}

type ProviderRegistry struct {
	items  map[string]Provider
	client *http.Client
	logger *log.Logger
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	ProviderID  string        `json:"provider_id"`
	Model       string        `json:"model,omitempty"`
	Messages    []ChatMessage `json:"messages"`
	Temperature *float64      `json:"temperature,omitempty"`
}

type ChatResponse struct {
	ProviderID string         `json:"provider_id"`
	Model      string         `json:"model"`
	Text       string         `json:"text"`
	Usage      map[string]any `json:"usage,omitempty"`
}

func NewProviderRegistry(path string, logger *log.Logger) *ProviderRegistry {
	r := &ProviderRegistry{
		items:  make(map[string]Provider),
		client: &http.Client{Timeout: 90 * time.Second},
		logger: logger,
	}
	if strings.TrimSpace(path) == "" {
		return r
	}
	data, err := os.ReadFile(path)
	if err != nil {
		logger.Printf("providers: cannot read %s: %v", path, err)
		return r
	}
	var cfg struct {
		Providers []Provider `json:"providers"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		logger.Printf("providers: invalid config %s: %v", path, err)
		return r
	}
	for _, p := range cfg.Providers {
		if p.ID == "" || p.BaseURL == "" || !p.Enabled {
			continue
		}
		if p.Kind == "" {
			p.Kind = "openai-compatible"
		}
		r.items[p.ID] = p
	}
	return r
}

func (r *ProviderRegistry) List() []PublicProvider {
	out := make([]PublicProvider, 0, len(r.items))
	for _, p := range r.items {
		configured := p.APIKeyEnv == "" || os.Getenv(p.APIKeyEnv) != ""
		out = append(out, PublicProvider{
			ID: p.ID, Name: p.Name, Kind: p.Kind, BaseURL: p.BaseURL,
			DefaultModel: p.DefaultModel, Configured: configured,
		})
	}
	return out
}

func (r *ProviderRegistry) Chat(req ChatRequest) (ChatResponse, error) {
	p, ok := r.items[req.ProviderID]
	if !ok {
		return ChatResponse{}, errors.New("unknown or disabled provider")
	}
	if len(req.Messages) == 0 {
		return ChatResponse{}, errors.New("messages are required")
	}
	model := req.Model
	if model == "" {
		model = p.DefaultModel
	}
	if model == "" {
		return ChatResponse{}, errors.New("model is required")
	}
	key := ""
	if p.APIKeyEnv != "" {
		key = os.Getenv(p.APIKeyEnv)
		if key == "" {
			return ChatResponse{}, fmt.Errorf("provider credential %s is not configured", p.APIKeyEnv)
		}
	}

	switch p.Kind {
	case "openai-compatible":
		return r.chatOpenAICompatible(p, key, model, req)
	case "anthropic-compatible":
		return r.chatAnthropicCompatible(p, key, model, req)
	default:
		return ChatResponse{}, fmt.Errorf("unsupported provider kind %q", p.Kind)
	}
}

func joinURL(base, suffix string) (string, error) {
	u, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil {
		return "", err
	}
	u.Path = strings.TrimRight(u.Path, "/") + suffix
	return u.String(), nil
}

func (r *ProviderRegistry) chatOpenAICompatible(p Provider, key, model string, req ChatRequest) (ChatResponse, error) {
	endpoint, err := joinURL(p.BaseURL, "/chat/completions")
	if err != nil {
		return ChatResponse{}, err
	}
	payload := map[string]any{"model": model, "messages": req.Messages, "stream": false}
	if req.Temperature != nil {
		payload["temperature"] = *req.Temperature
	}
	var raw struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage map[string]any `json:"usage"`
	}
	if err := r.doJSON(endpoint, key, "", payload, &raw); err != nil {
		return ChatResponse{}, err
	}
	if len(raw.Choices) == 0 {
		return ChatResponse{}, errors.New("provider returned no choices")
	}
	return ChatResponse{ProviderID: p.ID, Model: coalesce(raw.Model, model), Text: raw.Choices[0].Message.Content, Usage: raw.Usage}, nil
}

func (r *ProviderRegistry) chatAnthropicCompatible(p Provider, key, model string, req ChatRequest) (ChatResponse, error) {
	endpoint, err := joinURL(p.BaseURL, "/v1/messages")
	if err != nil {
		return ChatResponse{}, err
	}
	messages := make([]ChatMessage, 0, len(req.Messages))
	systemParts := []string{}
	for _, m := range req.Messages {
		if m.Role == "system" {
			systemParts = append(systemParts, m.Content)
			continue
		}
		messages = append(messages, m)
	}
	payload := map[string]any{"model": model, "messages": messages, "max_tokens": 4096}
	if len(systemParts) > 0 {
		payload["system"] = strings.Join(systemParts, "\n\n")
	}
	if req.Temperature != nil {
		payload["temperature"] = *req.Temperature
	}
	var raw struct {
		Model   string `json:"model"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage map[string]any `json:"usage"`
	}
	if err := r.doJSON(endpoint, key, "anthropic", payload, &raw); err != nil {
		return ChatResponse{}, err
	}
	parts := []string{}
	for _, c := range raw.Content {
		if c.Type == "text" && c.Text != "" {
			parts = append(parts, c.Text)
		}
	}
	if len(parts) == 0 {
		return ChatResponse{}, errors.New("provider returned no text content")
	}
	return ChatResponse{ProviderID: p.ID, Model: coalesce(raw.Model, model), Text: strings.Join(parts, ""), Usage: raw.Usage}, nil
}

func (r *ProviderRegistry) doJSON(endpoint, key, authKind string, payload any, dest any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	httpReq, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if key != "" {
		if authKind == "anthropic" {
			httpReq.Header.Set("x-api-key", key)
			httpReq.Header.Set("anthropic-version", "2023-06-01")
		} else {
			httpReq.Header.Set("Authorization", "Bearer "+key)
		}
	}
	resp, err := r.client.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	limited := io.LimitReader(resp.Body, 4<<20)
	data, err := io.ReadAll(limited)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("provider HTTP %d: %s", resp.StatusCode, truncate(string(data), 600))
	}
	if err := json.Unmarshal(data, dest); err != nil {
		return fmt.Errorf("invalid provider response: %w", err)
	}
	return nil
}

func coalesce(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
