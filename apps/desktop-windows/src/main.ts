import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { Island } from "./island";
import { ViewData } from "./views";
import { focusSession, stateForSession, type Session } from "./zeus/frames";

type Credentials = { gateway: string; token: string };

/** The release build does not forward console output on Windows, so every
 *  interesting step is written to a file we can read from outside. */
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
  diag(`load_credentials FAILED ${String(e)}`);
}

let sessions: Session[] = [];
let eventSourceAbort: AbortController | null = null;
let island: Island;

ViewData.paired = credentials !== null;

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `
  <div class="panel">
    <div class="island-glow" id="glow"></div>
    <div class="island" id="island">
      <canvas class="bot" id="bot"></canvas>
      <div class="content" id="content"></div>
      <div class="countdown" id="countdown"></div>
    </div>
    <div class="wake-strip" id="wake"></div>
  </div>`;

island = new Island({
  root,
  body: document.querySelector<HTMLDivElement>("#island")!,
  glow: document.querySelector<HTMLDivElement>("#glow")!,
  bot: document.querySelector<HTMLCanvasElement>("#bot")!,
  content: document.querySelector<HTMLDivElement>("#content")!,
  countdown: document.querySelector<HTMLDivElement>("#countdown")!,
  onPushRect: (rect) => {
    void invoke("set_island_rect", { rect }).catch(() => {});
  },
});
diag(`island constructed mode=${island.mode} view=${island.view}`);
island.onFoldChange = (folded) => {
  wake.classList.toggle("hidden-island", folded);
};
void invoke("window_geometry")
  .then((g) => diag(`geometry ${g}`))
  .catch((e) => diag(`geometry failed ${String(e)}`));

document.querySelector("#island")?.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("button, input")) return;
  island.toggle();
});

document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;

  const act = t.closest<HTMLElement>("[data-act]");
  if (act) {
    e.stopPropagation();
    const kind = act.dataset.act!;
    if (kind === "hide") {
      diag("control hide");
      await invoke("hide_island");
      return;
    }
    if (kind === "quit") {
      diag("control quit");
      await invoke("quit");
      return;
    }
    await action(act.dataset.id!, kind);
    return;
  }

  if (t.closest("#pair")) {
    await pair();
    return;
  }

  // Clicking the panel outside the island folds it back down.
  if (!t.closest("#island") && !t.closest("#wake")) {
    island.collapse();
  }
});

// The wake handle doubles as the reveal affordance: clicking it brings the
// island back, and it only becomes visible once the island has folded away.
const wake = document.querySelector<HTMLDivElement>("#wake")!;
wake.addEventListener("click", () => {
  diag("wake clicked -> reveal");
  void invoke("show_island");
  island.reveal();
});
wake.addEventListener("pointerenter", () => {
  if (island.mode === "hidden") {
    void invoke("show_island");
    island.reveal();
  }
});

document.addEventListener("keydown", (e) => {
  // Escape folds the island. Ctrl+Q quits: the window has no decorations and
  // no taskbar entry, so without this the app is unquittable.
  if (e.key === "Escape") {
    island.collapse();
    diag("keydown escape -> collapse");
  }
  if (e.ctrlKey && (e.key === "q" || e.key === "Q")) {
    diag("keydown ctrl+q -> quit");
    void invoke("quit");
  }
  if (e.key === " ") {
    e.preventDefault();
    island.toggle();
  }
});

async function pair(): Promise<void> {
  const gateway = (document.querySelector<HTMLInputElement>("#gateway")?.value ?? "")
    .replace(/\/+$/, "");
  const code = document.querySelector<HTMLInputElement>("#code")?.value ?? "";
  try {
    const r = await fetch(`${gateway}/v1/pair/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, device_name: "Zeus Desktop" }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    credentials = { gateway, token: body.token };
    await invoke("save_credentials", { credentials });
    ViewData.paired = true;
    await refresh();
    connectEvents();
  } catch {
    ViewData.error = "Could not pair with this Gateway.";
    island.onSessionsCleared();
  }
}

async function refresh(): Promise<void> {
  if (!credentials) return;
  const r = await fetch(`${credentials.gateway}/v1/sessions`, {
    headers: { authorization: `Bearer ${credentials.token}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  sessions = ((await r.json()) as { sessions?: Session[] }).sessions ?? [];

  ViewData.sessions = sessions;
  const focus = focusSession(sessions);
  ViewData.focus = focus;

  if (!focus) {
    island.onSessionsCleared();
    return;
  }

  const state = stateForSession(focus);
  ViewData.state = state;
  island.onSessionsChanged(state, sessions.length, state === "finished");
}

async function action(id: string, kind: string): Promise<void> {
  if (!credentials) return;
  const session = sessions.find((s) => s.id === id);
  if (!session) return;
  const needsRef =
    (kind === "approve" || kind === "deny") && Boolean(session.pending_request_id);
  const r = await fetch(`${credentials.gateway}/v1/actions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      session_id: session.id,
      agent_id: session.agent_id,
      kind,
      ...(needsRef ? { payload: { request_id: session.pending_request_id } } : {}),
    }),
  });
  if (r.ok) setTimeout(() => void refresh(), 250);
}

function connectEvents(): void {
  eventSourceAbort?.abort();
  if (!credentials) return;
  eventSourceAbort = new AbortController();
  const run = async (): Promise<void> => {
    try {
      const r = await fetch(`${credentials!.gateway}/v1/events/stream`, {
        headers: { authorization: `Bearer ${credentials!.token}` },
        signal: eventSourceAbort!.signal,
      });
      if (!r.ok || !r.body) return;
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        if (parts.some((p) => p.includes("data:") && !p.includes("data: {}"))) {
          await refresh();
        }
      }
    } catch {
      if (!eventSourceAbort?.signal.aborted) setTimeout(run, 1800);
    }
  };
  void run();
}

if (credentials) {
  refresh()
    .catch(() => {
      ViewData.paired = false;
      island.onSessionsCleared();
    })
    .finally(connectEvents);
} else {
  island.reveal();
  island.onSessionsCleared();
}
