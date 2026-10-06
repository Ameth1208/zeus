// Island open/close FSM — clean port of Coucou's IslandStateMachine.
// Communicates only via onTransition.

import type { IslandMode, IslandViewName } from "./layout";

export class IslandFsm {
  mode: IslandMode = "compact";
  view: IslandViewName = "overview";
  pinned = false;

  homeToCompactDelay = 15;
  compactToHiddenDelay = 60;

  onTransition?: (from: IslandMode, to: IslandMode) => void;

  private compactTimer: number | null = null;
  private hiddenTimer: number | null = null;

  constructor(onTransition?: (from: IslandMode, to: IslandMode) => void) {
    this.onTransition = onTransition;
  }

  mouseEntered(): void {
    if (this.mode === "hidden") {
      this.cancelTimers();
      this.transition("compact");
    } else if (this.mode === "compact") {
      this.clearHiddenTimer();
    } else if (this.mode === "expanded") {
      this.clearCompactTimer();
    }
  }

  mouseLeft(): void {
    if (this.mode === "compact") {
      this.scheduleHidden();
    } else if (this.mode === "expanded") {
      this.scheduleCompact();
    }
  }

  click(): void {
    if (this.mode === "compact") {
      this.cancelTimers();
      this.transition("expanded");
    }
  }

  /// The summon key cycles expanded -> compact -> hidden -> expanded. Hiding is
  /// never its own entry point here; `forceHide` is bound separately so a user
  /// who wants it gone can make it gone.
  toggle(): void {
    if (this.mode === "expanded") {
      this.forceCompact();
    } else if (this.mode === "compact") {
      this.forceExpanded();
    } else {
      this.forceExpanded();
    }
  }

  /// Hides the island hard and stays hidden until summoned. A pending approval
  /// may summon it again — that is deliberate: attention beats a pinned hide.
  forceHide(): void {
    this.cancelTimers();
    if (this.mode !== "hidden") {
      this.transition("hidden");
    }
  }

  reveal(): void {
    if (this.mode === "hidden") {
      this.cancelTimers();
      this.transition("compact");
      this.scheduleHidden();
    }
  }

  forceExpanded(view?: IslandViewName): void {
    if (view) this.view = view;
    this.cancelTimers();
    this.transition("expanded");
  }

  forceCompact(): void {
    this.cancelTimers();
    this.transition("compact");
    this.scheduleHidden();
  }

  forceHidden(): void {
    this.cancelTimers();
    this.transition("hidden");
  }

  private scheduleCompact(): void {
    this.clearCompactTimer();
    if (this.pinned) return;
    this.compactTimer = window.setTimeout(() => {
      this.compactTimer = null;
      if (this.mode === "expanded") {
        this.transition("compact");
        this.scheduleHidden();
      }
    }, this.homeToCompactDelay * 1000);
  }

  private scheduleHidden(): void {
    this.clearHiddenTimer();
    this.hiddenTimer = window.setTimeout(() => {
      this.hiddenTimer = null;
      if (this.mode === "compact") {
        this.transition("hidden");
      }
    }, this.compactToHiddenDelay * 1000);
  }

  private clearCompactTimer(): void {
    if (this.compactTimer != null) {
      window.clearTimeout(this.compactTimer);
      this.compactTimer = null;
    }
  }

  private clearHiddenTimer(): void {
    if (this.hiddenTimer != null) {
      window.clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
  }

  cancelTimers(): void {
    this.clearCompactTimer();
    this.clearHiddenTimer();
  }

  private transition(to: IslandMode): void {
    if (this.mode === to) return;
    const from = this.mode;
    this.mode = to;
    this.onTransition?.(from, to);
  }
}
