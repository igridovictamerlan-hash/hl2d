/** Описание системы — docs/rendering.md. */
import type { View } from '../core/Camera';
import type { GameMap } from './GameMap';
import type { Character } from '../entities/Character';
import type { CombatSystem } from '../systems/CombatSystem';
import type { Barrel, Lamp } from '../systems/StreetLife';
import { LIGHTING, type Rgb } from '../config/lighting';
import { MEMORIALS } from '../config/memorials';
import { SIDE_DX, SIDE_DY, windowOn, type WindowSpot } from './windows';
import { FACADES } from '../config/facades';

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
export function staticLights(
  map: GameMap,
  lamps: readonly Lamp[],
  barrels: readonly Barrel[],
  nodes: readonly { x: number; y: number; broken: boolean }[],
  dugouts: readonly { x: number; y: number; broken: boolean }[] = [],
): Light[] {
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
  // Блиндажи повстанцев: фонарь внутри, гаснет вместе с разрушением (объект живой — broken читается каждый кадр).
  for (const g of dugouts) {
    out.push({ x: g.x, y: g.y, r: L.dugout.radius, color: L.dugout.color, power: L.dugout.power, night: true, flicker: L.dugout.flicker, bloom: true, seed: seed++, off: g });
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

/** Свет горящего окна: точка на мостовой перед окном (px мира), час отбоя и утреннего света (WindowSpot). */
export interface WindowLight {
  x: number;
  y: number;
  off: number;
  wake: number;
}

/** Свет окон: по одному на горящее окно (у парного — на стыке половин), перед окном снаружи. */
export function windowLights(windows: readonly WindowSpot[], tileSize: number): WindowLight[] {
  const W = LIGHTING.window;
  const out: WindowLight[] = [];
  for (const o of windows) {
    if (!o.lit || o.pair === 2) continue;
    // Вдоль стены — середина окна (у парного — граница тайлов), поперёк — наружу от середины стены.
    const along = o.pair === 1 ? 1 : 0.5;
    const ax = SIDE_DY[o.out] !== 0 ? along : 0.5;
    const ay = SIDE_DX[o.out] !== 0 ? along : 0.5;
    out.push({ x: (o.x + ax + SIDE_DX[o.out] * W.spill) * tileSize, y: (o.y + ay + SIDE_DY[o.out] * W.spill) * tileSize, off: o.off, wake: o.wake });
  }
  return out;
}

const SPRITE = 64;
/** Ячейка сетки источников (px мира) и запас на радиус: в кадре перебираются только ячейки у экрана. */
const CELL = 512;
const REACH = 220;

/** Тайлящийся мягкий шум (облака): сумма октав сглаженного значения на решётке с переносом краёв. */
function cloudNoise(n: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(n * n);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const g = 4 << o;
    const val = new Float32Array(g * g);
    let h = (seed + o * 0x9e3779b1) >>> 0;
    for (let i = 0; i < g * g; i++) {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
      h = (h ^ Math.imul(h ^ (h >>> 12), 0x297a2d39)) >>> 0;
      val[i] = (h >>> 8) / 16777216;
    }
    for (let y = 0; y < n; y++) {
      const fy = (y / n) * g;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * g;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = val[(y0 % g) * g + (x0 % g)];
        const b = val[(y0 % g) * g + ((x0 + 1) % g)];
        const c = val[((y0 + 1) % g) * g + (x0 % g)];
        const d = val[((y0 + 1) % g) * g + ((x0 + 1) % g)];
        out[y * n + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Освещение: карта света в доле scale от экрана — заливка светом суток (с подъёмом ночи по настройке), тени облаков,
 * поверх источники сложением (мягкие пятна-спрайты с тёплым ядром), виньетка — и умножение на картинку одним
 * проходом. Свечение (плафоны, огонь, тёплая дымка вокруг света, ореолы окон и фонарей фасадов) — в мелком буфере,
 * на экран — одним проходом сложения. Источники — в сетке: в кадре только ближние к экрану.
 */
export class Lighting {
  enabled = true;
  /** Разрешение карты света (доля экрана) — по качеству атмосферы (ATMOSPHERE.presets). */
  scale: number = LIGHTING.lightmapScale;
  /** Свечение плафонов, огня, окон; тёплая дымка вокруг ночного света; тени облаков; виньетка в карте света. */
  glow = true;
  haze = true;
  clouds = true;
  vignette = true;
  /** Подъём ночи (ATMOSPHERE.night): больше 0 — светлее, меньше — темнее. */
  nightLift = 0;
  private lights: Light[] = [];
  private grid = new Map<number, Light[]>();
  private windows: WindowLight[] = [];
  private winGrid = new Map<number, WindowLight[]>();
  private gridW = 1;
  /** Памятные места со свечами (Memorials.list — тот же массив): тёплое пятно света у каждого. */
  memorials: readonly { id: number; x: number; y: number; candles: number }[] = [];
  /**
   * Свет горящих окон фасадов и фонарей у дверей на мостовую (world/RoofLayer.ts → forEachLight): fn(x, y, сила)
   * в пикселях мира; f — доля суток. null — нет фасадов.
   */
  facadeLights: ((v: View, f: number, fn: (x: number, y: number, power: number) => void) => void) | null = null;
  /** Ореолы горящих окон и фонарей фасадов — в буфер свечения (RoofLayer.forEachGlow): fn(x, y, радиус, сила). */
  facadeGlows: ((v: View, f: number, fn: (x: number, y: number, r: number, power: number) => void) => void) | null = null;
  /**
   * Насколько точку закрывает крыша (world/RoofLayer.roofAlpha): лампы комнат под крышей на улицу не светят и не
   * сияют сквозь неё (их свет наружу — окна фасадов), у дома в разрезе — светят. null — крыш нет.
   */
  covered: ((x: number, y: number) => number) | null = null;
  private lm: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  /** Буфер свечения (как карта света, мелкий): пятна складываются в нём, на экран — одним проходом. */
  private bl: HTMLCanvasElement | null = null;
  private bg: CanvasRenderingContext2D | null = null;
  private vig: HTMLCanvasElement | null = null;
  private cloudPattern: CanvasPattern | null = null;
  /** Те же облака для дня — тень с прозрачностью (обычным наложением, без карты света). */
  private cloudShade: CanvasPattern | null = null;
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly state: DayState = { ambient: [0, 0, 0], lamps: 0, name: '' };
  private readonly amb: [number, number, number] = [0, 0, 0];
  private ambientKey = '';
  private ambientStyle = '';
  private readonly near: Light[] = [];
  private readonly nearWin: WindowLight[] = [];

  /** Новая карта: собрать постоянные источники и свет окон (в сетку по ячейкам). */
  setWorld(map: GameMap, lamps: readonly Lamp[], barrels: readonly Barrel[], nodes: readonly { x: number; y: number; broken: boolean }[], dugouts: readonly { x: number; y: number; broken: boolean }[] = [], windows: readonly WindowSpot[] = []): void {
    this.lights = staticLights(map, lamps, barrels, nodes, dugouts);
    this.windows = windowLights(windows, map.tileSize);
    this.gridW = Math.ceil((map.width * map.tileSize) / CELL) + 1;
    this.grid = bucket(this.lights, this.gridW);
    this.winGrid = bucket(this.windows, this.gridW);
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

  /** Свет суток с подъёмом ночи (nightLift): ночью — к белому или темнее, днём — как есть. */
  private ambientOf(src: readonly number[]): [number, number, number] {
    const a = this.amb;
    const lum = (src[0] * 0.3 + src[1] * 0.59 + src[2] * 0.11) / 255;
    const dark = Math.max(0, Math.min(1, (0.78 - lum) / 0.36));
    const lift = this.nightLift * dark;
    for (let k = 0; k < 3; k++) a[k] = lift >= 0 ? src[k] + (255 - src[k]) * lift : src[k] * (1 + lift);
    return a;
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
    // Тёплое ядро светлее (как лампа под абажуром), мягкий долгий спад.
    const F = LIGHTING.falloff;
    const core = c.map((v) => Math.round(v + (255 - v) * F.core));
    for (const [t, a] of F.stops) {
      const m = Math.max(0, Math.min(1, (t - 0.12) / 0.2));
      const rgb = core.map((v, i) => Math.round(v + (c[i] - v) * m));
      grad.addColorStop(t, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
    }
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

  /** Источники в ячейках у экрана (с запасом на радиус) — в общий массив out. */
  private inView<T extends { x: number; y: number }>(grid: Map<number, T[]>, v: View, out: T[]): T[] {
    out.length = 0;
    const x0 = Math.floor((v.left - REACH) / CELL);
    const y0 = Math.floor((v.top - REACH) / CELL);
    const x1 = Math.floor((v.left + v.width / v.scale + REACH) / CELL);
    const y1 = Math.floor((v.top + v.height / v.scale + REACH) / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const list = grid.get(cy * this.gridW + cx);
      if (list) for (const o of list) out.push(o);
    }
    return out;
  }

  private canvasOf(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
    if (c && c.width === w && c.height === h) return c;
    const n = document.createElement('canvas');
    n.width = w;
    n.height = h;
    return n;
  }

  /**
   * Тени облаков — тайл шума, повтор узором: shade false — серый для умножения (белое — ясно, темнее — облако),
   * true — цвет тени облака с прозрачностью (днём — обычным наложением, без прохода карты света).
   */
  private cloudsPattern(g: CanvasRenderingContext2D, shade = false): CanvasPattern | null {
    const have = shade ? this.cloudShade : this.cloudPattern;
    if (have) return have;
    const C = LIGHTING.clouds;
    const n = C.texture;
    const noise = cloudNoise(n, C.octaves, C.seed);
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const cg = c.getContext('2d')!;
    const img = cg.createImageData(n, n);
    for (let i = 0; i < noise.length; i++) {
      const t = Math.max(0, Math.min(1, (noise[i] - 0.42) / 0.3));
      const cover = t * t * (3 - 2 * t);
      if (shade) {
        img.data[i * 4] = C.shade[0];
        img.data[i * 4 + 1] = C.shade[1];
        img.data[i * 4 + 2] = C.shade[2];
        img.data[i * 4 + 3] = Math.round(255 * cover);
      } else {
        const v = Math.round(255 * (1 - cover));
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
    }
    cg.putImageData(img, 0, 0);
    const p = g.createPattern(c, 'repeat');
    if (shade) this.cloudShade = p;
    else this.cloudPattern = p;
    return p;
  }

  /** Узор облаков в точку мира: плывут по ветру над картой (привязаны к миру), k — масштаб холста к экрану. */
  private placeClouds(p: CanvasPattern, v: View, k: number, time: number): void {
    const C = LIGHTING.clouds;
    const s = v.scale * k;
    const t = C.size / C.texture;
    const ox = (-(v.left + time * C.speed[0]) % C.size) * s;
    const oy = (-(v.top + time * C.speed[1]) % C.size) * s;
    p.setTransform(new DOMMatrix([t * s, 0, 0, t * s, ox, oy]));
  }

  /** Виньетка размером с карту света: в середине белое, к краю — тёплое темнее (умножение). */
  private vignetteOf(w: number, h: number): HTMLCanvasElement {
    if (this.vig && this.vig.width === w && this.vig.height === h) return this.vig;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const V = LIGHTING.vignette;
    const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * V.inner, w / 2, h / 2, Math.hypot(w, h) / 2);
    grad.addColorStop(0, 'rgb(255,255,255)');
    grad.addColorStop(1, `rgb(${V.edge[0]},${V.edge[1]},${V.edge[2]})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    this.vig = c;
    return c;
  }

  /**
   * Карта света и умножение на картинку. sewer — игрок в канализации (там свои сумерки). Динамические источники:
   * пламя, взрывы, вспышки выстрелов, горящие, свой свет игрока. true — виньетка уже наложена (в карте света).
   */
  draw(ctx: CanvasRenderingContext2D, v: View, time: number, player: Character, combat: CombatSystem, entities: readonly Character[], sewer: boolean): boolean {
    if (!this.enabled) return false;
    const st = this.day(time);
    const amb = this.ambientOf(sewer ? LIGHTING.sewer : st.ambient);
    const lamps = sewer ? 1 : st.lamps;
    const clouds = this.clouds && !sewer;
    // Ясный день, лампы погашены — умножать не на что (проход на весь экран не нужен): облака — тенью обычным
    // наложением, виньетку Game кладёт своим слоем (оба дешевле умножения на весь экран).
    if (!sewer && lamps <= LIGHTING.lampsOn && amb[0] >= LIGHTING.skipDay && amb[1] >= LIGHTING.skipDay && amb[2] >= LIGHTING.skipDay - 20) {
      if (clouds) {
        const pat = this.cloudsPattern(ctx, true);
        if (pat) {
          this.placeClouds(pat, v, 1, time);
          ctx.globalAlpha = LIGHTING.clouds.day;
          ctx.fillStyle = pat;
          ctx.fillRect(0, 0, v.width, v.height);
          ctx.globalAlpha = 1;
        }
      }
      return false;
    }
    const k = this.scale;
    const w = Math.max(1, Math.ceil(v.width * k));
    const h = Math.max(1, Math.ceil(v.height * k));
    if (!this.lm || this.lm.width !== w || this.lm.height !== h) {
      this.lm = this.canvasOf(this.lm, w, h);
      this.g = this.lm.getContext('2d', { alpha: false })!;
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
    const L = LIGHTING;
    // Тени облаков: плывут по ветру над картой (привязаны к миру), затеняют свет суток — не лампы.
    if (clouds) {
      const pat = this.cloudsPattern(g);
      if (pat) {
        const C = L.clouds;
        const dark = Math.max(0, Math.min(1, 1 - (amb[0] + amb[1] + amb[2]) / (3 * 255)));
        this.placeClouds(pat, v, k, time);
        g.globalCompositeOperation = 'multiply';
        g.globalAlpha = C.day + (C.night - C.day) * dark;
        g.fillStyle = pat;
        g.fillRect(0, 0, w, h);
        g.globalAlpha = 1;
      }
    }
    g.globalCompositeOperation = 'lighter';
    const cov = this.covered;
    for (const s of this.inView(this.grid, v, this.near)) {
      if (s.off?.broken) continue;
      const on = s.night ? lamps : 1;
      if (on <= L.lampsOn) continue;
      const open = cov ? 1 - cov(s.x, s.y) : 1;
      if (open <= 0.01) continue;
      this.put(g, v, k, s.x, s.y, s.r, s.color, s.power * on * open * this.flick(s, time));
    }
    // Окна: у каждого свой час отбоя.
    const W = L.window;
    const f = dayFraction(time);
    if (lamps > L.lampsOn) {
      for (const o of this.inView(this.winGrid, v, this.nearWin)) if (windowOn(o, f)) this.put(g, v, k, o.x, o.y, W.radius, W.color, W.power * lamps);
      const R = FACADES.night.spillR;
      this.facadeLights?.(v, f, (x, y, p) => this.put(g, v, k, x, y, R, W.color, W.power * FACADES.night.spillPower * p * lamps));
    }
    // Свечи на памятных местах: чем больше свечей, тем ярче; мерцают.
    const G = MEMORIALS.glow;
    for (const m of this.memorials) {
      if (m.candles <= 0) continue;
      const fl = 1 - G.flicker * 0.5 * (1 + Math.sin(time * 9 + m.id * 3.1) * Math.sin(time * 5.7 + m.id));
      this.put(g, v, k, m.x, m.y, G.radius, G.color, Math.min(G.max, G.power + G.perCandle * (m.candles - 1)) * fl);
    }
    // Пламя, взрывы, горящие, вспышки выстрелов.
    for (const fr of combat.fires) this.put(g, v, k, fr.x, fr.y, fr.r * L.fire.radiusMul, L.fire.color, L.fire.power * (1 - L.fire.flicker * 0.5 * (1 + Math.sin(time * 13 + fr.x))));
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
    // Виньетка — тем же проходом: края темнее и теплее.
    if (this.vignette) {
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = 1;
      g.drawImage(this.vignetteOf(w, h), 0, 0);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(this.lm, 0, 0, v.width, v.height);
    ctx.globalCompositeOperation = 'source-over';
    return this.vignette;
  }

  /**
   * Свечение (тем ярче, чем темнее вокруг): плафоны и огонь, тёплая дымка вокруг каждого ночного источника (haze),
   * ореолы горящих окон и фонарей фасадов. Пятна складываются в мелком буфере, на экран — одним проходом сложения.
   */
  drawBloom(ctx: CanvasRenderingContext2D, v: View, time: number, sewer: boolean): void {
    if (!this.enabled || !this.glow) return;
    const B = LIGHTING.bloom;
    const H = LIGHTING.haze;
    const dark = sewer ? 0.7 : this.darkness(time);
    const lamps = sewer ? 1 : this.state.lamps;
    const a = B.alpha * (0.25 + 0.75 * dark);
    if (a < 0.02) return;
    // Свечение мягкое — его буфер мельче карты света (дешевле, разницы не видно).
    const k = Math.max(0.1, this.scale * LIGHTING.glowScale);
    const w = Math.max(1, Math.ceil(v.width * k));
    const h = Math.max(1, Math.ceil(v.height * k));
    if (!this.bl || this.bl.width !== w || this.bl.height !== h) {
      this.bl = this.canvasOf(this.bl, w, h);
      this.bg = this.bl.getContext('2d')!;
    }
    const g = this.bg!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    let any = false;
    const cov = this.covered;
    const haze = this.haze && dark > 0.15 ? H.alpha * dark : 0;
    for (const L of this.inView(this.grid, v, this.near)) {
      if (L.off?.broken) continue;
      const on = L.night ? lamps : 1;
      if (on <= LIGHTING.lampsOn) continue;
      const open = cov ? 1 - cov(L.x, L.y) : 1;
      if (open <= 0.01) continue;
      const fl = this.flick(L, time);
      if (L.bloom && this.put(g, v, k, L.x, L.y, L.r * B.radius, L.color, a * on * L.power * open * fl)) any = true;
      if (haze > 0 && this.put(g, v, k, L.x, L.y, L.r * H.radius, L.color, haze * on * L.power * open * fl)) any = true;
    }
    // Ореолы окон и фонарей фасадов: тёплые, тем ярче, чем темнее.
    if (lamps > LIGHTING.lampsOn && this.facadeGlows) {
      const W = LIGHTING.window.color;
      this.facadeGlows(v, dayFraction(time), (x, y, r, p) => {
        if (this.put(g, v, k, x, y, r, W, p * lamps * (0.4 + 0.6 * dark))) any = true;
      });
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (!any) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bl, 0, 0, v.width, v.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Горящие фонари на экране (для пылинок в их свете). */
  litLamps(): readonly Light[] {
    return this.lights;
  }

  /** Источники у экрана (для пылинок): из сетки. */
  lightsNear(v: View): readonly Light[] {
    return this.inView(this.grid, v, this.near);
  }
}

/** Разложить по ячейкам сетки (CELL px мира) по центру. */
function bucket<T extends { x: number; y: number }>(list: readonly T[], gw: number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const o of list) {
    const key = Math.floor(o.y / CELL) * gw + Math.floor(o.x / CELL);
    let a = out.get(key);
    if (!a) out.set(key, (a = []));
    a.push(o);
  }
  return out;
}
