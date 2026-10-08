// The Agent Activity feed: what every agent is doing right now, and anything
// waiting on you.
//
// Rewritten because the old version was `events.slice(-12).reverse()` — the last
// twelve events across *every* session, flattened, with no way to tell which
// agent a row belonged to. It looked the same no matter what was happening, and
// it surfaced nothing that needed a decision.

import { ICONS } from "./icons";
import { svg } from "./dom";
import { ViewData, activityKindColor, esc, fmtTokens, STATUS_COLORS, type EventItem } from "./state";
import type { Session } from "../zeus/frames";
import { currentTouchedFile } from "./working";

/** Events per session shown when a session is expanded. */
const PER_SESSION = 8;

export function renderPromptView(): string {
  // Newest first within each session, then sessions ordered by how much they
  // need attention: waiting first, then working, then everything else. A feed
  // ordered purely by time buries a blocked agent under an idle one's chatter.
  const ordered = [...ViewData.sessions].sort((a, b) => rank(a.status) - rank(b.status));
  const eventsBySession = new Map<string, EventItem[]>();
  for (const ev of ViewData.events) {
    const list = eventsBySession.get(ev.session_id);
    if (list) list.push(ev);
    else eventsBySession.set(ev.session_id, [ev]);
  }

  return `
    <div class="view on">
      <div class="card cli-card has-mascot">
        <div class="activity-feed-container">
          <div class="activity-header">
            <span>Agent Activity</span>
            <span class="activity-tally">${tally()}</span>
          </div>

          <div class="activity-list">
            ${renderWaiting()}
            ${
              ordered.length === 0
                ? `<div class="activity-empty">
                     <div class="compact-dot-blue" style="width:8px;height:8px;"></div>
                     <span>No agent events yet.</span>
                   </div>`
                : ordered.map((s) => renderSessionGroup(s, eventsBySession.get(s.id) ?? [])).join("")
            }
          </div>
          ${renderSessionComposer()}
        </div>
      </div>
    </div>`;
}

/** Attention first, then activity, then everything that is over. */
function rank(status: string): number {
  if (status === "waiting") return 0;
  if (status === "working") return 1;
  return 2;
}

function tally(): string {
  const sessions = ViewData.sessions.length;
  const working = ViewData.sessions.filter((s) => s.status === "working").length;
  const waiting = ViewData.sessions.filter((s) => s.status === "waiting").length;
  let total = 0;
  for (const s of ViewData.sessions) {
    total += (s.usage?.input ?? 0) + (s.usage?.output ?? 0);
  }
  const tokens = total > 0 ? ` · ${fmtTokens(total)} tokens` : "";
  return `${sessions} session${sessions === 1 ? "" : "s"} · ${working} working · ${waiting} waiting${tokens}`;
}

/** Anything blocked on the user, pinned above the feed.
 *
 *  An approval buried under a chronological event log is an approval nobody
 *  answers, and the island's whole reason to exist is that a blocked agent is
 *  the one thing worth interrupting for. */
function renderWaiting(): string {
  const pending = ViewData.pending;
  if (pending.length === 0) return "";
  return `
    <div class="activity-waiting">
      ${pending
        .map((p) => {
          const session = ViewData.sessions.find((s) => s.id === p.session_id);
          return `
        <div class="activity-ask" data-act="focus-session" data-id="${esc(p.session_id)}">
          <span class="activity-ask-icon">${svg(ICONS.bang, 13).outerHTML}</span>
          <span class="activity-ask-body">
            <span class="activity-ask-title">${esc(session?.project || p.session_id)} needs you</span>
            <span class="activity-ask-detail" title="${esc(p.summary || "")}">${esc(p.summary || "Approve or deny")}</span>
          </span>
          <button class="activity-ask-allow" data-act="approve" data-id="${esc(p.request_id)}">Allow</button>
          <button class="activity-ask-deny" data-act="deny" data-id="${esc(p.request_id)}">Deny</button>
        </div>`;
        })
        .join("")}
    </div>`;
}

/** One session with its recent events, so a row is never context-free. */
function renderSessionGroup(
  s: Session,
  events: EventItem[],
): string {
  const recent = events.slice(-PER_SESSION).reverse();
  const touched = currentTouchedFile(s.id);
  const isFocused = ViewData.focus?.id === s.id;

  return `
    <div class="activity-group${isFocused ? " focused" : ""}">
      <div class="activity-group-head">
        <span class="activity-group-name">${esc(s.project || s.runtime || "session")}</span>
        <span class="activity-group-status status-${s.status}">${esc(statusWord(s.status))}</span>
        ${
          touched
            ? `<span class="activity-group-file" title="${esc(touched.fullPath)}">${esc(touched.file)}${
                touched.line ? `:${touched.line}` : ""
              }</span>`
            : ""
        }
        <button class="activity-group-view" data-act="view-session" data-id="${esc(s.id)}" title="Open this session">View</button>
      </div>
      ${
        recent.length > 0
          ? recent.map((ev) => renderEventRow(ev)).join("")
          : `<div class="activity-group-empty">No events yet</div>`
      }
    </div>`;
}

function renderEventRow(ev: EventItem): string {
  const color = activityKindColor(ev.type);
  const detail = ev.message || ev.command || ev.path || ev.tool || "";
  return `
    <div class="act-row">
      <span class="act-dot" style="color:${color}"></span>
      <div class="act-body">
        <div class="act-title">${esc(ev.type.replace(/\./g, " "))} <span class="act-who">${esc(ev.time)}</span></div>
        ${detail ? `<div class="act-detail" title="${esc(detail)}">${esc(detail)}</div>` : ""}
      </div>
    </div>`;
}

function statusWord(status: string): string {
  return status === "stale" ? "not responding" : status;
}

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
