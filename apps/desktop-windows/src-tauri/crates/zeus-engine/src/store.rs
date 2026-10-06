//! Local-first persistence.
//!
//! Zeus must work with the network down, so the local log is the source of
//! truth and the gateway is a mirror. Layout under the app data dir:
//!
//! ```text
//! sessions.json          snapshot: sessions, seq counters, pending requests
//! events.log             append-only NDJSON, one ZeusEvent per line
//! digests/<session>.json SessionDigest, rewritten incrementally
//! ```
//!
//! Appending-then-snapshot means a crash loses at most the tail of the log,
//! which is replayed on load. The same atomic tmp+rename the gateway store
//! uses, so a partial write can never replace a good snapshot.

use crate::digest::SessionDigest;
use crate::event::{EventKind, ZeusEvent};
use crate::runtime::Capability;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// How much history a session keeps locally. Sessions are cheap to resume from
/// the runtime; keeping an unbounded log would grow forever.
const MAX_EVENTS_PER_SESSION: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingRequest {
    pub request_id: String,
    pub session_id: String,
    /// Desktop is the approval authority; a remote reply is only honoured when
    /// every field here matches.
    pub workstation_id: String,
    pub created_at: i64,
    pub expires_at: i64,
    /// `pending` | `approved` | `denied` | `expired`. A request is answered at
    /// most once; a second reply for a decided request is a replay and is
    /// rejected rather than re-applied.
    pub status: String,
    pub summary: String,
}

impl PendingRequest {
    pub fn is_open(&self, now: i64) -> bool {
        self.status == "pending" && now < self.expires_at
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub runtime: String,
    pub project: String,
    pub model: String,
    pub status: String,
    pub capabilities: Vec<String>,
    pub external_session_id: Option<String>,
    pub last_seq: u64,
    pub updated_at: i64,
    pub message: String,
    /// Resumable sessions are the ones worth offering "Resume" on.
    pub resumable: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Snapshot {
    pub sessions: HashMap<String, SessionRecord>,
    pub pending: HashMap<String, PendingRequest>,
}

pub struct LocalStore {
    root: PathBuf,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    sessions: HashMap<String, SessionRecord>,
    events: HashMap<String, Vec<ZeusEvent>>,
    pending: HashMap<String, PendingRequest>,
    digests: HashMap<String, SessionDigest>,
}

impl LocalStore {
    pub fn open(root: PathBuf) -> Self {
        // Created up front: an append into a missing directory fails silently,
        // which would lose the first events of a fresh install.
        let _ = fs::create_dir_all(&root);
        let store = Self {
            root,
            state: Mutex::new(State::default()),
        };
        store.load();
        store
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn events_path(&self) -> PathBuf {
        self.root.join("events.log")
    }

    fn snapshot_path(&self) -> PathBuf {
        self.root.join("sessions.json")
    }

    fn digest_path(&self, session_id: &str) -> PathBuf {
        self.root.join("digests").join(format!("{session_id}.json"))
    }

    /// Rebuilds state from the snapshot, then replays the log tail. Returns the
    /// number of replayed events so boot can report it.
    pub fn load(&self) -> usize {
        let mut state = match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        *state = State::default();

        if let Ok(raw) = fs::read_to_string(self.snapshot_path()) {
            if let Ok(snap) = serde_json::from_str::<Snapshot>(&raw) {
                state.sessions = snap.sessions;
                state.pending = snap.pending;
            }
        }

        let mut replayed = 0usize;
        if let Ok(file) = File::open(self.events_path()) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(event) = serde_json::from_str::<ZeusEvent>(&line) else {
                    // A torn last line after a crash is expected; skip it.
                    continue;
                };
                Self::reduce(&mut state, event);
                replayed += 1;
            }
        }

        let dir = self.root.join("digests");
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let Ok(raw) = fs::read_to_string(entry.path()) else {
                    continue;
                };
                if let Ok(digest) = serde_json::from_str::<SessionDigest>(&raw) {
                    state.digests.insert(digest.session_id.clone(), digest);
                }
            }
        }

        replayed
    }

    /// Folds one event into local state. Shared by live ingest and log replay so
    /// a restarted app and a running one agree on what a session looks like.
    fn reduce(state: &mut State, event: ZeusEvent) {
        let seq = event.seq;
        let entry = state.events.entry(event.session_id.clone()).or_default();
        // Log replay can legitimately repeat an event; keep one copy.
        if entry
            .iter()
            .any(|e| e.event_id == event.event_id || e.seq == seq)
        {
            return;
        }
        entry.push(event.clone());
        if entry.len() > MAX_EVENTS_PER_SESSION {
            let drop = entry.len() - MAX_EVENTS_PER_SESSION;
            entry.drain(0..drop);
        }

        let kind = event.kind;
        let session_id = event.session_id.clone();
        let runtime = event.runtime.clone();
        let summary = event.summary();
        let external = event.external_session_id.clone();

        let record = state
            .sessions
            .entry(session_id.clone())
            .or_insert_with(|| SessionRecord {
                id: session_id.clone(),
                runtime,
                project: String::new(),
                model: String::new(),
                status: "idle".into(),
                capabilities: Vec::new(),
                external_session_id: None,
                last_seq: 0,
                updated_at: event.time,
                message: String::new(),
                resumable: false,
            });

        record.status = status_for(kind).to_string();
        record.last_seq = record.last_seq.max(seq);
        record.updated_at = event.time;
        record.message = summary;
        if let Some(id) = external {
            record.external_session_id = Some(id);
        }
        record.resumable = record.resumable || record.external_session_id.is_some();

        if matches!(kind, EventKind::SessionCompleted | EventKind::SessionFailed) {
            state.pending.retain(|_, p| p.session_id != session_id);
            if let Some(existing) = state.sessions.get_mut(&session_id) {
                existing
                    .capabilities
                    .retain(|c| c == "send" || c == "observe");
            }
        }
    }

    pub fn ingest(&self, event: ZeusEvent) {
        {
            let mut state = match self.state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            Self::reduce(&mut state, event.clone());
        }
        self.append(&event);
        self.persist_snapshot();
    }

    fn append(&self, event: &ZeusEvent) {
        let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.events_path())
        else {
            return;
        };
        if let Ok(line) = serde_json::to_string(event) {
            let _ = writeln!(file, "{line}");
        }
    }

    fn persist_snapshot(&self) {
        let snapshot = {
            let state = match self.state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            Snapshot {
                sessions: state.sessions.clone(),
                pending: state.pending.clone(),
            }
        };
        write_atomic(&self.snapshot_path(), &snapshot);
    }

    pub fn sessions(&self) -> Vec<SessionRecord> {
        let state = match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut out: Vec<SessionRecord> = state.sessions.values().cloned().collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }

    pub fn session(&self, id: &str) -> Option<SessionRecord> {
        let state = match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.sessions.get(id).cloned()
    }

    pub fn events(&self, session_id: &str, limit: usize) -> Vec<ZeusEvent> {
        let state = match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        let Some(history) = state.events.get(session_id) else {
            return Vec::new();
        };
        let start = history.len().saturating_sub(limit);
        history[start..].to_vec()
    }

    /// Next sequence number for a session. Monotonic across restarts because
    /// it resumes from the snapshot's `last_seq`.
    pub fn next_seq(&self, session_id: &str) -> u64 {
        let state = match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        state
            .sessions
            .get(session_id)
            .map(|s| s.last_seq + 1)
            .unwrap_or(1)
    }

    pub fn set_capabilities(&self, session_id: &str, caps: &[Capability]) {
        {
            let mut state = match self.state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            if let Some(record) = state.sessions.get_mut(session_id) {
                record.capabilities = caps.iter().map(|c| c.as_str().to_string()).collect();
            }
        }
        self.persist_snapshot();
    }

    pub fn set_project(&self, session_id: &str, project: &str, model: &str) {
        {
            let mut state = match self.state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            if let Some(record) = state.sessions.get_mut(session_id) {
                if !project.is_empty() {
                    record.project = project.to_string();
                }
                if !model.is_empty() {
                    record.model = model.to_string();
                }
            }
        }
        self.persist_snapshot();
    }

    pub fn put_pending(&self, request: PendingRequest) {
        {
            let mut state = match self.state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            state.pending.insert(request.request_id.clone(), request);
        }
        self.persist_snapshot();
    }

    pub fn pending(&self) -> Vec<PendingRequest> {
        let state = match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.pending.values().cloned().collect()
    }

    pub fn get_pending(&self, request_id: &str) -> Option<PendingRequest> {
        let state = match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.pending.get(request_id).cloned()
    }

    pub fn set_pending_status(&self, request_id: &str, status: &str) {
        {
            let mut state = match self.state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            if let Some(request) = state.pending.get_mut(request_id) {
                request.status = status.to_string();
            }
        }
        self.persist_snapshot();
    }

    pub fn drop_session(&self, session_id: &str) {
        {
            let mut state = match self.state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            state.sessions.remove(session_id);
            state.events.remove(session_id);
            state.digests.remove(session_id);
            state.pending.retain(|_, p| p.session_id != session_id);
        }
        let _ = fs::remove_file(self.digest_path(session_id));
        self.persist_snapshot();
    }

    pub fn digest(&self, session_id: &str) -> Option<SessionDigest> {
        let state = match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.digests.get(session_id).cloned()
    }

    pub fn put_digest(&self, digest: SessionDigest) {
        {
            let mut state = match self.state.lock() {
                Ok(s) => s,
                Err(poisoned) => poisoned.into_inner(),
            };
            state
                .digests
                .insert(digest.session_id.clone(), digest.clone());
        }
        write_atomic(&self.digest_path(&digest.session_id), &digest);
    }

    /// Events newer than `last_seq` for a session, used to fill the gap after
    /// the gateway or mobile reconnects.
    pub fn since(&self, session_id: &str, last_seq: u64) -> Vec<ZeusEvent> {
        let state = match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        state
            .events
            .get(session_id)
            .map(|h| h.iter().filter(|e| e.seq > last_seq).cloned().collect())
            .unwrap_or_default()
    }
}

/// Status a session shows for a kind. The gateway mirrors this table in Go
/// (`statusForEvent`); changing one means changing the other.
pub fn status_for(kind: EventKind) -> &'static str {
    match kind {
        EventKind::SessionStarted
        | EventKind::AgentThinking
        | EventKind::AgentMessage
        | EventKind::ToolStarted
        | EventKind::ToolCompleted
        | EventKind::ToolFailed => "working",
        EventKind::PermissionRequested | EventKind::InputRequested => "waiting",
        EventKind::PermissionResolved => "working",
        EventKind::SessionCompleted => "completed",
        EventKind::SessionFailed => "failed",
    }
}

fn write_atomic<T: Serialize>(path: &Path, value: &T) {
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(data) = serde_json::to_vec_pretty(value) else {
        return;
    };
    let tmp = path.with_extension("tmp");
    if File::create(&tmp)
        .and_then(|mut f| f.write_all(&data))
        .is_err()
    {
        return;
    }
    let _ = fs::rename(&tmp, path);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique scratch dir per test run, so a previous run's log cannot make a
    /// test pass or fail spuriously.
    fn scratch(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zeus-store-{label}-{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn event(session: &str, seq: u64, kind: EventKind) -> ZeusEvent {
        ZeusEvent::new(session, "codex", seq, kind)
    }

    #[test]
    fn restart_rebuilds_sessions_and_replays_the_log_tail() {
        let dir = std::env::temp_dir().join(format!("zeus-store-{}", uuid::Uuid::new_v4()));
        let store = LocalStore::open(dir.clone());
        store.ingest(event("s1", 1, EventKind::SessionStarted));
        store.ingest(event("s1", 2, EventKind::ToolStarted));
        store.set_project("s1", "zeus", "gpt-5");
        drop(store);

        let reopened = LocalStore::open(dir.clone());
        let replayed = reopened.load();
        assert!(replayed >= 2, "expected the log to replay, got {replayed}");
        let record = reopened.session("s1").expect("session survived restart");
        assert_eq!(record.status, "working");
        assert_eq!(record.last_seq, 2);
        assert_eq!(record.project, "zeus");
        assert_eq!(reopened.next_seq("s1"), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_seq_is_collapsed() {
        let store = LocalStore::open(scratch("dup"));
        store.ingest(event("s1", 1, EventKind::SessionStarted));
        store.ingest(event("s1", 1, EventKind::SessionStarted));
        assert_eq!(store.events("s1", 10).len(), 1);
    }

    #[test]
    fn since_returns_only_newer_events() {
        let store = LocalStore::open(scratch("since"));
        store.ingest(event("s1", 1, EventKind::SessionStarted));
        store.ingest(event("s1", 2, EventKind::AgentMessage));
        store.ingest(event("s1", 3, EventKind::SessionCompleted));
        let tail = store.since("s1", 1);
        assert_eq!(tail.len(), 2);
        assert_eq!(tail[0].seq, 2);
    }

    #[test]
    fn a_terminal_kind_clears_pending_requests() {
        let store = LocalStore::open(scratch("pending"));
        store.ingest(event("s1", 1, EventKind::SessionStarted));
        store.put_pending(PendingRequest {
            request_id: "req-1".into(),
            session_id: "s1".into(),
            workstation_id: "ws-1".into(),
            created_at: 1,
            expires_at: 9_999,
            status: "pending".into(),
            summary: "run rm".into(),
        });
        assert_eq!(store.pending().len(), 1);
        store.ingest(event("s1", 2, EventKind::SessionCompleted));
        assert!(store.pending().is_empty());
    }

    #[test]
    fn pending_requests_expire() {
        let request = PendingRequest {
            request_id: "req-2".into(),
            session_id: "s1".into(),
            workstation_id: "ws-1".into(),
            created_at: 0,
            expires_at: 100,
            status: "pending".into(),
            summary: String::new(),
        };
        assert!(request.is_open(99));
        assert!(!request.is_open(100));
        assert!(!PendingRequest {
            status: "denied".into(),
            ..request
        }
        .is_open(1));
    }

    #[test]
    fn status_table_matches_the_gateway_mirror() {
        assert_eq!(status_for(EventKind::AgentThinking), "working");
        assert_eq!(status_for(EventKind::PermissionRequested), "waiting");
        assert_eq!(status_for(EventKind::SessionCompleted), "completed");
        assert_eq!(status_for(EventKind::SessionFailed), "failed");
    }
}
