//! The runtime contract.
//!
//! Every runtime is one object implementing [`AgentRuntimeDriver`]. The UI asks
//! the registry what a runtime can do and never guesses: if `interrupt` is
//! false the island renders no interrupt control, because faking a control that
//! does nothing is worse than not offering it.

use crate::event::ZeusEvent;
pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod observed;
pub mod stdio;

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;

/// What a driver may do. Mirrors the capability names the gateway already
/// forwards, so nothing has to be translated on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Capability {
    Launch,
    Observe,
    Send,
    Interrupt,
    Stop,
    Resume,
    Approvals,
    ToolEvents,
    Usage,
    ModelInfo,
    Subagents,
}

impl Capability {
    pub fn as_str(self) -> &'static str {
        match self {
            Capability::Launch => "launch",
            Capability::Observe => "observe",
            Capability::Send => "send",
            Capability::Interrupt => "interrupt",
            Capability::Stop => "stop",
            Capability::Resume => "resume",
            Capability::Approvals => "approvals",
            Capability::ToolEvents => "toolEvents",
            Capability::Usage => "usage",
            Capability::ModelInfo => "modelInfo",
            Capability::Subagents => "subagents",
        }
    }
}

/// Managed means Zeus owns the process and can stop it. Observed means the user
/// launched the CLI and only hooks report in, so Zeus must not offer to kill it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Managed,
    Observed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    pub runtime: String,
    pub mode: Mode,
    pub available: BTreeSet<Capability>,
    /// Absent binaries are reported rather than hidden, so the island can say
    /// "not installed" instead of silently omitting a runtime.
    pub installed: bool,
    pub version: Option<String>,
}

impl Capabilities {
    pub fn has(&self, c: Capability) -> bool {
        self.available.contains(&c)
    }

    pub fn list(&self) -> Vec<&'static str> {
        self.available.iter().map(|c| c.as_str()).collect()
    }
}

/// A session Zeus asked a driver to own.
#[derive(Debug, Clone)]
pub struct LaunchSpec {
    pub cwd: PathBuf,
    pub prompt: Option<String>,
    pub model: Option<String>,
    /// Resume target for `Capability::Resume`; the runtime's own session id.
    pub resume_from: Option<String>,
    pub project: Option<String>,
}

/// Handle the supervisor keeps on a live process. Cheap to clone, does not own
/// the child — the supervisor does, so the UI can never stop a session by
/// dropping a handle.
#[derive(Debug, Clone)]
pub struct RuntimeHandle {
    pub session_id: String,
    pub runtime: String,
    pub pid: Option<u32>,
}

/// Outcome of a driver call that may not be supported.
#[derive(Debug)]
pub enum DriverError {
    /// The runtime genuinely cannot do this. Callers surface it as "not
    /// available", never as a failure to retry.
    Unsupported(&'static str),
    Failed(String),
}

impl std::fmt::Display for DriverError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DriverError::Unsupported(what) => write!(f, "{what} is not supported by this runtime"),
            DriverError::Failed(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for DriverError {}

pub type DriverResult<T> = Result<T, DriverError>;

/// Every runtime implements this. Methods for unsupported operations return
/// `DriverError::Unsupported` instead of pretending to work.
pub trait AgentRuntimeDriver: Send + Sync {
    fn name(&self) -> &'static str;

    fn capabilities(&self) -> Capabilities;

    /// Cheap check that the CLI is present and runnable.
    fn detect(&self) -> bool;

    /// Start a managed session. Events are reported through the sink.
    fn launch(&self, spec: LaunchSpec, sink: Arc<dyn EventSink>) -> DriverResult<RuntimeHandle>;

    /// Deliver user input to a live session.
    fn send(&self, handle: &RuntimeHandle, text: &str) -> DriverResult<()>;

    /// Ask the agent to stop the current turn but keep the session.
    fn interrupt(&self, handle: &RuntimeHandle) -> DriverResult<()>;

    fn stop(&self, handle: &RuntimeHandle) -> DriverResult<()>;

    /// Restart a session that has ended, reusing the runtime's own id.
    fn resume(&self, spec: LaunchSpec, sink: Arc<dyn EventSink>) -> DriverResult<RuntimeHandle>;

    /// Answer a pending approval. `request_id` is Zeus's, not the runtime's.
    fn approve(&self, handle: &RuntimeHandle, request_id: &str, allow: bool) -> DriverResult<()>;

    /// One runtime-native message to zero or more normalized events. Pure, so
    /// the parity tests can drive it from fixtures without a live process.
    fn normalize(&self, raw: &serde_json::Value, ctx: &NormalizeCtx) -> Vec<ZeusEvent>;

    /// Resolve a pending approval that has already expired or been answered.
    /// Called when the session dies with a request still open, so the UI does
    /// not keep showing a button that can never be pressed.
    fn cancel_approval(&self, _handle: &RuntimeHandle, _request_id: &str) {}
}

/// Where a driver publishes normalized events. The engine passes the process-wide
/// bus, so a driver's reader threads outlive the call that started them.
pub trait EventSink: Send + Sync {
    fn publish(&self, event: ZeusEvent);
    /// Current sequence number for a session, so a driver can number its own
    /// events monotonically without holding the store.
    fn next_seq(&self, session_id: &str) -> u64;
}

/// Per-session state a normalizer needs that is not in the message itself.
#[derive(Debug, Clone, Default)]
pub struct NormalizeCtx {
    pub session_id: String,
    pub runtime: String,
    pub seq: u64,
    pub external_session_id: Option<String>,
    /// Runtime-native conversation id, discovered while normalizing `init`.
    pub conversation_id: Option<String>,
    pub model: Option<String>,
    /// Display name for a tool whose completion message carries only an id
    /// (Claude's `tool_result`). The driver remembers the mapping.
    pub tool_label: Option<String>,
}
