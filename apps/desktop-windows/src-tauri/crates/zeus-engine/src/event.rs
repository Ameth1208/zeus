//! The normalized event every runtime is reduced to.
//!
//! Runtimes disagree wildly: Codex speaks JSON-RPC item notifications, Claude
//! emits `assistant`/`user` stream messages, agy emits `step_update`. The UI,
//! the gateway and the mobile app must not care, so each driver normalizes into
//! this one shape and everything downstream reads only these fields.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

/// The closed set of kinds Zeus understands. Anything a driver cannot map
/// lands on `agent.thinking` rather than inventing a kind, because the UI's
/// state machine and the gateway's `statusForEvent` are both finite tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventKind {
    #[serde(rename = "session.started")]
    SessionStarted,
    #[serde(rename = "session.completed")]
    SessionCompleted,
    #[serde(rename = "session.failed")]
    SessionFailed,
    #[serde(rename = "agent.thinking")]
    AgentThinking,
    #[serde(rename = "agent.message")]
    AgentMessage,
    #[serde(rename = "tool.started")]
    ToolStarted,
    #[serde(rename = "tool.completed")]
    ToolCompleted,
    #[serde(rename = "tool.failed")]
    ToolFailed,
    #[serde(rename = "permission.requested")]
    PermissionRequested,
    #[serde(rename = "permission.resolved")]
    PermissionResolved,
    #[serde(rename = "input.requested")]
    InputRequested,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::SessionStarted => "session.started",
            EventKind::SessionCompleted => "session.completed",
            EventKind::SessionFailed => "session.failed",
            EventKind::AgentThinking => "agent.thinking",
            EventKind::AgentMessage => "agent.message",
            EventKind::ToolStarted => "tool.started",
            EventKind::ToolCompleted => "tool.completed",
            EventKind::ToolFailed => "tool.failed",
            EventKind::PermissionRequested => "permission.requested",
            EventKind::PermissionResolved => "permission.resolved",
            EventKind::InputRequested => "input.requested",
        }
    }

    /// True for the kinds worth interrupting the user for. The gateway forwards
    /// exactly these to push, and nothing else.
    pub fn is_pushworthy(self) -> bool {
        matches!(
            self,
            EventKind::PermissionRequested
                | EventKind::InputRequested
                | EventKind::SessionCompleted
                | EventKind::SessionFailed
        )
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, EventKind::SessionCompleted | EventKind::SessionFailed)
    }
}

/// One normalized event. Field names are snake_case to match the gateway's
/// existing `Event` JSON so the wire format does not fork.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZeusEvent {
    pub event_id: String,
    pub session_id: String,
    pub runtime: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_session_id: Option<String>,
    /// Monotonic per session. The gateway rejects an event whose seq is not
    /// greater than the last one it saw, which is what makes duplicate and
    /// out-of-order delivery from reconnecting hooks harmless.
    pub seq: u64,
    /// Unix milliseconds.
    pub time: i64,
    pub kind: EventKind,
    #[serde(default)]
    pub payload: Value,
}

impl ZeusEvent {
    pub fn new(session_id: &str, runtime: &str, seq: u64, kind: EventKind) -> Self {
        Self {
            event_id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            runtime: runtime.to_string(),
            external_session_id: None,
            seq,
            time: now_ms(),
            kind,
            payload: json!({}),
        }
    }

    pub fn with_external(mut self, id: &str) -> Self {
        if !id.is_empty() {
            self.external_session_id = Some(id.to_string());
        }
        self
    }

    pub fn with_text(mut self, text: &str) -> Self {
        if !text.is_empty() {
            self.payload["text"] = json!(text);
        }
        self
    }

    pub fn with_tool(mut self, tool: &str) -> Self {
        if !tool.is_empty() {
            self.payload["tool"] = json!(tool);
        }
        self
    }

    pub fn with_field(mut self, key: &str, value: Value) -> Self {
        self.payload[key] = value;
        self
    }

    pub fn text(&self) -> &str {
        self.payload["text"].as_str().unwrap_or("")
    }

    pub fn tool(&self) -> &str {
        self.payload["tool"].as_str().unwrap_or("")
    }

    /// Short human line for the island ticker and mobile session cards. Kept
    /// short on purpose: this is the only text that ever leaves the machine.
    pub fn summary(&self) -> String {
        let text = self.text();
        match self.kind {
            EventKind::SessionStarted => "Session started".into(),
            EventKind::AgentThinking => "Thinking".into(),
            EventKind::AgentMessage => truncate(text, 160),
            EventKind::ToolStarted => {
                if self.tool().is_empty() {
                    "Using a tool".into()
                } else {
                    format!("Using {}", self.tool())
                }
            }
            EventKind::ToolCompleted => format!("{} finished", self.tool()),
            EventKind::ToolFailed => format!("{} failed", self.tool()),
            EventKind::PermissionRequested => truncate(text, 120),
            EventKind::PermissionResolved => "Approval resolved".into(),
            EventKind::InputRequested => truncate(text, 120),
            EventKind::SessionCompleted => "Task completed".into(),
            EventKind::SessionFailed => truncate(text, 160),
        }
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_never_invents_a_kind() {
        let e = ZeusEvent::new("s", "codex", 1, EventKind::ToolStarted).with_tool("rg");
        assert_eq!(e.summary(), "Using rg");
        assert_eq!(e.kind.as_str(), "tool.started");
    }

    #[test]
    fn only_attention_kinds_are_pushworthy() {
        assert!(EventKind::PermissionRequested.is_pushworthy());
        assert!(EventKind::SessionFailed.is_pushworthy());
        assert!(!EventKind::ToolStarted.is_pushworthy());
        assert!(!EventKind::AgentMessage.is_pushworthy());
    }

    #[test]
    fn serializes_kind_as_wire_string() {
        let e = ZeusEvent::new("s", "agy", 2, EventKind::AgentMessage).with_text("hi");
        let raw = serde_json::to_value(&e).unwrap();
        assert_eq!(raw["kind"], "agent.message");
        assert_eq!(raw["seq"], 2);
        assert_eq!(raw["payload"]["text"], "hi");
    }

    #[test]
    fn truncate_keeps_char_boundaries() {
        assert_eq!(truncate("abcdef", 4), "abc…");
        assert_eq!(truncate("abc", 4), "abc");
    }
}
