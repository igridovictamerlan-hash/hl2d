import type { GameMap } from './GameMap';
import type { View } from '../core/Camera';
import { computeBuildings, type Building } from './buildings';
import { facadeHeight, facadeKit, type FacadeKit } from './facadeStyle';
import {
  bayCenters, chimneyBase, drawDoorState, drawLit, emptyRecord, gable, gableHeight, litAt, paintFacade, paintRoof,
  type Doorway, type FacadeDoor, type FacadeRecord,
} from './FacadeRenderer';
import { FACADES } from '../config/facades';
import { ARBAT } from '../config/arbat';

/**
 * Крыши и фасады над домами в игре (вид ¾ «в контуре»): с улицы видно скатную крышу и европейский фасад к югу, а не
 * комнаты и людей. Дом, где игрок (cut), — в разрезе: крыша плавно снимается, видна планировка. Каждый дом рисуется
 * один раз в свой холст (кэш с вытеснением давно не видных); ночью поверх — горящие окна, витрины и фонари
 * (FacadeRecord), двери фасада — по состоянию (открыта, выбита). Туман войны крыши не закрывает (fogHoles), свет окон
 * ложится на мостовую (forEachLight → Lighting). Персонажи под крышей не рисуются (roofAlpha).
 */
interface Run {
  x0: number;
  x1: number;
  /** Ряд тайлов низа фасада. */
  y: number;
  storeys: number;
  /** Высота низкого фасада (дом мельче этажа), 0 — обычный. */
  low: number;
  doors: Doorway[];
}

interface Plan {
  b: Building;
  runs: Run[];
  main: Run | null;
  kit: FacadeKit;
  sign: string | null;
  /** Свес над главным фасадом (y, пиксели мира). */
  eave: number;
  gabled: boolean;
  gableMax: number;
  chimneys: number[];
  dormers: number[];
  /** Ряды тайлов здания: тройки (y, x0, x1). */
  rows: number[];
  /** Где идёт дым из труб (пиксели мира). */
  smoke: { x: number; y: number }[];
}

interface Cached {
  canvas: HTMLCanvasElement;
  /** Левый верхний угол холста в пикселях мира и размер. */
  x: number;
  y: number;
  w: number;
  h: number;
  rec: FacadeRecord;
  used: number;
}

/** Как выглядит дверь фасада. */
export type DoorLook = 'closed' | 'open' | 'broken';

const signs = new Map<string, string>([...ARBAT.shops, ...ARBAT.cafes].map((d) => [d.id, d.sign]));

export class RoofLayer {
  readonly list: Building[];
  /** id здания на тайл (-1 — открытое место). */
  readonly of: Int32Array;
  private readonly plans: Plan[];
  /** Порядок отрисовки: с севера на юг (южный дом перекрывает поля северного). */
  private readonly order: Plan[];
  private readonly cache = new Map<number, Cached>();
  private pixels = 0;
  private frame = 0;
  /** Дом, где игрок (крыша снята), -1 — нет. */
  private cutId = -1;
  /** Доля крыши в переходе (снимается или возвращается): id → 0..1. */
  private readonly fading = new Map<number, number>();
  /** Тайлы входных дверей фасада: кто в дверях — виден поверх крыши. */
  private readonly entry = new Set<number>();
  /** Состояние двери фасада по тайлу двери (DoorSystem) — открытые и выбитые рисуются поверх кэша. */
  doorLook: ((tx: number, ty: number) => DoorLook) | null = null;
  enabled = true;
  readonly stats = { built: 0, buildMs: 0, evicted: 0, placeholders: 0 };

  constructor(private readonly map: GameMap, heights?: Uint8Array) {
    const B = computeBuildings(map, heights);
    this.list = B.list;
    this.of = B.of;
    this.plans = this.list.map((b) => this.plan(b));
    // В дверях фасада (к улице на юг) человек виден перед стеной; в двери сбоку, сзади, во двор — под краем крыши.
    for (const b of this.list) for (const d of b.doors) if (d.side === 2) this.entry.add(d.y * map.width + d.x);
    this.order = [...this.plans].sort((a, b) => a.b.y1 - b.b.y1 || a.b.x0 - b.b.x0);
  }

  get cut(): number {
    return this.cutId;
  }

  /** Здание в тайле (или -1). */
  buildingAt(tx: number, ty: number): number {
    const m = this.map;
    return tx < 0 || ty < 0 || tx >= m.width || ty >= m.height ? -1 : this.of[ty * m.width + tx];
  }

  /** Здание в точке мира (или -1). */
  buildingAtPoint(x: number, y: number): number {
    const ts = this.map.tileSize;
    return this.buildingAt(Math.floor(x / ts), Math.floor(y / ts));
  }

  /** Доля крыши дома id сейчас: 1 — крыша на месте, 0 — снята (разрез). */
  alphaOf(id: number): number {
    const f = this.fading.get(id);
    if (f !== undefined) return f;
    return id === this.cutId ? 0 : 1;
  }

  /**
   * Насколько точку мира закрывает крыша (0 — открытое место, двери и разрез; 1 — под крышей). Персонажа под крышей
   * не видно, в переходе — сквозь неё.
   */
  roofAlpha(x: number, y: number): number {
    if (!this.enabled) return 0;
    const ts = this.map.tileSize;
    const tx = Math.floor(x / ts);
    const ty = Math.floor(y / ts);
    const id = this.buildingAt(tx, ty);
    if (id < 0 || this.entry.has(ty * this.map.width + tx)) return 0;
    return this.alphaOf(id);
  }

  /** Игрок в доме id (-1 — на улице): этот дом — в разрез, прежний — снова под крышей. */
  setCut(id: number): void {
    if (id === this.cutId) return;
    const prev = this.cutId;
    if (prev >= 0) this.fading.set(prev, this.alphaOf(prev));
    if (id >= 0) this.fading.set(id, this.alphaOf(id));
    this.cutId = id;
  }

  /** Плавное снятие и возврат крыш. */
  update(dt: number): void {
    const step = dt / Math.max(0.01, FACADES.layer.fade);
    for (const [id, a] of this.fading) {
      const target = id === this.cutId ? 0 : 1;
      const next = target > a ? Math.min(target, a + step) : Math.max(target, a - step);
      if (next === target) this.fading.delete(id);
      else this.fading.set(id, next);
    }
  }

  /** Дым из труб: точки на всех крышах (Ambience). */
  chimneyPoints(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const p of this.plans) out.push(...p.smoke);
    return out;
  }

  // ——— План дома ———

  private plan(b: Building): Plan {
    const map = this.map;
    const w = map.width;
    const h = map.height;
    const ts = map.tileSize;
    const S = FACADES.size;
    const has = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && this.of[y * w + x] === b.id;
    // Низ фасада: тайл дома, под которым открытое место (не другой дом и не стена).
    const bottomAt = new Map<number, number>();
    for (const i of b.tiles) {
      const x = i % w;
      const y = (i - x) / w;
      if (has(x, y + 1)) continue;
      if (y + 1 >= h || this.of[i + w] >= 0 || map.isSolid(x, y + 1)) continue;
      const prev = bottomAt.get(x);
      if (prev === undefined || y > prev) bottomAt.set(x, y);
    }
    const runs: Run[] = [];
    for (let x = b.x0; x <= b.x1; x++) {
      const y = bottomAt.get(x);
      if (y === undefined) continue;
      const last = runs[runs.length - 1];
      if (last && last.x1 === x - 1 && last.y === y) last.x1 = x;
      else runs.push({ x0: x, x1: x, y, storeys: 1, low: 0, doors: [] });
    }
    // Кусок стены в один тайл (выступ дома) — без фасада: окно туда не влезает, видна крыша до края.
    for (let k = runs.length - 1; k >= 0; k--) if (runs[k].x1 === runs[k].x0 && !b.doors.some((d) => d.side === 2 && d.x === runs[k].x0 && d.y === runs[k].y)) runs.splice(k, 1);
    const main = runs.reduce<Run | null>((a, r) => (!a || r.x1 - r.x0 > a.x1 - a.x0 ? r : a), null);
    let kit = facadeKit(b, main ? main.x1 - main.x0 + 1 : b.x1 - b.x0 + 1);
    // Глубина над рядом — по самой мелкой колонке (у дома буквой Г крыша над фасадом короче).
    const depthOf = (r: Run): number => {
      let best = Infinity;
      for (let x = r.x0; x <= r.x1; x++) {
        let y = r.y;
        while (has(x, y - 1)) y--;
        best = Math.min(best, (r.y + 1 - y) * ts);
      }
      return best;
    };
    for (const r of runs) {
      // Двери к югу в ряду: соседние тайлы двери — один проём.
      const xs = b.doors.filter((d) => d.side === 2 && d.y === r.y && d.x >= r.x0 && d.x <= r.x1).map((d) => d.x).sort((a, c) => a - c);
      for (const x of xs) {
        const last = r.doors[r.doors.length - 1];
        if (last && last.x1 === x * ts) last.x1 = (x + 1) * ts;
        else r.doors.push({ x0: x * ts, x1: (x + 1) * ts });
      }
      // Этажей — сколько влезает в глубину дома над этим рядом (над фасадом остаётся крыша).
      const depth = depthOf(r);
      // Узкий кусок стены (1–2 тайла: выступ дома, простенок между соседями) — не выше двух этажей, иначе «башенка».
      let st = r.x1 - r.x0 + 1 <= 2 ? Math.min(2, kit.storeys) : kit.storeys;
      while (st > 1 && facadeHeight(kit, st) > depth - S.minRoof) st--;
      r.storeys = st;
      if (facadeHeight(kit, 1) > depth - (S.minRoof >> 1)) r.low = Math.max(12, depth - (S.minRoof >> 1));
    }
    const X0 = b.x0 * ts;
    const X1 = (b.x1 + 1) * ts;
    const Y0 = b.y0 * ts;
    const mainTop = main ? (main.y + 1) * ts - depthOf(main) : Y0;
    const eave = main ? (main.y + 1) * ts - (main.low || facadeHeight(kit, main.storeys)) : (b.y1 + 1) * ts;
    let gabled = kit.roof === 'ns' && (kit.top === 'step' || kit.top === 'neck' || kit.top === 'bell' || kit.top === 'spout');
    const gableMax = eave - mainTop - 3;
    if (gabled && (!main || main.low || main.x1 - main.x0 + 1 < 3 || gableHeight((main.x1 - main.x0 + 1) * ts, gableMax) < 18)) {
      // Щипцу нет места на крыше — свес и конёк вдоль улицы.
      kit = { ...kit, top: 'eave', roof: 'ew', dormers: kit.family !== 'slum' };
      gabled = false;
    }
    // Трубы — на брандмауэрах по краям (у широкого дома и посередине), слуховые окна — по осям фасада.
    const chimneys: number[] = [];
    if (gabled) chimneys.push(Math.round((X0 + X1) / 2));
    else if (X1 - X0 >= 40) {
      chimneys.push(X0 + 6, X1 - 7);
      if (X1 - X0 > 200) chimneys.push(Math.round((X0 + X1) / 2) + 8);
    }
    const dormers: number[] = [];
    if (kit.dormers && main && !gabled && !main.low) {
      const xs = bayCenters(kit, main.x0 * ts, (main.x1 + 1) * ts);
      xs.forEach((x, i) => {
        if (kit.roof === 'mansard' || xs.length <= 2 || i % 2 === 1) dormers.push(x);
      });
    }
    const rows: number[] = [];
    for (let y = b.y0; y <= b.y1; y++) {
      let x = b.x0;
      while (x <= b.x1) {
        if (!has(x, y)) {
          x++;
          continue;
        }
        const s = x;
        while (x + 1 <= b.x1 && has(x + 1, y)) x++;
        rows.push(y, s, x);
        x++;
      }
    }
    const sign = b.facade && (b.kind === 'shop' || b.kind === 'cafe') ? signs.get(b.facade.sub ?? '') ?? null : b.kind === 'canteen' && b.facade ? ARBAT.canteen.sign : null;
    const base = chimneyBase(kit, Y0, eave);
    const smoke = chimneys.map((x) => ({ x, y: base - FACADES.chimney.h - 5 }));
    return { b, runs, main, kit, sign, eave, gabled, gableMax, chimneys, dormers, rows, smoke };
  }

  // ——— Рисование дома ———

  /** Дом целиком в ctx (пиксели мира): крыша по контуру, края, фасады рядов, щипец, козырьки входов сбоку и сзади. */
  paint(ctx: CanvasRenderingContext2D, id: number, rec: FacadeRecord | null): void {
    const p = this.plans[id];
    const { b, kit: k } = p;
    const ts = this.map.tileSize;
    const X0 = b.x0 * ts;
    const X1 = (b.x1 + 1) * ts;
    const Y0 = b.y0 * ts;
    const Y1 = (b.y1 + 1) * ts;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < p.rows.length; i += 3) ctx.rect(p.rows[i + 1] * ts, p.rows[i] * ts, (p.rows[i + 2] - p.rows[i + 1] + 1) * ts, ts);
    ctx.clip();
    paintRoof(ctx, k, X0, Y0, X1, Y1, p.eave, { dormers: p.dormers, chimneys: p.chimneys }, rec);
    ctx.restore();
    this.edges(ctx, b);
    for (const r of p.runs) {
      const rx0 = r.x0 * ts;
      const rx1 = (r.x1 + 1) * ts;
      const isMain = r === p.main;
      const bottom = (r.y + 1) * ts;
      paintFacade(ctx, k, { X0: rx0, X1: rx1, bottom, storeys: r.storeys, doors: r.doors, sign: p.sign && r.doors.length ? p.sign : null, gable: isMain && p.gabled, low: r.low || undefined }, rec);
      if (isMain && p.gabled) gable(ctx, k, rx0, rx1, bottom - facadeHeight(k, r.storeys), rec, p.gableMax);
    }
    this.entrances(ctx, b);
  }

  /** Края скатной крыши: шов с соседней крышей, карниз над открытым местом (не там, где фасад). */
  private edges(ctx: CanvasRenderingContext2D, b: Building): void {
    const { map } = this;
    const w = map.width;
    const ts = map.tileSize;
    for (const i of b.tiles) {
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 4; k++) {
        if (k === 2) continue;
        const nx = x + (k === 1 ? 1 : k === 3 ? -1 : 0);
        const ny = y + (k === 0 ? -1 : 0);
        if (this.buildingAt(nx, ny) === b.id) continue;
        const other = this.buildingAt(nx, ny) >= 0;
        ctx.fillStyle = other ? FACADES.seam : FACADES.eaveLine;
        const X = x * ts;
        const Y = y * ts;
        const d = other ? 1 : 2;
        if (k === 0) ctx.fillRect(X, Y, ts, d);
        else if (k === 1) ctx.fillRect(X + ts - d, Y, d, ts);
        else ctx.fillRect(X, Y, d, ts);
      }
    }
  }

  /** Козырёк с фонарём над входом с невидимой стороны (север, восток, запад) — на мостовой у двери. */
  private entrances(ctx: CanvasRenderingContext2D, b: Building): void {
    const C = FACADES.canopy;
    const ts = this.map.tileSize;
    const d = C.depth;
    for (const e of b.doors) {
      if (e.side === 2) continue;
      const X = e.x * ts;
      const Y = e.y * ts;
      const [cx, cy, cw, ch] = e.side === 0 ? [X, Y - d, ts, d] : e.side === 1 ? [X + ts, Y, d, ts] : [X - d, Y, d, ts];
      ctx.fillStyle = C.color;
      ctx.fillRect(cx, cy, cw, ch);
      ctx.fillStyle = C.edge;
      if (e.side === 0) ctx.fillRect(cx, cy, cw, 1);
      else ctx.fillRect(e.side === 1 ? cx + cw - 1 : cx, cy, 1, ch);
    }
  }

  /** Контур дома в разрезе: пунктир по внешнему краю (экранные координаты через v). */
  outline(ctx: CanvasRenderingContext2D, v: View, id: number): void {
    const p = this.plans[id];
    if (!p) return;
    const ts = this.map.tileSize;
    const s = v.scale;
    const C = FACADES.cut;
    const X = (x: number) => Math.round((x * ts - v.left) * s) + 0.5;
    const Y = (y: number) => Math.round((y * ts - v.top) * s) + 0.5;
    ctx.save();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = C.width * Math.max(1, s / 2);
    ctx.setLineDash(C.dash.map((d) => d * s));
    ctx.globalAlpha = 1 - this.alphaOf(id);
    ctx.beginPath();
    const w = this.map.width;
    for (const i of p.b.tiles) {
      const x = i % w;
      const y = (i - x) / w;
      if (this.buildingAt(x, y - 1) !== id) {
        ctx.moveTo(X(x), Y(y));
        ctx.lineTo(X(x + 1), Y(y));
      }
      if (this.buildingAt(x, y + 1) !== id) {
        ctx.moveTo(X(x), Y(y + 1) - 1);
        ctx.lineTo(X(x + 1), Y(y + 1) - 1);
      }
      if (this.buildingAt(x - 1, y) !== id) {
        ctx.moveTo(X(x), Y(y));
        ctx.lineTo(X(x), Y(y + 1));
      }
      if (this.buildingAt(x + 1, y) !== id) {
        ctx.moveTo(X(x + 1) - 1, Y(y));
        ctx.lineTo(X(x + 1) - 1, Y(y + 1));
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // ——— Кэш ———

  private build(id: number): Cached {
    const t0 = performance.now();
    const p = this.plans[id];
    const b = p.b;
    const ts = this.map.tileSize;
    const pad = FACADES.layer.pad;
    const x = b.x0 * ts - pad;
    const y = b.y0 * ts - pad;
    const w = (b.x1 - b.x0 + 1) * ts + pad * 2;
    const h = (b.y1 - b.y0 + 1) * ts + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(-x, -y);
    const rec = emptyRecord();
    this.paint(ctx, id, rec);
    const c: Cached = { canvas, x, y, w, h, rec, used: this.frame };
    this.cache.set(id, c);
    this.pixels += w * h;
    this.stats.built++;
    this.stats.buildMs += performance.now() - t0;
    return c;
  }

  /** Вытеснить давно не видные дома, пока кэш больше maxPixels. */
  private evict(): void {
    if (this.pixels <= FACADES.layer.maxPixels) return;
    const old = [...this.cache.entries()].filter(([, c]) => c.used < this.frame - 2).sort((a, b) => a[1].used - b[1].used);
    for (const [id, c] of old) {
      if (this.pixels <= FACADES.layer.maxPixels * 0.8) break;
      this.cache.delete(id);
      this.pixels -= c.w * c.h;
      this.stats.evicted++;
    }
  }

  /** Построить заранее дома вокруг точки (старт игры, телепорт). */
  prebuild(x: number, y: number, radius: number = FACADES.layer.prebuild): void {
    const ts = this.map.tileSize;
    for (const p of this.order) {
      const b = p.b;
      const cx = Math.max(b.x0 * ts, Math.min(x, (b.x1 + 1) * ts));
      const cy = Math.max(b.y0 * ts, Math.min(y, (b.y1 + 1) * ts));
      if (Math.hypot(cx - x, cy - y) <= radius && !this.cache.has(b.id)) this.build(b.id);
    }
  }

  /** Сбросить кэш (сменилась карта или вид). */
  clear(): void {
    this.cache.clear();
    this.pixels = 0;
  }

  // ——— Кадр ———

  /** Прямоугольник холста дома на экране (округлённо: соседи стыкуются без щелей). */
  private screenRect(c: { x: number; y: number; w: number; h: number }, v: View): [number, number, number, number] {
    const s = v.scale;
    const X0 = Math.round((c.x - v.left) * s);
    const Y0 = Math.round((c.y - v.top) * s);
    return [X0, Y0, Math.round((c.x + c.w - v.left) * s) - X0, Math.round((c.y + c.h - v.top) * s) - Y0];
  }

  private inView(b: Building, v: View, m: number): boolean {
    const ts = this.map.tileSize;
    const R = v.left + v.width / v.scale;
    const B = v.top + v.height / v.scale;
    return (b.x1 + 1) * ts >= v.left - m && b.x0 * ts <= R + m && (b.y1 + 1) * ts >= v.top - m && b.y0 * ts <= B + m;
  }

  /**
   * Крыши и фасады в кадре (кроме дома в разрезе), двери фасадов по состоянию. Холсты строятся не дольше budget мс за
   * кадр; дом без холста — заглушка цветом крыши (комнат сквозь неё не видно).
   */
  draw(ctx: CanvasRenderingContext2D, v: View): void {
    if (!this.enabled) return;
    this.frame++;
    const t0 = performance.now();
    const L = FACADES.layer;
    ctx.imageSmoothingEnabled = false;
    for (const p of this.order) {
      const b = p.b;
      if (!this.inView(b, v, L.margin)) continue;
      const visible = this.inView(b, v, FACADES.layer.pad);
      let c = this.cache.get(b.id);
      if (!c && performance.now() - t0 < L.budget) c = this.build(b.id);
      if (!visible) continue;
      const a = this.alphaOf(b.id);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      if (!c) {
        this.placeholder(ctx, v, p);
        continue;
      }
      c.used = this.frame;
      const [X, Y, W, H] = this.screenRect(c, v);
      ctx.drawImage(c.canvas, X, Y, W, H);
      if (this.doorLook && c.rec.doors.length) this.doors(ctx, c, X, Y, W, H);
    }
    ctx.globalAlpha = 1;
    this.evict();
  }

  /** Двери фасада: открытые и выбитые — поверх кэша, в масштабе холста дома. */
  private doors(ctx: CanvasRenderingContext2D, c: Cached, X: number, Y: number, W: number, H: number): void {
    const ts = this.map.tileSize;
    let set = false;
    for (const d of c.rec.doors) {
      const look = this.doorLook!(Math.floor((d.x0 + 1) / ts), Math.floor((d.bottom - 1) / ts));
      if (look === 'closed') continue;
      if (!set) {
        ctx.save();
        const sx = W / c.w;
        const sy = H / c.h;
        ctx.setTransform(sx, 0, 0, sy, X - c.x * sx, Y - c.y * sy);
        set = true;
      }
      drawDoorState(ctx, d as FacadeDoor, look);
    }
    if (set) ctx.restore();
  }

  /** Дом ещё без холста: крыша одним цветом по рядам тайлов. */
  private placeholder(ctx: CanvasRenderingContext2D, v: View, p: Plan): void {
    const ts = this.map.tileSize;
    const s = v.scale;
    const c = p.kit.roofColor;
    ctx.fillStyle = `hsl(${c.h} ${c.s}% ${c.l - 4}%)`;
    for (let i = 0; i < p.rows.length; i += 3) {
      const X0 = Math.round((p.rows[i + 1] * ts - v.left) * s);
      const Y0 = Math.round((p.rows[i] * ts - v.top) * s);
      ctx.fillRect(X0, Y0, Math.round(((p.rows[i + 2] + 1) * ts - v.left) * s) - X0, Math.round(((p.rows[i] + 1) * ts - v.top) * s) - Y0);
    }
    this.stats.placeholders++;
  }

  /** Ночью после затемнения: горящие окна, витрины, слуховые окна, фонари у дверей (своим часом отбоя). */
  /** halos — ореолы здесь же (лист ассетов); в игре они в буфере свечения (forEachGlow → Lighting). */
  drawLit(ctx: CanvasRenderingContext2D, v: View, night: number, lamps: number, halos = false): void {
    if (!this.enabled || lamps <= 0.02) return;
    for (const p of this.order) {
      const b = p.b;
      const c = this.cache.get(b.id);
      if (!c || !this.inView(b, v, FACADES.layer.pad)) continue;
      const a = this.alphaOf(b.id);
      if (a <= 0.01) continue;
      const [X, Y, W, H] = this.screenRect(c, v);
      ctx.save();
      const sx = W / c.w;
      const sy = H / c.h;
      ctx.setTransform(sx, 0, 0, sy, X - c.x * sx, Y - c.y * sy);
      drawLit(ctx, c.rec, night, lamps * a, halos);
      ctx.restore();
    }
  }

  /**
   * Ореолы горящих окон и фонарей у дверей — в буфер свечения (Lighting.facadeGlows): fn(x, y, радиус, сила) в
   * пикселях мира. С дома в разрезе — слабее (крыша снята, видно стекло изнутри).
   */
  forEachGlow(v: View, night: number, fn: (x: number, y: number, r: number, power: number) => void): void {
    if (!this.enabled) return;
    const N = FACADES.night;
    for (const p of this.order) {
      const c = this.cache.get(p.b.id);
      if (!c || !this.inView(p.b, v, N.lampR)) continue;
      const a = this.alphaOf(p.b.id);
      if (a <= 0.01) continue;
      for (const w of c.rec.windows) {
        if (!litAt(night, w.seed, w.key, w.share)) continue;
        fn(w.x + w.w / 2, w.y + w.h / 2, Math.max(w.w, w.h) * N.haloR * 0.75, N.haloPower * a);
      }
      for (const l of c.rec.lamps) fn(l.x, l.y, N.lampR * 1.3, N.lampGlow * a);
    }
  }

  /**
   * Свет горящих окон и фонарей на мостовую перед фасадом (для карты света): fn(x, y, сила) в пикселях мира.
   * Окна выше первого этажа светят слабее.
   */
  forEachLight(v: View, night: number, fn: (x: number, y: number, power: number) => void): void {
    if (!this.enabled) return;
    const N = FACADES.night;
    for (const p of this.order) {
      const c = this.cache.get(p.b.id);
      if (!c || !this.inView(p.b, v, N.spillR)) continue;
      for (const w of c.rec.windows) {
        if (w.storey > 3 || !litAt(night, w.seed, w.key, w.share)) continue;
        fn(w.x + w.w / 2, w.street + N.spill, w.storey === 0 ? 1 : N.upper);
      }
      for (const l of c.rec.lamps) fn(l.x, l.street + N.spill, N.lampPower);
    }
  }

  /**
   * Крыши в кадре — прямоугольниками рядов тайлов в текущий путь ctx (экранные координаты): туман войны их не
   * закрывает (крыши видно и за домами — камера сверху), закрывает улицы, которых игрок не видит.
   */
  fogHoles(ctx: CanvasRenderingContext2D, v: View): void {
    if (!this.enabled) return;
    const ts = this.map.tileSize;
    const s = v.scale;
    for (const p of this.order) {
      if (this.alphaOf(p.b.id) < 0.5 || !this.inView(p.b, v, 0)) continue;
      for (let i = 0; i < p.rows.length; i += 3) {
        const X0 = Math.round((p.rows[i + 1] * ts - v.left) * s);
        const Y0 = Math.round((p.rows[i] * ts - v.top) * s);
        ctx.rect(X0, Y0, Math.round(((p.rows[i + 2] + 1) * ts - v.left) * s) - X0, Math.round(((p.rows[i] + 1) * ts - v.top) * s) - Y0);
      }
    }
  }
}
