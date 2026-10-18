/**
 * All audio is synthesised with WebAudio at runtime: weapons, explosions,
 * a dynamic industrial soundtrack and an EVA-style announcer (speech synthesis).
 */

type Voice = (a: AudioEngine, t: number, gain: number) => void;

export interface AudioSettings {
  sfx: number;
  music: number;
  voice: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private shaper!: WaveShaperNode;
  private lastPlay = new Map<string, number>();
  private active = 0;
  settings: AudioSettings = { sfx: 0.7, music: 0.45, voice: true };
  private music: Music | null = null;
  private evaQueue: string[] = [];
  private speaking = false;
  /** 0..1 combat intensity, drives the soundtrack. */
  intensity = 0;

  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.applySettings();
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    this.shaper.curve = curve;
    this.shaper.connect(this.musicBus);
  }

  applySettings(): void {
    if (!this.ctx) return;
    this.sfxBus.gain.value = this.settings.sfx;
    this.musicBus.gain.value = this.settings.music;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  // ---------------------------------------------------------------- primitives

  noiseBurst(t: number, dur: number, gain: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1, dest?: AudioNode): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = c.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src
      .connect(flt)
      .connect(g)
      .connect(dest ?? this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone(t: number, dur: number, gain: number, type: OscillatorType, f0: number, f1 = f0, dest?: AudioNode, attack = 0.003): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  distorted(): AudioNode {
    return this.shaper;
  }

  get musicOut(): GainNode {
    return this.musicBus;
  }

  // ---------------------------------------------------------------- effects

  /** Play a named sound; vol already includes distance attenuation. */
  play(name: string, vol = 1): void {
    if (!this.ctx || this.settings.sfx <= 0 || vol <= 0.02) return;
    const voice = VOICES[name];
    if (!voice) return;
    const t = this.ctx.currentTime;
    const minGap = MIN_GAP[name] ?? 0.05;
    if (t - (this.lastPlay.get(name) ?? -1) < minGap) return;
    if (this.active > 28) return;
    this.lastPlay.set(name, t);
    this.active++;
    setTimeout(() => this.active--, 300);
    voice(this, t, vol);
  }

  // ---------------------------------------------------------------- EVA

  say(text: string): void {
    if (!this.settings.voice || typeof speechSynthesis === 'undefined') return;
    if (this.evaQueue.length > 2) this.evaQueue.shift();
    this.evaQueue.push(text);
    this.pump();
  }

  private pump(): void {
    if (this.speaking || !this.evaQueue.length) return;
    const text = this.evaQueue.shift()!;
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const pref = ['Google UK English Female', 'Samantha', 'Microsoft Zira', 'Karen', 'Serena', 'Moira', 'Tessa'];
    u.voice = voices.find((v) => pref.some((p) => v.name.includes(p))) ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
    u.rate = 1.05;
    u.pitch = 0.85;
    u.volume = 0.9;
    this.speaking = true;
    const done = () => {
      this.speaking = false;
      this.pump();
    };
    u.onend = done;
    u.onerror = done;
    // Some browsers never fire onend; never let the queue jam.
    setTimeout(() => {
      if (this.speaking) done();
    }, 4000);
    speechSynthesis.speak(u);
  }

  // ---------------------------------------------------------------- music

  startMusic(): void {
    if (!this.ctx || this.music) return;
    this.music = new Music(this);
    this.music.start();
  }

  stopMusic(): void {
    this.music?.stop();
    this.music = null;
  }
}

const MIN_GAP: Record<string, number> = {
  rifle: 0.06,
  mg: 0.07,
  hit: 0.05,
  explode: 0.08,
  scream: 0.4,
  crush: 0.2,
  rocket: 0.08,
};

const VOICES: Record<string, Voice> = {
  rifle: (a, t, v) => {
    a.noiseBurst(t, 0.07, 0.35 * v, 'bandpass', 2400, 900, 0.8);
    a.tone(t, 0.05, 0.12 * v, 'square', 300, 90);
  },
  mg: (a, t, v) => {
    for (let i = 0; i < 3; i++) a.noiseBurst(t + i * 0.055, 0.045, 0.3 * v, 'bandpass', 1800, 700, 1);
  },
  sniper: (a, t, v) => {
    a.noiseBurst(t, 0.2, 0.6 * v, 'highpass', 3000, 600, 0.7);
    a.tone(t, 0.25, 0.25 * v, 'sawtooth', 900, 60);
  },
  cannon: (a, t, v) => {
    a.noiseBurst(t, 0.35, 0.6 * v, 'lowpass', 1400, 150, 0.8);
    a.tone(t, 0.3, 0.5 * v, 'sine', 140, 40);
  },
  bigCannon: (a, t, v) => {
    a.noiseBurst(t, 0.5, 0.75 * v, 'lowpass', 1100, 90, 0.8);
    a.tone(t, 0.45, 0.7 * v, 'sine', 110, 30);
  },
  rocket: (a, t, v) => {
    a.noiseBurst(t, 0.45, 0.35 * v, 'bandpass', 600, 3200, 2);
    a.tone(t, 0.12, 0.15 * v, 'triangle', 220, 110);
  },
  flame: (a, t, v) => {
    a.noiseBurst(t, 0.55, 0.45 * v, 'lowpass', 900, 400, 0.5);
    a.noiseBurst(t, 0.3, 0.2 * v, 'bandpass', 2500, 1500, 1);
  },
  laser: (a, t, v) => {
    a.tone(t, 0.45, 0.35 * v, 'sawtooth', 2400, 120);
    a.tone(t, 0.45, 0.25 * v, 'square', 1200, 60);
    a.noiseBurst(t, 0.3, 0.2 * v, 'highpass', 4000, 1000);
  },
  artillery: (a, t, v) => {
    a.noiseBurst(t, 0.6, 0.7 * v, 'lowpass', 700, 80, 0.7);
    a.tone(t, 0.5, 0.8 * v, 'sine', 90, 28);
  },
  hit: (a, t, v) => {
    a.noiseBurst(t, 0.12, 0.35 * v, 'lowpass', 2000, 300);
  },
  explode: (a, t, v) => {
    a.noiseBurst(t, 1.0, 0.9 * v, 'lowpass', 1600, 60, 0.7);
    a.tone(t, 0.6, 0.6 * v, 'sine', 100, 25);
  },
  buildingExplode: (a, t, v) => {
    a.noiseBurst(t, 1.8, 1.0 * v, 'lowpass', 1200, 40, 0.6);
    a.tone(t, 1.2, 0.8 * v, 'sine', 70, 20);
    a.noiseBurst(t + 0.25, 1.2, 0.6 * v, 'lowpass', 900, 50, 0.6);
  },
  scream: (a, t, v) => {
    a.tone(t, 0.35, 0.12 * v, 'sawtooth', 700 + Math.random() * 200, 260);
  },
  crush: (a, t, v) => {
    a.noiseBurst(t, 0.15, 0.5 * v, 'lowpass', 600, 120, 2);
    a.tone(t, 0.12, 0.3 * v, 'sine', 220, 60);
  },
  place: (a, t, v) => {
    a.tone(t, 0.25, 0.5 * v, 'sine', 180, 60);
    a.noiseBurst(t, 0.2, 0.4 * v, 'lowpass', 800, 100);
  },
  sell: (a, t, v) => {
    for (let i = 0; i < 4; i++) a.tone(t + i * 0.06, 0.1, 0.25 * v, 'square', 600 + i * 200);
  },
  capture: (a, t, v) => {
    [523, 659, 784, 1046].forEach((f, i) => a.tone(t + i * 0.08, 0.2, 0.25 * v, 'triangle', f));
  },
  c4: (a, t, v) => {
    for (let i = 0; i < 5; i++) a.tone(t + i * 0.45, 0.08, 0.3 * v, 'square', 1500);
  },
  ionCharge: (a, t, v) => {
    a.tone(t, 1.6, 0.4 * v, 'sawtooth', 120, 2400, undefined, 1.4);
    a.tone(t, 1.6, 0.3 * v, 'sine', 240, 3600, undefined, 1.4);
  },
  ionBlast: (a, t, v) => {
    a.noiseBurst(t, 2.2, 1.0 * v, 'lowpass', 3000, 50, 0.5);
    a.tone(t, 1.5, 0.8 * v, 'sawtooth', 300, 30);
  },
  nukeLaunch: (a, t, v) => {
    a.noiseBurst(t, 2.5, 0.8 * v, 'lowpass', 200, 2000, 0.7);
    a.tone(t, 2.5, 0.4 * v, 'sawtooth', 60, 300, undefined, 1);
  },
  nukeBlast: (a, t, v) => {
    a.noiseBurst(t, 4.5, 1.2 * v, 'lowpass', 2500, 30, 0.4);
    a.tone(t, 3.5, 1.0 * v, 'sine', 55, 18);
    a.noiseBurst(t + 0.4, 3.5, 0.8 * v, 'lowpass', 600, 30, 0.4);
  },
  click: (a, t, v) => {
    a.tone(t, 0.04, 0.2 * v, 'square', 1400, 900);
  },
  deny: (a, t, v) => {
    a.tone(t, 0.12, 0.2 * v, 'square', 220);
    a.tone(t + 0.13, 0.15, 0.2 * v, 'square', 160);
  },
  ack: (a, t, v) => {
    a.tone(t, 0.05, 0.12 * v, 'square', 900);
    a.tone(t + 0.06, 0.05, 0.12 * v, 'square', 1300);
  },
};

/**
 * Procedural industrial-rock loop in E minor (a nod to a certain famous
 * 90s RTS soundtrack). Intensity adds layers as the fighting heats up.
 */
class Music {
  private timer = 0;
  private step = 0;
  private nextTime = 0;
  private readonly bpm = 132;
  private bar = 0;
  private readonly riffs = [
    [40, 40, 52, 40, 50, 40, 47, 45, 40, 40, 52, 40, 55, 54, 50, 47],
    [40, 40, 43, 40, 45, 40, 47, 48, 40, 40, 43, 45, 47, 45, 43, 38],
    [36, 36, 48, 36, 43, 36, 46, 45, 38, 38, 50, 38, 45, 43, 42, 38],
  ];

  constructor(private a: AudioEngine) {}

  start(): void {
    this.nextTime = this.a.now + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private schedule(): void {
    const spb = 60 / this.bpm / 4;
    while (this.nextTime < this.a.now + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += spb;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  private midi(n: number): number {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  private playStep(s: number, t: number): void {
    const a = this.a;
    const out = a.musicOut;
    const heat = a.intensity;
    const section = Math.floor(this.bar / 8) % 4;
    const riff = this.riffs[section === 3 ? 2 : section === 2 ? 1 : 0];
    // Kick
    if (s % 4 === 0 || (heat > 0.5 && s === 14)) {
      a.tone(t, 0.25, 0.9, 'sine', 150, 40, out);
      a.noiseBurst(t, 0.03, 0.4, 'lowpass', 3000, 500, 1, out);
    }
    // Snare
    if (s === 4 || s === 12) a.noiseBurst(t, 0.18, 0.55, 'bandpass', 2200, 1200, 0.8, out);
    // Hats
    if (s % 2 === 1 || heat > 0.6) a.noiseBurst(t, 0.03, s % 4 === 2 ? 0.18 : 0.1, 'highpass', 8000, 7000, 1, out);
    // Bass riff
    const note = riff[s];
    a.tone(t, 0.11, 0.32, 'sawtooth', this.midi(note), this.midi(note), out);
    a.tone(t, 0.11, 0.25, 'square', this.midi(note - 12), this.midi(note - 12), out);
    // Distorted power chords when things get hot.
    if (heat > 0.35 && (s === 0 || s === 6 || s === 10)) {
      const dist = a.distorted();
      const root = this.midi(riff[s] + 12);
      a.tone(t, 0.32, 0.07, 'sawtooth', root, root, dist);
      a.tone(t, 0.32, 0.06, 'sawtooth', root * 1.5, root * 1.5, dist);
    }
    // Ominous pad every 4 bars.
    if (s === 0 && this.bar % 4 === 0) a.tone(t, 3.5, 0.08, 'triangle', this.midi(riff[0] + 24), this.midi(riff[0] + 23), out, 0.8);
  }
}
