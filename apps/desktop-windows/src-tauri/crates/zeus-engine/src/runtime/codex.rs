//! Codex driver — managed via `codex app-server`.
//!
//! `app-server` is a stdio JSON-RPC 2.0 server. Verified surface used here:
//!
//! ```text
//! → initialize                          { clientInfo }
//! → thread/start                        { cwd, model }
//! → thread/resume                       { threadId }
//! → turn/start                          { threadId, input }
//! → turn/interrupt                      { threadId }
//! ← item/agentMessage/delta             streaming assistant text
//! ← item/started | item/completed       tool lifecycle
//! ← item/commandExecution/requestApproval   server → client request
//! ← item/fileChange/requestApproval
//! ← item/tool/requestUserInput
//! ← turn/started | turn/completed | error
//! ```
//!
//! Approvals arrive as JSON-RPC *requests* carrying an id, so answering one
//! requires a reply with that same id. Zeus keys pending approvals by its own
//! `request_id` and keeps the RPC id alongside, otherwise the reply has nowhere
//! to go.

use crate::event::{EventKind, ZeusEvent};
use crate::runtime::{
    AgentRuntimeDriver, Capabilities, Capability, DriverError, DriverResult, EventSink, LaunchSpec,
    Mode, NormalizeCtx, RuntimeHandle,
};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

pub struct CodexDriver {
    /// Detection is expensive and stable, so cache it.
    detected: std::sync::Mutex<Option<bool>>,
    binary: String,
    /// Live processes by session. Only the supervisor holds a `Child`; the UI
    /// reaches a session through `RuntimeHandle`, never through this map.
    procs: Mutex<HashMap<String, Arc<CodexProc>>>,
}

struct CodexProc {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    /// Zeus request id -> JSON-RPC id awaiting our reply.
    approvals: Mutex<HashMap<String, i64>>,
    next_rpc: Mutex<i64>,
    /// Thread id learned from `thread/started`; needed before the first turn.
    thread_id: Mutex<Option<String>>,
    /// A prompt supplied at launch that waits for the thread id.
    pending_prompt: Mutex<Option<String>>,
}

impl CodexProc {
    fn write_frame(&self, frame: Value) {
        let mut out = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(stdin) = out.as_mut() {
            if let Ok(line) = serde_json::to_string(&frame) {
                let _ = writeln!(stdin, "{line}");
                let _ = stdin.flush();
            }
        }
    }

    fn call(&self, method: &str, params: Value) -> i64 {
        let mut counter = self.next_rpc.lock().unwrap_or_else(|e| e.into_inner());
        *counter += 1;
        self.write_frame(
            json!({"jsonrpc": "2.0", "id": *counter, "method": method, "params": params}),
        );
        *counter
    }

    fn notify(&self, method: &str, params: Value) {
        self.write_frame(json!({"jsonrpc": "2.0", "method": method, "params": params}));
    }

    fn reply(&self, rpc_id: i64, result: Value) {
        self.write_frame(json!({"jsonrpc": "2.0", "id": rpc_id, "result": result}));
    }

    fn start_turn(&self, prompt: &str) -> bool {
        let thread_id = self
            .thread_id
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        match thread_id {
            Some(thread_id) => {
                self.call(
                    "turn/start",
                    json!({"threadId": thread_id, "input": [{"type": "text", "text": prompt}]}),
                );
                true
            }
            None => {
                *self
                    .pending_prompt
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(prompt.to_string());
                false
            }
        }
    }
}

impl Default for CodexDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl CodexDriver {
    pub fn new() -> Self {
        Self {
            detected: std::sync::Mutex::new(None),
            binary: std::env::var("ZEUS_CODEX_BIN").unwrap_or_else(|_| "codex".into()),
            procs: Mutex::new(HashMap::new()),
        }
    }

    fn proc(&self, session_id: &str) -> DriverResult<Arc<CodexProc>> {
        self.procs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .cloned()
            .ok_or_else(|| DriverError::Failed("codex session is not running".into()))
    }

    fn spawn(
        &self,
        spec: LaunchSpec,
        resume_from: Option<String>,
        sink: Arc<dyn EventSink>,
    ) -> DriverResult<RuntimeHandle> {
        let session_id = format!("codex-{}", uuid::Uuid::new_v4());

        let mut command = Command::new(&self.binary);
        command
            .arg("app-server")
            .current_dir(&spec.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        crate::runtime::stdio::without_console_window_pub(&mut command);
        let mut child = command
            .spawn()
            .map_err(|e| DriverError::Failed(format!("cannot start codex: {e}")))?;
        let pid = child.id();
        let stdin = child.stdin.take();
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| DriverError::Failed("codex stdout unavailable".into()))?;

        let proc = Arc::new(CodexProc {
            child: Mutex::new(Some(child)),
            stdin: Mutex::new(stdin),
            approvals: Mutex::new(HashMap::new()),
            next_rpc: Mutex::new(0),
            thread_id: Mutex::new(None),
            pending_prompt: Mutex::new(None),
        });
        self.procs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(session_id.clone(), proc.clone());

        let reader = CodexReader {
            sink: sink.clone(),
            session_id: session_id.clone(),
            proc: proc.clone(),
        };
        std::thread::spawn(move || reader.run(stdout));

        proc.call(
            "initialize",
            json!({"clientInfo": {"name": "zeus", "title": "Zeus", "version": env!("CARGO_PKG_VERSION")}}),
        );
        proc.notify("initialized", json!({}));

        if let Some(thread_id) = resume_from {
            // Resuming means joining an existing conversation, so the thread is
            // loaded first and no launch prompt is sent.
            proc.call("thread/resume", json!({"threadId": thread_id}));
        } else {
            let mut params = json!({"cwd": spec.cwd.to_string_lossy()});
            if let Some(model) = &spec.model {
                params["model"] = json!(model);
            }
            proc.call("thread/start", params);
        }

        if let Some(prompt) = &spec.prompt {
            proc.start_turn(prompt);
        }

        Ok(RuntimeHandle {
            session_id,
            runtime: "codex".into(),
            pid: Some(pid),
        })
    }
}

struct CodexReader {
    sink: Arc<dyn EventSink>,
    session_id: String,
    proc: Arc<CodexProc>,
}

impl CodexReader {
    fn run(self, stdout: std::process::ChildStdout) {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(raw) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            self.handle(&raw);
        }
        // Reader hit EOF: either the turn ended or the process died. A crash is
        // reported so the UI shows a failure instead of an idle mascot.
        let crashed = self
            .proc
            .child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
            .map(|c| matches!(c.try_wait(), Ok(Some(_))))
            .unwrap_or(false);
        let seq = self.sink.next_seq(&self.session_id);
        let mut ctx = NormalizeCtx {
            session_id: self.session_id.clone(),
            runtime: "codex".into(),
            seq,
            ..Default::default()
        };
        if let Some(thread_id) = self
            .proc
            .thread_id
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        {
            ctx.external_session_id = Some(thread_id);
        }
        let kind = if crashed {
            EventKind::SessionFailed
        } else {
            EventKind::SessionCompleted
        };
        let mut event = ZeusEvent::new(&ctx.session_id, "codex", ctx.seq, kind)
            .with_external(ctx.external_session_id.as_deref().unwrap_or(""));
        if kind == EventKind::SessionFailed {
            event = event.with_text("codex exited unexpectedly");
        }
        self.sink.publish(event);
    }

    fn handle(&self, raw: &Value) {
        let method = raw.get("method").and_then(Value::as_str).unwrap_or("");

        // Lifecycle bookkeeping that must happen before normalization.
        if method == "thread/started" {
            let thread_id = raw["params"]["thread"]["id"]
                .as_str()
                .or_else(|| raw["params"]["threadId"].as_str())
                .map(str::to_string);
            if let Some(id) = &thread_id {
                *self
                    .proc
                    .thread_id
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(id.clone());
                let prompt = self
                    .proc
                    .pending_prompt
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take();
                if let Some(prompt) = prompt {
                    self.proc.start_turn(&prompt);
                }
            }
        }

        let seq = self.sink.next_seq(&self.session_id);
        let ctx = NormalizeCtx {
            session_id: self.session_id.clone(),
            runtime: "codex".into(),
            seq,
            external_session_id: self
                .proc
                .thread_id
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            model: None,
            conversation_id: None,
            tool_label: None,
        };

        for event in codex_normalize(raw, &ctx) {
            // Remember the RPC id so approve() can answer the right request.
            if event.kind == EventKind::PermissionRequested {
                if let (Some(request_id), Some(rpc_id)) = (
                    event.payload["request_id"].as_str(),
                    event.payload["rpc_id"].as_i64(),
                ) {
                    self.proc
                        .approvals
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(request_id.to_string(), rpc_id);
                }
            }
            if matches!(
                event.kind,
                EventKind::SessionCompleted | EventKind::SessionFailed
            ) {
                self.proc
                    .approvals
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clear();
            }
            self.sink.publish(event);
        }
    }
}

impl AgentRuntimeDriver for CodexDriver {
    fn name(&self) -> &'static str {
        "codex"
    }

    fn capabilities(&self) -> Capabilities {
        let mut set = BTreeSet::new();
        for cap in [
            Capability::Launch,
            Capability::Observe,
            Capability::Send,
            Capability::Interrupt,
            Capability::Stop,
            Capability::Resume,
            Capability::Approvals,
            Capability::ToolEvents,
            Capability::Usage,
            Capability::ModelInfo,
            Capability::Subagents,
        ] {
            set.insert(cap);
        }
        let installed = self.detect();
        Capabilities {
            runtime: "codex".into(),
            mode: Mode::Managed,
            available: set,
            installed,
            version: None,
        }
    }

    fn binary_name(&self) -> &'static str {
        "codex"
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
        if !proc.start_turn(text) {
            return Err(DriverError::Failed("codex thread is not ready".into()));
        }
        Ok(())
    }

    fn interrupt(&self, handle: &RuntimeHandle) -> DriverResult<()> {
        let proc = self.proc(&handle.session_id)?;
        let Some(thread_id) = proc
            .thread_id
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        else {
            return Err(DriverError::Failed("codex thread is not ready".into()));
        };
        proc.call("turn/interrupt", json!({"threadId": thread_id}));
        Ok(())
    }

    fn stop(&self, handle: &RuntimeHandle) -> DriverResult<()> {
        let proc = self.proc(&handle.session_id)?;
        if let Ok(mut guard) = proc.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
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

    fn approve(&self, handle: &RuntimeHandle, request_id: &str, allow: bool) -> DriverResult<()> {
        let proc = self.proc(&handle.session_id)?;
        let rpc_id = {
            let map = proc.approvals.lock().unwrap_or_else(|e| e.into_inner());
            map.get(request_id).copied()
        };
        let Some(rpc_id) = rpc_id else {
            // The runtime moved on. Surfaced as a failure so nobody assumes the
            // action was approved.
            return Err(DriverError::Failed(format!(
                "codex request {request_id} is no longer pending"
            )));
        };
        let decision = if allow { "approved" } else { "denied" };
        proc.reply(
            rpc_id,
            json!({
                "decision": decision,
                "reason": if allow { "allowed from Zeus" } else { "denied from Zeus" },
            }),
        );
        proc.approvals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(request_id);
        Ok(())
    }

    fn cancel_approval(&self, handle: &RuntimeHandle, request_id: &str) {
        if let Ok(proc) = self.proc(&handle.session_id) {
            proc.approvals
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(request_id);
        }
    }

    fn normalize(&self, raw: &Value, ctx: &NormalizeCtx) -> Vec<ZeusEvent> {
        codex_normalize(raw, ctx)
    }
}

/// Pure normalizer, shared by the live reader and the cross-runtime parity
/// tests. Everything unknown is dropped rather than guessed at.
pub fn codex_normalize(raw: &Value, ctx: &NormalizeCtx) -> Vec<ZeusEvent> {
    let method = raw.get("method").and_then(Value::as_str).unwrap_or("");
    let params = raw.get("params").cloned().unwrap_or_else(|| json!({}));
    let rpc_id = raw.get("id").and_then(Value::as_i64);

    let base = |kind: EventKind| -> ZeusEvent {
        ZeusEvent::new(&ctx.session_id, "codex", ctx.seq, kind)
            .with_external(ctx.external_session_id.as_deref().unwrap_or(""))
    };

    match method {
        "thread/started" => {
            let thread_id = params["thread"]["id"]
                .as_str()
                .or_else(|| params["threadId"].as_str())
                .unwrap_or("");
            let mut event = base(EventKind::SessionStarted);
            if !thread_id.is_empty() {
                event.external_session_id = Some(thread_id.to_string());
            }
            vec![event]
        }
        "turn/started" => vec![base(EventKind::AgentThinking)],
        "item/agentMessage/delta" => {
            let delta = params["delta"].as_str().unwrap_or("");
            vec![base(EventKind::AgentMessage).with_text(delta)]
        }
        // Reasoning text is not user-facing; it maps to thinking and its
        // content is dropped so no internal monologue reaches the UI.
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            vec![base(EventKind::AgentThinking)]
        }
        "item/started" => {
            let item = &params["item"];
            let (kind, tool) = item_tool(item);
            let mut event = base(kind).with_tool(tool);
            if let Some(path) = item_path(item) {
                event = event.with_field("path", json!(path));
            }
            if let Some(command) = item_command(item) {
                event = event.with_field("command", json!(command));
            }
            vec![event]
        }
        "item/completed" => {
            let item = &params["item"];
            let failed = item_failed(item);
            let (_, tool) = item_tool(item);
            let mut event = base(if failed {
                EventKind::ToolFailed
            } else {
                EventKind::ToolCompleted
            })
            .with_tool(tool);
            if let Some(path) = item_path(item) {
                event = event.with_field("path", json!(path));
            }
            if failed {
                if let Some(output) = item["aggregatedOutput"].as_str() {
                    event = event.with_text(&crate::event::truncate(output, 400));
                }
            }
            vec![event]
        }
        "turn/completed" => {
            let status = params["status"].as_str().unwrap_or("completed");
            let failed = status == "failed" || status == "error";
            let event = base(if failed {
                EventKind::SessionFailed
            } else {
                EventKind::SessionCompleted
            });
            vec![if failed {
                event.with_text("turn failed")
            } else {
                event
            }]
        }
        "error" => {
            let message = params["message"].as_str().unwrap_or("codex error");
            vec![base(EventKind::SessionFailed).with_text(&crate::event::truncate(message, 300))]
        }
        "item/commandExecution/requestApproval"
        | "item/fileChange/requestApproval"
        | "item/permissions/requestApproval"
        | "execCommandApproval"
        | "applyPatchApproval" => {
            let mut event = base(EventKind::PermissionRequested);
            if let Some(id) = rpc_id {
                event = event.with_field("rpc_id", json!(id));
            }
            event = event
                .with_field(
                    "request_id",
                    json!(format!("codex-{}", uuid::Uuid::new_v4())),
                )
                .with_text(&approval_summary(method, &params));
            vec![event]
        }
        "item/tool/requestUserInput" => {
            let question = params["question"].as_str().unwrap_or("Zeus needs input");
            let mut event = base(EventKind::InputRequested);
            if let Some(id) = rpc_id {
                event = event.with_field("rpc_id", json!(id));
            }
            event = event
                .with_field(
                    "request_id",
                    json!(format!("codex-{}", uuid::Uuid::new_v4())),
                )
                .with_text(&crate::event::truncate(question, 200));
            vec![event]
        }
        _ => Vec::new(),
    }
}

fn item_tool(item: &Value) -> (EventKind, &'static str) {
    match item["type"].as_str().unwrap_or("") {
        "commandExecution" | "localShellCall" => (EventKind::ToolStarted, "shell"),
        "fileChange" => (EventKind::ToolStarted, "edit"),
        "mcpToolCall" => (EventKind::ToolStarted, "mcp"),
        "webSearch" => (EventKind::ToolStarted, "web_search"),
        "reasoning" => (EventKind::AgentThinking, ""),
        _ => (EventKind::ToolStarted, "tool"),
    }
}

fn item_path(item: &Value) -> Option<String> {
    if let Some(path) = item["path"].as_str() {
        return Some(path.to_string());
    }
    item["changes"]
        .as_array()?
        .first()?
        .get("path")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn item_command(item: &Value) -> Option<String> {
    match item.get("command")? {
        Value::String(s) => Some(s.clone()),
        Value::Array(parts) => Some(
            parts
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
        ),
        _ => None,
    }
}

fn item_failed(item: &Value) -> bool {
    item["exitCode"].as_i64().is_some_and(|c| c != 0) || item["status"].as_str() == Some("failed")
}

fn approval_summary(method: &str, params: &Value) -> String {
    if let Some(command) = params.get("command") {
        let rendered = match command {
            Value::String(s) => s.clone(),
            Value::Array(parts) => parts
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
            _ => String::new(),
        };
        if !rendered.is_empty() {
            return crate::event::truncate(&rendered, 200);
        }
    }
    if let Some(reason) = params["reason"].as_str() {
        if !reason.is_empty() {
            return crate::event::truncate(reason, 200);
        }
    }
    match method {
        "item/fileChange/requestApproval" | "applyPatchApproval" => {
            "Apply file changes?".to_string()
        }
        _ => "Zeus needs approval".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> NormalizeCtx {
        NormalizeCtx {
            session_id: "s".into(),
            runtime: "codex".into(),
            seq: 1,
            ..Default::default()
        }
    }

    #[test]
    fn agent_message_delta_becomes_agent_message() {
        let raw = json!({
            "method": "item/agentMessage/delta",
            "params": {"itemId": "i1", "delta": "hello"}
        });
        let events = codex_normalize(&raw, &ctx());
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, EventKind::AgentMessage);
        assert_eq!(events[0].text(), "hello");
    }

    #[test]
    fn command_execution_maps_to_tool_lifecycle_and_reports_failure() {
        let started = json!({
            "method": "item/started",
            "params": {"item": {"id": "i2", "type": "commandExecution", "command": ["cargo", "test"]}}
        });
        let done = json!({
            "method": "item/completed",
            "params": {"item": {"id": "i2", "type": "commandExecution", "command": ["cargo", "test"],
                                "exitCode": 1, "aggregatedOutput": "error: 2 tests failed"}}
        });
        let out = codex_normalize(&started, &ctx());
        assert_eq!(out[0].kind, EventKind::ToolStarted);
        assert_eq!(out[0].tool(), "shell");
        assert_eq!(out[0].payload["command"], "cargo test");

        let out = codex_normalize(&done, &ctx());
        assert_eq!(out[0].kind, EventKind::ToolFailed);
        assert!(out[0].text().contains("2 tests failed"));
    }

    #[test]
    fn file_change_records_the_path_for_the_digest() {
        let raw = json!({
            "method": "item/started",
            "params": {"item": {"id": "i3", "type": "fileChange",
                                "changes": [{"path": "src/main.rs", "kind": "update"}]}}
        });
        let out = codex_normalize(&raw, &ctx());
        assert_eq!(out[0].kind, EventKind::ToolStarted);
        assert_eq!(out[0].tool(), "edit");
        assert_eq!(out[0].payload["path"], "src/main.rs");
    }

    #[test]
    fn approval_carries_both_zeus_and_rpc_ids() {
        let raw = json!({
            "id": 42,
            "method": "item/commandExecution/requestApproval",
            "params": {"itemId": "i4", "command": ["cargo", "test"]}
        });
        let out = codex_normalize(&raw, &ctx());
        assert_eq!(out[0].kind, EventKind::PermissionRequested);
        assert_eq!(out[0].payload["rpc_id"], 42);
        assert!(!out[0].payload["request_id"].as_str().unwrap().is_empty());
        assert_eq!(out[0].text(), "cargo test");
    }

    #[test]
    fn user_input_is_not_confused_with_a_permission() {
        let raw = json!({
            "id": 7,
            "method": "item/tool/requestUserInput",
            "params": {"itemId": "i5", "question": "Which database?"}
        });
        let out = codex_normalize(&raw, &ctx());
        assert_eq!(out[0].kind, EventKind::InputRequested);
        assert_eq!(out[0].text(), "Which database?");
    }

    #[test]
    fn turn_completed_and_error_map_to_terminal_kinds() {
        let completed = json!({"method": "turn/completed", "params": {"status": "completed"}});
        assert_eq!(
            codex_normalize(&completed, &ctx())[0].kind,
            EventKind::SessionCompleted
        );
        let failed = json!({"method": "turn/completed", "params": {"status": "failed"}});
        assert_eq!(
            codex_normalize(&failed, &ctx())[0].kind,
            EventKind::SessionFailed
        );
        let error = json!({"method": "error", "params": {"message": "model overloaded"}});
        assert_eq!(
            codex_normalize(&error, &ctx())[0].text(),
            "model overloaded"
        );
    }

    #[test]
    fn unknown_methods_produce_nothing() {
        for method in ["skills/changed", "remoteControl/status/changed", "unknown"] {
            let raw = json!({"method": method, "params": {}});
            assert!(codex_normalize(&raw, &ctx()).is_empty(), "{method}");
        }
    }

    #[test]
    fn reasoning_content_never_reaches_the_ui() {
        let raw = json!({
            "method": "item/reasoning/textDelta",
            "params": {"delta": "internal monologue"}
        });
        let out = codex_normalize(&raw, &ctx());
        assert_eq!(out[0].kind, EventKind::AgentThinking);
        assert!(out[0].text().is_empty());
    }

    #[test]
    fn capabilities_are_advertised_before_detection_runs() {
        let caps = CodexDriver::new().capabilities();
        assert!(caps.has(Capability::Launch));
        assert!(caps.has(Capability::Interrupt));
        assert!(caps.has(Capability::Approvals));
        assert_eq!(caps.mode, Mode::Managed);
    }
}
