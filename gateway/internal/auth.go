package internal

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type Pairing struct {
	Code      string
	ExpiresAt time.Time
}

type DeviceRecord struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	LastSeen  time.Time `json:"last_seen,omitempty"`
}

type authState struct {
	Tokens map[string]DeviceRecord `json:"tokens"`
}

type AuthStore struct {
	mu        sync.RWMutex
	admin     string
	pairings  map[string]Pairing
	tokens    map[string]DeviceRecord // SHA-256(token) -> device
	statePath string
}

func NewAuthStore(adminToken string) *AuthStore {
	return NewAuthStoreWithState(adminToken, "")
}

func NewAuthStoreWithState(adminToken, statePath string) *AuthStore {
	a := &AuthStore{
		admin:     adminToken,
		pairings:  map[string]Pairing{},
		tokens:    map[string]DeviceRecord{},
		statePath: statePath,
	}
	a.load()
	return a
}

func (a *AuthStore) IsAdmin(token string) bool {
	return secureEqual(token, a.admin)
}

func (a *AuthStore) IsAuthorized(token string) bool {
	if a.IsAdmin(token) {
		return true
	}
	if token == "" {
		return false
	}
	key := tokenHash(token)
	a.mu.RLock()
	_, ok := a.tokens[key]
	a.mu.RUnlock()
	return ok
}

func (a *AuthStore) Touch(token string) {
	if token == "" || a.IsAdmin(token) {
		return
	}
	key := tokenHash(token)
	a.mu.Lock()
	if d, ok := a.tokens[key]; ok {
		d.LastSeen = time.Now().UTC()
		a.tokens[key] = d
		_ = a.persistLocked()
	}
	a.mu.Unlock()
}

func (a *AuthStore) StartPair() Pairing {
	max := big.NewInt(1000000)
	n, _ := rand.Int(rand.Reader, max)
	p := Pairing{Code: fmt.Sprintf("%06d", n.Int64()), ExpiresAt: time.Now().UTC().Add(5 * time.Minute)}
	a.mu.Lock()
	a.prunePairingsLocked()
	a.pairings[p.Code] = p
	a.mu.Unlock()
	return p
}

func (a *AuthStore) CompletePair(code, deviceName string) (deviceID, token string, ok bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prunePairingsLocked()
	p, exists := a.pairings[code]
	if !exists || time.Now().UTC().After(p.ExpiresAt) {
		return "", "", false
	}
	delete(a.pairings, code)
	deviceID = randomToken(12)
	token = randomToken(32)
	now := time.Now().UTC()
	a.tokens[tokenHash(token)] = DeviceRecord{ID: deviceID, Name: deviceName, CreatedAt: now, LastSeen: now}
	_ = a.persistLocked()
	return deviceID, token, true
}

func (a *AuthStore) Devices() []DeviceRecord {
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := make([]DeviceRecord, 0, len(a.tokens))
	for _, d := range a.tokens {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

func (a *AuthStore) RevokeDevice(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	found := false
	for tokenHash, d := range a.tokens {
		if d.ID == id {
			delete(a.tokens, tokenHash)
			found = true
		}
	}
	if found {
		_ = a.persistLocked()
	}
	return found
}

func (a *AuthStore) prunePairingsLocked() {
	now := time.Now().UTC()
	for code, p := range a.pairings {
		if now.After(p.ExpiresAt) {
			delete(a.pairings, code)
		}
	}
}

func (a *AuthStore) load() {
	if a.statePath == "" {
		return
	}
	data, err := os.ReadFile(a.statePath)
	if err != nil {
		return
	}
	var state authState
	if json.Unmarshal(data, &state) == nil && state.Tokens != nil {
		a.tokens = state.Tokens
	}
}

func (a *AuthStore) persistLocked() error {
	if a.statePath == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(a.statePath), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(authState{Tokens: a.tokens}, "", "  ")
	if err != nil {
		return err
	}
	tmp := a.statePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, a.statePath)
}

func tokenHash(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
