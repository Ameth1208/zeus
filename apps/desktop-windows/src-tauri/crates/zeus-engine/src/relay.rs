//! Outbound relay to the gateway.
//!
//! One thread, two responsibilities, one tick:
//!
//!   1. drain the local event queue and POST it to the gateway,
//!   2. pick up remote commands (approvals, interrupt, stop) and validate them
//!      through [`ZeusEngine::decide`] exactly as a local click would.
//!
//! Design constraints, all of them deliberate:
//!
//!   * **Local first.** The queue is bounded by `GatewayClient`; when offline,
//!     events pile up locally and the relay simply sleeps and retries. Nothing
//!     here ever blocks a driver or an agent.
//!   * **HTTP, not WSS, for now.** The transport is the weakest part — the data
//!     flow (queue, dedupe, validation) is what the rest of the system depends
//!     on, and it is fully exercised regardless of the socket protocol. A
//!     `/v1/desktop/socket` WSS upgrade replaces this loop later without
//!     touching callers.
//!   * **Never auto-allow.** A remote command reaches the same
//!     `PermissionManager` validation as the island; expired, replayed and
//!     wrong-session replies are refused and the action is marked done with
//!     the refusal as its result.
//!
//! Poll cadence is slow on purpose: 2s is invisible against a CLI turn that
//! takes seconds, and a laptop online all day makes ~43k requests — nothing.

use crate::event::{EventKind, ZeusEvent};
use crate::gateway::{Endpoint, LinkState};
use crate::permission::DecisionError;
use crate::ZeusEngine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

/// How often the relay rounds. Slow on purpose: agents think in seconds.
const TICK: Duration = Duration::from_secs(2);
/// After a failure the relay waits this long before trying again. The queue
/// keeps accepting it in the meantime.
const BACKOFF: Duration = Duration::from_secs(10);
/// Cap per round-trip so a reconnect burst cannot monopolise the thread.
const MAX_EVENTS_PER_POST: usize = 64;

const USER_AGENT: &str = concat!("zeus-desktop/", env!("CARGO_PKG_VERSION"));

/// Body the gateway expects for one event. Agent id is the session id because
/// there is exactly one agent per session and inventing another id would fork
/// the identity space.
#[derive(Debug, Serialize)]
struct GatewayEvent {
    id: String,
    session_id: String,
    agent_id: String,
    runtime: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    machine_id: String,
    seq: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<serde_json::Value>,
    timestamp: String,
}

/// Action envelope the gateway returns from `/v1/actions`.
#[derive(Debug, Deserialize)]
struct GatewayAction {
    id: String,
    session_id: String,
    kind: String,
    #[serde(default)]
    payload: Option<serde_json::Value>,
}

pub struct Relay;

impl Relay {
    /// Starts the loop if there is an endpoint configured. Returns whether the
    /// relay is live.
    pub fn spawn(engine: Arc<ZeusEngine>) -> bool {
        if !engine.gateway.is_configured() {
            engine.gateway.set_state(LinkState::Offline);
            return false;
        }
        std::thread::spawn(move || {
            // One agent for the relay's whole life. Building a fresh TLS stack
            // every tick leaks handles and, over hours, is exactly the kind of
            // slow exhaustion that freezes the host.
            let agent = ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(10)))
                .user_agent(USER_AGENT)
                .tls_config(
                    ureq::tls::TlsConfig::builder()
                        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                        .build(),
                )
                .build()
                .new_agent();
            loop {
                let outcome = Self::round(&engine, &agent);
                match outcome {
                    Ok(sent) => {
                        engine.gateway.set_state(LinkState::Online);
                        if sent > 0 {
                            log(&format!("relay: {sent} event(s) delivered"));
                        }
                        std::thread::sleep(TICK);
                    }
                    Err(err) => {
                        engine.gateway.set_state(LinkState::Offline);
                        log(&format!("relay offline: {err}"));
                        std::thread::sleep(BACKOFF);
                    }
                }
            }
        });
        true
    }

    fn round(engine: &Arc<ZeusEngine>, agent: &ureq::Agent) -> Result<usize, String> {
        let endpoint = engine
            .gateway
            .endpoint()
            .ok_or_else(|| "gateway not configured".to_string())?;

        let sent = Self::upload_events(engine, agent, &endpoint)?;
        Self::upload_digests(engine, agent, &endpoint)?;
        Self::beat(engine, agent, &endpoint)?;
        Self::handle_commands(engine, agent, &endpoint)?;
        Ok(sent)
    }

    /// One heartbeat per round: this is how a phone knows the desktop is alive
    /// even when no session has moved.
    fn beat(
        engine: &Arc<ZeusEngine>,
        agent: &ureq::Agent,
        endpoint: &Endpoint,
    ) -> Result<(), String> {
        let url = format!("{}/v1/presence/beat", endpoint.url.trim_end_matches('/'));
        agent
            .post(&url)
            .header("Authorization", &format!("Bearer {}", endpoint.token))
            .send_json(serde_json::json!({"machine_id": engine.workstation_id()}))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn upload_events(
        engine: &Arc<ZeusEngine>,
        agent: &ureq::Agent,
        endpoint: &Endpoint,
    ) -> Result<usize, String> {
        let pending = engine.gateway.drain();
        if pending.is_empty() {
            return Ok(0);
        }
        // The gateway merges `metadata.capabilities` into its session record;
        // without it the mobile app cannot know a session accepts messages.
        let capabilities: std::collections::HashMap<String, Vec<String>> = engine
            .views()
            .into_iter()
            .map(|view| (view.id, view.capabilities))
            .collect();
        let mut sent = 0usize;
        for event in &pending {
            if sent >= MAX_EVENTS_PER_POST {
                break;
            }
            let caps = capabilities
                .get(&event.session_id)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let body = to_gateway_event(event, engine.workstation_id(), caps);
            let url = format!("{}/v1/events", endpoint.url.trim_end_matches('/'));
            match agent
                .post(&url)
                .header("Authorization", &format!("Bearer {}", endpoint.token))
                .send_json(&body)
            {
                Ok(_) => sent += 1,
                Err(err) => {
                    // Put everything unsent back. The queue cap handles overflow.
                    for remaining in &pending[sent..] {
                        engine.gateway.enqueue(remaining.clone());
                    }
                    return Err(err.to_string());
                }
            }
        }
        Ok(sent)
    }

    fn upload_digests(
        engine: &Arc<ZeusEngine>,
        agent: &ureq::Agent,
        endpoint: &Endpoint,
    ) -> Result<(), String> {
        for session in engine.store.sessions() {
            let Some(digest) = engine.store.digest(&session.id) else {
                continue;
            };
            if digest.last_seq > 0 && digest.last_seq != digest_uploaded_seq(engine, &session.id) {
                let url = format!(
                    "{}/v1/sessions/{}/digest",
                    endpoint.url.trim_end_matches('/'),
                    session.id
                );
                let result = agent
                    .put(&url)
                    .header("Authorization", &format!("Bearer {}", endpoint.token))
                    .send_json(&digest);
                if let Err(err) = result {
                    return Err(err.to_string());
                }
                digest_mark_uploaded(engine, &session.id, digest.last_seq);
            }
        }
        Ok(())
    }

    fn handle_commands(
        engine: &Arc<ZeusEngine>,
        agent: &ureq::Agent,
        endpoint: &Endpoint,
    ) -> Result<(), String> {
        // Drain per owned session, never the whole queue: with several desktops
        // on one gateway, an unfiltered drain would steal another machine's
        // actions and fail them against the wrong session.
        for session in engine.views() {
            let url = format!(
                "{}/v1/actions?agent_id={}",
                endpoint.url.trim_end_matches('/'),
                session.id
            );
            let mut response = agent
                .get(&url)
                .header("Authorization", &format!("Bearer {}", endpoint.token))
                .call()
                .map_err(|e| e.to_string())?;
            let payload: serde_json::Value =
                response.body_mut().read_json().map_err(|e| e.to_string())?;
            let actions = payload["actions"].as_array().cloned().unwrap_or_default();
            for raw in actions {
                let Ok(action) = serde_json::from_value::<GatewayAction>(raw) else {
                    continue;
                };
                let outcome = Self::apply_command(engine, &action);
                Self::report(&action, &outcome);
            }
        }
        Ok(())
    }

    /// Executes one remote command against the local authority. The result is
    /// logged — including refusals.
    fn apply_command(engine: &Arc<ZeusEngine>, action: &GatewayAction) -> Result<(), String> {
        match action.kind.as_str() {
            "approve" | "deny" => {
                let request_id = action
                    .payload
                    .as_ref()
                    .and_then(|p| p["request_id"].as_str())
                    .ok_or_else(|| "approval action is missing request_id".to_string())?;
                let allow = action.kind == "approve";
                // The workstation id is the desktop's own: the authority record
                // demands it, and the relay is the product of an authenticated
                // agent channel, so echoing the desktop's id is correct.
                let workstation = engine.workstation_id().to_string();
                engine
                    .decide_reporting_delivery(request_id, &action.session_id, &workstation, allow)
                    .map(|delivery| {
                        delivery.map_err(|e| format!("recorded but not delivered: {e}"))
                    })
                    .map_err(|e| describe_refusal(&e))?
            }
            // A phone dictating the next instruction: same path as the island's
            // composer, same capability gate inside SessionManager.
            "message" => {
                let text = action
                    .payload
                    .as_ref()
                    .and_then(|p| p["text"].as_str())
                    .ok_or_else(|| "message action is missing text".to_string())?;
                engine.send(&action.session_id, text)
            }
            "interrupt" | "pause" => engine
                .sessions
                .interrupt(&action.session_id)
                .map_err(|e| e.to_string()),
            "stop" => engine
                .sessions
                .stop(&action.session_id)
                .map_err(|e| e.to_string()),
            "resume" => engine
                .resume(&action.session_id)
                .map(|_| ())
                .map_err(|e| e.to_string()),
            other => Err(format!("unknown command: {other}")),
        }
    }

    /// The gateway has no action-ack endpoint; the queue is drained on fetch,
    /// so the outcome lives in the desktop log where a refusal can be seen.
    fn report(action: &GatewayAction, outcome: &Result<(), String>) {
        match outcome {
            Ok(()) => log(&format!(
                "relay: action {} ({}) done",
                action.id, action.kind
            )),
            Err(reason) => log(&format!(
                "relay: action {} ({}) refused: {reason}",
                action.id, action.kind
            )),
        }
    }

    /// Builds the upload form of a normalized event. Nothing but what a session
    /// card on a phone can show; internal-only fields stay local.
    #[cfg(test)]
    fn event_for_gateway(
        event: &ZeusEvent,
        workstation: &str,
        capabilities: &[String],
    ) -> GatewayEvent {
        to_gateway_event(event, workstation, capabilities)
    }
}

fn to_gateway_event(event: &ZeusEvent, workstation: &str, capabilities: &[String]) -> GatewayEvent {
    let metadata = {
        let mut value = serde_json::json!({});
        if let Some(usage) = event.payload.get("usage") {
            value["usage"] = usage.clone();
        }
        if let Some(request_id) = event.payload.get("request_id") {
            value["request_id"] = request_id.clone();
        }
        if let Some(decision) = event.payload.get("decision") {
            value["decision"] = decision.clone();
        }
        if !capabilities.is_empty() {
            value["capabilities"] = serde_json::json!(capabilities);
        }
        if value.as_object().map(|o| o.is_empty()).unwrap_or(true) {
            None
        } else {
            Some(value)
        }
    };
    GatewayEvent {
        id: event.event_id.clone(),
        session_id: event.session_id.clone(),
        agent_id: event.session_id.clone(),
        runtime: event.runtime.clone(),
        project: event
            .payload
            .get("project")
            .and_then(Value::as_str)
            .map(str::to_string),
        model: event
            .payload
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string),
        provider: event
            .payload
            .get("provider")
            .and_then(Value::as_str)
            .map(str::to_string),
        kind: event.kind.as_str().to_string(),
        message: (event.kind != EventKind::AgentThinking).then(|| event.summary()),
        tool: (!event.tool().is_empty()).then(|| event.tool().to_string()),
        path: event.payload["path"].as_str().map(str::to_string),
        command: event.payload["command"].as_str().map(str::to_string),
        machine_id: workstation.to_string(),
        seq: event.seq,
        metadata,
        timestamp: timefmt(event.time),
    }
}

/// RFC3339 in UTC, built by hand to avoid a dependency for one call.
fn timefmt(epoch_ms: i64) -> String {
    let secs = epoch_ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let minute = secs_of_day % 3600 / 60;
    let second = secs_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Howard Hinnant's algorithm for civil date from days since epoch. The only
/// stable choice that does not pull in a calendar crate.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year, month, day)
}

fn describe_refusal(err: &DecisionError) -> String {
    serde_json::to_string(err).unwrap_or_else(|_| format!("{err:?}"))
}

fn log(message: &str) {
    eprintln!("[relay] {message}");
}

// Tracks the highest digest seq uploaded per session. In-memory on purpose:
// restarting re-uploads at most one digest per session, which is not worth
// persisting.
fn digest_upload_seq_store() -> &'static std::sync::Mutex<std::collections::HashMap<String, u64>> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, u64>>> =
        std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn digest_uploaded_seq(_engine: &Arc<ZeusEngine>, session_id: &str) -> u64 {
    digest_upload_seq_store()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(session_id)
        .copied()
        .unwrap_or(0)
}

fn digest_mark_uploaded(_engine: &Arc<ZeusEngine>, session_id: &str, seq: u64) {
    digest_upload_seq_store()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(session_id.to_string(), seq);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::EventKind;

    #[test]
    fn timestamp_is_rfc3339_utc() {
        assert_eq!(timefmt(0), "1970-01-01T00:00:00Z");
        assert_eq!(timefmt(86_400_000), "1970-01-02T00:00:00Z");
        // 32-bit overflow boundary.
        assert_eq!(timefmt(2_147_483_647_000), "2038-01-19T03:14:07Z");
    }

    #[test]
    fn gateway_event_carries_only_what_a_phone_needs() {
        let event = ZeusEvent::new("s1", "codex", 3, EventKind::ToolStarted)
            .with_tool("shell")
            .with_field("command", serde_json::json!("cargo test"))
            .with_field("path", serde_json::json!("src/main.rs"));
        let body = Relay::event_for_gateway(&event, "ws-1", &[]);
        assert_eq!(body.kind, "tool.started");
        assert_eq!(body.tool.as_deref(), Some("shell"));
        assert_eq!(body.command.as_deref(), Some("cargo test"));
        assert_eq!(body.path.as_deref(), Some("src/main.rs"));
        assert_eq!(body.seq, 3);
    }

    #[test]
    fn thinking_has_no_text_and_no_metadata_bag() {
        let event = ZeusEvent::new("s1", "codex", 1, EventKind::AgentThinking);
        let body = Relay::event_for_gateway(&event, "ws-1", &[]);
        assert!(body.message.is_none());
        assert!(body.metadata.is_none());
    }

    #[test]
    fn capabilities_ride_in_metadata_for_the_gateway_merge() {
        let event = ZeusEvent::new("s1", "codex", 1, EventKind::SessionStarted);
        let caps = vec!["send".to_string(), "stop".to_string()];
        let body = Relay::event_for_gateway(&event, "ws-1", &caps);
        assert_eq!(
            body.metadata.as_ref().unwrap()["capabilities"],
            serde_json::json!(["send", "stop"])
        );
    }

    #[test]
    fn civil_from_days_boundaries() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2000-02-29 exists because leap years fall out of the math, not a table.
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        // The last 32-bit instant lands where it should.
        assert_eq!(civil_from_days(24_855), (2038, 1, 19));
    }
}
