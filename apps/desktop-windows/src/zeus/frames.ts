// Visual states of the Zeus mascot. Same shape as the reference app's state
// table. Each row is a frame plus the behaviour and colour that go with it.

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
  | "interrupted";

export type BadgeKind = "none" | "dots" | "bang" | "question" | "dot";

export interface ZeusStateCfg {
  /** Frame from assets/zeus/, normalised by tools/normalize_zeus_frames.py. */
  frame: string;
  color: string;
  /** Halo opacity. The only real glow in the design. */
  glow: number;
  tint: number;
  badge: BadgeKind;
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
  idle: "#E6E9EE",
  working: "#3B9EFF",
  thinking: "#8B5CF6",
  searching: "#6366F1",
  approval: "#F5A524",
  question: "#22D3EE",
  error: "#F4505E",
  finished: "#34D399",
  sleeping: "#94A3B8",
  interrupted: "#F472B6",
} as const;

const base: Omit<ZeusStateCfg, "frame"> = {
  color: COLORS.idle,
  glow: 0.15,
  tint: 0,
  badge: "none",
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
    glow: 0.65,
    tint: 0.72,
    badge: "dots",
  },
  thinking: {
    ...base,
    frame: "thinking.png",
    color: COLORS.thinking,
    glow: 0.65,
    tint: 0.72,
    badge: "dots",
    look: [0.55, 0.55],
  },
  searching: {
    ...base,
    frame: "look_right.png",
    color: COLORS.searching,
    glow: 0.65,
    tint: 0.72,
    badge: "dots",
    scans: true,
  },
  approval: {
    ...base,
    frame: "waiting_aproval.png",
    color: COLORS.approval,
    glow: 0.65,
    tint: 0.78,
    badge: "bang",
    bounces: true,
  },
  question: {
    ...base,
    frame: "waiting_aproval.png",
    color: COLORS.question,
    glow: 0.65,
    tint: 0.75,
    badge: "question",
    tilt: 0.17,
  },
  error: {
    ...base,
    frame: "error.png",
    color: COLORS.error,
    glow: 0.65,
    tint: 0.78,
    badge: "dot",
    amplitude: 0.94,
  },
  finished: {
    ...base,
    frame: "blink.png",
    color: COLORS.finished,
    glow: 0.65,
    tint: 0.35,
    badge: "dot",
    amplitude: 1.04,
  },
  sleeping: {
    ...base,
    frame: "sleep.png",
    color: COLORS.sleeping,
    glow: 0.15,
    tint: 0.32,
    breathes: true,
    zz: true,
    amplitude: 0.96,
  },
  interrupted: {
    ...base,
    frame: "error.png",
    color: COLORS.interrupted,
    glow: 0.65,
    tint: 0.7,
    badge: "dot",
    amplitude: 0.95,
  },
};

export interface Session {
  id: string;
  agent_id: string;
  runtime: string;
  provider?: string;
  model?: string;
  project?: string;
  machine_name?: string;
  status: string;
  last_event: string;
  message?: string;
  capabilities?: string[];
  pending_request_id?: string;
}

/** Maps a gateway session status + event onto a visual state.
 *
 *  Mirrors `statusForEvent` in gateway/internal/store.go so the mascot agrees
 *  with the status the gateway already computed, then refines it when the
 *  event carries more specific information. */
export function stateForSession(session: Session): ZeusBotState {
  switch (session.status) {
    case "waiting":
      return session.last_event === "permission.requested" ? "approval" : "question";
    case "completed":
      return "finished";
    case "failed":
      return "error";
    case "interrupted":
      return "interrupted";
    case "stopped":
      return "idle";
    case "working":
      switch (session.last_event) {
        case "thinking":
        case "message":
          return "thinking";
        case "file.read":
          return "searching";
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
    sessions[0] ??
    null
  );
}

/** Short line for the ticker, built from the fields the event carries. */
export function describeEvent(session: Session): string {
  const tool = session.capabilities?.find((c) => c.startsWith("tool:"))?.slice(5);
  switch (session.last_event) {
    case "session.started":
      return "Session started";
    case "thinking":
      return session.model ? `Thinking · ${session.model}` : "Thinking";
    case "message":
      return session.message ?? "Agent replied";
    case "tool.started":
      return tool ? `Using ${tool}…` : "Using a tool…";
    case "tool.completed":
      return tool ? `${tool} finished` : "Tool finished. Continuing…";
    case "tool.failed":
      return tool ? `${tool} failed` : "A tool failed. Continuing…";
    case "file.read":
      return "Reading project files…";
    case "file.changed":
      return "Editing project files…";
    case "command.started":
      return "Running a command…";
    case "command.completed":
      return "Command finished";
    case "permission.requested":
      return "An action is waiting for your approval.";
    case "permission.resolved":
      return "Approval resolved";
    case "session.completed":
      return "Task completed.";
    case "session.failed":
      return session.message ?? "The task failed.";
    case "session.stopped":
      return "Task stopped.";
    case "agent.interrupted":
      return "Interrupted.";
    case "heartbeat":
      return "Connected to Zeus Gateway.";
    default:
      return session.message ?? "Working…";
  }
}

/** Stable per-project colour so a session keeps its identity across events. */
const PROJECT_COLORS: Record<string, string> = {
  "zeus-v0.1": "#3B9EFF",
  gateway: "#34D399",
  mobile: "#8B5CF6",
  "desktop-windows": "#F5A524",
};
const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

export function colorForProject(project?: string): string {
  if (!project) return "#6B7079";
  const key = project.toLowerCase();
  if (PROJECT_COLORS[key]) return PROJECT_COLORS[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}
