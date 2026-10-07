// AgentVisualRegistry — one place that maps a runtime to how it looks.
//
// Splitting this out of `views/icons.ts` matters for a specific reason: runtime
// identity, capability and appearance are three different concerns. The engine
// owns the first two; this owns the third. Keeping them apart is what stops a
// "Claude" pill from growing a runtime-specific behaviour by accident.
//
// Icon policy, in force:
//   * paths are local. Nothing is fetched at runtime, so a session never depends
//     on a third party being up or on the user's network.
//   * Yesicon is the intended source for new runtime marks. Files downloaded
//     from it live in `assets/runtimes/` and are listed, with licence and
//     trademark notes, in THIRD_PARTY_ICONS.md.
//   * a runtime with no local mark gets a neutral glyph, never a lookalike of
//     someone else's logo.
//
// MODEL != RUNTIME: a provider (DeepSeek, OpenRouter, …) is a field on a session,
// never an icon source. A runtime mark identifies the CLI.

/**
 * Runtime glyphs, 24x24 viewBox.
 *
 * They live here rather than in `views/icons.ts` on purpose: the registry is the
 * owner of runtime identity, and importing the icon table back would create a
 * cycle (icons.ts re-exports this module's lookup). A cycle like that reads
 * `RUNTIME_GLYPHS` from a module that has not finished evaluating, which fails
 * at module scope with a bare ReferenceError and leaves a blank window.
 */
import { BRANDS } from "../icons/generated";

/** Brand-owned marks, vendored from simple-icons (CC0-1.0). */
function brand(inner: string): string {
  const m = /d="([^"]+)"/.exec(inner);
  return m ? m[1] : inner;
}

export const RUNTIME_GLYPHS = {
  codex: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V14a2 2 0 0 0-2-2H9v-2h4a4 4 0 0 1 4 4v2.93z",
  claude: brand(BRANDS.claude.inner),
  antigravity: "M12 2.5 3.2 19.5h17.6L12 2.5zm0 4.2 6 11.3H6L12 6.7zm0 4.3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  opencode: brand(BRANDS.opencode.inner),
  /** Neutral mark for a runtime with no local glyph. */
  unknown: "M12 3.6c-5 0-9 3.3-9 7.4 0 2.3 1.3 4.4 3.3 5.7-.2 1.2-.8 2.4-1.7 3.4 1.9-.2 3.6-.9 4.9-1.9 .8.2 1.6.3 2.5.3 5 0 9-3.3 9-7.5s-4-7.4-9-7.4z",
} as const;

export interface RuntimeVisual {
  id: string;
  label: string;
  /** Vendored artwork: full path taken from the local icon table. */
  path: string;
  /** True when the path uses stroked shapes (lucide-style). */
  stroked?: boolean;
  /** Accent colour, used for the pill border and the glyph. */
  color: string;
  /** Where the mark came from. `builtin` means drawn for Zeus; anything else
   *  names the local file under assets/runtimes/. */
  source: "builtin" | string;
  /** Set when the runtime is observed only, so the UI can say so. */
  observedOnly?: boolean;
}

/**
 * Currently every mark is `builtin`: Zeus-drawn glyphs that already ship in
 * `views/icons.ts`. They are placeholders for the Yesicon set, not
 * substitutes — see THIRD_PARTY_ICONS.md for what still has to be downloaded.
 */
const VISUALS: RuntimeVisual[] = [
  {
    id: "codex",
    label: "Codex",
    path: RUNTIME_GLYPHS.codex,
    color: "#38BDF8",
    source: "builtin",
  },
  {
    id: "claude",
    label: "Claude Code",
    path: RUNTIME_GLYPHS.claude,
    color: "#F5A524",
    source: "builtin",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    path: RUNTIME_GLYPHS.antigravity,
    color: "#3B82F6",
    source: "builtin",
  },
  {
    id: "opencode",
    label: "OpenCode",
    path: RUNTIME_GLYPHS.opencode,
    color: "#818CF8",
    source: "builtin",
    observedOnly: true,
  },
];

/** Neutral glyph for a runtime with no local mark. */
const UNKNOWN: RuntimeVisual = {
  id: "unknown",
  label: "Agent",
  path: RUNTIME_GLYPHS.unknown,
  color: "#6B7079",
  source: "builtin",
};

const BY_ID = new Map(VISUALS.map((v) => [v.id, v]));

export function visualFor(runtime: string): RuntimeVisual {
  return BY_ID.get(runtime.toLowerCase()) ?? UNKNOWN;
}

/** Aliases so a session labelled "claude-code" or "openai/codex" still matches. */
const ALIASES: Record<string, string> = {
  "claude-code": "claude",
  anthropic: "claude",
  claude_code: "claude",
  openai: "codex",
  "openai-codex": "codex",
  agy: "antigravity",
  antigravity_cli: "antigravity",
  opencode_zen: "opencode",
};

export function visualForSession(runtime: string): RuntimeVisual {
  const key = runtime.toLowerCase();
  return visualFor(ALIASES[key] ?? key);
}

export function allVisuals(): RuntimeVisual[] {
  return [...VISUALS];
}

/** Brand colour for a runtime, from this registry.
 *
 *  Runtime identity must never go through `colorForProject`. That function
 *  hashes a *project* name into a shared palette, so passing it a runtime id
 *  returned an arbitrary colour — and because the hash space is small, OpenCode
 *  and Antigravity could come out the same blue, which is exactly the "OpenCode
 *  painted with Antigravity's colour" report. A project's colour is derived on
 *  purpose; a runtime's colour is a fact about the CLI and is declared here.
 *
 *  Falls back to the neutral glyph's grey so an unrecognised runtime is visibly
 *  unknown rather than confidently coloured. */
export function runtimeColor(runtime: string): string {
  return visualForSession(runtime).color;
}

/** Runtimes that still need a Yesicon mark downloaded into assets/runtimes/. */
export function pendingIconSources(): string[] {
  return VISUALS.filter((v) => v.source === "builtin").map((v) => v.id);
}