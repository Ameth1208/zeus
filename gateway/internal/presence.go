package internal

import (
	"sync"
	"time"
)

// PresenceStore tracks when each desktop last beat. Machines are keyed by
// their workstation id, which the relay already sends on every event, so the
// vocabulary does not fork.
type PresenceStore struct {
	mu    sync.RWMutex
	beats map[string]time.Time
}

// NewPresenceStore builds an empty store. Presence is intentionally
// in-memory: a gateway restart marking every desktop offline until its next
// beat is the correct behaviour, not data loss.
func NewPresenceStore() *PresenceStore {
	return &PresenceStore{beats: map[string]time.Time{}}
}

// Beat records that a machine is alive right now.
func (p *PresenceStore) Beat(machineID string) {
	if machineID == "" {
		return
	}
	p.mu.Lock()
	p.beats[machineID] = time.Now().UTC()
	p.mu.Unlock()
}

// SeenSecsAgo reports how long since each machine's last beat.
func (p *PresenceStore) SeenSecsAgo() map[string]int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	now := time.Now().UTC()
	out := make(map[string]int, len(p.beats))
	for id, at := range p.beats {
		out[id] = int(now.Sub(at).Seconds())
	}
	return out
}
