// One session, as a component.
//
// Extracted from `overview.ts` so the row can be restyled or re-shaped without
// touching the view that lays it out. It owns everything about how one session
// reads: the avatar, the status word, the file being touched, and the control.
//
// The row answers three questions in a fixed order — which agent is this, what
// is it doing, and where do I go to see it — so the reading is top-to-bottom and
// the single action sits out of its way on the right.

import type { Session } from "../zeus/frames";
import { getAgentIcon } from "./icons";
import { svg } from "./dom";
import { esc, STATUS_COLORS } from "./state";
import { currentTouchedFile } from "./working";

export function renderSessionRow(s: Session, focusedId: string): string {
  const color = STATUS_COLORS[s.status] ?? "#8e939c";
  const focused = s.id === focusedId;
  const touched = currentTouchedFile(s.id);

  return `
    <div class="session-row${focused ? " focused" : ""}" data-act="focus-session" data-id="${esc(s.id)}">
      <span class="session-avatar" style="color:${color};">${svg(getAgentIcon(s.runtime || "agent"), 15).outerHTML}</span>
      <span class="session-row-body">
        <span class="session-row-title">${esc(s.project || s.runtime || "session")}</span>
        <span class="session-row-detail">
          <span class="session-row-status" style="color:${color};">${esc(statusWord(s.status))}</span>
          ${
            touched
              ? `<span class="session-row-file" title="${esc(touched.fullPath)}">${
                  touched.change ? `<span class="session-row-verb">${esc(touched.change)}</span> ` : ""
                }${esc(touched.file)}${
                  touched.line ? `<span class="session-row-line">:${touched.line}</span>` : ""
                }</span>`
              : ""
          }
        </span>
      </span>
      <button class="session-row-view" data-act="view-session" data-id="${esc(s.id)}" title="Open this session">View</button>
    </div>`;
}

/// `stale` is spelled out. The engine reports it when a session said it was
/// working and then went quiet; showing "stale" there would read as an internal
/// term, and showing "working" would be the lie this whole state exists to stop.
function statusWord(status: string): string {
  return status === "stale" ? "not responding" : status;
}

/// Counts and totals for the home strip: "what are my agents doing" in one
/// glance without reading a single row.
export function statsStrip(sessions: Session[]): string {
  const working = sessions.filter((s) => s.status === "working").length;
  const waiting = sessions.filter((s) => s.status === "waiting").length;
  const done = sessions.filter((s) => s.status === "completed").length;
  let tokens = 0;
  for (const s of sessions) tokens += (s.usage?.input ?? 0) + (s.usage?.output ?? 0);

  const parts = [
    count(working, "working", "#3B82F6"),
    waiting > 0 ? count(waiting, "waiting", "#F5A524") : "",
    done > 0 ? count(done, "done", "#22C55E") : "",
    tokens > 0 ? `<span class="home-stat"><b>${fmt(tokens)}</b>&nbsp;tokens</span>` : "",
  ];
  return parts.filter(Boolean).join("");
}

function count(n: number, label: string, color: string): string {
  return `<span class="home-stat"><i class="dot" style="width:6px;height:6px;background:${color}"></i><b>${n}</b>&nbsp;${label}</span>`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
