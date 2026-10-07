//! SessionManager and RuntimeSupervisor.
//!
//! The manager is the only place that knows which sessions are live and what
//! may be done to them. The supervisor is the only place that notices a runtime
//! process died. They are separate because "the user pressed Stop" and "codex
//! segfaulted" are the same event to a session table and very different events
//! to a user: one is a decision, the other is a fault.

use crate::event::now_ms;
use crate::event::{EventKind, ZeusEvent};
use crate::registry::RuntimeRegistry;
use crate::runtime::{Capability, DriverError, EventSink, LaunchSpec, Mode, RuntimeHandle};
use crate::store::LocalStore;
use crate::tokens::{usage_from_payload, TokenUsage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionView {
    pub id: String,
    pub runtime: String,
    pub mode: Mode,
    pub project: String,
    pub model: String,
    pub status: String,
    pub live: bool,
    pub capabilities: Vec<String>,
    pub external_session_id: Option<String>,
    pub usage: TokenUsage,
    pub digest_chars: usize,
    pub last_seq: u64,
}

/// How long an agent may be silent while its status still says "working".
///
/// Two minutes is long enough that a long tool call — a build, a test run, a
/// model thinking for a while — is never mistaken for a dead one, and short
/// enough that a crashed session stops claiming to be busy.
const WORKING_STALE_MS: i64 = 120_000;

/// The status to report, correcting a stored "working" that time has invalidated.
///
/// Only "working" is corrected, and only downward. A stored `waiting` is not
/// time-sensitive — the user still owes an answer however long ago the request
/// arrived — and `completed`/`failed`/`stopped` are terminal and never expire. A
/// managed session with a live handle is left alone entirely: if Zeus is holding
/// the process, it is working even when the runtime says nothing, which is the
/// one case where silence is expected rather than suspicious.
fn effective_status(stored: &str, updated_at: i64, now: i64, has_live_handle: bool) -> String {
    if stored != "working" || has_live_handle {
        return stored.to_string();
    }
    if updated_at > 0 && now.saturating_sub(updated_at) > WORKING_STALE_MS {
        return "stale".to_string();
    }
    stored.to_string()
}

/// A live managed session. The handle is a value, not a process: dropping it
/// cannot stop the runtime, which is what keeps the UI from owning sessions.
#[derive(Debug, Clone)]
pub struct LiveSession {
    pub handle: RuntimeHandle,
    pub spec: LaunchSpec,
    pub launch_spec_project: String,
    pub capabilities: Vec<Capability>,
}

pub struct SessionManager {
    store: Arc<LocalStore>,
    registry: Arc<RuntimeRegistry>,
    live: Mutex<HashMap<String, LiveSession>>,
    usage: Mutex<HashMap<String, TokenUsage>>,
}

/// A session whose process vanished without Zeus asking it to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Crash {
    pub session_id: String,
    pub runtime: String,
    pub exit_code: Option<i32>,
}

impl SessionManager {
    pub fn new(store: Arc<LocalStore>, registry: Arc<RuntimeRegistry>) -> Self {
        Self {
            store,
            registry,
            live: Mutex::new(HashMap::new()),
            usage: Mutex::new(HashMap::new()),
        }
    }

    pub fn store(&self) -> &Arc<LocalStore> {
        &self.store
    }

    /// Starts a managed session. Refuses when the runtime cannot actually be
    /// launched, rather than creating a session that will never produce events.
    pub fn launch(
        &self,
        runtime: &str,
        spec: LaunchSpec,
        sink: Arc<dyn EventSink>,
    ) -> Result<RuntimeHandle, DriverError> {
        let driver = self
            .registry
            .get(runtime)
            .ok_or(DriverError::Unsupported("this runtime"))?;
        if !driver.detect() {
            return Err(DriverError::Failed(format!("{runtime} is not installed")));
        }
        let handle = driver.launch(spec.clone(), sink)?;
        let capabilities: Vec<Capability> = driver.capabilities().available.into_iter().collect();
        self.store
            .set_capabilities(&handle.session_id, &capabilities);
        self.store.set_project(
            &handle.session_id,
            &spec.project.clone().unwrap_or_default(),
            spec.model.as_deref().unwrap_or_default(),
        );
        self.live.lock().unwrap_or_else(|e| e.into_inner()).insert(
            handle.session_id.clone(),
            LiveSession {
                handle: handle.clone(),
                launch_spec_project: spec.project.clone().unwrap_or_default(),
                spec,
                capabilities,
            },
        );
        Ok(handle)
    }

    /// Routes input to whichever runtime owns the session, and refuses for
    /// runtimes that cannot receive it.
    pub fn send(&self, session_id: &str, text: &str) -> Result<(), DriverError> {
        let (handle, runtime) = self.live_entry(session_id)?;
        if !self
            .registry
            .capabilities(&runtime)
            .is_some_and(|c| c.has(Capability::Send))
        {
            return Err(DriverError::Unsupported("send"));
        }
        let driver = self
            .registry
            .get(&runtime)
            .ok_or(DriverError::Unsupported("this runtime"))?;
        driver.send(&handle, text)
    }

    pub fn interrupt(&self, session_id: &str) -> Result<(), DriverError> {
        let (handle, runtime) = self.live_entry(session_id)?;
        let driver = self
            .registry
            .get(&runtime)
            .ok_or(DriverError::Unsupported("this runtime"))?;
        driver.interrupt(&handle)
    }

    pub fn stop(&self, session_id: &str) -> Result<(), DriverError> {
        let (handle, runtime) = self.live_entry(session_id)?;
        let driver = self
            .registry
            .get(&runtime)
            .ok_or(DriverError::Unsupported("this runtime"))?;
        driver.stop(&handle)?;
        self.live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(session_id);
        Ok(())
    }

    /// Restarts an ended session from the runtime's own conversation id.
    pub fn resume(
        &self,
        session_id: &str,
        sink: Arc<dyn EventSink>,
    ) -> Result<RuntimeHandle, DriverError> {
        let record = self
            .store
            .session(session_id)
            .ok_or_else(|| DriverError::Failed("unknown session".into()))?;
        let Some(external) = record.external_session_id.clone() else {
            return Err(DriverError::Unsupported(
                "resume of a session that never started",
            ));
        };
        if !self
            .live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(session_id)
        {
            // Resuming into the same id keeps the island on the same session
            // instead of stranding the old one.
            return Err(DriverError::Failed(
                "resume must attach to a managed session handle".into(),
            ));
        }
        let driver = self
            .registry
            .get(&record.runtime)
            .ok_or(DriverError::Unsupported("this runtime"))?;
        let spec = self
            .live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .map(|s| s.spec.clone())
            .unwrap_or_else(|| LaunchSpec {
                cwd: PathBuf::from("."),
                prompt: None,
                model: None,
                resume_from: Some(external.clone()),
                project: Some(record.project.clone()),
            });
        let mut spec = spec;
        spec.resume_from = Some(external.clone());
        spec.prompt = None;
        driver.resume(spec, sink)
    }

    fn live_entry(&self, session_id: &str) -> Result<(RuntimeHandle, String), DriverError> {
        let live = self.live.lock().unwrap_or_else(|e| e.into_inner());
        let session = live
            .get(session_id)
            .ok_or_else(|| DriverError::Failed("session is not running".into()))?;
        Ok((session.handle.clone(), session.handle.runtime.clone()))
    }

    pub fn is_live(&self, session_id: &str) -> bool {
        self.live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(session_id)
    }

    /// Folds an event's usage report into the session totals. Called from the
    /// engine's single ingest path so accounting cannot diverge from history.
    pub fn account(&self, event: &ZeusEvent) {
        if let Some(reported) = usage_from_payload(&event.payload) {
            let mut usage = self.usage.lock().unwrap_or_else(|e| e.into_inner());
            usage
                .entry(event.session_id.clone())
                .or_default()
                .apply_measured(reported);
        }
    }

    pub fn usage(&self, session_id: &str) -> TokenUsage {
        self.usage
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .copied()
            .unwrap_or_default()
    }

    /// Everything the island and the mobile app read. Assembled from the local
    /// store so it survives a webview reload without another round trip.
    pub fn views(&self) -> Vec<SessionView> {
        let live = self.live.lock().unwrap_or_else(|e| e.into_inner());
        let usage = self.usage.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_ms();
        self.store
            .sessions()
            .into_iter()
            .map(|record| {
                let live_session = live.get(&record.id);
                let digest_chars = self
                    .store
                    .digest(&record.id)
                    .map(|d| d.approx_chars())
                    .unwrap_or(0);
                SessionView {
                    id: record.id.clone(),
                    runtime: record.runtime.clone(),
                    mode: self
                        .registry
                        .observed(&record.runtime)
                        .map(|_| Mode::Observed)
                        .filter(|_| live_session.is_none())
                        .unwrap_or(Mode::Managed),
                    project: record.project.clone(),
                    model: record.model.clone(),
                    // Correct a stale "working" at read time rather than trusting
                    // the stored status forever.
                    //
                    // `status_for` can only describe the newest event, so a
                    // session that reported `tool.started` and then went quiet —
                    // the process died, the hook stopped, the agent crashed —
                    // stayed "working" indefinitely. The island then claimed an
                    // agent was busy on a machine where nothing was running. A
                    // managed session has a live handle we can check directly;
                    // for an observed one, silence past the threshold is the only
                    // signal available, and it is a truthful one.
                    status: effective_status(
                        &record.status,
                        record.updated_at,
                        now,
                        live_session.is_some(),
                    ),
                    live: live_session.is_some(),
                    capabilities: live_session
                        .map(|s| {
                            s.capabilities
                                .iter()
                                .map(|c| c.as_str().to_string())
                                .collect()
                        })
                        .unwrap_or_else(|| record.capabilities.clone()),
                    external_session_id: record.external_session_id.clone(),
                    usage: usage.get(&record.id).copied().unwrap_or_default(),
                    digest_chars,
                    last_seq: record.last_seq,
                }
            })
            .collect()
    }
}

/// Watches managed processes and reports the ones that die on their own.
///
/// Runs as one polling loop rather than a thread per session: a crashed agent
/// must not be able to spawn threads by crashing repeatedly.
pub struct RuntimeSupervisor {
    sessions: Arc<SessionManager>,
    interval: std::time::Duration,
}

impl RuntimeSupervisor {
    pub fn new(sessions: Arc<SessionManager>) -> Self {
        Self {
            sessions,
            interval: std::time::Duration::from_secs(5),
        }
    }

    /// One sweep. Returns the crashes found, so the caller decides how to
    /// report them and tests can assert without a timer.
    pub fn sweep(&self) -> Vec<Crash> {
        let live: Vec<RuntimeHandle> = {
            let guard = self.sessions.live.lock().unwrap_or_else(|e| e.into_inner());
            guard.values().map(|s| s.handle.clone()).collect()
        };
        let mut crashes = Vec::new();
        for handle in live {
            let Some(driver) = self.sessions.registry.get(&handle.runtime) else {
                continue;
            };
            // A driver that owns a process reports it gone; one that does not
            // (observed mode) has nothing to sweep.
            if driver.detect() && !self.process_alive(&handle) {
                crashes.push(Crash {
                    session_id: handle.session_id.clone(),
                    runtime: handle.runtime.clone(),
                    exit_code: None,
                });
                let _ = self.sessions.stop(&handle.session_id);
            }
        }
        crashes
    }

    fn process_alive(&self, handle: &RuntimeHandle) -> bool {
        let Some(pid) = handle.pid else {
            return true;
        };
        #[cfg(unix)]
        {
            // A pid that no longer exists means the runtime is gone. Signal 0
            // performs the permission and existence check without a signal.
            unsafe { libc_kill(pid as i32, 0) == 0 }
        }
        #[cfg(not(unix))]
        {
            // Windows: the driver already noticed via its reader thread, which
            // publishes session.failed. Nothing to poll.
            let _ = pid;
            true
        }
    }

    /// Spawns the polling loop on Tauri's runtime.
    pub fn spawn(self: Arc<Self>, sink: Arc<dyn EventSink>) {
        let interval = self.interval;
        std::thread::spawn(move || loop {
            std::thread::sleep(interval);
            for crash in self.sweep() {
                sink.publish(
                    ZeusEvent::new(
                        &crash.session_id,
                        &crash.runtime,
                        0,
                        EventKind::SessionFailed,
                    )
                    .with_text(&format!("{} exited unexpectedly", crash.runtime)),
                );
            }
        });
    }
}

#[cfg(unix)]
unsafe fn libc_kill(pid: i32, sig: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe { kill(pid, sig) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::LocalStore;

    fn manager() -> SessionManager {
        let dir = std::env::temp_dir().join(format!("zeus-sess-{}", uuid::Uuid::new_v4()));
        let store = Arc::new(LocalStore::open(dir));
        SessionManager::new(store, Arc::new(RuntimeRegistry::new()))
    }

    fn spec() -> LaunchSpec {
        LaunchSpec {
            cwd: std::env::temp_dir(),
            prompt: Some("hello".into()),
            model: None,
            resume_from: None,
            project: Some("zeus".into()),
        }
    }

    #[test]
    fn launching_a_missing_runtime_fails_without_creating_a_session() {
        let m = manager();
        let err = m
            .launch("opencode", spec(), Arc::new(NullSink))
            .unwrap_err();
        assert!(matches!(err, DriverError::Unsupported(_)));
        assert!(m.views().is_empty());
    }

    #[test]
    fn controls_on_a_session_that_is_not_running_are_refused() {
        let m = manager();
        assert!(m.send("nope", "hi").is_err());
        assert!(m.interrupt("nope").is_err());
        assert!(m.stop("nope").is_err());
        assert!(!m.is_live("nope"));
    }

    #[test]
    fn resuming_without_a_conversation_id_is_refused() {
        let m = manager();
        let err = m.resume("unknown", Arc::new(NullSink)).unwrap_err();
        assert!(err.to_string().contains("unknown session"));
    }

    #[test]
    fn usage_is_accounted_only_from_reported_totals() {
        let m = manager();
        m.account(
            &ZeusEvent::new("s1", "codex", 1, EventKind::AgentMessage).with_field(
                "usage",
                serde_json::json!({"input": 120, "output": 8, "cached": 40}),
            ),
        );
        let usage = m.usage("s1");
        assert_eq!(usage.input, 120);
        assert_eq!(usage.cached, 40);
        assert!(!usage.estimated);

        // A later report replaces rather than adds.
        m.account(
            &ZeusEvent::new("s1", "codex", 2, EventKind::SessionCompleted)
                .with_field("usage", serde_json::json!({"input": 300, "output": 30})),
        );
        assert_eq!(m.usage("s1").input, 300);
    }

    #[test]
    fn an_event_without_usage_leaves_the_counters_alone() {
        let m = manager();
        m.account(
            &ZeusEvent::new("s1", "codex", 1, EventKind::AgentMessage)
                .with_field("usage", serde_json::json!({"input": 50, "output": 5})),
        );
        m.account(&ZeusEvent::new("s1", "codex", 2, EventKind::AgentThinking));
        assert_eq!(m.usage("s1").input, 50);
    }

    struct NullSink;

    impl EventSink for NullSink {
        fn publish(&self, _event: ZeusEvent) {}
        fn next_seq(&self, _session_id: &str) -> u64 {
            1
        }
    }
}
