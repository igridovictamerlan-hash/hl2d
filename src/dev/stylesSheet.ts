import { CLOTHES } from '../config/clothes';
import { CP_UNIT, REBEL_UNIT, colorsOf } from '../config/factions';
import type { WeaponId } from '../config/items';
import type { PawnDir, PawnLook } from '../entities/PawnRenderer';
import { drawPawnFigure } from '../ui/pawnFigure';

/**
 * Лист «Стили пешек» (dev-страница sheets/styles.html): одни и те же шесть жителей в нескольких вариантах стиля,
 * чтобы выбрать свой вид вместо RimWorld. Только эскизы для сравнения, в игру не входит:
 * A — как сейчас; B — тот же рисунок пиксель-артом в палитре города; C — новый силуэт 3/4 (руки, ноги, пропорции);
 * D — вид строго сверху с поворотом за прицелом; E — силуэт C ночью («нуар»).
 */
type Ctx = CanvasRenderingContext2D;
type Px = string | null;

// ——— Цвета ———
function rgb(c: string): [number, number, number] {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/\d+/g)!;
  return [+m[0], +m[1], +m[2]];
}
const hex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function shade(c: string, k: number): string {
  const f = (v: number) => (k >= 0 ? v + (255 - v) * k : v * (1 + k));
  const [r, g, b] = rgb(c);
  return hex(f(r), f(g), f(b));
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
const lum = (c: string): number => {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/**
 * Палитра Верхнеречья: бетон, ржавчина, охра, хаки, выцветший синий Протектората, кожа — и три акцента
 * (бирюза визоров и маячков, красный глаз, жёлтая нашивка армии).
 */
const PALETTE = [
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
function nearest(c: string): string {
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
class Grid {
  c: Px[];
  constructor(readonly w: number, readonly h: number) { this.c = new Array<Px>(w * h).fill(null); }
  get(x: number, y: number): Px { return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.c[y * this.w + x]; }
  set(x: number, y: number, c: Px): void { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y * this.w + x] = c; }
  rect(x: number, y: number, w: number, h: number, c: Px): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  map(f: (c: string, x: number, y: number) => Px): Grid {
    const g = new Grid(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.get(x, y);
      if (c) g.set(x, y, f(c, x, y));
    }
    return g;
  }
}

/** Деталь с объёмом: свет слева сверху — светлая левая кромка, тёмные правая и нижняя; round — срезать углы. */
type Pattern = (x: number, y: number) => string | null;
function part(g: Grid, x: number, y: number, w: number, h: number, c: string, round = false, pat?: Pattern): void {
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
function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string, thick = 1): void {
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
function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, c: string): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) g.set(x, y, c);
  }
}

/** Контур «selout»: не чёрный, а тёмный тон того цвета, который он обводит (ink — общий цвет контура). */
function outline(g: Grid, k = -0.62, ink?: string): Grid {
  const out = g.map((c) => c);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.get(x, y)) continue;
    const n = g.get(x, y - 1) ?? g.get(x - 1, y) ?? g.get(x + 1, y) ?? g.get(x, y + 1);
    if (n) out.set(x, y, ink ?? shade(n, k));
  }
  return out;
}
/** Свет на кромке силуэта (мир освещён слева сверху — одинаково при любом повороте). */
function rimLight(g: Grid): Grid {
  return g.map((c, x, y) => {
    if (!g.get(x, y - 1) || !g.get(x - 1, y)) return shade(c, 0.16);
    if (!g.get(x, y + 1) || !g.get(x + 1, y)) return shade(c, -0.18);
    return c;
  });
}
function draw(ctx: Ctx, g: Grid, x: number, y: number, k: number): void {
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const c = g.get(i, j);
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(x + i * k, y + j * k, k, k);
  }
}
function gridFromCanvas(cv: HTMLCanvasElement): Grid {
  const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
  const g = new Grid(cv.width, cv.height);
  for (let i = 0; i < cv.width * cv.height; i++) {
    if (d[i * 4 + 3] < 120) continue;
    const a = d[i * 4 + 3] / 255;
    g.c[i] = hex(d[i * 4] / a, d[i * 4 + 1] / a, d[i * 4 + 2] / a);
  }
  return g;
}

// ——— Жители ———
type Head = 'ushanka' | 'kerchief' | 'cp' | 'ota' | 'mich' | 'shaved';
interface Spec {
  name: string;
  /** Как в игре сейчас (вариант A и B) и оружие в руках. */
  look: PawnLook;
  weapon: WeaponId | null;
  gun?: 'smg' | 'rifle' | 'ar2';
  skin: string;
  hair: string;
  head: Head;
  hat: string;
  trim: string;
  coat: string;
  pants: string;
  boots: string;
  glove?: string;
  mask?: string;
  vest?: string;
  pads?: string;
  long?: boolean;
  skirt?: string;
  quilt?: boolean;
  seam?: boolean;
  camo?: [string, string];
  number?: string;
  collar?: string;
  band?: string;
  belt?: string;
  pack?: string;
  /** Светится (линзы, визор, маячок) — в «нуаре» горит. */
  accent: string;
}

const cpRank = CP_UNIT.pcu3;
const otaColor = colorsOf('ota', 0).color;
const SPECS: Spec[] = [
  {
    name: 'Горожанин (ватник)', look: { faction: 'citizen', rank: 0, color: '#6a6f75', seed: CLOTHES.sets[0].seed, clothes: CLOTHES.sets[0].look }, weapon: null,
    skin: '#d6a078', hair: '#4a382c', head: 'ushanka', hat: '#5e5246', trim: '#8e7a62', coat: '#4f5648', pants: '#3a3f46', boots: '#73777a',
    quilt: true, seam: true, accent: '#f2c84a',
  },
  {
    name: 'Горожанка (кофта, платок)', look: { faction: 'citizen', rank: 0, color: '#6a6f75', seed: CLOTHES.sets[3].seed, clothes: CLOTHES.sets[3].look }, weapon: null,
    skin: '#f1cba6', hair: '#6b5038', head: 'kerchief', hat: '#8c3a2c', trim: '#e3dfd2', coat: '#7a5c44', skirt: '#5f5a4c', pants: '#5f5a4c', boots: '#2e2420',
    seam: true, accent: '#f2c84a',
  },
  {
    name: 'Патрульный ВС', look: { faction: 'cp', rank: cpRank, color: colorsOf('cp', cpRank).color, seed: 1234 + cpRank * 77 }, weapon: 'mp7', gun: 'smg',
    skin: '#d6a078', hair: '#262a30', head: 'cp', hat: '#40597a', trim: '#9ab4cc', coat: '#262c36', pants: '#262a30', boots: '#15171b', glove: '#262a30',
    mask: '#3a3f46', vest: '#66717c', quilt: true, belt: '#1c2128', accent: '#4fe0f0',
  },
  {
    name: 'Легионер LGN.ALPHA', look: { faction: 'ota', rank: 0, color: otaColor, seed: 77 }, weapon: 'ar2', gun: 'ar2',
    skin: '#d6a078', hair: '#262a30', head: 'ota', hat: '#d6d3c8', trim: '#7c2a24', coat: '#5d6166', pants: '#4a4d52', boots: '#262a30', glove: '#3a3f46',
    vest: '#cfccc1', pads: '#c4c1b6', belt: '#4a4d52', accent: '#4fe0f0',
  },
  {
    name: 'Ветеран армии', look: { faction: 'rebel', rank: REBEL_UNIT.veteran, color: '#f2d34a', seed: 5, profession: 'veteran' }, weapon: 'ak74', gun: 'rifle',
    skin: '#a87050', hair: '#2e2420', head: 'mich', hat: '#565e44', trim: '#1e1e1e', coat: '#737a52', pants: '#6b6e4c', boots: '#2e2420', glove: '#3c4232',
    mask: '#262a30', vest: '#565e44', camo: ['#4a4a32', '#959a68'], band: '#f2c84a', pack: '#4a4a32', belt: '#3c4232', accent: '#d4b07a',
  },
  {
    name: 'Поднадзорный', look: { faction: 'vort', rank: 0, color: colorsOf('vort', 0).color, seed: 31 }, weapon: null,
    skin: '#d6a078', hair: '#4a382c', head: 'shaved', hat: '#4a382c', trim: '#4a382c', coat: '#7b7f84', pants: '#6b6f74', boots: '#3a3f46',
    long: true, number: '#ece6d2', collar: '#8d949c', accent: '#58d0ff',
  },
];

const INK = '#15171b';
const GLASS = '#101318';

/** Пятна камуфляжа — по клетке сетки (одинаково со всех сторон). */
function camoOf(s: Spec): Pattern | undefined {
  if (!s.camo) return undefined;
  const [a, b] = s.camo;
  return (x, y) => {
    const h = ((Math.floor(x / 2) * 73856093) ^ (Math.floor(y / 2) * 19349663)) >>> 0;
    const v = h % 7;
    return v === 0 ? a : v === 1 ? b : null;
  };
}

// ——— C: силуэт 3/4 — голова в четверть роста, руки, ноги ———
const FW = 24;
const FH = 36;
/** Земля (под подошвами) в сетке силуэта. */
const FG = 34;

function gunS(g: Grid, s: Spec): void {
  if (s.gun === 'smg') {
    line(g, 7, 21, 17, 15, '#262a30', 2);
    g.rect(12, 19, 2, 3, '#262a30');
  } else if (s.gun === 'ar2') {
    line(g, 5, 22, 19, 14, '#bdbcb2', 2);
    line(g, 6, 22, 9, 20, '#73777a', 2);
    g.set(15, 16, s.accent);
    g.set(17, 15, s.accent);
  } else {
    line(g, 5, 23, 19, 14, '#262a30', 2);
    line(g, 5, 23, 8, 21, '#8e6a45', 2);
    g.rect(12, 19, 2, 3, '#3a3f46');
  }
}

function figure(s: Spec, d: PawnDir): Grid {
  const g = new Grid(FW, FH);
  const hand = s.glove ?? s.skin;
  const camo = camoOf(s);
  const coatD = shade(s.coat, -0.25);
  const armed = !!s.gun;
  if (d === 'E') {
    // ——— Профиль (смотрит вправо) ———
    if (s.pack) part(g, 6, 14, 4, 8, s.pack, true);
    part(g, 10, 24, 5, 7, s.pants, false, camo);
    part(g, 10, 31, 7, 3, s.boots, true);
    part(g, 9, 13, 7, 11, s.coat, true, camo);
    if (s.long) { part(g, 9, 13, 7, 16, s.coat, true); part(g, 8, 24, 9, 5, s.coat); }
    if (s.skirt) { part(g, 9, 23, 7, 3, s.skirt); part(g, 8, 26, 9, 3, s.skirt); }
    if (s.quilt) for (const y of [16, 19, 22]) g.rect(10, y, 5, 1, shade(s.vest ?? s.coat, -0.14));
    if (s.vest) {
      part(g, 10, 14, 6, 8, s.vest, true);
      if (s.quilt) for (const y of [16, 19]) g.rect(11, y, 4, 1, shade(s.vest, -0.14));
      else part(g, 15, 18, 2, 3, shade(s.vest, -0.12));
    }
    if (s.belt) g.rect(9, 23, 7, 1, s.belt);
    if (s.collar) { g.rect(10, 12, 5, 1, s.collar); g.set(14, 12, s.accent); }
    if (s.number) g.rect(13, 15, 2, 2, s.number);
    // Голова.
    part(g, 9, 5, 7, 7, s.skin, true);
    g.set(16, 8, s.skin);
    g.set(16, 9, shade(s.skin, -0.12));
    g.set(14, 8, INK);
    g.set(15, 10, shade(s.skin, -0.3));
    g.rect(10, 12, 3, 1, shade(s.skin, -0.2));
    if (s.head === 'shaved') { g.rect(10, 4, 5, 1, s.hair); g.rect(9, 5, 4, 2, shade(s.hair, 0.15)); }
    if (s.head === 'ushanka') {
      part(g, 8, 2, 9, 4, s.hat, true);
      part(g, 8, 5, 9, 2, s.trim);
      part(g, 10, 7, 3, 4, s.trim, true);
      part(g, 8, 7, 2, 4, s.trim);
    }
    if (s.head === 'kerchief') {
      part(g, 9, 3, 7, 4, s.hat, true);
      part(g, 9, 7, 4, 4, s.hat);
      part(g, 7, 10, 3, 3, s.hat);
      g.set(11, 4, s.trim); g.set(14, 5, s.trim); g.set(10, 8, s.trim);
    }
    if (s.head === 'cp') {
      part(g, 9, 7, 4, 5, '#262a30');
      part(g, 12, 7, 4, 5, s.mask!);
      g.rect(14, 8, 2, 2, GLASS); g.set(14, 8, s.accent);
      part(g, 16, 10, 2, 2, '#262a30');
      part(g, 8, 2, 9, 5, s.hat, true);
      part(g, 8, 6, 10, 2, shade(s.hat, -0.18));
      g.rect(9, 4, 7, 1, s.trim);
    }
    if (s.head === 'ota') {
      part(g, 8, 3, 9, 9, s.hat, true);
      g.rect(13, 7, 4, 1, GLASS); g.set(15, 7, s.accent);
      g.rect(15, 9, 2, 2, '#3a3f46');
      g.rect(9, 6, 3, 1, shade(s.hat, -0.12));
    }
    if (s.head === 'mich') {
      part(g, 9, 5, 7, 7, s.mask!, true);
      g.rect(13, 8, 3, 1, s.skin); g.set(14, 8, INK);
      part(g, 8, 2, 9, 5, s.hat, true, camo);
      g.rect(12, 5, 5, 1, s.trim); g.set(15, 5, s.accent);
    }
    // Рука и оружие.
    if (armed) {
      part(g, 11, 14, 3, 4, s.coat, true, camo);
      line(g, 12, 18, 15, 18, coatD, 2);
      if (s.gun === 'smg') { g.rect(12, 17, 9, 2, '#262a30'); g.rect(16, 19, 2, 3, '#262a30'); g.rect(10, 18, 3, 1, '#262a30'); }
      else if (s.gun === 'ar2') { g.rect(9, 17, 14, 2, '#bdbcb2'); g.rect(9, 18, 4, 2, '#73777a'); g.set(17, 17, s.accent); g.set(20, 17, s.accent); }
      else { g.rect(12, 17, 11, 2, '#262a30'); g.rect(8, 18, 5, 2, '#8e6a45'); g.rect(16, 19, 2, 3, '#3a3f46'); g.rect(18, 17, 3, 1, '#8e6a45'); }
      part(g, 14, 17, 2, 2, hand);
      part(g, 19, 17, 2, 2, hand);
    } else {
      part(g, 11, 14, 3, 9, s.coat, true, camo);
      if (s.band) g.rect(11, 16, 3, 2, s.band);
      part(g, 11, 23, 3, 2, hand);
    }
    return g;
  }

  // ——— Спереди и сзади ———
  const back = d === 'N';
  if (back && armed) line(g, 6, 24, 18, 12, s.gun === 'ar2' ? '#bdbcb2' : '#262a30', 2);
  part(g, 8, 24, 4, 7, s.pants, false, camo);
  part(g, 12, 24, 4, 7, s.pants, false, camo);
  part(g, 7, 31, 5, 3, s.boots, true);
  part(g, 12, 31, 5, 3, s.boots, true);
  // Руки: опущены или к оружию.
  const armLen = armed && !back ? 5 : 9;
  part(g, 5, 14, 2, armLen, s.coat, false, camo);
  part(g, 17, 14, 2, armLen, s.coat, false, camo);
  if (s.band) g.rect(5, 16, 2, 2, s.band);
  if (!armed || back) { part(g, 5, 23, 2, 2, hand); part(g, 17, 23, 2, 2, hand); }
  part(g, 7, 13, 10, 11, s.coat, true, camo);
  if (s.long) { part(g, 7, 13, 10, 16, s.coat, true); part(g, 6, 24, 12, 5, s.coat); }
  if (s.skirt) { part(g, 7, 23, 10, 3, s.skirt); part(g, 6, 26, 12, 3, s.skirt); }
  if (s.quilt) for (const y of [16, 19, 22]) g.rect(8, y, 8, 1, shade(s.coat, -0.14));
  if (s.seam && !back) g.rect(11, 14, 1, 9, coatD);
  if (back && s.pack) part(g, 8, 14, 8, 9, s.pack, true);
  else if (s.vest) {
    part(g, 8, 14, 8, 8, s.vest, true);
    if (s.quilt) for (const y of [16, 19]) g.rect(9, y, 6, 1, shade(s.vest, -0.14));
    else if (!back) for (const x of [8, 10, 12, 14]) part(g, x, 20, 2, 2, shade(s.vest, -0.12));
  }
  if (s.pads) { part(g, 4, 13, 4, 4, s.pads, true); part(g, 16, 13, 4, 4, s.pads, true); }
  if (s.belt) g.rect(7, 23, 10, 1, s.belt);
  if (s.number) { g.rect(9, back ? 16 : 15, back ? 6 : 3, 2, s.number); g.set(10, back ? 17 : 16, '#3a3f46'); }
  // Голова.
  g.rect(10, 12, 4, 1, shade(s.skin, -0.2));
  if (back) {
    part(g, 8, 5, 8, 7, s.skin, true);
    if (s.head === 'shaved') { g.rect(9, 4, 6, 1, s.hair); part(g, 8, 5, 8, 3, shade(s.hair, 0.15), true); }
  } else {
    part(g, 8, 5, 8, 7, s.skin, true);
    g.set(10, 8, INK); g.set(13, 8, INK);
    g.rect(11, 10, 2, 1, shade(s.skin, -0.3));
    if (s.head === 'shaved') { g.rect(9, 4, 6, 1, s.hair); g.rect(8, 5, 8, 1, shade(s.hair, 0.15)); g.set(8, 5, null); g.set(15, 5, null); }
  }
  if (s.collar) { g.rect(9, 12, 6, 1, s.collar); if (!back) g.set(11, 12, s.accent); }
  if (s.head === 'ushanka') {
    part(g, 7, 2, 10, 4, s.hat, true);
    if (back) part(g, 7, 5, 10, 6, s.trim, true);
    else { part(g, 7, 5, 10, 2, s.trim); part(g, 6, 6, 2, 5, s.trim, true); part(g, 16, 6, 2, 5, s.trim, true); }
  }
  if (s.head === 'kerchief') {
    part(g, 8, 3, 8, back ? 9 : 4, s.hat, true);
    if (back) part(g, 10, 12, 4, 2, s.hat);
    else { g.rect(8, 7, 1, 4, s.hat); g.rect(15, 7, 1, 4, shade(s.hat, -0.2)); part(g, 10, 12, 4, 1, s.hat); }
    g.set(10, 4, s.trim); g.set(13, 5, s.trim); g.set(9, 6, s.trim); g.set(14, 3, s.trim);
    if (back) { g.set(11, 8, s.trim); g.set(13, 10, s.trim); }
  }
  if (s.head === 'cp') {
    if (back) { part(g, 8, 7, 8, 5, '#262a30', true); g.rect(9, 9, 6, 1, s.mask!); }
    else {
      part(g, 9, 7, 6, 5, s.mask!, true);
      g.rect(9, 8, 2, 2, GLASS); g.rect(13, 8, 2, 2, GLASS);
      g.set(9, 8, s.accent); g.set(13, 8, s.accent);
      part(g, 11, 10, 2, 3, '#262a30');
    }
    part(g, 7, 2, 10, 5, s.hat, true);
    part(g, 6, 6, 12, 2, shade(s.hat, -0.18));
    g.rect(8, 4, 8, 1, s.trim);
  }
  if (s.head === 'ota') {
    part(g, 7, 3, 10, 9, s.hat, true);
    if (back) g.rect(11, 4, 2, 7, shade(s.hat, -0.12));
    else {
      g.rect(8, 7, 8, 1, GLASS); g.rect(11, 8, 2, 3, GLASS);
      g.set(9, 7, s.accent); g.set(14, 7, s.accent);
    }
  }
  if (s.head === 'mich') {
    part(g, 8, 5, 8, 7, s.mask!, true);
    if (!back) { g.rect(9, 8, 6, 1, s.skin); g.set(10, 8, INK); g.set(13, 8, INK); }
    part(g, 7, 2, 10, 5, s.hat, true, camo);
    g.rect(7, 5, 10, 1, s.trim);
    if (!back) { g.set(9, 5, s.accent); g.set(14, 5, s.accent); }
  }
  if (armed && !back) {
    gunS(g, s);
    line(g, 6, 18, 8, 20, s.coat, 2);
    line(g, 17, 18, 15, 17, s.coat, 2);
    part(g, 8, 19, 2, 2, hand);
    part(g, 14, 16, 2, 2, hand);
  }
  return g;
}

// ——— D: строго сверху, смотрит на восток; поворот — целиком ———
const TW = 30;
function topDown(s: Spec): Grid {
  const g = new Grid(TW, TW);
  const hand = s.glove ?? s.skin;
  const armed = !!s.gun;
  const camo = camoOf(s);
  const tc = (c: string, x: number, y: number) => camo?.(x, y) ?? c;
  if (s.long) ellipse(g, 12, 15, 5.5, 7.6, shade(s.coat, -0.08));
  if (s.skirt) ellipse(g, 12, 15, 5.5, 7.3, s.skirt);
  if (s.pack) { g.rect(8, 11, 4, 8, s.pack); g.rect(8, 11, 1, 8, shade(s.pack, -0.2)); }
  ellipse(g, 14, 15, 4.4, 7.4, s.coat);
  for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) if (g.get(x, y) === s.coat) g.set(x, y, tc(s.coat, x, y));
  if (s.quilt) for (const x of [12, 15]) for (let y = 9; y <= 21; y++) if (g.get(x, y)) g.set(x, y, shade(s.coat, -0.14));
  if (s.vest) ellipse(g, 14.5, 15, 3.4, 5.6, s.vest);
  if (s.number) g.rect(10, 14, 2, 3, s.number);
  if (s.pads) { ellipse(g, 14, 8.6, 3, 2.4, s.pads); ellipse(g, 14, 21.4, 3, 2.4, s.pads); }
  if (armed) {
    const gun = s.gun === 'ar2' ? '#bdbcb2' : '#262a30';
    const len = s.gun === 'smg' ? 24 : 28;
    g.rect(16, 15, len - 16, 2, gun);
    if (s.gun === 'rifle') g.rect(14, 15, 4, 2, '#8e6a45');
    if (s.gun === 'ar2') { g.set(21, 15, s.accent); g.set(24, 16, s.accent); }
    line(g, 14, 9, 20, 14, s.coat, 2);
    line(g, 14, 20, 17, 17, s.coat, 2);
    if (s.band) g.rect(14, 9, 2, 2, s.band);
    ellipse(g, 21, 15.5, 1.5, 1.5, hand);
    ellipse(g, 17.5, 16.5, 1.5, 1.5, hand);
  } else {
    ellipse(g, 15, 7.6, 2.6, 1.9, s.coat);
    ellipse(g, 15, 22.4, 2.6, 1.9, s.coat);
    if (s.band) g.rect(14, 7, 2, 2, s.band);
    ellipse(g, 17.6, 7.6, 1.4, 1.4, hand);
    ellipse(g, 17.6, 22.4, 1.4, 1.4, hand);
  }
  if (s.collar) { ellipse(g, 14.5, 15, 4.3, 4.3, s.collar); g.set(18, 15, s.accent); }
  // Голова — макушка, лба чуть-чуть.
  const hx = 14.5;
  const hy = 15;
  if (s.head === 'shaved' || s.head === 'kerchief') { ellipse(g, hx + 1.4, hy, 2.6, 2.4, s.skin); }
  if (s.head === 'shaved') ellipse(g, hx - 0.4, hy, 3.3, 3.4, shade(s.hair, 0.2));
  if (s.head === 'kerchief') {
    ellipse(g, hx - 0.3, hy, 3.6, 3.7, s.hat);
    g.rect(9, 14, 2, 2, s.hat);
    g.set(13, 13, s.trim); g.set(15, 16, s.trim); g.set(12, 16, s.trim);
  }
  if (s.head === 'ushanka') {
    ellipse(g, hx, hy, 4.6, 4.6, s.trim);
    ellipse(g, hx - 0.4, hy, 3.3, 3.3, s.hat);
  }
  if (s.head === 'cp') {
    ellipse(g, hx, hy, 4.5, 4.5, shade(s.hat, -0.18));
    ellipse(g, hx - 0.2, hy, 3.6, 3.6, s.hat);
    g.rect(12, 15, 5, 1, s.trim);
    g.rect(19, 14, 2, 3, '#262a30');
  }
  if (s.head === 'ota') {
    ellipse(g, hx, hy, 4.3, 4.3, s.hat);
    for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) {
      const a = Math.atan2(y + 0.5 - hy, x + 0.5 - hx);
      const r = Math.hypot(y + 0.5 - hy, x + 0.5 - hx);
      if (Math.abs(a) < 0.9 && r > 3 && r <= 4.3) g.set(x, y, GLASS);
    }
    g.set(18, 13, s.accent); g.set(18, 16, s.accent);
  }
  if (s.head === 'mich') {
    ellipse(g, hx, hy, 4.2, 4.2, s.hat);
    for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) if (g.get(x, y) === s.hat) g.set(x, y, tc(s.hat, x, y));
    g.rect(17, 13, 1, 5, s.trim);
    g.set(17, 14, s.accent); g.set(17, 16, s.accent);
  }
  return g;
}
/** Поворот спрайта на угол (по ближайшему пикселю), потом свет на кромке и контур — в мировой системе. */
function rotated(s: Spec, ang: number): Grid {
  const src = document.createElement('canvas');
  src.width = src.height = TW;
  draw(src.getContext('2d')!, topDown(s), 0, 0, 1);
  const dst = document.createElement('canvas');
  dst.width = dst.height = TW;
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(TW / 2, TW / 2);
  ctx.rotate(ang);
  ctx.drawImage(src, -TW / 2, -TW / 2);
  return outline(rimLight(gridFromCanvas(dst).map(nearest)));
}

// ——— B: тот же рисунок игры, мелко, в палитре и с цветным контуром ———
const BW = 44;
const BH = 50;
const BG = 45;
function pixelOld(s: Spec, d: PawnDir): Grid {
  const cv = document.createElement('canvas');
  cv.width = BW;
  cv.height = BH;
  drawPawnFigure(cv.getContext('2d')!, s.look, s.weapon, BW / 2, BG, 0.82, d);
  const g = gridFromCanvas(cv).map(nearest);
  // Чёрный контур → тёмный тон соседнего цвета.
  return g.map((c, x, y) => {
    if (lum(c) > 0.13) return c;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const n = g.get(x + dx, y + dy);
      if (n && lum(n) > 0.13) return nearest(shade(n, -0.55));
    }
    return c;
  });
}

// ——— E: «нуар» — ночь, холодная тень, тёплая кромка от фонаря слева ———
const LAMP = '#ffb760';
const NIGHT = '#1b2433';
function noir(s: Spec, d: PawnDir): Grid {
  const g = figure(s, d);
  const lit = g.map((c, x, y) => {
    if (c === s.accent) return c;
    const base = mix(shade(c, -0.5), NIGHT, 0.35);
    if (!g.get(x - 1, y) || !g.get(x - 1, y - 1)) return mix(c, LAMP, 0.4);
    if (!g.get(x - 2, y)) return mix(shade(c, -0.15), LAMP, 0.18);
    return base;
  });
  return outline(lit, 0, '#0a0c11');
}

// ——— Страница ———
function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.style.width = `${w}px`;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}
function cobble(ctx: Ctx, w: number, h: number, cell: number, night = false): void {
  ctx.fillStyle = night ? '#14161b' : '#4f4a44';
  ctx.fillRect(0, 0, w, h);
  let seed = 7;
  for (let y = 0, row = 0; y < h; y += cell * 0.75, row++) {
    for (let x = (row % 2) * -cell / 2; x < w; x += cell) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const l = (night ? 9 : 27) + ((seed >>> 16) % 5);
      ctx.fillStyle = `hsl(${night ? 220 : 30} ${night ? 12 : 8}% ${l}%)`;
      ctx.fillRect(Math.round(x + 1), Math.round(y + 1), Math.round(cell - 2), Math.round(cell * 0.75 - 2));
    }
  }
}
function shadow(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

type Variant = { code: string; title: string; note: string; dirs: (PawnDir | number)[]; big: (ctx: Ctx, s: Spec, dir: PawnDir | number, x: number, y: number) => void; small: (ctx: Ctx, s: Spec, x: number, y: number) => void; cellW: number; cellH: number };

const K = 5;
const DIRS: PawnDir[] = ['S', 'E', 'N'];
const fig = (ctx: Ctx, g: Grid, x: number, ground: number, k: number, gy: number, w: number) => draw(ctx, g, Math.round(x - (w / 2) * k), Math.round(ground - gy * k), k);
const VARIANTS: Variant[] = [
  {
    code: 'A', title: 'Сейчас — как RimWorld',
    note: 'Тело-«фасолина», голова в половину роста, руки-кружки и оружие «в воздухе», толстый чёрный контур, плоская заливка в 2–3 тона.',
    dirs: DIRS, cellW: 130, cellH: 200,
    big: (ctx, s, d, x, y) => { shadow(ctx, x, y - 4, 40, 14); drawPawnFigure(ctx, s.look, s.weapon, x, y, K * 0.9, d as PawnDir); },
    small: (ctx, s, x, y) => drawPawnFigure(ctx, s.look, s.weapon, x, y, 2 * 1.05, 'S'),
  },
  {
    code: 'B', title: 'Пиксель-арт из того же рисунка',
    note: 'Тот же PawnRenderer, но пешка рисуется в мелкий холст 1:1 и увеличивается без сглаживания; цвета — к палитре Верхнеречья (36 цветов), контур не чёрный, а тёмный тон соседнего цвета. Самый дешёвый путь: форма по частям и одежда работают как есть. Силуэт остаётся римворлдовским.',
    dirs: DIRS, cellW: 130, cellH: 200,
    big: (ctx, s, d, x, y) => { shadow(ctx, x, y - 4, 40, 14); fig(ctx, pixelOld(s, d as PawnDir), x, y, K, BG, BW); },
    small: (ctx, s, x, y) => fig(ctx, pixelOld(s, 'S'), x, y, 2, BG, BW),
  },
  {
    code: 'C', title: 'Новый силуэт 3/4 (пиксель-арт)',
    note: 'Голова в четверть роста, широкие плечи, видны руки и ноги, оружие держат две руки. Объём — свет слева сверху, контур цветной. Палитра та же. Самый узнаваемый «свой» вид, но рисовальщик пешек и все вещи (одежда, форма по частям) — заново.',
    dirs: DIRS, cellW: 130, cellH: 200,
    big: (ctx, s, d, x, y) => { shadow(ctx, x, y - 2, 34, 9); fig(ctx, outline(figure(s, d as PawnDir)), x, y, K, FG, FW); },
    small: (ctx, s, x, y) => { shadow(ctx, x, y - 1, 14, 4); fig(ctx, outline(figure(s, 'S')), x, y, 2, FG, FW); },
  },
  {
    code: 'D', title: 'Строго сверху (как Hotline Miami / Door Kickers)',
    note: 'Макушка, плечи, руки с оружием; спрайт целиком поворачивается за прицелом на любой угол — без четырёх сторон. Свет на кромке — от мира (слева сверху) при любом повороте. Лица не видно: узнавание по головному убору, плечам и цвету. Самое большое изменение.',
    dirs: [0, -Math.PI / 4, Math.PI * 0.75, Math.PI / 2], cellW: 160, cellH: 160,
    big: (ctx, s, a, x, y) => { const g = rotated(s, a as number); draw(ctx, g, Math.round(x - (TW / 2) * K), Math.round(y + 12 - 80 - (TW / 2) * K), K); },
    small: (ctx, s, x, y) => { const g = rotated(s, -Math.PI / 2); draw(ctx, g, Math.round(x - TW), Math.round(y - 2 * TW), 2); },
  },
];

const root = document.getElementById('sheet')!;
for (const v of VARIANTS) {
  const sec = document.createElement('section');
  sec.id = `style-${v.code}`;
  sec.innerHTML = `<h2><b>${v.code}</b>${v.title}</h2><p class="note">${v.note}</p>`;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const s of SPECS) {
    const card = document.createElement('div');
    card.className = 'card';
    const [c, ctx] = canvas(v.cellW * v.dirs.length, v.cellH);
    cobble(ctx, c.width, c.height, 16 * (v.code === 'D' ? 4 : 5));
    v.dirs.forEach((d, i) => v.big(ctx, s, d, v.cellW * i + v.cellW / 2, v.cellH - 12));
    card.append(c, Object.assign(document.createElement('div'), { textContent: s.name }));
    grid.append(card);
  }
  sec.append(grid);
  // В масштабе игры: камера ≈ 2 экранных px на px мира.
  const [st, sctx] = canvas(SPECS.length * 70 + 40, 100);
  st.className = 'strip';
  cobble(sctx, st.width, st.height, 32);
  SPECS.forEach((s, i) => v.small(sctx, s, 50 + i * 70, 86));
  const lab = Object.assign(document.createElement('div'), { textContent: 'в масштабе игры (≈ ×2)' });
  lab.style.cssText = 'font:13px "PT Mono",monospace;color:#8f877a;margin-top:4px';
  sec.append(st, lab);
  root.append(sec);
}

// E — ночная улица: фонарь слева, холодная тень, тёплая кромка, светятся линзы и маячки, длинные тени.
{
  const sec = document.createElement('section');
  sec.id = 'style-E';
  sec.innerHTML = '<h2><b>E</b>«Нуар» — силуэт C ночью</h2><p class="note">Свет мира делает стиль: тени холодные синие, кромка тёплая со стороны фонаря, светятся только линзы противогазов, визоры Легиона и маячки ошейников. Длинные тени от фонаря. Работает поверх B, C или D — это слой света, не рисунок пешки.</p>';
  const W = 1000;
  const H = 300;
  const [c, ctx] = canvas(W, H);
  cobble(ctx, W, H, 64, true);
  const lx = 40;
  const ground = H - 30;
  const glow = ctx.createRadialGradient(lx + 40, ground - 40, 10, lx + 40, ground - 40, 520);
  glow.addColorStop(0, 'rgba(255,183,96,0.42)');
  glow.addColorStop(0.5, 'rgba(255,150,70,0.12)');
  glow.addColorStop(1, 'rgba(255,150,70,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0c0e12';
  ctx.fillRect(lx + 30, 30, 8, ground - 30);
  ctx.fillRect(lx + 30, 30, 34, 6);
  ctx.fillStyle = '#ffd9a0';
  ctx.fillRect(lx + 54, 36, 12, 6);
  const k = 5;
  SPECS.forEach((s, i) => {
    const x = 190 + i * 140;
    const g = noir(s, i % 2 ? 'E' : 'S');
    // Тень от фонаря — вытянута вправо по земле.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(x, ground);
    ctx.transform(1, 0, -1.6 - i * 0.12, 0.28, 0, 0);
    for (let j = 0; j < g.h; j++) for (let ii = 0; ii < g.w; ii++) {
      if (!g.get(ii, j)) continue;
      ctx.fillStyle = '#000';
      ctx.fillRect((ii - FW / 2) * k, (j - FG) * k, k, k);
    }
    ctx.restore();
    fig(ctx, g, x, ground, k, FG, FW);
    // Свечение акцентов.
    ctx.globalCompositeOperation = 'lighter';
    const gx = Math.round(x - (FW / 2) * k);
    const gy = Math.round(ground - FG * k);
    for (let j = 0; j < g.h; j++) for (let ii = 0; ii < g.w; ii++) {
      if (g.get(ii, j) !== s.accent) continue;
      const cx = gx + ii * k + k / 2;
      const cy = gy + j * k + k / 2;
      const r = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
      const [cr, cg, cb] = rgb(s.accent);
      r.addColorStop(0, `rgba(${cr},${cg},${cb},0.55)`);
      r.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = r;
      ctx.fillRect(cx - 22, cy - 22, 44, 44);
    }
    ctx.globalCompositeOperation = 'source-over';
  });
  sec.append(c);
  root.append(sec);
}

// Палитра.
{
  const sec = document.createElement('section');
  sec.innerHTML = '<h2><b>◼</b>Палитра Верхнеречья</h2><p class="note">Бетон и грязный снег, ржавчина и охра, хаки, выцветший синий Протектората, кожа — и три акцента: бирюза визоров и маячков, красный глаз, жёлтая нашивка армии. Вся картинка (B–E) приводится к ней.</p>';
  const [c, ctx] = canvas(PALETTE.length * 30, 40);
  PALETTE.forEach((p, i) => { ctx.fillStyle = p; ctx.fillRect(i * 30, 0, 30, 40); });
  sec.append(c);
  root.append(sec);
}
