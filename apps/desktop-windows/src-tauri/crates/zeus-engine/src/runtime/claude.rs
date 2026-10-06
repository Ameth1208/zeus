//! Claude driver — managed through Claude Code's structured stream interface.
//!
//! `claude -p --input-format stream-json --output-format stream-json` is the
//! same NDJSON protocol the Agent SDK speaks, driven from a shell instead of
//! from Node. That keeps the dependency list at zero and gives Zeus the whole
//! session lifecycle.
//!
//! Verified message vocabulary:
//!
//! ```text
//! {"type":"system","subtype":"init","session_id":..,"model":..,"tools":[..],"cwd":..}
//! {"type":"assistant","message":{"content":[{"type":"text","text":..} |
//!                                             {"type":"tool_use","name":..,"input":..}]}}
//! {"type":"user","message":{"content":[{"type":"tool_result",..}]}}
//! {"type":"result","subtype":"success","result":..,"usage":{..}}
//! ```
//!
//! On approvals: print mode resolves permissions itself, so this driver does
//! **not** advertise `Capability::Approvals` for managed sessions. Claude's
//! observed mode (the hooks in `adapters/claude-code/`) does support remote
//! approvals and is registered separately. Claiming the capability here would
//! put an Allow button in front of a user whose click goes nowhere.

use crate::event::{EventKind, ZeusEvent};
use crate::runtime::stdio::{pump_lines, spawn_ndjson, usage_from, StreamProc};
use crate::runtime::{
    AgentRuntimeDriver, Capabilities, Capability, DriverError, DriverResult, EventSink, LaunchSpec,
    Mode, NormalizeCtx, RuntimeHandle,
};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

pub struct ClaudeDriver {
    /// Detection is expensive and stable, so cache it.
    detected: std::sync::Mutex<Option<bool>>,
    binary: String,
    procs: Mutex<HashMap<String, Arc<StreamProc>>>,
    /// assistant tool_use id -> tool name, so the matching tool_result can be
    /// matched back to a tool that started earlier.
    open_tools: Arc<Mutex<HashMap<String, String>>>,
}

impl Default for ClaudeDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeDriver {
    pub fn new() -> Self {
        Self {
            detected: std::sync::Mutex::new(None),
            binary: std::env::var("ZEUS_CLAUDE_BIN").unwrap_or_else(|_| "claude".into()),
            procs: Mutex::new(HashMap::new()),
            open_tools: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn proc(&self, session_id: &str) -> DriverResult<Arc<StreamProc>> {
        self.procs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .cloned()
            .ok_or_else(|| DriverError::Failed("claude session is not running".into()))
    }

    fn spawn(
        &self,
        spec: LaunchSpec,
        resume_from: Option<String>,
        sink: Arc<dyn EventSink>,
    ) -> DriverResult<RuntimeHandle> {
        let session_id = format!("claude-{}", uuid::Uuid::new_v4());
        let mut args: Vec<String> = vec![
            "-p".into(),
            "--input-format".into(),
            "stream-json".into(),
            "--output-format".into(),
            "stream-json".into(),
            "--verbose".into(),
            // Print mode owns permissions; Zeus never sees them.
            "--permission-mode".into(),
            "acceptEdits".into(),
        ];
        if let Some(session) = resume_from.as_ref() {
            args.push("--resume".into());
            args.push(session.clone());
        }
        if let Some(model) = spec.model.as_ref() {
            args.push("--model".into());
            args.push(model.clone());
        }

        let (proc, stdout) = spawn_ndjson(&self.binary, &args, &spec.cwd)
            .map_err(|e| DriverError::Failed(format!("cannot start claude: {e}")))?;
        let proc = Arc::new(proc);
        let pid = proc.pid();
        self.procs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(session_id.clone(), proc.clone());

        pump_lines(stdout, {
            let sink = sink.clone();
            let session_id = session_id.clone();
            let open_tools = self.open_tools.clone();
            move |value| {
                let seq = sink.next_seq(&session_id);
                let tool_label = value
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(Value::as_array)
                    .and_then(|blocks| {
                        blocks.iter().find_map(|b| {
                            if b["type"].as_str() != Some("tool_result") {
                                return None;
                            }
                            b["tool_use_id"]
                                .as_str()
                                .and_then(|id| lookup(&open_tools, id))
                        })
                    });
                let ctx = NormalizeCtx {
                    session_id: session_id.clone(),
                    runtime: "claude".into(),
                    seq,
                    external_session_id: value["session_id"].as_str().map(str::to_string),
                    conversation_id: None,
                    model: value["message"]["model"].as_str().map(str::to_string),
                    tool_label,
                };
                for event in claude_normalize(&value, &ctx) {
                    // Remember tool ids so a later tool_result can be named.
                    if event.kind == EventKind::ToolStarted {
                        if let Some(id) = event.payload["tool_use_id"].as_str() {
                            open_tools
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .insert(id.to_string(), event.tool().to_string());
                        }
                    }
                    if event.kind == EventKind::ToolCompleted || event.kind == EventKind::ToolFailed
                    {
                        if let Some(id) = event.payload["tool_use_id"].as_str() {
                            open_tools
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .remove(id);
                        }
                    }
                    sink.publish(event);
                }
            }
        });

        if let Some(prompt) = spec.prompt.as_ref() {
            proc.send_line(&json!({
                "type": "user",
                "message": {"role": "user", "content": [{"type": "text", "text": prompt}]}
            }));
        }
        Ok(RuntimeHandle {
            session_id,
            runtime: "claude".into(),
            pid,
        })
    }
}

impl AgentRuntimeDriver for ClaudeDriver {
    fn name(&self) -> &'static str {
        "claude"
    }

    fn capabilities(&self) -> Capabilities {
        let mut set = BTreeSet::new();
        for cap in [
            Capability::Launch,
            Capability::Observe,
            Capability::Send,
            Capability::Stop,
            Capability::Resume,
            Capability::ToolEvents,
            Capability::Usage,
            Capability::ModelInfo,
            Capability::Subagents,
        ] {
            set.insert(cap);
        }
        Capabilities {
            runtime: "claude".into(),
            mode: Mode::Managed,
            available: set,
            installed: self.detect(),
            version: None,
        }
    }

    fn detect(&self) -> bool {
        let mut cached = self.detected.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(value) = *cached {
            return value;
        }
        // Called on a UI refresh tick, so it must never open a console window
        // and must never spawn the binary more than once per process run.
        let found = crate::runtime::stdio::probe(&self.binary, &["--version"]);
        *cached = Some(found);
        found
    }

    fn launch(&self, spec: LaunchSpec, sink: Arc<dyn EventSink>) -> DriverResult<RuntimeHandle> {
        self.spawn(spec, None, sink)
    }

    fn send(&self, handle: &RuntimeHandle, text: &str) -> DriverResult<()> {
        let proc = self.proc(&handle.session_id)?;
        proc.send_line(&json!({
            "type": "user",
            "message": {"role": "user", "content": [{"type": "text", "text": text}]}
        }));
        Ok(())
    }

    /// Print mode has no documented per-turn interrupt over NDJSON, so this is
    /// reported as unsupported rather than faked with a kill.
    fn interrupt(&self, _handle: &RuntimeHandle) -> DriverResult<()> {
        Err(DriverError::Unsupported("interrupt"))
    }

    fn stop(&self, handle: &RuntimeHandle) -> DriverResult<()> {
        let proc = self.proc(&handle.session_id)?;
        proc.kill();
        self.procs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&handle.session_id);
        Ok(())
    }

    fn resume(&self, spec: LaunchSpec, sink: Arc<dyn EventSink>) -> DriverResult<RuntimeHandle> {
        let resume_from = spec
            .resume_from
            .clone()
            .ok_or(DriverError::Unsupported("resume without a prior session"))?;
        self.spawn(spec, Some(resume_from), sink)
    }

    fn approve(
        &self,
        _handle: &RuntimeHandle,
        _request_id: &str,
        _allow: bool,
    ) -> DriverResult<()> {
        Err(DriverError::Unsupported("approvals"))
    }

    fn normalize(&self, raw: &Value, ctx: &NormalizeCtx) -> Vec<ZeusEvent> {
        claude_normalize(raw, ctx)
    }
}

/// Looks up a remembered tool label. Shared with the reader thread, which owns
/// the same map.
pub fn lookup(map: &Mutex<HashMap<String, String>>, key: &str) -> Option<String> {
    map.lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(key)
        .cloned()
}

/// Pure normalizer. One assistant message can carry both prose and tool calls,
/// so it maps to several events — text first, then each tool.
pub fn claude_normalize(raw: &Value, ctx: &NormalizeCtx) -> Vec<ZeusEvent> {
    let message_type = raw.get("type").and_then(Value::as_str).unwrap_or("");
    let mut out: Vec<ZeusEvent> = Vec::new();

    let make = |kind: EventKind| {
        let mut event = ZeusEvent::new(&ctx.session_id, "claude", ctx.seq, kind);
        if let Some(external) = &ctx.external_session_id {
            event = event.with_external(external);
        }
        event
    };

    match message_type {
        "system" => {
            let subtype = raw["subtype"].as_str().unwrap_or("");
            if subtype == "init" {
                out.push(make(EventKind::SessionStarted));
            }
        }
        "assistant" => {
            let content = &raw["message"]["content"];
            // Prose and tool calls can coexist in one message; emit the prose
            // first so the ticker reads naturally, then each tool.
            if let Some(text) = first_text(content) {
                if !text.is_empty() {
                    out.push(make(EventKind::AgentMessage).with_text(&text));
                }
            }
            for call in tool_calls(content) {
                let name = call["name"].as_str().unwrap_or("tool");
                let mut event = make(EventKind::ToolStarted).with_tool(display_tool(name));
                if let Some(path) = tool_path(name, &call["input"]) {
                    event = event.with_field("path", json!(path));
                }
                if let Some(command) = tool_command(name, &call["input"]) {
                    event = event.with_field("command", json!(command));
                }
                if let Some(id) = call["id"].as_str() {
                    event = event.with_field("tool_use_id", json!(id));
                }
                out.push(event);
            }
            if out.is_empty() {
                // An assistant message with no text and no tools is a heartbeat
                // (e.g. a thinking block); thinking is the honest mapping.
                out.push(make(EventKind::AgentThinking));
            }
        }
        "user" => {
            for result in tool_results(&raw["message"]["content"]) {
                let failed = result["is_error"].as_bool().unwrap_or(false);
                let tool_use_id = result["tool_use_id"].as_str().unwrap_or("");
                let mut event = make(if failed {
                    EventKind::ToolFailed
                } else {
                    EventKind::ToolCompleted
                })
                .with_tool(ctx.tool_label.as_deref().unwrap_or("tool"));
                if !tool_use_id.is_empty() {
                    event = event.with_field("tool_use_id", json!(tool_use_id));
                }
                if failed {
                    if let Some(text) = first_text(&result["content"]) {
                        event = event.with_text(&crate::event::truncate(&text, 300));
                    }
                }
                out.push(event);
            }
        }
        "result" => {
            let subtype = raw["subtype"].as_str().unwrap_or("success");
            let is_error =
                subtype.starts_with("error") || raw["is_error"].as_bool().unwrap_or(false);
            let mut event = make(if is_error {
                EventKind::SessionFailed
            } else {
                EventKind::SessionCompleted
            });
            if is_error {
                let text = raw["result"].as_str().unwrap_or("claude reported an error");
                event = event.with_text(&crate::event::truncate(text, 300));
            }
            if let Some(usage) = usage_from(raw) {
                event = event.with_field(
                    "usage",
                    json!({"input": usage.input, "output": usage.output, "cached": usage.cached}),
                );
            }
            if let Some(cost) = raw["total_cost_usd"].as_f64() {
                event = event.with_field("cost_usd", json!(cost));
            }
            out.push(event);
        }
        _ => {}
    }
    out
}

fn content_blocks(content: &Value) -> Vec<Value> {
    content
        .as_array()
        .map(|a| a.iter().filter(|v| v.is_object()).cloned().collect())
        .unwrap_or_default()
}

fn first_text(content: &Value) -> Option<String> {
    // Content is either a plain string or a block list.
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    let mut joined = String::new();
    for block in content_blocks(content) {
        if block["type"].as_str() == Some("text") {
            if let Some(text) = block["text"].as_str() {
                joined.push_str(text);
            }
        }
    }
    if joined.is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn tool_calls(content: &Value) -> Vec<Value> {
    content_blocks(content)
        .into_iter()
        .filter(|b| b["type"].as_str() == Some("tool_use"))
        .collect()
}

fn tool_results(content: &Value) -> Vec<Value> {
    content_blocks(content)
        .into_iter()
        .filter(|b| b["type"].as_str() == Some("tool_result"))
        .collect()
}

/// Which tool name to show. The runtime's own name is more informative than a
/// generic label, so it is kept except where a Zeus-level name is clearer.
fn display_tool(name: &str) -> &'static str {
    match name {
        "Bash" | "BashOutput" | "KillShell" => "shell",
        "Read" | "NotebookRead" => "read",
        "Glob" | "Grep" => "search",
        "Edit" | "Write" | "NotebookEdit" | "MultiEdit" => "edit",
        "WebFetch" | "WebSearch" => "web",
        "Task" | "Agent" => "subagent",
        "TodoWrite" | "TaskCreate" | "TaskUpdate" | "TaskList" => "plan",
        _ => "tool",
    }
}

fn tool_path(name: &str, input: &Value) -> Option<String> {
    let _ = name;
    input
        .get("file_path")
        .or_else(|| input.get("notebook_path"))
        .or_else(|| input.get("path"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn tool_command(_name: &str, input: &Value) -> Option<String> {
    input
        .get("command")
        .and_then(Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> NormalizeCtx {
        NormalizeCtx {
            session_id: "s".into(),
            runtime: "claude".into(),
            seq: 1,
            external_session_id: Some("nat-1".into()),
            ..Default::default()
        }
    }

    #[test]
    fn system_init_starts_the_session() {
        let raw = json!({"type": "system", "subtype": "init", "session_id": "nat-1",
                         "model": "claude-opus-5", "cwd": "/tmp"});
        let out = claude_normalize(&raw, &ctx());
        assert_eq!(out[0].kind, EventKind::SessionStarted);
        assert_eq!(out[0].external_session_id.as_deref(), Some("nat-1"));
    }

    #[test]
    fn assistant_text_becomes_agent_message() {
        let raw = json!({
            "type": "assistant",
            "session_id": "nat-1",
            "message": {"content": [{"type": "text", "text": "Done."}]}
        });
        let out = claude_normalize(&raw, &ctx());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, EventKind::AgentMessage);
        assert_eq!(out[0].text(), "Done.");
    }

    #[test]
    fn assistant_message_with_text_and_tools_emits_both_in_order() {
        let raw = json!({
            "type": "assistant",
            "message": {"content": [
                {"type": "text", "text": "Let me check."},
                {"type": "tool_use", "id": "t1", "name": "Bash",
                 "input": {"command": "cargo test"}},
                {"type": "tool_use", "id": "t2", "name": "Read",
                 "input": {"file_path": "src/main.rs"}}
            ]}
        });
        let out = claude_normalize(&raw, &ctx());
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].kind, EventKind::AgentMessage);
        assert_eq!(out[1].kind, EventKind::ToolStarted);
        assert_eq!(out[1].tool(), "shell");
        assert_eq!(out[1].payload["command"], "cargo test");
        assert_eq!(out[2].tool(), "read");
        assert_eq!(out[2].payload["path"], "src/main.rs");
    }

    #[test]
    fn tool_results_complete_their_tool() {
        let ok = json!({"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}});
        assert_eq!(
            claude_normalize(&ok, &ctx())[0].kind,
            EventKind::ToolCompleted
        );

        let bad = json!({"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "is_error": true,
             "content": "exit 1"}]}});
        let out = claude_normalize(&bad, &ctx());
        assert_eq!(out[0].kind, EventKind::ToolFailed);
        assert_eq!(out[0].text(), "exit 1");
    }

    #[test]
    fn thinking_only_message_maps_to_thinking_not_a_message() {
        let raw = json!({"type": "assistant", "message": {"content": [
            {"type": "thinking", "thinking": "internal"}]}});
        let out = claude_normalize(&raw, &ctx());
        assert_eq!(out[0].kind, EventKind::AgentThinking);
    }

    #[test]
    fn result_success_and_error_map_to_terminal_kinds_with_usage() {
        let ok = json!({"type": "result", "subtype": "success", "result": "done",
                        "usage": {"input_tokens": 100, "output_tokens": 20,
                                  "cache_read_input_tokens": 80}});
        let out = claude_normalize(&ok, &ctx());
        assert_eq!(out[0].kind, EventKind::SessionCompleted);
        assert_eq!(out[0].payload["usage"]["cached"], 80);

        let bad = json!({"type": "result", "subtype": "error_max_turns",
                         "result": "hit the turn limit"});
        assert_eq!(
            claude_normalize(&bad, &ctx())[0].kind,
            EventKind::SessionFailed
        );
    }

    #[test]
    fn managed_claude_does_not_advertise_approvals() {
        let caps = ClaudeDriver::new().capabilities();
        assert!(caps.has(Capability::Launch));
        assert!(caps.has(Capability::Resume));
        assert!(!caps.has(Capability::Approvals));
        assert!(!caps.has(Capability::Interrupt));
    }

    #[test]
    fn unsupported_controls_report_unsupported_not_failure() {
        let driver = ClaudeDriver::new();
        let handle = RuntimeHandle {
            session_id: "nope".into(),
            runtime: "claude".into(),
            pid: None,
        };
        assert!(matches!(
            driver.interrupt(&handle),
            Err(DriverError::Unsupported("interrupt"))
        ));
        assert!(matches!(
            driver.approve(&handle, "r", true),
            Err(DriverError::Unsupported("approvals"))
        ));
    }

    #[test]
    fn display_tool_names_are_stable() {
        assert_eq!(display_tool("Bash"), "shell");
        assert_eq!(display_tool("Task"), "subagent");
        assert_eq!(display_tool("Mystery"), "tool");
    }
}
