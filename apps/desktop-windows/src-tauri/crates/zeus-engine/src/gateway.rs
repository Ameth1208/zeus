//! GatewayClient — outbound only.
//!
//! The desktop dials out to the VPS over WSS and never listens. That is what
//! makes the desktop work from behind a home router with no port forwarding.
//!
//! Two properties matter more than throughput here:
//!
//!   * **local-first.** Events are written to the local store first and queued.
//!     A gateway that is down, slow or absent changes nothing about the agent.
//!   * **no raw content leaves the machine.** Only normalized events cross the
//!     wire, and a payload is size-capped. File contents, terminal output and
//!     source never go to the gateway or to a phone.

use crate::event::ZeusEvent;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;

/// Hard cap on one event's payload. Anything larger is dropped rather than
/// truncated silently: a half-sent tool result is worse than none.
pub const MAX_PAYLOAD_BYTES: usize = 8 * 1024;

/// How many events may wait while offline. Beyond this the oldest are dropped —
/// an unbounded queue on a laptop with no network is a memory leak.
pub const MAX_QUEUE: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub url: String,
    pub token: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkState {
    Offline,
    Connecting,
    Online,
}

/// A remote instruction from the gateway. Only approvals and control commands
/// arrive this way; session state always flows the other direction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RemoteCommand {
    Approve {
        request_id: String,
        session_id: String,
        workstation_id: String,
        /// Echoed back to the gateway so it can tell a fresh decision from a
        /// replay of one it already has.
        created_at: i64,
    },
    Deny {
        request_id: String,
        session_id: String,
        workstation_id: String,
        created_at: i64,
    },
    /// Nothing about a session is acted on remotely except an explicit command.
    Interrupt {
        session_id: String,
    },
    Stop {
        session_id: String,
    },
}

pub struct GatewayClient {
    endpoint: Mutex<Option<Endpoint>>,
    state: Mutex<LinkState>,
    queue: Mutex<VecDeque<ZeusEvent>>,
    // Counters live behind the same lock as the queue they describe.
    counters: Mutex<Counters>,
}

#[derive(Debug, Default)]
struct Counters {
    sent: u64,
    dropped: u64,
}

impl GatewayClient {
    pub fn new() -> Self {
        Self {
            endpoint: Mutex::new(None),
            state: Mutex::new(LinkState::Offline),
            queue: Mutex::new(VecDeque::new()),
            counters: Mutex::new(Counters::default()),
        }
    }

    pub fn configure(&self, endpoint: Option<Endpoint>) {
        *self.endpoint.lock().unwrap_or_else(|e| e.into_inner()) = endpoint;
    }

    pub fn state(&self) -> LinkState {
        *self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_state(&self, state: LinkState) {
        *self.state.lock().unwrap_or_else(|e| e.into_inner()) = state;
    }

    pub fn endpoint(&self) -> Option<Endpoint> {
        self.endpoint
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn is_configured(&self) -> bool {
        self.endpoint
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }

    /// True when this event is worth waking a phone for. Only four kinds are,
    /// and the payload is ids only — the phone fetches details after auth.
    pub fn is_pushworthy(event: &ZeusEvent) -> bool {
        event.kind.is_pushworthy()
    }

    /// Push payload: ids and nothing else.
    pub fn push_payload(event: &ZeusEvent) -> serde_json::Value {
        serde_json::json!({
            "session_id": event.session_id,
            "runtime": event.runtime,
            "kind": event.kind,
            "seq": event.seq,
        })
    }

    /// Enqueues an event for the gateway. Oversized payloads are dropped here
    /// rather than at the socket, so the drop is counted and visible.
    pub fn enqueue(&self, event: ZeusEvent) {
        let size = serde_json::to_vec(&event)
            .map(|b| b.len())
            .unwrap_or(usize::MAX);
        if size > MAX_PAYLOAD_BYTES {
            self.bump_dropped();
            return;
        }
        let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        if queue.len() >= MAX_QUEUE {
            queue.pop_front();
            self.bump_dropped();
        }
        queue.push_back(event);
    }

    fn bump_dropped(&self) {
        self.counters
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .dropped += 1;
    }

    /// Takes everything queued for the next connection attempt.
    pub fn drain(&self) -> Vec<ZeusEvent> {
        let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        let out: Vec<ZeusEvent> = queue.drain(..).collect();
        self.counters
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .sent += out.len() as u64;
        out
    }

    pub fn queued(&self) -> usize {
        self.queue.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    pub fn stats(&self) -> (u64, u64) {
        let counters = self.counters.lock().unwrap_or_else(|e| e.into_inner());
        (counters.sent, counters.dropped)
    }

    /// Normalizes `ws://host/v1/desktop/socket` from whatever the user typed.
    pub fn socket_url(endpoint: &Endpoint) -> Option<String> {
        let base = endpoint
            .url
            .trim()
            .trim_end_matches('/')
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        if !base.starts_with("ws://") && !base.starts_with("wss://") {
            return None;
        }
        Some(format!(
            "{base}/v1/desktop/socket?token={}",
            urlencode(&endpoint.token)
        ))
    }
}

fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Sessions worth a push, from a batch. Deduped by session so a burst of tool
/// events produces one notification, not twenty.
pub fn pushworthy_sessions<'a>(events: impl Iterator<Item = &'a ZeusEvent>) -> Vec<&'a str> {
    let mut out: Vec<&str> = Vec::new();
    for event in events {
        if GatewayClient::is_pushworthy(event) && !out.contains(&event.session_id.as_str()) {
            out.push(&event.session_id);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::EventKind;

    fn endpoint() -> Endpoint {
        Endpoint {
            url: "https://zeus.example.com".into(),
            token: "abc 123".into(),
        }
    }

    #[test]
    fn http_urls_become_websocket_urls() {
        assert_eq!(
            GatewayClient::socket_url(&endpoint()).unwrap(),
            "wss://zeus.example.com/v1/desktop/socket?token=abc%20123"
        );
        let plain = Endpoint {
            url: "http://127.0.0.1:8080/".into(),
            token: "local-dev".into(),
        };
        assert_eq!(
            GatewayClient::socket_url(&plain).unwrap(),
            "ws://127.0.0.1:8080/v1/desktop/socket?token=local-dev"
        );
    }

    #[test]
    fn a_non_url_is_refused_rather_than_guessed() {
        let bad = Endpoint {
            url: "not a url".into(),
            token: "t".into(),
        };
        assert!(GatewayClient::socket_url(&bad).is_none());
    }

    #[test]
    fn offline_queueing_never_loses_a_recent_event() {
        let client = GatewayClient::new();
        assert_eq!(client.state(), LinkState::Offline);
        client.enqueue(ZeusEvent::new("s1", "codex", 1, EventKind::AgentMessage));
        client.enqueue(ZeusEvent::new(
            "s1",
            "codex",
            2,
            EventKind::PermissionRequested,
        ));
        assert_eq!(client.queued(), 2);
        let drained = client.drain();
        assert_eq!(drained.len(), 2);
        assert_eq!(client.queued(), 0);
    }

    #[test]
    fn the_queue_is_bounded_and_drops_the_oldest() {
        let client = GatewayClient::new();
        for i in 0..(MAX_QUEUE + 5) {
            client.enqueue(ZeusEvent::new(
                "s1",
                "codex",
                i as u64,
                EventKind::AgentMessage,
            ));
        }
        assert_eq!(client.queued(), MAX_QUEUE);
        assert!(client.stats().1 >= 5, "drops must be counted");
        // The survivors are the newest, not the oldest.
        let first = client.drain().remove(0);
        assert_eq!(first.seq, 5);
    }

    #[test]
    fn an_oversized_payload_is_dropped_and_counted() {
        let client = GatewayClient::new();
        let huge = "x".repeat(MAX_PAYLOAD_BYTES + 1);
        client.enqueue(ZeusEvent::new("s1", "codex", 1, EventKind::AgentMessage).with_text(&huge));
        assert_eq!(client.queued(), 0);
        assert_eq!(client.stats().1, 1);
    }

    #[test]
    fn only_attention_kinds_are_pushworthy() {
        let approval = ZeusEvent::new("s1", "codex", 1, EventKind::PermissionRequested);
        let chatter = ZeusEvent::new("s1", "codex", 2, EventKind::AgentMessage);
        assert!(GatewayClient::is_pushworthy(&approval));
        assert!(!GatewayClient::is_pushworthy(&chatter));
    }

    #[test]
    fn push_payloads_carry_ids_only() {
        let event = ZeusEvent::new("s1", "codex", 7, EventKind::PermissionRequested)
            .with_text("run rm -rf build");
        let payload = GatewayClient::push_payload(&event);
        let keys: Vec<&String> = payload.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 4);
        assert!(!serde_json::to_string(&payload).unwrap().contains("rm -rf"));
    }

    #[test]
    fn one_notification_per_session_not_per_event() {
        let events = vec![
            ZeusEvent::new("s1", "codex", 1, EventKind::PermissionRequested),
            ZeusEvent::new("s1", "codex", 2, EventKind::SessionCompleted),
            ZeusEvent::new("s2", "agy", 1, EventKind::SessionFailed),
            ZeusEvent::new("s2", "agy", 2, EventKind::AgentMessage),
        ];
        let sessions = pushworthy_sessions(events.iter());
        assert_eq!(sessions, vec!["s1", "s2"]);
    }
}
