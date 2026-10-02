// The island controller — mirrors Coucou's Island architecture.
// Controls sizing animation, mascot placement, hit testing with Rust backend, and view transitions.

import { invoke } from "@tauri-apps/api/core";
import { Spring, Tracked, closeCurve, clamp } from "../core/anim";
import { IslandFsm } from "./fsm";
import {
  PANEL_W,
  botPosition,
  islandSize,
  modeOrder,
  type IslandMode,
  type IslandViewName,
} from "./layout";
import { Mochi } from "../zeus/mochi";
import type { ZeusBotState } from "../zeus/frames";
import { Sound } from "../core/sound";

export interface IslandDeps {
  root: HTMLElement;
  wakeStrip: HTMLElement;
  island: HTMLElement;
  clip: HTMLElement;
  botCanvas: HTMLCanvasElement;
  content: HTMLElement;
  compactContent?: HTMLElement;
  countdown: HTMLElement;
  onPushRect: (rect: { x: number; y: number; w: number; h: number }) => void;
  onViewChange?: (view: IslandViewName) => void;
}

export class Island {
  readonly fsm: IslandFsm;
  private engine: Mochi;

  // Tracked properties for physics animation
  private width = new Tracked(islandSize("compact", "overview").w);
  private height = new Tracked(islandSize("compact", "overview").h);
  private radius = new Tracked(islandSize("compact", "overview").radius);

  // Mascot springs (faster than island so it leads the motion)
  private botCx = new Spring(40, 0.42, 0.8);
  private botCy = new Spring(16, 0.42, 0.8);
  private botSize = new Spring(20, 0.42, 0.8);

  private running = false;
  private lastMs = 0;
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };
  private pointer = { x: 0, y: 0 };

  constructor(private deps: IslandDeps) {
    this.engine = new Mochi(deps.botCanvas);
    this.engine.emit = () => this.applyGeometry();

    this.fsm = new IslandFsm((from, to) => {
      if (to === "expanded") Sound.play("open");
      if (from === "expanded" && to !== "expanded") Sound.play("close");
      this.animateGeometry(modeOrder(to) < modeOrder(from));
    });

    this.applyTargets(true);
    this.applyGeometry();
    this.wireInput();
    this.kick();
  }

  get mode(): IslandMode {
    return this.fsm.mode;
  }

  get view(): IslandViewName {
    return this.fsm.view;
  }

  reveal(): void {
    this.fsm.reveal();
    this.kick();
  }

  toggle(): void {
    this.fsm.toggle();
    this.kick();
  }

  expand(view?: IslandViewName): void {
    this.fsm.forceExpanded(view);
    this.kick();
  }

  collapse(): void {
    this.fsm.forceCompact();
    this.kick();
  }

  setView(view: IslandViewName): void {
    this.fsm.view = view;
    if (this.fsm.mode !== "expanded") {
      this.fsm.forceExpanded(view);
    } else {
      this.animateGeometry(false);
    }
    this.deps.onViewChange?.(view);
    this.kick();
  }

  isBotHit(clientX: number, clientY: number): boolean {
    const rect = this.deps.island.getBoundingClientRect();
    const botScreenX = rect.left + this.botCx.value;
    const botScreenY = rect.top + this.botCy.value;
    const r = this.botSize.value * 0.55;
    return (clientX - botScreenX) ** 2 + (clientY - botScreenY) ** 2 <= r * r;
  }

  poke(): void {
    this.engine.poke();
    this.kick();
  }

  setBotState(state: ZeusBotState): void {
    this.engine.setState(state);
    if (state === "approval") {
      this.fsm.pinned = true;
      this.expand("approval");
    } else if (state === "finished") {
      this.fsm.pinned = false;
    }
    this.kick();
  }

  private wireInput(): void {
    this.deps.wakeStrip.addEventListener("mouseenter", () => {
      Sound.resume();
      if (this.fsm.mode === "hidden") {
        this.fsm.mouseEntered();
        this.kick();
      }
    });

    this.deps.island.addEventListener("mouseenter", () => {
      this.fsm.mouseEntered();
    });

    this.deps.island.addEventListener("mouseleave", () => {
      this.fsm.mouseLeft();
    });

    window.addEventListener("pointermove", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.engine.setMouse(e.clientX, e.clientY);
    });

    window.addEventListener("pointerleave", () => {
      this.engine.clearMouse();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.fsm.mode === "expanded" && !this.fsm.pinned) {
        this.collapse();
      }
    });
  }

  private kick(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const dt = clamp((now - this.lastMs) / 1000, 0, 0.05);
    this.lastMs = now;

    this.width.step(dt);
    this.height.step(dt);
    this.radius.step(dt);

    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);

    this.applyGeometry();

    const busy =
      this.width.animating ||
      this.height.animating ||
      this.radius.animating ||
      !this.botCx.settled ||
      !this.botCy.settled ||
      !this.botSize.settled ||
      this.engineIsLooping();

    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
    }
  };

  private engineIsLooping(): boolean {
    const s = this.engine.state;
    return (
      s === "sleeping" ||
      s === "approval" ||
      s === "searching" ||
      s === "working" ||
      s === "dizzy" ||
      s === "love" ||
      this.fsm.mode === "expanded"
    );
  }

  private applyTargets(instant: boolean): void {
    const size = islandSize(this.fsm.mode, this.fsm.view);
    const pos = botPosition(this.fsm.mode, this.fsm.view, size.h);

    if (instant) {
      this.width.value = this.width.target = size.w;
      this.height.value = this.height.target = size.h;
      this.radius.value = this.radius.target = size.radius;

      this.botCx.value = this.botCx.target = pos.cx;
      this.botCy.value = this.botCy.target = pos.cy;
      this.botSize.value = this.botSize.target = pos.diameter;
      return;
    }

    if (size.w > this.width.target) this.width.springTo(size.w, 0.5, 0.72);
    else this.width.curveTowards(size.w, 340, closeCurve);

    if (size.h > this.height.target) this.height.springTo(size.h, 0.5, 0.72);
    else this.height.curveTowards(size.h, 340, closeCurve);

    this.radius.springTo(size.radius, 0.5, 0.72);

    this.botCx.target = pos.cx;
    this.botCy.target = pos.cy;
    this.botSize.target = pos.diameter;
  }

  private animateGeometry(shrinking: boolean): void {
    const size = islandSize(this.fsm.mode, this.fsm.view);
    const pos = botPosition(this.fsm.mode, this.fsm.view, size.h);

    if (shrinking) {
      this.width.curveTowards(size.w, 340, closeCurve);
      this.height.curveTowards(size.h, 340, closeCurve);
      this.radius.curveTowards(size.radius, 340, closeCurve);
    } else {
      this.width.springTo(size.w, 0.5, 0.72);
      this.height.springTo(size.h, 0.5, 0.72);
      this.radius.springTo(size.radius, 0.5, 0.72);
    }

    this.botCx.target = pos.cx;
    this.botCy.target = pos.cy;
    this.botSize.target = pos.diameter;

    this.kick();
  }

  private applyGeometry(): void {
    const w = this.width.value;
    const hh = this.height.value;
    const r = this.radius.value;

    const islandEl = this.deps.island;
    islandEl.style.width = `${w}px`;
    islandEl.style.height = `${hh}px`;
    islandEl.style.borderRadius = `0 0 ${r}px ${r}px`;
    islandEl.style.transform = `translateX(-50%)`;

    // Content is only visible and interactive when expanded
    const isExpanded = this.fsm.mode === "expanded";
    this.deps.content.style.opacity = isExpanded ? "1" : "0";
    this.deps.content.style.pointerEvents = isExpanded ? "auto" : "none";

    if (this.deps.compactContent) {
      this.deps.compactContent.style.opacity = isExpanded ? "0" : "1";
      this.deps.compactContent.style.pointerEvents = isExpanded ? "none" : "auto";
    }

    // Position and draw mascot
    const botCanvas = this.deps.botCanvas;
    this.engine.botCx = this.botCx.value;
    this.engine.botCy = this.botCy.value;
    this.engine.draw(this.botSize.value);

    botCanvas.style.transform = `translate(${this.botCx.value}px, ${this.botCy.value}px) translate(-50%, -50%)`;

    // Push bounding rect to Tauri Rust backend for hit testing
    const rect = {
      x: Math.round((PANEL_W - w) / 2),
      y: 0,
      w: Math.round(w),
      h: Math.round(hh),
    };

    const p = this.pushedRect;
    if (
      Math.abs(p.x - rect.x) > 0.5 ||
      Math.abs(p.w - rect.w) > 0.5 ||
      Math.abs(p.h - rect.h) > 0.5
    ) {
      this.pushedRect = rect;
      this.deps.onPushRect(rect);
    }
  }
}
