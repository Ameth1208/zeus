//! PermissionManager — the desktop is the approval authority.
//!
//! Rules this enforces, all of them non-negotiable:
//!
//!   * a request is decided exactly once — a second reply is a replay
//!   * a reply must name the session that raised the request
//!   * a reply must name this workstation
//!   * a reply after `expires_at` is rejected
//!   * **timeout and offline never mean allow**
//!
//! The last one is why expiry produces a denial to the runtime rather than
//! silence: an unanswered request must not leave an agent blocked forever, and
//! it must certainly not be treated as consent.

use crate::event::now_ms;
use crate::store::{LocalStore, PendingRequest};
use serde::Serialize;

/// How long an unanswered request stays decidable. Long enough to approve from
/// a phone, short enough that the window for a stale tap is small.
pub const DEFAULT_TTL_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "reason", content = "detail")]
pub enum DecisionError {
    /// No such request. Covers an id that never existed and one already purged.
    UnknownRequest,
    /// The request exists but this workstation did not raise it.
    WrongWorkstation,
    /// The reply names a different session than the one that asked.
    WrongSession { expected: String },
    /// Already answered. Reported separately from unknown so a double tap is
    /// visible in diagnostics without being treated as a fresh decision.
    AlreadyDecided { status: String },
    /// Past `expires_at`.
    Expired,
}

pub struct PermissionManager {
    store: std::sync::Arc<LocalStore>,
    workstation_id: String,
    ttl_ms: i64,
}

impl PermissionManager {
    pub fn new(store: std::sync::Arc<LocalStore>, workstation_id: &str) -> Self {
        Self {
            store,
            workstation_id: workstation_id.to_string(),
            ttl_ms: DEFAULT_TTL_MS,
        }
    }

    pub fn with_ttl(mut self, ttl_ms: i64) -> Self {
        self.ttl_ms = ttl_ms;
        self
    }

    pub fn workstation_id(&self) -> &str {
        &self.workstation_id
    }

    /// Same as [`PermissionManager::open`] but reuses the runtime's own id when
    /// the driver already issued one — e.g. an observed hook carrying
    /// `request_id`. A duplicate id is reused only while still open; once
    /// decided, a resend is refused rather than overwriting it.
    pub fn open_with_id(&self, session_id: &str, summary: &str, request_id: Option<&str>) -> PendingRequest {
        if let Some(id) = request_id.filter(|id| !id.is_empty()) {
            // Reuse the record under the same id, whatever its status. An id
            // that was decided or expired stays decided: a hook redelivering
            // the same event after a restart may not resurrect it.
            if let Some(existing) = self.store.get_pending(id) {
                return existing;
            }
            // No open record under this id: open one directly under it.
            let now = now_ms();
            let request = PendingRequest {
                request_id: id.to_string(),
                session_id: session_id.to_string(),
                workstation_id: self.workstation_id.clone(),
                created_at: now,
                expires_at: now + self.ttl_ms,
                status: "pending".into(),
                summary: crate::event::truncate(summary, 200),
            };
            self.store.put_pending(request.clone());
            return request;
        }
        self.open(session_id, summary)
    }

    /// Registers a request. The id is Zeus's own so a runtime-native id never
    /// leaks into the wire protocol.
    pub fn open(&self, session_id: &str, summary: &str) -> PendingRequest {
        let now = now_ms();
        let request = PendingRequest {
            request_id: format!("req-{}", uuid::Uuid::new_v4()),
            session_id: session_id.to_string(),
            workstation_id: self.workstation_id.clone(),
            created_at: now,
            expires_at: now + self.ttl_ms,
            status: "pending".into(),
            summary: crate::event::truncate(summary, 200),
        };
        self.store.put_pending(request.clone());
        request
    }

    /// Records that a request was answered. Returns the refusal rather than
    /// mutating anything, so a caller cannot accidentally apply a bad reply.
    pub fn decide(
        &self,
        request_id: &str,
        session_id: &str,
        workstation_id: &str,
        decision: Decision,
    ) -> Result<(), DecisionError> {
        let Some(request) = self.store.get_pending(request_id) else {
            return Err(DecisionError::UnknownRequest);
        };
        if request.workstation_id != workstation_id {
            return Err(DecisionError::WrongWorkstation);
        }
        if request.session_id != session_id {
            return Err(DecisionError::WrongSession {
                expected: request.session_id,
            });
        }
        if request.status != "pending" {
            return Err(DecisionError::AlreadyDecided {
                status: request.status,
            });
        }
        if now_ms() >= request.expires_at {
            self.store.set_pending_status(request_id, "expired");
            return Err(DecisionError::Expired);
        }
        self.store.set_pending_status(
            request_id,
            match decision {
                Decision::Allow => "approved",
                Decision::Deny => "denied",
            },
        );
        Ok(())
    }

    /// Marks a request as failed to be answered. Used when the session dies
    /// with a request still open: the runtime needs a definite answer and
    /// "deny" is the safe one.
    pub fn expire(&self, request_id: &str) {
        if let Some(request) = self.store.get_pending(request_id) {
            if request.status == "pending" {
                self.store.set_pending_status(request_id, "expired");
            }
        }
    }

    /// Expires every open request for a session. Called when a session ends.
    pub fn expire_session(&self, session_id: &str) -> Vec<String> {
        let open: Vec<String> = self
            .store
            .pending()
            .into_iter()
            .filter(|r| r.session_id == session_id && r.status == "pending")
            .map(|r| r.request_id)
            .collect();
        for id in &open {
            self.expire(id);
        }
        open
    }

    /// Requests still decidable right now. Expired-but-unanswered ones are
    /// dropped from the UI's queue so the island cannot show a dead button.
    pub fn open_requests(&self) -> Vec<PendingRequest> {
        let now = now_ms();
        self.store
            .pending()
            .into_iter()
            .filter(|r| r.is_open(now))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager() -> PermissionManager {
        let dir = std::env::temp_dir().join(format!("zeus-perm-{}", uuid::Uuid::new_v4()));
        let store = std::sync::Arc::new(LocalStore::open(dir));
        PermissionManager::new(store, "ws-1")
    }

    #[test]
    fn a_fresh_request_is_decidable_once() {
        let m = manager();
        let request = m.open("s1", "run cargo test");
        assert!(request.is_open(now_ms()));
        assert_eq!(m.open_requests().len(), 1);

        assert_eq!(
            m.decide(&request.request_id, "s1", "ws-1", Decision::Allow),
            Ok(())
        );
    }

    #[test]
    fn a_replayed_decision_is_refused() {
        let m = manager();
        let request = m.open("s1", "run cargo test");
        m.decide(&request.request_id, "s1", "ws-1", Decision::Allow)
            .unwrap();
        assert_eq!(
            m.decide(&request.request_id, "s1", "ws-1", Decision::Deny),
            Err(DecisionError::AlreadyDecided {
                status: "approved".into()
            })
        );
    }

    #[test]
    fn a_reply_for_another_session_is_refused() {
        let m = manager();
        let request = m.open("s1", "run cargo test");
        assert_eq!(
            m.decide(&request.request_id, "s2", "ws-1", Decision::Allow),
            Err(DecisionError::WrongSession {
                expected: "s1".into()
            })
        );
        // And the real request stays decidable.
        assert_eq!(
            m.decide(&request.request_id, "s1", "ws-1", Decision::Allow),
            Ok(())
        );
    }

    #[test]
    fn a_reply_from_another_workstation_is_refused() {
        let m = manager();
        let request = m.open("s1", "run cargo test");
        assert_eq!(
            m.decide(&request.request_id, "s1", "ws-2", Decision::Allow),
            Err(DecisionError::WrongWorkstation)
        );
    }

    #[test]
    fn expiry_never_becomes_allow() {
        let m = manager().with_ttl(-1);
        let request = m.open("s1", "run cargo test");
        // Expired immediately: an allow must be refused, and the request is
        // left unusable rather than silently consented.
        assert_eq!(
            m.decide(&request.request_id, "s1", "ws-1", Decision::Allow),
            Err(DecisionError::Expired)
        );
        assert!(m.open_requests().is_empty());
        assert_eq!(
            m.store.get_pending(&request.request_id).unwrap().status,
            "expired"
        );
    }

    #[test]
    fn unknown_ids_are_refused_rather_than_defaulted() {
        let m = manager();
        assert_eq!(
            m.decide("req-nope", "s1", "ws-1", Decision::Allow),
            Err(DecisionError::UnknownRequest)
        );
    }

    #[test]
    fn a_session_ending_expires_only_its_own_requests() {
        let m = manager();
        let a = m.open("s1", "one");
        let b = m.open("s2", "two");
        let expired = m.expire_session("s1");
        assert_eq!(expired, vec![a.request_id]);
        assert_eq!(m.open_requests().len(), 1);
        assert_eq!(m.open_requests()[0].request_id, b.request_id);
    }
}
