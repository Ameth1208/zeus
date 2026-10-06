//! Shared plumbing for the stdio runtimes.
//!
//! Claude and agy both speak NDJSON over stdin/stdout: one JSON object per
//! line in, one per line out, for the life of the process. That is the same
//! shape, so it lives here once instead of twice.

use crate::event::ZeusEvent;
use crate::runtime::EventSink;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

/// On Windows, a child of a `windows_subsystem` app that is a console program
/// opens its own console window, which appears as a shell flicking up over the
/// desktop. Setting CREATE_NO_WINDOW keeps the child headless. No-op elsewhere.
pub fn without_console_window_pub(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Runs a command and captures stdout without ever opening a console.
pub fn run_headless(binary: &str, args: &[String], cwd: &std::path::Path) -> std::io::Result<std::process::Output> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    without_console_window_pub(&mut command);
    command.output()
}

/// Runs a probe like `--version` without ever opening a console.
pub fn probe(binary: &str, args: &[&str]) -> bool {
    let mut command = Command::new(binary);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    without_console_window_pub(&mut command);
    command.status().map(|s| s.success()).unwrap_or(false)
}

/// A live child the supervisor owns.
pub struct StreamProc {
    pub child: Mutex<Option<Child>>,
    pub stdin: Mutex<Option<ChildStdin>>,
}

impl StreamProc {
    /// Sends one NDJSON message. Silently ignored once the process is gone:
    /// a write to a dead pipe must not crash the engine.
    pub fn send_line(&self, value: &Value) {
        let mut guard = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
        let Some(stdin) = guard.as_mut() else {
            return;
        };
        if let Ok(line) = serde_json::to_string(value) {
            let _ = writeln!(stdin, "{line}");
            let _ = stdin.flush();
        }
    }

    pub fn pid(&self) -> Option<u32> {
        self.child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|c| c.id())
    }

    /// True when the child has already exited. Used to tell "turn finished" from
    /// "the runtime crashed", which are very different things to the user.
    pub fn has_exited(&self) -> bool {
        self.child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
            .map(|c| matches!(c.try_wait(), Ok(Some(_))))
            .unwrap_or(true)
    }

    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

/// Starts an NDJSON child. The stdout handle comes back alongside the process
/// because the caller owns reading it; two readers on one pipe deadlock.
pub fn spawn_ndjson(
    binary: &str,
    args: &[String],
    cwd: &std::path::Path,
) -> std::io::Result<(StreamProc, std::process::ChildStdout)> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // Runtime chatter on stderr is dropped: the UI has no terminal to show
        // it, and it can be megabytes of progress output.
        .stderr(Stdio::null());
    without_console_window_pub(&mut command);

    let mut child = command.spawn()?;
    let stdin = child.stdin.take();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("runtime stdout was not piped"))?;
    Ok((
        StreamProc {
            child: Mutex::new(Some(child)),
            stdin: Mutex::new(stdin),
        },
        stdout,
    ))
}

/// Reads NDJSON lines until EOF, handing each parsed object to `on_line`.
///
/// `on_line` may emit several events per line. Runs on its own thread so a slow
/// sink cannot block the runtime's stdout.
pub fn pump_lines<F>(stdout: std::process::ChildStdout, mut on_line: F)
where
    F: FnMut(Value) + Send + 'static,
{
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                on_line(value);
            }
        }
    });
}

/// Convenience for the common "publish a batch" case.
pub fn publish_all(sink: &Arc<dyn EventSink>, events: Vec<ZeusEvent>) {
    for event in events {
        sink.publish(event);
    }
}

/// Token counts a runtime reported, if any. Split out because all three
/// runtimes report usage under different key names.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cached: u64,
    pub thinking: u64,
}

impl Usage {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.thinking
    }

    pub fn merge(&mut self, other: Usage) {
        self.input = self.input.max(other.input);
        self.output = self.output.max(other.output);
        self.cached = self.cached.max(other.cached);
        self.thinking = self.thinking.max(other.thinking);
    }
}

/// Reads a usage block nested under `usage`.
pub fn usage_from(value: &Value) -> Option<Usage> {
    usage_of(value.get("usage")?)
}

/// Same reader for a block that is already the usage object. agy nests its
/// usage under `result`, so the shape differs from Claude's top-level one.
pub fn usage_of(usage: &Value) -> Option<Usage> {
    let pick = |keys: &[&str]| -> u64 {
        keys.iter()
            .filter_map(|k| usage.get(*k).and_then(Value::as_u64))
            .next()
            .unwrap_or(0)
    };
    if usage.as_object().map(|o| o.is_empty()).unwrap_or(true) {
        return None;
    }
    Some(Usage {
        input: pick(&["input_tokens", "prompt_tokens"]),
        output: pick(&["output_tokens", "completion_tokens"]),
        cached: pick(&["cache_read_tokens", "cache_read_input_tokens"]),
        thinking: pick(&["thinking_tokens"]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cumulative_usage_takes_the_latest_report() {
        let mut usage = Usage::default();
        usage.merge(Usage {
            input: 100,
            output: 10,
            cached: 5,
            thinking: 1,
        });
        usage.merge(Usage {
            input: 250,
            output: 30,
            cached: 40,
            thinking: 4,
        });
        assert_eq!(usage.input, 250);
        assert_eq!(usage.output, 30);
        assert_eq!(usage.cached, 40);
    }

    #[test]
    fn reads_both_runtime_usage_dialects() {
        let claude = usage_from(&json!({"usage": {"input_tokens": 10, "output_tokens": 2,
                                                "cache_read_input_tokens": 7}}))
        .unwrap();
        assert_eq!(claude.cached, 7);

        let agy = usage_from(&json!({"usage": {"input_tokens": 5, "output_tokens": 1,
                                              "thinking_tokens": 3, "cache_read_tokens": 0}}))
        .unwrap();
        assert_eq!(agy.thinking, 3);
        assert_eq!(agy.total(), 9);
    }

    #[test]
    fn missing_usage_is_none_not_zero() {
        assert!(usage_from(&json!({})).is_none());
        assert!(usage_from(&json!({"usage": {}})).is_none());
    }
}
