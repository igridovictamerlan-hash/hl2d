import type { Shot, Fx } from '../systems/CombatSystem';
import type { Character } from '../entities/Character';
import { AUDIO, type Voice } from '../config/audio';
import { WEAPONS } from '../config/items';
import type { MeleeStyle } from '../config/melee';

const STORAGE_KEY = 'city17.muted';

/**
 * Звук боя: синтез из шума и осцилляторов (без звуковых файлов). Выстрел — щелчок (высокие
 * частоты), «тело» (шум через фильтр) и низкий удар; AR2 — ещё «зуд». Громкость падает с
 * расстоянием мягко — далёкую перестрелку слышно, но тихо и глухо (фильтр), с задержкой по скорости
 * звука и с эхом: общий ревербератор (свёртка) и короткое эхо от стен. Рядом — шлепки попаданий,
 * рикошеты, ближний бой (взмах, шлепок кулака, треск дубинки, нож, звон блока). Контекст WebAudio — по первому жесту пользователя. N — вкл/выкл.
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
  /** Фон: громкость ветра и накопитель щелчков треска огня. */
  private windGain: GainNode | null = null;
  private crackleAcc = 0;
  private ambientT = 0;
  private shipGain: GainNode | null = null;
  private radioSeq = 0;

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
    // Вернулись на вкладку — браузер мог приостановить звук.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.ctx?.resume();
    });
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
    // Новый город (новая игра, перезапуск после победы, «отряд на отряд») — часы и счётчики боя с нуля.
    // Без сброса звук молчал, пока новое время не догоняло старое, а бюджет звуков не пополнялся.
    const lastSeq = fx.length ? fx[fx.length - 1].seq : 0;
    if (now < this.budgetT || (shots.length && shots[shots.length - 1].t < this.lastT) || lastSeq < this.fxSeq) {
      this.budgetT = now - 1;
      this.lastT = -Infinity;
      this.fxSeq = 0;
    }
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
      if (f.kind === 'hit') this.flesh(ctx, d, pan, f.lethal);
      else if (f.kind === 'wall' && Math.random() < AUDIO.ricochet.chance) this.ricochet(ctx, d, pan);
      else if (f.kind === 'swing') this.swish(ctx, d, pan, f.style ?? 'baton', !!f.heavy);
      else if (f.kind === 'stab') this.strike(ctx, d, pan, f);
      else if (f.kind === 'block' || f.kind === 'parry') this.clash(ctx, d, pan, f);
      else if (f.kind === 'ko') this.knock(ctx, d, pan);
      if (f.kind === 'whiz' && f.target === listener) this.whiz(ctx, pan, f.power);
    }
  }

  /**
   * Фон улицы: ветер с порывами (ночью слышнее, в канализации глуше) и треск огня, если рядом бочка
   * или костёр. fires — где горит, dark — насколько темно (0..1).
   */
  ambient(listener: Character, fires: readonly { x: number; y: number }[], dark: number, sewer: boolean, dt: number, ship: { x: number; y: number } | null = null): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || ctx.state !== 'running') return;
    const A = AUDIO.ambient;
    this.ambientT += dt;
    if (!this.windGain) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = A.wind.cutoff;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      src.connect(lp).connect(this.windGain).connect(this.master);
      src.start();
    }
    const W = A.wind;
    const gust = 1 - W.gust * 0.5 * (1 + Math.sin(this.ambientT * W.gustRate) * Math.sin(this.ambientT * W.gustRate * 2.3 + 1));
    const level = W.gain * (1 + (W.nightMul - 1) * dark) * (sewer ? W.sewerMul : 1) * gust * (this.muted ? 0 : 1);
    this.windGain.gain.setTargetAtTime(level, ctx.currentTime, 0.5);
    // Гул корабля Протектората (поставка на склад).
    const S = A.ship;
    if (ship && !this.shipGain) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.3;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = S.cutoff;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = S.hum;
      const og = ctx.createGain();
      og.gain.value = S.humGain;
      this.shipGain = ctx.createGain();
      this.shipGain.gain.value = 0;
      src.connect(lp).connect(this.shipGain);
      osc.connect(og).connect(lp);
      this.shipGain.connect(this.master);
      src.start();
      osc.start();
    }
    if (this.shipGain) {
      const d = ship && !sewer ? Math.hypot(ship.x - listener.x, ship.y - listener.y) : Infinity;
      const k = d < S.range ? 1 - d / S.range : 0;
      this.shipGain.gain.setTargetAtTime(this.muted ? 0 : S.gain * k * k, ctx.currentTime, 0.4);
    }
    if (this.muted) return;
    // Треск огня: ближайший костёр или бочка.
    const C = A.crackle;
    let best: number = C.range;
    let bx = 0;
    for (const f of fires) {
      const d = Math.hypot(f.x - listener.x, f.y - listener.y);
      if (d < best) {
        best = d;
        bx = f.x;
      }
    }
    if (best >= C.range) return;
    const k = 1 - best / C.range;
    this.crackleAcc += C.rate * k * dt;
    while (this.crackleAcc >= 1) {
      this.crackleAcc -= 1;
      if (Math.random() < 0.35) continue;
      const out = this.chain(ctx, best, (bx - listener.x) / 900, C.gain * (0.4 + Math.random() * 0.8), 0.05);
      if (!out) continue;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.5;
      bp.frequency.value = C.freq[0] + Math.random() * (C.freq[1] - C.freq[0]);
      const g = ctx.createGain();
      const dur = C.dur[0] + Math.random() * (C.dur[1] - C.dur[0]);
      const t0 = out.t0 + Math.random() * 0.1;
      g.gain.setValueAtTime(1, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      this.noiseSrc(ctx, t0, dur + 0.01).connect(bp).connect(g).connect(out.out);
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

  /**
   * Рация (Radio.feed): новые передачи — «кшш» в начале, у Надзора ещё двойной писк. Игроку из силового блока —
   * все (в наушнике, без расстояния), остальным — ближе AUDIO.radio.hear px.
   */
  radio(listener: Character, feed: readonly { seq: number; from: unknown; x: number; y: number }[], headset: boolean): void {
    const last = feed.length ? feed[feed.length - 1].seq : this.radioSeq;
    if (!this.ctx || this.muted || !this.master || !this.noise) {
      this.radioSeq = last;
      return;
    }
    const R = AUDIO.radio;
    for (const t of feed) {
      if (t.seq <= this.radioSeq) continue;
      this.radioSeq = t.seq;
      const d = headset ? 0 : Math.hypot(t.x - listener.x, t.y - listener.y);
      if (d > R.hear) continue;
      this.squelch(this.ctx, d, headset ? 0 : (t.x - listener.x) / R.panWidth, t.from === null);
    }
  }

  private squelch(ctx: AudioContext, d: number, pan: number, beep: boolean): void {
    const R = AUDIO.radio;
    const c = this.chain(ctx, d, pan, R.gain, 0.02);
    if (!c) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = R.band;
    bp.Q.value = R.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, c.t0);
    g.gain.exponentialRampToValueAtTime(0.001, c.t0 + R.dur);
    this.noiseSrc(ctx, c.t0, R.dur + 0.02).connect(bp).connect(g).connect(c.out);
    if (!beep) return;
    for (let k = 0; k < 2; k++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = R.beep;
      const bg = ctx.createGain();
      const t = c.t0 + R.dur + k * R.beepDur * 1.6;
      bg.gain.setValueAtTime(R.beepGain, t);
      bg.gain.setValueAtTime(0.0001, t + R.beepDur);
      o.connect(bg).connect(c.out);
      o.start(t);
      o.stop(t + R.beepDur + 0.01);
    }
  }

  /** Пуля над ухом: щелчок и короткий свист с понижением (без задержки — пролетает рядом). */
  private whiz(ctx: AudioContext, pan: number, power: number): void {
    const W = AUDIO.whiz;
    const c = this.chain(ctx, 0, pan * 3, W.gain * (0.5 + power * 0.7), 0.05);
    if (!c) return;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(W.crack, c.t0);
    g.gain.exponentialRampToValueAtTime(0.001, c.t0 + W.crackDur);
    this.noiseSrc(ctx, c.t0, W.crackDur + 0.01).connect(hp).connect(g).connect(c.out);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    const f = W.whistle * (0.8 + Math.random() * 0.4);
    bp.frequency.setValueAtTime(f, c.t0);
    bp.frequency.exponentialRampToValueAtTime(f * 0.55, c.t0 + W.dur);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.001, c.t0);
    g2.gain.exponentialRampToValueAtTime(0.7, c.t0 + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, c.t0 + W.dur);
    this.noiseSrc(ctx, c.t0, W.dur + 0.02).connect(bp).connect(g2).connect(c.out);
  }

  /** Взмах (кулак, дубинка, нож): свист воздуха в полосе, у ножа — выше и резче, тяжёлый — громче. */
  private swish(ctx: AudioContext, d: number, pan: number, style: MeleeStyle, heavy: boolean): void {
    const S = AUDIO.melee.swish[style];
    const c = this.chain(ctx, d, pan, S.gain * (heavy ? 1.35 : 1), 0.02);
    if (!c) return;
    const dur = S.dur * (heavy ? 1.25 : 1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(S.from, c.t0);
    bp.frequency.exponentialRampToValueAtTime(S.to, c.t0 + dur * 0.85);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, c.t0);
    g.gain.exponentialRampToValueAtTime(1, c.t0 + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, c.t0 + dur);
    this.noiseSrc(ctx, c.t0, dur + 0.01).connect(bp).connect(g).connect(c.out);
    if (style === 'baton') this.zap(ctx, c.out, c.t0, heavy ? 0.7 : 0.35);
  }

  /** Попал: кулак — глухой шлепок (в голову — звонче), дубинка — удар с треском разряда, нож — плоть и «вжик». */
  private strike(ctx: AudioContext, d: number, pan: number, f: Fx): void {
    const M = AUDIO.melee;
    const heavy = !!f.heavy;
    if (f.style === 'blade' || (!f.style && f.cls === 'blade')) {
      this.flesh(ctx, d, pan, f.lethal || heavy);
      const c = this.chain(ctx, d, pan, M.slice.gain, 0.03);
      if (!c) return;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = M.slice.cutoff;
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, c.t0);
      g.gain.exponentialRampToValueAtTime(0.001, c.t0 + M.slice.dur);
      this.noiseSrc(ctx, c.t0, M.slice.dur + 0.01, 1.3).connect(hp).connect(g).connect(c.out);
      return;
    }
    const P = M.punch;
    const c = this.chain(ctx, d, pan, P.gain * (heavy ? 1.45 : 1), 0.06);
    if (!c) return;
    const dur = P.dur * (heavy ? 1.5 : 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = f.zone === 'head' ? P.headBody : P.body;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, c.t0);
    g.gain.exponentialRampToValueAtTime(0.001, c.t0 + dur * 0.7);
    this.noiseSrc(ctx, c.t0, dur).connect(lp).connect(g).connect(c.out);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(P.thump * (heavy ? 0.85 : 1), c.t0);
    o.frequency.exponentialRampToValueAtTime(P.thump * 0.45, c.t0 + dur);
    og.gain.setValueAtTime(1, c.t0);
    og.gain.exponentialRampToValueAtTime(0.001, c.t0 + dur);
    o.connect(og).connect(c.out);
    o.start(c.t0);
    o.stop(c.t0 + dur);
    if (f.style === 'baton') this.zap(ctx, c.out, c.t0, heavy ? 1.4 : 1);
  }

  /** Треск разряда дубинки: пила через полосу с падающей частотой и короткий шум. */
  private zap(ctx: AudioContext, out: GainNode, t0: number, k: number): void {
    const Z = AUDIO.melee.zap;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(Z.freq * (0.9 + Math.random() * 0.2), t0);
    o.frequency.exponentialRampToValueAtTime(Z.freq * 0.35, t0 + Z.dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.value = Z.freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Z.gain * k, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + Z.dur);
    o.connect(bp).connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + Z.dur);
  }

  /** Блок и парирование: оружие об оружие — звон (два обертона), руками — глухо; парирование — громче. */
  private clash(ctx: AudioContext, d: number, pan: number, f: Fx): void {
    const M = AUDIO.melee;
    const k = f.kind === 'parry' ? 1.5 : f.heavy ? 1.3 : 1;
    if (f.style !== 'fists' && f.guard !== 'fists') {
      const C = M.clang;
      const c = this.chain(ctx, d, pan, C.gain * k, 0.25);
      if (!c) return;
      for (const fr of [C.ring, C.ring2]) {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.frequency.value = fr * (0.95 + Math.random() * 0.1);
        og.gain.setValueAtTime(fr === C.ring ? 1 : 0.6, c.t0);
        og.gain.exponentialRampToValueAtTime(0.001, c.t0 + C.dur);
        o.connect(og).connect(c.out);
        o.start(c.t0);
        o.stop(c.t0 + C.dur);
      }
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.8, c.t0);
      g.gain.exponentialRampToValueAtTime(0.001, c.t0 + 0.03);
      this.noiseSrc(ctx, c.t0, 0.04).connect(hp).connect(g).connect(c.out);
      if (f.style === 'baton' || f.guard === 'baton') this.zap(ctx, c.out, c.t0, 0.8);
      return;
    }
    const T = M.thud;
    const c = this.chain(ctx, d, pan, T.gain * k, 0.05);
    if (!c) return;
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(T.freq, c.t0);
    o.frequency.exponentialRampToValueAtTime(T.freq * 0.5, c.t0 + T.dur);
    og.gain.setValueAtTime(1, c.t0);
    og.gain.exponentialRampToValueAtTime(0.001, c.t0 + T.dur);
    o.connect(og).connect(c.out);
    o.start(c.t0);
    o.stop(c.t0 + T.dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, c.t0);
    g.gain.exponentialRampToValueAtTime(0.001, c.t0 + T.dur * 0.7);
    this.noiseSrc(ctx, c.t0, T.dur).connect(lp).connect(g).connect(c.out);
  }

  /** Нокаут: тяжёлое падение. */
  private knock(ctx: AudioContext, d: number, pan: number): void {
    const K = AUDIO.melee.ko;
    const c = this.chain(ctx, d, pan, K.gain, 0.1);
    if (!c) return;
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(K.freq, c.t0);
    o.frequency.exponentialRampToValueAtTime(K.freq * 0.5, c.t0 + K.dur);
    og.gain.setValueAtTime(1, c.t0);
    og.gain.exponentialRampToValueAtTime(0.001, c.t0 + K.dur);
    o.connect(og).connect(c.out);
    o.start(c.t0);
    o.stop(c.t0 + K.dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, c.t0);
    g.gain.exponentialRampToValueAtTime(0.001, c.t0 + K.dur);
    this.noiseSrc(ctx, c.t0, K.dur, 0.6).connect(lp).connect(g).connect(c.out);
  }
}
