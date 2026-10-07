// Views layer — Coucou layout and components for desktop agents.
// Integrates Antigravity, Claude Code, Codex, and OpenCode with live Ticker and approvals.

import type { IslandViewName } from "./island/layout";
import type { Session } from "./zeus/frames";
import { colorForProject, describeEvent } from "./zeus/frames";
import { ICONS, getAgentIcon } from "./views/icons";
import { svg } from "./views/dom";
import { Ticker } from "./views/ticker";
import type { NowPlaying, PendingRequest, RuntimeEntry } from "./engine/client";

export interface AgentCardInfo {
  id: string;
  name: string;
  runtime: string;
  project: string;
  status: string;
  steps: string[];
  stepIndex: number;
  command?: string;
  tool?: string;
}

export interface EventItem {
  id: string;
  time: string;
  session_id: string;
  agent_id: string;
  runtime: string;
  type: string;
  message?: string;
  tool?: string;
  path?: string;
  command?: string;
}

export const ViewData = {
  sessions: [] as Session[],
  focus: null as Session | null,
  /** Approvals that are still decidable. Expired ones are filtered out by the
   *  engine, so a button here is always a button that will be honoured. */
  pending: [] as PendingRequest[],
  /** What this machine can drive, and what it can only watch. */
  runtimes: [] as RuntimeEntry[],
  activeView: "overview" as IslandViewName,
  state: "idle",
  /** "offline" means the engine host is unreachable, not that an agent stopped:
   *  agents live in the host and keep running either way. */
  hostState: "online" as "online" | "offline",
  gatewayState: "offline" as "online" | "connecting" | "offline",
  soundOn: true,
  /** Windows toasts on pushworthy events; persisted by the host, not localStorage. */
  notificationsOn: true,
  disablePoking: localStorage.getItem("zeus_disable_poking") === "true",
  autoCloseSec: parseInt(localStorage.getItem("zeus_autoclose") || "15", 10),
  gatewayUrl: localStorage.getItem("zeus_gateway_url") || "http://127.0.0.1:8080",
  gatewayToken: localStorage.getItem("zeus_gateway_token") || "local-dev",
  launchRuntime: "",
  launchCwd: localStorage.getItem("zeus_launch_cwd") || "",
  media: {
    available: false,
    title: "",
    artist: "",
    album: "",
    playing: false,
    position_secs: 0,
    duration_secs: 0,
    thumbnail: "",
  } as NowPlaying,
  busyAction: "" as "" | "launch" | "send" | "save-gateway",
  error: "",
  events: [] as EventItem[],
  ticker: new Ticker(),
};

/** True when the focused session advertises a capability. The single gate on
 *  every control: a runtime without `stop` gets no stop button, rather than a
 *  button that fails when pressed. */
export function can(capability: string): boolean {
  return !!ViewData.focus && ViewData.focus.capabilities.includes(capability);
}

export function renderHeader(activeView: IslandViewName, soundEnabled: boolean): string {
  return `
    <div id="header">
      <div class="tabs">
        <button class="tab icon-only ${activeView === "overview" || activeView === "empty" ? "on" : ""}" data-nav="overview" title="Agents" aria-label="Agents">
          ${svg(ICONS.house, 15).outerHTML}
        </button>
        <button class="tab icon-only ${activeView === "prompt" ? "on" : ""}" data-nav="prompt" title="Activity" aria-label="Activity">
          ${svg(ICONS.bolt, 14).outerHTML}
        </button>
        <button class="tab icon-only ${activeView === "launcher" ? "on" : ""}" data-nav="launcher"  title="Launch an agent" aria-label="Launch an agent">
          ${svg(ICONS.plus, 14).outerHTML}
        </button>
        <button class="tab icon-only ${activeView === "media" ? "on" : ""}" data-nav="media" title="Music" aria-label="Music">
          ${svg(ICONS.music, 14).outerHTML}
        </button>
      </div>
      <div class="header-actions">
        <button class="tab ${activeView === "settings" ? "on" : ""}" data-nav="settings" title="Settings">
          ${svg(activeView === "settings" ? ICONS.gearFill : ICONS.gear, 14).outerHTML}
        </button>
        <button data-act="toggle-sound" title="${soundEnabled ? "Mute" : "Unmute"}">
          ${svg(soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14).outerHTML}
        </button>
      </div>
    </div>`;
}

export function renderViewContent(view: IslandViewName): string {
  switch (view) {
    case "approval":
      return renderApprovalView();
    case "question":
      return renderQuestionView();
    case "empty":
      return renderEmptyView();
    case "prompt":
      return renderPromptView();
    case "launcher":
      return renderLauncherView();
    case "finished":
      return renderTerminalView(true);
    case "error":
      return renderTerminalView(false);
    case "media":
      return renderMediaView();
    case "settings":
      return renderSettingsView();
    case "overview":
    default:
      return renderOverviewView();
  }
}

function renderOverviewView(): string {
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

const STATUS_COLORS: Record<string, string> = {
  working: "#3B82F6",
  waiting: "#F5A524",
  completed: "#22C55E",
  failed: "#F4505E",
  stopped: "#6b7079",
};

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
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

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

function renderApprovalView(): string {
  const request = ViewData.pending[0];
  const session = request
    ? ViewData.sessions.find((s) => s.id === request.session_id)
    : ViewData.focus ?? (ViewData.sessions.length > 0 ? ViewData.sessions[0] : null);
  if (!request) {
    return renderEmptyView();
  }
  const color = session ? colorForProject(session.project) : "#F5A524";
  const agentName = session ? session.runtime || "Coding Agent" : "Coding Agent";
  // The summary is what the runtime asked to do, not the engine's placeholer.
  const command = request.summary || session?.message || "";
  const count = ViewData.pending.length;

  return `
    <div class="view on">
      <div class="card wash" style="--wash: rgba(245, 165, 36, 0.35);">
        <div class="approval-body">
          <div class="approval-lead">
            <i class="dot" style="width:8px;height:8px;background:${color}"></i>
            <span class="approval-agent">${esc(agentName)}</span>
            <span class="approval-time">${count > 1 ? `${count} requests waiting` : "needs your decision"}</span>
          </div>
          <div class="approval-summary" title="${esc(command)}">${esc(command)}</div>
          <div class="approval-actions">
            <button class="btn secondary" data-act="deny" title="Deny (N)">
              <span>Deny</span><span class="kbd">N</span>
            </button>
            <button class="btn primary" data-act="approve" title="Allow (Y)">
              <span>Allow</span><span class="kbd">Y</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderQuestionView(): string {
  const request = ViewData.pending[0];
  const session = request
    ? ViewData.sessions.find((s) => s.id === request.session_id)
    : ViewData.focus;
  const question = request?.summary || session?.message || "Zeus needs an answer";
  return `
    <div class="view on">
      <div class="card wash" style="--wash: rgba(34, 211, 238, 0.32);">
        <div class="approval-body">
          <div class="approval-lead">
            <i class="dot" style="width:8px;height:8px;background:#22D3EE"></i>
            <span class="n">${esc(session ? session.runtime || "agent" : "agent")}</span>
            <span class="approval-time">${ViewData.pending.length > 1 ? "" : "needs an answer"}</span>
          </div>
          <div class="approval-summary" title="${esc(question)}">${esc(question)}</div>
          <div class="chat-bar" style="padding: 0;">
            <input id="question-answer" class="chat-input" type="text" placeholder="Answer the agent…" autocomplete="off" />
            <button class="send-btn" data-act="send-answer" title="Send answer" ${ViewData.busyAction ? "disabled" : ""}>
              ${svg(ICONS.arrowUp, 13).outerHTML}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderLauncherView(): string {
  const installed = ViewData.runtimes.filter((e) => e.managed && e.managed.installed && e.managed.available.includes("launch"));
  return `
    <div class="view on">
      <div class="card">
        <div class="launcher-body">
          <div class="launcher-heading">Launch an agent</div>
          ${
            installed.length === 0
              ? `<div class="launcher-empty">No managed runtime with launch support is installed.</div>`
              : `<div class="launcher-grid">${installed
                  .map((entry) => {
                    const color = colorForProject(entry.info.id);
                    const chosen = ViewData.launchRuntime === entry.info.id;
                    return `<button class="launcher-card ${chosen ? "chosen" : ""}" data-act="choose-runtime" data-runtime="${esc(entry.info.id)}" title="Launch ${esc(entry.info.label)}">
                      <span class="runtime-icon" style="color:${color}">${svg(getAgentIcon(entry.info.id), 15).outerHTML}</span>
                      <span class="runtime-name">${esc(entry.info.label)}</span>
                    </button>`;
                  })
                  .join("")}</div>`
          }
          <div class="chat-bar launcher-prompt">
            <input id="launch-cwd" class="chat-input" type="text" value="${esc(ViewData.launchCwd)}" placeholder="C:\projects\work" style="max-width: 220px;" />
            <input id="launch-prompt" class="chat-input" type="text" value="" placeholder="Tell the agent what to do…" autocomplete="off" />
            <button class="send-btn" data-act="launch-session" title="Launch" ${ViewData.busyAction ? "disabled" : ""}>
              ${svg(ICONS.arrowUp, 13).outerHTML}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

/** The terminal views share a shape: a wash card, the outcome, and the next
 *  move. `finished` offers continuing the session; `error` explains the
 *  failure. Both unpin on dismiss. */
function renderTerminalView(success: boolean): string {
  const session = ViewData.focus ?? (ViewData.sessions.length > 0 ? ViewData.sessions[0] : null);
  const runtime = session?.runtime || "agent";
  const message = session?.message || (success ? "Task completed" : "The session failed");
  const color = success ? "#22C55E" : "#F4505E";
  const wash = success ? "rgba(34, 197, 94, 0.4)" : "rgba(244, 80, 94, 0.45)";
  const canContinue = !!session && session.capabilities.includes("send");

  return `
    <div class="view on">
      <div class="card wash" style="--wash: ${wash};">
        <div class="approval-body">
          <div class="approval-lead">
            <i class="dot" style="width:8px;height:8px;background:${color}"></i>
            <span class="approval-agent">${esc(runtime)}</span>
            <span class="approval-time">${success ? "task completed" : "session failed"}</span>
          </div>
          <div class="approval-summary" title="${esc(message)}">${esc(message)}</div>
          <div class="approval-actions">
            <button class="btn secondary" data-act="dismiss-terminal" title="Dismiss">
              <span>Dismiss</span><span class="kbd">Esc</span>
            </button>
            ${
              canContinue
                ? `<button class="btn primary" data-act="next-task" title="Send the next instruction">
                     <span>Next task</span>
                   </button>`
                : ""
            }
          </div>
        </div>
      </div>
    </div>`;
}

function renderEmptyView(): string {
  const cards =
    ViewData.runtimes.length > 0
      ? ViewData.runtimes
          .map((entry) => {
            const id = entry.info.id;
            const color = colorForProject(id);
            const installed = !!entry.managed?.installed;
            return `<button class="empty-agent" ${installed ? `data-act="choose-runtime" data-runtime="${esc(id)}"` : "disabled"}
              style="${installed ? "" : "opacity:0.45;cursor:default;"}" title="${esc(entry.info.label)}${installed ? "" : " — not installed"}">
              <span style="color:${color}; display:flex;">${svg(getAgentIcon(id), 20).outerHTML}</span>
              <span>${esc(entry.info.label)}</span>
            </button>`;
          })
          .join("")
      : `<div class="empty-hero-line" style="color:var(--dim-3);grid-column:span 4;">No runtimes detected.</div>`;

  return `
    <div class="view on">
      <div class="card" style="height: 100%; padding: 0;">
        <div class="empty-hero">
          <div class="empty-hero-title">Zeus</div>
          <div class="empty-hero-sub">${
            ViewData.hostState === "online"
              ? "Launch an agent, or start one yourself — Zeus will watch."
              : "Engine host unreachable."
          }</div>
          <div class="empty-hero-grid" style="grid-template-columns: repeat(4, 1fr);">${cards}</div>
        </div>
      </div>
    </div>`;
}

function renderPromptView(): string {
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
      <div class="card cli-card">
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
                  <span class="act-dot" style="background:${color}"></span>
                  <div class="act-body">
                    <div class="act-title">${esc(ev.type)} <span class="act-who">· ${esc(ev.runtime)} · ${esc(ev.time)}</span></div>
                    ${detail ? `<div class="act-detail" title="${esc(detail)}">${esc(detail)}</div>` : ""}
                  </div>
                </div>`;
                    })
                    .join("")
                : `
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--dim-3);font-size:11px;">
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
function activityKindColor(kind: string): string {
  if (kind.startsWith("tool.")) return "#3B82F6";
  if (kind.startsWith("file.")) return "#22C55E";
  if (kind.startsWith("command.")) return "#A78BFA";
  if (kind.startsWith("agent.")) return "#9CA3AF";
  if (kind.startsWith("session.")) return "#38BDF8";
  if (kind.startsWith("permission.")) return "#F5A524";
  if (kind.startsWith("input.")) return "#22D3EE";
  return "#6b7079";
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

/** Now-playing and transport, straight from the host's media session. When
 *  nothing is playing the view says so instead of hiding: the tab is always in
 *  the header. */
function renderMediaView(): string {
  const media = ViewData.media;
  const pct =
    media.duration_secs > 0
      ? Math.min(100, (media.position_secs / media.duration_secs) * 100)
      : 0;
  const progress =
    media.available && media.duration_secs > 0
      ? `
      <div class="media-progress">
        <span class="media-progress-time">${fmtClock(media.position_secs)}</span>
        <div class="media-progress-track">
          <div class="media-progress-fill${media.playing ? " live" : ""}" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <span class="media-progress-time">${fmtClock(media.duration_secs)}</span>
      </div>`
      : "";

  return `
    <div class="view on">
      <div class="card">
        <div class="media-body">
          <div class="media-left">
            <div class="media-track">
              ${
                media.thumbnail
                  ? `<img class="media-cover" src="${media.thumbnail}" alt="" />`
                  : `<span class="media-note">${svg(ICONS.music, 18).outerHTML}</span>`
              }
              <div class="media-text">
                <div class="media-title">${esc(media.available && media.title ? media.title : "Nothing playing")}</div>
                <div class="media-artist">${esc(
                  media.available
                    ? [media.artist, media.album].filter(Boolean).join(" — ") || "Unknown artist"
                    : "Start music on this PC and it shows up here",
                )}</div>
              </div>
            </div>
            ${progress}
          </div>
          <div class="media-controls">
            <button class="media-btn" data-act="media-previous" title="Previous" ${media.available ? "" : "disabled"}>
              ${svg(ICONS.skipBack, 16).outerHTML}
            </button>
            <button class="media-btn primary" data-act="media-playpause" title="${media.playing ? "Pause" : "Play"}" ${media.available ? "" : "disabled"}>
              ${svg(media.playing ? ICONS.pause : ICONS.play, 18).outerHTML}
            </button>
            <button class="media-btn" data-act="media-next" title="Next" ${media.available ? "" : "disabled"}>
              ${svg(ICONS.skipForward, 16).outerHTML}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

/** m:ss for the progress bar. */
function fmtClock(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function renderSettingsView(): string {
  const isPokingDisabled = ViewData.disablePoking;
  const isSoundOn = ViewData.soundOn;

  return `
    <div class="view on">
      <div class="card">
        <div class="settings-container">
          <!-- Gateway row -->
          <div class="settings-section">
            <div class="settings-label">Zeus Gateway Connection</div>
            <div class="settings-field-row">
              <input id="gateway-url-input" type="text" value="${esc(ViewData.gatewayUrl)}" placeholder="http://127.0.0.1:8080" class="settings-input" style="flex:1;" />
              <input id="gateway-token-input" type="password" value="${esc(ViewData.gatewayToken)}" placeholder="Token (optional)" class="settings-input" style="width:130px;" />
              <button class="btn secondary" data-act="save-gateway" ${ViewData.busyAction ? "disabled" : ""}>Save</button>
              <div class="status-badge">
                <i class="dot" style="width:7px;height:7px;background:${ViewData.gatewayState === "online" ? "#3B82F6" : "#94A3B8"};box-shadow:0 0 8px ${ViewData.gatewayState === "online" ? "#3B82F6" : "transparent"}"></i>
                <span style="font-size:11px;color:${ViewData.gatewayState === "online" ? "#60A5FA" : "var(--dim-2)"};">${esc(ViewData.gatewayState[0].toUpperCase() + ViewData.gatewayState.slice(1))}</span>
              </div>
            </div>
            <div style="margin-top:6px;font-size:10px;opacity:0.7;">
              Agents run locally whether or not the gateway is reachable.
            </div>
            ${ViewData.error ? `<div class="inline-error">${esc(ViewData.error)}</div>` : ""}
          </div>

          <!-- Preferences, one per row: side-by-side at island widths reads as
               cramped, and toggle titles get truncated. -->
          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-title">Disable Mascot Actions</div>
              <div class="settings-toggle-sub">Stops clicks on Zeus from poking</div>
            </div>
            <button class="switch ${isPokingDisabled ? "on" : ""}" data-act="toggle-poking" title="Toggle mascot poking"></button>
          </div>
          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-title">Sound Effects</div>
              <div class="settings-toggle-sub">Audio cues on state change</div>
            </div>
            <button class="switch ${isSoundOn ? "on" : ""}" data-act="toggle-sound-switch" title="Toggle sound"></button>
          </div>
          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-title">System Notifications</div>
              <div class="settings-toggle-sub">Windows toast when a task finishes or needs you</div>
            </div>
            <button class="switch ${ViewData.notificationsOn ? "on" : ""}" data-act="toggle-notifications" title="Toggle system notifications"></button>
          </div>

          <!-- Runtimes, with the capabilities this machine actually has. -->
          <div class="settings-section">
            <div class="settings-label">Agent Runtimes</div>
            <div class="agent-runtime-grid" style="margin-top:6px;">
              ${
                ViewData.runtimes.length === 0
                  ? '<div class="agent-runtime-card"><span class="runtime-status">No runtimes detected</span></div>'
                  : ViewData.runtimes
                      .map((entry) => {
                        const managed = entry.managed;
                        const caps = managed
                          ? managed.available
                          : entry.observed
                            ? ["observe", "toolEvents"]
                            : [];
                        const title = `${entry.info.label}: ${caps.join(", ") || "none"}`;
                        return `
              <div class="agent-runtime-card" title="${esc(title)}">
                <span class="runtime-icon" style="color:${colorForProject(entry.info.id)};">${svg(getAgentIcon(entry.info.id), 14).outerHTML}</span>
                <span class="runtime-name">${esc(entry.info.label)}</span>
              </div>`;
                      })
                      .join("")
              }
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

export function renderCompactContent(): string {
  const f = ViewData.focus ?? (ViewData.sessions.length > 0 ? ViewData.sessions[0] : null);
  if (!f) {
    return `
      <div class="compact-telemetry">
        <span class="compact-dot-blue"></span>
        <span class="compact-idle-label">Zeus</span>
      </div>`;
  }

  const working = ViewData.sessions.filter((s) => s.status === "working").length;
  const isWaiting = f.status === "waiting";
  const isApproval = f.last_event === "permission.requested";
  const isInput = f.last_event === "input.requested";
  const isDone = f.status === "completed";
  const icon = getAgentIcon(f.runtime);
  const text = f.message || f.status || "Active";

  if (isWaiting) {
    return `
      <div class="compact-telemetry">
        <span class="compact-badge-icon" style="color:#F5A524;">
          ${svg(icon, 13).outerHTML}
        </span>
        <span class="compact-text" title="${esc(f.message || '')}"><b>${esc(f.runtime)}</b>: ${esc(text)}</span>
        ${isApproval ? `<div class="compact-actions">
          <button class="compact-btn approve" data-act="approve" title="Allow action">Allow</button>
          <button class="compact-btn deny" data-act="deny" title="Deny action">Deny</button>
        </div>` : isInput ? `<div class="compact-actions">
          <button class="compact-btn approve" data-act="open-question" title="Answer agent">Answer</button>
        </div>` : ""}
      </div>
    `;
  }

  if (isDone) {
    return `
      <div class="compact-telemetry">
        <span class="compact-badge-icon" style="color:#22C55E;">
          ${svg(ICONS.check, 13).outerHTML}
        </span>
        <span class="compact-text"><b>${esc(f.runtime)}</b> finished</span>
      </div>
    `;
  }

  // Working: the pulse is what tells you at a glance that an agent is alive;
  // a static dot reads as idle.
  return `
    <div class="compact-telemetry">
      <span class="compact-pulse"></span>
      <span class="compact-badge-icon" style="color:#3B82F6;">
        ${svg(icon, 13).outerHTML}
      </span>
      <span class="compact-text" title="${esc(f.message || '')}"><b>${esc(f.runtime)}</b>: ${esc(text)}</span>
      ${working > 1 ? `<span class="compact-count">${working}</span>` : ""}
    </div>
  `;
}

export function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]!,
  );
}
