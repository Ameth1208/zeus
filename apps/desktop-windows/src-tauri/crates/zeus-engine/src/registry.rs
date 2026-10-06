//! RuntimeRegistry — what Zeus can drive, and what it can only watch.
//!
//! One place that knows every runtime's identity, so the UI never hardcodes a
//! list. `MODEL != RUNTIME`: a runtime names the CLI, the provider names the
//! vendor behind it. They are separate fields everywhere and are never merged.

use crate::runtime::antigravity::AntigravityDriver;
use crate::runtime::claude::ClaudeDriver;
use crate::runtime::codex::CodexDriver;
use crate::runtime::observed::ObservedDriver;
use crate::runtime::{AgentRuntimeDriver, Capabilities};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

/// Static identity of a runtime: display name plus the vendor that supplies the
/// model behind it. Kept apart from `Capabilities` so the icon registry and the
/// capability table cannot drift into each other.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub id: String,
    pub label: String,
    /// Vendors this runtime can be pointed at. Not exhaustive: a runtime can
    /// usually talk to anything its CLI supports.
    pub providers: Vec<String>,
}

pub struct RuntimeRegistry {
    drivers: BTreeMap<String, Arc<dyn AgentRuntimeDriver>>,
    observed: BTreeMap<String, Arc<ObservedDriver>>,
    info: Vec<RuntimeInfo>,
}

impl Default for RuntimeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl RuntimeRegistry {
    pub fn new() -> Self {
        let mut drivers: BTreeMap<String, Arc<dyn AgentRuntimeDriver>> = BTreeMap::new();
        let mut observed: BTreeMap<String, Arc<ObservedDriver>> = BTreeMap::new();

        for driver in [
            Arc::new(CodexDriver::new()) as Arc<dyn AgentRuntimeDriver>,
            Arc::new(ClaudeDriver::new()),
            Arc::new(AntigravityDriver::new()),
        ] {
            let name = driver.name().to_string();
            observed.insert(name.clone(), Arc::new(ObservedDriver::new(&name)));
            drivers.insert(name, driver);
        }

        // OpenCode has no managed transport yet; its adapter reports observed
        // events only. Listing it as observed rather than omitting it keeps the
        // island honest about what exists on the machine.
        observed.insert("opencode".into(), Arc::new(ObservedDriver::new("opencode")));

        let info = vec![
            RuntimeInfo {
                id: "codex".into(),
                label: "Codex".into(),
                providers: vec!["openai".into()],
            },
            RuntimeInfo {
                id: "claude".into(),
                label: "Claude Code".into(),
                providers: vec!["anthropic".into(), "bedrock".into(), "vertex".into()],
            },
            RuntimeInfo {
                id: "antigravity".into(),
                label: "Antigravity".into(),
                providers: vec!["google".into()],
            },
            RuntimeInfo {
                id: "opencode".into(),
                label: "OpenCode".into(),
                providers: vec!["deepseek".into(), "openai".into(), "anthropic".into()],
            },
        ];

        Self {
            drivers,
            observed,
            info,
        }
    }

    pub fn get(&self, runtime: &str) -> Option<Arc<dyn AgentRuntimeDriver>> {
        self.drivers.get(runtime).cloned()
    }

    pub fn observed(&self, runtime: &str) -> Option<Arc<ObservedDriver>> {
        self.observed.get(runtime).cloned()
    }

    /// Managed capabilities for one runtime. Absent runtimes are reported by
    /// `all()` rather than silently missing here.
    pub fn capabilities(&self, runtime: &str) -> Option<Capabilities> {
        self.drivers.get(runtime).map(|d| d.capabilities())
    }

    /// What the island renders in its runtime list. Installed runtimes first so
    /// the common case is above the fold.
    pub fn all(&self) -> Vec<RuntimeEntry> {
        let mut entries: Vec<RuntimeEntry> = self
            .info
            .iter()
            .map(|info| RuntimeEntry {
                info: info.clone(),
                managed: self.drivers.get(&info.id).map(|d| d.capabilities()),
                observed: self.observed.contains_key(&info.id),
            })
            .collect();
        entries.sort_by(|a, b| {
            let a_installed = a.managed.as_ref().is_some_and(|c| c.installed);
            let b_installed = b.managed.as_ref().is_some_and(|c| c.installed);
            b_installed
                .cmp(&a_installed)
                .then_with(|| a.info.label.cmp(&b.info.label))
        });
        entries
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeEntry {
    pub info: RuntimeInfo,
    /// `None` for runtimes Zeus has no managed transport for.
    pub managed: Option<Capabilities>,
    pub observed: bool,
}

impl RuntimeEntry {
    pub fn installable(&self) -> bool {
        self.observed || self.managed.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_advertised_runtime_has_a_driver_or_observed_path() {
        let registry = RuntimeRegistry::new();
        for entry in registry.all() {
            assert!(
                entry.installable(),
                "{} is listed but can neither be driven nor observed",
                entry.info.id
            );
        }
    }

    #[test]
    fn opencode_is_observed_only_not_faked_as_managed() {
        let registry = RuntimeRegistry::new();
        assert!(registry.get("opencode").is_none());
        assert!(registry.observed("opencode").is_some());
        let entry = registry
            .all()
            .into_iter()
            .find(|e| e.info.id == "opencode")
            .expect("opencode listed");
        assert!(entry.managed.is_none());
    }

    #[test]
    fn runtime_and_provider_stay_separate_fields() {
        let registry = RuntimeRegistry::new();
        let opencode = registry
            .all()
            .into_iter()
            .find(|e| e.info.id == "opencode")
            .unwrap();
        // OpenCode is the runtime; DeepSeek is one of the providers behind it.
        assert!(opencode.info.providers.contains(&"deepseek".to_string()));
    }

    #[test]
    fn installed_runtimes_sort_first() {
        let registry = RuntimeRegistry::new();
        let all = registry.all();
        let first_uninstalled = all
            .iter()
            .position(|e| !e.managed.as_ref().is_some_and(|c| c.installed));
        if let Some(index) = first_uninstalled {
            assert!(
                all[index..]
                    .iter()
                    .all(|e| !e.managed.as_ref().is_some_and(|c| c.installed)),
                "an installed runtime sorted after an uninstalled one"
            );
        }
    }

    #[test]
    fn unknown_runtime_has_no_capabilities_rather_than_a_default_set() {
        assert!(RuntimeRegistry::new()
            .capabilities("not-a-runtime")
            .is_none());
    }
}
