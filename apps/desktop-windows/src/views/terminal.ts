// The two terminal views. One shape, two outcomes.

import { ViewData, esc } from "./state";

/** The terminal views share a shape: a wash card, the outcome, and the next
 *  move. `finished` offers continuing the session; `error` explains the
 *  failure. Both unpin on dismiss. */
export function renderTerminalView(success: boolean): string {
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
