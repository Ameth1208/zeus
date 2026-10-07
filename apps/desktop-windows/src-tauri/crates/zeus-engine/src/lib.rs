//! ZeusEngine — the single object the desktop is built around.
//!
//! Everything the island can ask for goes through here. The webview holds no
//! process handle, no socket and no store: it calls a command, this decides,
//! and the result comes back as data. That is what makes hiding the island or
//! reloading the page a non-event for running agents.
//!
//! ```text
//!   webview  ──invoke──▶  ZeusEngine  ──▶  RuntimeRegistry ──▶ driver ──▶ CLI
//!                             │
//!                             ├──▶  LocalStore         (append, then snapshot)
//!                             ├──▶  EventBus           (one fan-out, many readers)
//!                             ├──▶  PermissionManager  (approval authority)
//!                             └──▶  GatewayClient      (queued; never blocking)
//! ```

pub mod bus;
pub mod context;
pub mod digest;
pub mod event;
pub mod gateway;
pub mod ingest;
pub mod permission;
pub mod registry;
pub mod relay;
pub mod runtime;
pub mod session;
pub mod store;
pub mod tokens;

// Re-exported so the Tauri host can name the broadcast error type without
// taking a direct dependency on tokio.
pub use tokio;

pub use crate::bus::EventBus;
pub use crate::context::ContextManager;
pub use crate::digest::SessionDigest;
pub use crate::event::{EventKind, ZeusEvent};
pub use crate::gateway::GatewayClient;
pub use crate::permission::{Decision, DecisionError, PermissionManager};
pub use crate::registry::RuntimeRegistry;
pub use crate::runtime::{Capability, EventSink, LaunchSpec, RuntimeHandle};
pub use crate::session::{RuntimeSupervisor, SessionManager, SessionView};
pub use crate::store::LocalStore;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// A bus-backed sink. Drivers publish here; the engine is the single subscriber
/// that persists, accounts, queues for the gateway and mirrors to the UI.
struct BusSink {
    bus: Arc<EventBus>,
    store: Arc<LocalStore>,
    sessions: Arc<SessionManager>,
    gateway: Arc<GatewayClient>,
}

impl EventSink for BusSink {
    fn publish(&self, event: ZeusEvent) {
        // Store first: the gateway queue and the UI are both derived from the
        // log, so a crash in between loses nothing that matters.
        self.store.ingest(event.clone());
        self.sessions.account(&event);
        self.gateway.enqueue(event.clone());
        self.bus.publish(event);
    }

    fn next_seq(&self, session_id: &str) -> u64 {
        self.store.next_seq(session_id)
    }
}

pub struct ZeusEngine {
    pub bus: Arc<EventBus>,
    pub store: Arc<LocalStore>,
    pub registry: Arc<RuntimeRegistry>,
    pub sessions: Arc<SessionManager>,
    pub permissions: PermissionManager,
    pub gateway: Arc<GatewayClient>,
    pub context: ContextManager,
    workstation_id: String,
    sink: Arc<BusSink>,
}

impl ZeusEngine {
    pub fn new(data_dir: PathBuf, project_root: PathBuf) -> Arc<Self> {
        let bus = EventBus::new();
        let store = Arc::new(LocalStore::open(data_dir.clone()));
        let registry = Arc::new(RuntimeRegistry::new());

        // Codex accepts MCP server configuration over app-server, so it gets
        // Serena. The other runtimes reach MCP through their own config files,
        // which Zeus does not rewrite behind the user's back.
        let context = ContextManager::new(project_root, ContextManager::detect_tools(true));

        let workstation_id = workstation_id(&data_dir);
        let permissions = PermissionManager::new(store.clone(), &workstation_id);
        let sessions = Arc::new(SessionManager::new(store.clone(), registry.clone()));
        let gateway = Arc::new(GatewayClient::new());
        let sink = Arc::new(BusSink {
            bus: bus.clone(),
            store: store.clone(),
            sessions: sessions.clone(),
            gateway: gateway.clone(),
        });

        Arc::new(Self {
            bus,
            store,
            registry,
            sessions,
            permissions,
            gateway,
            context,
            workstation_id,
            sink,
        })
    }

    pub fn workstation_id(&self) -> &str {
        &self.workstation_id
    }

    pub fn sink(&self) -> Arc<dyn EventSink> {
        self.sink.clone()
    }

    pub fn launch(
        &self,
        runtime: &str,
        cwd: PathBuf,
        prompt: Option<String>,
        model: Option<String>,
    ) -> Result<RuntimeHandle, String> {
        let project = cwd
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let spec = LaunchSpec {
            cwd,
            prompt,
            model,
            resume_from: None,
            project: Some(project),
        };
        self.sessions
            .launch(runtime, spec, self.sink())
            .map_err(|e| e.to_string())
    }

    pub fn send(&self, session_id: &str, text: &str) -> Result<(), String> {
        self.sessions.send(session_id, text).map_err(|e| e.to_string())
    }

    pub fn interrupt(&self, session_id: &str) -> Result<(), String> {
        self.sessions
            .interrupt(session_id)
            .map_err(|e| e.to_string())
    }

    pub fn stop(&self, session_id: &str) -> Result<(), String> {
        // Anything still waiting for a decision gets a definite answer before
        // the runtime goes away, so the runtime is never left blocked on Zeus.
        self.permissions.expire_session(session_id);
        self.sessions.stop(session_id).map_err(|e| e.to_string())
    }

    pub fn resume(&self, session_id: &str) -> Result<RuntimeHandle, String> {
        self.sessions
            .resume(session_id, self.sink())
            .map_err(|e| e.to_string())
    }

    /// Opens a request and returns its id. Zeus ids never leak a runtime-native
    /// identifier into the wire protocol.
    pub fn request_permission(&self, session_id: &str, summary: &str) -> String {
        self.permissions.open(session_id, summary).request_id
    }

    /// The one path a decision can take, whoever asked for it: the island, the
    /// gateway relay, or a replay. Validation is identical for all three, and
    /// a refusal changes nothing.
    /// On success the decision is final. A failure to reach the runtime is
    /// returned too, because "recorded but not delivered" must not look like a
    /// completed approval — but the record is already final either way, so a
    /// retry cannot turn one decision into two.
    pub fn decide(
        &self,
        request_id: &str,
        session_id: &str,
        workstation_id: &str,
        allow: bool,
    ) -> Result<(), DecisionError> {
        self.decide_inner(request_id, session_id, workstation_id, allow)
            .map(|_| ())
    }

    /// Same as [`ZeusEngine::decide`] but also reports the delivery failure.
    pub fn decide_reporting_delivery(
        &self,
        request_id: &str,
        session_id: &str,
        workstation_id: &str,
        allow: bool,
    ) -> Result<Result<(), String>, DecisionError> {
        self.decide_inner(request_id, session_id, workstation_id, allow)
    }

    fn decide_inner(
        &self,
        request_id: &str,
        session_id: &str,
        workstation_id: &str,
        allow: bool,
    ) -> Result<Result<(), String>, DecisionError> {
        let record = self
            .store
            .get_pending(request_id)
            .ok_or(DecisionError::UnknownRequest)?;
        // Validate before mutating anything.
        self.permissions.decide(
            request_id,
            session_id,
            workstation_id,
            if allow { Decision::Allow } else { Decision::Deny },
        )?;

        // The authority record is now final. Forwarding to the runtime can still
        // fail, and that is reported separately rather than un-approving.
        let forwarded: Result<(), String> = match self.runtime_for(&record) {
            Some(runtime) => match self.registry.get(&runtime) {
                Some(driver) => driver
                    .approve(
                        &RuntimeHandle {
                            session_id: record.session_id.clone(),
                            runtime: runtime.clone(),
                            pid: None,
                        },
                        request_id,
                        allow,
                    )
                    .map_err(|e| e.to_string()),
                // An observed runtime answers through its own hook, not Zeus.
                None => Ok(()),
            },
            None => Ok(()),
        };

        let seq = self.store.next_seq(&record.session_id);
        let event = ZeusEvent::new(
            &record.session_id,
            &self
                .store
                .session(&record.session_id)
                .map(|s| s.runtime)
                .unwrap_or_else(|| "zeus".to_string()),
            seq,
            EventKind::PermissionResolved,
        )
        .with_field(
            "decision",
            serde_json::json!(if allow { "allow" } else { "deny" }),
        );
        self.store.ingest(event.clone());
        self.gateway.enqueue(event.clone());
        self.bus.publish(event);

        Ok(forwarded)
    }

    fn runtime_for(&self, request: &crate::store::PendingRequest) -> Option<String> {
        self.store
            .session(&request.session_id)
            .map(|s| s.runtime)
    }

    /// Accepts a hook payload from an observed session. Re-numbers it into the
    /// desktop's own sequence space, so a retrying hook cannot produce either a
    /// duplicate or a gap.
    pub fn observe(
        &self,
        runtime: &str,
        hook: &runtime::observed::HookEvent,
    ) -> Option<ZeusEvent> {
        let driver = self.registry.observed(runtime)?;
        let seq = self.store.next_seq(&hook.session_id);
        let event = driver.convert(hook, seq)?;
        let (project, model) = driver.context_of(hook);
        self.store.set_project(&hook.session_id, &project, &model);
        if !self.sessions.is_live(&hook.session_id) {
            self.store.set_capabilities(
                &hook.session_id,
                &[Capability::Observe, Capability::ToolEvents],
            );
        }
        // A hook raise without an authority record is a trap: the island would
        // show Allow forever because nothing would ever retire it. Register it
        // under the runtime's own request id when the hook supplied one, and
        // expire everything as soon as the request resolves or the session ends.
        if event.kind == EventKind::PermissionRequested {
            let req_id = event.payload["request_id"].as_str().map(str::to_string);
            // A request the authority already knows about is a redelivery:
            // redelivered hooks must never re-pin the island or re-queue.
            if let Some(id) = req_id.as_deref() {
                if self.store.get_pending(id).is_some() {
                    return Some(event);
                }
            }
            let summary = if event.text().is_empty() {
                "needs permission"
            } else {
                event.text()
            };
            self.permissions
                .open_with_id(&hook.session_id, summary, req_id.as_deref());
        }
        if matches!(
            event.kind,
            EventKind::PermissionResolved | EventKind::SessionCompleted | EventKind::SessionFailed
        ) {
            self.permissions.expire_session(&hook.session_id);
        }
        self.store.ingest(event.clone());
        self.sessions.account(&event);
        self.gateway.enqueue(event.clone());
        self.bus.publish(event.clone());
        Some(event)
    }

    /// Folds unprocessed events into the digest, keeping it short.
    pub fn maintain_digest(&self, session_id: &str) -> SessionDigest {
        let mut digest = self
            .store
            .digest(session_id)
            .unwrap_or_else(|| SessionDigest::new(session_id));
        for event in self.store.since(session_id, digest.last_seq) {
            digest.apply(&event);
        }
        self.store.put_digest(digest.clone());
        digest
    }

    pub fn views(&self) -> Vec<SessionView> {
        self.sessions.views()
    }

    /// Starts the crash watcher. Separate from `new` so tests get an engine with
    /// no background threads.
    pub fn spawn_supervisor(self: &Arc<Self>) {
        let supervisor = Arc::new(RuntimeSupervisor::new(self.sessions.clone()));
        supervisor.spawn(self.sink());
    }
}

/// Stable per-installation id, derived from the data directory so it survives
/// restarts without collecting any hardware identifier.
fn workstation_id(data_dir: &Path) -> String {
    use sha2::{Digest, Sha256};
    let key = data_dir.to_string_lossy().to_lowercase().replace('\\', "/");
    let digest = Sha256::digest(key.as_bytes());
    format!(
        "ws-{}",
        digest
            .iter()
            .take(6)
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::observed::HookEvent;
    use crate::store::PendingRequest;

    fn engine() -> Arc<ZeusEngine> {
        let base = std::env::temp_dir().join(format!("zeus-engine-{}", uuid::Uuid::new_v4()));
        ZeusEngine::new(base.join("data"), base.join("project"))
    }

    fn hook(kind: &str, seq: usize) -> HookEvent {
        HookEvent {
            id: String::new(),
            session_id: "host-1:codex:s1".into(),
            agent_id: "host-1:codex:s1".into(),
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
            line: 0,
            change: String::new(),
            command: String::new(),
            metadata: None,
            seq: Some(seq as u64),
        }
    }

    #[test]
    fn a_restart_produces_the_same_workstation_id() {
        let dir = std::env::temp_dir().join("zeus-ws-id");
        assert_eq!(workstation_id(&dir), workstation_id(&dir));
        assert!(workstation_id(&dir).starts_with("ws-"));
    }

    #[test]
    fn observed_events_are_numbered_by_the_desktop_not_the_hook() {
        let e = engine();
        assert_eq!(e.observe("codex", &hook("thinking", 1)).unwrap().seq, 1);
        assert_eq!(e.observe("codex", &hook("thinking", 2)).unwrap().seq, 2);
        // A hook replaying an old message must not rewind the sequence.
        assert_eq!(e.observe("codex", &hook("thinking", 1)).unwrap().seq, 3);
    }

    #[test]
    fn a_hook_permission_becomes_decidable_and_retires_on_decision() {
        let e = engine();
        let mut permission_hook = hook("permission.requested", 1);
        permission_hook.message = "run: npm run build".into();
        permission_hook.metadata = Some(serde_json::json!({"request_id": "req-test-9"}));
        e.observe("codex", &permission_hook).unwrap();

        let request = e.store.get_pending("req-test-9").expect("registered");
        assert_eq!(request.status, "pending");
        // A second delivery never returns a second pending entry.
        e.observe("codex", &permission_hook).unwrap();
        assert_eq!(e.store.pending().len(), 1);

        assert_eq!(
            e.decide("req-test-9", "host-1:codex:s1", e.workstation_id(), true),
            Ok(())
        );
        assert_eq!(e.store.get_pending("req-test-9").unwrap().status, "approved");
        // Redelivering the same hook event after and BEFORE the decision must
        // not resurrect the request — that is how "always pending" bugs happen.
        e.observe("codex", &permission_hook).unwrap();
        assert_eq!(
            e.store.get_pending("req-test-9").unwrap().status,
            "approved",
            "decided request must not resurrect on redelivery"
        );
        assert!(e.permissions.open_requests().iter().all(|r| r.request_id != "req-test-9"));
    }

    #[test]
    fn a_hook_permission_expires_when_the_session_completes() {
        let e = engine();
        let mut permission_hook = hook("permission.requested", 1);
        permission_hook.message = "needs permission".into();
        permission_hook.metadata = Some(serde_json::json!({"request_id": "req-x"}));
        e.observe("codex", &permission_hook);
        e.observe("codex", &hook("session.completed", 2));
        // Once a session ends, its pending record is dropped by the store's
        // reducer — there is nothing left to expire.
        assert!(e.store.get_pending("req-x").is_none());
        assert!(e.permissions.open_requests().is_empty());
    }

    #[test]
    fn an_unknown_runtime_cannot_emit_into_the_engine() {
        let e = engine();
        assert!(e.observe("not-a-runtime", &hook("thinking", 1)).is_none());
    }

    #[test]
    fn decisions_are_validated_and_recorded_exactly_once() {
        let e = engine();
        e.observe("codex", &hook("session.started", 1));
        let request = e.request_permission("host-1:codex:s1", "run cargo test");
        assert_eq!(
            e.decide(&request, "host-1:codex:s1", e.workstation_id(), true),
            Ok(())
        );
        assert_eq!(
            e.decide(&request, "host-1:codex:s1", e.workstation_id(), true),
            Err(DecisionError::AlreadyDecided {
                status: "approved".into()
            })
        );
    }

    #[test]
    fn a_decision_from_another_workstation_changes_nothing() {
        let e = engine();
        let request = e.request_permission("s1", "run cargo test");
        assert_eq!(
            e.decide(&request, "s1", "ws-somewhere-else", true),
            Err(DecisionError::WrongWorkstation)
        );
        assert_eq!(e.store.get_pending(&request).unwrap().status, "pending");
    }

    #[test]
    fn a_resolved_request_emits_exactly_one_resolution_event() {
        let e = engine();
        e.observe("codex", &hook("session.started", 1));
        let request = e.request_permission("host-1:codex:s1", "run cargo test");
        e.decide(&request, "host-1:codex:s1", e.workstation_id(), true)
            .unwrap();
        let resolutions = e
            .store
            .events("host-1:codex:s1", 50)
            .into_iter()
            .filter(|e| e.kind == EventKind::PermissionResolved)
            .count();
        assert_eq!(resolutions, 1);
    }

    #[test]
    fn stopping_a_session_expires_its_open_requests() {
        let e = engine();
        e.observe("codex", &hook("session.started", 1));
        let request = e.request_permission("host-1:codex:s1", "run rm");
        assert!(!e.store.pending().is_empty());
        // stop() reports that the session is not managed, but must still clear
        // the queue so no dead Approve button is left on screen.
        let _ = e.stop("host-1:codex:s1");
        assert_eq!(e.store.get_pending(&request).unwrap().status, "expired");
    }

    #[test]
    fn the_digest_grows_from_events_without_the_history() {
        let e = engine();
        let session = "host-1:codex:s1";
        e.observe("codex", &hook("session.started", 1));
        let mut editing = hook("file.changed", 2);
        editing.path = "src/main.rs".into();
        e.observe("codex", &editing);
        editing.path = "src/lib.rs".into();
        e.observe("codex", &editing);

        let digest = e.maintain_digest(session);
        assert_eq!(digest.changed_files.len(), 2);
        assert!(digest.approx_chars() < 1000);
        // Re-running is a no-op rather than a second copy of everything.
        assert_eq!(e.maintain_digest(session).changed_files.len(), 2);
    }

    #[test]
    fn events_queue_for_the_gateway_without_blocking_the_caller() {
        let e = engine();
        e.observe("codex", &hook("session.started", 1));
        assert_eq!(e.gateway.queued(), 1);
        assert_eq!(e.gateway.state(), gateway::LinkState::Offline);
    }

    #[test]
    fn managed_sink_accounts_and_queues_the_same_event_it_persists() {
        let e = engine();
        e.sink().publish(
            ZeusEvent::new("managed-1", "codex", 1, EventKind::AgentMessage)
                .with_field("usage", serde_json::json!({"input": 12, "output": 3})),
        );
        assert_eq!(e.store.events("managed-1", 10).len(), 1);
        assert_eq!(e.sessions.usage("managed-1").input, 12);
        assert_eq!(e.gateway.queued(), 1);
    }

    #[test]
    fn a_pending_request_without_a_session_is_still_decidable() {
        let e = engine();
        e.store.put_pending(PendingRequest {
            request_id: "req-x".into(),
            session_id: "gone".into(),
            workstation_id: e.workstation_id().to_string(),
            created_at: 0,
            expires_at: i64::MAX,
            status: "pending".into(),
            summary: "orphan".into(),
        });
        assert_eq!(
            e.decide("req-x", "gone", e.workstation_id(), false),
            Ok(())
        );
    }
}
