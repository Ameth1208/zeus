// The work panel: what the focused agent is doing, and the controls for it.
//
// Its own module because it is a distinct UI, not part of the home view's
// markup. It was inlined in `renderOverviewView`, which meant every change to
// the panel's layout had to be made inside a function that also builds the
// session list — so the two drifted and neither could be restyled alone.
//
// The whole panel lives here now, along with the three things it needs to decide
// what to show: the file the session is touching, whether that session has
// ended, and which controls the runtime actually advertises.

import type { Session } from "../zeus/frames";
import { describeEvent } from "../zeus/frames";
import { ViewData, can, esc, fmtTokens, STATUS_COLORS, type EventItem } from "./state";

export function renderWorkPanel(f: Session): string {
  const runtimeLabel = f.runtime || "agent";
  const model = f.model || "default";
  const isWaiting = f.status === "waiting";
  const isApproval = f.last_event === "permission.requested";
  const isInput = f.last_event === "input.requested";
  const tool = f.last_event === "tool.started" ? "tool" : "";

  const touched = currentTouchedFile(f.id);
  const statusColor = STATUS_COLORS[f.status] ?? "#8e939c";

  // A session that has ended has no current file, so it gets an outcome line
  // instead: without one, suppressing the locator leaves a box that reads the
  // same whether the agent is idle or finished.
  const ended =
    f.status === "completed" || f.status === "failed" || f.status === "stopped" || f.status === "stale";
  const lastEvent = lastEventFor(f.id);
  const outcome = ended && lastEvent && !isSessionActive(lastEvent.type) ? lastEvent : null;

  return `
    <!-- [mascot] [runtime · model ............ status]
         No runtime icon in the chip. The mascot is the runtime — it is drawn
         from that CLI's own glyph, larger, right there. A second icon beside it
         repeated the same information and left a gap in the middle, which is
         what made this read as two avatars.

         The panel indents by --content-gutter, which layout.ts publishes from
         the mascot's own position. The two used to be independent numbers, and
         that is how the text came to run under the dog. -->
    <div class="agent-work-panel">
      <div class="work-header-row">
        <div class="work-agent-chip">
          <span class="work-agent-name">${esc(runtimeLabel)}</span>
          <span class="work-agent-model">${esc(model)}</span>
        </div>
        <span class="work-status-badge" style="color:${statusColor};">
          <span class="work-status-dot${dotClass(f.status)}"></span>
          ${esc(statusWord(f.status))}
        </span>
      </div>

      <div class="work-detail-box${ended ? " ended" : ""}">
        <!-- The file, above the message. It is the first thing worth knowing
             while an agent works, and buried under the message the panel read
             as "something is happening" with no subject. Line number only when
             the hook supplied one — a file with no position is normal. -->
        ${
          touched
            ? `<div class="work-file" title="${esc(touched.fullPath)}">
          <span class="work-file-verb">${esc(touched.change || "editing")}</span>
          <span class="work-file-path">${esc(touched.file)}</span>
          ${touched.line ? `<span class="work-file-line">:${touched.line}</span>` : ""}
        </div>`
            : ""
        }
        ${outcome ? `<div class="work-outcome">${esc(outcomeText(f.status))}</div>` : ""}
        ${tool ? `<div class="work-tool-line"><span>tool</span>${esc(tool)}</div>` : ""}
        <div class="work-msg-line">${esc(f.message || describeEvent(f))}</div>
        ${usageLine(f)}
        <!-- Ticker mounted here -->
        <div id="ticker-mount" class="work-ticker"></div>
      </div>

      <div class="work-actions-row">${renderWorkActions(f, isApproval, isInput)}</div>
    </div>`;
}

/// The row's status word. `stale` is spelled out rather than shown as `working`
/// or abbreviated: it means "we stopped hearing from this", and the honest word
/// is the only one that tells the user not to wait.
function statusWord(status: string): string {
  return status === "stale" ? "not responding" : status;
}

function dotClass(status: string): string {
  if (status === "waiting") return " waiting";
  if (status === "working") return " working";
  return "";
}

/// Controls, gated on what the runtime advertises. A runtime without `stop` gets
/// no Stop button; an observed runtime — which Zeus does not own — says so
/// instead of offering a button that could never work.
function renderWorkActions(f: Session, isApproval: boolean, isInput: boolean): string {
  if (isApproval) {
    return `
      <button class="btn primary" data-act="approve">Allow</button>
      <button class="btn ghost" data-act="deny">Deny</button>`;
  }
  if (isInput && can("send")) {
    return '<button class="btn primary" data-act="open-question">Answer</button>';
  }
  const parts: string[] = [];
  if (can("interrupt")) {
    parts.push('<button class="btn ghost" data-act="interrupt-agent">Interrupt</button>');
  }
  if (can("stop")) {
    parts.push('<button class="btn ghost" data-act="stop-agent">Stop</button>');
  }
  if (parts.length === 0) {
    return '<span class="work-observed">Observed · Zeus does not own this process</span>';
  }
  return parts.join("");
}

/** What this session is touching *right now*, or null when it is not.
 *
 *  Scans backwards for the newest event belonging to the session. If that event
 *  closed the session — or simply was not a tool working on a file — there is no
 *  current file and the panel falls back to the state word. The walk only
 *  continues past an event that had no path for the same reason: a `thinking`
 *  event between two edits means the agent paused to reason, not that it
 *  finished. Reporting the last known file regardless would present history as
 *  work in progress on a session that ended an hour ago.
 *
 *  Read from the session's own events rather than the digest: the digest is a
 *  per-session fetch and this panel sits beside a list of every session. */
export interface TouchedFile {
  file: string;
  fullPath: string;
  line?: number;
  change: string;
}

const FILE_ACTIVITY: ReadonlySet<string> = new Set([
  "tool.started",
  "tool.completed",
  "tool.failed",
]);

export function currentTouchedFile(sessionId: string): TouchedFile | null {
  const mine = ViewData.events.filter((e) => e.session_id === sessionId);
  if (mine.length === 0) return null;

  const newest = mine[mine.length - 1];
  if (!isSessionActive(newest.type)) return null;
  if (!newest.path && !FILE_ACTIVITY.has(newest.type)) return null;

  for (let i = mine.length - 1; i >= 0; i--) {
    const ev = mine[i];
    if (!FILE_ACTIVITY.has(ev.type) || !ev.path) continue;
    const parts = ev.path.split(/[\\/]/);
    return {
      file: parts[parts.length - 1] || ev.path,
      fullPath: ev.path,
      line: ev.line,
      change: ev.change ?? ev.tool ?? "",
    };
  }
  return null;
}

/** Newest event belonging to a session, or null when it has reported nothing. */
export function lastEventFor(sessionId: string): EventItem | null {
  for (let i = ViewData.events.length - 1; i >= 0; i--) {
    if (ViewData.events[i].session_id === sessionId) return ViewData.events[i];
  }
  return null;
}

/** Whether an event marks the session as no longer working on anything. */
export function isSessionActive(eventType: string): boolean {
  return (
    eventType !== "session.completed" &&
    eventType !== "session.failed" &&
    eventType !== "permission.resolved"
  );
}

function outcomeText(status: string): string {
  if (status === "failed") return "Failed";
  if (status === "stopped") return "Stopped";
  return "Finished";
}

/** Token counter, e.g. "12.4k in · 3.1k out". Empty when the runtime has not
 *  reported usage yet; an estimate must always be labelled where it is shown. */
function usageLine(s: Session): string {
  const u = s.usage;
  if (!u || u.input + u.output + u.thinking === 0) return "";
  const parts = [
    `${fmtTokens(u.input)} in`,
    `${fmtTokens(u.output)} out`,
    u.cached > 0 ? `${fmtTokens(u.cached)} cached` : "",
  ].filter(Boolean);
  return `<div class="work-usage-line">${parts.join(" · ")}${u.estimated ? " (estimated)" : ""}</div>`;
}