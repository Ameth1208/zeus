// The home view: what the focused session is doing on the left, every session
// on the right.

import type { Session } from "../zeus/frames";
import { colorForProject, describeEvent } from "../zeus/frames";
import { getAgentIcon } from "./icons";
import { svg } from "./dom";
import { ViewData, can, esc, fmtTokens, STATUS_COLORS } from "./state";
import { renderEmptyView } from "./empty";

export function renderOverviewView(): string {
  const f = ViewData.focus ?? (ViewData.sessions.length > 0 ? ViewData.sessions[0] : null);
  if (!f) return renderEmptyView();

  const color = colorForProject(f.project);
  const runtimeLabel = f.runtime || "agent";
  const model = f.model || "default";
  const isWaiting = f.status === "waiting";
  const isApproval = f.last_event === "permission.requested";
  const isInput = f.last_event === "input.requested";
  const tool = f.last_event === "tool.started" ? "tool" : "";

  return `
    <div class="view overview on">
      <div class="left">
        <div class="card">
          <div class="card-body">
            <div class="agent-work-panel">
              <div class="work-header-row">
                <div class="work-agent-chip">
                  <span style="display:flex; align-items:center;">
                    ${svg(getAgentIcon(runtimeLabel), 13).outerHTML}
                  </span>
                  <span>${esc(runtimeLabel)}</span>
                  <span style="font-weight:400; font-size:9.5px; opacity:0.8;">· ${esc(model)}</span>
                </div>
                <span class="work-status-badge">
                  <i class="dot" style="width:6px;height:6px;background:${isWaiting ? "#F5A524" : "#3B82F6"};display:inline-block;border-radius:50%;margin-right:4px;"></i>
                  ${esc(f.status.toUpperCase())}
                </span>
              </div>

              <div class="work-detail-box">
                ${tool ? `<div class="work-tool-line"><span>tool:</span> ${esc(tool)}</div>` : ""}
                <div class="work-msg-line">${esc(f.message || describeEvent(f))}</div>
                ${usageLine(f)}
                <!-- Ticker mounted here -->
                <div id="ticker-mount" style="margin-top:auto;"></div>
              </div>

              <div class="work-actions-row">
                ${
                  isApproval
                    ? `
                  <button class="btn primary" data-act="approve" style="background:#3B82F6;padding:4px 12px;font-size:11px;">Allow (Y)</button>
                  <button class="btn secondary" data-act="deny" style="padding:4px 12px;font-size:11px;">Deny (N)</button>
                `
                    : isInput && can("send")
                      ? '<button class="btn primary" data-act="open-question" style="background:#3B82F6;padding:4px 12px;font-size:11px;">Answer</button>'
                    : `
                  ${can("interrupt")
                    ? '<button class="btn secondary" data-act="interrupt-agent" style="padding:4px 10px;font-size:10.5px;">Interrupt</button>'
                    : ""}
                  ${can("stop")
                    ? '<button class="btn secondary" data-act="stop-agent" style="padding:4px 10px;font-size:10.5px;">Stop</button>'
                    : '<span style="opacity:0.7;font-size:10px;">Observed · Zeus does not own this process</span>'}
                `
                }
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="right">
        <div class="card">
          <div class="card-body" style="display:flex;flex-direction:column;gap:8px;overflow:hidden;">
            <div class="home-stats">${statsStrip()}</div>
            <div style="display:flex;flex-direction:column;gap:2px;min-height:0;overflow-y:auto;">
              ${ViewData.sessions.map((s) => renderSessionRow(s, f.id)).join("")}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/** Counts and totals for the home strip. Answers "what are my agents doing"
 *  in one glance without reading a single card. */
function statsStrip(): string {
  const sessions = ViewData.sessions;
  const working = sessions.filter((s) => s.status === "working").length;
  const waiting = sessions.filter((s) => s.status === "waiting").length;
  const done = sessions.filter((s) => s.status === "completed").length;
  let tokens = 0;
  for (const s of sessions) tokens += (s.usage?.input ?? 0) + (s.usage?.output ?? 0);
  const parts = [
    `<span class="home-stat"><i class="dot" style="width:6px;height:6px;background:#3B82F6"></i><b>${working}</b>&nbsp;working</span>`,
    waiting > 0
      ? `<span class="home-stat"><i class="dot" style="width:6px;height:6px;background:#F5A524"></i><b>${waiting}</b>&nbsp;waiting</span>`
      : "",
    done > 0
      ? `<span class="home-stat"><i class="dot" style="width:6px;height:6px;background:#22C55E"></i><b>${done}</b>&nbsp;done</span>`
      : "",
    tokens > 0 ? `<span class="home-stat"><b>${fmtTokens(tokens)}</b>&nbsp;tokens</span>` : "",
  ];
  return parts.filter(Boolean).join("");
}


function renderSessionRow(s: Session, focusedId: string): string {
  const color = STATUS_COLORS[s.status] ?? "#6b7079";
  const tokens = s.usage ? s.usage.input + s.usage.output + s.usage.thinking : 0;
  const meta = [
    s.status,
    s.model || "",
    tokens > 0 ? fmtTokens(tokens) : "",
  ].filter(Boolean).join(" · ");
  return `
    <div class="session-row" data-act="focus-session" data-id="${esc(s.id)}" title="${esc(s.project || s.runtime)}"
      style="${s.id === focusedId ? "background:rgba(255,255,255,0.06);" : ""}">
      <span class="session-row-dot ${s.status === "working" ? "working" : ""}" style="background:${color}"></span>
      <span style="display:flex;align-items:center;flex:0 0 auto;">${svg(getAgentIcon(s.runtime || "agent"), 13).outerHTML}</span>
      <span class="session-row-name">${esc(s.project || s.runtime || "session")}</span>
      <span class="session-row-meta">${esc(meta)}</span>
    </div>`;
}

/** Compact token counter, e.g. "12.4k in · 3.1k out". Empty when the runtime
 *  has not reported usage yet; an estimate must always be labelled. */
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
