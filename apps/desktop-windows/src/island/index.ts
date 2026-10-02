import { invoke } from "@tauri-apps/api/core";
// The island controller. Owns the animation loop, pushes the island rect to
// Rust so the transparent panel only eats clicks over the island itself, and
// renders the active view.

import { Spring, Tracked, closeCurve, clamp } from "../core/anim";
import { IslandFsm } from "./fsm";
import { islandPath } from "./shape";
import {
  botPosition,
  islandSize,
  modeOrder,
  type IslandMode,
  type IslandView,
  VIEW_LAYOUTS,
} from "./layout";
import { Mochi } from "../zeus/mochi";
import { renderView } from "../views";
import type { ZeusBotState } from "../zeus/frames";

export interface IslandDeps {
  root: HTMLElement;
  body: HTMLDivElement;
  glow: HTMLDivElement;
  bot: HTMLCanvasElement;
  content: HTMLDivElement;
  countdown: HTMLDivElement;
  onPushRect: (rect: { x: number; y: number; w: number; h: number }) => void;
  onOpenSession?: (id: string) => void;
  onAction?: (id: string, kind: string) => void;
}

export class Island {
  private fsm = new IslandFsm({ onTransition: () => this.kick() });
  private engine: Mochi;

  // Geometry gets its own tracked values so they interpolate independently.
  private width = new Tracked(islandSize("compact", "empty").w);
  private height = new Tracked(islandSize("compact", "empty").h);
  private radius = new Tracked(islandSize("compact", "empty").radius);
  private topRadius = new Tracked(islandSize("compact", "empty").topRadius);

  // The mascot rides its own springs so it can travel independently.
  private botCx = new Spring(34, 0.42, 0.8);
  private botCy = new Spring(31, 0.42, 0.8);
  private botSize = new Spring(46, 0.42, 0.8);

  private running = false;
  private lastMs = 0;
  private viewKey = "";
  private countdownPct = 1;

  constructor(private deps: IslandDeps) {
    this.engine = new Mochi(deps.bot);
    this.engine.emit = () => this.paint();
    this.applyTargets(true);
    this.bindPointer();
    this.kick();
  }

  // ── Public control surface ────────────────────────────────────────────

  get mode(): IslandMode {
    return this.fsm.mode;
  }

  get view(): IslandView {
    return this.fsm.view;
  }

  reveal(): void {
    if (this.fsm.mode === "hidden") this.fsm.compact();
  }

  toggle(): void {
    this.fsm.toggle();
  }

  collapse(): void {
    this.fsm.collapse();
  }

  hide(): void {
    this.fsm.hiddenExternally();
  }

  onSessionsChanged(state: string, count: number, finished: boolean): void {
    this.engine.setState(state as ZeusBotState);
    if (finished) this.fsm.onFinished(count);
    else this.fsm.onSessionActive(state, count);
    this.kick();
  }

  onSessionsCleared(): void {
    this.engine.setState("idle");
    this.fsm.onSessionsCleared();
    this.kick();
  }

  // ── Animation ─────────────────────────────────────────────────────────

  private kick(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const dt = clamp((now - this.lastMs) / 1000, 0, 0.05);
    this.lastMs = now;

    this.applyTargets(false);
    this.width.step(dt);
    this.height.step(dt);
    this.radius.step(dt);
    this.topRadius.step(dt);
    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);

    this.engine.setMouse(this.pointer.x, this.pointer.y);
    this.paint();
    this.updateCountdown();

    const busy =
      this.width.animating ||
      this.height.animating ||
      this.radius.animating ||
      this.topRadius.animating ||
      !this.botCx.settled ||
      !this.botCy.settled ||
      !this.botSize.settled ||
      this.engineIsLooping();

    if (busy) requestAnimationFrame(this.frame);
    else this.running = false;
  };

  private engineIsLooping(): boolean {
    // Any state with a looping mascot animation keeps the loop alive even when
    // the geometry has settled, otherwise breathing stops mid-breath.
    const s = this.engine.state;
    return (
      s === "sleeping" ||
      s === "approval" ||
      s === "searching" ||
      s === "interrupted" ||
      this.fsm.mode === "expanded"
    );
  }

  /** Chooses spring or curve per property based on direction of travel, then
   *  retargets the mascot springs. */
  private applyTargets(instant: boolean): void {
    const size = islandSize(this.fsm.mode, this.fsm.view);
    const growing = modeOrder(this.fsm.mode) >= 2;

    const drive = (t: Tracked, v: number): void => {
      if (instant) {
        t.value = v;
        t.target = v;
        return;
      }
      if (v > t.target) t.springTo(v, 0.5, 0.72);
      else t.curveTowards(v, 340, closeCurve);
    };

    drive(this.width, size.w);
    drive(this.height, size.h);
    drive(this.radius, size.radius);
    drive(this.topRadius, size.topRadius);

    const p = botPosition(this.fsm.mode, this.fsm.view, size.h);
    if (instant) {
      this.botCx.value = this.botCx.target = p.cx;
      this.botCy.value = this.botCy.target = p.cy;
      this.botSize.value = this.botSize.target = p.diameter;
    } else {
      // The mascot springs are deliberately faster than the island so it reads
      // as leading the movement rather than being dragged by it.
      this.botCx.tune(0.42, 0.8);
      this.botCy.tune(0.42, 0.8);
      this.botSize.tune(0.42, 0.8);
      this.botCx.target = p.cx;
      this.botCy.target = p.cy;
      this.botSize.target = p.diameter;
    }
    void growing;
  }

  private pointer = { x: 0, y: 0 };

  private bindPointer(): void {
    window.addEventListener("pointermove", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.engine.setMouse(e.clientX, e.clientY);
    });
    window.addEventListener("pointerleave", () => this.engine.clearMouse());
  }

  // ── Painting ──────────────────────────────────────────────────────────

  private paintCount = 0;

  private paint(): void {
    const w = Math.round(this.width.value);
    const h = Math.round(this.height.value);
    const r = this.radius.value;
    const tr = this.topRadius.value;
    const { body, glow, bot } = this.deps;

    if (this.paintCount < 3) {
      this.paintCount++;
      const probe = islandPath(w, h, r, tr);
      console.log(`[paint#${this.paintCount}] w=${w} h=${h} r=${r} tr=${tr} pathLen=${probe.length}`);
      void invoke("log_diag", {
        msg: `paint#${this.paintCount} w=${w} h=${h} r=${r.toFixed(1)} tr=${tr.toFixed(1)} pathLen=${probe.length}`,
      }).catch(() => {});
    }

    if (h <= 0) {
      body.style.opacity = "0";
      glow.style.opacity = "0";
      this.pushRect(0, 0);
      return;
    }

    body.style.opacity = "1";
    body.style.width = `${w}px`;
    body.style.height = `${h}px`;
    const d = islandPath(w, h, r, tr);
    body.style.clipPath = `path('${d}')`;

    glow.style.width = `${w}px`;
    glow.style.height = `${h}px`;
    glow.style.transform = `translateX(-50%) translateY(${h}px)`;

    this.engine.draw(this.botCx.value, this.botCy.value, this.botSize.value);
    bot.style.transform = `translate(${this.botCx.value}px, ${this.botCy.value}px) translate(-50%, -50%)`;

    this.renderContent(w, h);
    this.pushRect(w, h);
  }

  private renderContent(w: number, h: number): void {
    if (this.fsm.mode !== "expanded") {
      if (this.viewKey !== "") {
        this.viewKey = "";
        this.deps.content.innerHTML = "";
        this.deps.content.className = "content";
      }
      return;
    }
    const layout = VIEW_LAYOUTS[this.fsm.view];
    const key = `${this.fsm.view}:${layout.agentMode}:${w}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    this.deps.content.className = `content on view-${this.fsm.view}`;
    this.deps.content.innerHTML = renderView(this.fsm.view, this.deps);
    this.deps.content.style.setProperty("--wash", layout.wash ?? "transparent");
  }

  private updateCountdown(): void {
    const el = this.deps.countdown;
    if (this.fsm.pinned || this.fsm.mode !== "expanded") {
      el.style.width = "0px";
      return;
    }
    // Only the final stretch of the auto-close window shows the bar.
    el.style.width = `${this.countdownPct * 100}%`;
  }

  /** Pushes the island rect to Rust so the transparent panel only eats clicks
   *  over the island itself, with a margin. */
  private lastPushed = { x: 0, y: 0, w: 0, h: 0 };
  private folded = false;

  /** Lets the parent show a reveal handle only while the island is away. */
  onFoldChange?: (folded: boolean) => void;

  private pushRect(w: number, h: number): void {
    const folded = h <= 0;
    if (folded !== this.folded) {
      this.folded = folded;
      this.onFoldChange?.(folded);
    }
    const rect = {
      x: Math.round((720 - w) / 2),
      y: 0,
      w: Math.round(w),
      h: Math.round(h) + (h > 0 ? 14 : 0),
    };
    const p = this.lastPushed;
    if (
      Math.abs(p.x - rect.x) > 0.5 ||
      Math.abs(p.w - rect.w) > 0.5 ||
      Math.abs(p.h - rect.h) > 0.5
    ) {
      this.lastPushed = rect;
      this.deps.onPushRect(rect);
    }
  }
}
