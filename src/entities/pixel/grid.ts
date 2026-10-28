/**
 * Пиксельная сетка пешек (без DOM — рисуется и в тестах): цвета, детали с объёмом, линии, контур «selout».
 * Описание стиля — docs/rendering.md «Пиксельные пешки».
 */
import { PIXEL } from '../../config/pixelPawns';

export type Px = string | null;

// ——— Цвета ———
const rgbCache = new Map<string, [number, number, number]>();
export function rgb(c: string): [number, number, number] {
  let v = rgbCache.get(c);
  if (v) return v;
  if (c.startsWith('#')) {
    const n = parseInt(c.length === 4 ? c.slice(1).replace(/./g, (h) => h + h) : c.slice(1, 7), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = c.match(/[\d.]+/g) ?? ['0', '0', '0'];
    v = [+m[0], +m[1], +m[2]];
  }
  rgbCache.set(c, v);
  return v;
}
export const hex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const shadeCache = new Map<string, Map<number, string>>();
/** Светлее (k > 0) или темнее (k < 0). Кэш по цвету и доле — без строк-ключей на каждый пиксель. */
export function shade(c: string, k: number): string {
  if (!k) return c;
  let m = shadeCache.get(c);
  if (!m) {
    m = new Map();
    shadeCache.set(c, m);
  }
  let v = m.get(k);
  if (v) return v;
  const f = (x: number) => (k >= 0 ? x + (255 - x) * k : x * (1 + k));
  const [r, g, b] = rgb(c);
  v = hex(f(r), f(g), f(b));
  m.set(k, v);
  return v;
}
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
export const lum = (c: string): number => {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/**
 * Сетка пикселей. get/set/rect — в координатах рисунка (со сдвигом ox, oy: рисовальщик пишет координаты силуэта,
 * а сетка шире — с полями под ствол и вспышку); px/put и обработка (map, outline, paste) — по самой сетке.
 */
export class Grid {
  c: Px[];
  ox = 0;
  oy = 0;
  constructor(readonly w: number, readonly h: number) { this.c = new Array<Px>(w * h).fill(null); }
  px(x: number, y: number): Px { return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.c[y * this.w + x]; }
  put(x: number, y: number, c: Px): void { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y * this.w + x] = c; }
  get(x: number, y: number): Px { return this.px(x + this.ox, y + this.oy); }
  set(x: number, y: number, c: Px): void { this.put(x + this.ox, y + this.oy, c); }
  rect(x: number, y: number, w: number, h: number, c: Px): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** Перекрасить уже закрашенное (узор поверх детали, не выходя за её края). */
  over(x: number, y: number, c: string): void { if (this.get(x, y)) this.set(x, y, c); }
  blank(): Grid {
    const g = new Grid(this.w, this.h);
    g.ox = this.ox;
    g.oy = this.oy;
    return g;
  }
  clone(): Grid {
    const g = this.blank();
    g.c = this.c.slice();
    return g;
  }
  map(f: (c: string, x: number, y: number) => Px): Grid {
    const g = this.blank();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.px(x, y);
      if (c) g.put(x, y, f(c, x, y));
    }
    return g;
  }
  /** Наложить другую сетку со сдвигом (dx, dy) — по самим сеткам. */
  paste(src: Grid, dx = 0, dy = 0): void {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.px(x, y);
      if (c) this.put(x + dx, y + dy, c);
    }
  }
  /** Зеркально по горизонтали (сторона W из E): центр силуэта остаётся на месте. */
  mirror(): Grid {
    const g = this.blank();
    const axis = 2 * (PIXEL.cx + this.ox);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.px(x, y);
      if (c) g.put(axis - x, y, c);
    }
    return g;
  }
  /** Срезать всё ниже строки y (в координатах рисунка) — пешка в траншее по пояс. */
  cutBelow(y: number): void {
    for (let r = y + this.oy; r < this.h; r++) for (let x = 0; x < this.w; x++) this.c[r * this.w + x] = null;
  }
  empty(): boolean {
    for (const c of this.c) if (c) return false;
    return true;
  }
}

/** Узор детали: свой цвет пикселя (камуфляж, полоски, клетка) или null — основной. */
export type Pattern = (x: number, y: number) => string | null;

const S = PIXEL.shade;
/** Деталь с объёмом: свет слева сверху — светлая левая кромка, тёмные правая и нижняя; round — срезать углы. */
export function part(g: Grid, x: number, y: number, w: number, h: number, c: string, round = false, pat?: Pattern): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1);
    if (round && corner && w > 2 && h > 2) continue;
    let k = 0;
    if (i === 0 && w > 2) k += S.light;
    if (i === w - 1 && w > 1) k += S.dark;
    if (j === h - 1 && h > 2) k += S.bottom;
    const base = pat?.(x + i, y + j) ?? c;
    g.set(x + i, y + j, k ? shade(base, Math.round(k * 100) / 100) : base);
  }
}
/** Линия толщиной thick (квадратная кисть). */
export function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string, thick = 1): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (let n = 0; n < 200; n++) {
    g.rect(x0, y0, thick, thick, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
export function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, c: string): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) g.set(x, y, c);
  }
}

/** Контур «selout»: не чёрный, а тёмный тон того цвета, который он обводит (ink — общий цвет контура). */
export function outline(g: Grid, k: number = S.outline, ink?: string): Grid {
  const out = g.clone();
  const { w, h, c } = g;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (c[i]) continue;
      const n = (y > 0 ? c[i - w] : null) ?? (x > 0 ? c[i - 1] : null) ?? (x < w - 1 ? c[i + 1] : null) ?? (y < h - 1 ? c[i + w] : null);
      if (n) out.c[i] = ink ?? shade(n, k);
    }
  }
  return out;
}
