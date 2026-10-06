// SVG icons matching Coucou for Windows / macOS SF Symbols.
//
// The runtime glyphs are not duplicated here: they belong to the AgentVisualRegistry
// in ../zeus/visuals, which owns runtime identity. This module depends on it, never
// the other way round.

import { RUNTIME_GLYPHS, visualForSession, visualFor } from "../zeus/visuals";
import { LUCIDE, BRANDS } from "../icons/generated";

/** Vendored lucide glyph, stroked at 24x24. Defined inline so a misspelled name
 *  is a build error, not a blank button. */
type RuntimePathKey = keyof typeof RUNTIME_GLYPHS;
type UiIcon = { inner: string; stroke: boolean } | string;
const lc = (name: string): UiIcon => LUCIDE[name];

export const ICONS = {
  house: lc("house"),
  bubble: lc("bubble"),
  plus: lc("plus"),
  gear: lc("gear"),
  gearFill: lc("gearFill"),
  speakerOn: lc("speakerOn"),
  speakerOff: lc("speakerOff"),
  arrowUpRight: lc("arrowUpRight"),
  chevronRight: lc("chevronRight"),
  chevronLeft: lc("chevronLeft"),
  check: lc("check"),
  arrowUp: lc("arrowUp"),
  bang: lc("bang"),
  xmark: lc("xmark"),
  timer: lc("timer"),
  ellipsis: lc("ellipsis"),
  star: lc("star"),
  terminal: lc("terminal"),
  bolt: lc("bolt"),
  play: lc("play"),
  music: lc("music"),
  pause: lc("pause"),
  skipForward: lc("skipForward"),
  skipBack: lc("skipBack"),
  antigravity: RUNTIME_GLYPHS.antigravity as string,
  claude: RUNTIME_GLYPHS.claude as string,
  codex: RUNTIME_GLYPHS.codex as string,
  opencode: RUNTIME_GLYPHS.opencode as string,
} satisfies Record<string, UiIcon | string>;

export { visualForSession, visualFor };

/**
 * Glyph for a runtime name.
 *
 * The registry resolves exact ids and their known aliases; the substring pass is
 * a fallback for the shapes these CLIs report, e.g. "claude-code" or
 * "openai/codex". An unrecognised name gets the neutral mark rather than
 * another runtime's logo.
 */
export function getAgentIcon(runtime: string): string {
  const visual = visualForSession(runtime);
  if (visual.id !== "unknown") return visual.path;

  const r = runtime.toLowerCase();
  if (r.includes("claude")) return RUNTIME_GLYPHS.claude;
  if (r.includes("codex") || r.includes("openai")) return RUNTIME_GLYPHS.codex;
  if (r.includes("open") || r.includes("deepseek")) return RUNTIME_GLYPHS.opencode;
  if (r.includes("agy") || r.includes("antigravity")) return RUNTIME_GLYPHS.antigravity;
  return RUNTIME_GLYPHS.unknown;
}
