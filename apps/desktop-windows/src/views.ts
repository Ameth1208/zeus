// Views layer — Coucou layout and components for desktop agents.
// Integrates Antigravity, Claude Code, Codex, and OpenCode with live Ticker and approvals.

import type { IslandViewName } from "./island/layout";
import type { Session } from "./zeus/frames";
import { colorForProject, describeEvent } from "./zeus/frames";
import { ICONS, getAgentIcon } from "./views/icons";
import { svg } from "./views/dom";
import { Ticker } from "./views/ticker";

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
  activeView: "overview" as IslandViewName,
  state: "idle",
  paired: false,
  soundOn: true,
  disablePoking: localStorage.getItem("zeus_disable_poking") === "true",
  autoCloseSec: parseInt(localStorage.getItem("zeus_autoclose") || "15", 10),
  gatewayUrl: localStorage.getItem("zeus_gateway_url") || "http://127.0.0.1:8080",
  gatewayToken: localStorage.getItem("zeus_gateway_token") || "local-dev",
  error: "",
  events: [] as EventItem[],
  ticker: new Ticker(),
};

export function renderHeader(activeView: IslandViewName, soundEnabled: boolean): string {
  return `
    <div id="header">
      <div class="tabs">
        <button class="tab ${activeView === "overview" || activeView === "empty" ? "on" : ""}" data-nav="overview" title="Agents Overview">
          ${svg(ICONS.house, 13).outerHTML}
          <span style="font-size:11px;font-weight:600;margin-left:4px;">Agents</span>
        </button>
        <button class="tab ${activeView === "prompt" ? "on" : ""}" data-nav="prompt" title="Live Activity Stream">
          ${svg(ICONS.bolt, 12).outerHTML}
          <span style="font-size:11px;font-weight:600;margin-left:4px;">Activity</span>
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
    case "empty":
      return renderEmptyView();
    case "prompt":
      return renderPromptView();
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
  const runtimeLabel = f.runtime || "Antigravity";
  const projectLabel = f.project || "Active Workspace";
  const model = f.model || "default";
  const isWaiting = f.status === "waiting";
  const tool = f.capabilities?.find((c) => c.startsWith("tool:"))?.slice(5) || "";

  const others = ViewData.sessions.filter((s) => s.id !== f.id).slice(0, 4);

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
                <!-- Ticker mounted here -->
                <div id="ticker-mount" style="margin-top:auto;"></div>
              </div>

              <div class="work-actions-row">
                ${
                  isWaiting
                    ? `
                  <button class="btn primary" data-act="approve" style="background:#3B82F6;padding:4px 12px;font-size:11px;">Allow (Y)</button>
                  <button class="btn secondary" data-act="deny" style="padding:4px 12px;font-size:11px;">Deny (N)</button>
                `
                    : `
                  <button class="btn secondary" data-act="stop-agent" style="padding:4px 10px;font-size:10.5px;">Stop Agent</button>
                  <button class="btn secondary" data-act="sync-sessions" style="padding:4px 10px;font-size:10.5px;margin-left:auto;">Sync</button>
                `
                }
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="right">
        <div class="card">
          <div class="pills">
            ${
              others.length > 0
                ? others.map((s) => renderPill(s)).join("")
                : renderDefaultAgentPills()
            }
          </div>
        </div>
      </div>
    </div>`;
}

function renderPill(s: Session): string {
  const color = colorForProject(s.project);
  const isWaiting = s.status === "waiting";
  const isFinished = s.status === "finished";
  const sid = s.id || "";
  const runtime = s.runtime || s.project || "Agent";

  return `
    <div class="pill" data-act="focus-session" data-id="${esc(sid)}" style="border-color:${color}33" title="Focus ${esc(runtime)}">
      <span style="color:${color}; display:flex; align-items:center; margin-left:8px; flex:0 0 auto;">
        ${svg(getAgentIcon(runtime), 12).outerHTML}
      </span>
      <span class="lbl">${esc(runtime)}</span>
      ${
        isWaiting
          ? `<div class="pill-badge"><i style="background:#F5A524">${svg(ICONS.bang, 6).outerHTML}</i></div>`
          : isFinished
          ? `<div class="pill-badge"><i style="background:#38BDF8">${svg(ICONS.check, 6).outerHTML}</i></div>`
          : ""
      }
    </div>`;
}

function renderDefaultAgentPills(): string {
  const agents = [
    { name: "Antigravity", runtime: "Antigravity", color: "#3B82F6" },
    { name: "Claude Code", runtime: "Claude", color: "#F5A524" },
    { name: "Codex", runtime: "Codex", color: "#38BDF8" },
    { name: "OpenCode", runtime: "OpenCode", color: "#818CF8" },
  ];

  return agents
    .map(
      (a) => `
    <div class="pill" style="border-color:${a.color}28" title="${a.name} agent runtime">
      <span style="color:${a.color}; display:flex; align-items:center; margin-left:8px; flex:0 0 auto;">
        ${svg(getAgentIcon(a.runtime), 12).outerHTML}
      </span>
      <span class="lbl">${a.name}</span>
    </div>`,
    )
    .join("");
}

function renderApprovalView(): string {
  const f = ViewData.focus ?? (ViewData.sessions.length > 0 ? ViewData.sessions[0] : null);
  const color = f ? colorForProject(f.project) : "#F5A524";
  const agentName = f ? f.runtime || f.project || "Coding Agent" : "Coding Agent";
  const command = f?.message || f?.last_event || "Executing command in terminal";

  return `
    <div class="view on">
      <div class="card wash" style="--wash: rgba(245, 165, 36, 0.35);">
        <div class="stack" style="padding: 4px 16px 4px 116px;">
          <div class="who-row">
            <i class="dot" style="width:8px;height:8px;background:${color}"></i>
            <span class="n">${esc(agentName)}</span>
            <span>needs permission</span>
          </div>
          <div class="code">${esc(command)}</div>
          <div class="actions">
            <button class="btn secondary" data-act="deny">
              <span>Deny</span>
              <span class="kbd">N</span>
            </button>
            <button class="btn primary" data-act="approve" style="background:#3B82F6;">
              <span>Allow</span>
              <span class="kbd">Y</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderEmptyView(): string {
  return `
    <div class="view on">
      <div class="card" style="height: 100%; border-color: rgba(59, 130, 246, 0.2);">
        <div class="agent-discovery-container">
          <div class="discovery-header">
            <div class="radar-dot"></div>
            <div class="discovery-title">Zeus Control Plane</div>
            <div class="discovery-status">${ViewData.paired ? "Gateway Online · Monitoring Agents" : "Connecting Gateway..."}</div>
          </div>
          <div class="agent-runtime-grid">
            <div class="agent-runtime-card" title="Google Antigravity Agent">
              <span class="runtime-icon" style="color:#3B82F6;">${svg(ICONS.antigravity, 16).outerHTML}</span>
              <div class="runtime-info">
                <span class="runtime-name">Antigravity</span>
                <span class="runtime-status">Ready · Hook Active</span>
              </div>
            </div>
            <div class="agent-runtime-card" title="Anthropic Claude Code">
              <span class="runtime-icon" style="color:#F5A524;">${svg(ICONS.claude, 16).outerHTML}</span>
              <div class="runtime-info">
                <span class="runtime-name">Claude Code</span>
                <span class="runtime-status">Ready · CLI Hook</span>
              </div>
            </div>
            <div class="agent-runtime-card" title="OpenAI Codex">
              <span class="runtime-icon" style="color:#38BDF8;">${svg(ICONS.codex, 16).outerHTML}</span>
              <div class="runtime-info">
                <span class="runtime-name">Codex</span>
                <span class="runtime-status">Ready · Agent Hook</span>
              </div>
            </div>
            <div class="agent-runtime-card" title="OpenCode">
              <span class="runtime-icon" style="color:#818CF8;">${svg(ICONS.opencode, 16).outerHTML}</span>
              <div class="runtime-info">
                <span class="runtime-name">OpenCode</span>
                <span class="runtime-status">Ready · Adapter</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderPromptView(): string {
  const events = ViewData.events.slice(-12).reverse();

  return `
    <div class="view on">
      <div class="card cli-card">
        <div class="activity-feed-container">
          <div class="activity-header">
            <span>Agent Telemetry & Tool Activity Stream</span>
            <span style="font-size:10px;font-weight:400;color:var(--dim-3);">${ViewData.sessions.length} active agent(s)</span>
          </div>

          <div class="activity-list">
            ${
              events.length > 0
                ? events
                    .map(
                      (ev) => `
                <div class="activity-item">
                  <span class="activity-time">${esc(ev.time)}</span>
                  <span style="display:flex;align-items:center;color:#3B82F6;">
                    ${svg(getAgentIcon(ev.runtime), 11).outerHTML}
                  </span>
                  <span class="activity-badge">${esc(ev.type)}</span>
                  <span class="activity-desc">${esc(ev.message || ev.tool || ev.command || "Executing...")}</span>
                </div>
              `,
                    )
                    .join("")
                : `
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--dim-3);font-size:11px;">
                <div class="compact-dot-blue" style="width:8px;height:8px;"></div>
                <span>Waiting for agent events from Zeus Gateway...</span>
              </div>
            `
            }
          </div>
        </div>
      </div>
    </div>`;
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
              <button class="btn ${ViewData.paired ? "secondary" : "primary"}" data-act="connect-gateway">
                ${ViewData.paired ? "Reconnect" : "Connect"}
              </button>
              <div class="status-badge">
                <i class="dot" style="width:7px;height:7px;background:${ViewData.paired ? "#3B82F6" : "#94A3B8"};box-shadow:0 0 8px ${ViewData.paired ? "#3B82F6" : "transparent"}"></i>
                <span style="font-size:11px;color:${ViewData.paired ? "#60A5FA" : "var(--dim-2)"};">${ViewData.paired ? "Online" : "Offline"}</span>
              </div>
            </div>
          </div>

          <!-- Preferences row -->
          <div class="settings-field-row" style="justify-content: space-between; gap: 16px;">
            <div class="settings-toggle-row" style="flex:1;">
              <div>
                <div class="settings-toggle-title">Disable Mascot Actions</div>
                <div class="settings-toggle-sub">Stops clicks on Zeus from poking</div>
              </div>
              <button class="switch ${isPokingDisabled ? "on" : ""}" data-act="toggle-poking" title="Toggle mascot poking"></button>
            </div>

            <div class="settings-toggle-row" style="flex:1;">
              <div>
                <div class="settings-toggle-title">Sound Effects</div>
                <div class="settings-toggle-sub">Audio cues on state change</div>
              </div>
              <button class="switch ${isSoundOn ? "on" : ""}" data-act="toggle-sound-switch" title="Toggle sound"></button>
            </div>
          </div>

          <!-- Connected Runtimes info -->
          <div class="settings-section">
            <div class="settings-label">Supported Agent Runtimes</div>
            <div class="agent-runtime-grid" style="margin-top:6px;">
              <div class="agent-runtime-card">
                <span class="runtime-icon" style="color:#3B82F6;">${svg(ICONS.antigravity, 14).outerHTML}</span>
                <span class="runtime-name">Antigravity</span>
              </div>
              <div class="agent-runtime-card">
                <span class="runtime-icon" style="color:#F5A524;">${svg(ICONS.claude, 14).outerHTML}</span>
                <span class="runtime-name">Claude Code</span>
              </div>
              <div class="agent-runtime-card">
                <span class="runtime-icon" style="color:#38BDF8;">${svg(ICONS.codex, 14).outerHTML}</span>
                <span class="runtime-name">Codex</span>
              </div>
              <div class="agent-runtime-card">
                <span class="runtime-icon" style="color:#818CF8;">${svg(ICONS.opencode, 14).outerHTML}</span>
                <span class="runtime-name">OpenCode</span>
              </div>
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
        <span class="compact-idle-label">Zeus Agent Control Plane</span>
      </div>`;
  }

  const isWaiting = f.status === "waiting";
  const icon = getAgentIcon(f.runtime);
  const text = f.message || f.last_event || "Active";

  if (isWaiting) {
    return `
      <div class="compact-telemetry">
        <span class="compact-badge-icon" style="color:#F5A524;">
          ${svg(icon, 13).outerHTML}
        </span>
        <span class="compact-text" title="${esc(f.message || '')}"><b>${esc(f.runtime)}</b>: ${esc(text)}</span>
        <div class="compact-actions">
          <button class="compact-btn approve" data-act="approve" title="Allow action">Allow</button>
          <button class="compact-btn deny" data-act="deny" title="Deny action">Deny</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="compact-telemetry">
      <span class="compact-badge-icon" style="color:#3B82F6;">
        ${svg(icon, 13).outerHTML}
      </span>
      <span class="compact-text" title="${esc(f.message || '')}"><b>${esc(f.runtime)}</b>: ${esc(text)}</span>
      <span class="compact-dot-working"></span>
    </div>
  `;
}

export function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]!,
  );
}
