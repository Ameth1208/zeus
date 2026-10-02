package internal

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testServer() *Server {
	return NewServerWithTokens("admin-secret", "agent-secret", log.New(io.Discard, "", 0))
}

func TestHealth(t *testing.T) {
	s := testServer()
	r := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
}

func TestEventRequiresAgentAuth(t *testing.T) {
	s := testServer()
	payload, _ := json.Marshal(Event{SessionID: "s1", AgentID: "a1", Runtime: "codex", Type: "session.started"})

	r := httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewReader(payload))
	r.Header.Set("Authorization", "Bearer device-looking-token")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d", w.Code)
	}

	r = httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewReader(payload))
	r.Header.Set("Authorization", "Bearer agent-secret")
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusAccepted {
		t.Fatalf("agent status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestEventCreatesSession(t *testing.T) {
	s := testServer()
	payload, _ := json.Marshal(Event{SessionID: "s1", AgentID: "a1", Runtime: "codex", Project: "demo", Type: "session.started"})
	r := httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewReader(payload))
	r.Header.Set("Authorization", "Bearer agent-secret")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	list := s.sessions.List()
	if len(list) != 1 || list[0].Status != "working" {
		t.Fatalf("unexpected sessions: %#v", list)
	}
}

func TestSessionStatusHistoryAndStaleApproval(t *testing.T) {
	s := testServer()
	payload := `{"session_id":"s1","agent_id":"a1","runtime":"codex","type":"permission.requested","project":"demo","metadata":{"request_id":"req-1"}}`
	req := httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(payload))
	req.Header.Set("Authorization", "Bearer agent-secret")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusAccepted {
		t.Fatalf("event status = %d body=%s", rr.Code, rr.Body.String())
	}

	// Admin can inspect the controller surface without pairing, useful for ops.
	req = httptest.NewRequest(http.MethodGet, "/v1/sessions", nil)
	req.Header.Set("Authorization", "Bearer admin-secret")
	rr = httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"status":"waiting"`) || !strings.Contains(rr.Body.String(), `"pending_request_id":"req-1"`) {
		t.Fatalf("unexpected sessions response: %s", rr.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/sessions/s1/events", nil)
	req.Header.Set("Authorization", "Bearer admin-secret")
	rr = httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "permission.requested") {
		t.Fatalf("unexpected history response: %s", rr.Body.String())
	}

	stale := `{"session_id":"s1","agent_id":"a1","kind":"approve","payload":{"request_id":"req-old"}}`
	req = httptest.NewRequest(http.MethodPost, "/v1/actions", strings.NewReader(stale))
	req.Header.Set("Authorization", "Bearer admin-secret")
	rr = httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("stale approval status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestCORSRejectsUnknownPreflightOrigin(t *testing.T) {
	s := testServer()
	req := httptest.NewRequest(http.MethodOptions, "/v1/sessions", nil)
	req.Header.Set("Origin", "https://evil.example")
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status=%d", rr.Code)
	}
}

func TestValidApprovalDoesNotPanicAndQueues(t *testing.T) {
	s := NewServerWithTokens("admin", "agent", log.New(io.Discard, "", 0))
	s.sessions.Apply(Event{SessionID: "s", AgentID: "a", Runtime: "codex", Type: "permission.requested", Metadata: map[string]any{"request_id": "r1"}})
	body := strings.NewReader(`{"session_id":"s","agent_id":"a","kind":"approve","payload":{"request_id":"r1"}}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/actions", body)
	req.Header.Set("Authorization", "Bearer admin")
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	items := s.actionQueue.Drain("a")
	if len(items) != 1 || items[0].Kind != "approve" {
		t.Fatalf("queued=%v", items)
	}
}
