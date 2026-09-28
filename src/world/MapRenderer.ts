import type { GameMap } from './GameMap';
import type { View } from '../core/Camera';
import { T, SOLID } from './tiles';
import { hash2, hash01 } from '../core/rng';
import { RENDER } from '../config/render';
import { computeLots, type Lot } from './houses';
import { ARBAT } from '../config/arbat';
import { ZONE_NAMES } from '../config/names';
import type { Poi } from './GameMap';

/** Дом в ряду вдоль улицы (POI facade) для отрисовки: цвет штукатурки и маркизы, вывеска. */
interface FacadeLook {
  p: Poi;
  color: [number, number, number];
  awning: readonly [string, string];
  sign: string | null;
}

/** Что стоит на тайле-укрытии: 1 — прилавок/стол (дерево), 2 — ларёк, 3 — клумба. */
const DECOR_WOOD = 1;
const DECOR_KIOSK = 2;
const DECOR_PLANTER = 3;

/**
 * Цвет HSL → '#rrggbb'. Цвета тайлов считаются один раз при загрузке, а разбираются браузером при
 * каждой заливке (тысячи раз за кадр) — короткий hex разбирается заметно быстрее строки hsl().
 */
const hsl = (h: number, s: number, l: number): string => {
  const S = Math.max(0, Math.min(100, s)) / 100;
  const L = Math.max(0, Math.min(100, l)) / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map((c) => c.toString(16).padStart(2, '0')).join('');
};

/** Кусок карты, отрисованный в холст (MapRenderer.draw). */
interface Chunk {
  canvas: HTMLCanvasElement;
  cx: number;
  cy: number;
}

/**
 * Отрисовка тайлов: куски карты в кэше (холсты по уровням масштаба), двери поверх; координаты
 * округляются в пространстве экрана — без щелей между тайлами. Цвета и маски соседей считаются
 * один раз при загрузке карты.
 */
export class MapRenderer {
  private readonly color: string[];
  /** Для стен — биты соседей-пола (N=1,E=2,S=4,W=8); для пола — биты соседей-стен (+16 = стена по диагонали СЗ). */
  private readonly edges: Uint8Array;
  /** Участок-дом на тайл (computeLots) и сами участки — у каждого своя крыша. */
  private readonly parcel: Int32Array;
  private readonly lots: Lot[];
  /** Часть крыши: 0 — нет, 1 — светлый скат, 2 — тёмный, 3 — конёк, 4 — стена жилого дома; бит 8 — конёк вдоль x. */
  private readonly roofPart: Uint8Array;
  /** Трубы на крышах (тайлы). */
  private readonly chimney: Uint8Array;
  private readonly noise: Uint32Array;
  /** Пол помещения: 1 — доска (жилые), 2 — плитка (Нексус, КПЗ, магазин, казённое). */
  private readonly floor: Uint8Array;
  private xs = new Float64Array(0);
  private ys = new Float64Array(0);
  /** Дом вдоль улицы на тайл (индекс в facades, -1 — нет), укрытие-мебель, брусчатка проспекта. */
  private readonly facadeOf: Int16Array;
  private readonly facades: FacadeLook[] = [];
  private readonly decor: Uint8Array;
  private readonly cobble: Uint8Array;
  private readonly kiosks: Poi[];

  constructor(private readonly map: GameMap) {
    const { width: w, height: h } = map;
    const n = w * h;
    this.color = new Array<string>(n);
    this.edges = new Uint8Array(n);
    this.facadeOf = new Int16Array(n).fill(-1);
    this.decor = new Uint8Array(n);
    this.cobble = new Uint8Array(n);
    const Fc = RENDER.facade;
    const signs = new Map<string, string>([...ARBAT.shops, ...ARBAT.cafes].map((d) => [d.id, d.sign]));
    for (const p of map.poisOf('facade')) {
      const k = this.facades.length;
      const c = Fc.plaster[hash2(p.id ?? k, p.x, (map.seed | 0) + 17) % Fc.plaster.length];
      const sign = p.use === 'canteen' ? ARBAT.canteen.sign : p.use === 'house' ? null : signs.get(p.sub ?? '') ?? null;
      this.facades.push({ p, color: [c.h, c.s, c.l], awning: Fc.awning[hash2(p.x, p.y, 91) % Fc.awning.length], sign });
      for (let y = p.y; y < p.y + p.h!; y++) {
        for (let x = p.x; x < p.x + p.w!; x++) {
          const i = y * w + x;
          if (map.tiles[i] === T.STREET) continue;
          this.facadeOf[i] = k;
          if (map.tiles[i] === T.BARRIER) this.decor[i] = DECOR_WOOD;
        }
      }
    }
    this.kiosks = map.poisOf('kiosk');
    for (const [list, kind] of [[this.kiosks, DECOR_KIOSK], [map.poisOf('planter'), DECOR_PLANTER]] as const) {
      for (const p of list) for (let y = p.y; y < p.y + p.h!; y++) for (let x = p.x; x < p.x + p.w!; x++) this.decor[y * w + x] = kind;
    }
    const avenues = new Set(map.zones.filter((z) => z.kind === 'avenue' && (ZONE_NAMES.avenue as readonly string[]).includes(z.name)).map((z) => z.id));
    for (let i = 0; i < n; i++) if (map.tiles[i] === T.STREET && avenues.has(map.zoneGrid[i])) this.cobble[i] = 1;
    // Крыши — только у глухой застройки: дома вдоль улицы рисуются штукатуркой и фасадом.
    const roofTiles = Uint8Array.from(map.tiles, (t, i) => (this.facadeOf[i] >= 0 ? T.INTERIOR : t));
    const lots = computeLots(w, h, roofTiles, map.seed | 0);
    this.parcel = lots.lot;
    this.lots = lots.lots;
    this.roofPart = new Uint8Array(n);
    this.chimney = new Uint8Array(n);
    this.noise = new Uint32Array(n);
    this.floor = new Uint8Array(n);
    const seed = map.seed | 0;
    this.placeChimneys(seed);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.computeTile(x, y);
    for (let i = 0; i < n; i++) if (map.tiles[i] === T.DOOR) this.doorTiles.push(i);
  }

  private readonly roofColor = new Map<number, [number, number, number]>();

  /** Пересчитать тайл и соседей (игрок поставил/убрал блок). */
  refresh(tx: number, ty: number): void {
    for (let y = ty - 1; y <= ty + 1; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) if (this.map.inBounds(x, y)) this.computeTile(x, y);
    }
    // Куски в кэше, которых касается изменение, — перерисовать.
    const n = RENDER.mapCache.chunk;
    for (const [key, c] of this.chunks) {
      if (c.cx >= Math.floor((tx - 1) / n) && c.cx <= Math.floor((tx + 1) / n) && c.cy >= Math.floor((ty - 1) / n) && c.cy <= Math.floor((ty + 1) / n)) this.chunks.delete(key);
    }
  }

  /** Цвет и маска соседей одного тайла. */
  private computeTile(x: number, y: number): void {
    const map = this.map;
    const seed = map.seed | 0;
    const P = RENDER.tiles;
    const i = y * map.width + x;
    const t = map.tiles[i];
    const hv = hash2(x, y, seed);
    this.noise[i] = hv;
    const jit = (hv / 4294967296 - 0.5) * 2;
    const solid = SOLID[t] === 1;
    let e = 0;
    const nb = (dx: number, dy: number) => map.isSolid(x + dx, y + dy);
    if (solid) {
      if (!nb(0, -1)) e |= 1;
      if (!nb(1, 0)) e |= 2;
      if (!nb(0, 1)) e |= 4;
      if (!nb(-1, 0)) e |= 8;
    } else {
      if (nb(0, -1)) e |= 1;
      if (nb(1, 0)) e |= 2;
      if (nb(0, 1)) e |= 4;
      if (nb(-1, 0)) e |= 8;
      if (nb(-1, -1)) e |= 16;
    }
    this.edges[i] = e;
    const tone = (c: { h: number; s: number; l: number; noise: number }) => hsl(c.h, c.s, c.l + jit * c.noise);
    switch (t) {
      case T.WALL: {
        // Дом вдоль улицы — штукатурка своего цвета (фасад дорисовывается в paint).
        const fk = this.facadeOf[i];
        if (fk >= 0) {
          const c = this.facades[fk].color;
          this.roofPart[i] = 6;
          this.color[i] = hsl(c[0], c[1], c[2] + jit * RENDER.facade.noise);
          break;
        }
        // Стена жилого дома (рядом с комнатой) — штукатурка, не крыша.
        let houseWall = false;
        for (let dy = -1; dy <= 1 && !houseWall; dy++) for (let dx = -1; dx <= 1; dx++) if (map.tileAt(x + dx, y + dy) === T.INTERIOR && map.zoneAtTile(x + dx, y + dy)?.kind === 'residential') houseWall = true;
        if (houseWall) {
          this.roofPart[i] = 4;
          this.color[i] = tone(P.houseWall);
          break;
        }
        const p = this.parcel[i];
        let rc = this.roofColor.get(p);
        if (!rc) {
          const r1 = hash01(p, 1, seed);
          const r2 = hash01(p, 2, seed);
          const r3 = hash01(p, 3, seed);
          const R = P.roof;
          rc = [R.hues[Math.floor(r1 * R.hues.length)], R.sat[0] + r2 * (R.sat[1] - R.sat[0]), R.light[0] + r3 * (R.light[1] - R.light[0])];
          this.roofColor.set(p, rc);
        }
        // Двускатная крыша: конёк вдоль длинной стороны участка.
        const lot = p >= 0 ? this.lots[p] : null;
        let shade = 0;
        if (lot && lot.tiles >= 6) {
          const alongX = lot.x1 - lot.x0 >= lot.y1 - lot.y0;
          const a = alongX ? y : x;
          const mid = alongX ? (lot.y0 + lot.y1) / 2 : (lot.x0 + lot.x1) / 2;
          const S = P.roofSlope;
          const part = Math.abs(a - mid) < 0.6 ? 3 : a < mid ? 1 : 2;
          shade = part === 3 ? S.ridge : part === 1 ? S.light : S.dark;
          this.roofPart[i] = part | (alongX ? 8 : 0);
        }
        this.color[i] = hsl(rc[0], rc[1], rc[2] + shade + jit * 0.8);
        break;
      }
      case T.METAL: this.color[i] = P.metal; break;
      case T.FLOOR: this.color[i] = tone(P.floor); break;
      case T.STREET: this.color[i] = this.cobble[i] ? tone(RENDER.facade.cobble) : tone(P.street); break;
      case T.PLAZA: this.color[i] = tone(P.plaza); break;
      case T.INTERIOR: {
        const wood = map.zoneAtTile(x, y)?.kind === 'residential';
        this.floor[i] = wood ? 1 : 2;
        // Доски одной полосы — один тон (полоса = ряд тайлов), плитка — чуть разная.
        this.color[i] = wood ? hsl(P.woodFloor.h, P.woodFloor.s, P.woodFloor.l + ((hash2(0, y, seed) & 7) - 3.5) * 0.5 + jit * P.woodFloor.noise) : tone(P.tileFloor);
        break;
      }
      case T.COURTYARD: this.color[i] = tone(P.courtyard); break;
      case T.ARCH: this.color[i] = tone(P.arch); break;
      case T.DOOR: this.color[i] = P.doorFrame; break;
      case T.GATE: this.color[i] = P.gate; break;
      case T.BUNKER: this.color[i] = tone(P.bunker); break;
      case T.WASTE: this.color[i] = tone(P.waste); break;
      case T.BARRIER: {
        const d = this.decor[i];
        const F = RENDER.facade;
        this.color[i] = d === DECOR_WOOD ? F.wood : d === DECOR_KIOSK ? F.kiosk.body : d === DECOR_PLANTER ? F.planter.rim : P.barrier;
        break;
      }
      case T.SEWER: this.color[i] = tone(P.sewer); break;
      case T.SEWER_WATER: this.color[i] = tone(P.sewerWater); break;
      case T.SEWER_WALL: this.color[i] = tone(P.sewerWall); break;
      case T.ROCK: this.color[i] = tone(P.rock); break;
      case T.GARDEN: this.color[i] = tone(P.garden); break;
      case T.HEDGE: this.color[i] = tone(P.hedge); break;
      default: this.color[i] = '#f0f';
    }
  }

  /** Центры труб в координатах мира (дымок из труб — world/Ambience). */
  chimneyPoints(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const w = this.map.width;
    const ts = this.map.tileSize;
    for (let i = 0; i < this.chimney.length; i++) if (this.chimney[i]) out.push({ x: ((i % w) + 0.5) * ts, y: (Math.floor(i / w) + 0.5) * ts });
    return out;
  }

  /** Трубы: на каждом крупном доме одна, на скате, не на краю. */
  private placeChimneys(seed: number): void {
    const w = this.map.width;
    for (const l of this.lots) {
      if (l.tiles < 12 || hash2(l.id, 5, seed) % 3 === 0) continue;
      const x = l.x0 + 1 + (hash2(l.id, 6, seed) % Math.max(1, l.x1 - l.x0 - 1));
      const y = l.y0 + 1 + (hash2(l.id, 7, seed) % Math.max(1, l.y1 - l.y0 - 1));
      if (this.parcel[y * w + x] === l.id) this.chimney[y * w + x] = 1;
    }
  }


  /** Куски карты в кэше (LRU: порядок вставки в Map), ключ — кусок и уровень масштаба. */
  private readonly chunks = new Map<string, Chunk>();
  /** Все тайлы дверей — их состояние меняется, рисуются поверх кэша каждый кадр. */
  private readonly doorTiles: number[] = [];

  /**
   * Видимая часть карты. Куски по MAP_CACHE.chunk тайлов рисуются один раз в холст на уровне
   * масштаба (ближайший не меньше текущего из MAP_CACHE.levels) и дальше только копируются —
   * тысячи заливок на кадр превращаются в пару десятков drawImage (при прицеле камера отъезжает,
   * тайлов на экране больше — раньше из-за этого кадр проседал). Не больше buildPerFrame новых
   * кусков за кадр: остальные этот кадр — растянутым куском другого уровня, если он есть, иначе
   * напрямую. Двери — поверх, по состоянию.
   */
  draw(ctx: CanvasRenderingContext2D, v: View): void {
    const map = this.map;
    const ts = map.tileSize;
    const s = v.scale;
    const tx0 = Math.max(0, Math.floor(v.left / ts));
    const ty0 = Math.max(0, Math.floor(v.top / ts));
    const tx1 = Math.min(map.width - 1, Math.floor((v.left + v.width / s) / ts));
    const ty1 = Math.min(map.height - 1, Math.floor((v.top + v.height / s) / ts));
    if (tx1 < tx0 || ty1 < ty0) return;
    if (typeof document === 'undefined') {
      this.paint(ctx, tx0, ty0, tx1, ty1, v.left, v.top, s, true);
      return;
    }
    const C = RENDER.mapCache;
    let q: number = C.levels[C.levels.length - 1];
    for (const l of C.levels) {
      if (l >= s - 1e-6) {
        q = l;
        break;
      }
    }
    const n = C.chunk;
    let budget: number = C.buildPerFrame;
    for (let cy = Math.floor(ty0 / n); cy <= Math.floor(ty1 / n); cy++) {
      for (let cx = Math.floor(tx0 / n); cx <= Math.floor(tx1 / n); cx++) {
        const ax = cx * n;
        const ay = cy * n;
        const bx = Math.min(map.width, ax + n);
        const by = Math.min(map.height, ay + n);
        const dx0 = Math.round((ax * ts - v.left) * s);
        const dy0 = Math.round((ay * ts - v.top) * s);
        const dx1 = Math.round((bx * ts - v.left) * s);
        const dy1 = Math.round((by * ts - v.top) * s);
        const key = `${cx},${cy},${q}`;
        let c = this.chunks.get(key);
        if (c) {
          // LRU: свежий — в конец.
          this.chunks.delete(key);
          this.chunks.set(key, c);
        } else if (budget > 0) {
          budget--;
          c = this.buildChunk(cx, cy, ax, ay, bx, by, q);
          this.chunks.set(key, c);
          if (this.chunks.size > C.max) this.chunks.delete(this.chunks.keys().next().value as string);
        }
        // Нет в кэше и бюджет исчерпан — тот же кусок другого уровня (камера только что сменила
        // масштаб: чуть мягче или резче один-два кадра лучше, чем рисовать десяток кусков напрямую).
        c ??= this.fallback(cx, cy, q);
        if (c) ctx.drawImage(c.canvas, dx0, dy0, dx1 - dx0, dy1 - dy0);
        else this.paint(ctx, Math.max(ax, tx0), Math.max(ay, ty0), Math.min(bx - 1, tx1), Math.min(by - 1, ty1), v.left, v.top, s, false);
      }
    }
    this.drawDoors(ctx, v, tx0, ty0, tx1, ty1);
  }

  /** Кусок (cx, cy) в кэше на любом уровне, кроме q: сперва ближайшие к q. */
  private fallback(cx: number, cy: number, q: number): Chunk | undefined {
    const L = RENDER.mapCache.levels;
    const i = L.indexOf(q);
    for (let d = 1; d < L.length; d++) {
      for (const j of [i + d, i - d]) {
        if (j < 0 || j >= L.length) continue;
        const c = this.chunks.get(`${cx},${cy},${L[j]}`);
        if (c) return c;
      }
    }
    return undefined;
  }

  /** Кусок карты в холст на масштабе q (двери — только основой, полотно рисуется поверх). */
  private buildChunk(cx: number, cy: number, ax: number, ay: number, bx: number, by: number, q: number): Chunk {
    const ts = this.map.tileSize;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((bx - ax) * ts * q));
    canvas.height = Math.max(1, Math.round((by - ay) * ts * q));
    const g = canvas.getContext('2d')!;
    this.paint(g, ax, ay, bx - 1, by - 1, ax * ts, ay * ts, q, false);
    return { canvas, cx, cy };
  }

  /** Полотна дверей по их текущему состоянию (закрыта, открыта, заперта). */
  private drawDoors(ctx: CanvasRenderingContext2D, v: View, tx0: number, ty0: number, tx1: number, ty1: number): void {
    const map = this.map;
    const ts = map.tileSize;
    const s = v.scale;
    const w = map.width;
    const P = RENDER.tiles;
    const inset = Math.max(1, Math.round(2 * s));
    for (const i of this.doorTiles) {
      const tx = i % w;
      const ty = (i - tx) / w;
      if (tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1) continue;
      const x0 = Math.round((tx * ts - v.left) * s);
      const y0 = Math.round((ty * ts - v.top) * s);
      const cw = Math.round(((tx + 1) * ts - v.left) * s) - x0;
      const ch = Math.round(((ty + 1) * ts - v.top) * s) - y0;
      this.doorFace(ctx, i, x0, y0, cw, ch, inset, P);
    }
  }

  private doorFace(ctx: CanvasRenderingContext2D, i: number, x0: number, y0: number, cw: number, ch: number, inset: number, P: typeof RENDER.tiles): void {
    const map = this.map;
    if (map.doorClosed[i]) {
      ctx.fillStyle = P.door;
      ctx.fillRect(x0 + inset, y0 + inset, cw - inset * 2, ch - inset * 2);
      if (map.doorLocked[i]) {
        ctx.fillStyle = P.doorLocked;
        ctx.fillRect(x0 + inset, y0 + (ch >> 1) - inset, cw - inset * 2, inset * 2);
      }
    } else {
      ctx.fillStyle = P.doorOpen;
      ctx.fillRect(x0 + inset, y0 + inset, cw - inset * 2, ch - inset * 2);
    }
  }

  /**
   * Нарисовать тайлы tx0..tx1 × ty0..ty1: мировая точка (ox, oy) — в (0, 0) холста, s — пикселей на
   * пиксель мира; координаты округляются — без щелей. doors — рисовать и полотна дверей.
   */
  private paint(ctx: CanvasRenderingContext2D, tx0: number, ty0: number, tx1: number, ty1: number, ox: number, oy: number, s: number, doors: boolean): void {
    const map = this.map;
    const ts = map.tileSize;
    const w = map.width;
    if (tx1 < tx0 || ty1 < ty0) return;
    const cols = tx1 - tx0 + 2;
    const rows = ty1 - ty0 + 2;
    if (this.xs.length < cols) this.xs = new Float64Array(cols);
    if (this.ys.length < rows) this.ys = new Float64Array(rows);
    for (let k = 0; k < cols; k++) this.xs[k] = Math.round(((tx0 + k) * ts - ox) * s);
    for (let k = 0; k < rows; k++) this.ys[k] = Math.round(((ty0 + k) * ts - oy) * s);
    const xs = this.xs;
    const ys = this.ys;
    const px = (world: number) => Math.max(1, Math.round(world * s));
    const P = RENDER.tiles;

    // 1. Базовая заливка.
    for (let ty = ty0; ty <= ty1; ty++) {
      const r = ty - ty0;
      const y0 = ys[r];
      const hgt = ys[r + 1] - y0;
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = tx - tx0;
        ctx.fillStyle = this.color[ty * w + tx];
        ctx.fillRect(xs[c], y0, xs[c + 1] - xs[c], hgt);
      }
    }

    // 2. Детали по типам.
    const line = px(1);
    const shadow = px(P.shadowSize);
    for (let ty = ty0; ty <= ty1; ty++) {
      const r = ty - ty0;
      const y0 = ys[r];
      const y1 = ys[r + 1];
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = tx - tx0;
        const x0 = xs[c];
        const x1 = xs[c + 1];
        const i = ty * w + tx;
        const t = map.tiles[i];
        const e = this.edges[i];
        const hv = this.noise[i];
        const cw = x1 - x0;
        const ch = y1 - y0;
        switch (t) {
          case T.WALL: {
            const part = this.roofPart[i];
            if ((part & 7) === 6) {
              this.facadeWall(ctx, i, tx, ty, x0, y0, x1, y1, e, line, px);
              continue;
            }
            if ((part & 7) === 4) {
              // Стена жилого дома: контур со стороны улицы и комнаты.
              if (e) {
                ctx.fillStyle = P.houseWallLine;
                if (e & 1) ctx.fillRect(x0, y0, cw, line);
                if (e & 4) ctx.fillRect(x0, y1 - line, cw, line);
                if (e & 8) ctx.fillRect(x0, y0, line, ch);
                if (e & 2) ctx.fillRect(x1 - line, y0, line, ch);
              }
              continue;
            }
            // Черепица: штрихи поперёк ската; конёк — светлая линия.
            if (part) {
              const alongX = (part & 8) !== 0;
              ctx.fillStyle = P.roofTile;
              if (alongX) ctx.fillRect(x0 + (cw >> 1), y0, line, ch);
              else ctx.fillRect(x0, y0 + (ch >> 1), cw, line);
              if ((part & 7) === 3) {
                ctx.fillStyle = P.roofRidge;
                if (alongX) ctx.fillRect(x0, y0 + (ch >> 1) - line, cw, line * 2);
                else ctx.fillRect(x0 + (cw >> 1) - line, y0, line * 2, ch);
              }
            }
            if (this.chimney[i]) {
              ctx.fillStyle = P.chimney;
              ctx.fillRect(x0 + (cw >> 2), y0 + (ch >> 2), cw >> 1, ch >> 1);
              ctx.fillStyle = P.chimneyTop;
              ctx.fillRect(x0 + (cw >> 2) + line, y0 + (ch >> 2) + line, (cw >> 1) - line * 2, (ch >> 1) - line * 2);
            }
            // Швы между домами и карниз у края крыши.
            ctx.fillStyle = P.roofSeam;
            if (tx + 1 < w && map.tiles[i + 1] === T.WALL && this.parcel[i + 1] !== this.parcel[i]) ctx.fillRect(x1 - line, y0, line, ch);
            if (ty + 1 < map.height && map.tiles[i + w] === T.WALL && this.parcel[i + w] !== this.parcel[i]) ctx.fillRect(x0, y1 - line, cw, line);
            if (e) {
              ctx.fillStyle = P.roofEdge;
              if (e & 1) ctx.fillRect(x0, y0, cw, line * 2);
              if (e & 4) ctx.fillRect(x0, y1 - line * 2, cw, line * 2);
              if (e & 8) ctx.fillRect(x0, y0, line * 2, ch);
              if (e & 2) ctx.fillRect(x1 - line * 2, y0, line * 2, ch);
            }
            continue;
          }
          case T.METAL:
            ctx.fillStyle = P.metalLine;
            ctx.fillRect(x0 + (cw >> 1), y0, line, ch);
            if (e & 1) ctx.fillRect(x0, y0, cw, line * 2);
            if (e & 4) ctx.fillRect(x0, y1 - line * 2, cw, line * 2);
            if (e & 8) ctx.fillRect(x0, y0, line * 2, ch);
            if (e & 2) ctx.fillRect(x1 - line * 2, y0, line * 2, ch);
            continue;
          case T.BARRIER: {
            if (this.decor[i]) {
              this.decorTile(ctx, i, x0, y0, cw, ch, hv, line, px);
              continue;
            }
            const b = px(1.5);
            ctx.fillStyle = P.barrierEdge;
            ctx.fillRect(x0, y1 - b, cw, b);
            ctx.fillRect(x1 - b, y0, b, ch);
            ctx.fillStyle = P.barrierTop;
            ctx.fillRect(x0, y0, cw, b);
            ctx.fillRect(x0, y0, b, ch);
            continue;
          }
          case T.HEDGE: {
            // Листва: пятна светлее и темнее, тень снизу.
            ctx.fillStyle = P.hedgeLeaf;
            ctx.fillRect(x0 + px((hv & 7) + 2), y0 + px(((hv >> 3) & 7) + 2), px(5), px(4));
            ctx.fillRect(x0 + px(((hv >> 6) & 7) + 1), y0 + px(((hv >> 9) & 7) + 4), px(4), px(4));
            ctx.fillStyle = P.hedgeShade;
            ctx.fillRect(x0, y1 - px(2), cw, px(2));
            continue;
          }
          case T.GARDEN:
            ctx.fillStyle = P.gardenBlade;
            ctx.fillRect(x0 + px((hv & 15) * 0.8), y0 + px(((hv >> 4) & 15) * 0.8), px(1), px(3));
            ctx.fillRect(x0 + px(((hv >> 8) & 15) * 0.8), y0 + px(((hv >> 12) & 15) * 0.8), px(1), px(2));
            break;
          case T.SEWER_WALL:
            // Кирпичная кладка со смещением рядов; кромка у прохода.
            ctx.fillStyle = P.sewerBrick;
            ctx.fillRect(x0, y0 + (ch >> 1), cw, line);
            ctx.fillRect(x0 + ((ty & 1) ? cw >> 1 : 0), y0, line, ch >> 1);
            ctx.fillRect(x0 + ((ty & 1) ? 0 : cw >> 1), y0 + (ch >> 1), line, ch >> 1);
            if (e) {
              ctx.fillStyle = P.sewerWallEdge;
              if (e & 1) ctx.fillRect(x0, y0, cw, line * 2);
              if (e & 4) ctx.fillRect(x0, y1 - line * 2, cw, line * 2);
              if (e & 8) ctx.fillRect(x0, y0, line * 2, ch);
              if (e & 2) ctx.fillRect(x1 - line * 2, y0, line * 2, ch);
            }
            continue;
          case T.SEWER:
            ctx.fillStyle = P.sewerLine;
            if ((tx % 3) === 0) ctx.fillRect(x0, y0, line, ch);
            if ((ty % 3) === 0) ctx.fillRect(x0, y0, cw, line);
            break;
          case T.SEWER_WATER:
            // Струи стока вдоль тоннеля.
            ctx.fillStyle = P.sewerFlow;
            ctx.fillRect(x0 + px((hv & 7) * 1.5), y0 + px(((hv >> 3) & 7) * 1.5), px(5), px(1));
            ctx.fillRect(x0 + px(((hv >> 6) & 7) * 1.5), y0 + px(((hv >> 9) & 7) * 1.5), px(1), px(4));
            break;
          case T.BUNKER:
            ctx.fillStyle = P.bunkerLine;
            if ((tx & 1) === 0) ctx.fillRect(x0, y0, line, ch);
            if ((ty & 1) === 0) ctx.fillRect(x0, y0, cw, line);
            break;
          case T.ROCK:
            // Трещины и камни.
            ctx.fillStyle = P.rockCrack;
            ctx.fillRect(x0 + px((hv & 15) * 0.8), y0 + px(((hv >> 4) & 15) * 0.8), px(4), px(1));
            ctx.fillRect(x0 + px(((hv >> 8) & 15) * 0.8), y0 + px(((hv >> 12) & 15) * 0.8), px(1), px(3));
            continue;
          case T.FLOOR:
          case T.WASTE:
          case T.COURTYARD:
            ctx.fillStyle = P.speckle;
            ctx.fillRect(x0 + px((hv & 15) * 0.8), y0 + px(((hv >> 4) & 15) * 0.8), px(2), px(2));
            ctx.fillRect(x0 + px(((hv >> 8) & 15) * 0.8), y0 + px(((hv >> 12) & 15) * 0.8), px(3), px(1));
            break;
          case T.STREET:
            if (this.cobble[i]) {
              // Брусчатка: ряды камней со швами вразбежку.
              const C = RENDER.facade.cobble;
              ctx.fillStyle = C.joint;
              const sh = px(C.h2);
              for (let yy = 0; yy < ch; yy += sh) {
                ctx.fillRect(x0, y0 + yy, cw, line);
                const off = ((ty * 16 + yy / Math.max(1, s)) / C.h2) & 1 ? px(C.w / 2) : 0;
                for (let xx = off; xx < cw; xx += px(C.w)) ctx.fillRect(x0 + xx, y0 + yy, line, Math.min(sh, ch - yy));
              }
              break;
            }
            if (hv % 9 === 0) {
              ctx.fillStyle = P.speckle;
              ctx.fillRect(x0 + px((hv >> 4) & 7), y0 + px((hv >> 8) & 15), px(6), px(1));
            }
            break;
          case T.PLAZA:
            ctx.fillStyle = P.plazaLine;
            ctx.fillRect(x0, y0, cw, line);
            ctx.fillRect(x0, y0, line, ch);
            break;
          case T.INTERIOR:
            if (this.floor[i] === 1) {
              // Доски вдоль x: две доски на тайл, стыки вразбежку.
              ctx.fillStyle = P.woodFloorLine;
              ctx.fillRect(x0, y0, cw, line);
              ctx.fillRect(x0, y0 + (ch >> 1), cw, line);
              ctx.fillRect(x0 + ((hv & 3) * cw) / 4, y0, line, ch >> 1);
              ctx.fillRect(x0 + (((hv >> 2) & 3) * cw) / 4, y0 + (ch >> 1), line, ch >> 1);
              if ((hv & 31) === 5) {
                ctx.fillStyle = P.woodFloorKnot;
                ctx.fillRect(x0 + px((hv >> 5) & 11) + px(2), y0 + px((hv >> 9) & 5) + px(2), px(2), px(1.5));
              }
            } else {
              // Плитка: шов по краю тайла, изредка трещина.
              ctx.fillStyle = P.tileFloorLine;
              ctx.fillRect(x0, y0, cw, line);
              ctx.fillRect(x0, y0, line, ch);
              if ((hv & 63) === 7) {
                ctx.fillStyle = P.tileFloorCrack;
                ctx.fillRect(x0 + px(3), y0 + px(5), px(7), line);
                ctx.fillRect(x0 + px(9), y0 + px(5), line, px(5));
              }
            }
            break;
          case T.ARCH:
            ctx.fillStyle = P.archRoof;
            ctx.fillRect(x0, y0, cw, ch);
            break;
          case T.DOOR:
            // Закрытая — полотно двери, открытая — проём, запертая — с красной полосой (в кэше — поверх).
            if (doors) this.doorFace(ctx, i, x0, y0, cw, ch, px(2), P);
            break;
          case T.GATE:
            ctx.fillStyle = P.gateStripe;
            for (let k = 0; k < 4; k++) ctx.fillRect(x0 + ((cw * k) >> 2), y0 + ((ch * k) >> 2), cw >> 3, ch >> 2);
            break;
        }
        // Тень от зданий (свет с северо-запада).
        if (e & 31) {
          ctx.fillStyle = P.shadow;
          if (e & 1) ctx.fillRect(x0, y0, cw, shadow);
          if (e & 8) ctx.fillRect(x0, y0 + (e & 1 ? shadow : 0), shadow, ch - (e & 1 ? shadow : 0));
          if (e & 16 && !(e & 1) && !(e & 8)) ctx.fillRect(x0, y0, shadow, shadow);
        }
      }
    }
    // 3. Поверх тайлов: маркизы и вывески лавок, окошки и вывески ларьков.
    this.overlays(ctx, tx0, ty0, tx1, ty1, ox, oy, s);
  }

  /** Стена дома вдоль улицы: контур, цоколь и окна (у лавок — витрина) по фасаду. */
  private facadeWall(ctx: CanvasRenderingContext2D, i: number, tx: number, ty: number, x0: number, y0: number, x1: number, y1: number, e: number, line: number, px: (w: number) => number): void {
    const F = RENDER.facade;
    const map = this.map;
    const cw = x1 - x0;
    const ch = y1 - y0;
    const b = this.facades[this.facadeOf[i]];
    if (e) {
      ctx.fillStyle = F.line;
      if (e & 1) ctx.fillRect(x0, y0, cw, line);
      if (e & 4) ctx.fillRect(x0, y1 - line, cw, line);
      if (e & 8) ctx.fillRect(x0, y0, line, ch);
      if (e & 2) ctx.fillRect(x1 - line, y0, line, ch);
    }
    // Фасад — сторона к улице (face): соседний тайл там — улица или площадь.
    const face = b.p.face;
    const [dx, dy] = face === 'N' ? [0, -1] : face === 'S' ? [0, 1] : face === 'W' ? [-1, 0] : [1, 0];
    const out = map.tileAt(tx + dx, ty + dy);
    if (out !== T.STREET && out !== T.PLAZA) return;
    // Цоколь по краю у улицы.
    const pl = px(2);
    ctx.fillStyle = F.plinth;
    if (dy > 0) ctx.fillRect(x0, y1 - pl, cw, pl);
    else if (dy < 0) ctx.fillRect(x0, y0, cw, pl);
    else if (dx > 0) ctx.fillRect(x1 - pl, y0, pl, ch);
    else ctx.fillRect(x0, y0, pl, ch);
    // Рядом дверь или угол дома — без окна.
    const [ax, ay] = [Math.abs(dy), Math.abs(dx)];
    const side = (k: number) => map.tileAt(tx + ax * k, ty + ay * k);
    if (side(-1) === T.DOOR || side(1) === T.DOOR || this.facadeOf[(ty + ay) * map.width + tx + ax] !== this.facadeOf[i] || this.facadeOf[(ty - ay) * map.width + tx - ax] !== this.facadeOf[i]) return;
    const shop = b.p.use !== 'house';
    const along = ax ? tx : ty;
    if (!shop && along % F.windowEvery !== 0) return;
    // Окно (витрина) у края к улице: вдоль фасада — ширина, вглубь — чуть меньше половины тайла.
    const wl = shop ? 0.08 : 0.24;
    const depth = shop ? 0.42 : 0.34;
    const gap = 0.12;
    const rx = (a: number, d: number, la: number, ld: number): [number, number, number, number] => {
      // a — вдоль фасада (доля тайла), d — от края к улице вглубь стены.
      if (dy !== 0) return [x0 + cw * a, dy > 0 ? y1 - ch * (d + ld) : y0 + ch * d, cw * la, ch * ld];
      return [dx > 0 ? x1 - cw * (d + ld) : x0 + cw * d, y0 + ch * a, cw * ld, ch * la];
    };
    const [gx, gy, gw, gh] = rx(wl, gap, 1 - wl * 2, depth);
    ctx.fillStyle = F.windowFrame;
    ctx.fillRect(Math.round(gx) - line, Math.round(gy) - line, Math.round(gw) + line * 2, Math.round(gh) + line * 2);
    ctx.fillStyle = shop ? F.vitrine : (this.noise[i] & 3) === 0 ? F.windowLit : F.window;
    ctx.fillRect(Math.round(gx), Math.round(gy), Math.round(gw), Math.round(gh));
    if (shop) {
      ctx.fillStyle = F.vitrineGlint;
      ctx.fillRect(Math.round(gx + gw * 0.15), Math.round(gy), Math.max(1, Math.round(gw * 0.12)), Math.round(gh));
    }
  }

  /** Укрытие-мебель улицы и лавок: дерево прилавка и стола, ларёк, клумба. */
  private decorTile(ctx: CanvasRenderingContext2D, i: number, x0: number, y0: number, cw: number, ch: number, hv: number, line: number, px: (w: number) => number): void {
    const F = RENDER.facade;
    const d = this.decor[i];
    if (d === DECOR_WOOD) {
      ctx.fillStyle = F.woodTop;
      ctx.fillRect(x0 + line, y0 + line, cw - line * 2, ch - line * 3);
      ctx.fillStyle = F.woodEdge;
      ctx.fillRect(x0, y0 + ch - line * 2, cw, line * 2);
      ctx.fillRect(x0 + (cw >> 1), y0 + line, line, ch - line * 3);
    } else if (d === DECOR_KIOSK) {
      ctx.fillStyle = F.kiosk.roof;
      ctx.fillRect(x0, y0, cw, px(3));
      ctx.fillRect(x0, y0 + ch - px(2), cw, px(2));
    } else {
      ctx.fillStyle = F.planter.soil;
      ctx.fillRect(x0 + px(2), y0 + px(2), cw - px(4), ch - px(4));
      ctx.fillStyle = F.planter.leafDark;
      ctx.fillRect(x0 + px(3), y0 + px(3), cw - px(6), ch - px(6));
      ctx.fillStyle = F.planter.leaf;
      ctx.fillRect(x0 + px(4 + (hv & 3)), y0 + px(4 + ((hv >> 2) & 3)), px(5), px(4));
      ctx.fillRect(x0 + px(3 + ((hv >> 4) & 3)), y0 + px(8 + ((hv >> 6) & 1)), px(4), px(4));
      const fl = F.planter.flowers;
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = fl[(hv >> (8 + k * 2)) % fl.length];
        ctx.fillRect(x0 + px(3 + ((hv >> (12 + k * 3)) & 7)), y0 + px(3 + ((hv >> (14 + k * 3)) & 7)), px(2), px(2));
      }
    }
  }

  /** Маркизы и вывески лавок, кафе и столовой; вывески и окошки ларьков. */
  private overlays(ctx: CanvasRenderingContext2D, tx0: number, ty0: number, tx1: number, ty1: number, ox: number, oy: number, s: number): void {
    const F = RENDER.facade;
    const ts = this.map.tileSize;
    const X = (wx: number) => Math.round((wx - ox) * s);
    const Y = (wy: number) => Math.round((wy - oy) * s);
    const near = (p: Poi, m: number) => p.x - m <= tx1 && p.x + p.w! + m >= tx0 && p.y - m <= ty1 && p.y + p.h! + m >= ty0;
    const text = (t: string, cx: number, cy: number, size: number, color: string) => {
      if (size < 5) return;
      ctx.font = `${F.signFont} ${Math.round(size)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = F.signShadow;
      ctx.fillText(t, cx + 1, cy + 1);
      ctx.fillStyle = color;
      ctx.fillText(t, cx, cy);
    };
    for (const b of this.facades) {
      const p = b.p;
      if (p.use === 'house' || !near(p, 2)) continue;
      const face = p.face;
      const dAw = F.awningDepth * ts;
      // Маркиза — над улицей вдоль фасада, без крайних тайлов (стены соседей).
      let rx: number, ry: number, rw: number, rh: number;
      const horiz = face === 'N' || face === 'S';
      if (horiz) {
        rx = (p.x + 1) * ts;
        rw = (p.w! - 2) * ts;
        ry = face === 'S' ? (p.y + p.h!) * ts : p.y * ts - dAw;
        rh = dAw;
      } else {
        ry = (p.y + 1) * ts;
        rh = (p.h! - 2) * ts;
        rx = face === 'E' ? (p.x + p.w!) * ts : p.x * ts - dAw;
        rw = dAw;
      }
      const stripes = Math.max(2, Math.round((horiz ? rw : rh) / (ts * 0.5)));
      for (let k = 0; k < stripes; k++) {
        ctx.fillStyle = b.awning[k & 1];
        if (horiz) ctx.fillRect(X(rx + (rw * k) / stripes), Y(ry), X(rx + (rw * (k + 1)) / stripes) - X(rx + (rw * k) / stripes), Y(ry + rh) - Y(ry));
        else ctx.fillRect(X(rx), Y(ry + (rh * k) / stripes), X(rx + rw) - X(rx), Y(ry + (rh * (k + 1)) / stripes) - Y(ry + (rh * k) / stripes));
      }
      // Тень края маркизы (со стороны улицы).
      ctx.fillStyle = F.awningShade;
      const sh = Math.max(1, Math.round(2 * s));
      if (face === 'S') ctx.fillRect(X(rx), Y(ry + rh) - sh, X(rx + rw) - X(rx), sh);
      else if (face === 'N') ctx.fillRect(X(rx), Y(ry), X(rx + rw) - X(rx), sh);
      else if (face === 'E') ctx.fillRect(X(rx + rw) - sh, Y(ry), sh, Y(ry + rh) - Y(ry));
      else ctx.fillRect(X(rx), Y(ry), sh, Y(ry + rh) - Y(ry));
      if (b.sign && horiz) {
        // Вывеска — табличка на маркизе.
        const size = Math.min(rh * 0.62, (rw / Math.max(4, b.sign.length)) * 1.5) * s;
        const tw = Math.min(rw, b.sign.length * size / s * 0.72 + ts * 0.6);
        ctx.fillStyle = b.awning[0];
        ctx.fillRect(X(rx + rw / 2 - tw / 2), Y(ry + rh * 0.12), X(rx + rw / 2 + tw / 2) - X(rx + rw / 2 - tw / 2), Y(ry + rh * 0.88) - Y(ry + rh * 0.12));
        text(b.sign, X(rx + rw / 2), Y(ry + rh / 2), size, F.sign);
      }
    }
    for (const k of this.kiosks) {
      if (!near(k, 1)) continue;
      const K = F.kiosk;
      const x = k.x * ts;
      const y = k.y * ts;
      const w = k.w! * ts;
      const h = k.h! * ts;
      // Окошко с продавцом — на стороне face.
      ctx.fillStyle = K.window;
      if (k.face === 'S') ctx.fillRect(X(x + w * 0.2), Y(y + h - ts * 0.45), X(x + w * 0.8) - X(x + w * 0.2), Y(y + h - ts * 0.15) - Y(y + h - ts * 0.45));
      else if (k.face === 'N') ctx.fillRect(X(x + w * 0.2), Y(y + ts * 0.15), X(x + w * 0.8) - X(x + w * 0.2), Y(y + ts * 0.45) - Y(y + ts * 0.15));
      else if (k.face === 'E') ctx.fillRect(X(x + w - ts * 0.45), Y(y + h * 0.2), X(x + w - ts * 0.15) - X(x + w - ts * 0.45), Y(y + h * 0.8) - Y(y + h * 0.2));
      else ctx.fillRect(X(x + ts * 0.15), Y(y + h * 0.2), X(x + ts * 0.45) - X(x + ts * 0.15), Y(y + h * 0.8) - Y(y + h * 0.2));
      const def = ARBAT.kiosks.find((d) => d.id === k.sub);
      if (def) text(def.sign, X(x + w / 2), Y(y + h / 2), Math.min(h * 0.32, (w / def.sign.length) * 1.3) * s, K.sign);
    }
  }
}
