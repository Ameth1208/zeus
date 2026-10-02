import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { Island } from "./island";
import { ViewData, renderHeader, renderViewContent, renderCompactContent } from "./views";
import { colorForProject, describeEvent, type Session } from "./zeus/frames";
import { Sound } from "./core/sound";

type Credentials = { gateway: string; token: string };

function diag(msg: string): void {
  void invoke("log_diag", { msg }).catch(() => {});
}

window.addEventListener("error", (e) => diag(`ERROR ${e.message} @${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => diag(`REJECT ${String(e.reason)}`));

let credentials: Credentials | null = null;
try {
  credentials = await invoke("load_credentials");
  diag(`load_credentials ok paired=${credentials !== null}`);
} catch (e) {
  diag(`load_credentials failed ${String(e)}`);
}

let eventSourceAbort: AbortController | null = null;
let isDemoMode = false;

ViewData.paired = credentials !== null;
ViewData.soundOn = Sound.isEnabled;

// Build Coucou DOM shell
const root = document.querySelector<HTMLDivElement>("#app") || document.body;
root.innerHTML = `
  <div id="wake-strip"></div>
  <div id="island">
    <div id="island-clip">
      <div id="compact-content"></div>
      <div id="content"></div>
    </div>
    <div id="bot-glow"></div>
    <canvas id="bot-canvas"></canvas>
    <div id="countdown"></div>
  </div>`;

const wakeStripEl = document.querySelector<HTMLElement>("#wake-strip")!;
const islandEl = document.querySelector<HTMLElement>("#island")!;
const clipEl = document.querySelector<HTMLElement>("#island-clip")!;
const compactContentEl = document.querySelector<HTMLElement>("#compact-content")!;
const contentEl = document.querySelector<HTMLElement>("#content")!;
const botCanvasEl = document.querySelector<HTMLCanvasElement>("#bot-canvas")!;
const countdownEl = document.querySelector<HTMLElement>("#countdown")!;

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
    void invoke("set_island_rect", { rect }).catch((err) => {
      diag(`set_island_rect err: ${String(err)}`);
    });
  },
  onViewChange: (view) => {
    ViewData.activeView = view;
    render();
  },
});

diag(`island booted mode=${island.mode} view=${island.view}`);

// Render views into #content
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

// Tick loop for ticker animations
function loop(now: number): void {
  if (island.mode === "expanded" && island.view === "overview") {
    ViewData.ticker.tick(now);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

render();

// Clicking island when compact expands it
islandEl.addEventListener("mousedown", (e) => {
  const me = e as MouseEvent;
  const t = me.target as HTMLElement;

  // Let interactive controls handle their own clicks
  if (t.closest("button, input, textarea, select, a, .pill, .switch, .seg, .compact-btn, .cli-cmd-pill, .cli-run-btn, .cli-agent-badge")) {
    void invoke("focus_window").catch(() => {});
    return;
  }

  // If in compact mode, clicking anywhere (on Zeus avatar or the bar) immediately opens the island!
  if (island.mode === "compact") {
    island.expand("overview");
    void invoke("focus_window").catch(() => {});
    return;
  }
});

// Ensure transparent window has Windows OS keyboard focus whenever inputs are interacted with
document.addEventListener("focusin", (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
    void invoke("focus_window").catch(() => {});
  }
});

// Event delegation for actions and navigation
document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;

  // Quick CLI command buttons
  const cmdBtn = t.closest<HTMLElement>("[data-cmd]");
  if (cmdBtn) {
    e.stopPropagation();
    const cmd = cmdBtn.dataset.cmd!;
    const input = document.querySelector<HTMLInputElement>("#prompt-input");
    if (input) {
      if (cmd === "status") input.value = "git status && agy status";
      else if (cmd === "test") input.value = "run tests and report failures";
      else if (cmd === "review") input.value = "review recent diffs and security risks";
      input.focus();
    }
    return;
  }

  // View navigation tabs
  const navBtn = t.closest<HTMLElement>("[data-nav]");
  if (navBtn) {
    e.stopPropagation();
    const nav = navBtn.dataset.nav as "overview" | "prompt" | "settings";
    Sound.play("blip");
    island.setView(nav);
    void invoke("focus_window").catch(() => {});
    render();
    return;
  }

  // Action buttons and switches
  const actBtn = t.closest<HTMLElement>("[data-act]");
  if (actBtn) {
    e.stopPropagation();
    const act = actBtn.dataset.act!;

    if (act === "cycle-agent") {
      if (ViewData.sessions.length === 0) return;
      const curIdx = ViewData.focus ? ViewData.sessions.findIndex((s) => s.id === ViewData.focus?.id) : -1;
      const nextIdx = (curIdx + 1) % ViewData.sessions.length;
      ViewData.focus = ViewData.sessions[nextIdx];
      Sound.play("blip");
      syncMascotAndTicker();
      render();
      return;
    }

    if (act === "toggle-sound" || act === "toggle-sound-switch") {
      const next = !Sound.isEnabled;
      Sound.setEnabled(next);
      ViewData.soundOn = next;
      Sound.play("blip");
      render();
      return;
    }

    if (act === "toggle-poking") {
      ViewData.disablePoking = !ViewData.disablePoking;
      localStorage.setItem("zeus_disable_poking", String(ViewData.disablePoking));
      Sound.play("blip");
      render();
      return;
    }

    if (act === "connect-gateway") {
      const input = document.querySelector<HTMLInputElement>("#gateway-url-input");
      const tokenInput = document.querySelector<HTMLInputElement>("#gateway-token-input");
      const gw = input?.value.trim() || "http://127.0.0.1:8080";
      const token = tokenInput?.value.trim() || ViewData.gatewayToken || "local-dev";
      ViewData.gatewayUrl = gw;
      ViewData.gatewayToken = token;
      localStorage.setItem("zeus_gateway_url", gw);
      localStorage.setItem("zeus_gateway_token", token);
      void connectToGateway(gw, token);
      return;
    }

    if (act === "sync-sessions") {
      if (credentials) void fetchSessions(credentials.gateway, credentials.token);
      Sound.play("blip");
      return;
    }

    if (act === "stop-agent") {
      const f = ViewData.focus;
      if (f && credentials) {
        const gw = credentials.gateway.replace(/\/+$/, "");
        void fetch(`${gw}/v1/actions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credentials.token}`,
          },
          body: JSON.stringify({
            session_id: f.id,
            agent_id: f.agent_id,
            kind: "stop",
          }),
        }).catch(() => {});
        f.status = "stopped";
        syncMascotAndTicker();
        render();
      }
      return;
    }

    if (act === "approve") {
      Sound.play("approve");
      handleDecision(true);
      return;
    }

    if (act === "deny") {
      Sound.play("deny");
      handleDecision(false);
      return;
    }

    if (act === "focus-session") {
      const id = actBtn.dataset.id;
      const s = ViewData.sessions.find((x) => x.id === id);
      if (s) {
        ViewData.focus = s;
        Sound.play("blip");
        syncMascotAndTicker();
        render();
      }
      return;
    }
  }

  // Quick connect button
  if (t.id === "btn-quick-connect") {
    const input = document.querySelector<HTMLInputElement>("#gateway-url-input") ||
      document.querySelector<HTMLInputElement>("#gateway-url");
    const gw = input?.value || "http://127.0.0.1:8080";
    connectToGateway(gw);
    return;
  }
});

// Keyboard shortcuts: Y/Enter allow, N deny, Esc collapse, Enter in inputs
window.addEventListener("keydown", (e) => {
  const activeInput = document.activeElement as HTMLInputElement | null;
  if (activeInput && activeInput.tagName === "INPUT") {
    if (e.key === "Enter") {
      if (activeInput.id === "gateway-url-input" || activeInput.id === "gateway-token-input") {
        e.preventDefault();
        const gwInput = document.querySelector<HTMLInputElement>("#gateway-url-input");
        const tokenInput = document.querySelector<HTMLInputElement>("#gateway-token-input");
        const gw = gwInput?.value.trim() || "http://127.0.0.1:8080";
        const token = tokenInput?.value.trim() || ViewData.gatewayToken || "local-dev";
        ViewData.gatewayUrl = gw;
        ViewData.gatewayToken = token;
        localStorage.setItem("zeus_gateway_url", gw);
        localStorage.setItem("zeus_gateway_token", token);
        void connectToGateway(gw, token);
        return;
      }
    }
    if (e.key === "Escape") {
      activeInput.blur();
      return;
    }
  }

  if (island.mode === "expanded") {
    if (island.view === "approval") {
      if (e.key === "y" || e.key === "Y" || e.key === "Enter") {
        e.preventDefault();
        Sound.play("approve");
        handleDecision(true);
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        Sound.play("deny");
        handleDecision(false);
        return;
      }
    }
    if (e.key === "Escape" && !island.fsm.pinned) {
      island.collapse();
    }
  }
});

function handleDecision(allow: boolean): void {
  const f = ViewData.focus;
  if (!f) {
    island.setView("overview");
    return;
  }

  if (credentials) {
    const cred = credentials;
    const gw = cred.gateway.replace(/\/+$/, "");
    void fetch(`${gw}/v1/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cred.token}`,
      },
      body: JSON.stringify({
        session_id: f.id,
        agent_id: f.agent_id,
        kind: allow ? "approve" : "deny",
        payload: {
          request_id: f.pending_request_id || "",
        },
      }),
    })
      .catch(() => {
        return fetch(`${gw}/api/sessions/${f.id}/permission`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cred.token}`,
          },
          body: JSON.stringify({ decision: allow ? "allow" : "deny" }),
        });
      })
      .catch((err) => diag(`decision post error: ${String(err)}`));
  }

  f.status = allow ? "working" : "idle";
  island.fsm.pinned = false;
  island.setBotState(allow ? "working" : "idle");
  syncMascotAndTicker();
  island.setView("overview");
  render();
}

function syncMascotAndTicker(): void {
  const f = ViewData.focus ?? (ViewData.sessions.length > 0 ? ViewData.sessions[0] : null);
  if (!f) {
    island.setBotState("idle");
    ViewData.ticker.sync(["Zeus Gateway Online", "Monitoring Active Workspaces"], 0);
    return;
  }

  if (f.status === "waiting") {
    island.setBotState("approval");
    island.fsm.pinned = true;
    island.setView("approval");
  } else if (f.status === "working") {
    island.setBotState("working");
  } else if (f.status === "finished") {
    island.setBotState("finished");
  } else {
    island.setBotState("idle");
  }

  const steps = [
    describeEvent(f),
    f.message ? f.message : `Status: ${f.status}`,
    f.capabilities?.length ? `Tools: ${f.capabilities.join(", ")}` : "Watching workspace",
  ].filter(Boolean);

  ViewData.ticker.sync(steps, 0);
}

// ── Gateway Connection ────────────────────────────────────────────────────────
async function connectToGateway(gwUrl: string, tokenOverride?: string): Promise<void> {
  const base = gwUrl.replace(/\/+$/, "");
  const token = tokenOverride || ViewData.gatewayToken || "local-dev";
  diag(`connecting to gateway at ${base} with token=${token}`);
  try {
    const res = await fetch(`${base}/health`).catch(() => fetch(`${base}/api/health`));
    if (!res.ok) throw new Error(`Gateway returned HTTP ${res.status}`);

    credentials = { gateway: base, token };
    ViewData.paired = true;
    ViewData.gatewayUrl = base;
    ViewData.gatewayToken = token;
    ViewData.error = "";

    void invoke("save_credentials", { credentials }).catch(() => {});
    diag(`gateway connection success, token=${token}`);

    // Fetch live sessions
    await fetchSessions(base, token);

    // Stream live events
    startEventStream(base, token);

    render();
  } catch (err) {
    diag(`gateway connection failed: ${String(err)}`);
    ViewData.paired = false;
    ViewData.error = String(err);
    render();
  }
}

async function fetchSessions(base: string, token: string): Promise<void> {
  try {
    const res = await fetch(`${base}/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() =>
      fetch(`${base}/api/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.sessions)) {
        ViewData.sessions = data.sessions;
        if (!ViewData.focus && data.sessions.length > 0) {
          ViewData.focus = data.sessions[0];
        } else if (ViewData.focus) {
          const updated = data.sessions.find((s: Session) => s.id === ViewData.focus?.id);
          if (updated) ViewData.focus = updated;
        }
        syncMascotAndTicker();
        render();
      }
    }
  } catch (err) {
    diag(`fetch sessions err: ${String(err)}`);
  }
}

function startEventStream(base: string, token: string): void {
  if (eventSourceAbort) eventSourceAbort.abort();
  eventSourceAbort = new AbortController();

  const url = `${base}/v1/events/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      diag(`event received: ${data.type || "unknown"}`);

      if (data.session_id) {
        ViewData.events.push({
          id: data.id || String(Date.now()),
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          session_id: data.session_id,
          agent_id: data.agent_id || "",
          runtime: data.runtime || "Agent",
          type: data.type || "event",
          message: data.message,
          tool: data.tool,
          path: data.path,
          command: data.command,
        });
        if (ViewData.events.length > 50) ViewData.events.shift();

        // Refresh sessions to reflect the updated state
        void fetchSessions(base, token);
      }
    } catch (err) {
      diag(`parse event error: ${String(err)}`);
    }
  };

  es.onerror = () => {
    diag("EventSource error, reconnecting in 3s…");
    es.close();
    setTimeout(() => {
      if (ViewData.paired && credentials) startEventStream(credentials.gateway, credentials.token);
    }, 3000);
  };
}

// Auto-sync polling every 4 seconds in the background
setInterval(() => {
  if (ViewData.paired && credentials) {
    void fetchSessions(credentials.gateway, credentials.token);
  }
}, 4000);

// Auto-connect to gateway on boot
void connectToGateway(ViewData.gatewayUrl, ViewData.gatewayToken);
