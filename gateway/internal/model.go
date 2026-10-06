package internal

import "time"

// Event is what a desktop uploads and the mobile app reads back.
//
// Kind is the canonical field and Type is the legacy alias the older adapters
// still send. postEvent folds one into the other, so a single status table can
// serve both without the wire format forking.
type Event struct {
	ID          string         `json:"id"`
	EventID     string         `json:"event_id,omitempty"`
	Kind        string         `json:"kind,omitempty"`
	Seq         uint64         `json:"seq,omitempty"`
	ExternalID  string         `json:"external_session_id,omitempty"`
	Timestamp   time.Time      `json:"timestamp"`
	SessionID   string         `json:"session_id"`
	AgentID     string         `json:"agent_id"`
	Runtime     string         `json:"runtime"`
	Provider    string         `json:"provider,omitempty"`
	Model       string         `json:"model,omitempty"`
	Project     string         `json:"project,omitempty"`
	MachineID   string         `json:"machine_id,omitempty"`
	MachineName string         `json:"machine_name,omitempty"`
	Type        string         `json:"type"`
	Message     string         `json:"message,omitempty"`
	Tool        string         `json:"tool,omitempty"`
	Path        string         `json:"path,omitempty"`
	Command     string         `json:"command,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type Session struct {
	ID               string    `json:"id"`
	ExternalID       string    `json:"external_session_id,omitempty"`
	LastSeq          uint64    `json:"last_seq,omitempty"`
	Usage            *Usage    `json:"usage,omitempty"`
	AgentID          string    `json:"agent_id"`
	Runtime          string    `json:"runtime"`
	Provider         string    `json:"provider,omitempty"`
	Model            string    `json:"model,omitempty"`
	Project          string    `json:"project,omitempty"`
	MachineID        string    `json:"machine_id,omitempty"`
	MachineName      string    `json:"machine_name,omitempty"`
	Status           string    `json:"status"`
	LastEvent        string    `json:"last_event"`
	UpdatedAt        time.Time `json:"updated_at"`
	Message          string    `json:"message,omitempty"`
	Capabilities     []string  `json:"capabilities,omitempty"`
	PendingRequestID string    `json:"pending_request_id,omitempty"`
}

// Usage mirrors the runtime-reported token counters. Estimated marks numbers
// produced by the local estimator, so a cost figure is never presented as
// measured.
type Usage struct {
	Input     uint64  `json:"input"`
	Output    uint64  `json:"output"`
	Cached    uint64  `json:"cached"`
	Thinking  uint64  `json:"thinking,omitempty"`
	Estimated bool    `json:"estimated,omitempty"`
	CostUSD   float64 `json:"cost_usd,omitempty"`
}

// SessionDigest is the short, replaceable summary the desktop keeps locally. It
// is what a phone reads instead of a replayed event history.
type SessionDigest struct {
	SessionID    string   `json:"session_id"`
	Goal         string   `json:"goal,omitempty"`
	Constraints  []string `json:"constraints,omitempty"`
	Decisions    []string `json:"decisions,omitempty"`
	ChangedFiles []string `json:"changed_files,omitempty"`
	Tests        []string `json:"tests,omitempty"`
	Pending      []string `json:"pending,omitempty"`
	LastSeq      uint64   `json:"last_seq"`
}

type Action struct {
	ID        string         `json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	SessionID string         `json:"session_id"`
	AgentID   string         `json:"agent_id"`
	Kind      string         `json:"kind"`
	Payload   map[string]any `json:"payload,omitempty"`
}

type PairStartResponse struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}

type PairCompleteRequest struct {
	Code       string `json:"code"`
	DeviceName string `json:"device_name"`
}

type PairCompleteResponse struct {
	DeviceID string `json:"device_id"`
	Token    string `json:"token"`
}
