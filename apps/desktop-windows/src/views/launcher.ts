// The launcher: pick a runtime, describe the task, choose where it works.
//
// The task field is the point of this view, so it gets a real multi-line box and
// the most legible type here — it is the only thing the user cannot read back
// once the agent has started. The runtime row and the path row frame it.

import { getAgentIcon, ICONS, runtimeColor } from "./icons";
import { svg } from "./dom";
import { ViewData, esc } from "./state";

export function renderLauncherView(): string {
  // Every runtime present on this machine, not only the ones Zeus can drive.
  // Filtering on `managed` silently hid OpenCode from someone whose only CLI is
  // OpenCode — the list said "no runtime installed" while the CLI sat right
  // there on PATH. A runtime Zeus cannot launch is still shown, marked, so the
  // absence is explained instead of implied.
  const present = ViewData.runtimes.filter((e) => e.installed);
  const launchable = present.filter(
    (e) => e.managed && e.managed.available.includes("launch"),
  );
  const chosen = ViewData.launchRuntime
    ? present.find((e) => e.info.id === ViewData.launchRuntime)
    : undefined;
  // Gate the button on the *selected* runtime, not on whether any runtime can be
  // launched. A watch-only runtime can be present and still be selected, and the
  // Launch button used to stay enabled against it — producing an error about a
  // runtime after the fact rather than preventing it.
  const canLaunchNow = !!chosen && !!chosen.managed?.available.includes("launch");

  return `
    <div class="view on">
      <div class="card">
        <div class="launcher-body">
          <div class="launcher-heading">
            <span>Launch an agent</span>
            <span class="launcher-heading-sub">${
              chosen
                ? `New ${esc(chosen.info.label)} session`
                : "Pick a runtime to enable Launch"
            }</span>
          </div>
          ${
            present.length === 0
              ? `<div class="launcher-empty">No agent CLI found on this machine. Install one and reopen this tab — Zeus detects it from your PATH.</div>`
              : `<div class="launcher-grid">${present
                  .map((entry) => {
                    // Brand colour from the runtime registry, never the project
                    // palette: OpenCode and Antigravity collided on the same
                    // blue when this went through `colorForProject`.
                    const color = runtimeColor(entry.info.id);
                    const canLaunch = !!entry.managed?.available.includes("launch");
                    const isChosen = ViewData.launchRuntime === entry.info.id;
                    const verbs = entry.managed?.available ?? [];
                    const caption = canLaunch
                      ? verbs.join(" · ")
                      : "Watch only — start it yourself";
                    return `<button class="launcher-card${canLaunch ? "" : " watch-only"}${isChosen ? " chosen" : ""}" data-act="choose-runtime" data-runtime="${esc(entry.info.id)}" ${canLaunch ? "" : 'title="Zeus cannot launch this runtime — it is watched once it reports"'}>
                      <span class="runtime-icon" style="color:${color}">${svg(getAgentIcon(entry.info.id), 15).outerHTML}</span>
                      <span class="runtime-name">
                        <span class="runtime-label">${esc(entry.info.label)}</span>
                        <span class="runtime-caps">${esc(caption)}</span>
                      </span>
                    </button>`;
                  })
                  .join("")}</div>`
          }

          <!-- The task is the whole point of this view, so it gets a real
               multi-line field rather than a single-line input squeezed
               beside the path. A one-line box invites a four-word
               instruction; a prompt needs room for a sentence and a path to a
               file, and it is the only part of this view that has to be read
               back carefully before a process starts. -->
          <div class="launcher-task">
            <label class="launcher-task-label" for="launch-prompt">Task for the agent</label>
            <textarea id="launch-prompt" class="launcher-task-input" rows="4"
              placeholder="Describe what the agent should do. This is handed to the runtime as its opening instruction, so include the files or behaviour you care about."></textarea>
          </div>

          <div class="launcher-run">
            <label class="launcher-field">
              <span class="launcher-field-label" for="launch-cwd">Working directory</span>
              <div class="launcher-cwd-row">
                <input id="launch-cwd" class="chat-input launcher-cwd" type="text" value="${esc(ViewData.launchCwd)}" placeholder="Choose the folder the agent works in" autocomplete="off" />
              </div>
            </label>
            <!-- Labelled, not just an icon. The picker is the primary way to set
                 this — a Windows path is long and easy to mistype, and the icon
                 alone left the control unidentifiable. -->
            <button class="btn secondary launcher-open" data-act="pick-cwd" title="Choose the folder the agent works in">
              ${svg(ICONS.folderOpen, 13).outerHTML}
              <span>Open Folder</span>
            </button>
            <button class="btn primary launcher-launch" data-act="launch-session" title="Launch agent" ${ViewData.busyAction || !canLaunchNow ? "disabled" : ""}>
              ${ViewData.busyAction === "launch" ? "Launching…" : "Launch"}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}