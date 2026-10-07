// The launcher: pick a runtime, describe the task, choose where it works.
//
// The task field is the point of this view, so it gets a real multi-line box and
// the most legible type here — it is the only thing the user cannot read back
// once the agent has started. The runtime row and the path row frame it.

import { colorForProject } from "../zeus/frames";
import { getAgentIcon, ICONS } from "./icons";
import { svg } from "./dom";
import { ViewData, esc } from "./state";

export function renderLauncherView(): string {
  const installed = ViewData.runtimes.filter(
    (e) => e.managed && e.managed.installed && e.managed.available.includes("launch"),
  );
  const chosen = ViewData.launchRuntime
    ? installed.find((e) => e.info.id === ViewData.launchRuntime)
    : undefined;

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
            installed.length === 0
              ? `<div class="launcher-empty">No managed runtime with launch support is installed. Zeus can still watch an agent you start yourself — open Activity once it is running.</div>`
              : `<div class="launcher-grid">${installed
                  .map((entry) => {
                    const color = colorForProject(entry.info.id);
                    const isChosen = ViewData.launchRuntime === entry.info.id;
                    return `<button class="launcher-card ${isChosen ? "chosen" : ""}" data-act="choose-runtime" data-runtime="${esc(entry.info.id)}" title="Launch ${esc(entry.info.label)}">
                      <span class="runtime-icon" style="color:${color}">${svg(getAgentIcon(entry.info.id), 15).outerHTML}</span>
                      <span class="runtime-name">${esc(entry.info.label)}</span>
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
                <input id="launch-cwd" class="chat-input launcher-cwd" type="text" value="${esc(ViewData.launchCwd)}" placeholder="Pick the folder the agent works in" autocomplete="off" />
                <!-- The path is long and Windows-shaped, so typing it is the slow
                     path and the easy way to launch into the wrong tree. This
                     opens the native picker; the field stays editable because a
                     value typed before a browse must not be lost. -->
                <button class="launcher-browse" data-act="pick-cwd" title="Browse for a folder" aria-label="Browse for a folder">
                  ${svg(ICONS.folderOpen, 14).outerHTML}
                </button>
              </div>
            </label>
            <button class="btn primary launcher-launch" data-act="launch-session" title="Launch agent" ${ViewData.busyAction || installed.length === 0 ? "disabled" : ""}>
              ${ViewData.busyAction === "launch" ? "Launching…" : "Launch"}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}