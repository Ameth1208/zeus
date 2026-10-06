//! SessionDigest — the short, replaceable summary of a session.
//!
//! Replaying a full event history to rebuild context is the single biggest
//! token waste in an agent loop. The digest holds the same information in a few
//! hundred characters and is rewritten in place, so a resumed session reads
//! the digest instead of the log.
//!
//! Every field is short and hand-editable. The engine fills it from events; the
//! agent may correct it. Nothing here is sent raw to the gateway — only the
//! summary fields, never file contents.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionDigest {
    pub session_id: String,
    /// What the user is trying to achieve, in one line.
    pub goal: String,
    /// Constraints that must keep holding: "no new deps", "Windows only".
    pub constraints: Vec<String>,
    /// Decisions already made, so the agent does not relitigate them.
    pub decisions: Vec<String>,
    /// Files the session touched. Paths only, never contents.
    pub changed_files: Vec<String>,
    /// Tests that were run and what they said.
    pub tests: Vec<String>,
    /// What is left to do.
    pub pending: Vec<String>,
    /// Highest event seq folded in. Lets an update skip work it has already seen.
    pub last_seq: u64,
}

const MAX_ITEMS: usize = 12;

impl SessionDigest {
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            ..Default::default()
        }
    }

    /// Folds one event into the digest. Only seq-advancing events matter, so a
    /// replayed event is a no-op rather than a duplicate entry.
    pub fn apply(&mut self, event: &crate::event::ZeusEvent) {
        use crate::event::EventKind;

        if event.seq <= self.last_seq {
            return;
        }
        self.last_seq = event.seq;

        let text = event.text().trim().to_string();
        match event.kind {
            EventKind::SessionStarted => {
                if self.goal.is_empty() && !text.is_empty() {
                    self.goal = clip(&text, 200);
                }
            }
            EventKind::ToolStarted | EventKind::ToolCompleted | EventKind::ToolFailed => {
                if let Some(path) = event.payload["path"].as_str() {
                    push_unique(&mut self.changed_files, clip(path, 160), MAX_ITEMS);
                }
            }
            EventKind::PermissionRequested => {
                if !text.is_empty() {
                    push_unique(
                        &mut self.pending,
                        format!("awaiting approval: {text}"),
                        MAX_ITEMS,
                    );
                }
            }
            EventKind::PermissionResolved => {
                self.pending
                    .retain(|p| !p.starts_with("awaiting approval:"));
            }
            EventKind::SessionCompleted | EventKind::SessionFailed => {
                if !text.is_empty() {
                    push_unique(&mut self.tests, clip(&text, 160), MAX_ITEMS);
                }
            }
            _ => {}
        }
    }

    /// Adds a decision, newest first. Used by the agent and by approve handlers.
    pub fn record_decision(&mut self, decision: &str) {
        let decision = clip(decision.trim(), 200);
        if decision.is_empty() {
            return;
        }
        self.decisions.retain(|d| d != &decision);
        self.decisions.insert(0, decision);
        self.decisions.truncate(MAX_ITEMS);
    }

    /// Compact text handed to a runtime on resume, in place of the event log.
    /// Deterministic ordering so prompt caching still hits.
    pub fn render(&self) -> String {
        let mut out = String::new();
        if !self.goal.is_empty() {
            out.push_str(&format!("Goal: {}\n", self.goal));
        }
        for (label, items) in [
            ("Constraints", &self.constraints),
            ("Decisions", &self.decisions),
            ("Changed files", &self.changed_files),
            ("Tests", &self.tests),
            ("Pending", &self.pending),
        ] {
            if items.is_empty() {
                continue;
            }
            out.push_str(label);
            out.push_str(":\n");
            for item in items.iter().take(MAX_ITEMS) {
                out.push_str("  - ");
                out.push_str(item);
                out.push('\n');
            }
        }
        out
    }

    pub fn approx_chars(&self) -> usize {
        self.render().len()
    }
}

fn push_unique(list: &mut Vec<String>, value: String, max: usize) {
    if value.is_empty() || list.iter().any(|v| v == &value) {
        return;
    }
    list.push(value);
    if list.len() > max {
        let drop = list.len() - max;
        list.drain(0..drop);
    }
}

fn clip(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Bounded set helper so callers can merge two digests without duplicating.
pub fn merge_unique(existing: &mut Vec<String>, incoming: &BTreeSet<String>) {
    for value in incoming {
        push_unique(existing, value.clone(), MAX_ITEMS);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{EventKind, ZeusEvent};

    #[test]
    fn replayed_events_do_not_duplicate_entries() {
        let mut digest = SessionDigest::new("s1");
        let event = ZeusEvent::new("s1", "codex", 1, EventKind::ToolStarted)
            .with_tool("edit")
            .with_field("path", serde_json::json!("src/main.rs"));
        digest.apply(&event);
        digest.apply(&event);
        assert_eq!(digest.changed_files.len(), 1);
    }

    #[test]
    fn resolved_approval_clears_the_pending_entry() {
        let mut digest = SessionDigest::new("s1");
        digest.apply(
            &ZeusEvent::new("s1", "codex", 1, EventKind::PermissionRequested)
                .with_text("run cargo test"),
        );
        assert_eq!(digest.pending.len(), 1);
        digest.apply(&ZeusEvent::new(
            "s1",
            "codex",
            2,
            EventKind::PermissionResolved,
        ));
        assert!(digest.pending.is_empty());
    }

    #[test]
    fn render_stays_far_below_the_history_it_replaces() {
        let mut digest = SessionDigest::new("s1");
        digest.goal = "Ship the engine".into();
        digest.record_decision("Engine lives in Rust");
        for i in 0..40 {
            digest.apply(
                &ZeusEvent::new("s1", "codex", i + 1, EventKind::ToolStarted)
                    .with_tool("bash")
                    .with_field("path", serde_json::json!(format!("src/file{i}.rs"))),
            );
        }
        let rendered = digest.render();
        assert!(rendered.len() < 1200, "digest grew to {}", rendered.len());
        assert!(rendered.contains("Goal: Ship the engine"));
        assert!(rendered.contains("Engine lives in Rust"));
    }

    #[test]
    fn render_is_stable_for_identical_state() {
        let mut a = SessionDigest::new("s1");
        a.goal = "x".into();
        a.record_decision("y");
        let b = a.clone();
        assert_eq!(a.render(), b.render());
    }
}
