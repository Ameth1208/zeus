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
import { ViewData, renderHeader, renderViewContent, renderCompactContent } from "./views";
import { uiStateForSessions, frameFor, describeEvent, type Session } from "./zeus/frames";
import { Sound } from "./core/sound";
import * as zeus from "./engine/client";

function diag(msg: string): void {
  void zeus.logDiag(msg);
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
  compactContentEl.innerHTML = renderCompactContent();
  contentEl.innerHTML = `
    ${renderHeader(island.view, Sound.isEnabled)}
    <div id="views">
      ${renderViewContent(island.view)}
    </div>`;

  const tickerMount = document.querySelector<HTMLElement>("#ticker-mount");
  if (tickerMount) {
    tickerMount.append(ViewData.ticker.el);
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
    case "toggle-sound":
    case "toggle-sound-switch": {
      const next = !Sound.isEnabled;
      Sound.setEnabled(next);
      ViewData.soundOn = next;
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
      ViewData.error = "";
      island.setView("launcher");
      render();
      window.setTimeout(() => document.querySelector<HTMLInputElement>("#launch-cwd")?.focus(), 0);
      return;
    }
    case "open-question": {
      island.fsm.pinned = true;
      island.setView("question");
      render();
      window.setTimeout(() => document.querySelector<HTMLInputElement>("#question-answer")?.focus(), 0);
      return;
    }
    case "launch-session": {
      const runtime = document.querySelector<HTMLSelectElement>("#launch-runtime")?.value.trim() ?? "";
      const cwd = document.querySelector<HTMLInputElement>("#launch-cwd")?.value.trim() ?? "";
      const prompt = document.querySelector<HTMLInputElement>("#launch-prompt")?.value.trim() ?? "";
      if (!runtime || !cwd) {
        ViewData.error = "Choose an installed runtime and a working folder.";
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
      const input = document.querySelector<HTMLInputElement>("#session-message");
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
      await decidePending(true);
      return;
    case "deny":
      Sound.play("deny");
      await decidePending(false);
      return;
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
async function decidePending(allow: boolean): Promise<void> {
  const request = ViewData.pending[0];
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

// ── keyboard ──────────────────────────────────────────────────────────────────

window.addEventListener("keydown", (e) => {
  const activeInput = document.activeElement as HTMLInputElement | null;
  if (activeInput && activeInput.tagName === "INPUT") {
    if (e.key === "Enter" && activeInput.id === "launch-prompt") {
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-act="launch-session"]')?.click();
      return;
    }
    if (e.key === "Enter" && activeInput.id === "session-message") {
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
  ViewData.events.push({
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
    command: typeof event.payload.command === "string" ? event.payload.command : undefined,
  });
  if (ViewData.events.length > 50) ViewData.events.shift();

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
