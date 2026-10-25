/* ==================================================================== *
 *  PROCEDURAL AUDIO — no samples, everything synthesised on the fly.
 * ==================================================================== */
export class RoomAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
    this.preset = 'golden';
    this._birdTimer = 4;
  }

  init() {
    if (this.ready) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    this.ctx = ac;

    this.master = ac.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ac.destination);

    /* --- noise source --- */
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.2;
    }
    this.noiseBuffer = buf;

    /* --- room tone --- */
    const tone = ac.createBufferSource();
    tone.buffer = buf;
    tone.loop = true;
    const toneFilter = ac.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 380;
    this.ambientGain = ac.createGain();
    this.ambientGain.gain.value = 0.05;
    tone.connect(toneFilter).connect(this.ambientGain).connect(this.master);
    tone.start();

    /* --- airy hiss layer --- */
    const hiss = ac.createBufferSource();
    hiss.buffer = buf;
    hiss.loop = true;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const hissGain = ac.createGain();
    hissGain.gain.value = 0.006;
    hiss.connect(hp).connect(hissGain).connect(this.master);
    hiss.start();

    this.ready = true;
  }

  _noise(dur = 0.2, { type = 'lowpass', freq = 800, q = 1, gain = 0.2, decay = 0.12, pitch = 1 } = {}) {
    if (!this.ready || !this.enabled) return;
    const ac = this.ctx;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = pitch;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, { type = 'sine', gain = 0.05, sweep = 0, delay = 0 } = {}) {
    if (!this.ready || !this.enabled) return;
    const ac = this.ctx;
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  step(running = false, crouching = false) {
    if (!this.ready || !this.enabled) return;
    const soft = crouching ? 0.35 : running ? 1 : 0.75;
    const pitch = 0.85 + Math.random() * 0.3;
    this._noise(0.16, { type: 'lowpass', freq: 620, q: 0.8, gain: 0.16 * soft, decay: 0.11, pitch });
    this._tone(90 + Math.random() * 40, 0.1, { type: 'triangle', gain: 0.05 * soft });
    this._noise(0.07, { type: 'highpass', freq: 2600, gain: 0.03 * soft, decay: 0.05, pitch: 1.1 });
  }

  click(on = true) {
    this._noise(0.03, { type: 'highpass', freq: 3200, gain: 0.14, decay: 0.025 });
    this._tone(on ? 1180 : 780, 0.05, { type: 'square', gain: 0.028 });
  }

  beep(up = true) {
    this._tone(up ? 880 : 620, 0.09, { type: 'sine', gain: 0.05, sweep: up ? 260 : -220 });
  }

  swish() {
    this._noise(0.5, { type: 'bandpass', freq: 900, q: 0.7, gain: 0.09, decay: 0.42, pitch: 0.8 });
  }

  /** called every frame: occasional distant birds when the sun is up */
  update(dt) {
    if (!this.ready || !this.enabled) return;
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 7 + Math.random() * 14;
      if (this.preset === 'day') {
        const base = 2300 + Math.random() * 900;
        const n = 2 + ((Math.random() * 3) | 0);
        for (let i = 0; i < n; i++) {
          this._tone(base, 0.09, { type: 'sine', gain: 0.022, sweep: -420, delay: i * 0.11 });
        }
      } else if (Math.random() < 0.5) {
        const base = 1750 + Math.random() * 500;
        this._tone(base, 0.14, { type: 'sine', gain: 0.016, sweep: -300 });
      }
    }
    this.ambientGain.gain.value = 0.045 + Math.sin(performance.now() * 0.00013) * 0.008;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.85 : 0;
  }

  setPreset(name) {
    this.preset = name;
  }
}
