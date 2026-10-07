package internal

import (
	"sync"
	"time"
)

// MediaState is one desktop's now-playing snapshot.
type MediaState struct {
	MachineID    string  `json:"machine_id"`
	Title        string  `json:"title"`
	Artist       string  `json:"artist"`
	Album        string  `json:"album,omitempty"`
	Playing      bool    `json:"playing"`
	PositionSecs float64 `json:"position_secs"`
	DurationSecs float64 `json:"duration_secs"`
	// Thumbnail is a data URL of the album art; inline because a phone has no
	// other path to the desktop's filesystem.
	Thumbnail string    `json:"thumbnail,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

// MediaHub holds the latest now-playing snapshot per machine and the pending
// transport commands a phone has sent. In-memory on purpose: a stale song
// after a gateway restart is worth nothing.
type MediaHub struct {
	mu      sync.RWMutex
	states  map[string]MediaState
	pending map[string][]string
}

// NewMediaHub builds an empty hub.
func NewMediaHub() *MediaHub {
	return &MediaHub{states: map[string]MediaState{}, pending: map[string][]string{}}
}

// Report stores a desktop's now-playing snapshot.
func (h *MediaHub) Report(state MediaState) {
	if state.MachineID == "" {
		return
	}
	state.UpdatedAt = time.Now().UTC()
	h.mu.Lock()
	h.states[state.MachineID] = state
	h.mu.Unlock()
}

// Players lists every machine's latest snapshot.
func (h *MediaHub) Players() []MediaState {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]MediaState, 0, len(h.states))
	for _, state := range h.states {
		out = append(out, state)
	}
	return out
}

// Enqueue holds a transport command until the desktop drains it.
func (h *MediaHub) Enqueue(machineID, command string) {
	h.mu.Lock()
	items := append(h.pending[machineID], command)
	if len(items) > 16 {
		items = append([]string(nil), items[len(items)-16:]...)
	}
	h.pending[machineID] = items
	h.mu.Unlock()
}

// Drain returns and clears the pending commands for one machine.
func (h *MediaHub) Drain(machineID string) []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	items := append([]string(nil), h.pending[machineID]...)
	delete(h.pending, machineID)
	return items
}
