// Island geometry — Coucou layout specification.
// All values are logical pixels, identical to the reference app.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName =
  | "overview"
  | "empty"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "prompt"
  | "settings";

export type AgentMode = "none" | "pills" | "column";

export interface ViewLayout {
  height: number;
  botX: number;
  botY: number | null; // null = auto-centred
  botDiameter: number;
  agentMode: AgentMode;
  wash?: string | null;
}

// Window container panel
export const PANEL_W = 720;
export const PANEL_H = 360;

// Island sizing
export const NOTCH_W = 184;
export const NOTCH_H = 36;
export const COMPACT_W = 288;
export const EXPANDED_W = 640;

export const ROUNDED_CORNER = 14;
export const EXPANDED_CORNER = 22;

export const WAKE_STRIP_W = 240;
export const WAKE_STRIP_H = 12;

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  overview: { height: 160, botX: 68, botY: null, botDiameter: 58, agentMode: "pills", wash: null },
  empty: { height: 160, botX: 70, botY: null, botDiameter: 62, agentMode: "none", wash: null },
  approval: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column", wash: "rgba(245,165,36,0.38)" },
  question: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column", wash: "rgba(34,211,238,0.32)" },
  error: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column", wash: "rgba(244,80,94,0.45)" },
  finished: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column", wash: "rgba(34,197,94,0.4)" },
  prompt: { height: 190, botX: 54, botY: null, botDiameter: 46, agentMode: "column", wash: null },
  settings: { height: 230, botX: 60, botY: 125, botDiameter: 50, agentMode: "none", wash: null },
};

export interface IslandSize {
  w: number;
  h: number;
  radius: number;
}

export function islandSize(mode: IslandMode, view: IslandViewName): IslandSize {
  switch (mode) {
    case "hidden":
      return { w: NOTCH_W, h: 0, radius: ROUNDED_CORNER };
    case "compact":
      return { w: COMPACT_W, h: NOTCH_H, radius: ROUNDED_CORNER };
    case "expanded": {
      const layout = VIEW_LAYOUTS[view] ?? VIEW_LAYOUTS.overview;
      return { w: EXPANDED_W, h: layout.height, radius: EXPANDED_CORNER };
    }
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

export function botPosition(
  mode: IslandMode,
  view: IslandViewName,
  islandH: number,
): BotPlacement {
  switch (mode) {
    case "hidden":
      return { cx: 46, cy: 16, diameter: 6, opacity: 0 };
    case "compact":
      return { cx: 36, cy: 18, diameter: 26, opacity: 1 };
    case "expanded": {
      const layout = VIEW_LAYOUTS[view] ?? VIEW_LAYOUTS.overview;
      if (layout.botY != null) {
        return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: 1 };
      }
      const headerBottom = 42;
      const cardH = 84;
      const cy = headerBottom + (islandH - headerBottom - cardH) / 2 + cardH / 2;
      return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: 1 };
    }
  }
}

const ORDER: Record<IslandMode, number> = { hidden: 0, compact: 1, expanded: 2 };

export function modeOrder(mode: IslandMode): number {
  return ORDER[mode];
}
