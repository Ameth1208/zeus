// Web Audio sound synthesizer for Zeus Desktop.
// Generates responsive, tactile UI feedback with zero external dependencies.

class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private volume = 0.5;

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  play(kind: "blip" | "approve" | "deny" | "open" | "close" | "poke" | "love" | "dizzy" | "tick" | "happy"): void {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(this.volume * 0.35, now);
      gain.connect(ctx.destination);

      switch (kind) {
        case "blip": {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(520, now);
          osc.frequency.exponentialRampToValueAtTime(740, now + 0.07);
          gain.gain.setValueAtTime(this.volume * 0.25, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
          osc.connect(gain);
          osc.start(now);
          osc.stop(now + 0.08);
          break;
        }

        case "poke": {
          const osc = ctx.createOscillator();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(360, now);
          osc.frequency.exponentialRampToValueAtTime(680, now + 0.09);
          gain.gain.setValueAtTime(this.volume * 0.35, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
          osc.connect(gain);
          osc.start(now);
          osc.stop(now + 0.11);
          break;
        }

        case "open": {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(260, now);
          osc.frequency.exponentialRampToValueAtTime(580, now + 0.15);
          gain.gain.setValueAtTime(0.01, now);
          gain.gain.linearRampToValueAtTime(this.volume * 0.25, now + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
          osc.connect(gain);
          osc.start(now);
          osc.stop(now + 0.18);
          break;
        }

        case "close": {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(480, now);
          osc.frequency.exponentialRampToValueAtTime(220, now + 0.13);
          gain.gain.setValueAtTime(this.volume * 0.22, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
          osc.connect(gain);
          osc.start(now);
          osc.stop(now + 0.14);
          break;
        }

        case "approve": {
          const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
          notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const noteGain = ctx.createGain();
            const start = now + idx * 0.06;
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, start);
            noteGain.gain.setValueAtTime(this.volume * 0.28, start);
            noteGain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
            osc.connect(noteGain);
            noteGain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 0.19);
          });
          break;
        }

        case "deny": {
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(280, now);
          osc.frequency.exponentialRampToValueAtTime(160, now + 0.16);
          gain.gain.setValueAtTime(this.volume * 0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
          osc.connect(gain);
          osc.start(now);
          osc.stop(now + 0.17);
          break;
        }

        case "happy":
        case "love": {
          const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5
          notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const noteGain = ctx.createGain();
            const start = now + idx * 0.07;
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, start);
            noteGain.gain.setValueAtTime(this.volume * 0.26, start);
            noteGain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
            osc.connect(noteGain);
            noteGain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 0.25);
          });
          break;
        }

        case "dizzy": {
          const osc = ctx.createOscillator();
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();

          lfo.frequency.setValueAtTime(14, now); // 14 Hz warble
          lfoGain.gain.setValueAtTime(80, now);
          lfo.connect(lfoGain);
          lfoGain.connect(osc.frequency);

          osc.type = "sine";
          osc.frequency.setValueAtTime(420, now);
          gain.gain.setValueAtTime(this.volume * 0.28, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
          osc.connect(gain);

          lfo.start(now);
          osc.start(now);
          lfo.stop(now + 0.45);
          osc.stop(now + 0.45);
          break;
        }

        case "tick": {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(880, now);
          gain.gain.setValueAtTime(this.volume * 0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
          osc.connect(gain);
          osc.start(now);
          osc.stop(now + 0.02);
          break;
        }
      }
    } catch {
      // Audio context might be restricted before first interaction
    }
  }
}

export const Sound = new SoundEngine();
