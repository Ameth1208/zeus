# Third-party icons

Policy, in force for every runtime mark in Zeus:

- **Icons are local.** Paths ship inside the app (`src/views/icons.ts`) or as
  files under `assets/runtimes/`. Nothing is fetched at runtime, so a session
  never depends on a third party being reachable.
- **Yesicon is the only approved source** for new runtime marks. When a mark is
  downloaded it is committed under `assets/runtimes/` and recorded below with
  its source, licence and trademark note.
- **A runtime with no local mark gets a neutral glyph.** Never a lookalike drawn
  to resemble someone else's logo.
- **MODEL != RUNTIME.** A provider (DeepSeek, OpenRouter, …) is a field on a
  session. It never selects an icon: an icon identifies the CLI.

## Current state: no third-party icons are bundled

`src/zeus/visuals.ts` (the `AgentVisualRegistry`) currently resolves every
runtime to `source: "builtin"` — Zeus-drawn glyphs that already shipped with the
island. These are **placeholders, not Yesicon substitutes**, and they are not a
claim about any vendor's mark.

| Runtime | Id | Path data | Source | Licence | Trademark |
|---|---|---|---|---|---|
| Codex | `codex` | `src/views/icons.ts` → `ICONS.codex` | builtin (Zeus) | project licence | none asserted |
| Claude Code | `claude` | `src/views/icons.ts` → `ICONS.claude` | builtin (Zeus) | project licence | none asserted |
| Antigravity | `antigravity` | `src/views/icons.ts` → `ICONS.antigravity` | builtin (Zeus) | project licence | none asserted |
| OpenCode | `opencode` | `src/views/icons.ts` → `ICONS.opencode` | builtin (Zeus) | project licence | none asserted |

## Still to do

The Yesicon set has **not** been downloaded. `yesicon.io` was unreachable from
the build machine used for this change, and no substitute source was used: a
placeholder is left in place rather than inventing an attribution.

For each runtime below, when a network is available:

1. Download the SVG from <https://yesicon.io>.
2. Strip everything but the path data and normalise it to a 24×24 viewBox.
3. Commit it as `assets/runtimes/<id>.svg`.
4. Add a row to the table above with Yesicon's licence terms and a trademark note
   naming the vendor whose mark it is.
5. Point `VISUALS` in `src/zeus/visuals.ts` at the new file, set
   `source: "assets/runtimes/<id>.svg"`, and delete the `builtin` entry.

Runtimes awaiting a Yesicon mark: `codex`, `claude`, `antigravity`, `opencode`.

## Vendor marks

"Codex", "Claude Code", "Antigravity" and "OpenCode" are the names of their
respective owners. Using a name to identify the software a session runs against
is nominative use; reproducing a vendor's logo is a separate question and is not
covered by the Zeus project licence. Anyone shipping a build with third-party
marks is responsible for their own trademark clearance.