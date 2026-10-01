import type { View } from '../core/Camera';
import type { GameMap } from './GameMap';
import type { Character } from '../entities/Character';
import type { CombatSystem } from '../systems/CombatSystem';
import type { Barrel, Lamp } from '../systems/StreetLife';
import { LIGHTING, type Rgb } from '../config/lighting';

/**
 * Источник света в мире: где, радиус (px мира), цвет, яркость; night — горит только в темноте
 * (лампы, прожекторы); flicker — мерцание огня; bloom — светится само (плафон, пламя); off — узел
 * Протектората: сломан — не горит.
 */
export interface Light {
  x: number;
  y: number;
  r: number;
  color: Rgb;
  power: number;
  night: boolean;
  flicker: number;
  bloom: boolean;
  seed: number;
  off?: { broken: boolean };
}

/** Состояние суток: свет вокруг (множитель картинки), насколько горят лампы, название, часы. */
export interface DayState {
  ambient: [number, number, number];
  lamps: number;
  name: string;
}

/** Доля суток 0..1 (0 — полночь) по игровому времени: игра начинается с LIGHTING.start. */
export function dayFraction(time: number): number {
  const f = LIGHTING.start + time / LIGHTING.dayLength;
  return f - Math.floor(f);
}

/** Свет суток в доле f: между ключевыми точками — плавно. */
export function dayState(f: number, out: DayState = { ambient: [0, 0, 0], lamps: 0, name: '' }): DayState {
  const K = LIGHTING.keys;
  let i = 0;
  while (i < K.length - 2 && f >= K[i + 1].at) i++;
  const a = K[i];
  const b = K[i + 1];
  const t = b.at > a.at ? Math.min(1, Math.max(0, (f - a.at) / (b.at - a.at))) : 0;
  // Сглаживание: без изломов на ключевых точках.
  const s = t * t * (3 - 2 * t);
  for (let k = 0; k < 3; k++) out.ambient[k] = a.ambient[k] + (b.ambient[k] - a.ambient[k]) * s;
  out.lamps = a.lamps + (b.lamps - a.lamps) * s;
  out.name = t < 0.5 ? a.name : b.name;
  return out;
}

/** Часы «ЧЧ:ММ» по доле суток. */
export function clockText(f: number): string {
  const m = Math.floor(f * 24 * 60);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
}

/**
 * Постоянные источники карты: фонари улиц, бочки с огнём, комнаты и места по POI (LIGHTING.pois),
 * узлы Протектората, свет из люков в канализации. Собирается один раз при загрузке карты (без DOM).
 */
export function staticLights(map: GameMap, lamps: readonly Lamp[], barrels: readonly Barrel[], nodes: readonly { x: number; y: number; broken: boolean }[]): Light[] {
  const out: Light[] = [];
  const ts = map.tileSize;
  let seed = 1;
  const L = LIGHTING;
  for (const l of lamps) {
    out.push({ x: l.x + l.nx * L.lamp.head, y: l.y + l.ny * L.lamp.head, r: L.lamp.radius, color: L.lamp.color, power: L.lamp.power, night: true, flicker: 0, bloom: true, seed: seed++ });
  }
  for (const b of barrels) {
    out.push({ x: b.x, y: b.y, r: L.barrel.radius, color: L.barrel.color, power: L.barrel.power, night: false, flicker: L.barrel.flicker, bloom: true, seed: seed++ });
  }
  for (const n of nodes) {
    out.push({ x: n.x, y: n.y, r: L.node.radius, color: L.node.color, power: L.node.power, night: false, flicker: 0, bloom: false, seed: seed++, off: n });
  }
  for (const p of map.pois) {
    const d = L.pois[p.type];
    if (p.type === 'sewer_hatch') {
      out.push({ x: (p.x + 1) * ts, y: (p.y + 1) * ts, r: L.hatch.radius, color: L.hatch.color, power: L.hatch.power, night: false, flicker: 0, bloom: false, seed: seed++ });
      continue;
    }
    if (!d) continue;
    // Комната (x, y, w, h) — лампа посередине; точка — в центре тайла.
    const w = p.w ?? 1;
    const h = p.h ?? 1;
    const r = w > 1 || h > 1 ? Math.max(d.radius, Math.max(w, h) * ts * 0.75) : d.radius;
    out.push({ x: (p.x + w / 2) * ts, y: (p.y + h / 2) * ts, r, color: d.color, power: d.power, night: d.night, flicker: d.flicker ?? 0, bloom: !!d.flicker || !!d.bloom, seed: seed++ });
  }
  return out;
}

const SPRITE = 64;

/**
 * Освещение: карта света в LIGHTING.lightmapScale от экрана — заливка светом суток, поверх
 * источники сложением (мягкие пятна-спрайты, по спрайту на цвет), затем умножение на картинку.
 * Свечение (bloom) плафонов и огня — сложением поверх. Спрайты и строки цвета — один раз.
 */
export class Lighting {
  enabled = true;
  /** Упрощённо (слабая машина): без свечения. */
  lite = false;
  private lights: Light[] = [];
  private lm: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  /** Буфер свечения (как карта света, мелкий): пятна складываются в нём, на экран — одним проходом. */
  private bl: HTMLCanvasElement | null = null;
  private bg: CanvasRenderingContext2D | null = null;
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly state: DayState = { ambient: [0, 0, 0], lamps: 0, name: '' };
  private ambientKey = '';
  private ambientStyle = '';

  /** Новая карта: собрать постоянные источники. */
  setWorld(map: GameMap, lamps: readonly Lamp[], barrels: readonly Barrel[], nodes: readonly { x: number; y: number; broken: boolean }[]): void {
    this.lights = staticLights(map, lamps, barrels, nodes);
  }

  /** Свет суток сейчас (для HUD и отрисовки уюта). */
  day(time: number): DayState {
    return dayState(dayFraction(time), this.state);
  }

  /** Насколько темно 0..1 (для свечения ламп, пылинок, дыма). */
  darkness(time: number): number {
    const a = this.day(time).ambient;
    return Math.max(0, Math.min(1, 1 - (a[0] + a[1] + a[2]) / (3 * 255)));
  }

  private sprite(c: Rgb): HTMLCanvasElement {
    const key = `${c[0]},${c[1]},${c[2]}`;
    let s = this.sprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = SPRITE;
    const g = s.getContext('2d')!;
    const r = SPRITE / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    // Мягкий спад: яркое ядро, долгий тёплый край.
    grad.addColorStop(0, `rgba(${key},1)`);
    grad.addColorStop(0.25, `rgba(${key},0.78)`);
    grad.addColorStop(0.5, `rgba(${key},0.4)`);
    grad.addColorStop(0.75, `rgba(${key},0.13)`);
    grad.addColorStop(1, `rgba(${key},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE, SPRITE);
    this.sprites.set(key, s);
    return s;
  }

  private flick(L: { flicker: number; seed: number }, t: number): number {
    if (L.flicker <= 0) return 1;
    return 1 - L.flicker * (0.5 + 0.5 * Math.sin(t * 11 + L.seed) * Math.sin(t * 7.3 + L.seed * 1.7));
  }

  /** Пятно света в карту света (координаты мира). false — вне экрана или слишком слабое. */
  private put(g: CanvasRenderingContext2D, v: View, k: number, x: number, y: number, r: number, color: Rgb, power: number): boolean {
    const s = v.scale * k;
    const px = (x - v.left) * s;
    const py = (y - v.top) * s;
    const pr = r * s;
    if (px < -pr || py < -pr || px > v.width * k + pr || py > v.height * k + pr || power <= 0.01) return false;
    g.globalAlpha = Math.min(1, power);
    g.drawImage(this.sprite(color), px - pr, py - pr, pr * 2, pr * 2);
    return true;
  }

  /**
   * Карта света и умножение на картинку. sewer — игрок в канализации (там свои сумерки).
   * Динамические источники: пламя, взрывы, вспышки выстрелов, горящие, свой свет игрока.
   */
  draw(ctx: CanvasRenderingContext2D, v: View, time: number, player: Character, combat: CombatSystem, entities: readonly Character[], sewer: boolean): void {
    if (!this.enabled) return;
    const st = this.day(time);
    const amb = sewer ? LIGHTING.sewer : st.ambient;
    const lamps = sewer ? 1 : st.lamps;
    // Ясный день, лампы погашены — умножать не на что (проход на весь экран не нужен).
    if (!sewer && lamps <= LIGHTING.lampsOn && amb[0] >= LIGHTING.skipDay && amb[1] >= LIGHTING.skipDay && amb[2] >= LIGHTING.skipDay - 20) return;
    const k = LIGHTING.lightmapScale;
    const w = Math.max(1, Math.ceil(v.width * k));
    const h = Math.max(1, Math.ceil(v.height * k));
    if (!this.lm || this.lm.width !== w || this.lm.height !== h) {
      this.lm = document.createElement('canvas');
      this.lm.width = w;
      this.lm.height = h;
      this.g = this.lm.getContext('2d')!;
    }
    const g = this.g!;
    // Строка цвета — только когда свет суток заметно сменился.
    const r = Math.round(amb[0]);
    const gg = Math.round(amb[1]);
    const b = Math.round(amb[2]);
    const key = `${r >> 1},${gg >> 1},${b >> 1}`;
    if (key !== this.ambientKey) {
      this.ambientKey = key;
      this.ambientStyle = `rgb(${r},${gg},${b})`;
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = this.ambientStyle;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    const L = LIGHTING;
    for (const s of this.lights) {
      if (s.off?.broken) continue;
      const on = s.night ? lamps : 1;
      if (on <= L.lampsOn) continue;
      this.put(g, v, k, s.x, s.y, s.r, s.color, s.power * on * this.flick(s, time));
    }
    // Пламя, взрывы, горящие, вспышки выстрелов.
    for (const f of combat.fires) this.put(g, v, k, f.x, f.y, f.r * L.fire.radiusMul, L.fire.color, L.fire.power * (1 - L.fire.flicker * 0.5 * (1 + Math.sin(time * 13 + f.x))));
    for (const bl of combat.blasts) this.put(g, v, k, bl.x, bl.y, bl.r * L.blast.radiusMul, L.blast.color, L.blast.power * (bl.t / bl.life));
    // Вспышки выстрелов: эффекты по времени, свежие — в конце списка.
    const fx = combat.fx;
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      const age = combat.now - e.t;
      if (age > L.muzzle.time) break;
      if (e.kind === 'muzzle') this.put(g, v, k, e.x, e.y, L.muzzle.radius, L.muzzle.color, L.muzzle.power * (1 - age / L.muzzle.time));
    }
    for (const c of entities) if (c.alive && c.burnUntil > combat.now) this.put(g, v, k, c.x, c.y, L.burning.radius, L.burning.color, L.burning.power);
    // Свой свет вокруг игрока (видеть себя и шаг вокруг ночью).
    if (player.alive) this.put(g, v, k, player.x, player.y, L.player.radius, L.player.color, L.player.power);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(this.lm, 0, 0, v.width, v.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Свечение самих источников (плафоны, окна, огонь) — тем ярче, чем темнее вокруг. Пятна
   * складываются в мелком буфере, на экран — одним проходом сложения (сотня пятен на полном экране
   * по отдельности — дорого).
   */
  drawBloom(ctx: CanvasRenderingContext2D, v: View, time: number, sewer: boolean): void {
    if (!this.enabled || this.lite) return;
    const B = LIGHTING.bloom;
    const dark = sewer ? 0.7 : this.darkness(time);
    const lamps = sewer ? 1 : this.state.lamps;
    const a = B.alpha * (0.25 + 0.75 * dark);
    if (a < 0.02) return;
    const k = LIGHTING.lightmapScale;
    const w = Math.max(1, Math.ceil(v.width * k));
    const h = Math.max(1, Math.ceil(v.height * k));
    if (!this.bl || this.bl.width !== w || this.bl.height !== h) {
      this.bl = document.createElement('canvas');
      this.bl.width = w;
      this.bl.height = h;
      this.bg = this.bl.getContext('2d')!;
    }
    const g = this.bg!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    let any = false;
    for (const L of this.lights) {
      if (!L.bloom || L.off?.broken) continue;
      const on = L.night ? lamps : 1;
      if (on <= LIGHTING.lampsOn) continue;
      if (this.put(g, v, k, L.x, L.y, L.r * B.radius, L.color, a * on * L.power * this.flick(L, time))) any = true;
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (!any) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.bl, 0, 0, v.width, v.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Горящие фонари на экране (для пылинок в их свете). */
  litLamps(): readonly Light[] {
    return this.lights;
  }
}
