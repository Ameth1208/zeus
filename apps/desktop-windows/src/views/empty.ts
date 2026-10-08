// No sessions yet. Also the fallback for approval and overview when their
// session list is empty, which is why it lives in its own module.

import { markSvg, brandColor } from "./runtime-marks";
import { svg } from "./dom";
import { ViewData, esc } from "./state";

export function renderEmptyView(): string {
  const cards =
    ViewData.runtimes.length > 0
      ? ViewData.runtimes
          .map((entry) => {
            const id = entry.info.id;
            // Runtime brand colour, not a project hash — see `runtimeColor`.
            const color = brandColor(id);
            // `entry.installed`, which the host answers for every runtime
            // including observed-only ones. Reading `managed?.installed` made
            // OpenCode look absent purely because Zeus cannot drive it.
            const installed = entry.installed;
            return `<button class="empty-agent" ${installed ? `data-act="choose-runtime" data-runtime="${esc(id)}"` : "disabled"}
              style="${installed ? "" : "opacity:0.45;cursor:default;"}" title="${esc(entry.info.label)}${installed ? "" : " — not installed"}">
              <span class="empty-agent-mark">${markSvg(id, 20, `e${id}`)}</span>
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
