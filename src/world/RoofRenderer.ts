import type { GameMap } from './GameMap';
import type { Building, Buildings } from './buildings';
import { windowOn, type WindowLook, type WindowSpot, type WindowStyle } from './windows';
import { ROOFS } from '../config/roofs';
import { RENDER } from '../config/render';
import { hash2 } from '../core/rng';

/**
 * Крыши и фасады над домами: с улицы видно кровлю и стену, а не комнаты. Вид top — крыша сверху во весь дом;
 * facade — ¾ «в контуре»: стена к югу (к камере) с окнами и дверью поверх нижнего ряда дома; tall — ¾ с высотой:
 * крыша поднята на этажи, стена к югу видна целиком. Дом, где игрок (cut), — без крыши, контур пунктиром.
 * Рисует в пикселях мира (ctx уже в масштабе камеры); текстуры — функциями от прямоугольника (ими же лист ассетов).
 */
export type RoofView = 'top' | 'facade' | 'tall';
export type RoofStyle = 'tin' | 'tile' | 'slate' | 'flat' | 'concrete';
export type WallStyle = 'slum' | 'old' | 'upper' | 'civic';

export interface RoofOptions {
  view: RoofView;
  /** Здание, где игрок: без крыши, контур пунктиром (-1 — нет). */
  cut?: number;
  /** Доля суток — ночью горят окна (windowOn); null — день. */
  night?: number | null;
}

type Hsl = { readonly h: number; readonly s: number; readonly l: number };
type Ctx = CanvasRenderingContext2D;

const TS = 16;
const col = (c: Hsl, dl = 0): string => `hsl(${c.h} ${c.s}% ${Math.max(0, Math.min(100, c.l + dl))}%)`;
const r01 = (a: number, b: number, s: number): number => hash2(a, b, s) / 4294967296;
const pick = <V>(list: readonly V[], a: number, b: number, s: number): V => list[hash2(a, b, s) % list.length];

/** Скаты, ряды черепицы или рёбра жести, конёк — в прямоугольнике (крышу дома обрезает его контур). */
export function paintRoof(ctx: Ctx, X0: number, Y0: number, X1: number, Y1: number, style: RoofStyle, color: Hsl, alongX: boolean, seed: number): void {
  const S = ROOFS.slope;
  if (style === 'flat' || style === 'concrete') {
    ctx.fillStyle = col(color);
    ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    if (style === 'flat') {
      // Гравий: точки светлее и темнее.
      const U = ROOFS.upper;
      for (let y = Y0 + 1; y < Y1; y += 3) {
        for (let x = X0 + 1 + ((y >> 1) & 1); x < X1; x += 3) {
          const v = hash2(x, y, seed) & 15;
          if (v < 3) {
            ctx.fillStyle = v === 0 ? U.gravelLight : U.gravel;
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    } else {
      // Бетонные плиты: швы по тайлам.
      ctx.fillStyle = ROOFS.civic.slab;
      for (let x = X0 + TS; x < X1; x += TS) ctx.fillRect(x, Y0, 1, Y1 - Y0);
      for (let y = Y0 + TS; y < Y1; y += TS) ctx.fillRect(X0, y, X1 - X0, 1);
    }
    return;
  }
  // Двускатная: конёк вдоль длинной стороны, скат к северу (западу) светлее.
  const mid = alongX ? Math.round((Y0 + Y1) / 2) : Math.round((X0 + X1) / 2);
  ctx.fillStyle = col(color, S.light);
  if (alongX) ctx.fillRect(X0, Y0, X1 - X0, mid - Y0);
  else ctx.fillRect(X0, Y0, mid - X0, Y1 - Y0);
  ctx.fillStyle = col(color, S.dark);
  if (alongX) ctx.fillRect(X0, mid, X1 - X0, Y1 - mid);
  else ctx.fillRect(mid, Y0, X1 - mid, Y1 - Y0);
  if (style === 'tin') {
    // Жесть волной: рёбра вдоль ската, стыки листов поперёк, заплаты и ржавчина.
    const L = ROOFS.slum;
    if (alongX) {
      for (let x = X0; x < X1; x += 2) {
        ctx.fillStyle = L.rib;
        ctx.fillRect(x, Y0, 1, Y1 - Y0);
        ctx.fillStyle = L.ribLight;
        ctx.fillRect(x + 1, Y0, 1, Y1 - Y0);
      }
      ctx.fillStyle = L.seam;
      for (let x = X0, k = 0; x < X1; x += 12, k++) {
        const off = (hash2(k, seed, 5) % 7) - 3;
        for (const y of [mid - 9 + off, mid + 9 + off]) if (y > Y0 + 1 && y < Y1 - 1) ctx.fillRect(x, y, Math.min(12, X1 - x), 1);
      }
    } else {
      for (let y = Y0; y < Y1; y += 2) {
        ctx.fillStyle = L.rib;
        ctx.fillRect(X0, y, X1 - X0, 1);
        ctx.fillStyle = L.ribLight;
        ctx.fillRect(X0, y + 1, X1 - X0, 1);
      }
      ctx.fillStyle = L.seam;
      for (let y = Y0, k = 0; y < Y1; y += 12, k++) {
        const off = (hash2(k, seed, 6) % 7) - 3;
        for (const x of [mid - 9 + off, mid + 9 + off]) if (x > X0 + 1 && x < X1 - 1) ctx.fillRect(x, y, 1, Math.min(12, Y1 - y));
      }
    }
    for (let ty = Y0; ty < Y1; ty += TS) {
      for (let tx = X0; tx < X1; tx += TS) {
        if (r01(tx, ty, seed + 11) < L.patchChance) {
          const pw = 5 + (hash2(tx, ty, seed + 12) % 6);
          const ph = 4 + (hash2(tx, ty, seed + 13) % 5);
          const px = tx + (hash2(tx, ty, seed + 14) % (TS - pw + 1));
          const py = ty + (hash2(tx, ty, seed + 15) % (TS - ph + 1));
          ctx.fillStyle = pick(L.patch, tx, ty, seed + 16);
          ctx.fillRect(px, py, pw, ph);
          ctx.fillStyle = L.seam;
          ctx.fillRect(px, py, pw, 1);
          ctx.fillRect(px, py, 1, ph);
        }
        if (r01(tx, ty, seed + 21) < L.rustChance) {
          ctx.fillStyle = pick(L.rust, tx, ty, seed + 22);
          const rx = tx + (hash2(tx, ty, seed + 23) % 11);
          const ry = ty + (hash2(tx, ty, seed + 24) % 11);
          ctx.globalAlpha = 0.7;
          ctx.fillRect(rx, ry, 4, 3);
          ctx.fillRect(rx + 1, ry + 3, 3, 2);
          ctx.globalAlpha = 1;
        }
      }
    }
    return;
  }
  // Черепица (сланец): ряды параллельно коньку, стыки плиток вразбежку.
  const O = ROOFS.old;
  const step = style === 'slate' ? 3 : 4;
  if (alongX) {
    for (let d = step; mid - d > Y0 || mid + d < Y1; d += step) {
      for (const y of [mid - d, mid + d]) {
        if (y <= Y0 || y >= Y1) continue;
        ctx.fillStyle = O.row;
        ctx.fillRect(X0, y, X1 - X0, 1);
        ctx.fillStyle = O.rowLight;
        ctx.fillRect(X0, y + (y < mid ? 1 : -1), X1 - X0, 1);
        ctx.fillStyle = O.row;
        const off = ((d / step) & 1) * (step >> 1);
        for (let x = X0 + off; x < X1; x += step) ctx.fillRect(x, y < mid ? y + 1 : y - step + 1, 1, step - 1);
      }
    }
    ctx.fillStyle = O.ridge;
    ctx.fillRect(X0, mid - 1, X1 - X0, 2);
    ctx.fillStyle = O.row;
    ctx.fillRect(X0, mid + 1, X1 - X0, 1);
  } else {
    for (let d = step; mid - d > X0 || mid + d < X1; d += step) {
      for (const x of [mid - d, mid + d]) {
        if (x <= X0 || x >= X1) continue;
        ctx.fillStyle = O.row;
        ctx.fillRect(x, Y0, 1, Y1 - Y0);
        ctx.fillStyle = O.rowLight;
        ctx.fillRect(x + (x < mid ? 1 : -1), Y0, 1, Y1 - Y0);
        ctx.fillStyle = O.row;
        const off = ((d / step) & 1) * (step >> 1);
        for (let y = Y0 + off; y < Y1; y += step) ctx.fillRect(x < mid ? x + 1 : x - step + 1, y, step - 1, 1);
      }
    }
    ctx.fillStyle = O.ridge;
    ctx.fillRect(mid - 1, Y0, 2, Y1 - Y0);
    ctx.fillStyle = O.row;
    ctx.fillRect(mid + 1, Y0, 1, Y1 - Y0);
  }
}

/** Стена фасада ¾ в прямоугольнике: доски Слободы, штукатурка, кладка Верхнего города, бетонные плиты. */
export function paintWall(ctx: Ctx, X0: number, top: number, X1: number, bottom: number, style: WallStyle, color: Hsl, seed: number): void {
  const F = ROOFS.facade;
  ctx.fillStyle = col(color);
  ctx.fillRect(X0, top, X1 - X0, bottom - top);
  if (style === 'slum') {
    ctx.fillStyle = F.board;
    for (let x = X0 + 3; x < X1; x += 4) ctx.fillRect(x, top, 1, bottom - top);
    for (let x = X0; x < X1; x += 4) {
      const y = top + 4 + (hash2(x, top, seed) % Math.max(1, bottom - top - 6));
      ctx.fillRect(x, y, 3, 1);
    }
  } else if (style === 'upper') {
    ctx.fillStyle = F.block;
    for (let y = top + 4, k = 0; y < bottom - 2; y += 4, k++) {
      ctx.fillRect(X0, y, X1 - X0, 1);
      for (let x = X0 + (k & 1) * 4; x < X1; x += 8) ctx.fillRect(x, y - 3, 1, 3);
    }
  } else if (style === 'civic') {
    ctx.fillStyle = F.block;
    for (let x = X0 + 8; x < X1; x += 8) ctx.fillRect(x, top, 1, bottom - top);
    ctx.fillRect(X0, top + ((bottom - top) >> 1), X1 - X0, 1);
  } else {
    // Штукатурка: пятна потемнее.
    ctx.fillStyle = F.block;
    for (let x = X0; x < X1; x += 5) {
      const y = top + 2 + (hash2(x, top, seed + 3) % Math.max(1, bottom - top - 4));
      if ((hash2(x, top, seed + 4) & 3) === 0) ctx.fillRect(x, y, 2, 1);
    }
  }
  // Тень под карнизом, карниз, цоколь.
  ctx.fillStyle = F.eaveShadow;
  ctx.fillRect(X0, top, X1 - X0, 2);
  if (style !== 'slum') {
    ctx.fillStyle = F.cornice;
    ctx.fillRect(X0, top + 2, X1 - X0, 1);
  }
  ctx.fillStyle = F.plinth;
  ctx.fillRect(X0, bottom - 2, X1 - X0, 2);
}

/**
 * Окно фасада ¾ (u0..u1 × v0..v1 — стекло в пикселях мира): рама, стекло (ночью — свет), шторы, ящик с цветами,
 * ставни, доски, битое стекло — по виду окна этапа «окна по району».
 */
export function paintWindow(ctx: Ctx, u0: number, v0: number, u1: number, v1: number, style: WindowStyle, look: WindowLook, tint: number, lit: boolean): void {
  const W = RENDER.windows;
  const S = W.style[style];
  const N = ROOFS.night;
  const gw = u1 - u0;
  const gh = v1 - v0;
  if (look === 'shutters' || look === 'closed') {
    ctx.fillStyle = W.shutters[(tint >>> 4) % W.shutters.length];
    if (look === 'closed') {
      ctx.fillRect(u0 - 1, v0 - 1, gw + 2, gh + 2);
      ctx.fillStyle = W.shutterEdge;
      ctx.fillRect(u0 + (gw >> 1), v0, 1, gh);
      return;
    }
    ctx.fillRect(u0 - 3, v0 - 1, 2, gh + 2);
    ctx.fillRect(u1 + 1, v0 - 1, 2, gh + 2);
  }
  ctx.fillStyle = S.frame;
  ctx.fillRect(u0 - 1, v0 - 1, gw + 2, gh + 2);
  ctx.fillStyle = look === 'broken' || look === 'boarded' ? W.broken : lit ? N.glass : S.pane;
  ctx.fillRect(u0, v0, gw, gh);
  if (look === 'boarded') {
    ctx.fillStyle = W.plank;
    ctx.fillRect(u0 - 1, v0 + 1, gw + 2, 2);
    ctx.fillRect(u0 - 1, v1 - 3, gw + 2, 2);
    ctx.fillStyle = W.nail;
    ctx.fillRect(u0, v0 + 1, 1, 1);
    ctx.fillRect(u1 - 1, v1 - 3, 1, 1);
    return;
  }
  if (look === 'broken') {
    ctx.fillStyle = W.shard;
    ctx.fillRect(u0 + 1, v0 + 1, 1, gh - 2);
    ctx.fillRect(u0 + 1, v0 + 1, gw >> 1, 1);
    return;
  }
  // Переплёт и блик.
  ctx.fillStyle = S.frame;
  if (gw >= 6) ctx.fillRect(u0 + (gw >> 1), v0, 1, gh);
  if (gh >= 7) ctx.fillRect(u0, v0 + (gh >> 1), gw, 1);
  if (!lit) {
    ctx.fillStyle = W.glint;
    ctx.fillRect(u0 + 1, v0 + 1, 1, 2);
  }
  if (look === 'curtains') {
    ctx.fillStyle = W.curtains[tint % W.curtains.length];
    ctx.fillRect(u0, v0, 2, gh);
    ctx.fillRect(u1 - 2, v0, 2, gh);
  }
  if (look === 'flowers' && S.sill) {
    ctx.fillStyle = W.box;
    ctx.fillRect(u0 - 1, v1 + 1, gw + 2, 2);
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = W.flowers[(tint + k) % W.flowers.length];
      ctx.fillRect(u0 + 1 + k * Math.max(2, (gw - 2) >> 1), v1, 2, 1);
    }
  } else if (S.sill) {
    ctx.fillStyle = S.sill;
    ctx.fillRect(u0 - 1, v1 + 1, gw + 2, 1);
  }
}

/** Створка двери фасада ¾: leaf — 0 одна, 1 левая, 2 правая половина двойной; glass — лавка (стекло в двери). */
export function paintDoor(ctx: Ctx, X0: number, top: number, X1: number, bottom: number, color: string, leaf: 0 | 1 | 2, glass: boolean, lit: boolean): void {
  const F = ROOFS.facade;
  const l = leaf === 2 ? X0 : X0 + 2;
  const r = leaf === 1 ? X1 : X1 - 2;
  ctx.fillStyle = F.doorFrame;
  ctx.fillRect(l - 1, top - 1, r - l + 2, bottom - top + 1);
  ctx.fillStyle = color;
  ctx.fillRect(l, top, r - l, bottom - top);
  ctx.fillStyle = F.doorPanel;
  ctx.fillRect(l + 2, top + 2, r - l - 4, 1);
  ctx.fillRect(l + 2, bottom - 4, r - l - 4, 1);
  if (glass) {
    ctx.fillStyle = lit ? F.shopGlassLit : F.shopGlass;
    ctx.fillRect(l + 2, top + 3, r - l - 4, Math.max(2, ((bottom - top) >> 1) - 2));
  }
  ctx.fillStyle = F.knob;
  ctx.fillRect(leaf === 2 ? l + 1 : r - 2, top + ((bottom - top) >> 1), 1, 1);
  if (leaf === 1) {
    ctx.fillStyle = F.doorFrame;
    ctx.fillRect(r - 1, top, 1, bottom - top);
  }
}

interface Look {
  roof: RoofStyle;
  color: Hsl;
  wall: WallStyle;
  wallColor: Hsl;
  alongX: boolean;
}

export class RoofRenderer {
  private readonly looks: Look[];
  private readonly winAt = new Map<number, WindowSpot>();
  private readonly doorSide = new Map<number, 0 | 1 | 2 | 3>();

  constructor(private readonly map: GameMap, readonly buildings: Buildings, windows: readonly WindowSpot[]) {
    const w = map.width;
    for (const o of windows) this.winAt.set(o.y * w + o.x, o);
    for (const b of buildings.list) for (const d of b.doors) this.doorSide.set(d.y * w + d.x, d.side);
    const plaster = RENDER.facade.plaster;
    this.looks = buildings.list.map((b) => {
      const seed = hash2(b.id, b.x0, b.y0);
      const roof: RoofStyle = b.kind === 'civic' || b.kind === 'canteen' || b.kind === 'dorm'
        ? 'concrete'
        : b.kind === 'villa' ? 'tile'
          : b.district === 'upper' ? 'flat'
            : b.district === 'slum' ? 'tin'
              : r01(seed, 1, 7) < ROOFS.old.slateChance ? 'slate' : 'tile';
      const color = roof === 'concrete' ? ROOFS.civic.flat
        : roof === 'flat' ? pick(ROOFS.upper.flat, seed, 2, 0)
          : roof === 'tin' ? pick(ROOFS.slum.tin, seed, 3, 0)
            : roof === 'slate' ? ROOFS.old.slate : pick(ROOFS.old.tile, seed, 4, 0);
      const wall: WallStyle = roof === 'concrete' ? 'civic' : b.district === 'slum' ? 'slum' : b.district === 'upper' ? 'upper' : 'old';
      // Старый город — штукатурка (дом вдоль улицы — своего цвета, как на плане, MapRenderer); Слобода — доски,
      // Верхний город — камень, казённые — бетон.
      const fk = b.facade ? map.poisOf('facade').indexOf(b.facade) : -1;
      const wallColor = wall === 'old'
        ? (b.facade ? plaster[hash2(b.facade.id ?? fk, b.facade.x, (map.seed | 0) + 17) % plaster.length] : pick(plaster, seed, 5, 0))
        : pick(ROOFS.facade.wall[wall], seed, 6, 0);
      return { roof, color, wall, wallColor, alongX: b.x1 - b.x0 >= b.y1 - b.y0 };
    });
  }

  /** Подъём крыши в виде tall: стена во всю высоту этажей. */
  lift(b: Building): number {
    return Math.round(6 + b.storeys * ROOFS.tall.storey);
  }

  /** Высота фасада в виде facade (по этажам). */
  facadeHeight(b: Building): number {
    const H = ROOFS.facade.height;
    return H[Math.min(b.storeys, H.length - 1)];
  }

  /** Стиль кровли здания (для листа ассетов и легенды). */
  styleOf(b: Building): Look {
    return this.looks[b.id];
  }

  private has(b: Building, x: number, y: number): boolean {
    const m = this.map;
    return x >= 0 && y >= 0 && x < m.width && y < m.height && this.buildings.of[y * m.width + x] === b.id;
  }

  /** Здание целиком: крыша (в виде tall — поднятая), фасад к югу, козырьки входов; дом игрока — контур. */
  drawBuilding(ctx: Ctx, b: Building, o: RoofOptions): void {
    if (o.cut === b.id) {
      this.outline(ctx, b);
      return;
    }
    const lift = o.view === 'tall' ? this.lift(b) : 0;
    ctx.save();
    if (lift) ctx.translate(0, -lift);
    this.roof(ctx, b);
    ctx.restore();
    if (o.view !== 'top') this.facade(ctx, b, o, lift, false);
    this.entrances(ctx, b, o.view, lift);
  }

  /** Кровля по контуру дома: текстура, карниз (у плоской — парапет), шов с соседом, трубы и всё на крыше. */
  private roof(ctx: Ctx, b: Building): void {
    const L = this.looks[b.id];
    const w = this.map.width;
    const seed = hash2(b.id, b.x0, b.y1);
    ctx.save();
    ctx.beginPath();
    for (const i of b.tiles) {
      const x = i % w;
      ctx.rect(x * TS, ((i - x) / w) * TS, TS, TS);
    }
    ctx.clip();
    paintRoof(ctx, b.x0 * TS, b.y0 * TS, (b.x1 + 1) * TS, (b.y1 + 1) * TS, L.roof, L.color, L.alongX, seed);
    ctx.restore();
    const flat = L.roof === 'flat' || L.roof === 'concrete';
    const U = ROOFS.upper;
    const C = ROOFS.civic;
    for (const i of b.tiles) {
      const x = i % w;
      const y = (i - x) / w;
      const X = x * TS;
      const Y = y * TS;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 1 ? 1 : k === 3 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 0 ? -1 : 0);
        if (this.has(b, nx, ny)) continue;
        const other = nx >= 0 && ny >= 0 && nx < w && ny < this.map.height && this.buildings.of[ny * w + nx] >= 0;
        const [ex, ey, ew, eh] = k === 0 ? [X, Y, TS, 1] : k === 2 ? [X, Y + TS - 1, TS, 1] : k === 3 ? [X, Y, 1, TS] : [X + TS - 1, Y, 1, TS];
        if (flat) {
          // Парапет: светлая полоса внутри, тёмная кромка снаружи.
          ctx.fillStyle = L.roof === 'flat' ? U.parapet : C.parapet;
          const [px, py, pw, ph] = k === 0 ? [X, Y + 1, TS, 2] : k === 2 ? [X, Y + TS - 3, TS, 2] : k === 3 ? [X + 1, Y, 2, TS] : [X + TS - 3, Y, 2, TS];
          ctx.fillRect(px, py, pw, ph);
          ctx.fillStyle = L.roof === 'flat' ? U.parapetEdge : C.parapetEdge;
        } else ctx.fillStyle = other ? ROOFS.seam : ROOFS.eave;
        ctx.fillRect(ex, ey, ew, eh);
        // Карниз у улицы — в два пикселя.
        if (!flat && !other) {
          const [ix, iy, iw, ih] = k === 0 ? [X, Y + 1, TS, 1] : k === 2 ? [X, Y + TS - 2, TS, 1] : k === 3 ? [X + 1, Y, 1, TS] : [X + TS - 2, Y, 1, TS];
          ctx.fillRect(ix, iy, iw, ih);
        }
      }
    }
    // Что на крыше: внутренние тайлы (не у края), по хэшу дома.
    const inner = b.tiles.filter((i) => {
      const x = i % w;
      const y = (i - x) / w;
      return this.has(b, x - 1, y) && this.has(b, x + 1, y) && this.has(b, x, y - 1) && this.has(b, x, y + 1);
    });
    if (!inner.length) return;
    const props = Math.min(4, 1 + Math.floor(inner.length / 14));
    for (let k = 0; k < props; k++) {
      const i = inner[hash2(seed, k, 31) % inner.length];
      const x = (i % w) * TS;
      const y = Math.floor(i / w) * TS;
      const v = hash2(seed, k, 37);
      if (L.roof === 'tile' || L.roof === 'slate') {
        const O = ROOFS.old;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + 6, y + 7, 6, 5);
        ctx.fillStyle = O.chimney;
        ctx.fillRect(x + 5, y + 5, 5, 5);
        ctx.fillStyle = O.chimneyTop;
        ctx.fillRect(x + 6, y + 6, 3, 3);
      } else if (L.roof === 'tin') {
        const Sl = ROOFS.slum;
        ctx.fillStyle = Sl.pipe;
        ctx.fillRect(x + 6, y + 6, 4, 4);
        ctx.fillStyle = Sl.pipeTop;
        ctx.fillRect(x + 7, y + 7, 2, 2);
      } else if (L.roof === 'flat') {
        if (v % 3 === 0 && inner.length > 10) {
          ctx.fillStyle = U.tank;
          ctx.beginPath();
          ctx.arc(x + 8, y + 8, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(x + 5, y + 5, 3, 2);
        } else if (v % 3 === 1) {
          ctx.fillStyle = U.skylightFrame;
          ctx.fillRect(x + 2, y + 4, 12, 8);
          ctx.fillStyle = U.skylight;
          ctx.fillRect(x + 3, y + 5, 10, 6);
          ctx.fillStyle = U.skylightFrame;
          ctx.fillRect(x + 8, y + 5, 1, 6);
        } else {
          ctx.fillStyle = U.vent;
          ctx.fillRect(x + 5, y + 5, 5, 5);
          ctx.fillStyle = U.ventTop;
          ctx.fillRect(x + 6, y + 6, 3, 3);
        }
      } else {
        if (k === 0) {
          ctx.fillStyle = C.hatch;
          ctx.fillRect(x + 4, y + 4, 8, 8);
          ctx.fillStyle = C.parapet;
          ctx.fillRect(x + 4, y + 4, 8, 1);
        } else {
          ctx.strokeStyle = C.antenna;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 8, y + 2);
          ctx.lineTo(x + 8, y + 14);
          ctx.moveTo(x + 4, y + 5);
          ctx.lineTo(x + 12, y + 5);
          ctx.moveTo(x + 5, y + 9);
          ctx.lineTo(x + 11, y + 9);
          ctx.stroke();
          ctx.fillStyle = C.lamp;
          ctx.fillRect(x + 7, y + 1, 2, 2);
        }
      }
    }
  }

  /**
   * Стена к югу: для каждого столбца нижнего края дома — стена, окна (по этажам), дверь. litOnly — ночью после
   * затемнения: только горящие стёкла и двери лавок.
   */
  private facade(ctx: Ctx, b: Building, o: RoofOptions, lift: number, litOnly: boolean): void {
    const L = this.looks[b.id];
    const w = this.map.width;
    const F = ROOFS.facade;
    const H = o.view === 'tall' ? lift : this.facadeHeight(b);
    const seed = hash2(b.id, b.x1, b.y0);
    const shop = b.kind === 'shop' || b.kind === 'cafe' || b.kind === 'canteen';
    const hMap = this.map.height;
    for (const i of b.tiles) {
      const x = i % w;
      const y = (i - x) / w;
      if (this.has(b, x, y + 1)) continue;
      // В контуре стена видна только над открытым местом; с высотой — всегда (южный сосед закроет низ сам).
      if (o.view !== 'tall' && (y + 1 >= hMap || this.buildings.of[i + w] >= 0 || this.map.isSolid(x, y + 1))) continue;
      const X0 = x * TS;
      const X1 = X0 + TS;
      const bottom = (y + 1) * TS;
      const top = bottom - H;
      const lit = this.litAt(i, o);
      if (litOnly && !lit) continue;
      if (!litOnly) paintWall(ctx, X0, top, X1, bottom, L.wall, L.wallColor, seed);
      const door = this.doorSide.get(i) === 2;
      if (door && (!litOnly || shop)) {
        const leaf: 0 | 1 | 2 = this.doorSide.get(i + 1) === 2 && this.has(b, x + 1, y) ? 1 : this.doorSide.get(i - 1) === 2 && this.has(b, x - 1, y) ? 2 : 0;
        const dh = Math.min(13, H - 3);
        paintDoor(ctx, X0, bottom - dh, X1, bottom - 1, F.door[L.wall] ?? F.door.old, leaf, shop, lit);
        if (!litOnly) {
          ctx.fillStyle = F.step;
          ctx.fillRect(X0, bottom, TS, 2);
        }
      }
      const wnd = this.winAt.get(i);
      if (!wnd || wnd.out !== 2) continue;
      const rows = H >= F.storeyMin * b.storeys ? b.storeys : 1;
      const S = RENDER.windows.style[wnd.style];
      const big = wnd.style === 'shop';
      // Стекло вдоль стены: пролёт стиля (у парного — до стыка тайлов).
      const u0 = X0 + (wnd.pair === 2 ? 0 : Math.round(S.span[0] + 1));
      const u1 = X0 + (wnd.pair === 1 ? TS : Math.round(S.span[1] - 1));
      const band = (H - 4) / rows;
      for (let r = 0; r < rows; r++) {
        // Дверь в этом столбце — окно первого этажа не рисуем.
        if (door && r === rows - 1) continue;
        const v0 = Math.round(top + 3 + r * band + (big ? 1 : band * 0.18));
        const v1 = Math.round(top + 3 + (r + 1) * band - (big ? 3 : band * 0.3));
        if (v1 - v0 < 3) continue;
        paintWindow(ctx, u0, v0, u1, v1, wnd.style, big ? 'plain' : wnd.look, wnd.tint, lit);
      }
    }
  }

  /** Горит ли окно (дверь лавки) на тайле i ночью. */
  private litAt(i: number, o: RoofOptions): boolean {
    if (o.night === null || o.night === undefined) return false;
    const wnd = this.winAt.get(i);
    return !!wnd && wnd.lit && windowOn(wnd, o.night);
  }

  /** Вход с невидимой стороны (в виде top — любой): козырёк над улицей и фонарь, чтобы дверь было видно. */
  private entrances(ctx: Ctx, b: Building, view: RoofView, lift: number): void {
    const F = ROOFS.facade;
    const d = F.canopyDepth;
    const w = this.map.width;
    for (const e of b.doors) {
      if (view !== 'top' && e.side === 2) continue;
      const X = e.x * TS;
      const Y = e.y * TS - (view === 'tall' && e.side !== 2 ? lift : 0);
      const [cx, cy, cw, ch] = e.side === 0 ? [X, Y - d, TS, d] : e.side === 2 ? [X, Y + TS, TS, d] : e.side === 1 ? [X + TS, Y, d, TS] : [X - d, Y, d, TS];
      ctx.fillStyle = F.canopy;
      ctx.fillRect(cx, cy, cw, ch);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      if (e.side === 0) ctx.fillRect(cx, cy - 1, cw, 1);
      // Фонарь — у края двери (на одном из тайлов пары).
      const pairNext = this.doorSide.get(e.side === 0 || e.side === 2 ? e.y * w + e.x + 1 : (e.y + 1) * w + e.x) === e.side;
      if (!pairNext) {
        ctx.fillStyle = F.lamp;
        const [lx, ly] = e.side === 0 ? [X + TS - 2, Y - d] : e.side === 2 ? [X + TS - 2, Y + TS + d - 2] : e.side === 1 ? [X + TS + d - 2, Y + TS - 2] : [X - d, Y + TS - 2];
        ctx.fillRect(lx, ly, 2, 2);
      }
    }
  }

  /** Контур дома, где игрок (разрез): пунктир по внешнему краю. */
  outline(ctx: Ctx, b: Building): void {
    const w = this.map.width;
    const C = ROOFS.cut;
    ctx.save();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = C.width;
    ctx.setLineDash(C.dash as number[]);
    ctx.beginPath();
    for (const i of b.tiles) {
      const x = i % w;
      const y = (i - x) / w;
      const X = x * TS;
      const Y = y * TS;
      if (!this.has(b, x, y - 1)) {
        ctx.moveTo(X, Y + 0.5);
        ctx.lineTo(X + TS, Y + 0.5);
      }
      if (!this.has(b, x, y + 1)) {
        ctx.moveTo(X, Y + TS - 0.5);
        ctx.lineTo(X + TS, Y + TS - 0.5);
      }
      if (!this.has(b, x - 1, y)) {
        ctx.moveTo(X + 0.5, Y);
        ctx.lineTo(X + 0.5, Y + TS);
      }
      if (!this.has(b, x + 1, y)) {
        ctx.moveTo(X + TS - 0.5, Y);
        ctx.lineTo(X + TS - 0.5, Y + TS);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Ночью после затемнения: горящие окна фасадов снова светлые, под ними — пятно света на мостовой (сложением цвета;
   * в виде top — только пятна у окон с любой стороны: стёкла под крышей не видны).
   */
  drawLit(ctx: Ctx, list: readonly Building[], o: RoofOptions): void {
    if (o.night === null || o.night === undefined) return;
    const N = ROOFS.night;
    const w = this.map.width;
    for (const b of list) {
      if (o.cut === b.id) continue;
      const lift = o.view === 'tall' ? this.lift(b) : 0;
      if (o.view !== 'top') this.facade(ctx, b, o, lift, true);
      for (const i of b.tiles) {
        const wnd = this.winAt.get(i);
        if (!wnd || !wnd.lit || !windowOn(wnd, o.night)) continue;
        if (o.view !== 'top' && wnd.out !== 2) continue;
        const x = i % w;
        const y = (i - x) / w;
        const [gx, gy] = wnd.out === 0 ? [x * TS + 8, y * TS - 4] : wnd.out === 1 ? [(x + 1) * TS + 4, y * TS + 8] : wnd.out === 3 ? [x * TS - 4, y * TS + 8] : [x * TS + 8, (y + 1) * TS + 5];
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, N.glowRadius);
        g.addColorStop(0, N.glow);
        g.addColorStop(1, 'rgba(255,200,110,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.fillRect(gx - N.glowRadius, gy - N.glowRadius, N.glowRadius * 2, N.glowRadius * 2);
        ctx.restore();
      }
    }
  }
}
