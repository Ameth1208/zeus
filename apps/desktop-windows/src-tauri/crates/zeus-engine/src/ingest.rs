//! Loopback ingest for observed sessions.
//!
//! The existing adapters in `adapters/` POST to `/v1/events`. Pointing
//! `ZEUS_GATEWAY_URL` at this listener makes them report to the desktop
//! directly, which is what makes an observed session work with no network at
//! all — the normal case for local-first.
//!
//! Deliberately minimal: one thread, one route, bound to loopback only. It is
//! not an API surface, so it has no versioning, no CORS and no discovery.
//!
//! Safety: it accepts reports from any local process. That is the same trust
//! model the runtime hooks already operate under — a local process could fake
//! events whether or not Zeus listens — and the blast radius is limited to this
//! user's own session list. It still refuses anything that is not a well-formed
//! Zeus event, so a stray HTTP request cannot inject arbitrary payloads.

use crate::event::ZeusEvent;
use crate::runtime::observed::HookEvent;
use crate::ZeusEngine;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::sync::Arc;

/// Port the desktop listens on for hook reports. High and fixed so an adapter's
/// `ZEUS_GATEWAY_URL` is a constant.
pub const DEFAULT_PORT: u16 = 8787;

/// Refuses a body larger than this. Hook payloads are small; anything bigger is
/// a mistake or an attack.
const MAX_BODY: usize = 256 * 1024;

pub struct IngestServer {
    port: u16,
}

impl IngestServer {
    /// Starts the listener on a background thread. A bind failure is reported
    /// rather than panicking: another Zeus instance may already hold the port,
    /// and losing observed events is better than refusing to start.
    pub fn start(engine: Arc<ZeusEngine>, port: u16) -> Option<Self> {
        let addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
        let listener = TcpListener::bind(addr).ok()?;
        let bound = listener.local_addr().ok()?.port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let engine = engine.clone();
                std::thread::spawn(move || {
                    let _ = handle(engine, stream);
                });
            }
        });
        Some(Self { port: bound })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// The value an adapter should use as `ZEUS_GATEWAY_URL`.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

fn handle(engine: Arc<ZeusEngine>, mut stream: std::net::TcpStream) -> std::io::Result<()> {
    // A short read timeout: a hook that opens a connection and stalls must not
    // pin a thread forever.
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");

    let mut content_length = 0usize;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            break;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }

    if method != "POST" || path != "/v1/events" {
        return respond(&mut stream, 404, "{\"error\":\"not found\"}");
    }
    if content_length > MAX_BODY {
        return respond(&mut stream, 413, "{\"error\":\"payload too large\"}");
    }

    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body)?;
    let accepted = match serde_json::from_slice::<HookEvent>(&body) {
        Ok(hook) => match engine.observe(&hook.runtime, &hook) {
            Some(event) => {
                let _ = serde_json::to_string(&event);
                true
            }
            None => false,
        },
        Err(_) => false,
    };

    if accepted {
        respond(&mut stream, 202, "{\"ok\":true}")
    } else {
        // A hook must stay fail-open: the agent never blocks on Zeus, so a
        // rejection is silent to the runtime.
        respond(&mut stream, 202, "{\"ok\":true,\"ignored\":true}")
    }
}

fn respond(stream: &mut std::net::TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        202 => "Accepted",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "OK",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    stream.flush()
}

/// Serialized form of an event, used by the tests and by anything that needs to
/// assert on what actually went over the wire.
pub fn event_json(event: &ZeusEvent) -> String {
    serde_json::to_string(event).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Arc<ZeusEngine> {
        let base = std::env::temp_dir().join(format!("zeus-ingest-{}", uuid::Uuid::new_v4()));
        ZeusEngine::new(base.join("data"), base.join("project"))
    }

    /// Reads the status line only. The server closes as soon as it has answered,
    /// so draining the whole body races the socket teardown, and a reset on
    /// close says nothing about whether the response arrived.
    fn post(port: u16, path: &str, body: &str) -> String {
        use std::net::TcpStream;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let request = format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).unwrap();
        stream.flush().unwrap();
        let mut response = String::new();
        BufReader::new(stream)
            .read_line(&mut response)
            .expect("status line");
        response
    }

    #[test]
    fn a_hook_report_becomes_a_local_event() {
        let e = engine();
        let server = IngestServer::start(e.clone(), 0).expect("listener");
        let body = serde_json::json!({
            "session_id": "host-1:codex:s1",
            "agent_id": "host-1:codex:s1",
            "runtime": "codex",
            "type": "permission.requested",
            "message": "run cargo test",
            "metadata": {"request_id": "req-1"}
        })
        .to_string();

        let response = post(server.port(), "/v1/events", &body);
        assert!(response.starts_with("HTTP/1.1 202"), "{response}");
        // The event is in the local store, so the island sees it with no network.
        let stored = e.store.events("host-1:codex:s1", 10);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].kind, EventKind::PermissionRequested);
        assert_eq!(stored[0].payload["request_id"], "req-1");
    }

    #[test]
    fn a_malformed_report_is_accepted_but_ignored_so_the_agent_never_blocks() {
        let e = engine();
        let server = IngestServer::start(e.clone(), 0).expect("listener");
        let response = post(server.port(), "/v1/events", "{not json");
        // 202 even on garbage: the hook is fail-open and must see success.
        assert!(response.starts_with("HTTP/1.1 202"), "{response}");
        assert!(e.store.sessions().is_empty());
    }

    #[test]
    fn other_paths_are_not_served() {
        let e = engine();
        let server = IngestServer::start(e, 0).expect("listener");
        let response = post(server.port(), "/v1/sessions", "{}");
        assert!(response.starts_with("HTTP/1.1 404"), "{response}");
    }

    #[test]
    fn an_unknown_runtime_is_ignored_rather_than_invented() {
        let e = engine();
        let server = IngestServer::start(e.clone(), 0).expect("listener");
        let body = serde_json::json!({
            "session_id": "s1", "agent_id": "a1", "runtime": "nope", "type": "thinking"
        })
        .to_string();
        let response = post(server.port(), "/v1/events", &body);
        // 202 either way: the hook is fail-open and must never see a failure.
        assert!(response.starts_with("HTTP/1.1 202"), "{response}");
        // The observable that matters is that nothing was invented.
        assert!(e.store.sessions().is_empty());
    }

    #[test]
    fn the_advertised_url_matches_the_bound_port() {
        let e = engine();
        let server = IngestServer::start(e, 0).expect("listener");
        assert_eq!(server.url(), format!("http://127.0.0.1:{}", server.port()));
    }

    use crate::event::EventKind;
}
