// Весь звук синтезируется через WebAudio — ни одного мегабайта ассетов,
// игра грузится мгновенно. Выстрелы, шаги, попадания, зона, самолёт.

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.65;
    this.muted = false;
    this._noise = null;
    this._plane = null;
    this._zone = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this._makeNoise();
  }

  _makeNoise() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  _noiseBurst({ dur = 0.15, freq = 1200, q = 0.8, gain = 0.4, type = 'bandpass', decay = 0.9 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.playbackRate.value = 1 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * decay);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone({ freq = 440, dur = 0.12, gain = 0.2, type = 'sine', slide = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'rifle':
        this._noiseBurst({ dur: 0.19, freq: 900, q: 0.7, gain: 0.34 });
        this._tone({ freq: 150, dur: 0.13, gain: 0.22, type: 'triangle', slide: -90 });
        break;
      case 'sniper':
        this._noiseBurst({ dur: 0.5, freq: 700, q: 0.5, gain: 0.5, decay: 1.2 });
        this._tone({ freq: 110, dur: 0.3, gain: 0.3, type: 'triangle', slide: -80 });
        break;
      case 'shotgun':
        this._noiseBurst({ dur: 0.32, freq: 500, q: 0.4, gain: 0.45 });
        this._tone({ freq: 90, dur: 0.2, gain: 0.28, type: 'triangle', slide: -50 });
        break;
      case 'pistol':
        this._noiseBurst({ dur: 0.13, freq: 1500, q: 1, gain: 0.24 });
        this._tone({ freq: 220, dur: 0.08, gain: 0.14, type: 'square', slide: -100 });
        break;
      case 'empty':
        this._tone({ freq: 1400, dur: 0.05, gain: 0.1, type: 'square' });
        break;
      case 'hit':
        this._tone({ freq: 1800, dur: 0.05, gain: 0.16, type: 'square', slide: -600 });
        break;
      case 'headshot':
        this._tone({ freq: 2300, dur: 0.14, gain: 0.2, type: 'sine', slide: -900 });
        break;
      case 'kill':
        this._tone({ freq: 700, dur: 0.1, gain: 0.16, type: 'triangle' });
        setTimeout(() => this._tone({ freq: 1050, dur: 0.14, gain: 0.16, type: 'triangle' }), 90);
        break;
      case 'pickup':
        this._tone({ freq: 620, dur: 0.08, gain: 0.14, type: 'triangle', slide: 320 });
        break;
      case 'reload':
        this._noiseBurst({ dur: 0.08, freq: 2500, q: 2, gain: 0.18 });
        setTimeout(() => this._noiseBurst({ dur: 0.08, freq: 1800, q: 2, gain: 0.18 }), (opts.dur || 2) * 700);
        break;
      case 'switch':
        this._noiseBurst({ dur: 0.09, freq: 3000, q: 2, gain: 0.14 });
        break;
      case 'step':
        this._noiseBurst({ dur: 0.1, freq: 420, q: 1.2, gain: 0.12, type: 'lowpass' });
        break;
      case 'stepFast':
        this._noiseBurst({ dur: 0.1, freq: 520, q: 1.2, gain: 0.15, type: 'lowpass' });
        break;
      case 'jump':
        this._noiseBurst({ dur: 0.12, freq: 300, q: 0.8, gain: 0.1, type: 'lowpass' });
        break;
      case 'land':
        this._noiseBurst({ dur: 0.18, freq: 220, q: 0.8, gain: 0.22, type: 'lowpass' });
        break;
      case 'heal':
        this._tone({ freq: 420, dur: 0.5, gain: 0.12, type: 'sine', slide: 380 });
        break;
      case 'healed':
        this._tone({ freq: 700, dur: 0.2, gain: 0.14, type: 'sine', slide: 260 });
        break;
      case 'hurt':
        this._noiseBurst({ dur: 0.18, freq: 220, q: 0.6, gain: 0.3, type: 'lowpass' });
        break;
      case 'chute':
        this._noiseBurst({ dur: 0.6, freq: 600, q: 0.6, gain: 0.18, type: 'lowpass' });
        break;
      case 'zoneTick':
        this._tone({ freq: 150, dur: 0.25, gain: 0.12, type: 'sawtooth', slide: -50 });
        break;
      case 'planeJump':
        this._noiseBurst({ dur: 0.8, freq: 400, q: 0.5, gain: 0.2, type: 'lowpass' });
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone({ freq: f, dur: 0.3, gain: 0.18, type: 'triangle' }), i * 160));
        break;
      case 'lose':
        this._tone({ freq: 320, dur: 0.7, gain: 0.2, type: 'triangle', slide: -180 });
        break;
      case 'crate':
        this._tone({ freq: 260, dur: 0.5, gain: 0.2, type: 'sawtooth', slide: -120 });
        break;
      default: break;
    }
  }

  /** Гул самолёта — зацикленный шум с фильтром. */
  setPlane(on) {
    if (!this.ctx) return;
    if (on && !this._plane) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 1.2);
      src.connect(filt).connect(g).connect(this.master);
      src.start();
      this._plane = { src, g };
    } else if (!on && this._plane) {
      const { src, g } = this._plane;
      g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.8);
      setTimeout(() => { try { src.stop(); } catch (e) { /* уже остановлен */ } }, 900);
      this._plane = null;
    }
  }
}
