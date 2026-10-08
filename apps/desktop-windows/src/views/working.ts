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
import { ViewData, activityKindColor, can, esc, fmtTokens, STATUS_COLORS, type EventItem } from "./state";
import { ICONS } from "./icons";
import { svg } from "./dom";

export function renderWorkPanel(f: Session): string {
  const runtimeLabel = f.runtime || "agent";
  const model = f.model || "default";
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

  const changes = changedFiles(f.id);

  return `
    <!-- One line of identity, then the agent's output as plain text on the
         card.

         The framed box this replaced was the problem. A border, a fill and a
         radius inside a panel that is already bounded by its own hairline reads
         as a card inside a card: two outlines competing for the same edge. The
         upstream reference puts this content straight onto the card with no
         container at all, and the hierarchy comes from type and space instead
         of from a second frame.

         The indent still comes from --content-gutter, which layout.ts publishes
         from the mascot's position. Upstream hardcodes 108px; deriving it is
         what keeps the text off the dog when the diameter changes. -->
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

      <div class="work-output">
        ${touched ? renderCurrentFile(touched) : ""}
        ${ended ? `<div class="work-outcome">${esc(outcomeText(f.status))}</div>` : ""}
        ${
          !ended
            ? `<div class="work-tool-line">${esc((f.last_event ?? "session").replace(/\./g, " "))}${tool ? ` <span>${esc(tool)}</span>` : ""}</div>
               <div class="work-msg-line">${esc(lastEvent?.message ?? describeEvent(f))}</div>`
            : ""
        }
        ${renderLiveLog(f.id, ended)}
      </div>

      ${renderChanges(changes, ended)}

      <!-- Ticker mounted here; it is the live half of this panel and the reason
           the card is tall enough to need scrolling. -->
      <div id="ticker-mount" class="work-ticker"></div>

      ${usageLine(f)}
      <div class="work-actions-row">${renderWorkActions(f, isApproval, isInput)}</div>
      ${ViewData.error ? `<div class="inline-error work-error">${esc(ViewData.error)}</div>` : ""}
      ${renderComposer(f)}
    </div>`;
}

/** The focused session, full width. Opening a session from View is a request
 *  to watch that one agent, so it gets the island's whole width rather than
 *  the overview's left column squeezed beside the session list. */
export function renderSessionView(): string {
  const f = ViewData.focus ?? ViewData.sessions[0];
  if (!f) {
    return `<div class="view on"><div class="card"><div class="card-body"><div class="sub">No session selected.</div></div></div></div>`;
  }
  return `
    <div class="view on">
      <div class="card">
        <div class="card-body session-detail">
          <!-- This view is the only layout that takes the island's whole width,
               so it is also the only one where the header's home icon is the
               sole way out. On a full-width panel that icon stops reading as
               navigation, and a user who opened a session by clicking View had
               no visible way back to the list. The button sits in the panel,
               next to the runtime it describes, so leaving is never a guess. -->
          <button class="work-back" data-act="back-to-overview" title="Back to all agents" aria-label="Back to all agents">
            ${svg(ICONS.chevronLeft, 12).outerHTML}
            <span>All agents</span>
          </button>
          ${renderWorkPanel(f)}
        </div>
      </div>
    </div>`;
}

/** Every file the focused session touched, deduped with the newest action
 *  winning. This is the answer to "did it actually modify anything, and what"
 *  — the question a finished session used to leave unanswered.
 *
 *  Reads the focused history fetched from the engine store rather than the
 *  live-only buffer, so the list survives a webview reload. When the history
 *  belongs to another session (a focus switch mid-fetch) it falls back to the
 *  live buffer rather than showing the wrong session's files. */
interface ChangedFile {
  file: string;
  fullPath: string;
  line?: number;
  verb: string;
}

function changedFiles(sessionId: string): ChangedFile[] {
  const source =
    ViewData.focusEventsFor === sessionId
      ? ViewData.focusEvents
      : ViewData.events.filter((e) => e.session_id === sessionId);
  const byPath = new Map<string, ChangedFile>();
  for (const ev of source) {
    if (!FILE_ACTIVITY.has(ev.type) || !ev.path) continue;
    const parts = ev.path.split(/[\/\\]/);
    // The newest event for a path replaces the earlier one: "edited" then
    // "deleted" must read as deleted, not as two facts about one file.
    byPath.set(ev.path, {
      file: parts[parts.length - 1] || ev.path,
      fullPath: ev.path,
      line: ev.line,
      verb: ev.change ?? ev.tool ?? "touched",
    });
  }
  // Newest last in the map; render newest first, capped so a busy session
  // cannot push the controls out of the island.
  return [...byPath.values()].slice(-6).reverse();
}

/** The changed-files list. Only rendered when there is something to say —
 *  an empty section header with nothing under it reads as a broken panel. */
function renderChanges(changes: ChangedFile[], ended: boolean): string {
  if (changes.length === 0) return "";
  return `
    <div class="work-changes">
      <div class="work-changes-label">${ended ? "Changed" : "Changing"}</div>
      ${changes
        .map(
          (c) => `
        <div class="work-change-row" title="${esc(c.fullPath)}">
          <span class="work-change-verb${verbTone(c.verb)}">${esc(c.verb)}</span>
          <span class="work-change-path">${esc(c.file)}</span>
          ${c.line ? `<span class="work-change-line">:${c.line}</span>` : ""}
        </div>`,
        )
        .join("")}
    </div>`;
}

/** Delete reads red, create reads green, everything else stays neutral. The
 *  verb is the risk signal on the row, so it carries the only colour. */
function verbTone(verb: string): string {
  const v = verb.toLowerCase();
  if (v.includes("delet") || v.includes("remov") || v.includes("fail")) return " danger";
  if (v.includes("creat") || v.includes("writ") || v.includes("add")) return " added";
  return "";
}

/** Talk to the focused agent without leaving home. This is the answer to the
 *  launcher being the only place a task could be typed: a running session
 *  takes its next instruction right here. Only rendered when the runtime
 *  actually accepts input — a composer that cannot send is worse than none. */
function renderComposer(f: Session): string {
  if (!f.live || !can("send")) return "";
  return `
    <div class="work-compose chat-bar">
      <input id="work-message" class="chat-input" type="text"
        placeholder="Tell ${esc(f.runtime || "the agent")} what to do next…"
        aria-label="Message for the agent" ${ViewData.busyAction === "send" ? "disabled" : ""} />
      <button class="send-btn" data-act="send-message" title="Send" ${ViewData.busyAction ? "disabled" : ""}>
        ${svg(ICONS.arrowUp, 13).outerHTML}
      </button>
    </div>`;
}

/** What the agent did to the file, in the right tense.
 *
 *  `edited` rather than `editing` once the session is over. The same word in both
 *  states made a finished agent look like it was still mid-edit — which is the
 *  opposite of what the status two lines above it says. */
function fileVerb(touched: TouchedFile): string {
  const verb = touched.change || (touched.done ? "edit" : "editing");
  if (touched.done) return /e$/.test(verb) ? verb : `${verb}ed`;
  return verb;
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
  /** True when the session has ended: the file is what it did, not what it is
   *  doing, and the verb has to say so. */
  done: boolean;
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
  const live = isSessionActive(newest.type);

  // A finished session still gets its file. Suppressing it was wrong: the last
  // file an agent touched is the record of what it actually did, and hiding it
  // left a completed session with no subject at all — the panel said "Finished"
  // about nothing in particular. What changes is the wording, not the presence.
  if (!live) return lastFileOf(mine);
  if (!newest.path && !FILE_ACTIVITY.has(newest.type)) return null;
  return lastFileOf(mine);
}

/** The most recent file this session worked on, flagged with whether the session
 *  is still live so the caller can pick the tense. */
function lastFileOf(events: EventItem[]): TouchedFile | null {
  const done = !isSessionActive(events[events.length - 1].type);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!FILE_ACTIVITY.has(ev.type) || !ev.path) continue;
    const parts = ev.path.split(/[\/]/);
    return {
      file: parts[parts.length - 1] || ev.path,
      fullPath: ev.path,
      line: ev.line,
      change: ev.change ?? ev.tool ?? "",
      done,
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

/** The file locator: verb + path + line, in mono, because the reader is going
 *  to go open it. The verb carries the tense, so a finished session says what
 *  it did rather than what it is doing. */
function renderCurrentFile(touched: TouchedFile): string {
  return `<div class="work-file" title="${esc(touched.fullPath)}">
    <span class="work-file-verb">${esc(fileVerb(touched))}</span>
    <span class="work-file-path">${esc(touched.file)}</span>
    ${touched.line ? `<span class="work-file-line">:${touched.line}</span>` : ""}
  </div>`;
}

/** What the agent is doing, event by event, newest last. This is the answer
 *  to "what is it doing exactly" — the headline above says the current thing,
 *  this says the steps around it. Rows animate in via CSS because render()
 *  rebuilds the panel on every engine event. */
const LIVE_LOG_EVENTS = 6;

function renderLiveLog(sessionId: string, ended: boolean): string {
  const events = ViewData.events.filter((e) => e.session_id === sessionId).slice(-LIVE_LOG_EVENTS);
  if (events.length === 0) {
    // A quiet session with no log is a fact, not a blank: say so, or the
    // panel reads as broken rather than as "nothing has happened".
    return ended
      ? `<div class="work-log-empty">No recent events — this session has gone quiet.</div>`
      : "";
  }
  return `<div class="work-log">${events
    .map((ev) => {
      const detail = ev.message || ev.command || ev.path || ev.tool || "";
      return `<div class="work-log-row">
        <span class="act-dot" style="color:${activityKindColor(ev.type)}"></span>
        <span class="work-log-kind">${esc(ev.type.replace(/\./g, " "))}</span>
        ${detail ? `<span class="work-log-detail" title="${esc(detail)}">${esc(detail)}</span>` : ""}
        <span class="work-log-time">${esc(ev.time)}</span>
      </div>`;
    })
    .join("")}</div>`;
}

function outcomeText(status: string): string {
  if (status === "failed") return "Failed";
  if (status === "stopped") return "Stopped";
  if (status === "stale") return "Not responding";
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