// Animation primitives. Growth overshoots, shrink does not — never the reverse.
// That asymmetry is what makes the island read as a physical object instead of
// a dropdown.

/** Easings, mirroring the reference prototype's table. */
export const Ease = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => {
    const c1 = 1.7;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  lin: (t: number) => t,
  easeIn: (t: number) => t * t * t,
};

/** Cubic bezier solved by bisection — no CSS engine needed. */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const A = (a: number, b: number) => 1 - 3 * b + 3 * a;
  const B = (a: number, b: number) => 3 * b - 6 * a;
  const C = (a: number) => 3 * a;
  const calc = (t: number, a: number, b: number) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t: number, a: number, b: number) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 12; i++) {
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      const err = calc(t, x1, x2) - x;
      if (Math.abs(err) < 1e-6) break;
      t -= err / d;
    }
    return calc(t, y1, y2);
  };
}

/** Close curve from the reference app: .timingCurve(0.45, 0, 0.2, 1). */
export const closeCurve = cubicBezier(0.45, 0, 0.2, 1);

/** Second-order spring, integrated per frame and sub-stepped to 240 Hz so a
 *  dropped frame can never destabilise it. `response` maps to ω₀ = 2π/response
 *  and `damping` to the damping ratio — the same parameterisation as the
 *  SwiftUI spring the design came from. */
export class Spring {
  value: number;
  target: number;
  velocity = 0;

  private omega = (2 * Math.PI) / 0.5;
  private zeta = 0.72;

  constructor(value: number, response = 0.5, damping = 0.72) {
    this.value = value;
    this.target = value;
    this.tune(response, damping);
  }

  tune(response: number, damping: number): void {
    this.omega = (2 * Math.PI) / response;
    this.zeta = damping;
  }

  step(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc =
        this.omega * this.omega * (this.target - this.value) -
        2 * this.zeta * this.omega * this.velocity;
      this.velocity += acc * h;
      this.value += this.velocity * h;
    }
  }

  get settled(): boolean {
    return Math.abs(this.target - this.value) < 0.01 && Math.abs(this.velocity) < 0.05;
  }
}

/** A value driven either by a spring (growing) or a timed curve (shrinking). */
export class Tracked {
  value: number;
  target: number;

  private readonly spring: Spring;
  private curveFrom = 0;
  private curveT = 1;
  private curveDur = 0.34;
  private curveFn: (t: number) => number = closeCurve;
  private mode: "spring" | "curve" = "spring";

  constructor(value: number) {
    this.value = value;
    this.target = value;
    this.spring = new Spring(value);
  }

  /** Grow: spring, so it overshoots slightly. */
  springTo(v: number, response = 0.5, damping = 0.72): void {
    this.target = v;
    this.mode = "spring";
    this.spring.value = this.value;
    this.spring.velocity = 0;
    this.spring.target = v;
    this.spring.tune(response, damping);
  }

  /** Shrink: timed curve, so it settles without bouncing. */
  curveTowards(v: number, durationMs = 340, fn = closeCurve): void {
    if (v === this.target && this.mode === "curve") return;
    this.target = v;
    this.mode = "curve";
    this.curveFrom = this.value;
    this.curveT = 0;
    this.curveDur = durationMs / 1000;
    this.curveFn = fn;
  }

  step(dt: number): void {
    if (this.mode === "spring") {
      this.spring.target = this.target;
      this.spring.step(dt);
      this.value = this.spring.value;
      this.curveT = 1;
      return;
    }
    if (this.curveT >= 1) {
      this.value = this.target;
      return;
    }
    this.curveT = Math.min(1, this.curveT + dt / this.curveDur);
    this.value = this.curveFrom + (this.target - this.curveFrom) * this.curveFn(this.curveT);
  }

  get animating(): boolean {
    if (this.mode === "curve") return this.curveT < 1;
    return Math.abs(this.target - this.value) > 0.01;
  }
}

/** Frame-rate independent exponential smoothing. `halfLife` is the time in
 *  seconds for the remaining error to halve. */
export function smooth(current: number, target: number, halfLife: number, dt: number): number {
  const k = 1 - Math.pow(0.5, dt / halfLife);
  return current + (target - current) * k;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

