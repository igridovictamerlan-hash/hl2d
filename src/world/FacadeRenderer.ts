import { FACADES } from '../config/facades';
import { hash2 } from '../core/rng';
import { windowOn } from './windows';
import { facadeHeight, storeyBands, topHeight, type FacadeKit, type WallMat } from './facadeStyle';

/**
 * Европейский фасад и скатная крыша в виде ¾ (набор деталей — world/facadeStyle.ts). Масштаб — по пешке: первый этаж
 * выше человека, дверь в его рост, окна ~12×18 px мира (FACADES.size, winH, door). Стены — кирпич с перевязкой,
 * штукатурка, руст, камень; окна с откосами, переплётами, подоконниками, перемычками и наличниками, ставни, шторы,
 * цветы; дверь с фрамугой, пилястрами или портиком, ступени и фонарь; витрина лавки с фризом и надписью; карниз с
 * сухариками, парапет или свес; щипцы (ступенчатый, с шеей, колоколом, треугольный); эркер, балкон с решёткой;
 * водосток, копоть, плакаты, бельё. Крыша — ряды черепицы (шифер, медь) с разбросом тона, конёк, вальмы, мансарда,
 * слуховые окна, трубы с горшками.
 *
 * Рисует дневной вид в пикселях мира (игра кэширует его по домам — world/RoofLayer.ts). Что меняется — горящие ночью
 * окна, витрины, фонари, двери (открыта, выбита) — пишется в FacadeRecord и рисуется поверх каждый кадр (drawLit).
 */
type Ctx = CanvasRenderingContext2D;
type Hsl = { readonly h: number; readonly s: number; readonly l: number };

const clampL = (l: number): number => Math.max(2, Math.min(97, l));
const col = (c: Hsl, dl = 0): string => `hsl(${c.h} ${c.s}% ${clampL(c.l + dl)}%)`;
const hv = (a: number, b: number, s: number): number => hash2(a | 0, b | 0, s | 0);
const r01 = (a: number, b: number, s: number): number => hv(a, b, s) / 4294967296;
const pick = <V>(list: readonly V[], a: number, b: number, s: number): V => list[hv(a, b, s) % list.length];

/** Дверной проём в пикселях мира (двери игры — по 1–2 тайла). */
export interface Doorway {
  x0: number;
  x1: number;
}

export interface FacadeSpec {
  /** Фасад по x (пиксели мира) и низ (низ ряда стены к улице). */
  X0: number;
  X1: number;
  bottom: number;
  storeys: number;
  doors: Doorway[];
  /** Витрина лавки: надпись на фризе (null — жилой первый этаж). */
  sign: string | null;
  /** Щипец этого фасада (главный фасад дома с коньком поперёк улицы). */
  gable: boolean;
  /** Дом мельче этажа (будка, сарай): стена этой высоты с дверью, без окон. */
  low?: number;
}

/** Окно (витрина, слуховое окно), которое может гореть ночью: где, по какому хэшу, со шторами ли. */
export interface LitWindow {
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  key: number;
  /** Доля горящих по вечерам (витрины — почти все). */
  share: number;
  curtain: string | null;
  bars: 'sash' | 'casement' | 'shop' | 'cross';
  trim: string;
  /** Этаж (0 — первый): свет на мостовую от верхних слабее. */
  storey: number;
  /** Низ фасада — от него свет ложится на мостовую. */
  street: number;
}

/** Дверь фасада: проём со створками — для «открыта» и «выбита» поверх кэша. */
export interface FacadeDoor {
  /** Проём двери игры (пиксели мира) — по нему ищется дверь (DoorSystem). */
  x0: number;
  x1: number;
  /** Створки. */
  lx0: number;
  lx1: number;
  top: number;
  bottom: number;
  glass: boolean;
  color: string;
}

export interface FacadeLamp {
  x: number;
  y: number;
  street: number;
}

/** Что рисуется поверх дневного фасада: горящие окна, двери, фонари. */
export interface FacadeRecord {
  windows: LitWindow[];
  doors: FacadeDoor[];
  lamps: FacadeLamp[];
}

export const emptyRecord = (): FacadeRecord => ({ windows: [], doors: [], lamps: [] });

/** Окно горит ночью: свой час отбоя и утреннего света по хэшу (как окна плана, world/windows.ts). */
export function litAt(night: number | null, seed: number, k: number, share = 0.55): boolean {
  if (night === null) return false;
  if (r01(seed, k, 91) >= share) return false;
  return windowOn(litSchedule(seed, k), night);
}

/** Час отбоя и утреннего света окна (доли суток, как WindowSpot) — для света на мостовую (Lighting). */
export function litSchedule(seed: number, k: number): { off: number; wake: number } {
  const off = 0.9 + r01(seed, k, 92) * 0.22;
  const wake = r01(seed, k, 93) < 0.4 ? 1.22 + r01(seed, k, 94) * 0.06 : -1;
  return { off, wake };
}

/** Горит ли окно вообще по вечерам (без часа): для набора источников света. */
export function litEver(w: LitWindow): boolean {
  return r01(w.seed, w.key, 91) < w.share;
}

// ——— Стены ———

/** Кирпич: ряды по 3 px (2 — кирпич, 1 — шов), ложок 5 px, перевязка со сдвигом; тон кирпича — разброс. */
function brick(ctx: Ctx, X0: number, Y0: number, X1: number, Y1: number, c: Hsl, seed: number): void {
  const B = FACADES.brick;
  ctx.fillStyle = B.mortar;
  ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  for (let y = Y0, row = 0; y < Y1; y += 3, row++) {
    const off = (row & 1) * 3;
    for (let x = X0 - off; x < X1; x += 6) {
      const j = (hv(x, y, seed) % (B.jitter * 2 + 1)) - B.jitter;
      ctx.fillStyle = col(c, j * 0.8);
      const x0 = Math.max(X0, x);
      const x1 = Math.min(X1, x + 5);
      if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, Math.min(2, Y1 - y));
    }
  }
}

/** Штукатурка: ровный тон, лёгкие пятна; руст — швы рядами камня. */
function stucco(ctx: Ctx, X0: number, Y0: number, X1: number, Y1: number, c: Hsl, seed: number, rustic: boolean): void {
  const S = FACADES.stucco;
  ctx.fillStyle = col(c);
  ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  ctx.fillStyle = S.noise;
  for (let y = Y0; y < Y1; y += 2) for (let x = X0 + (y & 2); x < X1; x += 5) if ((hv(x, y, seed) & 7) === 0) ctx.fillRect(x, y, 2, 1);
  if (!rustic) return;
  ctx.fillStyle = S.rustic;
  for (let y = Y0 + 4, k = 0; y < Y1 - 1; y += 5, k++) {
    ctx.fillRect(X0, y, X1 - X0, 1);
    for (let x = X0 + (k & 1) * 6; x < X1; x += 12) ctx.fillRect(x, y - 4, 1, 4);
  }
}

/** Тёсаный камень: блоки 10×5 со швами, тон блока — разброс. */
function stone(ctx: Ctx, X0: number, Y0: number, X1: number, Y1: number, c: Hsl, seed: number): void {
  ctx.fillStyle = FACADES.joint;
  ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  for (let y = Y0, row = 0; y < Y1; y += 5, row++) {
    for (let x = X0 - (row & 1) * 5; x < X1; x += 10) {
      const x0 = Math.max(X0, x);
      const x1 = Math.min(X1, x + 9);
      if (x1 <= x0) continue;
      ctx.fillStyle = col(c, (hv(x, y, seed) % 5) - 2);
      ctx.fillRect(x0, y, x1 - x0, Math.min(4, Y1 - y));
    }
  }
}

function wall(ctx: Ctx, mat: WallMat | 'rustic', X0: number, Y0: number, X1: number, Y1: number, c: Hsl, seed: number): void {
  if (Y1 <= Y0 || X1 <= X0) return;
  if (mat === 'brick') brick(ctx, X0, Y0, X1, Y1, c, seed);
  else if (mat === 'stone') stone(ctx, X0, Y0, X1, Y1, c, seed);
  else stucco(ctx, X0, Y0, X1, Y1, c, seed, mat === 'rustic');
}

// ——— Окна ———

interface WinOpts {
  curtain: string | null;
  box: boolean;
  shutter: string | null;
  /** 0 — целое, 1 — разбито, 2 — заколочено. */
  damage: 0 | 1 | 2;
  seed: number;
  key: number;
  storey: number;
  street: number;
}

/** Окно с откосом, рамой, стеклом, переплётом, подоконником и тем, что над ним (перемычка, арка, сандрик…). */
function window_(ctx: Ctx, k: FacadeKit, x: number, y: number, w: number, h: number, o: WinOpts, rec: FacadeRecord | null): void {
  const F = FACADES;
  const G = F.glass;
  const gx = x + 1;
  const gy = y + 1;
  const gw = w - 2;
  const gh = h - 2;
  // Наличник Мюнхена — крашеная рамка с «ушами» и полочкой сверху.
  if (k.head === 'surround') {
    ctx.fillStyle = k.trim;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 3);
    ctx.fillRect(x - 3, y - 4, w + 6, 2);
    ctx.fillRect(x - 3, y - 1, 1, 3);
    ctx.fillRect(x + w + 2, y - 1, 1, 3);
    ctx.fillStyle = F.shade;
    ctx.fillRect(x - 3, y - 2, w + 6, 1);
  }
  // Ставни — по бокам, с ламелями и тёмной кромкой.
  if (o.shutter) {
    const sw = Math.max(3, Math.round(w * 0.45));
    for (const sx of [x - sw - 1, x + w + 1]) {
      ctx.fillStyle = o.shutter;
      ctx.fillRect(sx, y, sw, h);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      for (let yy = y + 2; yy < y + h - 1; yy += 2) ctx.fillRect(sx + 1, yy, sw - 2, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(sx + sw - 1, y, 1, h);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(sx, y, 1, h);
    }
  }
  // Откос: тень сверху и слева внутри проёма.
  ctx.fillStyle = F.shade;
  ctx.fillRect(x - 1, y - 1, w + 2, 2);
  ctx.fillRect(x - 1, y, 2, h);
  // Рама.
  ctx.fillStyle = k.trim;
  ctx.fillRect(x, y, w, h);
  if (o.damage === 2) {
    // Заколочено: доски крест-накрест поверх тёмного проёма.
    ctx.fillStyle = G.dark;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = '#6e5233';
    const planks = Math.max(2, Math.round(h / 6));
    for (let i = 0; i < planks; i++) {
      const py = y + 1 + Math.round(((h - 4) * (i + 0.5)) / planks);
      ctx.fillRect(x - 1, py - 1, w + 2, 3);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 0; i < planks; i++) {
      const py = y + 1 + Math.round(((h - 4) * (i + 0.5)) / planks);
      ctx.fillRect(x - 1, py + 1, w + 2, 1);
      ctx.fillStyle = '#2a2018';
      ctx.fillRect(x, py, 1, 1);
      ctx.fillRect(x + w - 1, py, 1, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
    }
  } else if (o.damage === 1) {
    // Разбито: тёмный проём, осколки по краям.
    ctx.fillStyle = G.dark;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = G.shine;
    ctx.fillRect(gx, gy, 2, Math.max(1, gh - 4));
    ctx.fillRect(gx + 2, gy, Math.max(1, gw - 5), 1);
    ctx.fillRect(gx + gw - 2, gy + gh - 3, 1, 3);
    ctx.fillRect(gx + gw - 4, gy + gh - 1, 3, 1);
    bars(ctx, k, gx, gy, gw, gh);
  } else {
    // Стекло: тёмное с отражением неба сверху и бликом наискось.
    ctx.fillStyle = G.day;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = G.dayHi;
    ctx.fillRect(gx, gy, gw, Math.max(1, gh >> 3));
    ctx.fillStyle = G.shine;
    for (let i = 0; i < Math.min(gw, gh) - 2; i += 1) if (i % 4 < 2) ctx.fillRect(gx + gw - 2 - i, gy + 1 + i, 1, 1);
    if (o.curtain) {
      ctx.fillStyle = o.curtain;
      ctx.fillRect(gx, gy, 2, gh);
      ctx.fillRect(gx + gw - 2, gy, 2, gh);
      ctx.fillRect(gx, gy, gw, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(gx + 1, gy + 1, 1, gh - 1);
      ctx.fillRect(gx + gw - 1, gy + 1, 1, gh - 1);
    }
    bars(ctx, k, gx, gy, gw, gh);
    rec?.windows.push({ x: gx, y: gy, w: gw, h: gh, seed: o.seed, key: o.key, share: 0.55, curtain: o.curtain, bars: k.bars, trim: k.trim, storey: o.storey, street: o.street });
  }
  // Подоконник и тень под ним.
  ctx.fillStyle = k.trim;
  ctx.fillRect(x - 2, y + h, w + 4, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 1, y + h + 2, w + 2, 1);
  // Над окном.
  switch (k.head) {
    case 'lintel':
      ctx.fillStyle = k.trim;
      ctx.fillRect(x - 2, y - 3, w + 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x - 2, y - 1, w + 4, 1);
      break;
    case 'arch':
      // Лучковая арка из кирпича на ребро: тёмные клинья с поднятой серединой.
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(x - 1, y - 2, w + 2, 1);
      ctx.fillRect(x, y - 3, w, 1);
      ctx.fillRect(x + 2, y - 4, w - 4, 1);
      ctx.fillStyle = 'rgba(255,230,200,0.12)';
      for (let i = x; i < x + w; i += 2) ctx.fillRect(i, y - 3, 1, 1);
      break;
    case 'keystone':
      ctx.fillStyle = k.trim;
      ctx.fillRect(x - 2, y - 3, w + 4, 2);
      ctx.fillRect(x + (w >> 1) - 1, y - 5, 3, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + (w >> 1) + 1, y - 5, 1, 4);
      ctx.fillRect(x - 2, y - 1, w + 4, 1);
      break;
    case 'pediment':
      ctx.fillStyle = k.trim;
      ctx.fillRect(x - 3, y - 3, w + 6, 2);
      for (let i = 1; i <= 3; i++) ctx.fillRect(x - 3 + i * 2, y - 3 - i, w + 6 - i * 4, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x - 3, y - 1, w + 6, 1);
      break;
    case 'surround':
      break;
  }
  // Ящик с цветами.
  if (o.box) {
    ctx.fillStyle = '#6e4428';
    ctx.fillRect(x - 1, y + h + 2, w + 2, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - 1, y + h + 4, w + 2, 1);
    ctx.fillStyle = F.leaf;
    ctx.fillRect(x - 1, y + h, w + 2, 2);
    for (let i = 0; i < w; i += 2) {
      ctx.fillStyle = F.flowers[(hv(x, i, k.seed) >>> 3) % F.flowers.length];
      ctx.fillRect(x + i, y + h - 1 - ((hv(x, i, k.seed + 1) >>> 5) & 1), 1, 1);
    }
  }
}

/**
 * Переплёт: подъёмное окно (Лондон, Амстердам) — две рамы по шесть стёкол, стык рам толще; створки (Мюнхен, казённые)
 * — крест с фрамугой; у слухового окна — простой крест.
 */
function bars(ctx: Ctx, k: FacadeKit | { trim: string; bars: LitWindow['bars'] }, gx: number, gy: number, gw: number, gh: number): void {
  ctx.fillStyle = k.trim;
  if (k.bars === 'sash') {
    const mid = gy + (gh >> 1);
    ctx.fillRect(gx, mid - 1, gw, 2);
    if (gw >= 7) for (const t of [1 / 3, 2 / 3]) ctx.fillRect(gx + Math.round(gw * t) - (t > 0.5 ? 1 : 0), gy, 1, gh);
    else ctx.fillRect(gx + (gw >> 1), gy, 1, gh);
    if (gh >= 12) {
      ctx.fillRect(gx, gy + Math.round(gh * 0.25), gw, 1);
      ctx.fillRect(gx, gy + Math.round(gh * 0.75), gw, 1);
    }
  } else if (k.bars === 'casement') {
    ctx.fillRect(gx + (gw >> 1), gy, 1, gh);
    ctx.fillRect(gx, gy + Math.max(2, Math.round(gh * 0.3)), gw, 1);
  } else if (k.bars === 'cross') {
    ctx.fillRect(gx + (gw >> 1), gy, 1, gh);
    ctx.fillRect(gx, gy + (gh >> 1), gw, 1);
  }
}

function winOpts(k: FacadeKit, seed: number, i: number, st: number, street: number): WinOpts {
  const key = i * 11 + st * 101;
  const F = FACADES;
  const dmg = r01(seed, key, 61);
  const damage: 0 | 1 | 2 = dmg < k.broken * 0.45 ? 2 : dmg < k.broken ? 1 : 0;
  return {
    curtain: r01(seed, key, 62) < k.curtains ? pick(F.curtains, seed, key, 63) : null,
    box: st > 0 && r01(seed, key, 64) < k.boxes,
    shutter: k.shutters && (k.family !== 'slum' || r01(seed, key, 65) < 0.5) ? k.shutters : null,
    damage,
    seed,
    key,
    storey: st,
    street,
  };
}

// ——— Двери, витрины ———

/** Дверь в проёме: портал (пилястры, портик или просто рама), створки с филёнками, фрамуга, ступени, фонарь. */
function door(ctx: Ctx, k: FacadeKit, d: Doorway, groundTop: number, bottom: number, glass: boolean, rec: FacadeRecord | null): void {
  const F = FACADES;
  const D = F.door;
  // Дверь лавки — стеклянная, под фризом с вывеской: без портика и фрамуги, чтобы не закрыть надпись.
  const porch = glass ? 'plain' : k.porch;
  const pw = Math.min(d.x1 - d.x0, porch === 'portico' ? D.portico : D.w);
  const px0 = Math.round((d.x0 + d.x1 - pw) / 2);
  const px1 = px0 + pw;
  const top = glass ? groundTop + D.shopTop : Math.max(groundTop + 2, bottom - D.h);
  const fan = k.fanlight && !glass ? D.fan : 0;
  const lx0 = px0 + (porch === 'portico' ? 5 : 3);
  const lx1 = px1 - (porch === 'portico' ? 5 : 3);
  const leafTop = top + 2 + fan;
  // Ниша портала.
  ctx.fillStyle = F.shade;
  ctx.fillRect(px0, top, pw, bottom - top);
  if (porch === 'portico') {
    // Колонны с базой и капителью, антаблемент, фронтон над дверью.
    ctx.fillStyle = k.trim;
    ctx.fillRect(px0, top - 2, 4, bottom - top + 2);
    ctx.fillRect(px1 - 4, top - 2, 4, bottom - top + 2);
    ctx.fillRect(px0 - 2, top - 4, pw + 4, 3);
    for (let i = 1; i <= 4; i++) ctx.fillRect(px0 - 2 + i * 3, top - 4 - i, pw + 4 - i * 6, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(px0 + 3, top, 1, bottom - top);
    ctx.fillRect(px1 - 1, top, 1, bottom - top);
    ctx.fillRect(px0 - 2, top - 1, pw + 4, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(px0, top + 1, 1, bottom - top - 1);
    ctx.fillRect(px1 - 4, top + 1, 1, bottom - top - 1);
  } else if (porch === 'pilasters') {
    ctx.fillStyle = k.trim;
    ctx.fillRect(px0, top, 3, bottom - top);
    ctx.fillRect(px1 - 3, top, 3, bottom - top);
    ctx.fillRect(px0 - 1, top - 3, pw + 2, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(px0 - 1, top - 1, pw + 2, 1);
    ctx.fillRect(px0 + 2, top, 1, bottom - top);
    ctx.fillRect(px1 - 1, top, 1, bottom - top);
  } else {
    ctx.fillStyle = k.trim;
    ctx.fillRect(px0 + 1, top, 2, bottom - top);
    ctx.fillRect(px1 - 3, top, 2, bottom - top);
    ctx.fillRect(px0 + 1, top, pw - 2, 2);
  }
  // Фрамуга — полукругом лучами.
  if (fan) {
    ctx.fillStyle = F.glass.day;
    ctx.fillRect(lx0, top + 2, lx1 - lx0, fan);
    ctx.fillStyle = F.glass.dayHi;
    ctx.fillRect(lx0, top + 2, lx1 - lx0, 1);
    ctx.fillStyle = k.trim;
    const cx = (lx0 + lx1) >> 1;
    ctx.fillRect(cx, top + 2, 1, fan);
    ctx.fillRect(lx0 + 3, top + 4, 1, fan - 2);
    ctx.fillRect(lx1 - 4, top + 4, 1, fan - 2);
    ctx.fillRect(lx0, top + 1 + fan, lx1 - lx0, 1);
    ctx.fillStyle = F.shade;
    ctx.fillRect(lx0, top + 2, 2, 2);
    ctx.fillRect(lx1 - 2, top + 2, 2, 2);
    rec?.windows.push({ x: lx0, y: top + 2, w: lx1 - lx0, h: fan - 1, seed: k.seed, key: 7000 + d.x0, share: 0.45, curtain: null, bars: 'cross', trim: k.trim, storey: 0, street: bottom });
  }
  drawLeaves(ctx, lx0, lx1, leafTop, bottom, k.door, glass, glass ? F.shop.frame : k.door);
  // Ступени на мостовую.
  ctx.fillStyle = 'rgba(214,206,190,0.8)';
  ctx.fillRect(px0 - 2, bottom, pw + 4, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(px0 - 2, bottom + 2, pw + 4, 1);
  rec?.doors.push({ x0: d.x0, x1: d.x1, lx0, lx1, top: leafTop, bottom, glass, color: k.door });
  // Фонарь у двери (справа, если есть место в проёме двери игры, иначе слева).
  const lx = px1 + 3 <= d.x1 + 4 ? px1 + 3 : px0 - 5;
  lantern(ctx, lx, top + 5);
  rec?.lamps.push({ x: lx + 1, y: top + 8, street: bottom });
}

/** Створки двери: филёнки, ручки, у лавки — стекло в переплёте. */
function drawLeaves(ctx: Ctx, lx0: number, lx1: number, leafTop: number, bottom: number, color: string, glass: boolean, frame: string): void {
  const F = FACADES;
  const lw = lx1 - lx0;
  const lh = bottom - leafTop;
  ctx.fillStyle = glass ? frame : color;
  ctx.fillRect(lx0, leafTop, lw, lh);
  const mid = (lx0 + lx1) >> 1;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(mid, leafTop, 1, lh);
  for (const [a, b] of [[lx0 + 2, mid - 1], [mid + 2, lx1 - 2]] as const) {
    if (b - a < 2) continue;
    if (glass) {
      ctx.fillStyle = F.glass.day;
      ctx.fillRect(a, leafTop + 2, b - a, Math.round(lh * 0.62));
      ctx.fillStyle = F.glass.dayHi;
      ctx.fillRect(a, leafTop + 2, b - a, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(a, bottom - 6, b - a, 3);
    } else {
      // Две филёнки: верхняя выше, тень сверху и слева, свет снизу и справа.
      const ph = Math.round((lh - 6) * 0.58);
      for (const [py, h] of [[leafTop + 2, ph], [leafTop + 4 + ph, lh - ph - 6]] as const) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(a, py, b - a, 1);
        ctx.fillRect(a, py, 1, h);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(a, py + h - 1, b - a, 1);
        ctx.fillRect(b - 1, py, 1, h);
      }
    }
  }
  ctx.fillStyle = '#d8b35a';
  ctx.fillRect(mid - 2, leafTop + (lh >> 1), 1, 2);
  ctx.fillRect(mid + 2, leafTop + (lh >> 1), 1, 2);
}

/**
 * Дверь фасада в игре — поверх кэша дома: открыта (тёмный проём, створки внутрь) или выбита (щепки, перекошенная
 * створка). Закрытая (и запертая) — как в кэше.
 */
export function drawDoorState(ctx: Ctx, d: FacadeDoor, state: 'open' | 'broken'): void {
  const lw = d.lx1 - d.lx0;
  const lh = d.bottom - d.top;
  ctx.fillStyle = '#0b0b0c';
  ctx.fillRect(d.lx0, d.top, lw, lh);
  ctx.fillStyle = 'rgba(255,214,150,0.07)';
  ctx.fillRect(d.lx0 + 2, d.bottom - 4, lw - 4, 4);
  if (state === 'open') {
    // Створки распахнуты внутрь — видны их торцы у косяков.
    ctx.fillStyle = d.glass ? FACADES.shop.frame : d.color;
    ctx.fillRect(d.lx0, d.top, 3, lh);
    ctx.fillRect(d.lx1 - 3, d.top, 3, lh);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(d.lx0 + 2, d.top, 1, lh);
    ctx.fillRect(d.lx1 - 3, d.top, 1, lh);
    return;
  }
  // Выбита: одна створка висит наискось, щепки на пороге.
  ctx.fillStyle = d.color;
  const half = lw >> 1;
  for (let i = 0; i < lh; i++) ctx.fillRect(d.lx0 + Math.round((i * 3) / lh), d.top + i, half - 1, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(d.lx0 + half - 2, d.top + 2, 1, lh - 4);
  ctx.fillStyle = '#8a6a44';
  for (let i = 0; i < 5; i++) ctx.fillRect(d.lx0 + 1 + ((i * 7) % Math.max(1, lw - 3)), d.bottom - 1 - (i & 1), 2, 1);
  ctx.fillRect(d.lx1 - 2, d.top + 3, 1, 4);
  ctx.fillRect(d.lx1 - 3, d.top + 9, 1, 3);
}

/** Настенный фонарь: кронштейн и фонарь (свет ночью — drawLit). */
function lantern(ctx: Ctx, x: number, y: number): void {
  const L = FACADES.lantern;
  ctx.fillStyle = L.body;
  ctx.fillRect(x - 1, y, 3, 1);
  ctx.fillRect(x, y + 1, 3, 5);
  ctx.fillRect(x - 1, y + 6, 5, 1);
  ctx.fillStyle = '#3a3a34';
  ctx.fillRect(x + 1, y + 2, 1, 3);
}

/** Витрина лавки: пилястры, фриз с надписью, окна в переплёте с товаром на полках, цоколь; дверь — стеклянная. */
function shopfront(ctx: Ctx, k: FacadeKit, X0: number, X1: number, groundTop: number, bottom: number, doors: Doorway[], sign: string, rec: FacadeRecord | null): void {
  const S = FACADES.shop;
  const SF = FACADES.shopfront;
  const fascia = pick(S.fascia, k.seed, 3, 7);
  const ft = groundTop + 2;
  const gt = ft + SF.fascia + 1;
  const gb = bottom - SF.riser - 1;
  const inDoor = (x: number) => doors.some((d) => x >= d.x0 + 2 && x < d.x1 - 2);
  ctx.fillStyle = S.frame;
  ctx.fillRect(X0, ft, X1 - X0, bottom - ft);
  // Фриз: доска с золотой кромкой и надписью.
  ctx.fillStyle = fascia;
  ctx.fillRect(X0 + 1, ft, X1 - X0 - 2, SF.fascia);
  ctx.fillStyle = 'rgba(216,184,96,0.6)';
  ctx.fillRect(X0 + 1, ft, X1 - X0 - 2, 1);
  ctx.fillRect(X0 + 1, ft + SF.fascia - 1, X1 - X0 - 2, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(X0 + 1, ft + SF.fascia, X1 - X0 - 2, 1);
  ctx.save();
  ctx.fillStyle = S.letters;
  ctx.font = `600 ${SF.font}px "PT Sans Narrow", "Arial Narrow", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sign.toUpperCase(), (X0 + X1) / 2, ft + SF.fascia / 2 + 0.3, X1 - X0 - 10);
  ctx.restore();
  // Пилястры по краям витрины.
  ctx.fillStyle = k.trim;
  ctx.fillRect(X0, ft - 1, 2, bottom - ft + 1);
  ctx.fillRect(X1 - 2, ft - 1, 2, bottom - ft + 1);
  // Цоколь витрины с филёнками.
  ctx.fillStyle = S.riser;
  ctx.fillRect(X0 + 2, gb, X1 - X0 - 4, SF.riser + 1);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = X0 + 4; x < X1 - 6; x += 8) ctx.fillRect(x, gb + 1, 6, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let x = X0 + 4; x < X1 - 6; x += 8) ctx.fillRect(x, gb + SF.riser - 1, 6, 1);
  // Стекло витрин в переплёте; на двух полках — товар.
  let seg: { x0: number; x1: number } | null = null;
  const flush = () => {
    if (seg && seg.x1 - seg.x0 >= 3) {
      rec?.windows.push({ x: seg.x0, y: gt, w: seg.x1 - seg.x0, h: gb - gt, seed: k.seed, key: 999 + seg.x0, share: 0.9, curtain: null, bars: 'shop', trim: S.frame, storey: 0, street: bottom });
    }
    seg = null;
  };
  for (let x = X0 + 3; x < X1 - 3; x++) {
    if (inDoor(x)) {
      flush();
      continue;
    }
    const mull = (x - X0) % SF.mullion === 2;
    ctx.fillStyle = mull ? S.frame : FACADES.glass.day;
    ctx.fillRect(x, gt, 1, gb - gt);
    if (mull) continue;
    if (!seg) seg = { x0: x, x1: x + 1 };
    else seg.x1 = x + 1;
    for (const shelf of [gb - 1, gb - 9]) {
      if (shelf - 3 <= gt + 2) continue;
      ctx.fillStyle = pick(S.goods, x, k.seed + shelf, 11);
      ctx.fillRect(x, shelf - 3 + (hv(x, k.seed + shelf, 13) % 2), 1, 3 - (hv(x, k.seed + shelf, 13) % 2));
    }
  }
  flush();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(X0 + 3, gb - 9, X1 - X0 - 6, 1);
  ctx.fillStyle = FACADES.glass.dayHi;
  ctx.fillRect(X0 + 3, gt, X1 - X0 - 6, 1);
  ctx.fillStyle = FACADES.glass.shine;
  for (let x = X0 + 8; x < X1 - 8; x += 23) for (let i = 0; i < 6; i++) if (!inDoor(x + i)) ctx.fillRect(x + i, gt + 2 + i, 1, 1);
}

// ——— Верх фасада ———

/** Карниз 6 px: полка, выкружка, сухарики, тень под ним. */
function cornice(ctx: Ctx, k: FacadeKit, X0: number, X1: number, y: number): void {
  ctx.fillStyle = k.trim;
  ctx.fillRect(X0 - 1, y, X1 - X0 + 2, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(X0, y + 2, X1 - X0, 1);
  ctx.fillStyle = k.trim;
  for (let x = X0 + 1; x < X1 - 1; x += 3) ctx.fillRect(x, y + 3, 2, 2);
  ctx.fillStyle = FACADES.shade;
  ctx.fillRect(X0, y + 5, X1 - X0, 1);
}

/** Пояс между этажами: светлая тяга и тень под ней. */
function band(ctx: Ctx, k: FacadeKit, X0: number, X1: number, y: number): void {
  ctx.fillStyle = k.trim;
  ctx.fillRect(X0, y - 1, X1 - X0, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(X0, y + 1, X1 - X0, 1);
}

/** Щипец над фасадом шириной X0..X1 от линии top вверх: силуэт, кладка, белый камень по краю, окно, балка. */
export function gable(ctx: Ctx, k: FacadeKit, X0: number, X1: number, top: number, rec: FacadeRecord | null = null, maxH = Infinity): void {
  const W = X1 - X0;
  const G = gableHeight(W, maxH);
  if (G < 12) return;
  const cx = (X0 + X1) / 2;
  const pts: [number, number][] = [];
  if (k.top === 'spout') {
    pts.push([X0, top], [X0 + W * 0.36, top - G], [X1 - W * 0.36, top - G], [X1, top]);
  } else if (k.top === 'step') {
    const steps = W >= 70 ? 4 : 3;
    const sw = (W * 0.36) / steps;
    const sh = G / (steps + 0.6);
    pts.push([X0, top]);
    for (let i = 0; i < steps; i++) pts.push([X0 + sw * i, top - sh * (i + 1)], [X0 + sw * (i + 1), top - sh * (i + 1)]);
    pts.push([X0 + sw * steps, top - G], [X1 - sw * steps, top - G]);
    for (let i = steps - 1; i >= 0; i--) pts.push([X1 - sw * (i + 1), top - sh * (i + 1)], [X1 - sw * i, top - sh * (i + 1)]);
    pts.push([X1, top]);
  } else if (k.top === 'neck') {
    const nw = W * 0.42;
    pts.push([X0, top], [X0, top - 3], [cx - nw / 2, top - G * 0.5], [cx - nw / 2, top - G + 5], [cx, top - G], [cx + nw / 2, top - G + 5], [cx + nw / 2, top - G * 0.5], [X1, top - 3], [X1, top]);
  } else {
    // Колокол: плавные плечи к узкому верху.
    const n = 12;
    pts.push([X0, top]);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      pts.push([X0 + W * (0.06 + 0.3 * Math.sin((t * Math.PI) / 2)), top - G * (0.15 + 0.85 * t)]);
    }
    for (let i = n; i >= 1; i--) {
      const t = i / n;
      pts.push([X1 - W * (0.06 + 0.3 * Math.sin((t * Math.PI) / 2)), top - G * (0.15 + 0.85 * t)]);
    }
    pts.push([X1, top]);
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.clip();
  wall(ctx, k.wall, Math.floor(X0), Math.floor(top - G - 1), Math.ceil(X1), top + 1, k.wallColor, k.seed + 5);
  // Окно чердака.
  const ww = Math.max(6, k.win - 2);
  window_(ctx, k, Math.round(cx - ww / 2), Math.round(top - G * 0.6), ww, 11, { curtain: null, box: false, shutter: null, damage: 0, seed: k.seed, key: 5000, storey: 9, street: top }, rec);
  ctx.restore();
  // Белый камень по краю (кромка щипца) — в два пикселя.
  ctx.save();
  ctx.strokeStyle = k.trim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pts[0][0] + 1, pts[0][1]);
  for (const [x, y] of pts.slice(1, -1)) ctx.lineTo(x + (x < cx ? 1 : -1), y + 1);
  ctx.lineTo(pts[pts.length - 1][0] - 1, pts[pts.length - 1][1]);
  ctx.stroke();
  ctx.restore();
  if (k.top === 'neck') {
    // Завитки на плечах шеи.
    ctx.fillStyle = k.trim;
    for (const sx of [-1, 1]) {
      const bx = cx + sx * (W * 0.21 + 2);
      ctx.fillRect(Math.round(bx - 1), Math.round(top - G * 0.5), 3, 3);
      ctx.fillRect(Math.round(bx + sx * 5), Math.round(top - G * 0.3), 3, 3);
    }
  }
  if (k.family === 'amsterdam') {
    // Балка с крюком для подъёма мебели.
    ctx.fillStyle = '#2a1f16';
    ctx.fillRect(Math.round(cx) - 1, Math.round(top - G + 2), 2, 5);
    ctx.fillRect(Math.round(cx) - 2, Math.round(top - G + 2), 5, 1);
    ctx.fillStyle = '#6a6a66';
    ctx.fillRect(Math.round(cx), Math.round(top - G + 7), 1, 2);
  }
}

/** Высота щипца над фасадом шириной W (не выше maxH — места на крыше над фасадом). */
export function gableHeight(W: number, maxH = Infinity): number {
  const S = FACADES.size;
  return Math.min(Math.floor(maxH), Math.max(S.gableMin, Math.min(S.gableMax, Math.round(W * 0.5))));
}

/** Конёк крыши (y) по верху дома Y0 и свесу над главным фасадом eave. */
export function ridgeOf(k: FacadeKit, Y0: number, eave: number): number {
  if (k.roof === 'ns') return Y0 + Math.max(10, Math.round((eave - Y0) * 0.3));
  return Math.min(eave - 4, Y0 + Math.max(4, Math.round((eave - Y0) * FACADES.roof.ridge)));
}

/** Основание трубы: на коньке, но так, чтобы горшки не торчали за край дома. */
export function chimneyBase(k: FacadeKit, Y0: number, eave: number): number {
  return Math.max(ridgeOf(k, Y0, eave), Y0 + FACADES.chimney.h + 6);
}

/** Оси окон фасада X0..X1: сколько влезает с шагом семейства, поровну по ширине (центры, пиксели мира). */
export function bayCenters(k: FacadeKit, X0: number, X1: number): number[] {
  const W = X1 - X0 - 8;
  const n = Math.max(1, Math.round(W / k.bay));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round(X0 + 4 + ((i + 0.5) * W) / n));
  return out;
}

/** Фасад целиком: стены по этажам, пояса, окна по осям, дверь или витрина, эркер, балкон, верх, мелочи. */
export function paintFacade(ctx: Ctx, k: FacadeKit, s: FacadeSpec, rec: FacadeRecord | null = null): void {
  const F = FACADES;
  const S = F.size;
  const WH = F.winH;
  const { X0, X1, bottom } = s;
  const W = X1 - X0;
  if (W < 8) return;
  const seed = k.seed + X0 * 13;
  if (s.low) {
    lowFacade(ctx, k, s, s.low, seed, rec);
    return;
  }
  const bands = storeyBands(k, s.storeys);
  const H = facadeHeight(k, s.storeys);
  const top = bottom - H;
  const topH = topHeight(k);
  const groundTop = bottom - bands[0];
  // Низ каждого этажа: sb[0] — низ фасада, sb[1] — верх первого этажа…
  const sb: number[] = [bottom];
  let yy = groundTop;
  for (let st = 1; st < bands.length; st++) {
    sb.push(yy);
    yy -= bands[st];
  }
  const upperTop = yy;
  // Стены, цоколь, пояса.
  wall(ctx, k.ground, X0, groundTop, X1, bottom, k.groundColor, seed);
  wall(ctx, k.wall, X0, upperTop, X1, groundTop, k.wallColor, seed + 1);
  ctx.fillStyle = 'rgba(30,24,20,0.45)';
  ctx.fillRect(X0, bottom - 4, W, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(X0, bottom - 4, W, 1);
  if (s.storeys > 1) band(ctx, k, X0, X1, groundTop);
  if (k.family === 'grand' || k.family === 'civic' || k.family === 'london') for (let st = 2; st < s.storeys; st++) band(ctx, k, X0, X1, sb[st]);
  const xs = bayCenters(k, X0, X1);
  const ww = k.win;
  // Первый этаж: витрина лавки или окна, дверь.
  if (s.sign) shopfront(ctx, k, X0, X1, groundTop, bottom, s.doors, s.sign, rec);
  else {
    xs.forEach((cx, i) => {
      const x = cx - (ww >> 1);
      if (s.doors.some((d) => x + ww + 4 > d.x0 + 2 && x - 4 < d.x1 - 2)) return;
      window_(ctx, k, x, groundTop + WH.top + 1, ww, WH.ground, winOpts(k, seed, i, 0, bottom), rec);
    });
  }
  for (const d of s.doors) door(ctx, k, d, groundTop, bottom, s.sign !== null, rec);
  // Этажи выше: окна по осям, на бельэтаже — балкон.
  const orielW = k.oriel && s.storeys >= 3 && xs.length >= 3 ? Math.round(W * 0.36) : 0;
  const ox0 = Math.round((X0 + X1 - orielW) / 2);
  for (let st = 1; st < s.storeys; st++) {
    const stTop = sb[st] - bands[st];
    const piano = bands[st] === S.piano;
    const attic = st === s.storeys - 1 && k.family === 'amsterdam' && s.storeys >= 4;
    const wh = attic ? WH.attic : piano ? WH.piano : WH.upper;
    xs.forEach((cx, i) => {
      if (orielW && cx > ox0 - 4 && cx < ox0 + orielW + 4) return;
      window_(ctx, k, cx - (ww >> 1), stTop + WH.top - (piano ? 1 : 0), ww, wh, winOpts(k, seed, i, st, bottom), rec);
    });
    if (st === 1 && k.balcony && (k.family === 'london' || k.family === 'grand')) {
      const bx0 = xs.length >= 3 ? xs[0] - (ww >> 1) - 4 : X0 + 3;
      const bx1 = xs.length >= 3 ? xs[xs.length - 1] + (ww >> 1) + 5 : X1 - 3;
      const by = sb[1];
      ctx.fillStyle = k.trim;
      ctx.fillRect(bx0 - 1, by - 2, bx1 - bx0 + 2, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(bx0, by, bx1 - bx0, 1);
      ctx.fillStyle = F.iron;
      ctx.fillRect(bx0, by - 9, bx1 - bx0, 1);
      for (let x = bx0; x < bx1; x += 2) ctx.fillRect(x, by - 8, 1, 6);
      for (let x = bx0 + 3; x < bx1 - 2; x += 8) ctx.fillRect(x - 1, by - 6, 3, 1);
    }
  }
  // Эркер: выступ через этажи выше первого, с окнами, крышкой и кронштейном снизу; тень на стене справа.
  if (orielW) {
    const oTop = upperTop + 3;
    const oBot = groundTop - 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(ox0 + orielW, oTop + 3, 3, oBot - oTop);
    wall(ctx, k.wall, ox0, oTop, ox0 + orielW, oBot, { h: k.wallColor.h, s: k.wallColor.s, l: k.wallColor.l + 3 }, seed + 9);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(ox0, oTop, 2, oBot - oTop);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(ox0 + orielW - 3, oTop, 3, oBot - oTop);
    const cap = k.roofMat === 'copper' ? k.roofColor : F.roof.copper[0];
    ctx.fillStyle = col(cap, -6);
    ctx.fillRect(ox0 - 2, oTop - 3, orielW + 4, 3);
    ctx.fillStyle = col(cap, 6);
    ctx.fillRect(ox0 + 1, oTop - 6, orielW - 2, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    for (let i = 0; i < 4; i++) ctx.fillRect(ox0 + 3 + i * 3, oBot + i, orielW - 6 - i * 6, 1);
    const n2 = Math.max(2, Math.round(orielW / 16));
    for (let st = 1; st < s.storeys; st++) {
      const stTop = sb[st] - bands[st];
      const wh = bands[st] === S.piano ? WH.piano : WH.upper;
      for (let i = 0; i < n2; i++) {
        const cx = Math.round(ox0 + ((i + 0.5) * orielW) / n2);
        window_(ctx, k, cx - ((ww - 2) >> 1), stTop + WH.top, ww - 2, wh, winOpts(k, seed, 50 + i, st, bottom), rec);
      }
    }
  }
  // Верх фасада.
  if (!s.gable) {
    if (k.top === 'parapet') {
      wall(ctx, k.wall === 'brick' ? 'brick' : 'stucco', X0, top, X1, top + S.parapet, k.wallColor, seed + 3);
      ctx.fillStyle = k.trim;
      ctx.fillRect(X0 - 1, top, W + 2, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(X0, top + 2, W, 1);
      cornice(ctx, k, X0, X1, top + S.parapet - 6);
    } else if (k.top === 'cornice') cornice(ctx, k, X0, X1, top);
    else eave(ctx, k, X0, X1, top);
  } else {
    ctx.fillStyle = k.trim;
    ctx.fillRect(X0, top + topH - 2, W, 2);
  }
  // Водостоки по краям: труба с хомутами, воронка сверху, отмёт внизу.
  if (k.family !== 'civic' && k.family !== 'grand') {
    for (const px of [X0 + 1, X1 - 3]) {
      ctx.fillStyle = F.pipe;
      ctx.fillRect(px, top + 2, 2, H - 4);
      ctx.fillRect(px - 1, top + 1, 4, 2);
      ctx.fillRect(px - 1, bottom - 3, 4, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(px, top + 3, 1, H - 6);
      ctx.fillStyle = F.pipe;
      for (let y = top + 8; y < bottom - 5; y += 10) ctx.fillRect(px - 1, y, 4, 1);
    }
  }
  // Полотнища Протектората между осями.
  if (k.banners && xs.length >= 4 && s.storeys >= 2) {
    for (const i of [0, xs.length - 2]) {
      const bx = Math.round((xs[i] + xs[i + 1]) / 2) - 4;
      const by = upperTop + 3;
      const bh = groundTop - upperTop - 6;
      ctx.fillStyle = F.banner.cloth;
      ctx.fillRect(bx, by, 9, bh);
      ctx.fillStyle = F.banner.edge;
      ctx.fillRect(bx, by, 9, 1);
      ctx.fillRect(bx + 8, by + 1, 1, bh - 1);
      ctx.fillStyle = F.banner.mark;
      ctx.fillRect(bx + 2, by + 5, 5, 5);
      ctx.fillStyle = F.banner.cloth;
      ctx.fillRect(bx + 3, by + 6, 3, 3);
      ctx.fillStyle = F.banner.mark;
      ctx.fillRect(bx + 4, by + 7, 1, 1);
      for (let x = bx; x < bx + 9; x += 2) ctx.fillRect(x, by + bh, 1, 2);
    }
  }
  // Плакаты на первом этаже, бельё на верёвке между окнами.
  if (k.posters && !s.sign) {
    const px = X0 + 4 + (hv(seed, 1, 5) % Math.max(1, W - 16));
    if (!s.doors.some((d) => px + 10 > d.x0 && px < d.x1)) {
      ctx.fillStyle = pick(F.posters, seed, 2, 5);
      ctx.fillRect(px, groundTop + 6, 9, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(px + 2, groundTop + 9, 5, 1);
      ctx.fillRect(px + 2, groundTop + 11, 4, 1);
      ctx.fillRect(px + 2, groundTop + 13, 5, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(px + 7, groundTop + 16, 2, 2);
    }
  }
  if (k.laundry && s.storeys >= 2 && xs.length >= 2) {
    const ly = sb[1] - bands[1] + 2;
    const lx0 = xs[0] + (ww >> 1) + 2;
    const lx1 = xs[1] - (ww >> 1) - 2;
    ctx.fillStyle = 'rgba(30,30,30,0.6)';
    ctx.fillRect(lx0, ly, lx1 - lx0, 1);
    for (let x = lx0 + 1; x < lx1 - 3; x += 5) {
      ctx.fillStyle = pick(F.laundry, x, seed, 9);
      ctx.fillRect(x, ly + 1, 3, 5 + (hv(x, seed, 10) & 1));
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 2, ly + 1, 1, 5);
    }
  }
  // Копоть: темнее к верху, потёки под подоконниками.
  if (k.grime > 0) {
    const g = ctx.createLinearGradient(0, top, 0, top + H * 0.6);
    g.addColorStop(0, `rgba(10,8,6,${(k.grime * 0.32).toFixed(3)})`);
    g.addColorStop(1, 'rgba(10,8,6,0)');
    ctx.fillStyle = g;
    ctx.fillRect(X0, top, W, H * 0.6);
    ctx.fillStyle = `rgba(10,8,6,${(k.grime * 0.25).toFixed(3)})`;
    for (let st = 1; st < s.storeys; st++) {
      xs.forEach((cx, i) => {
        if ((hv(i, st, seed) & 3) === 0) ctx.fillRect(cx - 2 + (hv(i, st, seed + 2) % 4), sb[st] - 2, 1, 3 + (hv(i, st, seed + 1) & 7));
      });
    }
  }
}

/** Свес крыши над фасадом: водосток, тень под ним, у Мюнхена — концы стропил. */
function eave(ctx: Ctx, k: FacadeKit, X0: number, X1: number, top: number): void {
  const F = FACADES;
  ctx.fillStyle = F.roof.gutter;
  ctx.fillRect(X0 - 1, top, X1 - X0 + 2, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(X0, top, X1 - X0, 1);
  ctx.fillStyle = F.shade;
  ctx.fillRect(X0, top + 2, X1 - X0, 2);
  if (k.family === 'munich' || k.family === 'slum') {
    ctx.fillStyle = k.family === 'munich' ? '#4a3020' : '#2e2620';
    for (let x = X0 + 2; x < X1 - 1; x += 5) ctx.fillRect(x, top + 2, 2, 2);
  }
}

/** Низкий фасад (будка, сарай, пристройка мельче этажа): стена с дверью, свес, без окон. */
function lowFacade(ctx: Ctx, k: FacadeKit, s: FacadeSpec, h: number, seed: number, rec: FacadeRecord | null): void {
  const { X0, X1, bottom } = s;
  const top = bottom - h;
  wall(ctx, k.ground === 'rustic' ? 'stucco' : k.ground, X0, top, X1, bottom, k.groundColor, seed);
  ctx.fillStyle = 'rgba(30,24,20,0.45)';
  ctx.fillRect(X0, bottom - 3, X1 - X0, 3);
  for (const d of s.doors) {
    const pw = Math.min(d.x1 - d.x0, FACADES.door.w);
    const px0 = Math.round((d.x0 + d.x1 - pw) / 2);
    const dt = Math.max(top + 2, bottom - FACADES.door.h);
    ctx.fillStyle = FACADES.shade;
    ctx.fillRect(px0, dt, pw, bottom - dt);
    ctx.fillStyle = k.trim;
    ctx.fillRect(px0 + 1, dt, 2, bottom - dt);
    ctx.fillRect(px0 + pw - 3, dt, 2, bottom - dt);
    ctx.fillRect(px0 + 1, dt, pw - 2, 1);
    drawLeaves(ctx, px0 + 3, px0 + pw - 3, dt + 1, bottom, k.door, false, k.door);
    rec?.doors.push({ x0: d.x0, x1: d.x1, lx0: px0 + 3, lx1: px0 + pw - 3, top: dt + 1, bottom, glass: false, color: k.door });
  }
  eave(ctx, k, X0, X1, top);
}

// ——— Ночь ———

/**
 * Горящее: окна, витрины, фрамуги, слуховые окна — по своему часу отбоя (litAt), фонари у дверей — когда темно
 * (lamps > 0). Стекло ярко-тёплое со шторами и переплётом, вокруг — ореол сложением цвета. После затемнения.
 */
export function drawLit(ctx: Ctx, rec: FacadeRecord, night: number, lamps: number): void {
  const F = FACADES;
  const N = F.night;
  if (lamps <= 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, lamps);
  const halo = haloSprite(N.halo);
  for (const w of rec.windows) {
    if (!litAt(night, w.seed, w.key, w.share)) continue;
    const r = Math.max(w.w, w.h) * N.haloR * 0.5;
    ctx.drawImage(halo, w.x + w.w / 2 - r, w.y + w.h / 2 - r, r * 2, r * 2);
  }
  const lamp = haloSprite(N.lampHalo);
  for (const l of rec.lamps) ctx.drawImage(lamp, l.x - N.lampR, l.y - N.lampR, N.lampR * 2, N.lampR * 2);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.35 + lamps);
  for (const w of rec.windows) {
    if (!litAt(night, w.seed, w.key, w.share)) continue;
    ctx.fillStyle = F.glass.night;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = F.glass.nightHi;
    ctx.fillRect(w.x, w.y + Math.max(1, w.h >> 2), w.w, Math.max(1, w.h >> 2));
    if (w.bars === 'shop') {
      ctx.fillStyle = 'rgba(80,50,20,0.55)';
      for (let x = w.x; x < w.x + w.w; x += 2) ctx.fillRect(x, w.y + w.h - 4, 1, 3);
      continue;
    }
    if (w.curtain) {
      ctx.fillStyle = w.curtain;
      ctx.fillRect(w.x, w.y, 2, w.h);
      ctx.fillRect(w.x + w.w - 2, w.y, 2, w.h);
      ctx.fillRect(w.x, w.y, w.w, 1);
    }
    bars(ctx, { trim: 'rgba(60,40,24,0.85)', bars: w.bars }, w.x, w.y, w.w, w.h);
  }
  ctx.fillStyle = F.lantern.glass;
  for (const l of rec.lamps) ctx.fillRect(l.x, l.y - 2, 1, 3);
  ctx.restore();
}

const halos = new Map<string, HTMLCanvasElement>();

/** Мягкий ореол цвета color (спрайт 32×32, один на цвет). */
function haloSprite(color: string): HTMLCanvasElement {
  let s = halos.get(color);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 32;
  const g = s.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 3, 16, 16, 16);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  halos.set(color, s);
  return s;
}

// ——— Крыша ———

export interface RoofDecor {
  /** Оси слуховых окон (x) на южном скате. */
  dormers: number[];
  /** Трубы (x) на коньке. */
  chimneys: number[];
}

/**
 * Скатная крыша над прямоугольником X0..X1 × Y0..Y1 (дом обрезает её своим контуром); eave — линия свеса над
 * главным фасадом (по ней — доля конька). Конёк вдоль улицы (ew), поперёк (ns, щипец к улице), вальмы (hip), мансарда.
 * Возвращает точки дымоходов (для дымка) в пикселях мира.
 */
export function paintRoof(ctx: Ctx, k: FacadeKit, X0: number, Y0: number, X1: number, Y1: number, eave: number, decor: RoofDecor, rec: FacadeRecord | null = null): { x: number; y: number }[] {
  const R = FACADES.roof;
  const c = k.roofColor;
  const row = R.row[k.roofMat];
  const seed = k.seed + 31;
  const smoke: { x: number; y: number }[] = [];
  if (k.roof === 'ns') {
    const rx = Math.round((X0 + X1) / 2);
    slope(ctx, k, X0, Y0, rx, Y1, c, R.south + 3, row, seed, 'v');
    slope(ctx, k, rx, Y0, X1, Y1, c, R.north + 2, row, seed + 1, 'v');
    ctx.fillStyle = R.ridgeCap;
    ctx.fillRect(rx - 1, Y0, 2, Y1 - Y0);
    ctx.fillStyle = 'rgba(255,240,220,0.18)';
    ctx.fillRect(rx + 1, Y0, 1, Y1 - Y0);
    extras(ctx, k, X0, Y0, X1, Y1, seed);
    for (const x of decor.chimneys) smoke.push(chimney(ctx, k, x, chimneyBase(k, Y0, eave), seed + x));
    return smoke;
  }
  const ridge = ridgeOf(k, Y0, eave);
  slope(ctx, k, X0, Y0, X1, ridge, c, R.north, Math.max(2, row - 1), seed + 2, 'h');
  if (k.roof === 'mansard') {
    // Мансарда: крутой нижний скат со слуховыми окнами, пологий верхний — светлее.
    const m = Math.max(10, Math.min(18, Math.round((eave - ridge) * 0.62)));
    slope(ctx, k, X0, ridge, X1, eave - m, c, R.south + 6, row, seed + 3, 'h');
    slope(ctx, k, X0, eave - m, X1, Y1, c, R.south - 3, row, seed + 4, 'h');
    ctx.fillStyle = 'rgba(255,248,236,0.28)';
    ctx.fillRect(X0, eave - m, X1 - X0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(X0, eave - m + 1, X1 - X0, 1);
  } else slope(ctx, k, X0, ridge, X1, Y1, c, R.south, row, seed + 5, 'h');
  if (k.roof === 'hip') {
    // Вальмы: торцевые скаты треугольниками, западный светлее, восточный в тени.
    const hw = Math.min((X1 - X0) / 3, (eave - Y0) * 0.7);
    for (const [ex, sx, dl] of [[X0, 1, 3], [X1, -1, R.hip]] as const) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ex, Y0);
      ctx.lineTo(ex + sx * hw, ridge);
      ctx.lineTo(ex, eave);
      ctx.closePath();
      ctx.clip();
      slope(ctx, k, Math.min(ex, ex + sx * hw) - 1, Y0, Math.max(ex, ex + sx * hw) + 1, eave, c, dl, row, seed + 6 + sx, 'v');
      ctx.restore();
      ctx.strokeStyle = R.ridgeCap;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex, Y0);
      ctx.lineTo(ex + sx * hw, ridge);
      ctx.lineTo(ex, eave);
      ctx.stroke();
    }
    ctx.fillStyle = R.ridgeCap;
    ctx.fillRect(Math.round(X0 + hw), ridge - 1, Math.round(X1 - X0 - 2 * hw), 2);
    ctx.fillStyle = 'rgba(255,240,220,0.18)';
    ctx.fillRect(Math.round(X0 + hw), ridge + 1, Math.round(X1 - X0 - 2 * hw), 1);
  } else {
    // Конёк — коньковая черепица полукругами.
    ctx.fillStyle = R.ridgeCap;
    ctx.fillRect(X0, ridge - 1, X1 - X0, 2);
    ctx.fillStyle = 'rgba(255,240,220,0.2)';
    ctx.fillRect(X0, ridge + 1, X1 - X0, 1);
    for (let x = X0 + 2; x < X1; x += 5) {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x, ridge - 1, 1, 3);
    }
  }
  extras(ctx, k, X0, Y0, X1, Y1, seed);
  for (const x of decor.chimneys) smoke.push(chimney(ctx, k, x, chimneyBase(k, Y0, eave), seed + x));
  if (eave - ridge >= 16) for (const x of decor.dormers) dormer(ctx, k, x, eave, rec);
  return smoke;
}

/** Скат: ряды черепицы (шифера) параллельно свесу с разбросом тона, тень нахлёста; dir — ряды горизонтально или вертикально. */
function slope(ctx: Ctx, k: FacadeKit, X0: number, Y0: number, X1: number, Y1: number, c: Hsl, dl: number, row: number, seed: number, dir: 'h' | 'v'): void {
  if (X1 <= X0 || Y1 <= Y0) return;
  const R = FACADES.roof;
  ctx.fillStyle = col(c, dl);
  ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  if (k.roofMat === 'copper') {
    // Медь: фальцы и пятна патины.
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    if (dir === 'h') for (let x = X0 + 2; x < X1; x += row) ctx.fillRect(x, Y0, 1, Y1 - Y0);
    else for (let y = Y0 + 2; y < Y1; y += row) ctx.fillRect(X0, y, X1 - X0, 1);
    for (let y = Y0; y < Y1; y += 3) for (let x = X0; x < X1; x += 4) if ((hv(x, y, seed) & 7) === 0) {
      ctx.fillStyle = col(c, (hv(x, y, seed + 1) % 7) - 3);
      ctx.fillRect(x, y, 3, 2);
    }
    return;
  }
  const tw = R.tileW[k.roofMat];
  if (dir === 'h') {
    for (let y = Y1 - row, r = 0; y > Y0 - row; y -= row, r++) {
      const off = (r & 1) * (tw >> 1);
      for (let x = X0 - off; x < X1; x += tw) {
        const j = (hv(x, y, seed) % (R.jitter * 2 + 1)) - R.jitter;
        const x0 = Math.max(X0, x);
        const x1 = Math.min(X1, x + tw - 1);
        const y0 = Math.max(Y0, y);
        if (x1 <= x0 || y0 >= Y1) continue;
        ctx.fillStyle = col(c, dl + j * 0.7);
        ctx.fillRect(x0, y0, x1 - x0, Math.min(row - 1, Y1 - y0));
        if (k.roofMat === 'pantile') {
          // Волна голландской черепицы: светлый гребень и тёмный желобок.
          ctx.fillStyle = 'rgba(255,230,200,0.16)';
          ctx.fillRect(x0, y0, Math.min(2, x1 - x0), Math.min(row - 1, Y1 - y0));
          ctx.fillStyle = 'rgba(0,0,0,0.14)';
          if (x1 - x0 >= 4) ctx.fillRect(x1 - 2, y0, 1, Math.min(row - 1, Y1 - y0));
        } else if (k.roofMat === 'tile') {
          ctx.fillStyle = 'rgba(255,230,200,0.1)';
          ctx.fillRect(x0, y0, x1 - x0, 1);
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      if (y + row - 1 < Y1 && y + row - 1 >= Y0) ctx.fillRect(X0, y + row - 1, X1 - X0, 1);
    }
  } else {
    // Ряды вдоль ската к коньку: плитки стыкуются поперёк, швы рядов мягче, чем у ската к улице.
    for (let x = X0, r = 0; x < X1; x += row, r++) {
      const off = (r & 1) * (tw >> 1);
      for (let y = Y0 - off; y < Y1; y += tw) {
        const j = (hv(x, y, seed) % (R.jitter * 2 + 1)) - R.jitter;
        const y0 = Math.max(Y0, y);
        const y1 = Math.min(Y1, y + tw);
        if (y1 <= y0) continue;
        ctx.fillStyle = col(c, dl + j * 0.6);
        ctx.fillRect(x, y0, Math.min(row, X1 - x), y1 - y0);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        if (y + tw - 1 >= Y0 && y + tw - 1 < Y1) ctx.fillRect(x, y + tw - 1, Math.min(row, X1 - x), 1);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      if (x + row - 1 < X1) ctx.fillRect(x + row - 1, Y0, 1, Y1 - Y0);
    }
  }
}

/** Мох на старой черепице, заплаты жести и дыры в кровле Слободы. */
function extras(ctx: Ctx, k: FacadeKit, X0: number, Y0: number, X1: number, Y1: number, seed: number): void {
  const R = FACADES.roof;
  if (k.roofMat === 'tile' || k.roofMat === 'pantile') {
    ctx.fillStyle = R.moss;
    for (let y = Y0 + 1; y < Y1; y += 4) for (let x = X0 + 1; x < X1; x += 4) if (hv(x, y, seed + 7) % 19 === 0) ctx.fillRect(x, y, 3, 1);
  }
  if (k.family !== 'slum') return;
  // Слобода: редкие заплаты из жести разного размера с ржавым потёком и дыры с обломанной черепицей.
  const P = FACADES.roof.patch;
  for (let y = Y0 + 2; y < Y1 - 8; y += P.step + 2) {
    for (let x = X0 + 2; x < X1 - 12; x += P.step + 5) {
      const v = hv(x, y, seed + 9);
      const jx = x + ((v >>> 8) % 5);
      const jy = y + ((v >>> 12) % 4);
      if (v % P.tin === 0) {
        const w = 7 + ((v >>> 4) % 6);
        const h = 4 + ((v >>> 16) % 4);
        ctx.fillStyle = pick(R.tin, x, y, seed);
        ctx.fillRect(jx, jy, w, h);
        // Гофр — светлые полоски поперёк ската, кромка с тенью.
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        for (let i = 1; i < w - 1; i += 2) ctx.fillRect(jx + i, jy, 1, h - 1);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(jx, jy + h - 1, w, 1);
        ctx.fillRect(jx + w - 1, jy, 1, h);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(jx, jy, w - 1, 1);
        // Ржавый потёк вниз по черепице.
        ctx.fillStyle = P.rust;
        const rx = jx + 1 + ((v >>> 20) % Math.max(1, w - 2));
        ctx.fillRect(rx, jy + h, 1, 2 + ((v >>> 24) % 4));
      } else if (v % P.hole === 0) {
        ctx.fillStyle = R.hole;
        ctx.fillRect(jx + 1, jy, 4, 3);
        ctx.fillRect(jx, jy + 1, 1, 1);
        ctx.fillStyle = P.broken;
        ctx.fillRect(jx + 1, jy + 3, 4, 1);
        ctx.fillRect(jx + 5, jy + 1, 1, 2);
      }
    }
  }
}

/** Труба на коньке: кладка, оголовок, горшки, тень на скате. Возвращает точку дыма. */
function chimney(ctx: Ctx, k: FacadeKit, cx: number, ridge: number, seed: number): { x: number; y: number } {
  const C = FACADES.chimney;
  const x0 = cx - (C.w >> 1);
  const h = C.h;
  ctx.fillStyle = C.shadow;
  ctx.fillRect(x0 + 3, ridge - 1, C.w + 2, 4);
  ctx.fillRect(x0 + C.w, ridge - h + 2, 2, h - 2);
  const mat = k.wall === 'stone' ? 'stucco' : k.wall;
  wall(ctx, mat, x0, ridge - h, x0 + C.w, ridge + 2, k.wall === 'stone' ? k.wallColor : k.family === 'london' || k.family === 'slum' || k.family === 'amsterdam' ? k.wallColor : FACADES.brick.amsterdam[0], seed);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x0 + C.w - 2, ridge - h, 2, h + 2);
  ctx.fillStyle = C.top;
  ctx.fillRect(x0 - 1, ridge - h - 2, C.w + 2, 2);
  ctx.fillStyle = C.soot;
  ctx.fillRect(x0, ridge - h, C.w, 1);
  const pots = 1 + (hv(cx, seed, 3) % 3);
  for (let i = 0; i < pots; i++) {
    const px = x0 + 1 + (pots === 1 ? (C.w >> 1) - 1 : Math.round((i * (C.w - 3)) / (pots - 1)));
    ctx.fillStyle = C.pot;
    ctx.fillRect(px, ridge - h - 5, 2, 3);
    ctx.fillStyle = C.potDark;
    ctx.fillRect(px, ridge - h - 5, 2, 1);
  }
  return { x: cx, y: ridge - h - 5 };
}

/** Слуховое окно на южном скате: щёки, лоб с окном, двускатная крышка, тень. */
function dormer(ctx: Ctx, k: FacadeKit, cx: number, eave: number, rec: FacadeRecord | null): void {
  const D = FACADES.dormer;
  const y1 = eave - 3;
  const y0 = y1 - D.h + 2;
  const hw = D.w >> 1;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(cx - hw + 2, y1, D.w, 2);
  const face = k.family === 'london' || k.family === 'grand' ? k.trim : col(k.wallColor, k.wall === 'brick' ? 0 : 2);
  ctx.fillStyle = face;
  ctx.fillRect(cx - hw, y0, D.w, y1 - y0);
  ctx.fillStyle = D.cheek;
  ctx.fillRect(cx + hw, y0 + 1, 2, y1 - y0 - 1);
  const gx = cx - 3;
  const gy = y0 + 2;
  ctx.fillStyle = FACADES.glass.day;
  ctx.fillRect(gx, gy, 6, y1 - y0 - 4);
  ctx.fillStyle = FACADES.glass.dayHi;
  ctx.fillRect(gx, gy, 6, 1);
  bars(ctx, { trim: k.trim, bars: 'cross' }, gx, gy, 6, y1 - y0 - 4);
  rec?.windows.push({ x: gx, y: gy, w: 6, h: y1 - y0 - 4, seed: k.seed, key: 3000 + cx, share: 0.4, curtain: null, bars: 'cross', trim: k.trim, storey: 9, street: eave });
  // Крышка треугольником.
  ctx.fillStyle = col(k.roofColor, -4);
  for (let i = 0; i < 5; i++) ctx.fillRect(cx - hw - 1 + i, y0 - 1 - i, D.w + 2 - i * 2, 1);
  ctx.fillStyle = col(k.roofColor, 6);
  ctx.fillRect(cx - hw - 1, y0 - 1, hw + 1, 1);
}
