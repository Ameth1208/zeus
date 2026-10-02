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
