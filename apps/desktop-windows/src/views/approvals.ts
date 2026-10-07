// Permission and question views. Both are "an agent is blocked on you": they
// read the same pending request and differ only in what they offer.

import { colorForProject } from "../zeus/frames";
import { ICONS } from "./icons";
import { svg } from "./dom";
import { ViewData, esc } from "./state";
import { renderEmptyView } from "./empty";

export function renderApprovalView(): string {
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

export function renderQuestionView(): string {
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
