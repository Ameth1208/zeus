// Island bootstrap.
//
// The webview's whole job: build the shell, hand the island its DOM, and render
// whatever the engine reports. It owns no process, no socket and no store, which
// is why hiding the island or reloading this page cannot disturb a running agent.
//
// What changed from the gateway-polling version: the data source is now local.
// `engine_sessions` reads the machine's own store, so the island works with no
// network, and remote approval arrives as a relayed command instead of a poll.

import "./styles.css";
import { Island } from "./island";
import { ViewData, renderHeader, renderViewContent, renderCompactContent, refocusIfIdle } from "./views";
import type { EventItem } from "./views/state";
import { uiStateForSessions, frameFor, describeEvent, type Session } from "./zeus/frames";
import { Sound } from "./core/sound";
import * as zeus from "./engine/client";
import { open } from "@tauri-apps/plugin-dialog";

function diag(msg: string): void {
  void zeus.logDiag(msg);
}

/** One engine event as the views keep it. Shared by the live bus handler and
 *  the per-session history fetch so both produce the same shape. */
function toEventItem(event: zeus.ZeusEvent): EventItem {
  return {
    id: event.event_id,
    time: new Date(event.time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    session_id: event.session_id,
    agent_id: event.session_id,
    runtime: event.runtime,
    type: event.kind,
    message: typeof event.payload.text === "string" ? event.payload.text : undefined,
    tool: typeof event.payload.tool === "string" ? event.payload.tool : undefined,
    path: typeof event.payload.path === "string" ? event.payload.path : undefined,
    line: typeof event.payload.line === "number" ? event.payload.line : undefined,
    change: typeof event.payload.change === "string" ? event.payload.change : undefined,
    command: typeof event.payload.command === "string" ? event.payload.command : undefined,
  };
}

window.addEventListener("error", (e) => diag(`ERROR ${e.message} @${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => diag(`REJECT ${String(e.reason)}`));

ViewData.soundOn = Sound.isEnabled;
void zeus.getNotificationsEnabled()
  .then((enabled) => { ViewData.notificationsOn = enabled; })
  .catch((err) => diag(`notifications pref load failed: ${String(err)}`));

// Build the island DOM shell. Unchanged from the original layout: the visual
// design is not affected by where the data comes from.
const root = document.querySelector<HTMLDivElement>("#app") || document.body;
root.innerHTML = `
  <div id="wake-strip"></div>
  <div id="island">
    <div id="island-clip">
      <div id="compact-content"></div>
      <div id="content"></div>
    </div>
    <canvas id="bot-canvas"></canvas>
    <div id="countdown"></div>
  </div>`;

const wakeStripEl = document.querySelector<HTMLElement>("#wake-strip")!;
const islandEl = document.querySelector<HTMLElement>("#island")!;
const clipEl = document.querySelector<HTMLElement>("#island-clip")!;
const compactContentEl = document.querySelector<HTMLElement>("#compact-content")!;
const contentEl = document.querySelector<HTMLElement>("#content")!;
const countdownEl = document.querySelector<HTMLElement>("#countdown")!;
const botCanvasEl = document.querySelector<HTMLCanvasElement>("#bot-canvas")!;

const island = new Island({
  root,
  wakeStrip: wakeStripEl,
  island: islandEl,
  clip: clipEl,
  compactContent: compactContentEl,
  botCanvas: botCanvasEl,
  content: contentEl,
  countdown: countdownEl,
  onPushRect: (rect) => {
    void zeus.setIslandRect(rect).catch((err) => diag(`set rect failed: ${String(err)}`));
  },
  onViewChange: (view) => {
    ViewData.activeView = view;
    render();
  },
});

diag(`island booted mode=${island.mode} view=${island.view}`);

function render(): void {
  // Snapshot the focused field before the rebuild. innerHTML replacement
  // destroys the node, and with the 4 s heartbeat plus live engine events a
  // field that loses focus and value mid-keystroke reads as "the input won't
  // type" — which is exactly the failure this snapshot exists to prevent.
  const focused = document.activeElement;
  const keep =
    (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) && focused.id
      ? { id: focused.id, value: focused.value, start: focused.selectionStart, end: focused.selectionEnd }
      : null;

  // The rebuild also resets the work log's scroll. Keep the reader's position,
  // except when they were already at the bottom: pinned to the tail is what
  // makes the log feel live, since render() runs on every engine event.
  const prevOutput = contentEl.querySelector<HTMLElement>(".work-output");
  const pinnedToTail = prevOutput
    ? prevOutput.scrollHeight - prevOutput.scrollTop - prevOutput.clientHeight < 40
    : true;
  const prevScrollTop = prevOutput?.scrollTop ?? 0;

  compactContentEl.innerHTML = renderCompactContent();
  contentEl.innerHTML = `
    ${renderHeader(island.view)}
    <div id="views">
      ${renderViewContent(island.view)}
    </div>`;

  if (keep) {
    const el = document.getElementById(keep.id);
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.disabled) {
      // Launcher fields are rebuilt from ViewData, which is already current;
      // the composers are not bound to the model at all, so their typed text
      // only survives the rebuild if it is put back here.
      if (el.value !== keep.value) el.value = keep.value;
      el.focus({ preventScroll: true });
      try {
        el.setSelectionRange(keep.start ?? keep.value.length, keep.end ?? keep.value.length);
      } catch {
        // Input types without selectable text reject setSelectionRange; a
        // failed caret restore must not take the render down with it.
      }
    }
  }

  const tickerMount = document.querySelector<HTMLElement>("#ticker-mount");
  if (tickerMount) {
    tickerMount.append(ViewData.ticker.el);
  }

  const workOutput = document.querySelector<HTMLElement>(".work-output");
  if (workOutput) {
    workOutput.scrollTop = pinnedToTail ? workOutput.scrollHeight : prevScrollTop;
  }
}

let tickerFrame: number | null = null;

// The ticker owns a frame only while it is visibly moving. A static island must
// not keep the webview's compositor awake.
function kickTicker(): void {
  if (tickerFrame != null || island.mode !== "expanded" || island.view !== "overview") return;
  tickerFrame = requestAnimationFrame(tickTicker);
}

function tickTicker(now: number): void {
  tickerFrame = null;
  if (island.mode !== "expanded" || island.view !== "overview") return;
  ViewData.ticker.tick(now);
  if (ViewData.ticker.animating) tickerFrame = requestAnimationFrame(tickTicker);
}

// The drop listeners go on the island root, not on the zone: the zone element is
// replaced on every render, so a listener attached to it would die with the
// first re-render and the drop target would stop working silently.
wireDropTarget(islandEl);

render();

void zeus.loadCredentials().then((credentials) => {
  if (!credentials) return;
  ViewData.gatewayUrl = credentials.gateway;
  ViewData.gatewayToken = credentials.token;
  return zeus.configureGateway(credentials).then(refreshGatewayStatus);
}).catch((err) => diag(`load credentials failed: ${String(err)}`));

async function refreshGatewayStatus(): Promise<void> {
  const status = await zeus.gatewayStatus();
  ViewData.gatewayState = status.state;
  syncMascotAndTicker();
  render();
}

/** Opens the native folder picker and remembers the choice for the launcher.
 *
 *  The result is written to `localStorage` because the working directory is a
 *  preference about where this user works, not per-session state: launching a
 *  second agent should default to the same tree without re-picking it.
 *
 *  Re-render is skipped on purpose. `render()` rebuilds the whole header and
 *  views, which would steal focus from the field mid-edit; the input keeps its
 *  value because only the model changed, and the caret stays where it was. */
async function pickWorkingDirectory(): Promise<void> {
  try {
    const picked = await open({ directory: true, multiple: false, title: "Where should the agent work?" });
    if (typeof picked !== "string" || !picked.trim()) return;
    ViewData.launchCwd = picked;
    localStorage.setItem("zeus_launch_cwd", picked);
    const field = document.querySelector<HTMLInputElement>("#launch-cwd");
    if (field) {
      field.value = picked;
      field.focus();
    }
    diag(`launch cwd set to ${picked}`);
  } catch (err) {
    // A cancelled dialog throws on some platforms and resolves null on others;
    // both are a non-event, so neither surfaces as an error.
    diag(`pick cwd failed: ${String(err)}`);
  }
}

/** Now-playing only matters while the media view is on screen. */
async function refreshMedia(): Promise<void> {
  try {
    ViewData.media = await zeus.mediaNowPlaying();
    render();
  } catch (err) {
    diag(`media poll failed: ${String(err)}`);
  }
}

// Clicking the island while compact expands it. Controls handle their own
// clicks; everything else is a hit on the mascot or the bar.
islandEl.addEventListener("mousedown", (e) => {
  const t = e.target as HTMLElement;

  if (t.closest("button, input, textarea, select, a, .pill, .switch, .seg, .compact-btn, .cli-cmd-pill, .cli-run-btn, .cli-agent-badge")) {
    void zeus.focusWindow();
    return;
  }

  if (island.mode === "compact") {
    island.expand("overview");
    void zeus.focusWindow();
  }
});

// Windows drops keyboard focus onto the panel whenever an input is used.
document.addEventListener("focusin", (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
    void zeus.focusWindow();
  }
});

// ── data ──────────────────────────────────────────────────────────────────────

/** Pulls the local snapshot. Cheap enough to call on every event. */
async function refresh(): Promise<void> {
  try {
    const [sessions, pending, gateway] = await Promise.all([
      zeus.sessions(),
      zeus.pending(),
      zeus.gatewayStatus(),
    ]);
    ViewData.sessions = sessions as Session[];
    ViewData.pending = pending;
    ViewData.gatewayState = gateway.state;
    ViewData.runtimes = await zeus.runtimes();
    ViewData.hostState = "online";
    if (ViewData.focus) {
      const updated = ViewData.sessions.find((s) => s.id === ViewData.focus?.id);
      if (updated) ViewData.focus = updated;
    } else if (ViewData.sessions.length > 0) {
      ViewData.focus = ViewData.sessions[0];
    }
    // The focused session's history from the engine store. `ViewData.events`
    // only knows what arrived live since boot, so without this read the work
    // panel's changed-files list is empty after every reload. The store read
    // is local and cheap, so it rides the 4s heartbeat like everything else.
    if (ViewData.focus) {
      const focusId = ViewData.focus.id;
      const rows = await zeus.events(focusId, 60);
      // A focus switch while the read was in flight must not let the old
      // session's history land under the new session's name.
      if (ViewData.focus?.id === focusId) {
        ViewData.focusEvents = rows.map(toEventItem);
        ViewData.focusEventsFor = focusId;
      }
    } else {
      ViewData.focusEvents = [];
      ViewData.focusEventsFor = "";
    }
    syncMascotAndTicker();
    if (island.view === "media") void refreshMedia();
    render();
  } catch (err) {
    // The engine being unreachable means the host is gone; the island should say
    // so rather than pretending everything is idle.
    diag(`refresh failed: ${String(err)}`);
    ViewData.hostState = "offline";
    island.setBotState("interrupted");
    render();
  }
}

/**
 * One mascot for the whole island, so the state is the most urgent thing across
 * every session rather than only the focused one.
 */
let lastPinnedRequest = "";

/** The `session.id:last_seq` of the terminal event the island already pinned
 *  for. Without this guard the 4s refresh would re-pin a finished view after
 *  the user dismissed it. */
let lastTerminalKey = "";

function terminalSession(status: string): Session | undefined {
  return ViewData.sessions.find((s) => s.status === status);
}

function syncMascotAndTicker(): void {
  const state = uiStateForSessions(ViewData.sessions as Session[]);
  // With nothing demanding attention, a dead gateway link is the most useful
  // thing the mascot can say: sessions keep running, but the phone is blind.
  const displayState =
    state === "idle" && ViewData.gatewayState === "offline" ? "disconnected" : state;
  island.setBotState(frameFor(displayState));

  if (state === "waitingApproval") {
    const request = ViewData.pending[0];
    ViewData.focus =
      ViewData.sessions.find((session) => session.id === request?.session_id) ?? ViewData.focus;
    // Expand on entry, not on refresh: a repeat tick must not re-pin the island
    // after the user has already chosen to hide it.
    if (lastPinnedRequest !== (request?.request_id ?? "")) {
      lastPinnedRequest = request?.request_id ?? "";
      island.fsm.pinned = true;
      island.setView("approval");
    }
  } else if (state === "waitingInput") {
    ViewData.focus = ViewData.sessions.find((session) => session.last_event === "input.requested") ?? ViewData.focus;
    island.fsm.pinned = true;
    island.setView("question");
  } else if (state === "success" || state === "error") {
    // A finished or failed session is the reason the island exists: pin it once
    // per terminal event so the outcome is seen even away from the screen.
    const session = terminalSession(state === "success" ? "completed" : "failed");
    const key = session ? `${session.id}:${session.last_seq}` : "";
    if (session && key !== lastTerminalKey) {
      lastTerminalKey = key;
      ViewData.focus = session;
      island.fsm.pinned = true;
      island.setView(state === "success" ? "finished" : "error");
    }
  } else if (island.fsm.view === "approval" || island.fsm.view === "question") {
    island.fsm.pinned = false;
    island.setView("overview");
  }

  // Only once the terminal view has had its moment. The pin above deliberately
  // holds focus on the finished session so the outcome is readable; moving on
  // immediately would defeat that, so the hand-off happens on the way back to
  // the overview instead of at the moment of completion.
  refocusIfIdle();

  const focus = ViewData.focus;
  if (!focus) {
    ViewData.ticker.sync(["Zeus is watching your agent CLIs"], 0);
    return;
  }

  const tool = focus.capabilities.find((c) => c.startsWith("tool:"))?.slice(5);
  ViewData.ticker.sync(
    [
      describeEvent(focus),
      focus.message || `Status: ${focus.status}`,
      tool ? `Tool: ${tool}` : focus.mode === "observed" ? "Observed via hooks" : "Watching workspace",
    ].filter(Boolean),
    0,
  );
  kickTicker();
}

// ── actions ───────────────────────────────────────────────────────────────────

document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;

  const navBtn = t.closest<HTMLElement>("[data-nav]");
  if (navBtn) {
    e.stopPropagation();
    Sound.play("blip");
    // Settings is reachable from the overflow menu, so navigating from there has
    // to dismiss it or it stays open over the view it just opened.
    ViewData.menuOpen = false;
    island.setView(navBtn.dataset.nav as "overview" | "launcher" | "prompt" | "media" | "settings");
    if (navBtn.dataset.nav === "media") void refreshMedia();
    void zeus.focusWindow();
    render();
    return;
  }

  const actBtn = t.closest<HTMLElement>("[data-act]");
  if (!actBtn) return;
  e.stopPropagation();
  const act = actBtn.dataset.act!;

  switch (act) {
    case "cycle-agent": {
      if (ViewData.sessions.length === 0) return;
      const index = ViewData.focus ? ViewData.sessions.findIndex((s) => s.id === ViewData.focus?.id) : -1;
      ViewData.focus = ViewData.sessions[(index + 1) % ViewData.sessions.length];
      Sound.play("blip");
      syncMascotAndTicker();
      render();
      return;
    }
    case "toggle-runtime-menu": {
      ViewData.runtimeMenuOpen = !ViewData.runtimeMenuOpen;
      render();
      return;
    }
    case "pick-cwd": {
      void pickWorkingDirectory();
      return;
    }
    case "toggle-menu": {
      ViewData.menuOpen = !ViewData.menuOpen;
      render();
      return;
    }
    case "force-hide": {
      ViewData.menuOpen = false;
      island.hide();
      render();
      return;
    }
    case "toggle-sound":
    case "toggle-sound-switch": {
      const next = !Sound.isEnabled;
      Sound.setEnabled(next);
      ViewData.soundOn = next;
      // Coming from the overflow menu, the menu closes: the item was an
      // action, and leaving the panel open underneath it looks like it stuck.
      if (actBtn.classList.contains("overflow-item")) ViewData.menuOpen = false;
      Sound.play("blip");
      render();
      return;
    }
    case "toggle-poking": {
      ViewData.disablePoking = !ViewData.disablePoking;
      localStorage.setItem("zeus_disable_poking", String(ViewData.disablePoking));
      Sound.play("blip");
      render();
      return;
    }
    case "toggle-notifications": {
      const next = !ViewData.notificationsOn;
      ViewData.notificationsOn = next;
      await zeus.setNotificationsEnabled(next).catch((err) => diag(`notifications pref failed: ${String(err)}`));
      Sound.play("blip");
      render();
      return;
    }
    case "choose-runtime": {
      ViewData.launchRuntime = actBtn.dataset.runtime ?? "";
      ViewData.runtimeMenuOpen = false;
      ViewData.error = "";
      island.setView("launcher");
      render();
      window.setTimeout(() => document.querySelector<HTMLTextAreaElement>("#launch-prompt")?.focus(), 0);
      return;
    }
    case "open-question": {
      island.fsm.pinned = true;
      island.setView("question");
      render();
      window.setTimeout(() => document.querySelector<HTMLInputElement>("#question-answer")?.focus(), 0);
      return;
    }
    case "launch-target": {
      // Pick which working agent takes the task; picking the same one again
      // clears it and the view is a launcher once more.
      const id = actBtn.dataset.id ?? "";
      ViewData.launchTarget = ViewData.launchTarget === id ? null : id;
      Sound.play("blip");
      render();
      return;
    }
    case "launch-session": {
      const prompt = document.querySelector<HTMLTextAreaElement>("#launch-prompt")?.value.trim() ?? "";

      // A picked target turns Launch into Send: the task goes to the agent
      // that is already working instead of starting a new session.
      const target = ViewData.launchTarget
        ? ViewData.sessions.find((s) => s.id === ViewData.launchTarget)
        : undefined;
      if (target) {
        if (!prompt) return;
        ViewData.busyAction = "send";
        ViewData.error = "";
        render();
        try {
          await zeus.send(target.id, prompt);
          ViewData.launchPrompt = "";
          ViewData.launchTarget = null;
          await refresh();
          ViewData.focus = ViewData.sessions.find((s) => s.id === target.id) ?? target;
          island.setView("session");
          Sound.play("approve");
        } catch (err) {
          ViewData.error = String(err);
          diag(`send to working agent failed: ${String(err)}`);
        } finally {
          ViewData.busyAction = "";
          render();
        }
        return;
      }

      // The runtime comes from ViewData, not from the DOM. There is no
      // `#launch-runtime` element — the runtime is picked with a card button
      // that writes `ViewData.launchRuntime`, so reading a missing select here
      // always yielded an empty string and every launch failed the guard below
      // with a message about a field the user cannot even see.
      const runtime = ViewData.launchRuntime;
      const cwd = document.querySelector<HTMLInputElement>("#launch-cwd")?.value.trim() ?? "";
      if (!runtime || !cwd) {
        ViewData.error = !runtime
          ? "Pick a runtime first."
          : "Set a working folder.";
        render();
        return;
      }
      ViewData.launchRuntime = runtime;
      ViewData.launchCwd = cwd;
      localStorage.setItem("zeus_launch_cwd", cwd);
      ViewData.busyAction = "launch";
      ViewData.error = "";
      render();
      try {
        const sessionId = await zeus.launch(runtime, cwd, prompt || undefined);
        // The prompt was delivered; leaving it in the field made a second
        // launch resend the same task, which reads as the agent ignoring you.
        ViewData.launchPrompt = "";
        await refresh();
        ViewData.focus = ViewData.sessions.find((session) => session.id === sessionId) ?? ViewData.focus;
        island.setView("overview");
        Sound.play("approve");
      } catch (err) {
        ViewData.error = String(err);
        diag(`launch failed: ${String(err)}`);
      } finally {
        ViewData.busyAction = "";
        render();
      }
      return;
    }
    case "send-message": {
      const focus = ViewData.focus;
      // Two composers render this action: the activity feed's and the work
      // panel's. Only one is ever on screen, so either id resolves.
      const input = document.querySelector<HTMLInputElement>("#session-message, #work-message");
      const message = input?.value.trim() ?? "";
      if (!focus?.live || !focus.capabilities.includes("send") || !message) return;
      ViewData.busyAction = "send";
      ViewData.error = "";
      if (input) input.disabled = true;
      try {
        await zeus.send(focus.id, message);
        if (input) input.value = "";
      } catch (err) {
        ViewData.error = String(err);
        diag(`send failed: ${String(err)}`);
      } finally {
        ViewData.busyAction = "";
        await refresh();
      }
      return;
    }
    case "send-answer": {
      const focus = ViewData.focus;
      const input = document.querySelector<HTMLInputElement>("#question-answer");
      const answer = input?.value.trim() ?? "";
      if (!focus?.live || !focus.capabilities.includes("send") || !answer) return;
      ViewData.busyAction = "send";
      ViewData.error = "";
      try {
        await zeus.send(focus.id, answer);
        island.fsm.pinned = false;
        island.setView("overview");
      } catch (err) {
        ViewData.error = String(err);
        diag(`answer failed: ${String(err)}`);
      } finally {
        ViewData.busyAction = "";
        await refresh();
      }
      return;
    }
    case "save-gateway": {
      const gateway = document.querySelector<HTMLInputElement>("#gateway-url-input")?.value.trim() ?? "";
      const token = document.querySelector<HTMLInputElement>("#gateway-token-input")?.value.trim() ?? "";
      if (!gateway) {
        ViewData.error = "Enter the Gateway URL.";
        render();
        return;
      }
      ViewData.busyAction = "save-gateway";
      ViewData.error = "";
      try {
        await zeus.saveCredentials({ gateway, token });
        await zeus.configureGateway({ gateway, token });
        ViewData.gatewayUrl = gateway;
        ViewData.gatewayToken = token;
        localStorage.removeItem("zeus_gateway_token");
        localStorage.setItem("zeus_gateway_url", gateway);
        await refreshGatewayStatus();
        Sound.play("approve");
      } catch (err) {
        ViewData.error = String(err);
        diag(`save gateway failed: ${String(err)}`);
      } finally {
        ViewData.busyAction = "";
        render();
      }
      return;
    }
    case "dismiss-terminal": {
      // Record the dismissal so the refresh loop does not re-pin the same
      // terminal event.
      const session = terminalSession("completed") ?? terminalSession("failed");
      if (session) lastTerminalKey = `${session.id}:${session.last_seq}`;
      island.fsm.pinned = false;
      island.setView("overview");
      render();
      return;
    }
    case "next-task": {
      island.fsm.pinned = true;
      island.setView("prompt");
      render();
      window.setTimeout(() => document.querySelector<HTMLInputElement>("#session-message")?.focus(), 0);
      return;
    }
    case "media-playpause":
    case "media-next":
    case "media-previous": {
      const command =
        act === "media-playpause" ? "play_pause" : act === "media-next" ? "next" : "previous";
      await zeus.mediaControl(command).catch((err) => diag(`media control failed: ${String(err)}`));
      // GSMTC settles asynchronously; give the session a beat before re-reading.
      window.setTimeout(() => void refreshMedia(), 350);
      return;
    }
    case "stop-agent": {
      const focus = ViewData.focus;
      if (!focus) return;
      // Only offered when the runtime can actually be stopped; an observed
      // session has no button at all.
      if (!focus.capabilities.includes("stop")) return;
      await zeus.stop(focus.id).catch((err) => diag(`stop failed: ${String(err)}`));
      await refresh();
      return;
    }
    case "interrupt-agent": {
      const focus = ViewData.focus;
      if (!focus || !focus.capabilities.includes("interrupt")) return;
      await zeus.interrupt(focus.id).catch((err) => diag(`interrupt failed: ${String(err)}`));
      await refresh();
      return;
    }
    case "approve":
      Sound.play("approve");
      await decidePending(true, actBtn.dataset.id);
      return;
    case "deny":
      Sound.play("deny");
      await decidePending(false, actBtn.dataset.id);
      return;
    case "view-session": {
      // Focus the session, then open it full-width: the session view gives the
      // work panel — current file, live log, changes — the island's whole
      // width. The overview's split column answered "what are all my agents
      // doing"; this answers "what is THIS one doing, exactly".
      const found = ViewData.sessions.find((s) => s.id === actBtn.dataset.id);
      if (!found) return;
      ViewData.focus = found;
      island.setView(
        found.status === "waiting"
          ? found.last_event === "input.requested"
            ? "question"
            : "approval"
          : "session",
      );
      Sound.play("blip");
      syncMascotAndTicker();
      render();
      return;
    }
    case "back-to-overview": {
      // Leaving a session view keeps the focus, so the overview's split column
      // still opens on the session the user was just watching instead of
      // snapping back to whichever one happens to be first.
      island.setView("overview");
      Sound.play("blip");
      void zeus.focusWindow();
      render();
      return;
    }
    case "focus-session": {
      const found = ViewData.sessions.find((s) => s.id === actBtn.dataset.id);
      if (found) {
        ViewData.focus = found;
        Sound.play("blip");
        syncMascotAndTicker();
        render();
      }
      return;
    }
    default:
      return;
  }
});

/**
 * Answers the oldest open request. The engine owns validation, so a stale or
 * replayed reply is refused there; the UI only has to not pretend it worked.
 */
async function decidePending(allow: boolean, requestId?: string): Promise<void> {
  // The clicked request, not simply the oldest. The Activity feed now renders
  // one Allow/Deny pair per blocked session, so always taking `pending[0]`
  // meant clicking the second agent's button answered the first agent's
  // question — the worst possible failure mode for an approval UI.
  const request =
    (requestId ? ViewData.pending.find((p) => p.request_id === requestId) : undefined) ??
    ViewData.pending[0];
  if (!request) {
    island.setBotState("idle");
    island.setView("overview");
    render();
    return;
  }
  try {
    await zeus.decide(request.request_id, request.session_id, allow);
  } catch (err) {
    const message = String(err);
    diag(`decision refused: ${message}`);
    ViewData.error = zeus.describeRefusal(message);
  }
  ViewData.pending = ViewData.pending.filter((p) => p.request_id !== request.request_id);
  island.fsm.pinned = false;
  await refresh();
}

/** Drag a file or folder onto the launcher.
 *
 *  This is the fast path for the two things the form asks for. A dropped folder
 *  becomes the working directory outright; a dropped file sets its folder and
 *  names the file in the task, because "work on this" almost always means the
 *  file you just grabbed plus the tree around it.
 *
 *  Both fields stay editable afterwards. The drop is a shortcut, not a mode, and
 *  a value typed before a drop must not be lost.
 *
 *  Tauri exposes the real filesystem path as `.path` on the dropped file. The
 *  fallback exists only so a browser-hosted preview does not throw; without a
 *  path there is nothing to place and the drop is ignored rather than guessed
 *  at from the filename. */
function wireDropTarget(root: HTMLElement): void {
  // Deliberately not caching the zone element. It is rebuilt by every render, so
  // a captured reference would point at a detached node after the first
  // navigation away from the launcher and back. The listeners live on `root`,
  // which survives; the zone is looked up per event.
  const zoneNow = () => root.querySelector<HTMLElement>("[data-drop]");

  const clear = () => {
    if (ViewData.dropActive) {
      ViewData.dropActive = false;
      render();
    }
  };

  root.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    if (!zoneNow()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!ViewData.dropActive) {
      ViewData.dropActive = true;
      render();
    }
  });

  root.addEventListener("dragleave", (e) => {
    const zone = zoneNow();
    if (e.relatedTarget && zone?.contains(e.relatedTarget as Node)) return;
    clear();
  });

  root.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    ViewData.dropActive = false;

    const file = e.dataTransfer.files[0] as File & { path?: string };
    const dropped = file.path;
    if (!dropped) {
      diag("drop ignored: no filesystem path on the dropped item");
      render();
      return;
    }

    const isDir = !/\.[^\/\\]+$/.test(dropped);
    const cwd = isDir ? dropped : dropped.replace(/[\/\\][^\/\\]*$/, "");
    ViewData.launchCwd = cwd;
    localStorage.setItem("zeus_launch_cwd", cwd);

    // A dropped file is named by its full path, not just its name: the agent
    // resolves paths against the working folder, and a bare name is a guess
    // the moment the file sits in a subdirectory. The path is appended to
    // whatever is already written rather than replacing it.
    if (!isDir) {
      const field = document.querySelector<HTMLTextAreaElement>("#launch-prompt");
      if (field) {
        const mention = `Work on ${dropped}`;
        field.value = field.value.trim() ? `${field.value.trim()}\n${mention}` : mention;
        ViewData.launchPrompt = field.value;
      }
    }

    diag(`drop set cwd to ${cwd}`);
    render();
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>("#launch-prompt")?.focus(), 0);
  });
}

// The two fields the launcher owns are bound to `ViewData`, because `render()`
// runs on the 4 s heartbeat and would otherwise replace the DOM out from under
// the user. The prompt is written to the model on `input` without re-rendering:
// re-rendering on every keystroke would move the caret to the end and, on a
// multi-line field, move the view under the cursor.
root.addEventListener("input", (e) => {
  const t = e.target as HTMLElement | null;
  if (t?.id === "launch-prompt") {
    ViewData.launchPrompt = (t as HTMLTextAreaElement).value;
    return;
  }
  if (t?.id === "launch-cwd") {
    ViewData.launchCwd = (t as HTMLInputElement).value;
  }
});

// `change` rather than `input`: a select should not re-render the whole island
// on arrow-key browsing, only on the committed choice.
root.addEventListener("change", (e) => {
  const t = e.target as HTMLSelectElement | null;
  if (t?.id !== "launch-runtime") return;
  ViewData.launchRuntime = t.value;
  ViewData.error = "";
  Sound.play("blip");
  render();
});

// Both menus close on an outside click. Delegated on the document rather than
// per-menu so a re-render cannot leave one stranded open with nothing to close
// it, which is what happened to the header menu before it was given a dismissal.
document.addEventListener("click", (e) => {
  if (!(ViewData.menuOpen || ViewData.runtimeMenuOpen)) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest(".overflow-menu, .runtime-menu")) return;
  if (t?.closest('[data-act="toggle-menu"], [data-act="toggle-runtime-menu"]')) return;
  const had = ViewData.menuOpen || ViewData.runtimeMenuOpen;
  ViewData.menuOpen = false;
  ViewData.runtimeMenuOpen = false;
  if (had) {
    e.stopPropagation();
    render();
  }
});

// ── keyboard ──────────────────────────────────────────────────────────────────

window.addEventListener("keydown", (e) => {
  const activeInput = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const tag = activeInput?.tagName;

  // The task field is a textarea, so bare Enter has to keep inserting a
  // newline — that is what makes it worth having. Launch is on Ctrl+Enter,
  // the same chord every chat surface uses for "send this".
  if (activeInput && tag === "TEXTAREA") {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-act="launch-session"]')?.click();
      return;
    }
    if (e.key === "Escape") activeInput.blur();
    return;
  }

  if (activeInput && tag === "INPUT") {
    if (e.key === "Enter" && (activeInput.id === "session-message" || activeInput.id === "work-message")) {
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-act="send-message"]')?.click();
      return;
    }
    if (e.key === "Enter" && activeInput.id === "question-answer") {
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-act="send-answer"]')?.click();
      return;
    }
    if (e.key === "Enter" && (activeInput.id === "gateway-url-input" || activeInput.id === "gateway-token-input")) {
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-act="save-gateway"]')?.click();
      return;
    }
    if (e.key === "Escape") activeInput.blur();
    return;
  }

  if (island.mode !== "expanded") return;

  if (island.view === "approval") {
    if (e.key === "y" || e.key === "Y" || e.key === "Enter") {
      e.preventDefault();
      Sound.play("approve");
      void decidePending(true);
      return;
    }
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      Sound.play("deny");
      void decidePending(false);
      return;
    }
  }

  if (e.key === "Escape" && !island.fsm.pinned) {
    island.collapse();
  }
});

// ── engine events ─────────────────────────────────────────────────────────────

void zeus.onEvent((event) => {
  const item = toEventItem(event);
  ViewData.events.push(item);
  if (ViewData.events.length > 50) ViewData.events.shift();

  // Keep the focused history in step with the bus so the changed-files list
  // updates between refreshes instead of waiting for the next heartbeat.
  if (ViewData.focus && event.session_id === ViewData.focus.id) {
    ViewData.focusEvents.push(item);
    ViewData.focusEventsFor = ViewData.focus.id;
    if (ViewData.focusEvents.length > 60) ViewData.focusEvents.shift();
  }

  // Track the last kind on the session so the mascot can tell an approval from a
  // question without the UI knowing anything about the runtime.
  const session = ViewData.sessions.find((s) => s.id === event.session_id);
  if (session) {
    session.last_event = event.kind;
    if (typeof event.payload.text === "string" && event.payload.text) {
      session.message = event.payload.text;
    }
  }
  syncMascotAndTicker();
  render();
});

// Ctrl+Shift+Space summons the island. When it is up, the same stroke dismisses
// it fully — Expanded state is "visible", Hidden state is "gone".
void zeus.onHotkey(() => {
  if (island.mode === "expanded" || island.mode === "compact") {
    island.hide();
    return;
  }
  island.expand("overview");
  void zeus.focusWindow();
});

void refresh();
// A slow heartbeat keeps durations and elapsed counters honest without polling
// the engine on every animation frame.
window.setInterval(() => void refresh(), 4000);

// Now-playing has its own heartbeat rather than riding the 4 s engine one.
// GSMTC publishes a new session the moment the user starts music, which is
// rarely a multiple of four seconds, and a one-shot read on tab entry left the
// player stuck on "Nothing playing" until the view was reopened. The interval
// only lives while the media view is on screen: outside it the player is not
// rendered, so asking the host every four seconds forever would be cost with
// nothing to show for it. Aggressive mode is not needed either, because the
// host caches album art by track identity, so a re-read of an unchanged song
// is a cached map lookup rather than a decode.
window.setInterval(() => {
  if (island.view === "media") void refreshMedia();
}, 1500);
