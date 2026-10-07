// The bar shown when the island is collapsed. This is the only view that can
// render an approval, because a blocked agent has to be answerable without
// expanding the panel.

import { getAgentIcon } from "./icons";
import { ICONS } from "./icons";
import { svg } from "./dom";
import { ViewData, esc } from "./state";

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
