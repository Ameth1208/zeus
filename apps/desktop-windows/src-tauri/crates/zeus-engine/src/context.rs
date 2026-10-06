//! ContextManager — how Zeus finds code without spending the user's tokens.
//!
//! The ordering is deliberate and is the single biggest lever on token cost:
//!
//! 1. `git diff` / recent changes  — what actually moved, already summarized
//! 2. Serena symbol lookup / references — semantic, no text to read
//! 3. `ast-grep` structural search — syntax-aware, no text to read
//! 4. `rg` fast text search
//! 5. a bounded chunk of one file
//! 6. the whole file, only when a step really requires it
//!
//! Every step is capped. A search returns at most `SEARCH_HIT_LIMIT` hits, a
//! read at most `READ_LINE_LIMIT` lines, and log output is tail-truncated to
//! `LOG_BYTE_LIMIT`. Over-budget results are explicitly marked `truncated` so
//! the agent knows to ask for the next chunk instead of assuming it saw
//! everything.
//!
//! Serena is the one MCP server enabled by default, and only for runtimes that
//! speak MCP. Fewer tools beats many tools: every extra server is schema the
//! model reads on every turn.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Cap on search results. Twenty is enough to locate something and small enough
/// that the results fit in a fraction of a turn.
pub const SEARCH_HIT_LIMIT: usize = 20;
/// Lines returned by a chunk read unless the caller asks for more.
pub const READ_LINE_LIMIT: usize = 200;
/// Bytes of log output returned. Anything larger is tail-truncated.
pub const LOG_BYTE_LIMIT: usize = 32 * 1024;

/// Never searched, never read by default: generated or vendored trees. Matches
/// the usual ripgrep ignore set plus the build outputs Zeus itself produces.
pub const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "build",
    "dist",
    "target",
    "vendor",
    ".dart_tool",
    "coverage",
    "__pycache__",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// Step 1: version control state.
    GitDiff,
    /// Step 2: Serena MCP, when the runtime supports MCP.
    Serena,
    /// Step 3: syntax-aware structural search.
    AstGrep,
    /// Step 4: fast text search.
    Ripgrep,
    /// Step 5: a bounded slice of one file.
    FileChunk,
    /// Step 6: the entire file. Only reached on explicit request.
    FullFile,
    /// On-demand whole-repo map, via Repomix.
    RepoMap,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextResult {
    pub source: Source,
    pub text: String,
    pub hits: usize,
    pub truncated: bool,
    /// Set when the requested tool is not installed. The caller degrades to the
    /// next step instead of failing.
    pub unavailable: Option<String>,
}

impl ContextResult {
    fn empty(source: Source) -> Self {
        Self {
            source,
            text: String::new(),
            hits: 0,
            truncated: false,
            unavailable: None,
        }
    }

    fn of(source: Source, text: String, hits: usize, truncated: bool) -> Self {
        Self {
            source,
            text,
            hits,
            truncated,
            unavailable: None,
        }
    }
}

/// Which optional tools this machine actually has. Detected once at boot so a
/// missing binary is a fact, not a runtime surprise.
#[derive(Debug, Clone, Copy, Default)]
pub struct Tools {
    pub ripgrep: bool,
    pub ast_grep: bool,
    pub repomix: bool,
    /// Serena is an MCP server rather than a binary; presence means the runtime
    /// can reach it.
    pub serena: bool,
}

pub struct ContextManager {
    root: PathBuf,
    /// `root` with symlinks and `..` resolved. Every path check compares against
    /// this, because a lexical `starts_with` is defeated by a `..` component.
    root_real: PathBuf,
    tools: Tools,
    /// Content hashes of files already sent, so an unchanged file is never sent
    /// twice. Keyed by path, value by hash — survives across turns.
    seen: std::sync::Mutex<std::collections::HashMap<PathBuf, String>>,
}

impl ContextManager {
    pub fn new(root: PathBuf, tools: Tools) -> Self {
        let root_real = root.canonicalize().unwrap_or_else(|_| root.clone());
        Self {
            root,
            root_real,
            tools,
            seen: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    /// Probes for the optional tools. A tool that is absent simply never
    /// becomes the chosen source; nothing here is fatal.
    pub fn detect_tools(supports_mcp: bool) -> Tools {
        Tools {
            ripgrep: which("rg"),
            ast_grep: which("ast-grep") || which("sg"),
            repomix: which("repomix"),
            serena: supports_mcp,
        }
    }

    pub fn tools(&self) -> Tools {
        self.tools
    }

    /// Step 1. What changed is almost always the right first context, and it is
    /// already diff-sized rather than file-sized.
    pub fn git_changes(&self) -> ContextResult {
        if !which("git") {
            return ContextResult {
                unavailable: Some("git is not installed".into()),
                ..ContextResult::empty(Source::GitDiff)
            };
        }
        let mut text = self.run("git", &["status", "--short", "--branch"]);
        if text.is_empty() {
            text = self.run("git", &["status", "--short", "--branch"]);
        }
        let diff = self.run("git", &["diff", "--stat"]);
        let body = format!("{text}\n{diff}");
        let (body, truncated) = clamp_bytes(body, LOG_BYTE_LIMIT);
        ContextResult::of(
            Source::GitDiff,
            body,
            text.lines().filter(|l| !l.trim().is_empty()).count(),
            truncated,
        )
    }

    /// Diff hunks for one file — the preferred payload after an edit, because a
    /// hunk says what changed without repeating the surrounding file.
    pub fn file_diff(&self, path: &str) -> ContextResult {
        let mut text = self.run("git", &["diff", "--", path]);
        if text.trim().is_empty() {
            text = self.run("git", &["diff", "--staged", "--", path]);
        }
        if text.trim().is_empty() {
            return ContextResult::of(
                Source::GitDiff,
                format!("no tracked changes for {path}"),
                0,
                false,
            );
        }
        let (text, truncated) = clamp_bytes(text, LOG_BYTE_LIMIT);
        ContextResult::of(Source::GitDiff, text, 1, truncated)
    }

    /// Steps 3 and 4, in that order. `ast-grep` is preferred because a
    /// structural match is a fact about the code rather than about its text.
    pub fn search(&self, pattern: &str) -> ContextResult {
        if self.tools.ast_grep {
            let args = vec![
                "run".to_string(),
                "--lang".to_string(),
                "auto".to_string(),
                "--pattern".to_string(),
                pattern.to_string(),
                self.root.to_string_lossy().to_string(),
            ];
            let text = self.run_args("ast-grep", &args);
            if !text.is_empty() {
                let capped = cap_lines(text, SEARCH_HIT_LIMIT);
                return ContextResult::of(Source::AstGrep, capped.0, capped.1, capped.2);
            }
        }
        if self.tools.ripgrep {
            // `-m` caps matches per file; the line cap below caps the total.
            let args = vec![
                "--line-number".into(),
                "--no-heading".into(),
                "--color".into(),
                "never".into(),
                "--max-count".into(),
                SEARCH_HIT_LIMIT.to_string(),
                "--".into(),
                pattern.into(),
                self.root.to_string_lossy().to_string(),
            ];
            let mut cmd_args = args;
            for dir in IGNORED_DIRS {
                cmd_args.push("--glob".into());
                cmd_args.push(format!("!**/{dir}/**"));
            }
            let text = self.run_args("rg", &cmd_args);
            let capped = cap_lines(text, SEARCH_HIT_LIMIT);
            return ContextResult::of(Source::Ripgrep, capped.0, capped.1, capped.2);
        }
        ContextResult {
            unavailable: Some("neither ast-grep nor ripgrep is installed".into()),
            ..ContextResult::empty(Source::Ripgrep)
        }
    }

    /// Step 5 or 6. `offset` pages through a file in `READ_LINE_LIMIT` slices,
    /// which is what keeps a large file from ever being sent whole by accident.
    pub fn read(&self, path: &str, offset: usize, whole: bool) -> ContextResult {
        let full = self.root.join(path);
        // Resolve before comparing: `root.join("../../etc/passwd")` is lexically
        // inside `root` while pointing somewhere else entirely.
        let resolved = full.canonicalize().unwrap_or_else(|_| {
            // A path that does not exist yet cannot escape check by existing, but
            // a missing file must still be reported as unreadable, not as an
            // escape. Fall back to the lexical form and let the read fail.
            self.root_real.join(path)
        });
        if !resolved.starts_with(&self.root_real) {
            return ContextResult::of(
                Source::FileChunk,
                format!("path escapes the project: {path}"),
                0,
                false,
            );
        }
        let Ok(content) = std::fs::read_to_string(&resolved) else {
            return ContextResult::of(Source::FileChunk, format!("cannot read {path}"), 0, false);
        };
        let lines: Vec<&str> = content.lines().collect();
        let source = if whole {
            Source::FullFile
        } else {
            Source::FileChunk
        };

        // Never send the same unchanged file twice. A changed hash sends it.
        let hash = short_hash(&content);
        if !whole && offset == 0 {
            if let Ok(seen) = self.seen.lock() {
                if seen.get(&resolved) == Some(&hash) {
                    return ContextResult::of(
                        source,
                        format!("{path} is unchanged since it was last read; nothing to send"),
                        0,
                        false,
                    );
                }
            }
        }
        if whole {
            let (text, truncated) = clamp_bytes(content.clone(), LOG_BYTE_LIMIT);
            let mut seen = self.seen.lock().unwrap_or_else(|e| e.into_inner());
            seen.insert(resolved.clone(), hash);
            return ContextResult::of(source, text, lines.len(), truncated);
        }

        let end = (offset + READ_LINE_LIMIT).min(lines.len());
        let slice: Vec<&str> = lines[offset.min(lines.len())..end].to_vec();
        let more = end < lines.len();
        let mut seen = self.seen.lock().unwrap_or_else(|e| e.into_inner());
        seen.insert(resolved.clone(), hash);
        let mut text = slice.join("\n");
        if more {
            text.push_str(&format!(
                "\n… truncated: {path} has {} lines; request offset {end} for the next chunk.",
                lines.len()
            ));
        }
        ContextResult::of(source, text, slice.len(), more)
    }

    /// On-demand repository map. Never automatic: it is the one operation that
    /// reads a whole repository, so it only runs when asked for by name.
    pub fn repo_map(&self, compress: bool) -> ContextResult {
        if !self.tools.repomix {
            return ContextResult {
                unavailable: Some("repomix is not installed".into()),
                ..ContextResult::empty(Source::RepoMap)
            };
        }
        let mut args = vec!["--token-count-tree".to_string()];
        if compress {
            args.push("--compress".to_string());
        }
        args.push(self.root.to_string_lossy().to_string());
        let text = self.run_args("repomix", &args);
        let (text, truncated) = clamp_bytes(text, LOG_BYTE_LIMIT);
        ContextResult::of(Source::RepoMap, text, 1, truncated)
    }

    /// Step 2. Serena is reached over MCP by the runtime, not by Zeus shelling
    /// out, so this returns the configuration the engine hands to a driver.
    pub fn serena_config(&self, runtime: &str) -> Option<Value> {
        if !self.tools.serena {
            return None;
        }
        Some(json!({
            "mcpServers": {
                // The single default server. Additional servers are opt-in per
                // project because every one of them costs schema on every turn.
                "serena": {
                    "command": "uvx",
                    "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"],
                    "env": {"ZEUS_PROJECT_ROOT": self.root.to_string_lossy()}
                }
            },
            "_zeus": {"runtime": runtime, "default": true, "extra_servers": []}
        }))
    }

    /// Structured envelope so internal tools never answer in prose.
    pub fn to_envelope(result: &ContextResult) -> Value {
        json!({
            "source": result.source,
            "hits": result.hits,
            "truncated": result.truncated,
            "unavailable": result.unavailable,
            "text": result.text,
        })
    }

    fn run(&self, bin: &str, args: &[&str]) -> String {
        let owned: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        self.run_args(bin, &owned)
    }

    fn run_args(&self, bin: &str, args: &[String]) -> String {
        crate::runtime::stdio::run_headless(bin, args, &self.root)
            .map(|out| String::from_utf8_lossy(&out.stdout).to_string())
            .unwrap_or_default()
    }
}

fn which(bin: &str) -> bool {
    let Ok(path) = std::env::var("PATH") else {
        return false;
    };
    let candidates: Vec<String> = if bin == "sg" || bin == "ast-grep" {
        vec![bin.to_string()]
    } else {
        vec![bin.to_string()]
    };
    let exts: Vec<String> = if cfg!(windows) {
        vec![".exe".into(), ".cmd".into(), ".bat".into(), String::new()]
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path) {
        for name in &candidates {
            for ext in &exts {
                let candidate = dir.join(format!("{name}{ext}"));
                if candidate.is_file() {
                    return true;
                }
            }
        }
    }
    false
}

fn cap_lines(text: String, max: usize) -> (String, usize, bool) {
    let lines: Vec<&str> = text.lines().collect();
    let hits = lines.len();
    if hits <= max {
        return (text, hits, false);
    }
    let mut out = lines[..max].join("\n");
    out.push_str(&format!(
        "\n… truncated at {max} of {hits} matches; narrow the pattern to see the rest."
    ));
    (out, max, true)
}

/// Tail-truncates to a byte budget. The tail is kept because the end of a log
/// is where the failure is.
fn clamp_bytes(text: String, limit: usize) -> (String, bool) {
    if text.len() <= limit {
        return (text, false);
    }
    let mut kept = String::from("… output truncated, showing the last bytes …\n");
    let slice = &text[text.len() - (limit / 2)..];
    kept.push_str(slice);
    (kept, true)
}

fn short_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(content.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// True when a path is inside a tree Zeus refuses to read by default.
pub fn is_ignored(path: &Path) -> bool {
    path.components().any(|c| {
        let value = c.as_os_str().to_string_lossy();
        IGNORED_DIRS.contains(&value.as_ref())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager(tools: Tools) -> (ContextManager, PathBuf) {
        let root = std::env::temp_dir().join(format!("zeus-ctx-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        (ContextManager::new(root.clone(), tools), root)
    }

    #[test]
    fn search_reports_missing_tools_instead_of_failing() {
        let (m, root) = manager(Tools::default());
        let result = m.search("needle");
        assert!(result.unavailable.is_some());
        assert!(result.text.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn read_chunks_a_file_and_offers_the_next_one() {
        let (m, root) = manager(Tools::default());
        let long: String = (0..READ_LINE_LIMIT + 40)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(root.join("big.rs"), long).unwrap();

        let first = m.read("big.rs", 0, false);
        assert_eq!(first.source, Source::FileChunk);
        assert!(first.truncated);
        assert!(first.text.contains("request offset"));
        assert_eq!(first.hits, READ_LINE_LIMIT);

        let second = m.read("big.rs", READ_LINE_LIMIT, false);
        assert!(!second.truncated);
        assert!(second.text.contains("line 200"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn an_unchanged_file_is_not_sent_twice() {
        let (m, root) = manager(Tools::default());
        std::fs::write(root.join("a.rs"), "fn main() {}\n").unwrap();
        assert!(!m.read("a.rs", 0, false).truncated);
        let second = m.read("a.rs", 0, false);
        assert!(
            second.text.contains("unchanged"),
            "second read should be suppressed, got: {}",
            second.text
        );
        // An edit makes it sendable again.
        std::fs::write(root.join("a.rs"), "fn main() { println!(); }\n").unwrap();
        assert!(!m.read("a.rs", 0, false).text.contains("unchanged"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn reading_outside_the_project_is_refused() {
        let (m, root) = manager(Tools::default());
        let result = m.read("../../../Windows/win.ini", 0, false);
        assert!(result.text.contains("escapes the project"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn whole_file_read_is_explicit_and_bounded() {
        let (m, root) = manager(Tools::default());
        let big = "x".repeat(LOG_BYTE_LIMIT * 2);
        std::fs::write(root.join("huge.txt"), big).unwrap();
        let result = m.read("huge.txt", 0, true);
        assert_eq!(result.source, Source::FullFile);
        assert!(result.truncated);
        assert!(result.text.len() <= LOG_BYTE_LIMIT + 200);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn serena_is_only_configured_when_the_runtime_speaks_mcp() {
        let (m, root) = manager(Tools::default());
        assert!(m.serena_config("codex").is_none());
        let (m2, root2) = manager(Tools {
            serena: true,
            ..Tools::default()
        });
        let config = m2.serena_config("codex").expect("serena config");
        assert_eq!(config["_zeus"]["default"], true);
        // Exactly one server by default: fewer tools beats many tools.
        assert_eq!(config["mcpServers"].as_object().unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(root2);
    }

    #[test]
    fn repo_map_is_refused_without_repomix() {
        let (m, root) = manager(Tools::default());
        assert!(m.repo_map(true).unavailable.is_some());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn generated_trees_are_ignored_by_default() {
        assert!(is_ignored(Path::new("node_modules/react/index.js")));
        assert!(is_ignored(Path::new(
            "apps/desktop-windows/src-tauri/target/debug/x"
        )));
        assert!(!is_ignored(Path::new("gateway/internal/store.go")));
    }

    #[test]
    fn line_cap_states_the_real_hit_count() {
        let text = (0..50)
            .map(|i| format!("hit {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let (capped, hits, truncated) = cap_lines(text, SEARCH_HIT_LIMIT);
        assert_eq!(hits, SEARCH_HIT_LIMIT);
        assert!(truncated);
        assert!(capped.contains("50 matches"));
    }

    #[test]
    fn byte_cap_keeps_the_tail_where_failures_are() {
        let text = "START".to_string() + &"z".repeat(1000) + "BOOM";
        let (clamped, truncated) = clamp_bytes(text, 200);
        assert!(truncated);
        assert!(clamped.ends_with("BOOM"));
        assert!(!clamped.contains("START"));
    }

    #[test]
    fn envelope_is_structured_not_prose() {
        let result = ContextResult::of(Source::Ripgrep, "a.rs:1:hit".into(), 1, false);
        let envelope = ContextManager::to_envelope(&result);
        assert_eq!(envelope["source"], "ripgrep");
        assert_eq!(envelope["hits"], 1);
        assert_eq!(envelope["truncated"], false);
    }
}
