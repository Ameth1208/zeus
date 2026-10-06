package internal

import (
	"path/filepath"
	"testing"
)

func TestSessionPersistenceAndPermissionLifecycle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	store := NewSessionStoreWithState(path)
	store.Apply(Event{
		SessionID: "s1", AgentID: "codex:s1", Runtime: "codex", Type: "permission.requested",
		Metadata: map[string]any{"request_id": "req-1"},
	})

	current, ok := store.Get("s1")
	if !ok || current.Status != "waiting" || current.PendingRequestID != "req-1" {
		t.Fatalf("unexpected waiting session: %#v", current)
	}
	if !hasCapability(current.Capabilities, "approve") || !hasCapability(current.Capabilities, "deny") {
		t.Fatalf("approval capabilities missing: %#v", current.Capabilities)
	}

	restored := NewSessionStoreWithState(path)
	current, ok = restored.Get("s1")
	if !ok || current.PendingRequestID != "req-1" || len(restored.Events("s1", 100)) != 1 {
		t.Fatalf("session did not survive restart: %#v", current)
	}

	restored.Apply(Event{
		SessionID: "s1", AgentID: "codex:s1", Runtime: "codex", Type: "permission.resolved",
		Metadata: map[string]any{"request_id": "req-1", "decision": "allow"},
	})
	current, _ = restored.Get("s1")
	if current.PendingRequestID != "" || hasCapability(current.Capabilities, "approve") || hasCapability(current.Capabilities, "deny") {
		t.Fatalf("permission capabilities were not cleared: %#v", current)
	}
}

// A desktop sends the canonical `kind`; the older adapters send `type`. One
// table has to serve both, or a session looks idle for half the fleet.
func TestApplyFoldsCanonicalKindIntoLegacyType(t *testing.T) {
	s := NewSessionStore()
	s.Apply(Event{SessionID: "s1", AgentID: "a1", Runtime: "codex", Kind: "agent.thinking", Seq: 1})
	s.Apply(Event{SessionID: "s1", AgentID: "a1", Runtime: "codex", Kind: "tool.started", Seq: 2})
	session, ok := s.Get("s1")
	if !ok {
		t.Fatalf("session missing: %#v", session)
	}
	if session.LastEvent != "tool.started" {
		t.Fatalf("last_event = %q, want tool.started", session.LastEvent)
	}
}

func TestStatusTableCoversBothVocabularies(t *testing.T) {
	cases := map[string]string{
		"agent.thinking":       "working",
		"agent.message":        "working",
		"tool.completed":       "working",
		"permission.resolved":  "working",
		"permission.requested": "waiting",
		"input.requested":      "waiting",
		"session.completed":    "completed",
		"agent.interrupted":    "completed",
		"session.stopped":      "completed",
		"session.failed":       "failed",
		"thinking":             "working",
		"message":              "working",
		"file.read":            "working",
		"command.completed":    "working",
		"session.started":      "working",
	}
	for kind, want := range cases {
		if got := statusForEvent(kind); got != want {
			t.Errorf("statusForEvent(%q) = %q, want %q", kind, got, want)
		}
	}
}

// A hook reconnecting replays its buffer. Without sequence checking that would
// rewind a finished session and re-show an approval.
func TestOutOfOrderAndDuplicateEventsAreIgnored(t *testing.T) {
	s := NewSessionStore()
	if _, ok := s.Apply(Event{SessionID: "s1", AgentID: "a1", Runtime: "codex", Type: "tool.started", Seq: 5, ID: "e5"}); !ok {
		t.Fatal("first event should be accepted")
	}
	if _, ok := s.Apply(Event{SessionID: "s1", AgentID: "a1", Runtime: "codex", Type: "session.completed", Seq: 4, ID: "e4"}); ok {
		t.Fatal("an older seq must be rejected")
	}
	if _, ok := s.Apply(Event{SessionID: "s1", AgentID: "a1", Runtime: "codex", Type: "tool.started", Seq: 5, ID: "e5"}); ok {
		t.Fatal("a repeated seq must be rejected")
	}
	session, _ := s.Get("s1")
	if session.Status != "working" {
		t.Fatalf("status = %q, want working: a replay must not rewind state", session.Status)
	}
	if len(s.Events("s1", 50)) != 1 {
		t.Fatalf("history = %d events, want 1", len(s.Events("s1", 50)))
	}
}

// An adapter that sends no sequence is deduped by event id instead.
func TestDuplicateWithoutSequenceIsDedupedByID(t *testing.T) {
	s := NewSessionStore()
	s.Apply(Event{SessionID: "s1", AgentID: "a1", Runtime: "agy", Type: "thinking", ID: "same"})
	if _, ok := s.Apply(Event{SessionID: "s1", AgentID: "a1", Runtime: "agy", Type: "thinking", ID: "same"}); ok {
		t.Fatal("a repeated event id must be rejected")
	}
}

func TestReportedUsageIsStoredAndEstimatesAreIgnored(t *testing.T) {
	s := NewSessionStore()
	s.Apply(Event{SessionID: "s1", AgentID: "a1", Runtime: "codex", Type: "agent.message", Seq: 1,
		Metadata: map[string]any{"usage": map[string]any{"input": float64(120), "output": float64(8), "cached": float64(40)}}})
	session, _ := s.Get("s1")
	if session.Usage == nil || session.Usage.Input != 120 || session.Usage.Cached != 40 {
		t.Fatalf("usage = %#v", session.Usage)
	}
	// An estimate must never overwrite a measurement.
	s.Apply(Event{SessionID: "s1", AgentID: "a1", Runtime: "codex", Type: "agent.message", Seq: 2,
		Metadata: map[string]any{"usage": map[string]any{"input": float64(999), "estimated": true}}})
	session, _ = s.Get("s1")
	if session.Usage == nil || session.Usage.Input != 120 {
		t.Fatalf("an estimate overwrote the measurement: %#v", session.Usage)
	}
}

func TestPushPolicyIsExactlyFourKinds(t *testing.T) {
	for _, kind := range []string{"permission.requested", "input.requested", "session.completed", "session.failed"} {
		if !isPushworthy(kind) {
			t.Errorf("%s should be pushworthy", kind)
		}
	}
	for _, kind := range []string{"agent.message", "agent.thinking", "tool.started", "tool.completed", "permission.resolved"} {
		if isPushworthy(kind) {
			t.Errorf("%s should not be pushworthy", kind)
		}
	}
}

func TestDigestRoundTrips(t *testing.T) {
	s := NewSessionStore()
	if _, ok := s.Digest("s1"); ok {
		t.Fatal("no digest should exist yet")
	}
	s.PutDigest(SessionDigest{SessionID: "s1", Goal: "Ship the engine", LastSeq: 9})
	got, ok := s.Digest("s1")
	if !ok || got.Goal != "Ship the engine" || got.LastSeq != 9 {
		t.Fatalf("digest = %#v", got)
	}
}
