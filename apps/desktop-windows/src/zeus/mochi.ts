// The Zeus mascot renderer.
// Handles state-driven illustrations, natural blinking, gaze tracking,
// cursor hover (love/hearts), poking/slapping (dizzy on 3 clicks), and idle sleeping.

import { clamp, smooth } from "../core/anim";
import { Sound } from "../core/sound";
import { BOT_STATES, type ZeusBotState } from "./frames";

const K_GEN = 0.11;
const K_LOOK = 0.16;

interface Frame {
  image: HTMLImageElement;
  ready: boolean;
}

interface Particle {
  type: "heart" | "z" | "star";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color?: string;
}

export class Mochi {
  state: ZeusBotState = "idle";
  private baseState: ZeusBotState = "idle";

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frames = new Map<string, Frame>();
  private dpr = 1;

  // Smoothed properties
  private lookX = 0;
  private lookY = 0;
  private scale = 1;
  private offsetY = 0;
  private rotate = 0;

  private mouseX = -1000;
  private mouseY = -1000;
  private hasMouse = false;

  private startMs = 0;
  private running = false;
  private lastMs = 0;
  private gulpUntil = 0;

  // Interactivity: Blinking
  private nextBlinkMs = 0;
  private blinkUntilMs = 0;

  // Interactivity: Slap / Dizzy
  private slapCount = 0;
  private lastSlapMs = 0;
  private dizzyUntilMs = 0;

  // Interactivity: Hover / Love
  private isHovered = false;
  private hoverStartMs = 0;
  private loveUntilMs = 0;
  private lastLoveMs = 0;

  // Interactivity: Idle sleep
  private lastActivityMs = performance.now();
  private isSleeping = false;

  // Particles
  private particles: Particle[] = [];

  /** Set by the island so the engine can request a repaint after stepping. */
  emit?: () => void;
  botCx = 0;
  botCy = 0;
  currentDiameter = 56;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.scheduleNextBlink();
    this.preload();
  }

  private preload(): void {
    const list = [
      "idle.png",
      "working.png",
      "thinking.png",
      "look_left.png",
      "look_right.png",
      "sleep.png",
      "error.png",
      "blink.png",
      "waiting_aproval.png",
      "face.png",
      "face_blink.png",
    ];

    for (const file of list) {
      const img = new Image();
      img.src = `/${file}`;
      this.frames.set(file, { image: img, ready: false });
      img.onload = () => {
        const entry = this.frames.get(file);
        if (entry) entry.ready = true;
        this.start();
      };
      img.onerror = () => console.error(`failed to load mascot frame ${file}`);
    }
  }

  setState(next: ZeusBotState): void {
    if (this.baseState === next && this.state === next) return;
    this.baseState = next;
    // Don't interrupt dizzy or love temporarily
    const now = performance.now();
    if (now >= this.dizzyUntilMs && now >= this.loveUntilMs) {
      this.state = next;
    }
    this.startMs = now;
    this.lastActivityMs = now;
    this.isSleeping = next === "sleeping";
    this.start();
  }

  setMouse(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
    this.hasMouse = true;
    this.lastActivityMs = performance.now();

    // If sleeping due to inactivity, wake up!
    if (this.isSleeping && this.baseState !== "sleeping") {
      this.isSleeping = false;
      this.state = this.baseState;
      this.blinkUntilMs = performance.now() + 250;
      Sound.play("happy");
      this.start();
    }

    // Check if mouse is hovering over the mascot
    const distSq = (x - this.botCx) ** 2 + (y - this.botCy) ** 2;
    const radius = this.currentDiameter * 0.52;
    const over = distSq <= radius * radius;

    const now = performance.now();
    if (over && !this.isHovered) {
      this.isHovered = true;
      this.hoverStartMs = now;
      this.blinkUntilMs = now + 160;
      Sound.play("blip");
      this.start();
    } else if (!over && this.isHovered) {
      this.isHovered = false;
      this.hoverStartMs = 0;
    }

    // Trigger love if hovered continuously for 1.8s
    if (
      this.isHovered &&
      this.hoverStartMs > 0 &&
      now - this.hoverStartMs >= 1800 &&
      now - this.lastLoveMs > 5000 &&
      now >= this.dizzyUntilMs
    ) {
      this.triggerLove();
    }
  }

  clearMouse(): void {
    this.hasMouse = false;
    this.isHovered = false;
    this.hoverStartMs = 0;
  }

  poke(): void {
    const now = performance.now();
    this.lastActivityMs = now;

    // Wake up if asleep
    if (this.isSleeping) {
      this.isSleeping = false;
      this.state = this.baseState;
      this.blinkUntilMs = now + 250;
      Sound.play("happy");
      this.start();
      return;
    }

    // Check rapid slaps
    if (now - this.lastSlapMs < 1200) {
      this.slapCount++;
    } else {
      this.slapCount = 1;
    }
    this.lastSlapMs = now;

    if (this.slapCount >= 3) {
      // 3 clicks -> dizzy!
      this.triggerDizzy();
    } else {
      // Regular poke
      Sound.play("poke");
      this.gulp();
    }
  }

  gulp(): void {
    this.gulpUntil = performance.now() + 380;
    this.start();
  }

  private triggerDizzy(): void {
    const now = performance.now();
    this.slapCount = 0;
    this.dizzyUntilMs = now + 3200;
    this.state = "dizzy";
    Sound.play("dizzy");

    // Spawn dizzy stars
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      this.particles.push({
        type: "star",
        x: Math.cos(angle) * this.currentDiameter * 0.4,
        y: Math.sin(angle) * this.currentDiameter * 0.3 - this.currentDiameter * 0.25,
        vx: (Math.random() - 0.5) * 15,
        vy: -10 - Math.random() * 10,
        age: 0,
        life: 2.8,
        size: 8 + Math.random() * 4,
        color: "#FBBF24",
      });
    }
    this.start();
  }

  private triggerLove(): void {
    const now = performance.now();
    this.lastLoveMs = now;
    this.loveUntilMs = now + 2400;
    this.state = "love";
    Sound.play("love");
    this.gulp();

    // Spawn floating hearts
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        this.particles.push({
          type: "heart",
          x: (Math.random() - 0.5) * this.currentDiameter * 0.6,
          y: -this.currentDiameter * 0.2,
          vx: (Math.random() - 0.5) * 20,
          vy: -35 - Math.random() * 25,
          age: 0,
          life: 2.0,
          size: 10 + Math.random() * 6,
          color: "#F472B6",
        });
        this.start();
      }, i * 160);
    }
  }

  private scheduleNextBlink(): void {
    const now = performance.now();
    // Blink every 3.5 to 6.5 seconds
    this.nextBlinkMs = now + 3500 + Math.random() * 3000;
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

    if (this.busy(now)) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
    }
  };

  private busy(now: number): boolean {
    const cfg = BOT_STATES[this.state];
    return (
      cfg.breathes ||
      cfg.scans ||
      cfg.bounces ||
      cfg.zz ||
      now < this.gulpUntil ||
      now < this.dizzyUntilMs ||
      now < this.loveUntilMs ||
      now < this.blinkUntilMs ||
      this.particles.length > 0 ||
      this.isHovered ||
      !this.settled()
    );
  }

  private settled(): boolean {
    const cfg = BOT_STATES[this.state];
    return (
      Math.abs(this.scale - cfg.amplitude) < 0.003 &&
      Math.abs(this.offsetY) < 0.05 &&
      Math.abs(this.rotate) < 0.005 &&
      Math.abs(this.lookX - this.gazeTarget()[0]) < 0.005
    );
  }

  private gazeTarget(): [number, number] {
    const now = performance.now();
    if (now < this.dizzyUntilMs) return [Math.sin(now / 100) * 0.4, 0];
    if (this.state === "sleeping") return [0, 0];

    const cfg = BOT_STATES[this.state];
    const t = now / 1000;
    if (cfg.scans) return [Math.sin(t * 2.8) * 0.6, -0.05];
    if (cfg.look) return [cfg.look[0], cfg.look[1]];

    if (!this.hasMouse) return [0, 0];
    return this.pointerLook();
  }

  private pointerLook(): [number, number] {
    return [
      Math.tanh((this.mouseX - this.botCx) / 240) * 0.65,
      -Math.tanh((this.mouseY - this.botCy) / 180) * 0.5,
    ];
  }

  step(dt: number, now = performance.now()): void {
    // Check dizzy recovery
    if (this.state === "dizzy" && now >= this.dizzyUntilMs) {
      this.state = this.baseState;
    }
    // Check love recovery
    if (this.state === "love" && now >= this.loveUntilMs) {
      this.state = this.baseState;
    }

    // Natural blinking
    if (now >= this.nextBlinkMs && this.state !== "sleeping" && this.state !== "dizzy") {
      this.blinkUntilMs = now + 180;
      this.scheduleNextBlink();
    }

    // Inactivity -> auto sleeping after 50 seconds in idle
    if (
      this.baseState === "idle" &&
      !this.isSleeping &&
      now - this.lastActivityMs > 50000 &&
      !this.hasMouse
    ) {
      this.isSleeping = true;
      this.state = "sleeping";
    }

    const cfg = BOT_STATES[this.state];
    const t = now / 1000;

    const [tx, ty] = this.gazeTarget();
    this.lookX = smooth(this.lookX, tx, K_LOOK, dt);
    this.lookY = smooth(this.lookY, ty, K_LOOK, dt);

    let targetScale = cfg.amplitude;
    let targetOffsetY = 0;
    let targetRotate = cfg.tilt + this.lookX * 0.035;

    // State specific animations
    if (this.state === "dizzy") {
      targetRotate = Math.sin(t * 32) * 0.16;
      targetOffsetY = Math.cos(t * 20) * 2;
    } else if (this.state === "working") {
      // Gentle laptop typing paws tap
      targetOffsetY = Math.sin(t * 12) * 1.2;
    } else if (cfg.breathes || this.state === "sleeping") {
      targetScale *= 1 + Math.sin(t * 1.5) * 0.03;
    } else if (cfg.bounces || this.state === "approval") {
      targetOffsetY = -Math.abs(Math.sin(t * 5.6)) * 4.5;
    }

    if (this.isHovered) {
      targetScale *= 1.08;
    }

    // Gulp squash and stretch on poke
    const g = clamp((now - (this.gulpUntil - 380)) / 380, 0, 1);
    if (g > 0 && g < 1) {
      targetScale *= g < 0.2 ? lerp(0.82, 1, g / 0.2) : g < 0.5 ? lerp(1.18, 0.94, (g - 0.2) / 0.3) : lerp(0.94, 1, (g - 0.5) / 0.5);
    }

    this.scale = smooth(this.scale, targetScale, K_GEN, dt);
    this.offsetY = smooth(this.offsetY, targetOffsetY, K_GEN, dt);
    this.rotate = smooth(this.rotate, targetRotate, K_GEN, dt);

    // The badge used to be a coloured disc drawn out past the silhouette at
    // (0.38, -0.34) of the diameter. On a black panel it no longer read as part
    // of the character — it looked like a floating dot hovering over the dog's
    // head, which is exactly what it was: a separate object at a separate
    // position. State is carried by the frame itself plus the label in the
    // header, so the canvas draws no overlay.
    //
    // The shadow is black, so the per-state colour no longer has a use here.
    // `cfg.color` still drives the badge and the ring at the call site; this
    // smooth was only ever feeding the tinted halo, which is gone.

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
      }
    }

    // Ambient sleeping Z particle
    if (this.state === "sleeping" && Math.random() < 0.02) {
      this.particles.push({
        type: "z",
        x: this.currentDiameter * 0.25 + (Math.random() - 0.5) * 10,
        y: -this.currentDiameter * 0.25,
        vx: 8 + Math.random() * 6,
        vy: -18 - Math.random() * 10,
        age: 0,
        life: 2.2,
        size: 13,
        color: "#94A3B8",
      });
    }
  }

  /** Chooses the correct frame based on state, gaze direction, and blinking. */
  private selectFrame(now: number): string {
    if (now < this.dizzyUntilMs) {
      return "error.png";
    }

    // Blinking
    if (now < this.blinkUntilMs && this.state !== "sleeping") {
      return "blink.png";
    }

    if (this.state === "sleeping") return "sleep.png";
    if (this.state === "working") return "working.png";
    if (this.state === "thinking") return "thinking.png";
    if (this.state === "approval" || this.state === "question") return "waiting_aproval.png";
    if (this.state === "error" || this.state === "interrupted") return "error.png";
    if (this.state === "finished" || this.state === "love") return "blink.png";

    // In compact mode, render the close-up face avatar icon
    if (this.currentDiameter <= 32) {
      if (now < this.blinkUntilMs) {
        return "face_blink.png";
      }
      return "face.png";
    }

    // Idle or searching gaze-tracking frames
    if (this.lookX < -0.16) {
      return "look_left.png";
    } else if (this.lookX > 0.16) {
      return "look_right.png";
    }

    return "idle.png";
  }

  /**
   * Draws the mascot centered in the canvas.
   * `diameter` is the rendered CSS diameter of the mascot.
   */
  draw(diameter: number): void {
    this.currentDiameter = diameter;
    const now = performance.now();
    const frameFile = this.selectFrame(now);
    const cfg = BOT_STATES[this.state];

    // Canvas size accommodates the mascot plus halo glow and headroom for particles
    // A zero-size mascot means "hidden" — nothing to paint. Drawing a radial
    // gradient at r=0 is what was crashing the canvas.
    if (diameter <= 0) return;
    const box = Math.ceil(diameter * 1.6);
    const need = Math.ceil(box * this.dpr);
    if (this.canvas.width !== need || this.canvas.height !== need) {
      this.canvas.width = need;
      this.canvas.height = need;
    }
    this.canvas.style.width = `${box}px`;
    this.canvas.style.height = `${box}px`;

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, box, box);

    const cx = box / 2;
    const cy = box / 2;

    ctx.save();
    ctx.translate(cx, cy);

    // ── Contact shadow ───────────────────────────────────────────────────
    // Now the panel itself is black, so a translucent tint behind the mascot
    // has nothing to be a tint *against*: it reads as a separate coloured blob
    // floating over the silhouette rather than as depth behind it. A shadow's
    // job is to darken what is already there, and here there is nothing left to
    // darken. Drawn in black instead — and only below centre — it grounds the
    // silhouette by putting a soft edge against the eyes and rim light without
    // ever adding a hue of its own.
    const haloRadius = diameter * 0.62;

    // The gap between the inner and outer radius is the blur. At 0.2 → 0.42 the
    // ramp was narrow enough to read as a hard ring hugging the dog. Widening
    // it to 0.08 → 0.62 spreads the same alpha over most of the disc, so the
    // falloff is gradual and there is no edge to see.
    const g = ctx.createRadialGradient(
      0,
      diameter * 0.1,
      diameter * 0.08,
      0,
      diameter * 0.1,
      haloRadius,
    );
    g.addColorStop(0, `rgba(0,0,0,${cfg.glow})`);
    g.addColorStop(0.45, `rgba(0,0,0,${cfg.glow * 0.45})`);
    g.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
    ctx.fill();

    // ── Mascot illustration ───────────────────────────────────────────
    ctx.save();
    ctx.rotate(this.rotate);
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.lookX * diameter * 0.04, this.lookY * diameter * 0.03 + this.offsetY);

    const entry = this.frames.get(frameFile);
    if (entry?.ready) {
      // Draw centered with true proportions
      ctx.drawImage(entry.image, -diameter / 2, -diameter / 2, diameter, diameter);
    }
    ctx.restore();

    // ── Particles ─────────────────────────────────────────────────────
    this.drawParticles(ctx, diameter);

    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, diameter: number): void {
    for (const p of this.particles) {
      const alpha = clamp(1 - p.age / p.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);

      if (p.type === "heart") {
        ctx.fillStyle = p.color || "#F472B6";
        this.drawHeart(ctx, p.size);
      } else if (p.type === "star") {
        ctx.fillStyle = p.color || "#FBBF24";
        this.drawStar(ctx, p.size);
      } else if (p.type === "z") {
        ctx.fillStyle = p.color || "#94A3B8";
        ctx.font = `700 ${Math.round(p.size)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("z", 0, 0);
      }
      ctx.restore();
    }
  }

  private drawHeart(ctx: CanvasRenderingContext2D, s: number): void {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.3);
    ctx.bezierCurveTo(-s * 0.5, -s * 0.3, -s, s * 0.1, 0, s);
    ctx.bezierCurveTo(s, s * 0.1, s * 0.5, -s * 0.3, 0, s * 0.3);
    ctx.fill();
  }

  private drawStar(ctx: CanvasRenderingContext2D, s: number): void {
    const spikes = 5;
    const outer = s;
    const inner = s * 0.45;
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(0, -outer);
    for (let i = 0; i < spikes; i++) {
      let x = Math.cos(rot) * outer;
      let y = Math.sin(rot) * outer;
      ctx.lineTo(x, y);
      rot += step;

      x = Math.cos(rot) * inner;
      y = Math.sin(rot) * inner;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(0, -outer);
    ctx.closePath();
    ctx.fill();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
