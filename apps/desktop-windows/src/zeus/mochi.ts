// The mascot renderer.
//
// The island chrome — shape, springs, FSM, wash, badge, halo — is the reference
// app's. This file is the one place Zeus differs: instead of a procedurally
// drawn squircle it draws the frames in assets/zeus/, pre-normalised by
// tools/normalize_zeus_frames.py so the dog survives at island scale.

import { clamp, smooth } from "../core/anim";
import { BOT_STATES, type ZeusBotState } from "./frames";

const K_GEN = 0.09;
const K_LOOK = 0.14;
const K_COLOR = 0.16;

interface Frame {
  image: HTMLImageElement;
  ready: boolean;
}

export class Mochi {
  state: ZeusBotState = "idle";

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frames = new Map<string, Frame>();
  private dpr = 1;

  // Smoothed properties — each eases toward a target derived per frame.
  private lookX = 0;
  private lookY = 0;
  private scale = 1;
  private offsetY = 0;
  private rotate = 0;
  private glowR = 0xe6;
  private glowG = 0xe9;
  private glowB = 0xee;

  private mouseX = 0;
  private mouseY = 0;
  private hasMouse = false;

  private startMs = 0;
  private running = false;
  private lastMs = 0;
  private gulpUntil = 0;

  /** Set by the island so the engine can request a repaint after stepping. */
  emit?: () => void;
  /** Where the mascot is on screen, so the gaze is relative to the body. */
  botCx = 0;
  botCy = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.preload();
  }

  private preload(): void {
    const seen = new Set<string>();
    for (const cfg of Object.values(BOT_STATES)) {
      if (seen.has(cfg.frame)) continue;
      seen.add(cfg.frame);
      const img = new Image();
      img.src = `/${cfg.frame}`;
      this.frames.set(cfg.frame, { image: img, ready: false });
      img.onload = () => {
        const entry = this.frames.get(cfg.frame);
        if (entry) entry.ready = true;
        // The island may already be on screen with a blank mascot.
        this.start();
      };
      img.onerror = () => console.error(`failed to load mascot frame ${cfg.frame}`);
    }
  }

  setState(next: ZeusBotState): void {
    if (this.state === next) return;
    this.state = next;
    this.startMs = performance.now();
    this.start();
  }

  setMouse(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
    this.hasMouse = true;
  }

  clearMouse(): void {
    this.hasMouse = false;
  }

  /** Squash-and-stretch, used when a decision lands. */
  gulp(): void {
    this.gulpUntil = performance.now() + 430;
    this.start();
  }

  // ── Frame loop ───────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = clamp((now - this.lastMs) / 1000, 0, 0.05);
    this.lastMs = now;
    this.step(dt, now);
    this.emit?.();
    // Looping states keep the loop alive on their own, otherwise breathing
    // stops mid-breath and the scan freezes.
    if (this.busy(now)) requestAnimationFrame(this.frame);
    else this.running = false;
  };

  private busy(now: number): boolean {
    const cfg = BOT_STATES[this.state];
    return (
      cfg.breathes ||
      cfg.scans ||
      cfg.bounces ||
      cfg.zz ||
      now < this.gulpUntil ||
      !this.settled()
    );
  }

  private settled(): boolean {
    const cfg = BOT_STATES[this.state];
    return (
      Math.abs(this.scale - cfg.amplitude) < 0.002 &&
      Math.abs(this.offsetY) < 0.05 &&
      Math.abs(this.rotate - (cfg.tilt + this.lookX * 0.018)) < 0.004 &&
      Math.abs(this.lookX - this.gazeTarget()[0]) < 0.004
    );
  }

  private gazeTarget(): [number, number] {
    const cfg = BOT_STATES[this.state];
    const t = performance.now() / 1000;
    if (cfg.scans) return [Math.sin(t * 2.6) * 0.6, -0.06];
    if (cfg.look) {
      if (!this.hasMouse) return [cfg.look[0], cfg.look[1]];
      const [lx, ly] = this.pointerLook();
      return [lx * 0.35 + cfg.look[0] * 0.55, ly * 0.3 + cfg.look[1] * 0.5];
    }
    if (this.state === "sleeping") return [0, -0.14];
    if (this.state === "interrupted") return [Math.sin(t * 9) * 0.25, 0];
    if (!this.hasMouse) return [0, 0];
    return this.pointerLook();
  }

  private pointerLook(): [number, number] {
    return [
      Math.tanh((this.mouseX - this.botCx) / 260) * 0.62,
      -Math.tanh((this.mouseY - this.botCy) / 200) * 0.5,
    ];
  }

  /** Called by the island each frame before drawing. */
  step(dt: number, now = performance.now()): void {
    const cfg = BOT_STATES[this.state];
    const t = now / 1000;

    const [tx, ty] = this.gazeTarget();
    // Gaze lags the body.
    this.lookX = smooth(this.lookX, tx, K_LOOK, dt);
    this.lookY = smooth(this.lookY, ty, K_LOOK, dt);

    let targetScale = cfg.amplitude;
    let targetOffsetY = 0;
    let targetRotate = cfg.tilt + this.lookX * 0.018;

    if (cfg.breathes) targetScale *= 1 + Math.sin(t * 1.6) * 0.035;
    if (cfg.bounces) targetOffsetY = -Math.abs(Math.sin(t * 5.2)) * 0.055;

    // Gulp: three keyframes of squash and stretch.
    const g = clamp((now - (this.gulpUntil - 430)) / 430, 0, 1);
    if (g > 0 && g < 1) {
      targetScale *= g < 0.19 ? lerp(0.78, 1, g / 0.19) : g < 0.49 ? lerp(1.18, 0.92, (g - 0.19) / 0.3) : lerp(0.92, 1, (g - 0.49) / 0.51);
    }

    // Errors shake for a quarter second on entry, then rest.
    const sinceEntry = (now - this.startMs) / 1000;
    if ((this.state === "error" || this.state === "interrupted") && sinceEntry < 0.28) {
      targetRotate += Math.sin(sinceEntry * 42) * 0.06;
    }

    this.scale = smooth(this.scale, targetScale, K_GEN, dt);
    this.offsetY = smooth(this.offsetY, targetOffsetY, K_GEN, dt);
    this.rotate = smooth(this.rotate, targetRotate, K_GEN, dt);

    const [r, gg, b] = hexToRgb(cfg.color);
    this.glowR = smooth(this.glowR, r, K_COLOR, dt);
    this.glowG = smooth(this.glowG, gg, K_COLOR, dt);
    this.glowB = smooth(this.glowB, b, K_COLOR, dt);
  }

  /** `cx`/`cy` are the mascot centre in CSS pixels within the canvas. */
  draw(cx: number, cy: number, diameter: number): void {
    this.botCx = cx;
    this.botCy = cy;
    const cfg = BOT_STATES[this.state];

    // The frame overhangs its box so scaling and the halo are not clipped.
    const box = diameter * 1.35;
    const need = Math.ceil(box * this.dpr);
    if (this.canvas.width !== need || this.canvas.height !== need) {
      this.canvas.width = need;
      this.canvas.height = need;
    }
    this.canvas.style.width = `${box}px`;
    this.canvas.style.height = `${box}px`;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, box, box);

    ctx.save();
    ctx.translate(cx, cy);

    // ── Halo: the only real glow in the design ─────────────────────────
    const g = ctx.createRadialGradient(0, 0, diameter * 0.12, 0, 0, diameter * 1.05);
    const gr = Math.round(this.glowR);
    const gc = Math.round(this.glowG);
    const gb = Math.round(this.glowB);
    g.addColorStop(0, `rgba(${gr},${gc},${gb},${cfg.glow})`);
    g.addColorStop(0.62, `rgba(${gr},${gc},${gb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, diameter * 1.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(this.rotate);
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.lookX * diameter * 0.05, this.lookY * diameter * 0.04 + this.offsetY);

    const entry = this.frames.get(cfg.frame);
    if (entry?.ready) {
      ctx.drawImage(entry.image, -box / 2, -box / 2, box, box);
    }
    ctx.restore();

    // Ambient particle: a rising "z" while sleeping.
    if (cfg.zz) {
      const phase = (performance.now() / 1000) % 3;
      ctx.globalAlpha = clamp(1 - phase / 3, 0, 1) * 0.8;
      ctx.fillStyle = "#8E939C";
      ctx.font = `700 ${Math.round(diameter * 0.22)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("z", box / 2 - diameter * 0.2, -box / 2 + diameter * (0.3 - phase * 0.4));
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    this.drawBadge(cfg.badge, cfg.color, box, diameter);
  }

  private drawBadge(kind: string, color: string, box: number, diameter: number): void {
    if (kind === "none") return;
    const ctx = this.ctx;
    const bx = box / 2 - diameter * 0.08;
    const by = -box / 2 + diameter * 0.12;
    const r = diameter * 0.15;

    ctx.save();
    if (kind === "dots") {
      ctx.fillStyle = color;
      const phase = (performance.now() / 1000) * 3.2;
      for (let i = 0; i < 3; i++) {
        const p = phase - i * 0.28;
        const bounce = p <= 0 ? 0 : Math.sin(p * Math.PI);
        ctx.beginPath();
        ctx.arc(bx - r + i * r, by - bounce * r * 0.5, r * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.fillStyle = `${color}2e`;
    ctx.strokeStyle = `${color}8c`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = `800 ${Math.round(r * 1.25)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (kind === "bang") ctx.fillText("!", bx, by + 0.5);
    else if (kind === "question") ctx.fillText("?", bx, by + 0.5);
    else {
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
