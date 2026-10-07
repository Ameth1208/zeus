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
  | "launcher"
  | "prompt"
  | "media"
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

/// Usable height for one view: the window minus the header, which sits above it
/// in `#views { inset: 42px 0 0 0 }`.
///
/// No view may exceed this. A taller one is not merely cramped — it is clipped
/// by the window itself, and because the overflow is outside the webview there
/// is nothing to scroll, so the tail of the content is unreachable rather than
/// merely hidden. That is why `settings` looked unscrollable at 400.
export const VIEW_MAX_H = PANEL_H - 42;

// Island sizing
export const NOTCH_W = 184;
export const NOTCH_H = 36;
export const COMPACT_W = 288;
export const EXPANDED_W = 640;

export const ROUNDED_CORNER = 14;
export const EXPANDED_CORNER = 22;

export const WAKE_STRIP_W = 240;
export const WAKE_STRIP_H = 12;

// Heights measured against real content: a view that shows buttons must have
// room for them plus breathing space. A view too short squeezes text over the
// mascot; too tall floats the island in empty wash.
// The mascot carries the state in every view, so it gets the size budget the
// content can spare. Diameters grew ~20% over the previous pass because at
// 46-58px the frames lost their silhouettes at island scale and the panel read
// as empty space with a small drawing in it. Each value stays inside
// `botX + diameter/2 + BOT_GUTTER_MARGIN` so no layout ever overlaps content.
export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  // The mascot is the runtime's identity on this panel, so it is sized like a
  //  primary element rather than an ornament: 80px in a 244px view.
  //
  //  `botY` is explicit because the derived centre — the old `cardH = 84` fudge
  //  in `botPosition` — put the dog in the middle of the panel while the name it
  //  labels sits on the top row. The row's centre is ~62px from the island top,
  //  and an 80px mascot centred there would reach 22px and slide under the 42px
  //  header. Centred at 88 instead: its top edge lands at 48, clear of the
  //  header, and it reads as sitting beside the name rather than floating.
  overview: { height: 244, botX: 78, botY: 88, botDiameter: 80, agentMode: "pills", wash: null },
  empty: { height: 168, botX: 76, botY: null, botDiameter: 76, agentMode: "none", wash: null },
  // Approval carries two buttons and a command line; give it the most room.
  approval: { height: 204, botX: 70, botY: null, botDiameter: 70, agentMode: "column", wash: "rgba(245,165,36,0.38)" },
  question: { height: 200, botX: 70, botY: null, botDiameter: 70, agentMode: "column", wash: "rgba(34,211,238,0.32)" },
  error: { height: 176, botX: 70, botY: null, botDiameter: 72, agentMode: "column", wash: "rgba(244,80,94,0.45)" },
  finished: { height: 168, botX: 70, botY: null, botDiameter: 72, agentMode: "column", wash: "rgba(34,197,94,0.4)" },
  // The launcher carries a four-line task field plus a path row, so it needs
  // materially more height than it used to. The mascot sits low and left,
  // beside the task field rather than above it.
  launcher: { height: 318, botX: 58, botY: 198, botDiameter: 60, agentMode: "column", wash: null },
  prompt: { height: 205, botX: 62, botY: null, botDiameter: 60, agentMode: "column", wash: null },
  // The player is a control surface, not a mascot view. Zeus keeps an eye on
  // the session in the background, but putting the dog in here put it straight
  // on top of the album art and smeared its glow over the cover. `botDiameter:
  // 0` hides it and hands the whole island width to the transport.
  media: { height: 188, botX: 0, botY: null, botDiameter: 0, agentMode: "none", wash: null },
  // Settings is the tallest view and it scrolls rather than clipping, so a long
  // runtime list cannot push Save off-screen. It is capped at `VIEW_MAX_H`:
  // at 400 it overflowed the 360px window, and content clipped by the window
  // cannot be scrolled to, which is not the same as being scrollable.
  settings: { height: 318, botX: 0, botY: null, botDiameter: 0, agentMode: "none", wash: null },
};

/// The header + mascot gutter every expanded view shares. Total height is this
/// plus the layout height.
export const EXPANDED_HEADER_H = 42;

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
      // Clamped rather than trusted. `islandSize` is what the host resizes the
      // window to, so a table value above the panel height produces a rect the
      // window cannot honour — the content is clipped by the OS with no scroll
      // affordance. Clamping here means a future tall view degrades to "as tall
      // as the panel allows" instead of becoming unreachable.
      return {
        w: EXPANDED_W,
        h: Math.min(layout.height, VIEW_MAX_H),
        radius: EXPANDED_CORNER,
      };
    }
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/// Breathing room between the mascot's silhouette and the text beside it.
/// Tight on purpose: the mascot is a primary element here, not decoration, and
/// an earlier 18px margin read as a second empty column.
export const BOT_GUTTER_MARGIN = 12;

/// Left padding a view's content needs so nothing runs under the mascot.
///
/// This is the single source of truth for the gutter. It used to be a literal
/// `126px` in the stylesheet while the mascot's own position came from this
/// table — two sources of truth for one number, which is how the panel ended up
/// overlapping the mascot when the diameter grew. Derived here and published to
/// CSS as `--content-gutter`, so a layout change moves the text with it.
export function contentGutter(view: IslandViewName): number {
  const layout = VIEW_LAYOUTS[view] ?? VIEW_LAYOUTS.overview;
  if (layout.botDiameter <= 0) return 0;
  return Math.ceil(layout.botX + layout.botDiameter / 2 + BOT_GUTTER_MARGIN);
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
      // `botDiameter: 0` hides the mascot entirely: the layout reserves no room
      // for it, so the card gets the full width of the island.
      if (layout.botDiameter <= 0) {
        return { cx: -200, cy: -200, diameter: 0, opacity: 0 };
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
