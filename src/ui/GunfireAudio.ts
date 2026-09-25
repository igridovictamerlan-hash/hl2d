import type { Shot } from '../systems/CombatSystem';
import type { Character } from '../entities/Character';
import { AUDIO } from '../config/audio';
import { WEAPONS } from '../config/items';

const STORAGE_KEY = 'city17.muted';

/**
 * Звук выстрелов: синтез из шума и осцилляторов (без звуковых файлов). Громкость падает с
 * расстоянием, далёкие выстрелы глуше (фильтр) и смещены в сторону источника (панорама) —
 * перестрелку на КПП слышно из города. Контекст WebAudio создаётся по первому жесту пользователя
 * (иначе браузер не даст играть звук). N — вкл/выкл (запоминается в браузере).
 */
export class GunfireAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastT = -Infinity;
  private budget = AUDIO.maxPerSecond;
  private budgetT = 0;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      /* хранилище недоступно — по умолчанию звук включён */
    }
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  toggle(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      /* не запомним — не страшно */
    }
    if (this.master) this.master.gain.value = this.muted ? 0 : AUDIO.volume;
    return this.muted;
  }

  private ensure(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : AUDIO.volume;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    // Звук — не игровая логика: здесь Math.random допустим.
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Проиграть выстрелы, случившиеся после прошлого вызова. */
  update(shots: readonly Shot[], listener: Character, now: number): void {
    if (now - this.budgetT >= 1) {
      this.budgetT = now;
      this.budget = AUDIO.maxPerSecond;
    }
    const ctx = this.ctx;
    const fresh: Shot[] = [];
    for (const s of shots) if (s.t > this.lastT) fresh.push(s);
    if (shots.length) this.lastT = Math.max(this.lastT, shots[shots.length - 1].t);
    if (!ctx || !this.master || !this.noise || this.muted || ctx.state !== 'running' || fresh.length === 0) return;
    // В плотном бою — сначала ближние.
    fresh.sort((a, b) => Math.hypot(a.x - listener.x, a.y - listener.y) - Math.hypot(b.x - listener.x, b.y - listener.y));
    for (const s of fresh) {
      if (this.budget <= 0) break;
      const d = Math.hypot(s.x - listener.x, s.y - listener.y);
      if (d > AUDIO.maxDistance) continue;
      this.budget--;
      this.play(ctx, s, d, (s.x - listener.x) / AUDIO.maxDistance);
    }
  }

  private play(ctx: AudioContext, s: Shot, d: number, pan: number): void {
    const v = AUDIO.voices[WEAPONS[s.weapon].class];
    const k = d / AUDIO.maxDistance;
    const loud = v.gain * (1 - k) * (1 - k);
    if (loud < 0.01) return;
    const t0 = ctx.currentTime + 0.005;
    const dur = v.dur * (1 + k * 0.8);
    const out = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan * 2.5));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = AUDIO.cutoffNear + (AUDIO.cutoffFar - AUDIO.cutoffNear) * Math.sqrt(k);
    out.connect(lp).connect(panner).connect(this.master!);
    out.gain.setValueAtTime(loud, t0);
    out.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    // Хлопок: полоса шума.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = v.freq;
    bp.Q.value = v.q;
    src.connect(bp).connect(out);
    src.start(t0, Math.random() * 0.3, dur + 0.05);
    // Удар: короткий низкий «бум».
    if (v.thump > 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(v.thump * 1.6, t0);
      o.frequency.exponentialRampToValueAtTime(v.thump * 0.6, t0 + dur);
      g.gain.setValueAtTime(0.9, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.8);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + dur);
    }
    // Импульс AR2: «зуд» с падающей частотой.
    if (v.zap > 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(v.zap, t0);
      o.frequency.exponentialRampToValueAtTime(v.zap * 0.3, t0 + dur);
      g.gain.setValueAtTime(0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + dur);
    }
  }
}
