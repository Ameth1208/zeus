package internal

import "time"

type Event struct {
	ID          string         `json:"id"`
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
