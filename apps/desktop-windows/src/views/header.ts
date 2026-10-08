// The island chrome: tabs, identity, and the overflow menu.
//
// Lives outside the view modules because it is not a view — it persists across
// every one of them, and the FSM re-renders it on navigation rather than
// replacing it.

import type { IslandViewName } from "../island/layout";
import { ViewData } from "./state";
import { ICONS } from "./icons";
import { svg } from "./dom";

export function renderHeader(activeView: IslandViewName): string {
  return `
    <div id="header">
      <div class="tabs">
        <button class="tab icon-only ${activeView === "overview" || activeView === "empty" || activeView === "session" ? "on" : ""}" data-nav="overview" title="Agents" aria-label="Agents">
          ${svg(ICONS.house, 15).outerHTML}
        </button>
        <button class="tab icon-only ${activeView === "prompt" ? "on" : ""}" data-nav="prompt" title="Activity" aria-label="Activity">
          ${svg(ICONS.bolt, 14).outerHTML}
        </button>
        <button class="tab icon-only ${activeView === "launcher" ? "on" : ""}" data-nav="launcher"  title="Launch an agent" aria-label="Launch an agent">
          ${svg(ICONS.plus, 14).outerHTML}
        </button>
        <button class="tab icon-only ${activeView === "media" ? "on" : ""}" data-nav="media" title="Music" aria-label="Music">
          ${svg(ICONS.music, 14).outerHTML}
        </button>
      </div>
      <div class="identity">
        <span class="identity-name">Zeus</span>
      </div>
      <div class="header-actions">
        <!-- One overflow control instead of two loose buttons. Sound is a
             preference that rarely changes; Settings is a destination that
             rarely gets opened. Neither earns permanent header space on a
             720px panel. -->
        <button class="tab icon-only" data-act="toggle-menu" title="More" aria-label="More" aria-haspopup="true" aria-expanded="${ViewData.menuOpen}">
          ${svg(ICONS.ellipsis, 14).outerHTML}
        </button>
      </div>
    </div>
    ${ViewData.menuOpen ? renderOverflowMenu(ViewData.soundOn, ViewData.hostState === "offline") : ""}`;
}

/** Rendered by `renderHeader`, anchored under the ellipsis. `Hide the island`
 *  only appears while the host is unreachable: it is the one action a user in
 *  that state is likely to want, and it keeps the menu from being decorative. */
function renderOverflowMenu(soundEnabled: boolean, offline: boolean): string {
  return `
    <div class="overflow-menu" role="menu">
      <button class="overflow-item" data-nav="settings" role="menuitem">
        ${svg(ICONS.gear, 13).outerHTML}
        <span>Settings</span>
      </button>
      <button class="overflow-item" data-act="toggle-sound" role="menuitem">
        ${svg(soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 13).outerHTML}
        <span>${soundEnabled ? "Mute" : "Unmute"}</span>
      </button>
      ${
        offline
          ? `<div class="overflow-sep" role="separator"></div>
      <button class="overflow-item danger" data-act="force-hide" role="menuitem">
        ${svg(ICONS.xmark, 13).outerHTML}
        <span>Hide the island</span>
      </button>`
          : ""
      }
    </div>`;
}