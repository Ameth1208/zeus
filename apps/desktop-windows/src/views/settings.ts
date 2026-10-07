// Preferences and the runtime inventory. One row per question the panel can
// answer: is this on, where does it point, what can Zeus drive.

import { colorForProject } from "../zeus/frames";
import { getAgentIcon } from "./icons";
import { svg } from "./dom";
import { ViewData, esc } from "./state";

export function renderSettingsView(): string {
  const isPokingDisabled = ViewData.disablePoking;
  const isSoundOn = ViewData.soundOn;

  return `
    <div class="view on">
      <div class="card">
        <div class="settings-container">
          <!-- Settings has no mascot (botDiameter: 0 in the layout), so it uses
               the whole island and scrolls if it ever outgrows the card. -->
          <div class="settings-scroll">
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

          <!-- Runtimes. This section answers one question per row: is the CLI
               on this machine, and if so what may Zeus do with it? It used to
               render the capabilities into a tooltip, which meant the answer
               was invisible until someone happened to hover. -->
          <div class="settings-section">
            <div class="settings-label">Agent Runtimes</div>
            <div class="settings-hint">
              What Zeus can drive here. A runtime you start yourself is still
              watched — it just cannot be launched, stopped or messaged.
            </div>
            <div class="agent-runtime-grid" style="margin-top:6px;">
              ${
                ViewData.runtimes.length === 0
                  ? '<div class="agent-runtime-card"><span class="runtime-status">No runtimes detected</span></div>'
                  : ViewData.runtimes
                      .map((entry) => {
                        const managed = entry.managed;
                        const installed = !!managed?.installed;
                        const caps = managed ? managed.available : entry.observed ? ["observe"] : [];
                        // What Zeus may actually do, not what the CLI offers.
                        // A runtime that can be launched but not stopped gets a
                        // launch claim and no stop claim — `can()` gates every
                        // control on exactly this list.
                        const verbs: string[] = [];
                        if (caps.includes("launch")) verbs.push("launch");
                        if (caps.includes("send")) verbs.push("message");
                        if (caps.includes("interrupt")) verbs.push("interrupt");
                        if (caps.includes("stop")) verbs.push("stop");
                        if (!verbs.length && entry.observed) verbs.push("watch");
                        const state = !installed ? "Not installed" : verbs.join(" · ") || "Watch only";
                        const tone = !installed ? "missing" : verbs.length ? "ready" : "observe";
                        return `
              <div class="agent-runtime-card runtime-${tone}" title="${esc(`${entry.info.label}: ${state}`)}">
                <span class="runtime-icon" style="color:${colorForProject(entry.info.id)};">${svg(getAgentIcon(entry.info.id), 14).outerHTML}</span>
                <span class="runtime-info">
                  <span class="runtime-name">${esc(entry.info.label)}</span>
                  <span class="runtime-status">${esc(state)}</span>
                </span>
              </div>`;
                      })
                      .join("")
              }
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>`;
}
