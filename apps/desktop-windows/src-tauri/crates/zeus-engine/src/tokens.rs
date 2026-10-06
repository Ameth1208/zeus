//! Per-session token and cost accounting.
//!
//! When a runtime reports usage, that report is authoritative. Only when it
//! reports nothing does the local estimator run, and then the numbers are
//! labelled `estimated` so a cost figure is never presented as measured.
//!
//! Usage belongs in session details, not on the island: a token count is a fact
//! for the user who pays for it, not a thing the mascot should shout about.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
    /// Prompt-cache reads. Worth separating because they are the cheapest
    /// tokens and the clearest signal that prompt caching is working.
    pub cached: u64,
    pub thinking: u64,
    /// True when these numbers came from the local estimator rather than the
    /// runtime. Never silently upgraded to measured.
    pub estimated: bool,
}

impl TokenUsage {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.thinking
    }

    /// A measured report replaces the previous one outright: every runtime here
    /// reports cumulative totals, so adding would double-count.
    pub fn apply_measured(&mut self, reported: TokenUsage) {
        self.input = reported.input;
        self.output = reported.output;
        self.cached = reported.cached;
        self.thinking = reported.thinking;
        self.estimated = false;
    }

    /// The estimator only fills gaps. A runtime that reports output tokens but
    /// not input tokens must not have its input wiped by a guess.
    pub fn apply_estimate(&mut self, estimate: TokenUsage) {
        if self.input == 0 {
            self.input = estimate.input;
        }
        if self.output == 0 {
            self.output = estimate.output;
        }
        self.estimated = true;
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct CostEstimate {
    pub usd: f64,
    pub estimated: bool,
}

/// Rough per-million-token prices, used only for display when a runtime does
/// not report a cost. Deliberately coarse and always flagged as an estimate.
fn rate(model: &str) -> (f64, f64) {
    let model = model.to_ascii_lowercase();
    if model.contains("opus") {
        (15.0, 75.0)
    } else if model.contains("sonnet") {
        (3.0, 15.0)
    } else if model.contains("haiku") {
        (0.8, 4.0)
    } else if model.contains("deepseek") {
        (0.27, 1.1)
    } else if model.contains("gemini") {
        (1.25, 10.0)
    } else {
        // Default to a mid-range pair rather than zero, so the number is
        // visibly an estimate rather than implying the session was free.
        (3.0, 15.0)
    }
}

pub fn estimate_cost(usage: &TokenUsage, model: &str) -> CostEstimate {
    let (input_rate, output_rate) = rate(model);
    // Cached input is billed at a fraction of input on every provider here.
    let billable_input = usage.input.saturating_sub(usage.cached.min(usage.input)) as f64
        + usage.cached as f64 * 0.1;
    let usd = billable_input / 1_000_000.0 * input_rate
        + (usage.output + usage.thinking) as f64 / 1_000_000.0 * output_rate;
    CostEstimate {
        usd,
        estimated: usage.estimated,
    }
}

/// Rough token count from a character count. Only used when a runtime reports
/// nothing at all; the ratio is ~4 characters per token for code and English.
pub fn estimate_tokens(text: &str) -> u64 {
    ((text.chars().count() / 4) as u64).max(1)
}

/// Folds a `usage` payload off an event into a session's running totals.
pub fn usage_from_payload(payload: &serde_json::Value) -> Option<TokenUsage> {
    let usage = payload.get("usage")?;
    Some(TokenUsage {
        input: usage["input"].as_u64().unwrap_or(0),
        output: usage["output"].as_u64().unwrap_or(0),
        cached: usage["cached"].as_u64().unwrap_or(0),
        thinking: usage["thinking"].as_u64().unwrap_or(0),
        estimated: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reported_total_replaces_rather_than_accumulates() {
        let mut usage = TokenUsage::default();
        usage.apply_measured(TokenUsage {
            input: 100,
            output: 10,
            cached: 0,
            thinking: 0,
            estimated: false,
        });
        usage.apply_measured(TokenUsage {
            input: 250,
            output: 30,
            cached: 0,
            thinking: 0,
            estimated: false,
        });
        assert_eq!(usage.input, 250);
        assert_eq!(usage.output, 30);
        assert!(!usage.estimated);
    }

    #[test]
    fn the_estimator_only_fills_gaps_and_stays_labelled() {
        let mut usage = TokenUsage {
            input: 0,
            output: 42,
            cached: 0,
            thinking: 0,
            estimated: false,
        };
        usage.apply_estimate(TokenUsage {
            input: 900,
            output: 999,
            cached: 0,
            thinking: 0,
            estimated: true,
        });
        // Reported output survives; reported-nothing input is filled in.
        assert_eq!(usage.output, 42);
        assert_eq!(usage.input, 900);
        assert!(usage.estimated);
    }

    #[test]
    fn cost_is_never_reported_as_measured_when_it_was_guessed() {
        let usage = TokenUsage {
            input: 1_000_000,
            output: 0,
            cached: 0,
            thinking: 0,
            estimated: true,
        };
        assert!(estimate_cost(&usage, "gpt-5").estimated);
    }

    #[test]
    fn cached_tokens_are_billed_below_fresh_input() {
        let cached = TokenUsage {
            input: 1_000_000,
            output: 0,
            cached: 1_000_000,
            thinking: 0,
            estimated: false,
        };
        let fresh = TokenUsage {
            input: 1_000_000,
            output: 0,
            cached: 0,
            thinking: 0,
            estimated: false,
        };
        assert!(
            estimate_cost(&cached, "claude-opus-5").usd
                < estimate_cost(&fresh, "claude-opus-5").usd
        );
    }

    #[test]
    fn an_unknown_model_still_yields_a_visible_estimate() {
        let usage = TokenUsage {
            input: 1_000_000,
            output: 0,
            cached: 0,
            thinking: 0,
            estimated: false,
        };
        assert!(estimate_cost(&usage, "some-local-model").usd > 0.0);
    }

    #[test]
    fn event_payload_usage_is_read_as_measured() {
        let payload = serde_json::json!({"usage": {"input": 10, "output": 2, "cached": 5}});
        let usage = usage_from_payload(&payload).unwrap();
        assert_eq!(usage.cached, 5);
        assert!(!usage.estimated);
        assert!(usage_from_payload(&serde_json::json!({})).is_none());
    }

    #[test]
    fn the_character_estimator_is_not_absurd() {
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens(&"x".repeat(400)), 100);
    }
}
