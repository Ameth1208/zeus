// Shared state for every view.
//
// This is the only module the views import from each other by way of data:
// `ViewData` is the single mutable object the host refresh fills and each
// renderer reads. It lives apart from the renderers so that adding a view never
// means touching the data that view happens to read.
//
// It is mutated in place rather than replaced, because `main.ts` holds a
// reference to this exact object for the life of the process.

import type { IslandViewName } from "../island/layout";
import type { Session } from "../zeus/frames";
import type { NowPlaying, PendingRequest, RuntimeEntry } from "../engine/client";
import { Ticker } from "./ticker";

export interface AgentCardInfo {
  id: string;
  name: string;
  runtime: string;
  project: string;
  status: string;
  steps: string[];
  stepIndex: number;
  command?: string;
  tool?: string;
}

export interface EventItem {
  id: string;
  time: string;
  session_id: string;
  agent_id: string;
  runtime: string;
  type: string;
  message?: string;
  tool?: string;
  path?: string;
  command?: string;
}

export const ViewData = {
  sessions: [] as Session[],
  focus: null as Session | null,
  /** Approvals that are still decidable. Expired ones are filtered out by the
   * engine, so a button here is always a button that will be honoured. */
  pending: [] as PendingRequest[],
  /** What this machine can drive, and what it can only watch. */
  runtimes: [] as RuntimeEntry[],
  activeView: "overview" as IslandViewName,
  state: "idle",
  /** "offline" means the engine host is unreachable, not that an agent stopped:
   *  agents live in the host and keep running either way. */
  hostState: "online" as "online" | "offline",
  gatewayState: "offline" as "online" | "connecting" | "offline",
  soundOn: true,
  /** Windows toasts on pushworthy events; persisted by the host, not localStorage. */
  notificationsOn: true,
  disablePoking: localStorage.getItem("zeus_disable_poking") === "true",
  autoCloseSec: parseInt(localStorage.getItem("zeus_autoclose") || "15", 10),
  gatewayUrl: localStorage.getItem("zeus_gateway_url") || "http://127.0.0.1:8080",
  gatewayToken: localStorage.getItem("zeus_gateway_token") || "local-dev",
  launchRuntime: "",
  launchCwd: localStorage.getItem("zeus_launch_cwd") || "",
  media: {
    available: false,
    title: "",
    artist: "",
    album: "",
    playing: false,
    position_secs: 0,
    duration_secs: 0,
    thumbnail: "",
  } as NowPlaying,
  busyAction: "" as "" | "launch" | "send" | "save-gateway",
  menuOpen: false,
  error: "",
  events: [] as EventItem[],
  ticker: new Ticker(),
};

/** True when the focused session advertises a capability. The single gate on
 *  every control: a runtime without `stop` gets no stop button, rather than a
 *  button that fails when pressed. */
export function can(capability: string): boolean {
  return !!ViewData.focus && ViewData.focus.capabilities.includes(capability);
}

/** HTML-escapes text going into a template literal. Every interpolated value
 *  from the engine passes through here: event messages carry tool output and
 *  file paths, which is exactly the shape of data that can contain `<`. */
export function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]!,
  );
}

/** Compact token counter, e.g. "12.4k". Empty when the runtime has not reported
 *  usage yet; an estimate must always be labelled where it is shown. */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** m:ss for the transport bar. */
export function fmtClock(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One colour per event family, shared by the activity feed and the log ticker
 *  so an event looks the same wherever it surfaces. */
export function activityKindColor(kind: string): string {
  if (kind.startsWith("tool.")) return "#3B82F6";
  if (kind.startsWith("file.")) return "#22C55E";
  if (kind.startsWith("command.")) return "#A78BFA";
  if (kind.startsWith("agent.")) return "#9CA3AF";
  if (kind.startsWith("session.")) return "#38BDF8";
  if (kind.startsWith("permission.")) return "#F5A524";
  if (kind.startsWith("input.")) return "#22D3EE";
  return "#6b7079";
}

/** Session status → dot colour. Separate from the event palette: this one keys
 *  off a session's lifecycle, not off an event's family. */
export const STATUS_COLORS: Record<string, string> = {
  working: "#3B82F6",
  waiting: "#F5A524",
  completed: "#22C55E",
  failed: "#F4505E",
  stopped: "#6b7079",
};