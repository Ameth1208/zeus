import pathlib
import re

detect_block_old = """    fn detect(&self) -> bool {
        Command::new(&self.binary)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }"""

detect_block_new = """    fn detect(&self) -> bool {
        let mut cached = self
            .detected
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(value) = *cached {
            return value;
        }
        // Headless probe: called on a GUI refresh tick, so it must never open a
        // console window and must not spawn the binary more than once.
        let found = crate::runtime::stdio::probe(&self.binary, &["--version"]);
        *cached = Some(found);
        found
    }"""

for f in [
    "crates/zeus-engine/src/runtime/codex.rs",
    "crates/zeus-engine/src/runtime/claude.rs",
    "crates/zeus-engine/src/runtime/antigravity.rs",
]:
    p = pathlib.Path(f)
    s = p.read_text(encoding="utf-8")
    # add the field after the binary field
    s = s.replace("pub struct", "pub struct", 1)  # no-op
    m = re.search(r"(pub struct \w+Driver \{\n)", s)
    s = (
        s[: m.end()]
        + "    /// Cached so `capabilities()` does not respawn the binary.\n    detected: std::sync::Mutex<Option<bool>>,\n"
        + s[m.end() :]
    )
    # initialise in ::new()
    s = s.replace(
        "Self {\n            binary:",
        "Self {\n            detected: std::sync::Mutex::new(None),\n            binary:",
        1,
    )
    assert detect_block_old in s, f
    s = s.replace(detect_block_old, detect_block_new, 1)
    p.write_text(s, encoding="utf-8")
    print("ok", f)
