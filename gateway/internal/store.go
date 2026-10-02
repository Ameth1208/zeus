package internal

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const maxSessionEvents = 250

type sessionState struct {
	Sessions  map[string]Session `json:"sessions"`
	Histories map[string][]Event `json:"histories"`
}

type SessionStore struct {
	mu        sync.RWMutex
	sessions  map[string]Session
	histories map[string][]Event
	statePath string
}

func NewSessionStore() *SessionStore {
	return NewSessionStoreWithState("")
}

func NewSessionStoreWithState(statePath string) *SessionStore {
	s := &SessionStore{
		sessions:  map[string]Session{},
		histories: map[string][]Event{},
		statePath: statePath,
	}
	s.load()
	return s
}

func statusForEvent(kind string) string {
	switch kind {
	case "session.started", "thinking", "tool.started", "tool.completed", "tool.failed", "file.read", "file.changed", "command.started", "command.completed", "message", "heartbeat", "permission.resolved":
		return "working"
	case "permission.requested":
		return "waiting"
	case "session.completed":
		return "completed"
	case "session.failed":
		return "failed"
	case "agent.interrupted":
		return "interrupted"
	case "session.stopped":
		return "stopped"
	default:
		return "working"
	}
}

func (s *SessionStore) Apply(e Event) Session {
	s.mu.Lock()
	defer s.mu.Unlock()

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
	s.histories[e.SessionID] = history
	_ = s.persistLocked()
	return current
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
}

func (s *SessionStore) persistLocked() error {
	if s.statePath == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.statePath), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(sessionState{Sessions: s.sessions, Histories: s.histories}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.statePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.statePath)
}
