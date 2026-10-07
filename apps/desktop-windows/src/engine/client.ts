// Typed bridge to ZeusEngine.
//
// This is the only place the webview talks to the host. Two rules hold here:
//
//   1. No process, socket or store crosses this boundary. Everything is data.
//   2. Capabilities decide which controls exist. `can(session, "interrupt")`
//      returning false means no interrupt button is rendered, rather than a
//      button that reports "unsupported" when pressed.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** The closed kind set. Mirrors `EventKind` in the Rust engine. */
export type EventKind =
  | "session.started"
  | "session.completed"
  | "session.failed"
  | "agent.thinking"
  | "agent.message"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "permission.requested"
  | "permission.resolved"
  | "input.requested";

export type RuntimeMode = "managed" | "observed";

/** Mirrors `SessionView`. */
export interface SessionView {
  id: string;
  runtime: string;
  mode: RuntimeMode;
  project: string;
  model: string;
  status: string;
  live: boolean;
  capabilities: string[];
  external_session_id: string | null;
  usage: TokenUsage;
  digest_chars: number;
  last_seq: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
  thinking: number;
  estimated: boolean;
}

/** Mirrors `PendingRequest`. */
export interface PendingRequest {
  request_id: string;
  session_id: string;
  workstation_id: string;
  created_at: number;
  expires_at: number;
  status: string;
  summary: string;
}

/** Mirrors `RuntimeEntry`; `managed` is null for observed-only runtimes. */
export interface RuntimeEntry {
  info: { id: string; label: string; providers: string[] };
  managed: {
    runtime: string;
    mode: RuntimeMode;
    available: string[];
    installed: boolean;
    version: string | null;
  } | null;
  observed: boolean;
}

export interface ZeusEvent {
  event_id: string;
  session_id: string;
  runtime: string;
  external_session_id: string | null;
  seq: number;
  time: number;
  kind: EventKind;
  payload: Record<string, unknown>;
}

export interface SessionDigest {
  session_id: string;
  goal: string;
  constraints: string[];
  decisions: string[];
  changed_files: string[];
  tests: string[];
  pending: string[];
  last_seq: number;
}

export interface ContextEnvelope {
  source: string;
  hits: number;
  truncated: boolean;
  unavailable: string | null;
  text: string;
}

export interface Credentials {
  gateway: string;
  token: string;
}

export interface GatewayStatus {
  configured: boolean;
  state: "offline" | "connecting" | "online";
  queued: number;
}

export const sessions = (): Promise<SessionView[]> => invoke("engine_sessions");
export const runtimes = (): Promise<RuntimeEntry[]> => invoke("engine_runtimes");
export const pending = (): Promise<PendingRequest[]> => invoke("engine_pending");
export const events = (sessionId: string, limit = 50): Promise<ZeusEvent[]> =>
  invoke("engine_events", { sessionId, limit });
export const digest = (sessionId: string): Promise<SessionDigest> =>
  invoke("engine_digest", { sessionId });
export const launch = (runtime: string, cwd: string, prompt?: string, model?: string) =>
  invoke<string>("engine_launch", { runtime, cwd, prompt: prompt ?? null, model: model ?? null });
export const send = (sessionId: string, text: string) => invoke<void>("engine_send", { sessionId, text });
export const interrupt = (sessionId: string) => invoke<void>("engine_interrupt", { sessionId });
export const stop = (sessionId: string) => invoke<void>("engine_stop", { sessionId });
export const resume = (sessionId: string) => invoke<string>("engine_resume", { sessionId });
export const decide = (requestId: string, sessionId: string, allow: boolean) =>
  invoke<void>("engine_decide", { requestId, sessionId, allow });
export const contextSearch = (pattern: string) =>
  invoke<ContextEnvelope>("engine_context_search", { pattern });
export const contextRead = (path: string, offset = 0, whole = false) =>
  invoke<ContextEnvelope>("engine_context_read", { path, offset, whole });
export const contextChanged = () => invoke<ContextEnvelope>("engine_context_changed");
export const contextSerena = (runtime: string) =>
  invoke<Record<string, unknown> | null>("engine_context_serena", { runtime });
export const loadCredentials = () => invoke<Credentials | null>("load_credentials");
export const saveCredentials = (credentials: Credentials) =>
  invoke<void>("save_credentials", { credentials });
export const clearCredentials = () => invoke<void>("clear_credentials");
export const configureGateway = (credentials: Credentials | null) =>
  invoke<void>("engine_gateway_configure", { credentials });
export const gatewayStatus = () => invoke<GatewayStatus>("engine_gateway_status");
export const getNotificationsEnabled = () => invoke<boolean>("get_notifications_enabled");
export const setNotificationsEnabled = (enabled: boolean) =>
  invoke<void>("set_notifications_enabled", { enabled });
export interface NowPlaying {
  available: boolean;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  position_secs: number;
  duration_secs: number;
  thumbnail: string;
}

export const mediaNowPlaying = () => invoke<NowPlaying>("media_now_playing");
export const mediaControl = (command: "play_pause" | "next" | "previous") =>
  invoke<void>("media_control", { command });
export const setIslandRect = (rect: { x: number; y: number; w: number; h: number }) =>
  invoke<void>("set_island_rect", { rect });
export const hideIsland = () => invoke<void>("hide_island");
export const showIsland = () => invoke<void>("show_island");
export const focusWindow = () => invoke<void>("focus_window");
export const logDiag = (msg: string) => invoke<void>("log_diag", { msg }).catch(() => {});

/** True when the runtime advertises a capability for this session. */
export function can(session: SessionView | null | undefined, capability: string): boolean {
  if (!session) return false;
  return session.capabilities.includes(capability);
}

/** True when the session can be launched or watched by this runtime at all. */
export function isUsable(session: SessionView | null | undefined): boolean {
  return !!session && session.capabilities.length > 0;
}

/** Subscribes to engine events. Returns an unsubscribe function. */
export function onEvent(handler: (event: ZeusEvent) => void): Promise<UnlistenFn> {
  return listen<ZeusEvent>("zeus://event", (e) => handler(e.payload));
}

/** The global hotkey. The island decides what a press means from its own mode. */
export function onHotkey(handler: () => void): Promise<UnlistenFn> {
  return listen("zeus://hotkey", () => handler());
}

/** True when a decision refusal is a validation failure rather than a fault. */
export function isRefusal(message: string): boolean {
  return message.includes("unknown_request") || message.includes("wrong_session")
    || message.includes("wrong_workstation") || message.includes("already_decided")
    || message.includes("expired");
}

/** Turns an engine refusal into something worth showing a person. */
export function describeRefusal(message: string): string {
  switch (true) {
    case message.includes("already_decided"):
      return "That request was already answered.";
    case message.includes("expired"):
      return "That request expired. Nothing was approved.";
    case message.includes("wrong_session"):
      return "That request belongs to a different session.";
    case message.includes("wrong_workstation"):
      return "That request came from another machine.";
    case message.includes("unknown_request"):
      return "That request no longer exists.";
    default:
      return message;
  }
}
