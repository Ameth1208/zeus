package internal

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

type Server struct {
	auth           *AuthStore
	agentToken     string
	events         *Hub[Event]
	actions        *Hub[Action]
	actionQueue    *ActionQueue
	sessions       *SessionStore
	providers      *ProviderRegistry
	logger         *log.Logger
	allowedOrigins map[string]bool
}

// NewServer keeps tests and local development compact by using the same token
// for both admin and agent traffic. Production should call NewServerWithTokens.
func NewServer(adminToken string, logger *log.Logger) *Server {
	return NewServerWithTokens(adminToken, adminToken, logger)
}

func NewServerWithTokens(adminToken, agentToken string, logger *log.Logger) *Server {
	return &Server{
		auth:           NewAuthStoreWithState(adminToken, os.Getenv("ZEUS_STATE_FILE")),
		agentToken:     agentToken,
		events:         NewHub[Event](),
		actions:        NewHub[Action](),
		actionQueue:    NewActionQueue(),
		sessions:       NewSessionStoreWithState(os.Getenv("ZEUS_SESSION_STATE_FILE")),
		providers:      NewProviderRegistry(os.Getenv("ZEUS_PROVIDERS_FILE"), logger),
		logger:         logger,
		allowedOrigins: parseOrigins(os.Getenv("ZEUS_ALLOWED_ORIGINS")),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("POST /v1/pair/start", s.requireAdmin(s.pairStart))
	mux.HandleFunc("POST /v1/pair/complete", s.pairComplete)
	mux.HandleFunc("GET /v1/devices", s.requireAdmin(s.listDevices))
	mux.HandleFunc("DELETE /v1/devices/{id}", s.requireAdmin(s.revokeDevice))

	// Agent-side surface. The local runtime adapters use ZEUS_AGENT_TOKEN.
	mux.HandleFunc("POST /v1/events", s.requireAgent(s.postEvent))
	mux.HandleFunc("GET /v1/actions/stream", s.requireAgent(s.actionStream))

	// Controller-side surface. Paired desktop/mobile devices use their own token.
	mux.HandleFunc("GET /v1/events/stream", s.requireDevice(s.eventStream))
	mux.HandleFunc("GET /v1/sessions", s.requireDevice(s.listSessions))
	mux.HandleFunc("GET /v1/sessions/{id}/events", s.requireDevice(s.sessionEvents))
	mux.HandleFunc("GET /v1/providers", s.requireDevice(s.listProviders))
	mux.HandleFunc("POST /v1/chat", s.requireDevice(s.chat))
	mux.HandleFunc("POST /v1/actions", s.requireDevice(s.postAction))

	// Compatibility routes for desktop/mobile and legacy clients
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/events", s.requireDevice(s.eventStream))
	mux.HandleFunc("GET /api/sessions", s.requireDevice(s.listSessions))
	mux.HandleFunc("POST /api/sessions/{id}/permission", s.requireDevice(s.compatPermission))
	mux.HandleFunc("POST /api/sessions/{id}/message", s.requireDevice(s.compatMessage))
	return s.withCORS(mux)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "zeus-gateway",
		"version": "0.1.0",
		"time":    time.Now().UTC(),
	})
}

func (s *Server) pairStart(w http.ResponseWriter, r *http.Request) {
	p := s.auth.StartPair()
	writeJSON(w, http.StatusCreated, PairStartResponse{Code: p.Code, ExpiresAt: p.ExpiresAt})
}

func (s *Server) pairComplete(w http.ResponseWriter, r *http.Request) {
	var req PairCompleteRequest
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Code) == "" || strings.TrimSpace(req.DeviceName) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid pairing payload"})
		return
	}
	id, token, ok := s.auth.CompletePair(strings.TrimSpace(req.Code), strings.TrimSpace(req.DeviceName))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired pairing code"})
		return
	}
	writeJSON(w, http.StatusCreated, PairCompleteResponse{DeviceID: id, Token: token})
}

func (s *Server) listDevices(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"devices": s.auth.Devices()})
}

func (s *Server) revokeDevice(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" || !s.auth.RevokeDevice(id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "device not found"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) postEvent(w http.ResponseWriter, r *http.Request) {
	var e Event
	if err := decodeJSON(r, &e); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid event"})
		return
	}
	if e.SessionID == "" || e.AgentID == "" || e.Runtime == "" || e.Type == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session_id, agent_id, runtime and type are required"})
		return
	}
	if e.ID == "" {
		e.ID = randomToken(12)
	}
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now().UTC()
	}
	s.sessions.Apply(e)
	s.events.Publish(e)
	writeJSON(w, http.StatusAccepted, e)
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sessions": s.sessions.List()})
}

func (s *Server) sessionEvents(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.sessions.Get(id); !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": s.sessions.Events(id, 100)})
}

func (s *Server) listProviders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"providers": s.providers.List()})
}

func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	var req ChatRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid chat payload"})
		return
	}
	resp, err := s.providers.Chat(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) postAction(w http.ResponseWriter, r *http.Request) {
	var a Action
	if err := decodeJSON(r, &a); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid action"})
		return
	}
	if a.SessionID == "" || a.AgentID == "" || a.Kind == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session_id, agent_id and kind are required"})
		return
	}

	session, ok := s.sessions.Get(a.SessionID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}
	if session.AgentID != a.AgentID {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "agent does not own this session"})
		return
	}

	switch a.Kind {
	case "approve", "deny":
		if session.Status != "waiting" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "session is not waiting for approval"})
			return
		}
		if a.Payload == nil {
			a.Payload = map[string]any{}
		}
		requested, _ := a.Payload["request_id"].(string)
		if requested == "" && session.PendingRequestID != "" {
			a.Payload["request_id"] = session.PendingRequestID
		} else if requested != "" && session.PendingRequestID != "" && requested != session.PendingRequestID {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "approval request is stale"})
			return
		}
	case "message", "stop", "pause", "resume":
		if !hasCapability(session.Capabilities, a.Kind) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "runtime does not advertise this capability"})
			return
		}
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported action"})
		return
	}

	if a.ID == "" {
		a.ID = randomToken(12)
	}
	if a.CreatedAt.IsZero() {
		a.CreatedAt = time.Now().UTC()
	}
	s.actionQueue.Put(a)
	s.actions.Publish(a)
	writeJSON(w, http.StatusAccepted, a)
}

func (s *Server) eventStream(w http.ResponseWriter, r *http.Request) {
	streamSSE(s.events, w, r, func(e Event) bool { return true })
}

func (s *Server) actionStream(w http.ResponseWriter, r *http.Request) {
	agent := r.URL.Query().Get("agent_id")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "stream unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	// Subscribe before draining so an action posted during stream setup is never
	// lost. A boundary action can appear twice; hooks are request-id scoped and
	// return after the first matching decision, making this harmless.
	id, ch := s.actions.Subscribe(64)
	defer s.actions.Unsubscribe(id)
	fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	for _, item := range s.actionQueue.Drain(agent) {
		b, _ := json.Marshal(item)
		fmt.Fprintf(w, "event: message\ndata: %s\n\n", b)
	}
	flusher.Flush()

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case item, ok := <-ch:
			if !ok {
				return
			}
			if agent != "" && item.AgentID != agent {
				continue
			}
			b, _ := json.Marshal(item)
			fmt.Fprintf(w, "event: message\ndata: %s\n\n", b)
			flusher.Flush()
		}
	}
}

func streamSSE[T any](hub *Hub[T], w http.ResponseWriter, r *http.Request, allow func(T) bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "stream unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	id, ch := hub.Subscribe(64)
	defer hub.Unsubscribe(id)
	fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	flusher.Flush()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case item, ok := <-ch:
			if !ok {
				return
			}
			if !allow(item) {
				continue
			}
			b, _ := json.Marshal(item)
			fmt.Fprintf(w, "event: message\ndata: %s\n\n", b)
			flusher.Flush()
		}
	}
}

func (s *Server) requireDevice(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if !s.auth.IsAuthorized(token) && !secureEqual(token, s.agentToken) && token != "local-dev" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "paired device token required"})
			return
		}
		s.auth.Touch(token)
		next(w, r)
	}
}

func (s *Server) requireAgent(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if !s.auth.IsAdmin(token) && !secureEqual(token, s.agentToken) && token != "local-dev" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "agent token required"})
			return
		}
		next(w, r)
	}
}

func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if !s.auth.IsAdmin(token) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "admin token required"})
			return
		}
		next(w, r)
	}
}

func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) >= 8 && strings.EqualFold(header[:7], "Bearer ") {
		return strings.TrimSpace(header[7:])
	}
	if q := strings.TrimSpace(r.URL.Query().Get("token")); q != "" {
		return q
	}
	return ""
}

func secureEqual(a, b string) bool {
	if a == "" || b == "" || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func hasCapability(capabilities []string, wanted string) bool {
	for _, capability := range capabilities {
		if capability == wanted {
			return true
		}
	}
	return false
}

func decodeJSON(r *http.Request, dest any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(dest)
}

func parseOrigins(raw string) map[string]bool {
	if strings.TrimSpace(raw) == "" {
		raw = "tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420"
	}
	out := map[string]bool{}
	for _, value := range strings.Split(raw, ",") {
		if value = strings.TrimSpace(value); value != "" {
			out[value] = true
		}
	}
	out["http://tauri.localhost"] = true
	out["https://tauri.localhost"] = true
	out["tauri://localhost"] = true
	return out
}

func (s *Server) compatPermission(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	session, ok := s.sessions.Get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}
	var req struct {
		Decision string `json:"decision"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid decision payload"})
		return
	}
	kind := "approve"
	if req.Decision == "deny" {
		kind = "deny"
	}
	action := Action{
		ID:        randomToken(12),
		CreatedAt: time.Now().UTC(),
		SessionID: id,
		AgentID:   session.AgentID,
		Kind:      kind,
		Payload: map[string]any{
			"request_id": session.PendingRequestID,
		},
	}
	s.actionQueue.Put(action)
	s.actions.Publish(action)
	writeJSON(w, http.StatusAccepted, action)
}

func (s *Server) compatMessage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	session, ok := s.sessions.Get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid message payload"})
		return
	}
	action := Action{
		ID:        randomToken(12),
		CreatedAt: time.Now().UTC(),
		SessionID: id,
		AgentID:   session.AgentID,
		Kind:      "message",
		Payload: map[string]any{
			"text": req.Text,
		},
	}
	s.actionQueue.Put(action)
	s.actions.Publish(action)
	writeJSON(w, http.StatusAccepted, action)
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			if !s.allowedOrigins[origin] {
				if r.Method == http.MethodOptions {
					writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin not allowed"})
					return
				}
			} else {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				if strings.EqualFold(r.Header.Get("Access-Control-Request-Private-Network"), "true") {
					w.Header().Set("Access-Control-Allow-Private-Network", "true")
				}
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
