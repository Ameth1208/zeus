//! Cross-runtime parity.
//!
//! The point of this file: three unrelated CLIs must produce *identical*
//! normalized events for the same thing happening. If Codex's "I ran a command"
//! and agy's and Claude's do not agree on kind, tool and terminality, then every
//! consumer downstream — island state machine, gateway status table, mobile card
//! — has to grow runtime branches, which is the thing this architecture exists to
//! prevent.
//!
//! Fixtures are real CLI output. Each file records its own provenance: verbatim
//! captures are separated from schema-documented or protocol-documented shapes,
//! so a test failure can be traced to the source rather than to a guess.

use serde_json::Value;
use zeus_engine::event::{EventKind, ZeusEvent};
use zeus_engine::runtime::{antigravity, claude, codex, NormalizeCtx};

fn fixture(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read fixture {}: {e}", path.display()));
    serde_json::from_str(&raw).expect("fixture is valid JSON")
}

fn ctx(runtime: &str) -> NormalizeCtx {
    NormalizeCtx {
        session_id: "s1".into(),
        runtime: runtime.into(),
        seq: 1,
        ..Default::default()
    }
}

/// The comparable shape of an event: everything a consumer could branch on.
#[derive(Debug, PartialEq, Eq)]
struct Shape {
    kind: EventKind,
    tool: String,
    terminal: bool,
}

fn shape(kind: EventKind, tool: &str) -> Shape {
    Shape {
        kind,
        tool: tool.to_string(),
        terminal: matches!(kind, EventKind::SessionCompleted | EventKind::SessionFailed),
    }
}

#[test]
fn a_started_session_looks_the_same_from_every_runtime() {
    let agy = fixture("agy_stream.json");
    let claude = fixture("claude_stream.json");
    let codex = fixture("codex_app_server.json");

    let from_agy = agy_normalize(agy["lines"][0].clone());
    let from_claude = claude_normalize(claude["documented"]["init"].clone());
    let from_codex = codex_normalize(codex["fromSchema"]["thread_started"].clone());

    assert_eq!(from_agy, vec![shape(EventKind::SessionStarted, "")]);
    assert_eq!(from_claude, vec![shape(EventKind::SessionStarted, "")]);
    assert_eq!(from_codex, vec![shape(EventKind::SessionStarted, "")]);
}

#[test]
fn prose_becomes_agent_message_everywhere() {
    let agy = fixture("agy_stream.json");
    let claude = fixture("claude_stream.json");
    let codex = fixture("codex_app_server.json");

    // agy streams per-token deltas, so an in-progress step is only "thinking":
    // the text is buffered and released as one message when the step reports
    // DONE. A normalizer that emitted a message per delta would flood the bus.
    let in_progress = agy_normalize(agy["lines"][3].clone());
    assert_eq!(in_progress, vec![shape(EventKind::AgentThinking, "")]);

    assert_eq!(
        claude_normalize(claude["documented"]["assistant_text"].clone()),
        vec![shape(EventKind::AgentMessage, "")]
    );
    assert_eq!(
        codex_normalize(codex["fromSchema"]["agent_delta"].clone()),
        vec![shape(EventKind::AgentMessage, "")]
    );
}

#[test]
fn a_shell_command_is_tool_started_then_completed_or_failed_everywhere() {
    let agy = fixture("agy_stream.json");
    let claude = fixture("claude_stream.json");
    let codex = fixture("codex_app_server.json");

    // Codex names the tool `shell`.
    assert_eq!(
        codex_normalize(codex["fromSchema"]["command_started"].clone()),
        vec![shape(EventKind::ToolStarted, "shell")]
    );
    // Claude reports the runtime's own name; the normalizer maps it to `shell`
    // so the island does not have to know that "Bash" means "shell".
    assert_eq!(
        claude_normalize(claude["documented"]["assistant_tool"].clone()),
        vec![shape(EventKind::ToolStarted, "shell")]
    );

    // Failure is the same verdict from both.
    assert_eq!(
        codex_normalize(codex["fromSchema"]["command_failed"].clone())[0].kind,
        EventKind::ToolFailed
    );
    let mut failure_ctx = ctx("claude");
    failure_ctx.tool_label = Some("shell".into());
    assert_eq!(
        claude_events(
            claude["documented"]["tool_result_error"].clone(),
            &failure_ctx
        )[0]
        .kind,
        EventKind::ToolFailed
    );

    // agy's equivalent is a tool step reaching DONE; the raw step alone carries
    // no verdict, which is why the driver keeps a per-step buffer.
    let tool_done = agy["lines"][4].clone();
    let ctx_agy = ctx("antigravity");
    let shapes: Vec<Shape> = shapes(agy_events(tool_done, &ctx_agy));
    assert!(
        !shapes.iter().any(|s| s.terminal),
        "a tool step is never terminal: {shapes:?}"
    );
}

#[test]
fn a_finished_turn_is_terminal_everywhere() {
    let agy = fixture("agy_stream.json");
    let claude = fixture("claude_stream.json");
    let codex = fixture("codex_app_server.json");

    let from_agy = agy_normalize(agy["lines"][5].clone());
    let from_claude = claude_normalize(claude["documented"]["result_success"].clone());
    let from_codex = codex_normalize(codex["fromSchema"]["turn_completed"].clone());

    for out in [&from_agy, &from_claude, &from_codex] {
        assert_eq!(out.len(), 1, "one terminal event per turn: {out:?}");
        assert_eq!(out[0].kind, EventKind::SessionCompleted);
        assert!(out[0].terminal);
    }
}

#[test]
fn a_failed_turn_is_the_same_failure_everywhere() {
    let agy = fixture("agy_stream.json");
    let codex = fixture("codex_app_server.json");

    let from_agy = agy_normalize(agy["lines"][6].clone());
    let from_codex = codex_normalize(codex["fromSchema"]["error"].clone());

    for out in [&from_agy, &from_codex] {
        assert_eq!(out[0].kind, EventKind::SessionFailed);
        assert!(out[0].terminal);
    }
}

#[test]
fn an_approval_request_is_the_same_kind_and_carries_a_usable_id() {
    let claude = fixture("claude_stream.json");
    let codex = fixture("codex_app_server.json");

    let from_codex = codex_events(codex["fromSchema"]["approval"].clone(), &ctx("codex"));
    assert_eq!(from_codex[0].kind, EventKind::PermissionRequested);
    assert!(
        from_codex[0].payload["request_id"]
            .as_str()
            .is_some_and(|v| !v.is_empty()),
        "an approval without an id can never be answered"
    );
    assert_eq!(from_codex[0].payload["rpc_id"], 42);

    // Claude print mode does not route permissions to Zeus, so it must not
    // produce one: a fabricated permission event would hang the island forever.
    assert!(
        claude_normalize(claude["documented"]["assistant_tool"].clone())[0].kind
            != EventKind::PermissionRequested
    );
}

#[test]
fn only_four_kinds_are_ever_pushworthy_across_all_runtimes() {
    let agy = fixture("agy_stream.json");
    let claude = fixture("claude_stream.json");
    let codex = fixture("codex_app_server.json");

    let mut kinds = Vec::new();
    for value in agy["lines"].as_array().unwrap() {
        kinds.extend(agy_normalize(value.clone()));
    }
    for value in [
        claude["documented"]["init"].clone(),
        claude["documented"]["assistant_text"].clone(),
        claude["documented"]["assistant_tool"].clone(),
        claude["documented"]["result_success"].clone(),
    ] {
        kinds.extend(claude_normalize(value));
    }
    for value in codex["fromSchema"].as_object().unwrap().values() {
        kinds.extend(codex_normalize(value.clone()));
    }

    assert!(!kinds.is_empty());
    for event in &kinds {
        assert_eq!(
            event.kind.is_pushworthy(),
            matches!(
                event.kind,
                EventKind::PermissionRequested
                    | EventKind::InputRequested
                    | EventKind::SessionCompleted
                    | EventKind::SessionFailed
            ),
            "{} must match the push policy",
            event.kind.as_str()
        );
    }
}

#[test]
fn captured_cli_lines_never_crash_a_normalizer() {
    // Captured output includes notification spam a driver has no branch for.
    // Feeding it must be a no-op, never a panic and never a bogus event.
    let codex = fixture("codex_app_server.json");
    for line in codex["captured"].as_array().unwrap() {
        assert!(codex_normalize(line.clone()).is_empty(), "{line}");
    }
    let claude = fixture("claude_stream.json");
    for line in claude["captured"].as_array().unwrap() {
        assert!(claude_normalize(line.clone()).is_empty(), "{line}");
    }
    let agy = fixture("agy_stream.json");
    for line in agy["lines"].as_array().unwrap() {
        // Must not panic; may legitimately be empty.
        let _ = agy_normalize(line.clone());
    }
}

fn agy_normalize(value: Value) -> Vec<Shape> {
    shapes(agy_events(value, &ctx("antigravity")))
}

fn agy_events(value: Value, c: &NormalizeCtx) -> Vec<ZeusEvent> {
    antigravity::agy_normalize(&value, c, None)
}

fn claude_normalize(value: Value) -> Vec<Shape> {
    shapes(claude_events(value, &ctx("claude")))
}

fn claude_events(value: Value, c: &NormalizeCtx) -> Vec<ZeusEvent> {
    claude::claude_normalize(&value, c)
}

fn codex_normalize(value: Value) -> Vec<Shape> {
    shapes(codex_events(value, &ctx("codex")))
}

fn codex_events(value: Value, c: &NormalizeCtx) -> Vec<ZeusEvent> {
    codex::codex_normalize(&value, c)
}

fn shapes(events: Vec<ZeusEvent>) -> Vec<Shape> {
    events.iter().map(|e| shape(e.kind, e.tool())).collect()
}
