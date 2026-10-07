// The Agent Activity feed: every event, newest first, with a composer for
// continuing a live session.

import { ICONS } from "./icons";
import { svg } from "./dom";
import { ViewData, activityKindColor, esc, fmtTokens } from "./state";

export function renderPromptView(): string {
  const events = ViewData.events.slice(-12).reverse();

  // Totals across every session the engine knows about, so the header answers
  // "how much have my agents burned" without opening each one.
  let totalIn = 0;
  let totalOut = 0;
  for (const s of ViewData.sessions) {
    totalIn += s.usage?.input ?? 0;
    totalOut += s.usage?.output ?? 0;
  }
  const working = ViewData.sessions.filter((s) => s.status === "working").length;
  const waiting = ViewData.sessions.filter((s) => s.status === "waiting").length;
  const totals =
    totalIn + totalOut > 0
      ? ` · ${fmtTokens(totalIn)} in / ${fmtTokens(totalOut)} out`
      : "";

  return `
    <div class="view on">
      <div class="card cli-card has-mascot">
        <div class="activity-feed-container">
          <div class="activity-header">
            <span>Agent Activity</span>
            <span style="font-size:10px;font-weight:400;color:var(--dim-3);">${ViewData.sessions.length} session(s) · ${working} working · ${waiting} waiting${totals}</span>
          </div>

          <div class="activity-list">
            ${
              events.length > 0
                ? events
                    .map((ev) => {
                      const color = activityKindColor(ev.type);
                      const detail = ev.message || ev.command || ev.path || ev.tool || "";
                      return `
                <div class="act-row">
                  <span class="act-dot" style="color:${color}"></span>
                  <div class="act-body">
                    <div class="act-title">${esc(ev.type)} <span class="act-who">· ${esc(ev.runtime)} · ${esc(ev.time)}</span></div>
                    ${detail ? `<div class="act-detail" title="${esc(detail)}">${esc(detail)}</div>` : ""}
                  </div>
                </div>`;
                    })
                    .join("")
                : `
              <div class="activity-empty">
                <div class="compact-dot-blue" style="width:8px;height:8px;"></div>
                <span>No agent events yet.</span>
              </div>
            `
            }
          </div>
          ${renderSessionComposer()}
        </div>
      </div>
    </div>`;
}

/** One color per event family, shared with the log ticker in main.ts. */

function renderSessionComposer(): string {
  const session = ViewData.focus;
  if (!session?.live || !session.capabilities.includes("send")) {
    return '<div class="activity-composer-note">Select a live managed session with send support to continue it.</div>';
  }
  return `
    <div class="chat-bar activity-composer">
      <input id="session-message" class="chat-input" type="text" placeholder="Send an instruction to ${esc(session.runtime)}" />
      <button class="send-btn" data-act="send-message" title="Send" ${ViewData.busyAction ? "disabled" : ""}>
        ${svg(ICONS.arrowUp, 13).outerHTML}
      </button>
    </div>`;
}
