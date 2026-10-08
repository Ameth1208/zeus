// The home view: the list of agents IS the screen.
//
// It used to split the island in two — work panel left, session list right —
// which squeezed the list into a 226px column and repeated in the panel what
// the session view shows full-width. Now the overview is the list alone: every
// session, its state, the file it is touching, and a View button that opens
// the session view, where the detail lives.
//
// The mascot still owns its column on the left (the gutter is published by
// layout.ts as --content-gutter), so no row ever runs under it.

import { ViewData } from "./state";
import { renderEmptyView } from "./empty";
import { renderSessionRow, statsStrip } from "./session-row";

function isLiveStatus(status: string): boolean {
  return status === "working" || status === "waiting";
}

export function renderOverviewView(): string {
  const live = ViewData.sessions.filter((s) => isLiveStatus(s.status));
  const history = ViewData.sessions.filter((s) => !isLiveStatus(s.status));
  const focusedId = ViewData.focus?.id ?? "";

  if (ViewData.sessions.length === 0) {
    return renderEmptyView();
  }

  return `
    <div class="view on">
      <div class="card">
        <div class="card-body home-sessions">
          <div class="home-stats">${statsStrip(ViewData.sessions)}</div>
          <div class="home-session-list">
            ${live.length > 0 ? `<div class="home-section-label">Active</div>` : ""}
            ${live.map((s) => renderSessionRow(s, focusedId)).join("")}
            ${history.length > 0 ? `<div class="home-section-label">Recent</div>` : ""}
            ${history.map((s) => renderSessionRow(s, focusedId, true)).join("")}
          </div>
        </div>
      </div>
    </div>`;
}

/// After a decision (or when a session disappears) drop focus back to the most
/// relevant session so the panel doesn't go blank.
///
/// Focus survives a session going quiet on purpose: clearing it the moment a
/// session stopped being live yanked the session view out from under the user
/// who had just opened it — the panel fell back to "watching your CLIs" while
/// they were reading it. Focus only moves when the session is actually gone.
export function refocusIfIdle(): void {
  const focused = ViewData.focus;
  if (focused && ViewData.sessions.some((s) => s.id === focused.id)) {
    return;
  }
  const next =
    ViewData.sessions.find((s) => s.status === "waiting") ??
    ViewData.sessions.find((s) => s.status === "working") ??
    null;
  ViewData.focus = next;
}
