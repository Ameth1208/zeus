// Outer open/close machine. Pure logic: no DOM, no rendering. Communicates only
// through onTransition, so the same machine could drive a different view layer.

import type { IslandMode, IslandView } from "./layout";
import { isAlerting, viewFor } from "./layout";

export interface IslandFsmOptions {
  homeToCompactDelay?: number;
  compactToHiddenDelay?: number;
  finishedHold?: number;
  onTransition?: () => void;
}

export class IslandFsm {
  mode: IslandMode = "compact";
  view: IslandView = "empty";
  /** An alert suppresses the auto-collapse timer entirely. */
  pinned = false;
  /** Debug/one-shot escape hatch that sits above the focused session's state. */
  override: "none" | "dizzy" = "none";

  private homeToCompact: number;
  private compactToHidden: number;
  private finishedHoldMs: number;
  private onTransition: () => void;
  private timers: number[] = [];

  constructor(opts: IslandFsmOptions = {}) {
    this.homeToCompact = opts.homeToCompactDelay ?? 15;
    this.compactToHidden = opts.compactToHiddenDelay ?? 60;
    this.finishedHoldMs = opts.finishedHold ?? 5200;
    this.onTransition = opts.onTransition ?? (() => {});
  }

  private emit(): void {
    this.onTransition();
  }

  private clearTimers(): void {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
  }

  private transition(to: IslandMode): void {
    if (this.mode === to) return;
    this.mode = to;
    this.emit();
  }

  expand(view?: IslandView): void {
    if (view) this.view = view;
    this.clearTimers();
    this.transition("expanded");
    this.scheduleCompact();
  }

  compact(): void {
    this.clearTimers();
    this.transition("compact");
    this.scheduleHide();
  }

  hide(): void {
    this.clearTimers();
    this.transition("hidden");
  }

  /** The app folded the island itself (Escape, disconnect). Move to compact
   *  right away so hover and click keep working instead of being swallowed by a
   *  machine that still thinks it is expanded. */
  collapse(): void {
    if (this.mode !== "expanded") return;
    this.compact();
  }

  toggle(): void {
    if (this.mode === "expanded") this.compact();
    else this.expand();
  }

  /** The app hid the island on its own. Mirror it without side effects so the
   *  next event peeks again. */
  hiddenExternally(): void {
    if (this.mode !== "compact") return;
    this.clearTimers();
    this.transition("hidden");
  }

  setPinned(value: boolean): void {
    if (this.pinned === value) return;
    this.pinned = value;
    if (this.mode === "expanded") this.scheduleCompact();
  }

  /** A session started or became active: peek at the island. */
  onSessionActive(state: string, sessionCount: number): void {
    this.view = viewFor(state, sessionCount);
    if (isAlerting(state)) {
      this.setPinned(true);
      this.expand(this.view);
      return;
    }
    if (this.mode === "hidden") this.compact();
    else if (this.mode === "compact") this.expand(this.view);
  }

  /** Task finished: show the finished view briefly, then fold. */
  onFinished(sessionCount: number): void {
    this.setPinned(false);
    this.override = "none";
    this.view = viewFor("finished", sessionCount);
    this.expand(this.view);
    this.clearTimers();
    this.timers.push(
      window.setTimeout(() => {
        if (!this.pinned) this.compact();
      }, this.finishedHoldMs),
    );
  }

  onSessionsCleared(): void {
    this.setPinned(false);
    this.override = "none";
    this.view = "empty";
    this.emit();
  }

  private scheduleCompact(): void {
    this.clearTimers();
    if (this.pinned) return;
    this.timers.push(
      window.setTimeout(() => {
        if (!this.pinned && this.mode === "expanded") this.compact();
      }, this.homeToCompact * 1000),
    );
  }

  private scheduleHide(): void {
    this.clearTimers();
    this.timers.push(
      window.setTimeout(() => {
        if (this.mode === "compact") this.hide();
      }, this.compactToHidden * 1000),
    );
  }

  dispose(): void {
    this.clearTimers();
  }
}
