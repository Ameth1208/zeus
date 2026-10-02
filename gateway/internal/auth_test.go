package internal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuthPersistsPairedDevicesWithoutPlaintextToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.json")
	a := NewAuthStoreWithState("admin", path)
	pair := a.StartPair()
	id, token, ok := a.CompletePair(pair.Code, "Zeus iPhone")
	if !ok || id == "" || token == "" {
		t.Fatal("pairing failed")
	}
	if !a.IsAuthorized(token) {
		t.Fatal("new token should be authorized")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), token) {
		t.Fatal("device token must not be persisted in plaintext")
	}

	b := NewAuthStoreWithState("admin", path)
	if !b.IsAuthorized(token) {
		t.Fatal("paired token should survive restart")
	}
	if len(b.Devices()) != 1 || b.Devices()[0].Name != "Zeus iPhone" {
		t.Fatal("device metadata did not persist")
	}
	if !b.RevokeDevice(id) || b.IsAuthorized(token) {
		t.Fatal("device revocation failed")
	}
}
