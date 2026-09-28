import type { Shot, Fx } from '../systems/CombatSystem';
import type { Character } from '../entities/Character';
import { AUDIO, type Voice } from '../config/audio';
import { WEAPONS } from '../config/items';

const STORAGE_KEY = 'city17.muted';

/**
 * Звук боя: синтез из шума и осцилляторов (без звуковых файлов). Выстрел — щелчок (высокие
 * частоты), «тело» (шум через фильтр) и низкий удар; AR2 — ещё «зуд». Громкость падает с
 * расстоянием мягко — далёкую перестрелку слышно, но тихо и глухо (фильтр), с задержкой по скорости
 * звука и с эхом: общий ревербератор (свёртка) и короткое эхо от стен. Рядом — шлепки попаданий,
 * рикошеты, взмах ножа. Контекст WebAudio — по первому жесту пользователя. N — вкл/выкл.
 */
export class GunfireAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Вход эха (свёртка + короткое эхо от стен). */
  private wet: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastT = -Infinity;
  private fxSeq = 0;
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
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : AUDIO.volume;
    // Мягкий ограничитель: залп десятка стволов не хрипит.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    // Звук — не игровая логика: здесь Math.random допустим.
    const len = Math.floor(ctx.sampleRate * 1.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    // Эхо: свёртка с откликом «улица» (стерео шум с экспоненциальным затуханием).
    const R = AUDIO.reverb;
    const rl = Math.floor(ctx.sampleRate * R.time);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    // Огибающая (1 − t)^decay — по блокам с линейной интерполяцией: pow на каждый отсчёт
    // (сотни тысяч) заметно задерживал первый звук.
    const block = 256;
    const env = (i: number) => Math.pow(1 - Math.min(1, i / rl), R.decay) * (i < rl * 0.05 ? 0.6 : 1);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let b = 0; b < rl; b += block) {
        const e0 = env(b);
        const de = (env(b + block) - e0) / block;
        const end = Math.min(rl, b + block);
        for (let i = b, e = e0; i < end; i++, e += de) d[i] = (Math.random() * 2 - 1) * e;
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const revGain = ctx.createGain();
    revGain.gain.value = R.gain;
    this.wet = ctx.createGain();
    this.wet.connect(conv).connect(revGain).connect(this.master);
    // Короткое эхо от стен домов: пара задержек с обратной связью через фильтр.
    const S = AUDIO.slap;
    for (let k = 0; k < S.delays.length; k++) {
      const delay = ctx.createDelay(1);
      delay.delayTime.value = S.delays[k];
      const fb = ctx.createGain();
      fb.gain.value = S.feedback;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const out = ctx.createGain();
      out.gain.value = S.gain;
      this.wet.connect(delay);
      delay.connect(lp).connect(fb).connect(delay);
      lp.connect(out).connect(this.master);
    }
  }

  /** Проиграть выстрелы и взрывы, случившиеся после прошлого вызова, и звуки попаданий рядом. */
  update(shots: readonly Shot[], listener: Character, now: number, sameLevel: (x: number, y: number) => boolean = () => true, fx: readonly Fx[] = []): void {
    if (now - this.budgetT >= 1) {
      this.budgetT = now;
      this.budget = AUDIO.maxPerSecond;
    }
    const ctx = this.ctx;
    const fresh: Shot[] = [];
    for (const s of shots) if (s.t > this.lastT) fresh.push(s);
    if (shots.length) this.lastT = Math.max(this.lastT, shots[shots.length - 1].t);
    const newFx: Fx[] = [];
    for (const f of fx) if (f.seq > this.fxSeq) newFx.push(f);
    if (fx.length) this.fxSeq = Math.max(this.fxSeq, fx[fx.length - 1].seq);
    if (!ctx || !this.master || !this.noise || this.muted || ctx.state !== 'running') return;
    // В плотном бою — сначала ближние.
    fresh.sort((a, b) => Math.hypot(a.x - listener.x, a.y - listener.y) - Math.hypot(b.x - listener.x, b.y - listener.y));
    for (const s of fresh) {
      if (this.budget <= 0) break;
      // Город и канализация друг друга не слышат (они на одной сетке, но далеко не соседи).
      if (!sameLevel(s.x, s.y)) continue;
      const d = Math.hypot(s.x - listener.x, s.y - listener.y);
      if (d > AUDIO.maxDistance) continue;
      this.budget--;
      const v = s.weapon === 'blast' ? AUDIO.explosion : s.weapon === 'smoke' ? AUDIO.pop : AUDIO.voices[WEAPONS[s.weapon].class];
      this.shot(ctx, v, d, (s.x - listener.x) / 900);
    }
    for (const f of newFx) {
      const d = Math.hypot(f.x - listener.x, f.y - listener.y);
      if (d > AUDIO.hitRange || !sameLevel(f.x, f.y)) continue;
      const pan = (f.x - listener.x) / 900;
      if (f.kind === 'hit' || (f.kind === 'stab' && f.cls === 'blade')) this.flesh(ctx, d, pan, f.lethal);
      else if (f.kind === 'wall' && Math.random() < AUDIO.ricochet.chance) this.ricochet(ctx, d, pan);
      if (f.kind === 'stab') this.swish(ctx, d, pan);
    }
  }

  /** Выход звука: громкость, фильтр по расстоянию, панорама, доля в эхо; t0 — с задержкой звука. */
  private chain(ctx: AudioContext, d: number, pan: number, gain: number, wet: number): { out: GainNode; t0: number } | null {
    const k = Math.min(1, d / AUDIO.maxDistance);
    const loud = gain * (AUDIO.ref / (AUDIO.ref + d)) * (1 - k * k);
    if (loud < 0.004) return null;
    const t0 = ctx.currentTime + 0.005 + d / AUDIO.soundSpeed;
    const out = ctx.createGain();
    out.gain.value = loud;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = AUDIO.cutoffNear * Math.pow(AUDIO.cutoffFar / AUDIO.cutoffNear, Math.sqrt(k));
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(lp).connect(panner);
    // Прямой звук тише с расстоянием, эхо — нет: далёкие выстрелы гулкие.
    const dry = ctx.createGain();
    dry.gain.value = 1 - k * 0.6;
    panner.connect(dry).connect(this.master!);
    const send = ctx.createGain();
    send.gain.value = Math.min(1, wet + k * AUDIO.reverb.farWet);
    panner.connect(send).connect(this.wet!);
    return { out, t0 };
  }

  private noiseSrc(ctx: AudioContext, t0: number, dur: number, rate = 1): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate * (0.92 + Math.random() * 0.16);
    src.start(t0, Math.random() * 0.8, dur + 0.05);
    return src;
  }

  private shot(ctx: AudioContext, v: Voice, d: number, pan: number): void {
    const c = this.chain(ctx, d, pan, v.gain, v.wet);
    if (!c) return;
    const { out, t0 } = c;
    // Щелчок: короткая вспышка высоких частот.
    if (v.crack > 0) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(v.crack, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.018);
      this.noiseSrc(ctx, t0, 0.03).connect(hp).connect(g).connect(out);
    }
    // Тело: шум, срез фильтра быстро опускается — «бах» переходит в «ух».
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(v.body * 1.6, t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(60, v.body * 0.25), t0 + v.bodyDur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + v.bodyDur);
    this.noiseSrc(ctx, t0, v.bodyDur, v.body < 600 ? 0.6 : 1).connect(lp).connect(g).connect(out);
    // Низкий удар.
    if (v.thump > 0) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(v.thump * 1.8, t0);
      o.frequency.exponentialRampToValueAtTime(v.thump * 0.5, t0 + v.bodyDur);
      og.gain.setValueAtTime(1.1, t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + v.bodyDur * 0.9);
      o.connect(og).connect(out);
      o.start(t0);
      o.stop(t0 + v.bodyDur);
    }
    // Импульс AR2: «зуд» с падающей частотой.
    if (v.zap > 0) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(v.zap, t0);
      o.frequency.exponentialRampToValueAtTime(v.zap * 0.25, t0 + v.bodyDur);
      og.gain.setValueAtTime(0.28, t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + v.bodyDur);
      o.connect(og).connect(out);
      o.start(t0);
      o.stop(t0 + v.bodyDur);
    }
  }

  /** Шлепок попадания в тело (смертельное — тяжелее). */
  private flesh(ctx: AudioContext, d: number, pan: number, heavy: boolean): void {
    const F = AUDIO.flesh;
    const c = this.chain(ctx, d, pan, F.gain * (heavy ? 1.4 : 1), 0.05);
    if (!c) return;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, c.t0);
    g.gain.exponentialRampToValueAtTime(0.001, c.t0 + F.dur);
    this.noiseSrc(ctx, c.t0, F.dur).connect(lp).connect(g).connect(c.out);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(F.freq, c.t0);
    o.frequency.exponentialRampToValueAtTime(F.freq * 0.5, c.t0 + F.dur);
    og.gain.setValueAtTime(0.8, c.t0);
    og.gain.exponentialRampToValueAtTime(0.001, c.t0 + F.dur);
    o.connect(og).connect(c.out);
    o.start(c.t0);
    o.stop(c.t0 + F.dur);
  }

  /** Рикошет: короткий звенящий свист. */
  private ricochet(ctx: AudioContext, d: number, pan: number): void {
    const R = AUDIO.ricochet;
    const c = this.chain(ctx, d, pan, R.gain, 0.2);
    if (!c) return;
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    const f = R.freq * (0.8 + Math.random() * 0.5);
    o.frequency.setValueAtTime(f, c.t0);
    o.frequency.exponentialRampToValueAtTime(f * 0.45, c.t0 + R.dur);
    og.gain.setValueAtTime(1, c.t0);
    og.gain.exponentialRampToValueAtTime(0.001, c.t0 + R.dur);
    o.connect(og).connect(c.out);
    o.start(c.t0);
    o.stop(c.t0 + R.dur);
  }

  /** Взмах ножом или дубинкой: свист воздуха. */
  private swish(ctx: AudioContext, d: number, pan: number): void {
    const c = this.chain(ctx, d, pan, 0.3, 0.02);
    if (!c) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(900, c.t0);
    bp.frequency.exponentialRampToValueAtTime(3500, c.t0 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, c.t0);
    g.gain.exponentialRampToValueAtTime(1, c.t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, c.t0 + 0.14);
    this.noiseSrc(ctx, c.t0, 0.15).connect(bp).connect(g).connect(c.out);
  }
}
