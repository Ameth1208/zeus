// Island geometry. The whole layout contract in one place: mode + view →
// (width, height, radius, topRadius). Ported from the reference app's
// IslandTypes + IslandWindowController.islandSize.

export type IslandMode = "hidden" | "compact" | "expanded";
export type IslandView = "overview" | "empty" | "approval" | "question" | "error" | "interrupted" | "finished";
/** Secondary tasks morph between these so they never pop in and out. */
export type AgentMode = "none" | "pills" | "column";

export interface ViewLayout {
  height: number;
  /** Mascot centre relative to the island body. null → auto-centre. */
  botX: number | null;
  botY: number | null;
  botDiameter: number;
  agentMode: AgentMode;
  /** Radial wash from below, per state. */
  wash: string | null;
}

/** The panel never moves; only the island inside it does. */
export const PANEL_W = 720;
export const PANEL_H = 360;

export const COMPACT_W = 268;
export const COMPACT_H = 62;
export const EXPANDED_W = 344;

export const ROUNDED_CORNER = 30;
export const EXPANDED_CORNER = 32;
/** Concave ear radius in compact mode, applied as a negative top radius. */
export const EAR_RADIUS = 26;

export const VIEW_LAYOUTS: Record<IslandView, ViewLayout> = {
  overview: { height: 176, botX: 62, botY: null, botDiameter: 56, agentMode: "pills", wash: null },
  empty: { height: 160, botX: 66, botY: null, botDiameter: 62, agentMode: "none", wash: null },
  approval: {
    height: 176,
    botX: 62,
    botY: null,
    botDiameter: 56,
    agentMode: "column",
    wash: "rgba(245,165,36,0.42)",
  },
  question: {
    height: 176,
    botX: 62,
    botY: null,
    botDiameter: 56,
    agentMode: "column",
    wash: "rgba(34,211,238,0.38)",
  },
  error: { height: 176, botX: 62, botY: null, botDiameter: 58, agentMode: "column", wash: "rgba(244,80,94,0.55)" },
  interrupted: {
    height: 176,
    botX: 66,
    botY: null,
    botDiameter: 58,
    agentMode: "column",
    wash: "rgba(244,114,182,0.55)",
  },
  finished: {
    height: 176,
    botX: 62,
    botY: null,
    botDiameter: 58,
    agentMode: "column",
    wash: "rgba(52,211,153,0.5)",
  },
};

export interface IslandSize {
  w: number;
  h: number;
  radius: number;
  topRadius: number;
}

export function islandSize(mode: IslandMode, view: IslandView): IslandSize {
  const layout = VIEW_LAYOUTS[view];
  switch (mode) {
    case "hidden":
      // No notch on a PC: the island retracts to zero height and slides into
      // the top edge instead of sitting there as a bar.
      return { w: COMPACT_W, h: 0, radius: 0, topRadius: 0 };
    case "compact":
      return { w: COMPACT_W, h: COMPACT_H, radius: ROUNDED_CORNER, topRadius: -EAR_RADIUS };
    case "expanded":
      return { w: EXPANDED_W, h: layout.height, radius: EXPANDED_CORNER, topRadius: EXPANDED_CORNER };
  }
}

const ORDER: Record<IslandMode, number> = { hidden: 0, compact: 1, expanded: 2 };

/** Positive when growing, negative when compacting. Drives whether the tweens
 *  use a spring (overshoot) or a close curve (settle). */
export function modeOrder(mode: IslandMode): number {
  return ORDER[mode];
}

/** Mascot centre inside the island. Three springs drive this so the character
 *  can travel independently of the island rect (e.g. a dot riding a bar). */
export function botPosition(
  mode: IslandMode,
  view: IslandView,
  islandH: number,
): { cx: number; cy: number; diameter: number } {
  if (mode === "compact") {
    return { cx: 34, cy: islandH * 0.5, diameter: 46 };
  }
  const layout = VIEW_LAYOUTS[view];
  // The compact width is narrower than the expanded one, so clamp the mascot's
  // x into the body or it would sit outside the clip path mid-animation.
  const cx = Math.min(layout.botX ?? 66, islandW(mode) * 0.42);
  const cy = layout.botY ?? islandH * 0.5;
  return { cx, cy, diameter: layout.botDiameter };
}

function islandW(mode: IslandMode): number {
  return mode === "expanded" ? EXPANDED_W : COMPACT_W;
}

/** The view shown for a given state, mirroring the reference rule that an alert
 *  forces the matching view rather than the generic overview. */
export function viewFor(
  state: string,
  sessionCount: number,
): IslandView {
  if (sessionCount === 0) return "empty";
  switch (state) {
    case "approval":
      return "approval";
    case "question":
      return "question";
    case "error":
      return "error";
    case "interrupted":
      return "interrupted";
    case "finished":
      return "finished";
    default:
      return "overview";
  }
}

/** Alerts never auto-collapse: the user has to act. */
export function isAlerting(state: string): boolean {
  return state === "approval" || state === "question";
}
