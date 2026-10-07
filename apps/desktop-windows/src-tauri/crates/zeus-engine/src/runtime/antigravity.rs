//! Antigravity driver — managed via the persistent `agy` NDJSON process.
//!
//! Verified on `agy 1.2.x`:
//!
//! ```text
//! $ agy --input-format stream-json --output-format stream-json
//! ← {"event":"init","conversation_id":"…","init":{"cwd":"…","tools":[…],
//!      "permission_mode":"request-review"}}
//! ← {"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE",
//!      "step_type":"agent_response","text_delta":"ok"}}
//! ← {"event":"step_update","step_update":{"step_index":1,"state":"DONE",
//!      "step_type":"agent_response","duration_seconds":12.7,"usage":{…}}}
//! ← {"event":"result","result":{"status":"SUCCESS","response":"ok\n",
//!      "usage":{"input_tokens":…,"output_tokens":…,"thinking_tokens":…}}}
//! → {"event":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}
//! ```
//!
//! The process is persistent: one process serves many turns, which is what makes
//! `resume` meaningful here.
//!
//! `text_delta` arrives per token. Emitting an event per delta would flood the
//! gateway and the island, so deltas are buffered per step and flushed as one
//! `agent.message` when the step reports `DONE`.

use crate::event::{EventKind, ZeusEvent};
use crate::runtime::stdio::{pump_lines, spawn_ndjson, usage_of, StreamProc};
use crate::runtime::{
    AgentRuntimeDriver, Capabilities, Capability, DriverError, DriverResult, EventSink, LaunchSpec,
    Mode, NormalizeCtx, RuntimeHandle,
};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

pub struct AntigravityDriver {
    /// Detection is expensive and stable, so cache it.
    detected: std::sync::Mutex<Option<bool>>,
    binary: String,
    procs: Mutex<HashMap<String, Arc<AgyProc>>>,
}

/// Public because the signature of `agy_normalize` mentions it; the fields
/// stay private, so the per-step buffer cannot be poked from outside.
pub struct AgyProc {
    stream: StreamProc,
    /// step_index -> buffered text, flushed when the step completes.
    pending_text: Mutex<HashMap<u64, String>>,
    conversation_id: Mutex<Option<String>>,
}

impl AgyProc {
    /// Test seam: a buffer with no process behind it.
    pub fn detached() -> Self {
        Self {
            stream: StreamProc {
                child: std::sync::Mutex::new(None),
                stdin: std::sync::Mutex::new(None),
            },
            pending_text: Mutex::new(HashMap::new()),
            conversation_id: Mutex::new(None),
        }
    }
}

impl Default for AntigravityDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl AntigravityDriver {
    pub fn new() -> Self {
        Self {
            detected: std::sync::Mutex::new(None),
            binary: std::env::var("ZEUS_AGY_BIN").unwrap_or_else(|_| "agy".into()),
            procs: Mutex::new(HashMap::new()),
        }
    }

    fn proc(&self, session_id: &str) -> DriverResult<Arc<AgyProc>> {
        self.procs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .cloned()
            .ok_or_else(|| DriverError::Failed("agy session is not running".into()))
    }

    fn spawn(
        &self,
        spec: LaunchSpec,
        resume_from: Option<String>,
        sink: Arc<dyn EventSink>,
    ) -> DriverResult<RuntimeHandle> {
        let session_id = format!("antigravity-{}", uuid::Uuid::new_v4());
        let mut args: Vec<String> = vec![
            "--input-format".into(),
            "stream-json".into(),
            "--output-format".into(),
            "stream-json".into(),
        ];
        if let Some(model) = spec.model.as_ref() {
            args.push("--model".into());
            args.push(model.clone());
        }
        if let Some(conversation) = resume_from.as_ref() {
            args.push("--conversation".into());
            args.push(conversation.clone());
        }

        let (stream, stdout) = spawn_ndjson(&self.binary, &args, &spec.cwd)
            .map_err(|e| DriverError::Failed(format!("cannot start agy: {e}")))?;
        let pid = stream.pid();
        let proc = Arc::new(AgyProc {
            stream,
            pending_text: Mutex::new(HashMap::new()),
            conversation_id: Mutex::new(None),
        });
        self.procs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(session_id.clone(), proc.clone());

        pump_lines(stdout, {
            let sink = sink.clone();
            let session_id = session_id.clone();
            let proc = proc.clone();
            move |value| {
                if let Some(id) = value["conversation_id"].as_str() {
                    *proc
                        .conversation_id
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()) = Some(id.to_string());
                }
                let conversation_id = proc
                    .conversation_id
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let seq = sink.next_seq(&session_id);
                let ctx = NormalizeCtx {
                    session_id: session_id.clone(),
                    runtime: "antigravity".into(),
                    seq,
                    external_session_id: conversation_id,
                    conversation_id: None,
                    model: None,
                    tool_label: None,
                };
                for event in agy_normalize(&value, &ctx, Some(proc.as_ref())) {
                    sink.publish(event);
                }
                if matches!(value["event"].as_str().unwrap_or(""), "result" | "error") {
                    // A finished turn ends the buffered text even if no DONE
                    // step_update arrived, so nothing is silently dropped.
                    flush_all(&proc, &ctx, sink.as_ref());
                }
            }
        });

        if let Some(prompt) = spec.prompt.as_ref() {
            send_prompt(&proc.stream, prompt);
        }
        Ok(RuntimeHandle {
            session_id,
            runtime: "antigravity".into(),
            pid,
        })
    }
}

fn send_prompt(stream: &StreamProc, prompt: &str) {
    stream.send_line(&json!({
        "event": "user",
        "message": {"role": "user", "content": [{"type": "text", "text": prompt}]}
    }));
}

fn flush_all(proc: &AgyProc, ctx: &NormalizeCtx, sink: &dyn EventSink) {
    let mut pending = proc.pending_text.lock().unwrap_or_else(|e| e.into_inner());
    if pending.is_empty() {
        return;
    }
    let mut steps: Vec<u64> = pending.keys().copied().collect();
    steps.sort_unstable();
    for step in steps {
        if let Some(text) = pending.remove(&step) {
            if !text.trim().is_empty() {
                let mut event = ZeusEvent::new(
                    &ctx.session_id,
                    "antigravity",
                    ctx.seq,
                    EventKind::AgentMessage,
                );
                if let Some(external) = &ctx.external_session_id {
                    event = event.with_external(external);
                }
                sink.publish(event.with_text(text.trim()));
            }
        }
    }
}

/// Pure normalizer. `proc` is optional so fixture tests can pass `None`; the
/// only thing it is needed for is the per-step text buffer.
pub fn agy_normalize(raw: &Value, ctx: &NormalizeCtx, proc: Option<&AgyProc>) -> Vec<ZeusEvent> {
    let event = raw.get("event").and_then(Value::as_str).unwrap_or("");
    let mut out: Vec<ZeusEvent> = Vec::new();

    let make = |kind: EventKind| {
        let mut ev = ZeusEvent::new(&ctx.session_id, "antigravity", ctx.seq, kind);
        if let Some(external) = &ctx.external_session_id {
            ev = ev.with_external(external);
        }
        ev
    };

    match event {
        "init" => {
            let conversation = raw["conversation_id"].as_str().unwrap_or("");
            let mut ev = make(EventKind::SessionStarted);
            if !conversation.is_empty() {
                ev.external_session_id = Some(conversation.to_string());
            }
            out.push(ev);
        }
        "step_update" => {
            let step = &raw["step_update"];
            let step_index = step["step_index"].as_u64().unwrap_or(0);
            let state = step["state"].as_str().unwrap_or("");
            let step_type = step["step_type"].as_str().unwrap_or("");
            let delta = step["text_delta"].as_str().unwrap_or("");

            if !delta.is_empty() {
                if let Some(proc) = proc {
                    proc.pending_text
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .entry(step_index)
                        .or_default()
                        .push_str(delta);
                }
            }

            if state == "DONE" || state == "ERROR" || state == "FAILED" {
                if let Some(proc) = proc {
                    let mut pending = proc.pending_text.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(text) = pending.remove(&step_index) {
                        if !text.trim().is_empty() {
                            out.push(make(EventKind::AgentMessage).with_text(text.trim()));
                        }
                    }
                }
                let failed = state == "ERROR" || state == "FAILED";
                if matches!(
                    step_type,
                    "tool" | "tool_call" | "command" | "file_edit" | "shell"
                ) {
                    out.push(make(if failed {
                        EventKind::ToolFailed
                    } else {
                        EventKind::ToolCompleted
                    }));
                }
            } else if state == "ACTIVE" && matches!(step_type, "agent_response" | "reasoning") {
                out.push(make(EventKind::AgentThinking));
            }
        }
        "result" => {
            let result = &raw["result"];
            let status = result["status"].as_str().unwrap_or("SUCCESS");
            let failed = !status.eq_ignore_ascii_case("success");
            let mut ev = make(if failed {
                EventKind::SessionFailed
            } else {
                EventKind::SessionCompleted
            });
            if failed {
                let text = result["error"]
                    .as_str()
                    .or_else(|| result["response"].as_str())
                    .unwrap_or("agy reported a failure");
                ev = ev.with_text(&crate::event::truncate(text, 300));
            }
            if let Some(usage) = result.get("usage").and_then(usage_of) {
                ev = ev.with_field(
                    "usage",
                    json!({"input": usage.input, "output": usage.output,
                           "cached": usage.cached, "thinking": usage.thinking}),
                );
            }
            out.push(ev);
        }
        "error" => {
            let message = raw["error"]
                .as_str()
                .or_else(|| raw["message"].as_str())
                .unwrap_or("agy error");
            out.push(
                make(EventKind::SessionFailed).with_text(&crate::event::truncate(message, 300)),
            );
        }
        _ => {}
    }
    out
}

impl AgentRuntimeDriver for AntigravityDriver {
    fn name(&self) -> &'static str {
        "antigravity"
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
            Capability::Subagents,
        ] {
            set.insert(cap);
        }
        // agy has no documented per-turn interrupt over NDJSON, so the island
        // offers Stop rather than a control that does nothing.
        Capabilities {
            runtime: "antigravity".into(),
            mode: Mode::Managed,
            available: set,
            installed: self.detect(),
            version: None,
        }
    }

    fn binary_name(&self) -> &'static str {
        "agy"
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
        send_prompt(&proc.stream, text);
        Ok(())
    }

    fn interrupt(&self, _handle: &RuntimeHandle) -> DriverResult<()> {
        Err(DriverError::Unsupported("interrupt"))
    }

    fn stop(&self, handle: &RuntimeHandle) -> DriverResult<()> {
        let proc = self.proc(&handle.session_id)?;
        proc.stream.kill();
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
        agy_normalize(raw, ctx, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> NormalizeCtx {
        NormalizeCtx {
            session_id: "s".into(),
            runtime: "antigravity".into(),
            seq: 1,
            external_session_id: Some("conv-1".into()),
            ..Default::default()
        }
    }

    #[test]
    fn init_starts_the_session_and_carries_the_conversation_id() {
        let raw = json!({
            "event": "init",
            "conversation_id": "conv-1",
            "init": {"cwd": "/tmp", "tools": ["run_command"], "permission_mode": "request-review"}
        });
        let out = agy_normalize(&raw, &ctx(), None);
        assert_eq!(out[0].kind, EventKind::SessionStarted);
        assert_eq!(out[0].external_session_id.as_deref(), Some("conv-1"));
    }

    #[test]
    fn active_step_is_thinking_and_done_result_is_completion() {
        let active = json!({"event": "step_update", "step_update": {
            "step_index": 1, "state": "ACTIVE", "step_type": "agent_response", "text_delta": "ok"}});
        assert_eq!(
            agy_normalize(&active, &ctx(), None)[0].kind,
            EventKind::AgentThinking
        );

        let result = json!({"event": "result", "result": {
            "conversation_id": "conv-1", "status": "SUCCESS", "response": "ok\n",
            "usage": {"input_tokens": 16409, "output_tokens": 19, "thinking_tokens": 18}}});
        let out = agy_normalize(&result, &ctx(), None);
        assert_eq!(out[0].kind, EventKind::SessionCompleted);
        assert_eq!(out[0].payload["usage"]["input"], 16409);
        assert_eq!(out[0].payload["usage"]["thinking"], 18);
    }

    #[test]
    fn error_result_maps_to_session_failed_with_the_reason() {
        let raw = json!({"event": "result", "result": {
            "status": "ERROR", "error": "stream input message is missing the \"event\" field"}});
        let out = agy_normalize(&raw, &ctx(), None);
        assert_eq!(out[0].kind, EventKind::SessionFailed);
        assert!(out[0].text().contains("missing"));
    }

    #[test]
    fn unknown_events_are_ignored() {
        let raw = json!({"event": "telemetry", "payload": {"mb": 12}});
        assert!(agy_normalize(&raw, &ctx(), None).is_empty());
    }

    #[test]
    fn managed_agy_does_not_claim_interrupt_or_approvals() {
        let caps = AntigravityDriver::new().capabilities();
        assert!(caps.has(Capability::Launch));
        assert!(caps.has(Capability::Resume));
        assert!(!caps.has(Capability::Interrupt));
        assert!(!caps.has(Capability::Approvals));
    }
}
