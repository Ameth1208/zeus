// The transport. Three fixed columns — art, description, transport — with the
// progress bar inside the description column so it tracks the text above it.

import { ICONS } from "./icons";
import { svg } from "./dom";
import { ViewData, esc, fmtClock } from "./state";

/** Now-playing and transport, straight from the host's media session. Layout
 *  follows the classic player: cover left, everything else in a centered
 *  column — text, transport, progress. */
export function renderMediaView(): string {
  const media = ViewData.media;
  const pct =
    media.duration_secs > 0
      ? Math.min(100, (media.position_secs / media.duration_secs) * 100)
      : 0;
  const noTrack = !media.available || !media.title;

return `
    <div class="view on">
      <div class="card">
        <div class="media-body">
          ${
            media.thumbnail
              ? `<img class="media-cover-lg" src="${media.thumbnail}" alt="" />`
              : `<span class="media-note-lg">${svg(ICONS.music, 22).outerHTML}</span>`
          }
          <!-- Three fixed columns: art, description, transport. The description
               column is the only one that flexes, and the progress bar lives
               inside it directly under the title — so the bar tracks the same
               text it describes instead of stretching across the whole panel
               below the buttons. -->
          <div class="media-info">
            <div class="media-text">
              <div class="media-title">${esc(noTrack ? "Nothing playing" : media.title)}</div>
              <div class="media-artist">${esc(
                noTrack
                  ? "Start music on this PC and it shows up here"
                  : [media.artist, media.album].filter(Boolean).join(" — ") || "Unknown artist",
              )}</div>
            </div>
            ${
              !noTrack && media.duration_secs > 0
                ? `
            <div class="media-progress">
              <span class="media-progress-time">${fmtClock(media.position_secs)}</span>
              <div class="media-progress-track">
                <div class="media-progress-fill${media.playing ? " live" : ""}" style="width:${pct.toFixed(1)}%"></div>
              </div>
              <span class="media-progress-time">${fmtClock(media.duration_secs)}</span>
            </div>`
                : ""
            }
          </div>
          <div class="media-controls">
            <button class="media-btn" data-act="media-previous" title="Previous" ${media.available ? "" : "disabled"}>
              ${svg(ICONS.skipBack, 16).outerHTML}
            </button>
            <button class="media-btn primary" data-act="media-playpause" title="${media.playing ? "Pause" : "Play"}" ${media.available ? "" : "disabled"}>
              ${svg(media.playing ? ICONS.pause : ICONS.play, 18).outerHTML}
            </button>
            <button class="media-btn" data-act="media-next" title="Next" ${media.available ? "" : "disabled"}>
              ${svg(ICONS.skipForward, 16).outerHTML}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}
