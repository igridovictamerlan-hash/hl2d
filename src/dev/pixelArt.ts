/**
 * Пиксель-арт для эскизов стиля (dev-листы sheets/styles*.html): цвета, палитра Верхнеречья, пиксельная сетка,
 * детали с объёмом, контур «selout», свет на кромке. В игру не входит.
 */
export type Ctx = CanvasRenderingContext2D;
export type Px = string | null;

// ——— Цвета ———
export function rgb(c: string): [number, number, number] {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/\d+/g)!;
  return [+m[0], +m[1], +m[2]];
}
export const hex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export function shade(c: string, k: number): string {
  const f = (v: number) => (k >= 0 ? v + (255 - v) * k : v * (1 + k));
  const [r, g, b] = rgb(c);
  return hex(f(r), f(g), f(b));
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
 * Палитра Верхнеречья: бетон, ржавчина, охра, тёплый серый, хаки, выцветший синий Протектората, кожа — и три
 * акцента (бирюза визоров и маячков, красный глаз, жёлтая нашивка армии).
 */
export const PALETTE = [
  '#15171b', '#262a30', '#3a3f46', '#555a60', '#73777a', '#969893', '#bdbcb2', '#e3dfd2',
  '#2e2420', '#4a382c', '#6b5038', '#8e6a45', '#b48a58', '#d4b07a',
  '#4f4740', '#6e645a', '#8f8272',
  '#3c4232', '#565e44', '#737a52', '#959a68',
  '#1e2838', '#2c3c55', '#40597a', '#6a86a6', '#9ab4cc',
  '#5a2622', '#8c3a2c', '#c25a3a',
  '#f1cba6', '#d6a078', '#a87050', '#6e4630',
  '#4fe0f0', '#ff4a3a', '#f2c84a',
];
const PAL_RGB = PALETTE.map(rgb);
const nearCache = new Map<string, string>();
export function nearest(c: string): string {
  let hit = nearCache.get(c);
  if (hit) return hit;
  const [r, g, b] = rgb(c);
  let best = 0;
  let bd = Infinity;
  PAL_RGB.forEach(([pr, pg, pb], k) => {
    // «redmean» — расстояние ближе к глазу, чем просто RGB.
    const rm = (r + pr) / 2;
    const d = (2 + rm / 256) * (r - pr) ** 2 + 4 * (g - pg) ** 2 + (2 + (255 - rm) / 256) * (b - pb) ** 2;
    if (d < bd) { bd = d; best = k; }
  });
  hit = PALETTE[best];
  nearCache.set(c, hit);
  return hit;
}

// ——— Пиксельная сетка ———
/**
 * Сетка пикселей. get/set/rect — в координатах рисунка (со сдвигом ox, oy: рисовальщик пишет координаты силуэта,
 * а сетка шире — с полями под ствол и вспышку); px и обработка (map, outline, rimLight, draw) — по самой сетке.
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
  /** Пустая сетка того же размера и сдвига. */
  blank(): Grid {
    const g = new Grid(this.w, this.h);
    g.ox = this.ox;
    g.oy = this.oy;
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
  /** Наложить другую сетку со сдвигом (dx, dy). */
  paste(src: Grid, dx: number, dy: number): void {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.px(x, y);
      if (c) this.put(x + dx, y + dy, c);
    }
  }
  /** Зеркально по горизонтали (сторона W из E). */
  mirror(): Grid {
    const g = this.blank();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.put(this.w - 1 - x, y, this.px(x, y));
    return g;
  }
}

/** Деталь с объёмом: свет слева сверху — светлая левая кромка, тёмные правая и нижняя; round — срезать углы. */
export type Pattern = (x: number, y: number) => string | null;
export function part(g: Grid, x: number, y: number, w: number, h: number, c: string, round = false, pat?: Pattern): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1);
    if (round && corner && w > 2 && h > 2) continue;
    let k = 0;
    if (i === 0 && w > 2) k += 0.14;
    if (i === w - 1 && w > 1) k -= 0.2;
    if (j === h - 1 && h > 2) k -= 0.16;
    const base = pat?.(x + i, y + j) ?? c;
    g.set(x + i, y + j, k ? shade(base, k) : base);
  }
}
export function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string, thick = 1): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
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
export function outline(g: Grid, k = -0.62, ink?: string): Grid {
  const out = g.map((c) => c);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.px(x, y)) continue;
    const n = g.px(x, y - 1) ?? g.px(x - 1, y) ?? g.px(x + 1, y) ?? g.px(x, y + 1);
    if (n) out.put(x, y, ink ?? shade(n, k));
  }
  return out;
}
/** Свет на кромке силуэта (мир освещён слева сверху — одинаково при любом повороте). */
export function rimLight(g: Grid): Grid {
  return g.map((c, x, y) => {
    if (!g.px(x, y - 1) || !g.px(x - 1, y)) return shade(c, 0.16);
    if (!g.px(x, y + 1) || !g.px(x + 1, y)) return shade(c, -0.18);
    return c;
  });
}
export function draw(ctx: Ctx, g: Grid, x: number, y: number, k: number): void {
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const c = g.px(i, j);
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(x + i * k, y + j * k, k, k);
  }
}
export function gridFromCanvas(cv: HTMLCanvasElement): Grid {
  const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
  const g = new Grid(cv.width, cv.height);
  for (let i = 0; i < cv.width * cv.height; i++) {
    if (d[i * 4 + 3] < 120) continue;
    const a = d[i * 4 + 3] / 255;
    g.c[i] = hex(d[i * 4] / a, d[i * 4 + 1] / a, d[i * 4 + 2] / a);
  }
  return g;
}

// ——— Страница ———
export function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.style.width = `${w}px`;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}
export function cobble(ctx: Ctx, w: number, h: number, cell: number, night = false, x0 = 0, y0 = 0): void {
  ctx.fillStyle = night ? '#14161b' : '#4f4a44';
  ctx.fillRect(x0, y0, w, h);
  let seed = 7;
  for (let y = 0, row = 0; y < h; y += cell * 0.75, row++) {
    for (let x = (row % 2) * -cell / 2; x < w; x += cell) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const l = (night ? 9 : 27) + ((seed >>> 16) % 5);
      ctx.fillStyle = `hsl(${night ? 220 : 30} ${night ? 12 : 8}% ${l}%)`;
      const cx = Math.max(x0, Math.round(x0 + x + 1));
      const cw = Math.min(x0 + w, Math.round(x0 + x + cell - 1)) - cx;
      const ch = Math.min(y0 + h, Math.round(y0 + y + cell * 0.75 - 1)) - Math.round(y0 + y + 1);
      if (cw > 0 && ch > 0) ctx.fillRect(cx, Math.round(y0 + y + 1), cw, ch);
    }
  }
}
export function shadow(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}
