// The launcher: describe the task, pick a runtime, choose where it works.
//
// The task field is the point of this view, so it is the biggest thing in it:
// a full-width box at the top, with the decision row (agent · folder · go)
// underneath where the eye lands after writing. Errors render in the view —
// they used to be written to ViewData.error and shown only in Settings, which
// made a refused launch look like a button that did nothing.

import { ICONS } from "./icons";
import { markSvg, brandColor } from "./runtime-marks";
import { svg } from "./dom";
import { ViewData, esc } from "./state";
import type { Session } from "../zeus/frames";

export function renderLauncherView(): string {
  // Every runtime present on this machine, not only the ones Zeus can drive.
  // Filtering on `managed` silently hid OpenCode from someone whose only CLI is
  // OpenCode — the list said "no runtime installed" while the CLI sat right
  // there on PATH. A runtime Zeus cannot launch is still shown, marked, so the
  // absence is explained instead of implied.
  const present = ViewData.runtimes.filter((e) => e.installed);
  const chosen = ViewData.launchRuntime
    ? present.find((e) => e.info.id === ViewData.launchRuntime)
    : undefined;
  // Gate the button on the *selected* runtime, not on whether any runtime can be
  // launched. A watch-only runtime can be present and still be selected, and the
  // Launch button used to stay enabled against it — producing an error about a
  // runtime after the fact rather than preventing it.
  const canLaunchNow = !!chosen && !!chosen.managed?.available.includes("launch");

  // A picked target turns the button from Launch into Send: the task goes to
  // an agent that is already working instead of starting a new session.
  const targets = workingTargets();
  if (ViewData.launchTarget && !targets.some((s) => s.id === ViewData.launchTarget)) {
    // The session ended since the last render; a dead target would make Send
    // look like it ignored the click.
    ViewData.launchTarget = null;
  }
  const target = ViewData.launchTarget
    ? targets.find((s) => s.id === ViewData.launchTarget)
    : undefined;

  return `
    <div class="view on">
      <div class="card">
        <!-- Drop target. Dropping a folder sets where the agent works; dropping
             a file sets its folder and names the file by its full path in the
             task. It is the same two fields the form asks for, so the drop is a
             shortcut rather than a different feature — which is why the form
             stays editable after one. -->
        <div class="launcher-body${ViewData.dropActive ? " drop-active" : ""}" data-drop="cwd">
          ${
            ViewData.dropActive
              ? `<div class="launcher-drop-hint">Drop to set the working folder</div>`
              : ""
          }
          <div class="launcher-heading">
            <span>${target ? "Direct a working agent" : "Launch an agent"}</span>
            <span class="launcher-heading-sub">${
              target
                ? `Order for ${esc(target.project || target.runtime || "session")}`
                : chosen
                  ? `New ${esc(chosen.info.label)} session`
                  : "No agent selected"
            }</span>
          </div>

          ${renderWorkingTargets(targets)}

          ${
            present.length === 0
              ? `<div class="launcher-empty">No agent CLI found on this machine. Install one and reopen this tab — Zeus detects it from your PATH.</div>`
              : ""
          }

          <!-- The task is the largest thing in the view on purpose. It is the
               only field whose contents the user cannot see once the agent
               starts, so it gets the most room and the most legible type. -->
          <textarea id="launch-prompt" class="launcher-task-input" rows="4"
            placeholder="${target ? "What should it do next?" : "What should the agent do?&#10;&#10;Drop a file here to name it by its full path."}"
            aria-label="Task for the agent">${esc(ViewData.launchPrompt)}</textarea>

          ${ViewData.error ? `<div class="inline-error launcher-error">${esc(ViewData.error)}</div>` : ""}

          <!-- The decision row: what runs, where, and go. The agent picker is
               first because it is the choice that arms the Launch button. -->
          <div class="launcher-footer">
            <button class="launcher-picker${chosen ? "" : " empty"}" data-act="toggle-runtime-menu"
              aria-haspopup="true" aria-expanded="${ViewData.runtimeMenuOpen}"
              title="Choose which agent to launch">
              ${
                chosen
                  ? `<span class="launcher-picker-mark">${markSvg(chosen.info.id, 18, "pick")}</span>
                     <span class="launcher-picker-name">${esc(chosen.info.label)}</span>`
                  : `<span class="launcher-picker-name dim">Choose an agent</span>`
              }
              <span class="launcher-picker-chevron">${svg(ICONS.chevronLeft, 11).outerHTML}</span>
            </button>

            <input id="launch-cwd" class="launcher-cwd" type="text" value="${esc(ViewData.launchCwd)}" placeholder="Working directory — drop a folder here, or browse" autocomplete="off" aria-label="Working directory" />

            <button class="launcher-browse" data-act="pick-cwd" title="Choose the folder the agent works in" aria-label="Open Folder">
              ${svg(ICONS.folderOpen, 14).outerHTML}
            </button>

            <button class="btn primary launcher-launch" data-act="launch-session" title="${target ? "Send the task to the working session" : "Launch agent"}" ${ViewData.busyAction || (!target && !canLaunchNow) ? "disabled" : ""}>
              ${ViewData.busyAction === "launch" ? "Launching…"
                : ViewData.busyAction === "send" ? "Sending…"
                : target ? "Send"
                : `Launch${chosen ? ` ${esc(chosen.info.label)}` : ""}`}
            </button>
          </div>

          ${
            ViewData.runtimeMenuOpen
              ? `<div class="runtime-menu" role="menu" aria-label="Installed agents">
            <div class="runtime-menu-grid">
            ${present
              .map((entry) => {
                const canLaunch = !!entry.managed?.available.includes("launch");
                const isChosen = ViewData.launchRuntime === entry.info.id;
                return `
              <button class="runtime-tile${canLaunch ? "" : " watch-only"}${isChosen ? " chosen" : ""}"
                style="--tile-accent:${brandColor(entry.info.id)}"
                data-act="choose-runtime" data-runtime="${esc(entry.info.id)}" role="menuitem"
                title="${canLaunch ? `Launch ${esc(entry.info.label)}` : `${esc(entry.info.label)} — watch only, start it yourself`}"
                ${canLaunch ? "" : "disabled"}>
                <span class="runtime-tile-mark">${markSvg(entry.info.id, 26, `m${entry.info.id}`)}</span>
                <span class="runtime-tile-name">${esc(entry.info.label)}</span>
                ${isChosen ? `<span class="runtime-tile-tick">${svg(ICONS.check, 12).outerHTML}</span>` : ""}
              </button>`;
              })
              .join("")}
            </div>
          </div>`
              : ""
          }

          ${
            ViewData.launchPrompt.trim() === "" && ViewData.launchCwd.trim() === ""
              ? `<div class="launcher-hint">Pick an agent, say what to do, and drop in the folder it should work in. Ctrl+Enter launches.</div>`
              : ""
          }
        </div>
      </div>
    </div>`;
}

/** Live sessions that can take an order right now. A runtime only advertises
 *  `send` when Zeus can actually deliver input to it — observed runtimes
 *  (OpenCode via hooks) never appear here, because a chip that cannot deliver
 *  is worse than no chip. */
function workingTargets(): Session[] {
  return ViewData.sessions.filter(
    (s) =>
      s.live &&
      s.capabilities.includes("send") &&
      (s.status === "working" || s.status === "waiting"),
  );
}

/** The "already working" row. Picking a chip retargets the task field and the
 *  button to that session; picking it again clears the target and the view is
 *  a launcher once more. */
function renderWorkingTargets(targets: Session[]): string {
  if (targets.length === 0) return "";
  return `
    <div class="launcher-targets">
      <span class="launcher-targets-label">Already working</span>
      ${targets
        .map(
          (s) => `
        <button class="launcher-target${ViewData.launchTarget === s.id ? " on" : ""}"
          data-act="launch-target" data-id="${esc(s.id)}"
          title="Send the task to ${esc(s.project || s.runtime || "this session")} instead of launching a new one">
          ${markSvg(s.runtime || "agent", 13, `t${s.id}`)}
          <span>${esc(s.project || s.runtime || "session")}</span>
        </button>`,
        )
        .join("")}
    </div>`;
}
