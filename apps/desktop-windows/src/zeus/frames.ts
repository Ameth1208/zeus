// Visual states of the Zeus mascot. Same shape as the reference app's state
// table. Each row is a frame plus the behaviour and colour that go with it.

/**
 * The only states the UI is allowed to express.
 *
 * Deliberately nine, and deliberately runtime-agnostic: every runtime is reduced
 * to normalized events before it reaches here, so there is nothing runtime-shaped
 * to represent. The table below is how those nine are drawn, not a wider API.
 */
export type ZeusUiState =
  | "idle"
  | "thinking"
  | "working"
  | "waitingApproval"
  | "waitingInput"
  | "success"
  | "error"
  | "sleeping"
  | "disconnected";

/** What the canvas actually draws. A superset, because several frames are
 *  shared between states and some are interaction flourishes (poking). */
export type ZeusBotState =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "sleeping"
  | "interrupted"
  | "dizzy"
  | "love";


export interface ZeusStateCfg {
  /** Frame from assets/zeus/, normalised by tools/normalize_zeus_frames.py. */
  frame: string;
  color: string;
  /** Contact-shadow opacity under the mascot. Kept deliberately low: this is a
   *  grounding shadow, not a halo. See the draw call in `mochi.ts`. */
  glow: number;
  tint: number;
  /** Human-readable state name, shown next to the mascot in the header so the
   *  pose is legible as words and not only as a picture. */
  label: string;
  /** Looping vertical hop. */
  bounces: boolean;
  /** Eyes sweep left→right. */
  scans: boolean;
  breathes: boolean;
  /** Floating "z". */
  zz: boolean;
  sweat: boolean;
  /** Gaze override [yaw, pitch]. */
  look: readonly [number, number] | null;
  /** Head tilt in radians. */
  tilt: number;
  /** Base scale multiplier. */
  amplitude: number;
}

export const COLORS = {
  idle: "#3B82F6",
  working: "#3B82F6",
  thinking: "#60A5FA",
  searching: "#2563EB",
  approval: "#F5A524",
  question: "#38BDF8",
  error: "#F4505E",
  finished: "#38BDF8",
  sleeping: "#3B82F6",
  interrupted: "#60A5FA",
  dizzy: "#60A5FA",
  love: "#38BDF8",
} as const;

const base: Omit<ZeusStateCfg, "frame"> = {
  color: COLORS.idle,
  glow: 0.05,
  tint: 0,
  label: "Idle",
  bounces: false,
  scans: false,
  breathes: false,
  zz: false,
  sweat: false,
  look: null,
  tilt: 0,
  amplitude: 1,
};

/** One row per visual state — adding a state is a single table entry.
 *
 *  The frames live in assets/zeus/ and are pre-normalised by
 *  tools/normalize_zeus_frames.py so the dog stays legible at island scale. */
export const BOT_STATES: Record<ZeusBotState, ZeusStateCfg> = {
  idle: { ...base, frame: "idle.png" },
  working: {
    ...base,
    frame: "working.png",
    color: COLORS.working,
    glow: 0.07,
    tint: 0.72,
    label: "Working",
  },
  thinking: {
    ...base,
    frame: "thinking.png",
    color: COLORS.thinking,
    glow: 0.07,
    tint: 0.72,
    label: "Thinking",
    look: [0.55, 0.55],
  },
  searching: {
    ...base,
    frame: "look_right.png",
    color: COLORS.searching,
    glow: 0.07,
    tint: 0.72,
    label: "Searching",
    scans: true,
  },
  approval: {
    ...base,
    frame: "waiting_aproval.png",
    color: COLORS.approval,
    glow: 0.07,
    tint: 0.78,
    label: "Waiting for you",
    bounces: true,
  },
  question: {
    ...base,
    frame: "waiting_aproval.png",
    color: COLORS.question,
    glow: 0.07,
    tint: 0.75,
    label: "Needs an answer",
    tilt: 0.17,
  },
  error: {
    ...base,
    frame: "error.png",
    color: COLORS.error,
    glow: 0.07,
    tint: 0.78,
    label: "Failed",
    amplitude: 0.94,
  },
  finished: {
    ...base,
    frame: "blink.png",
    color: COLORS.finished,
    glow: 0.07,
    tint: 0.35,
    label: "Done",
    amplitude: 1.04,
  },
  sleeping: {
    ...base,
    frame: "sleep.png",
    color: COLORS.sleeping,
    glow: 0.05,
    tint: 0.32,
    breathes: true,
    zz: true,
    label: "Sleeping",
    amplitude: 0.96,
  },
  interrupted: {
    ...base,
    frame: "error.png",
    color: COLORS.interrupted,
    glow: 0.07,
    tint: 0.7,
    label: "Disconnected",
    amplitude: 0.95,
  },
  dizzy: {
    ...base,
    frame: "error.png",
    color: COLORS.dizzy,
    glow: 0.08,
    tint: 0.7,
    label: "Stuck",
    amplitude: 0.95,
  },
  love: {
    ...base,
    frame: "blink.png",
    color: COLORS.love,
    glow: 0.09,
    tint: 0.4,
    label: "Happy",
    amplitude: 1.06,
    bounces: true,
  },
};

/** A session as the engine reports it. Field names match the Rust struct, so
 *  there is no translation layer to keep in sync. */
export interface Session {
  id: string;
  runtime: string;
  mode: "managed" | "observed";
  project: string;
  model: string;
  status: string;
  live: boolean;
  capabilities: string[];
  external_session_id: string | null;
  usage: {
    input: number;
    output: number;
    cached: number;
    thinking: number;
    estimated: boolean;
  };
  digest_chars: number;
  last_seq: number;
  /** Set by the client from the latest event, since the engine's session view is
   *  a snapshot and the last event is only known on the event stream. */
  last_event?: string;
  message?: string;
}

/** The nine UI states, in island priority order: approval beats error beats
 *  input beats working beats completed beats idle. A single session can be
 *  several of these at once; this order is the tie-break. */
export const UI_PRIORITY: readonly ZeusUiState[] = [
  "waitingApproval",
  "error",
  "waitingInput",
  "working",
  "thinking",
  "success",
  "disconnected",
  "sleeping",
  "idle",
];

/** The drawable state behind a UI state. */
export function frameFor(state: ZeusUiState): ZeusBotState {
  switch (state) {
    case "waitingApproval":
      return "approval";
    case "waitingInput":
      return "question";
    case "success":
      return "finished";
    case "error":
      return "error";
    case "thinking":
      return "thinking";
    case "working":
      return "working";
    case "sleeping":
      return "sleeping";
    case "disconnected":
      return "interrupted";
    case "idle":
      return "idle";
  }
}

/** Maps a session onto one of the nine UI states.
 *
 *  Mirrors `status_for` in the engine's `store.rs` and `statusForEvent` in
 *  gateway/internal/store.go. All three tables must change together.
 *
 *  Note the approvals case: `waiting` alone is not enough, because the last
 *  event distinguishes "needs your permission" from "needs an answer", and
 *  those deserve different faces. */
export function uiStateForSession(session: Session): ZeusUiState {
  if (session.status === "disconnected") return "disconnected";
  switch (session.status) {
    case "waiting":
      return session.last_event === "input.requested" ? "waitingInput" : "waitingApproval";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "stopped":
      return "idle";
    case "working":
      switch (session.last_event) {
        case "agent.thinking":
        case "agent.message":
          return "thinking";
        case "tool.failed":
          return "error";
        default:
          return "working";
      }
    default:
      return "idle";
  }
}

/** The session the island focuses on: attention first, then work, then rest. */
export function focusSession(sessions: Session[]): Session | null {
  return (
    sessions.find((s) => s.status === "waiting") ??
    sessions.find((s) => s.status === "working") ??
    sessions.find((s) => s.status === "failed") ??
    sessions[0] ??
    null
  );
}

/** Short line for the ticker, built from the fields the event carries. */
export function describeEvent(session: Session): string {
  switch (session.last_event) {
    case "session.started":
      return "Session started";
    case "agent.thinking":
      return session.model ? `Thinking · ${session.model}` : "Thinking";
    case "agent.message":
      return session.message ?? "Agent replied";
    case "tool.started":
      return "Using a tool…";
    case "tool.completed":
      return "Tool finished. Continuing…";
    case "tool.failed":
      return "A tool failed. Continuing…";
    case "permission.requested":
      return "An action is waiting for your approval.";
    case "input.requested":
      return "An action needs an answer.";
    case "permission.resolved":
      return "Approval resolved";
    case "session.completed":
      return "Task completed.";
    case "session.failed":
      return session.message ?? "The task failed.";
    // Legacy adapter names, still present in sessions restored from an old log.
    case "thinking":
      return session.model ? `Thinking · ${session.model}` : "Thinking";
    case "message":
      return session.message ?? "Agent replied";
    case "file.read":
      return "Reading project files…";
    case "file.changed":
      return "Editing project files…";
    case "command.started":
      return "Running a command…";
    case "command.completed":
      return "Command finished";
    case "session.stopped":
      return "Task stopped.";
    case "agent.interrupted":
      return "Interrupted.";
    default:
      return session.message ?? "Working…";
  }
}

/** Aggregate over every session. The island shows one mascot, so this picks the
 *  state that most deserves attention rather than the most recent. */
export function uiStateForSessions(sessions: Session[]): ZeusUiState {
  const states = sessions.map(uiStateForSession);
  for (const candidate of UI_PRIORITY) {
    if (states.includes(candidate)) return candidate;
  }
  return "idle";
}

/** Stable per-project colour so a session keeps its identity across events. */
const PROJECT_COLORS: Record<string, string> = {
  "zeus-v0.1": "#3B82F6",
  gateway: "#2563EB",
  mobile: "#60A5FA",
  "desktop-windows": "#38BDF8",
};
const FALLBACK_COLORS = ["#3B82F6", "#60A5FA", "#2563EB", "#38BDF8"];

export function colorForProject(project?: string): string {
  if (!project) return "#6B7079";
  const key = project.toLowerCase();
  if (PROJECT_COLORS[key]) return PROJECT_COLORS[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}
