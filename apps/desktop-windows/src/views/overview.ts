// The home view: the focused session on the left, every session on the right.
//
// Deliberately thin. It is the two-column shell and nothing else — the work
// panel is `working.ts`, each row is `session-row.ts`. That split is what lets
// either half be restyled without reading the other, and it is why this file
// stayed short while the panel it once inlined grew past a hundred lines.

import { ViewData } from "./state";
import { renderEmptyView } from "./empty";
import { renderWorkPanel, isSessionActive } from "./working";
import { renderSessionRow, statsStrip } from "./session-row";

export function renderOverviewView(): string {
  const f = ViewData.focus ?? (ViewData.sessions.length > 0 ? ViewData.sessions[0] : null);
  if (!f) return renderEmptyView();

  return `
    <div class="view overview on">
      <div class="left">
        <div class="card">
          <div class="card-body">${renderWorkPanel(f)}</div>
        </div>
      </div>
      <div class="right">
        <div class="card">
          <div class="card-body home-sessions">
            <div class="home-stats">${statsStrip(ViewData.sessions)}</div>
            <div class="home-session-list">
              ${ViewData.sessions.map((s) => renderSessionRow(s, f.id)).join("")}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/** Move the focus off a session that has stopped doing anything.
 *
 *  When the agent you were watching finishes, the panel keeps showing it — so
 *  "task done" reads as "task still running", and whatever the other agents are
 *  doing stays hidden behind a dead session. On every refresh, if the focused
 *  session is no longer active, hand focus to whatever else is actually
 *  working.
 *
 *  Order is deliberate: something genuinely working beats something merely
 *  unfinished, and a stale session never wins. */
export function refocusIfIdle(): void {
  const current = ViewData.focus;
  if (!current || isActiveStatus(current.status)) return;
  const others = ViewData.sessions.filter((s) => s.id !== current.id);
  const next =
    others.find((s) => s.status === "working") ??
    others.find((s) => s.status === "waiting") ??
    others.find((s) => isActiveStatus(s.status));
  if (next) ViewData.focus = next;
}

function isActiveStatus(status: string): boolean {
  return status === "working" || status === "waiting";
}
