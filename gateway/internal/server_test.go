package internal

import (
	"bytes"
	"encoding/json"
	"fmt"
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

func TestMessageActionUsesCanonicalSendCapability(t *testing.T) {
	s := testServer()
	s.sessions.Apply(Event{
		SessionID: "s", AgentID: "a", Runtime: "codex", Type: "session.started",
		Metadata: map[string]any{"capabilities": []any{"send"}},
	})
	body := strings.NewReader(`{"session_id":"s","agent_id":"a","kind":"message","payload":{"message":"continue"}}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/actions", body)
	req.Header.Set("Authorization", "Bearer admin-secret")
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

// The desktop uploads `kind`; the mobile and the status table read one value.
func TestPostEventAcceptsCanonicalKindAndRejectsReplays(t *testing.T) {
	s := NewServer("admin", nil)
	handler := s.Handler()

	post := func(kind string, seq int, id string) *httptest.ResponseRecorder {
		body := fmt.Sprintf(
			`{"session_id":"s1","agent_id":"a1","runtime":"codex","kind":%q,"seq":%d,"id":%q}`,
			kind, seq, id)
		req := httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer admin")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	if rec := post("agent.message", 1, "e1"); rec.Code != http.StatusAccepted {
		t.Fatalf("first post = %d, body %s", rec.Code, rec.Body.String())
	}
	if rec := post("agent.message", 1, "e1"); rec.Code != http.StatusOK {
		t.Fatalf("replay = %d, want 200 acknowledged", rec.Code)
	}
	session, ok := s.sessions.Get("s1")
	if !ok || session.Status != "working" {
		t.Fatalf("session = %#v", session)
	}
	if len(s.sessions.Events("s1", 50)) != 1 {
		t.Fatalf("replay was stored")
	}
}

// A phone asks for the summary, not the history. Absence is normal.
func TestDigestEndpointsRoundTrip(t *testing.T) {
	s := NewServer("admin", nil)
	handler := s.Handler()

	req := httptest.NewRequest(http.MethodGet, "/v1/sessions/s1/digest", nil)
	req.Header.Set("Authorization", "Bearer admin")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("missing digest = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"digest":null`) {
		t.Fatalf("body = %s", rec.Body.String())
	}

	body := `{"session_id":"s1","goal":"Ship the engine","last_seq":4}`
	req = httptest.NewRequest(http.MethodPut, "/v1/sessions/s1/digest", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer admin")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("put digest = %d, body %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/sessions/s1/digest", nil)
	req.Header.Set("Authorization", "Bearer admin")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), "Ship the engine") {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

// The whole remote-approval loop, as it happens in production:
//
//	phone pairs with a code → agent event raises permission → phone POSTs its
//	decision → gateway queues it for the desktop → desktop (agent role) fetches
//	the action → gateway marks it done once completed.
//
// Every hop is separately authenticated; the queue is the only place the two
// sides ever meet.
func TestRemoteApprovalLoopEndToEnd(t *testing.T) {
	s := NewServer("admin", nil)
	handler := s.Handler()

	startReq := httptest.NewRequest(http.MethodPost, "/v1/pair/start", nil)
	startReq.Header.Set("Authorization", "Bearer admin")
	startRec := httptest.NewRecorder()
	handler.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusCreated {
		t.Fatalf("start pair = %d", startRec.Code)
	}
	var pairing struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(startRec.Body.Bytes(), &pairing); err != nil {
		t.Fatal(err)
	}

	completeBody := fmt.Sprintf(`{"code":%q,"device_name":"phone"}`, pairing.Code)
	completeReq := httptest.NewRequest(http.MethodPost, "/v1/pair/complete", strings.NewReader(completeBody))
	completeRec := httptest.NewRecorder()
	handler.ServeHTTP(completeRec, completeReq)
	if completeRec.Code != http.StatusCreated {
		t.Fatalf("complete pair = %d: %s", completeRec.Code, completeRec.Body.String())
	}
	var device struct {
		DeviceID string `json:"device_id"`
		Token    string `json:"token"`
	}
	if err := json.Unmarshal(completeRec.Body.Bytes(), &device); err != nil {
		t.Fatal(err)
	}

	eventBody := `{"session_id":"s1","agent_id":"a1","runtime":"codex","kind":"permission.requested","message":"run cargo test","metadata":{"request_id":"req-1"}}`
	eventReq := httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(eventBody))
	eventReq.Header.Set("Authorization", "Bearer admin")
	eventRec := httptest.NewRecorder()
	handler.ServeHTTP(eventRec, eventReq)
	if eventRec.Code != http.StatusAccepted {
		t.Fatalf("event = %d: %s", eventRec.Code, eventRec.Body.String())
	}

	actionBody := `{"session_id":"s1","agent_id":"a1","kind":"approve","payload":{"request_id":"req-1"}}`
	actionReq := httptest.NewRequest(http.MethodPost, "/v1/actions", strings.NewReader(actionBody))
	actionReq.Header.Set("Authorization", "Bearer "+device.Token)
	actionRec := httptest.NewRecorder()
	handler.ServeHTTP(actionRec, actionReq)
	if actionRec.Code != http.StatusAccepted {
		t.Fatalf("action = %d: %s", actionRec.Code, actionRec.Body.String())
	}

	fetchReq := httptest.NewRequest(http.MethodGet, "/v1/actions", nil)
	fetchReq.Header.Set("Authorization", "Bearer admin") // agent tier
	fetchRec := httptest.NewRecorder()
	handler.ServeHTTP(fetchRec, fetchReq)
	if fetchRec.Code != http.StatusOK {
		t.Fatalf("fetch actions = %d", fetchRec.Code)
	}
	body, _ := io.ReadAll(fetchRec.Body)
	if !strings.Contains(string(body), `"kind":"approve"`) {
		t.Fatalf("actions = %s", body)
	}

	var actions struct {
		Actions []Action `json:"actions"`
	}
	if err := json.Unmarshal(body, &actions); err != nil {
		t.Fatal(err)
	}
	if len(actions.Actions) != 1 || actions.Actions[0].SessionID != "s1" {
		t.Fatalf("actions = %#v", actions.Actions)
	}
	// Completion is not a button-round trip to the gateway: the desktop reports
	// the outcome as `permission.resolved`, which is the only record that matters.
	resolved := `{"session_id":"s1","agent_id":"a1","runtime":"codex","kind":"permission.resolved","metadata":{"request_id":"req-1","decision":"approved"}}`
	resolvedReq := httptest.NewRequest(http.MethodPost, "/v1/events", strings.NewReader(resolved))
	resolvedReq.Header.Set("Authorization", "Bearer admin")
	resolvedRec := httptest.NewRecorder()
	handler.ServeHTTP(resolvedRec, resolvedReq)
	if resolvedRec.Code != http.StatusAccepted {
		t.Fatalf("resolved = %d", resolvedRec.Code)
	}

	session, ok := s.sessions.Get("s1")
	if !ok || session.Status != "working" {
		t.Fatalf("session after resolution = %#v", session)
	}
	// No re-queue: a fresh drain must be empty, otherwise a replayed approval
	// would ask the desktop to answer the same request twice.
	fetchRec = httptest.NewRecorder()
	handler.ServeHTTP(fetchRec, fetchReq)
	body, _ = io.ReadAll(fetchRec.Body)
	if !strings.Contains(string(body), `"count":0`) {
		t.Fatalf("expected empty actions after completion, got %s", body)
	}
}

// A phone reading presence sees a live desktop and its own device.
func TestPresenceShowsLiveDevices(t *testing.T) {
	s := NewServer("admin", nil)
	handler := s.Handler()

	startReq := httptest.NewRequest(http.MethodPost, "/v1/pair/start", nil)
	startReq.Header.Set("Authorization", "Bearer admin")
	startRec := httptest.NewRecorder()
	handler.ServeHTTP(startRec, startReq)
	var pairing struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(startRec.Body.Bytes(), &pairing); err != nil {
		t.Fatal(err)
	}
	completeReq := httptest.NewRequest(http.MethodPost, "/v1/pair/complete",
		strings.NewReader(fmt.Sprintf(`{"code":%q,"device_name":"phone"}`, pairing.Code)))
	completeRec := httptest.NewRecorder()
	handler.ServeHTTP(completeRec, completeReq)
	var device struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(completeRec.Body.Bytes(), &device); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/presence", nil)
	req.Header.Set("Authorization", "Bearer "+device.Token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("presence = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"devices"`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
}
