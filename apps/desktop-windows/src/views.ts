// View content. Each view is pure HTML; the container handles the cross-fade
// and the shared-element layout table decides where the mascot sits.

import type { IslandView } from "./island/layout";
import type { Session } from "./zeus/frames";
import { colorForProject, describeEvent } from "./zeus/frames";
import type { IslandDeps } from "./island";

/** Populated by main.ts so the views can read live session data. */
export const ViewData = {
  sessions: [] as Session[],
  focus: null as Session | null,
  state: "idle" as string,
  paired: false,
  error: "",
};

/** A persistent control strip. The island has no window decorations and no
 *  taskbar entry, so without these there is no way to fold it away or to quit
 *  from the UI at all. */
function renderControls(): string {
  return `
    <div class="controls">
      <button class="icon-btn" data-act="hide" title="Hide island">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round"><path d="M2 4.5 L6 8 L10 4.5"/></svg>
      </button>
      <button class="icon-btn" data-act="quit" title="Quit Zeus">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round"><path d="M3.2 3.2 L8.8 8.8 M8.8 3.2 L3.2 8.8"/></svg>
      </button>
    </div>`;
}

export function renderView(view: IslandView, deps: IslandDeps): string {
  const body = !ViewData.paired
    ? renderPair()
    : view === "empty"
    ? renderEmpty()
    : view === "overview"
    ? renderOverview(deps)
    : renderAgentColumn(view, deps);
  return `${body}${renderControls()}`;
}

function renderEmpty(): string {
  return `
    <div class="head">
      <div class="head-text">
        <div class="title">Watching your agents</div>
        <div class="sub">Start Codex, Claude Code, Antigravity or another Zeus adapter.</div>
      </div>
    </div>`;
}

function renderOverview(deps: IslandDeps): string {
  const others = ViewData.sessions.filter((s) => s.id !== ViewData.focus?.id).slice(0, 6);
  return `
    ${renderHead()}
    ${others.length ? `<div class="pills">${others.map(pill).join("")}</div>` : ""}`;
}

function renderHead(): string {
  const f = ViewData.focus;
  if (!f) return "";
  return `
    <div class="head">
      <div class="head-text">
        <div class="title">${esc(f.project ?? f.runtime)}</div>
        <div class="sub">${esc([f.runtime, f.model].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="ticker">${esc(describeEvent(f))}</div>
    </div>`;
}

/** Alert views: the focused agent gets the full column with its actions. */
function renderAgentColumn(view: IslandView, deps: IslandDeps): string {
  const f = ViewData.focus;
  if (!f) return renderEmpty();
  const needsApproval = f.status === "waiting";
  return `
    ${renderHead()}
    <div class="column">
      ${needsApproval ? renderActions(f, deps) : ""}
    </div>`;
}

function renderActions(s: Session, deps: IslandDeps): string {
  const can = new Set(s.capabilities ?? []);
  const allow = can.has("approve") || s.status === "waiting";
  const deny = can.has("deny") || s.status === "waiting";
  if (!allow && !deny) return "";
  return `
    <div class="actions">
      ${deny ? `<button class="btn" data-act="deny" data-id="${esc(s.id)}">Deny</button>` : ""}
      ${allow ? `<button class="btn primary" data-act="approve" data-id="${esc(s.id)}">Allow</button>` : ""}
    </div>`;
}

function pill(s: Session): string {
  const color = colorForProject(s.project);
  return `
    <span class="pill" style="--c:${color}">
      <i class="dot" style="background:${color}"></i>
      ${esc(s.project ?? s.runtime)}
    </span>`;
}

function renderPair(): string {
  return `
    <div class="pair">
      <div class="head-text">
        <div class="title">Pair Zeus</div>
        <div class="sub">Connect this desktop to your Gateway.</div>
      </div>
      <input id="gateway" placeholder="https://your-gateway" spellcheck="false"/>
      <input id="code" inputmode="numeric" maxlength="6" placeholder="6-digit code"/>
      <button class="btn primary" id="pair">Pair desktop</button>
      ${ViewData.error ? `<div class="err">${esc(ViewData.error)}</div>` : ""}
    </div>`;
}

export function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]!,
  );
}
