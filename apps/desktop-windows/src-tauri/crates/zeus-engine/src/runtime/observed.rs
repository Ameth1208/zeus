//! Observed sessions — the user launched the CLI, Zeus only listens.
//!
//! The Python hooks in `adapters/` already translate each runtime's hook
//! vocabulary into Zeus event names. This module accepts that payload on a
//! loopback endpoint, re-numbers it into Zeus's own sequence space and feeds it
//! through the same bus as managed sessions, so the UI cannot tell the
//! difference and never needs a runtime-specific branch.
//!
//! Observed sessions deliberately expose no process controls. Zeus does not own
//! the process, so `stop` would be a lie; `Capability::Launch` and
//! `Capability::Stop` are absent and the island renders no such buttons.

use crate::event::{EventKind, ZeusEvent};
use crate::runtime::{
    AgentRuntimeDriver, Capabilities, Capability, DriverError, DriverResult, LaunchSpec, Mode,
    NormalizeCtx, RuntimeHandle,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// Payload the existing adapters already post (`/v1/events` shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookEvent {
    #[serde(default)]
    pub id: String,
    pub session_id: String,
    pub agent_id: String,
    pub runtime: String,
    #[serde(alias = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub machine_id: String,
    #[serde(default)]
    pub machine_name: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub metadata: Option<Value>,
    /// Supplied by the hook when available; the desktop assigns its own seq.
    #[serde(default)]
    pub seq: Option<u64>,
}

/// Legacy adapter event names, mapped onto the closed kind set.
///
/// `file.read` / `command.started` / `file.changed` are tool lifecycle in
/// disguise, so they fold into `tool.*` rather than growing the enum. The two
/// names with no counterpart (`agent.interrupted`, `session.stopped`) become
/// terminal events that carry the reason in their text, because inventing
/// `session.interrupted` would fork the contract three ways.
pub fn map_hook_kind(hook_type: &str) -> Option<(EventKind, &'static str)> {
    Some(match hook_type {
        "session.started" => (EventKind::SessionStarted, ""),
        "thinking" | "agent.thinking" => (EventKind::AgentThinking, ""),
        "message" | "agent.message" => (EventKind::AgentMessage, ""),
        "tool.started" => (EventKind::ToolStarted, ""),
        "tool.completed" => (EventKind::ToolCompleted, ""),
        "tool.failed" => (EventKind::ToolFailed, ""),
        "file.read" => (EventKind::ToolStarted, "read"),
        "command.started" => (EventKind::ToolStarted, "shell"),
        "command.completed" => (EventKind::ToolCompleted, "shell"),
        "file.changed" => (EventKind::ToolStarted, "edit"),
        "permission.requested" => (EventKind::PermissionRequested, ""),
        "permission.resolved" => (EventKind::PermissionResolved, ""),
        "session.completed" => (EventKind::SessionCompleted, ""),
        "session.failed" => (EventKind::SessionFailed, ""),
        "agent.interrupted" => (EventKind::SessionCompleted, ""),
        "session.stopped" => (EventKind::SessionCompleted, ""),
        // Not user-facing; the desktop already knows it is connected.
        "heartbeat" => return None,
        _ => return None,
    })
}

pub struct ObservedDriver {
    runtime: String,
}

impl ObservedDriver {
    pub fn new(runtime: &str) -> Self {
        Self {
            runtime: runtime.to_string(),
        }
    }

    /// Re-numbers a hook payload into the desktop's sequence space.
    pub fn convert(&self, hook: &HookEvent, seq: u64) -> Option<ZeusEvent> {
        let (kind, implied_tool) = map_hook_kind(&hook.kind)?;
        let mut event = ZeusEvent::new(&hook.session_id, &hook.runtime, seq, kind);
        event.external_session_id = hook
            .metadata
            .as_ref()
            .and_then(|m| m.get("native_session_id"))
            .and_then(Value::as_str)
            .map(str::to_string);

        let text = if hook.message.is_empty() {
            match kind {
                EventKind::SessionCompleted if hook.kind == "agent.interrupted" => {
                    "Interrupted".to_string()
                }
                EventKind::SessionCompleted if hook.kind == "session.stopped" => {
                    "Stopped".to_string()
                }
                _ => String::new(),
            }
        } else {
            hook.message.clone()
        };
        event = event.with_text(&text);

        let tool = if hook.tool.is_empty() {
            implied_tool
        } else {
            hook.tool.as_str()
        };
        if !tool.is_empty() {
            event = event.with_tool(tool);
        }
        if !hook.path.is_empty() {
            event = event.with_field("path", json!(hook.path));
        }
        if !hook.command.is_empty() {
            event = event.with_field("command", json!(hook.command));
        }
        if let Some(metadata) = hook.metadata.as_ref() {
            if let Some(request_id) = metadata.get("request_id").and_then(Value::as_str) {
                event = event.with_field("request_id", json!(request_id));
            }
            if let Some(decision) = metadata.get("decision").and_then(Value::as_str) {
                event = event.with_field("decision", json!(decision));
            }
            if let Some(usage) = metadata.get("usage") {
                event = event.with_field("usage", usage.clone());
            }
            event = event.with_field("agent_id", json!(hook.agent_id));
            if !hook.model.is_empty() {
                event = event.with_field("model", json!(hook.model));
            }
            if !hook.provider.is_empty() {
                event = event.with_field("provider", json!(hook.provider));
            }
            if !hook.project.is_empty() {
                event = event.with_field("project", json!(hook.project));
            }
        }
        Some(event)
    }

    /// What the island needs to describe this session's project and model.
    pub fn context_of(&self, hook: &HookEvent) -> (String, String) {
        (hook.project.clone(), hook.model.clone())
    }
}

impl AgentRuntimeDriver for ObservedDriver {
    fn name(&self) -> &'static str {
        "observed"
    }

    fn capabilities(&self) -> Capabilities {
        let mut set = BTreeSet::new();
        for cap in [Capability::Observe, Capability::ToolEvents] {
            set.insert(cap);
        }
        // Hooks can carry a permission request, so approvals are real here —
        // they are answered by the runtime's own hook, not by Zeus.
        set.insert(Capability::Approvals);
        Capabilities {
            runtime: self.runtime.clone(),
            mode: Mode::Observed,
            available: set,
            installed: true,
            version: None,
        }
    }

    fn detect(&self) -> bool {
        // An observed runtime is "present" when it reports in at all.
        true
    }

    fn launch(
        &self,
        _spec: LaunchSpec,
        _sink: std::sync::Arc<dyn crate::runtime::EventSink>,
    ) -> DriverResult<RuntimeHandle> {
        Err(DriverError::Unsupported("launch of an observed session"))
    }

    fn send(&self, _handle: &RuntimeHandle, _text: &str) -> DriverResult<()> {
        Err(DriverError::Unsupported("send to an observed session"))
    }

    fn interrupt(&self, _handle: &RuntimeHandle) -> DriverResult<()> {
        Err(DriverError::Unsupported("interrupt of an observed session"))
    }

    fn stop(&self, _handle: &RuntimeHandle) -> DriverResult<()> {
        Err(DriverError::Unsupported("stop of an observed session"))
    }

    fn resume(
        &self,
        _spec: LaunchSpec,
        _sink: std::sync::Arc<dyn crate::runtime::EventSink>,
    ) -> DriverResult<RuntimeHandle> {
        Err(DriverError::Unsupported("resume of an observed session"))
    }

    fn approve(
        &self,
        _handle: &RuntimeHandle,
        _request_id: &str,
        _allow: bool,
    ) -> DriverResult<()> {
        Err(DriverError::Unsupported("approval of an observed session"))
    }

    fn normalize(&self, raw: &Value, ctx: &NormalizeCtx) -> Vec<ZeusEvent> {
        serde_json::from_value::<HookEvent>(raw.clone())
            .ok()
            .and_then(|hook| self.convert(&hook, ctx.seq))
            .into_iter()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hook(kind: &str) -> HookEvent {
        HookEvent {
            id: String::new(),
            session_id: "host-1:codex:abc".into(),
            agent_id: "host-1:codex:abc".into(),
            runtime: "codex".into(),
            kind: kind.into(),
            provider: "openai".into(),
            model: "gpt-5".into(),
            project: "zeus".into(),
            machine_id: "host-1".into(),
            machine_name: "PC".into(),
            message: String::new(),
            tool: String::new(),
            path: String::new(),
            command: String::new(),
            metadata: None,
            seq: None,
        }
    }

    #[test]
    fn legacy_names_fold_into_the_closed_kind_set() {
        assert_eq!(
            map_hook_kind("file.read").unwrap(),
            (EventKind::ToolStarted, "read")
        );
        assert_eq!(
            map_hook_kind("command.started").unwrap(),
            (EventKind::ToolStarted, "shell")
        );
        assert_eq!(
            map_hook_kind("command.completed").unwrap(),
            (EventKind::ToolCompleted, "shell")
        );
        assert_eq!(
            map_hook_kind("file.changed").unwrap(),
            (EventKind::ToolStarted, "edit")
        );
        assert_eq!(
            map_hook_kind("thinking").unwrap(),
            (EventKind::AgentThinking, "")
        );
        assert_eq!(
            map_hook_kind("message").unwrap(),
            (EventKind::AgentMessage, "")
        );
    }

    #[test]
    fn heartbeats_and_unknowns_are_dropped() {
        assert!(map_hook_kind("heartbeat").is_none());
        assert!(map_hook_kind("telemetry.sample").is_none());
    }

    #[test]
    fn interrupt_and_stop_become_terminal_events_with_a_reason() {
        let driver = ObservedDriver::new("codex");
        let event = driver.convert(&hook("agent.interrupted"), 1).unwrap();
        assert_eq!(event.kind, EventKind::SessionCompleted);
        assert_eq!(event.text(), "Interrupted");

        let event = driver.convert(&hook("session.stopped"), 2).unwrap();
        assert_eq!(event.kind, EventKind::SessionCompleted);
        assert_eq!(event.text(), "Stopped");
    }

    #[test]
    fn a_permission_hook_keeps_its_request_id() {
        let driver = ObservedDriver::new("codex");
        let mut payload = hook("permission.requested");
        payload.message = "run cargo test".into();
        payload.metadata = Some(json!({"request_id": "codex-123", "decision": "allow"}));
        let event = driver.convert(&payload, 3).unwrap();
        assert_eq!(event.kind, EventKind::PermissionRequested);
        assert_eq!(event.payload["request_id"], "codex-123");
        assert_eq!(event.text(), "run cargo test");
    }

    #[test]
    fn observed_mode_exposes_no_process_controls() {
        let caps = ObservedDriver::new("claude-code").capabilities();
        assert_eq!(caps.mode, Mode::Observed);
        assert!(caps.has(Capability::Observe));
        assert!(!caps.has(Capability::Launch));
        assert!(!caps.has(Capability::Stop));
        assert!(!caps.has(Capability::Send));
    }

    #[test]
    fn desktop_assigned_seq_wins_over_the_hook_value() {
        let driver = ObservedDriver::new("codex");
        let mut payload = hook("thinking");
        payload.seq = Some(999);
        let event = driver.convert(&payload, 7).unwrap();
        assert_eq!(event.seq, 7);
    }
}
