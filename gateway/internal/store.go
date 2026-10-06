package internal

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const (
	maxSessionEvents = 250
	// Bounded so a long-lived gateway does not accumulate ids forever.
	maxSeenEvents = 20000
)

type sessionState struct {
	Sessions  map[string]Session       `json:"sessions"`
	Histories map[string][]Event       `json:"histories"`
	Digests   map[string]SessionDigest `json:"digests,omitempty"`
}

type SessionStore struct {
	mu        sync.RWMutex
	sessions  map[string]Session
	histories map[string][]Event
	digests   map[string]SessionDigest
	// Recent event ids, to drop a re-delivered event that carries no sequence.
	seen      map[string]struct{}
	statePath string
}

func NewSessionStore() *SessionStore {
	return NewSessionStoreWithState("")
}

func NewSessionStoreWithState(statePath string) *SessionStore {
	s := &SessionStore{
		sessions:  map[string]Session{},
		histories: map[string][]Event{},
		digests:   map[string]SessionDigest{},
		seen:      map[string]struct{}{},
		statePath: statePath,
	}
	s.load()
	return s
}

// statusForEvent is the single status table. The desktop engine carries the same
// table in `crates/zeus-engine/src/store.rs`; the two must be changed together,
// along with the Dart and TypeScript mappings.
func statusForEvent(kind string) string {
	switch kind {
	case "session.started", "agent.thinking", "agent.message",
		"tool.started", "tool.completed", "tool.failed",
		// Legacy adapter names, still emitted by the hooks in adapters/.
		"thinking", "message", "file.read", "file.changed",
		"command.started", "command.completed", "heartbeat", "permission.resolved":
		return "working"
	case "permission.requested", "input.requested":
		return "waiting"
	case "session.completed", "agent.interrupted", "session.stopped":
		return "completed"
	case "session.failed":
		return "failed"
	default:
		return "working"
	}
}

// isPushworthy mirrors `EventKind::is_pushworthy` in the desktop engine. Only
// these four kinds may reach a locked phone, and the payload carries ids alone.
func isPushworthy(kind string) bool {
	switch kind {
	case "permission.requested", "input.requested", "session.completed", "session.failed":
		return true
	default:
		return false
	}
}

// Apply folds one event into a session and reports whether it was accepted.
// A duplicate or out-of-order event is ignored: the desktop numbers events per
// session, so a reconnecting hook replaying its buffer must not rewind a
// session's state or re-show a finished turn.
func (s *SessionStore) Apply(e Event) (Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if e.Kind != "" {
		e.Type = e.Kind
	}
	if e.ID == "" {
		e.ID = e.EventID
	}
	if existing, ok := s.sessions[e.SessionID]; ok {
		if e.Seq > 0 && e.Seq <= existing.LastSeq {
			return existing, false
		}
		if _, seen := s.seen[e.SessionID+"#"+e.ID]; seen && e.ID != "" {
			return existing, false
		}
	}
	if e.ID != "" {
		s.seen[e.SessionID+"#"+e.ID] = struct{}{}
		if len(s.seen) > maxSeenEvents {
			s.seen = map[string]struct{}{}
		}
	}

	current := s.sessions[e.SessionID]
	current.ID = e.SessionID
	current.AgentID = e.AgentID
	current.Runtime = e.Runtime
	if e.Provider != "" {
		current.Provider = e.Provider
	}
	if e.Model != "" {
		current.Model = e.Model
	}
	if e.Project != "" {
		current.Project = e.Project
	}
	if e.MachineID != "" {
		current.MachineID = e.MachineID
	}
	if e.MachineName != "" {
		current.MachineName = e.MachineName
	}
	current.Status = statusForEvent(e.Type)
	current.LastEvent = e.Type
	current.UpdatedAt = time.Now().UTC()
	if e.Message != "" {
		current.Message = e.Message
	}

	switch e.Type {
	case "permission.requested":
		current.PendingRequestID = metadataString(e.Metadata, "request_id")
		current.Capabilities = mergeCapabilities(current.Capabilities, []string{"approve", "deny"})
	case "permission.resolved":
		current.PendingRequestID = ""
		current.Capabilities = removeCapabilities(current.Capabilities, "approve", "deny")
	case "session.completed", "session.failed", "session.stopped":
		current.PendingRequestID = ""
		current.Capabilities = nil
	}
	current.Capabilities = mergeCapabilities(current.Capabilities, eventCapabilities(e))
	s.sessions[e.SessionID] = current

	history := append(s.histories[e.SessionID], e)
	if len(history) > maxSessionEvents {
		history = append([]Event(nil), history[len(history)-maxSessionEvents:]...)
	}
	if e.Seq > current.LastSeq {
		current.LastSeq = e.Seq
	}
	if e.ExternalID != "" {
		current.ExternalID = e.ExternalID
	}
	if usage, ok := usageFromEvent(e); ok {
		current.Usage = &usage
	}
	s.sessions[e.SessionID] = current
	s.histories[e.SessionID] = history
	_ = s.persistLocked()
	return current, true
}

// usageFromEvent reads the token block the desktop attaches to terminal events.
// Only reported totals are accepted: an estimate is for display on the desktop,
// where it is already labelled, and must not overwrite a measurement here.
func usageFromEvent(e Event) (Usage, bool) {
	block, ok := e.Metadata["usage"].(map[string]any)
	if !ok || len(block) == 0 {
		return Usage{}, false
	}
	if estimated, _ := block["estimated"].(bool); estimated {
		return Usage{}, false
	}
	read := func(key string) uint64 {
		value, _ := block[key].(float64)
		return uint64(value)
	}
	return Usage{
		Input:    read("input"),
		Output:   read("output"),
		Cached:   read("cached"),
		Thinking: read("thinking"),
	}, true
}

func metadataString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	value, _ := metadata[key].(string)
	return value
}

func eventCapabilities(e Event) []string {
	out := []string{}
	raw := e.Metadata["capabilities"]
	switch values := raw.(type) {
	case []string:
		out = append(out, values...)
	case []any:
		for _, value := range values {
			if text, ok := value.(string); ok && text != "" {
				out = append(out, text)
			}
		}
	}
	return out
}

func mergeCapabilities(existing, incoming []string) []string {
	set := map[string]bool{}
	for _, value := range existing {
		if value != "" {
			set[value] = true
		}
	}
	for _, value := range incoming {
		if value != "" {
			set[value] = true
		}
	}
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func removeCapabilities(existing []string, values ...string) []string {
	remove := map[string]bool{}
	for _, value := range values {
		remove[value] = true
	}
	out := make([]string, 0, len(existing))
	for _, value := range existing {
		if value != "" && !remove[value] {
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

func (s *SessionStore) List() []Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Session, 0, len(s.sessions))
	for _, v := range s.sessions {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

func (s *SessionStore) Get(id string) (Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.sessions[id]
	return item, ok
}

func (s *SessionStore) Events(id string, limit int) []Event {
	s.mu.RLock()
	defer s.mu.RUnlock()
	history := s.histories[id]
	if limit <= 0 || limit > len(history) {
		limit = len(history)
	}
	start := len(history) - limit
	out := make([]Event, limit)
	copy(out, history[start:])
	return out
}

// PutDigest stores the desktop's short session summary. This is what a phone
// reads instead of replaying history: a few hundred characters rather than
// thousands of events, and it never contains file contents.
func (s *SessionStore) PutDigest(d SessionDigest) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.digests[d.SessionID] = d
	_ = s.persistLocked()
}

func (s *SessionStore) Digest(sessionID string) (SessionDigest, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d, ok := s.digests[sessionID]
	return d, ok
}

func (s *SessionStore) load() {
	if s.statePath == "" {
		return
	}
	data, err := os.ReadFile(s.statePath)
	if err != nil {
		return
	}
	var state sessionState
	if json.Unmarshal(data, &state) != nil {
		return
	}
	if state.Sessions != nil {
		s.sessions = state.Sessions
	}
	if state.Histories != nil {
		s.histories = state.Histories
	}
	if state.Digests != nil {
		s.digests = state.Digests
	}
}

func (s *SessionStore) persistLocked() error {
	if s.statePath == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.statePath), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(sessionState{Sessions: s.sessions, Histories: s.histories, Digests: s.digests}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.statePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.statePath)
}
