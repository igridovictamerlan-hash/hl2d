import { FACADES } from '../config/facades';
import { hash2 } from '../core/rng';
import { windowOn } from './windows';
import { facadeHeight, storeyBands, topHeight, type FacadeKit, type WallMat } from './facadeStyle';

/**
 * Европейский фасад и скатная крыша в виде ¾ (набор деталей — world/facadeStyle.ts): стены — кирпич с перевязкой,
 * штукатурка, руст, камень; окна с откосами, переплётами, подоконниками, перемычками и наличниками, ставни, шторы,
 * цветы; дверь с фрамугой, пилястрами или портиком, ступени и фонарь; витрина лавки с фризом и надписью; карниз с
 * сухариками, парапет или свес; щипцы (ступенчатый, с шеей, колоколом, треугольный); эркер, балкон с решёткой;
 * водосток, копоть, плакаты, бельё. Крыша — ряды черепицы (шифер, медь) с разбросом тона, конёк, вальмы, мансарда,
 * слуховые окна, трубы с горшками. Рисует в пикселях мира (ctx — в масштабе камеры), всё по хэшу дома.
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
  /** Доля суток (ночью горят окна), null — день. */
  night: number | null;
  /** Только горящее (после ночного затемнения). */
  litOnly?: boolean;
}

/** Окно горит ночью: свой час отбоя и утреннего света по хэшу (как окна плана, world/windows.ts). */
function litAt(night: number | null, seed: number, k: number, share = 0.55): boolean {
  if (night === null) return false;
  if (r01(seed, k, 91) >= share) return false;
  const off = 0.9 + r01(seed, k, 92) * 0.22;
  const wake = r01(seed, k, 93) < 0.4 ? 1.22 + r01(seed, k, 94) * 0.06 : -1;
  return windowOn({ off, wake }, night);
}

// ——— Стены ———

/** Кирпич: ряды по 3 px (2 — кирпич, 1 — шов), ложок 4 px, перевязка со сдвигом; тон кирпича — разброс. */
function brick(ctx: Ctx, X0: number, Y0: number, X1: number, Y1: number, c: Hsl, seed: number): void {
  const B = FACADES.brick;
  ctx.fillStyle = B.mortar;
  ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  for (let y = Y0, row = 0; y < Y1; y += 3, row++) {
    const off = (row & 1) * 2;
    for (let x = X0 - off; x < X1; x += 5) {
      const j = (hv(x, y, seed) % (B.jitter * 2 + 1)) - B.jitter;
      ctx.fillStyle = col(c, j * 0.8);
      const x0 = Math.max(X0, x);
      const x1 = Math.min(X1, x + 4);
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
  for (let y = Y0 + 3, k = 0; y < Y1 - 1; y += 3, k++) {
    ctx.fillRect(X0, y, X1 - X0, 1);
    for (let x = X0 + (k & 1) * 4; x < X1; x += 8) ctx.fillRect(x, y - 2, 1, 2);
  }
}

/** Тёсаный камень: блоки 8×4 со швами, тон блока — разброс. */
function stone(ctx: Ctx, X0: number, Y0: number, X1: number, Y1: number, c: Hsl, seed: number): void {
  ctx.fillStyle = FACADES.joint;
  ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  for (let y = Y0, row = 0; y < Y1; y += 4, row++) {
    for (let x = X0 - (row & 1) * 4; x < X1; x += 8) {
      const x0 = Math.max(X0, x);
      const x1 = Math.min(X1, x + 7);
      if (x1 <= x0) continue;
      ctx.fillStyle = col(c, (hv(x, y, seed) % 5) - 2);
      ctx.fillRect(x0, y, x1 - x0, Math.min(3, Y1 - y));
    }
  }
}

function wall(ctx: Ctx, mat: WallMat | 'rustic', X0: number, Y0: number, X1: number, Y1: number, c: Hsl, seed: number): void {
  if (Y1 <= Y0 || X1 <= X0) return;
  if (mat === 'brick') brick(ctx, X0, Y0, X1, Y1, c, seed);
  else if (mat === 'stone') stone(ctx, X0, Y0, X1, Y1, c, seed);
  else stucco(ctx, X0, Y0, X1, Y1, c, seed, mat === 'rustic');
}

// ——— Окна, двери, витрины ———

interface WinOpts {
  lit: boolean;
  curtain: string | null;
  box: boolean;
  shutter: string | null;
  /** 0 — целое, 1 — разбито, 2 — заколочено. */
  damage: 0 | 1 | 2;
}

/** Окно с откосом, рамой, стеклом, переплётом, подоконником и тем, что над ним (перемычка, арка, сандрик…). */
function window_(ctx: Ctx, k: FacadeKit, x: number, y: number, w: number, h: number, o: WinOpts, litOnly: boolean): void {
  const F = FACADES;
  const G = F.glass;
  const gx = x + 1;
  const gy = y + 1;
  const gw = w - 2;
  const gh = h - 2;
  if (litOnly) {
    if (!o.lit || o.damage) return;
    ctx.fillStyle = G.night;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = G.nightHi;
    ctx.fillRect(gx, gy, gw, 1);
    if (o.curtain) {
      ctx.fillStyle = o.curtain;
      ctx.fillRect(gx, gy, 1, gh);
      ctx.fillRect(gx + gw - 1, gy, 1, gh);
    }
    bars(ctx, k, gx, gy, gw, gh);
    return;
  }
  // Наличник Мюнхена — крашеная рамка с «ушами» вокруг всего окна.
  if (k.head === 'surround') {
    ctx.fillStyle = k.trim;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 3);
    ctx.fillRect(x - 3, y - 2, w + 6, 1);
    ctx.fillStyle = F.shade;
    ctx.fillRect(x - 2, y + h + 1, w + 4, 1);
  }
  // Ставни — по бокам, с ламелями.
  if (o.shutter) {
    for (const sx of [x - 3, x + w + 1]) {
      ctx.fillStyle = o.shutter;
      ctx.fillRect(sx, y, 2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let yy = y + 1; yy < y + h; yy += 2) ctx.fillRect(sx, yy, 2, 1);
    }
  }
  // Откос: тень слева и сверху внутри проёма.
  ctx.fillStyle = F.shade;
  ctx.fillRect(x - 1, y - 1, w + 1, 1);
  ctx.fillRect(x - 1, y, 1, h);
  // Рама.
  ctx.fillStyle = k.trim;
  ctx.fillRect(x, y, w, h);
  // Стекло.
  if (o.damage === 2) {
    ctx.fillStyle = G.dark;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = '#6e5233';
    ctx.fillRect(x - 1, y + 1, w + 2, 2);
    ctx.fillRect(x - 1, y + h - 3, w + 2, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 1, y + 2, w + 2, 1);
    ctx.fillRect(x - 1, y + h - 2, w + 2, 1);
  } else {
    ctx.fillStyle = o.damage === 1 ? G.dark : o.lit ? G.night : G.day;
    ctx.fillRect(gx, gy, gw, gh);
    if (o.damage === 1) {
      ctx.fillStyle = G.shine;
      ctx.fillRect(gx, gy, 1, Math.max(1, gh - 2));
      ctx.fillRect(gx + 1, gy, Math.max(1, gw - 2), 1);
    } else {
      ctx.fillStyle = o.lit ? G.nightHi : G.dayHi;
      ctx.fillRect(gx, gy, gw, 1);
      if (!o.lit) {
        ctx.fillStyle = G.shine;
        ctx.fillRect(gx + gw - 1, gy + 1, 1, 1);
        if (gh > 3) ctx.fillRect(gx + gw - 2, gy + 2, 1, 1);
      }
      if (o.curtain) {
        ctx.fillStyle = o.curtain;
        ctx.fillRect(gx, gy, 1, gh);
        ctx.fillRect(gx + gw - 1, gy, 1, gh);
        ctx.fillRect(gx, gy, gw, 1);
      }
      bars(ctx, k, gx, gy, gw, gh);
    }
  }
  // Подоконник и тень под ним.
  ctx.fillStyle = k.trim;
  ctx.fillRect(x - 1, y + h, w + 2, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x - 1, y + h + 1, w + 2, 1);
  // Над окном.
  switch (k.head) {
    case 'lintel':
      ctx.fillStyle = k.trim;
      ctx.fillRect(x - 1, y - 2, w + 2, 1);
      break;
    case 'arch':
      // Лучковая арка из кирпича на ребро: тёмный пояс с поднятой серединой.
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x - 1, y - 2, w + 2, 1);
      ctx.fillRect(x + 1, y - 3, w - 2, 1);
      break;
    case 'keystone':
      ctx.fillStyle = k.trim;
      ctx.fillRect(x - 1, y - 2, w + 2, 1);
      ctx.fillRect(x + (w >> 1) - 1, y - 3, 2, 2);
      break;
    case 'pediment':
      ctx.fillStyle = k.trim;
      ctx.fillRect(x - 2, y - 2, w + 4, 1);
      ctx.fillRect(x - 1, y - 3, w + 2, 1);
      ctx.fillRect(x + 1, y - 4, w - 2, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x - 2, y - 1, w + 4, 1);
      break;
    case 'surround':
      break;
  }
  // Ящик с цветами.
  if (o.box) {
    ctx.fillStyle = '#6e4428';
    ctx.fillRect(x - 1, y + h + 1, w + 2, 2);
    ctx.fillStyle = F.leaf;
    ctx.fillRect(x - 1, y + h, w + 2, 1);
    for (let i = 0; i < w; i += 2) {
      ctx.fillStyle = F.flowers[(hv(x, i, k.seed) >>> 3) % F.flowers.length];
      ctx.fillRect(x + i, y + h - 1, 1, 1);
    }
  }
}

/** Переплёт: подъёмное окно — горбылёк посередине и перекладины, створки — крест с фрамугой. */
function bars(ctx: Ctx, k: FacadeKit, gx: number, gy: number, gw: number, gh: number): void {
  ctx.fillStyle = k.trim;
  if (gw >= 3) ctx.fillRect(gx + (gw >> 1), gy, 1, gh);
  if (k.bars === 'sash') {
    const mid = gy + (gh >> 1);
    ctx.fillRect(gx, mid, gw, 1);
    if (gh >= 7) {
      ctx.fillRect(gx, gy + (gh >> 2), gw, 1);
      ctx.fillRect(gx, mid + ((gh - (gh >> 1)) >> 1), gw, 1);
    }
  } else if (gh >= 4) ctx.fillRect(gx, gy + Math.max(1, Math.round(gh / 3)), gw, 1);
}

/** Дверь в проёме: портал (пилястры, портик или просто рама), створки с филёнками, фрамуга, ступени, фонарь. */
function door(ctx: Ctx, k: FacadeKit, d: Doorway, groundTop: number, bottom: number, glass: boolean, lit: boolean, litOnly: boolean): void {
  const F = FACADES;
  // Дверь лавки — стеклянная, под фризом с вывеской: без портика и фрамуги, чтобы не закрыть надпись.
  const porch = glass ? 'plain' : k.porch;
  const pw = Math.min(d.x1 - d.x0, porch === 'portico' ? 24 : 18);
  const px0 = Math.round((d.x0 + d.x1 - pw) / 2);
  const px1 = px0 + pw;
  const top = groundTop + (glass ? 6 : 1);
  const fan = k.fanlight && !glass ? 4 : 0;
  const leafTop = top + 1 + fan;
  const lx0 = px0 + 2;
  const lx1 = px1 - 2;
  if (litOnly) {
    if (!lit) return;
    ctx.fillStyle = F.glass.night;
    if (fan) ctx.fillRect(lx0 + 1, top + 1, lx1 - lx0 - 2, fan - 1);
    if (glass) ctx.fillRect(lx0 + 1, leafTop + 1, lx1 - lx0 - 2, Math.max(2, ((bottom - leafTop) >> 1) - 1));
    lantern(ctx, px1 + 2, top + 3, true, true);
    return;
  }
  // Портал.
  ctx.fillStyle = F.shade;
  ctx.fillRect(px0, top, pw, bottom - top);
  if (porch === 'portico') {
    // Колонны и фронтон над дверью.
    ctx.fillStyle = k.trim;
    ctx.fillRect(px0, top - 1, 3, bottom - top + 1);
    ctx.fillRect(px1 - 3, top - 1, 3, bottom - top + 1);
    ctx.fillRect(px0 - 1, top - 2, pw + 2, 2);
    for (let i = 0; i < 3; i++) ctx.fillRect(px0 + i * 2, top - 3 - i, pw - i * 4, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(px0 + 1, top, 1, bottom - top);
    ctx.fillRect(px1 - 2, top, 1, bottom - top);
  } else if (porch === 'pilasters') {
    ctx.fillStyle = k.trim;
    ctx.fillRect(px0, top, 2, bottom - top);
    ctx.fillRect(px1 - 2, top, 2, bottom - top);
    ctx.fillRect(px0 - 1, top - 1, pw + 2, 2);
  } else {
    ctx.fillStyle = k.trim;
    ctx.fillRect(px0 + 1, top, 1, bottom - top);
    ctx.fillRect(px1 - 2, top, 1, bottom - top);
    ctx.fillRect(px0 + 1, top, pw - 2, 1);
  }
  // Фрамуга — полукругом лучами.
  if (fan) {
    ctx.fillStyle = lit ? F.glass.night : F.glass.day;
    ctx.fillRect(lx0 + 1, top + 1, lx1 - lx0 - 2, fan - 1);
    ctx.fillStyle = k.trim;
    const cx = (lx0 + lx1) >> 1;
    ctx.fillRect(cx, top + 1, 1, fan - 1);
    ctx.fillRect(lx0 + 2, top + fan - 1, 1, 1);
    ctx.fillRect(lx1 - 3, top + fan - 1, 1, 1);
    ctx.fillRect(lx0 + 1, top + fan, lx1 - lx0 - 2, 1);
  }
  // Створки с филёнками.
  ctx.fillStyle = k.door;
  ctx.fillRect(lx0, leafTop, lx1 - lx0, bottom - leafTop);
  const mid = (lx0 + lx1) >> 1;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(mid, leafTop, 1, bottom - leafTop);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (const [a, b] of [[lx0 + 1, mid - 1], [mid + 2, lx1 - 1]] as const) {
    if (b - a < 2) continue;
    if (glass) {
      ctx.fillStyle = lit ? F.glass.night : F.glass.day;
      ctx.fillRect(a, leafTop + 1, b - a, Math.max(2, ((bottom - leafTop) >> 1) - 1));
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
    } else ctx.fillRect(a, leafTop + 1, b - a, Math.max(1, ((bottom - leafTop) >> 1) - 2));
    ctx.fillRect(a, bottom - Math.max(3, (bottom - leafTop) >> 1) + 1, b - a, Math.max(1, ((bottom - leafTop) >> 1) - 2));
  }
  ctx.fillStyle = '#d8b35a';
  ctx.fillRect(mid - 2, leafTop + ((bottom - leafTop) >> 1), 1, 1);
  ctx.fillRect(mid + 2, leafTop + ((bottom - leafTop) >> 1), 1, 1);
  // Ступени на мостовую.
  ctx.fillStyle = 'rgba(214,206,190,0.75)';
  ctx.fillRect(px0 - 1, bottom, pw + 2, 1);
  ctx.fillStyle = 'rgba(190,182,166,0.6)';
  ctx.fillRect(px0 + 1, bottom + 1, pw - 2, 1);
  if (px1 + 4 <= d.x1 + 6) lantern(ctx, px1 + 2, top + 3, lit, false);
}

/** Настенный фонарь: кронштейн и фонарь; ночью — свет вокруг. */
function lantern(ctx: Ctx, x: number, y: number, lit: boolean, glowOnly: boolean): void {
  const L = FACADES.lantern;
  if (lit) {
    const g = ctx.createRadialGradient(x + 1, y + 2, 0, x + 1, y + 2, 9);
    g.addColorStop(0, L.glow);
    g.addColorStop(1, 'rgba(255,205,120,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(x - 8, y - 7, 18, 18);
    ctx.restore();
  }
  if (glowOnly && !lit) return;
  ctx.fillStyle = L.body;
  ctx.fillRect(x - 1, y, 2, 1);
  ctx.fillRect(x, y + 1, 2, 3);
  ctx.fillStyle = lit ? L.glass : '#3a3a34';
  ctx.fillRect(x, y + 2, 2, 1);
}

/** Витрина лавки: пилястры, фриз с надписью, окна в переплёте с товаром, цоколь; дверь — стеклянная. */
function shopfront(ctx: Ctx, k: FacadeKit, X0: number, X1: number, groundTop: number, bottom: number, doors: Doorway[], sign: string, lit: boolean, litOnly: boolean): void {
  const S = FACADES.shop;
  const fascia = pick(S.fascia, k.seed, 3, 7);
  const ft = groundTop + 1;
  const gt = ft + 5;
  const gb = bottom - 3;
  const inDoor = (x: number) => doors.some((d) => x >= d.x0 + 2 && x < d.x1 - 2);
  if (!litOnly) {
    ctx.fillStyle = S.frame;
    ctx.fillRect(X0, ft, X1 - X0, bottom - ft);
    ctx.fillStyle = fascia;
    ctx.fillRect(X0 + 1, ft, X1 - X0 - 2, 4);
    ctx.fillStyle = 'rgba(216,184,96,0.55)';
    ctx.fillRect(X0 + 1, ft, X1 - X0 - 2, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(X0 + 1, ft + 4, X1 - X0 - 2, 1);
    // Надпись на фризе.
    ctx.save();
    ctx.fillStyle = S.letters;
    ctx.font = '600 3.6px "PT Sans Narrow", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sign.toUpperCase(), (X0 + X1) / 2, ft + 2.2, X1 - X0 - 6);
    ctx.restore();
    // Цоколь витрины с филёнками.
    ctx.fillStyle = S.riser;
    ctx.fillRect(X0 + 1, gb, X1 - X0 - 2, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let x = X0 + 3; x < X1 - 4; x += 6) ctx.fillRect(x, gb + 1, 4, 1);
  }
  // Стекло витрин в переплёте, на полке — товар.
  for (let x = X0 + 2; x < X1 - 2; x++) {
    if (inDoor(x)) continue;
    const mull = (x - X0) % 5 === 1;
    if (litOnly) {
      if (!lit || mull) continue;
      ctx.fillStyle = FACADES.glass.night;
      ctx.fillRect(x, gt, 1, gb - gt);
      continue;
    }
    ctx.fillStyle = mull ? S.frame : lit ? FACADES.glass.night : FACADES.glass.day;
    ctx.fillRect(x, gt, 1, gb - gt);
    if (!mull) {
      ctx.fillStyle = pick(S.goods, x, k.seed, 11);
      ctx.fillRect(x, gb - 2, 1, 2 - (hv(x, k.seed, 13) & 1));
    }
  }
  if (!litOnly) {
    ctx.fillStyle = FACADES.glass.dayHi;
    ctx.fillRect(X0 + 2, gt, X1 - X0 - 4, 1);
  }
}

// ——— Верх фасада ———

function cornice(ctx: Ctx, k: FacadeKit, X0: number, X1: number, y: number): void {
  ctx.fillStyle = k.trim;
  ctx.fillRect(X0, y, X1 - X0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(X0, y + 1, X1 - X0, 1);
  ctx.fillStyle = k.trim;
  for (let x = X0 + 1; x < X1; x += 2) ctx.fillRect(x, y + 2, 1, 1);
  ctx.fillStyle = FACADES.shade;
  ctx.fillRect(X0, y + 3, X1 - X0, 1);
}

/** Пояс между этажами: светлая тяга и тень под ней. */
function band(ctx: Ctx, k: FacadeKit, X0: number, X1: number, y: number): void {
  ctx.fillStyle = k.trim;
  ctx.fillRect(X0, y, X1 - X0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(X0, y + 1, X1 - X0, 1);
}

/** Щипец над фасадом шириной X0..X1 от линии top вверх: силуэт, кладка, белый камень по краю, окно, балка. */
export function gable(ctx: Ctx, k: FacadeKit, X0: number, X1: number, top: number): void {
  const S = FACADES.size;
  const W = X1 - X0;
  const G = Math.max(S.gableMin, Math.min(S.gableMax, Math.round(W * 0.45)));
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
    pts.push([X0, top], [X0, top - 2], [cx - nw / 2, top - G * 0.5], [cx - nw / 2, top - G + 3], [cx, top - G], [cx + nw / 2, top - G + 3], [cx + nw / 2, top - G * 0.5], [X1, top - 2], [X1, top]);
  } else {
    // Колокол: плавные плечи к узкому верху с карнизом.
    const n = 10;
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
  // Окно чердака и балка для подъёма грузов.
  const ww = Math.max(3, k.win - 1);
  window_(ctx, k, Math.round(cx - ww / 2), Math.round(top - G * 0.62), ww, 5, { lit: false, curtain: null, box: false, shutter: null, damage: 0 }, false);
  ctx.restore();
  // Белый камень по краю (кромка щипца).
  ctx.save();
  ctx.strokeStyle = k.trim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pts[0][0] + 0.5, pts[0][1]);
  for (const [x, y] of pts.slice(1, -1)) ctx.lineTo(x + (x < cx ? 0.5 : -0.5), y + 0.5);
  ctx.lineTo(pts[pts.length - 1][0] - 0.5, pts[pts.length - 1][1]);
  ctx.stroke();
  ctx.restore();
  if (k.top === 'neck') {
    // Завитки на плечах шеи.
    ctx.fillStyle = k.trim;
    for (const sx of [-1, 1]) {
      const bx = cx + sx * (W * 0.21 + 1);
      ctx.fillRect(Math.round(bx - 1), Math.round(top - G * 0.5), 2, 2);
      ctx.fillRect(Math.round(bx + sx * 3), Math.round(top - G * 0.32), 2, 2);
    }
  }
  if (k.family === 'amsterdam') {
    ctx.fillStyle = '#2a1f16';
    ctx.fillRect(Math.round(cx), Math.round(top - G + 1), 1, 3);
    ctx.fillRect(Math.round(cx) - 1, Math.round(top - G + 1), 3, 1);
  }
}

/** Оси окон фасада X0..X1: сколько влезает с шагом семейства, поровну по ширине (центры, пиксели мира). */
export function bayCenters(k: FacadeKit, X0: number, X1: number): number[] {
  const W = X1 - X0 - 6;
  const n = Math.max(1, Math.round(W / k.bay));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round(X0 + 3 + ((i + 0.5) * W) / n));
  return out;
}

/** Фасад целиком: стены по этажам, пояса, окна по осям, дверь или витрина, эркер, балкон, верх, мелочи. */
export function paintFacade(ctx: Ctx, k: FacadeKit, s: FacadeSpec): void {
  const F = FACADES;
  const S = F.size;
  const { X0, X1, bottom } = s;
  const W = X1 - X0;
  if (W < 6) return;
  const lo = !!s.litOnly;
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
  const seed = k.seed + X0 * 13;
  // Стены.
  if (!lo) {
    wall(ctx, k.ground, X0, groundTop, X1, bottom, k.groundColor, seed);
    wall(ctx, k.wall, X0, upperTop, X1, groundTop, k.wallColor, seed + 1);
    ctx.fillStyle = 'rgba(30,24,20,0.45)';
    ctx.fillRect(X0, bottom - 2, W, 2);
    if (s.storeys > 1) band(ctx, k, X0, X1, groundTop);
    if (k.family === 'grand' || k.family === 'civic' || k.family === 'london') for (let st = 2; st < s.storeys; st++) band(ctx, k, X0, X1, sb[st]);
  }
  const xs = bayCenters(k, X0, X1);
  const ww = k.win;
  const shopLit = s.sign !== null && litAt(s.night, seed, 999, 0.9);
  // Первый этаж: витрина лавки или окна, дверь.
  if (s.sign) shopfront(ctx, k, X0, X1, groundTop, bottom, s.doors, s.sign, shopLit, lo);
  else {
    xs.forEach((cx, i) => {
      const x = cx - (ww >> 1);
      if (s.doors.some((d) => x + ww + 2 > d.x0 + 3 && x - 2 < d.x1 - 3)) return;
      window_(ctx, k, x, groundTop + 3, ww, bands[0] - 7, winOpts(k, s.night, seed, i, 0), lo);
    });
  }
  for (const d of s.doors) door(ctx, k, d, groundTop, bottom, s.sign !== null, s.sign ? shopLit : litAt(s.night, seed, 777 + d.x0, 0.4), lo);
  // Этажи выше: окна по осям, на бельэтаже — балкон.
  const orielW = k.oriel && s.storeys >= 3 && xs.length >= 3 ? Math.round(W * 0.34) : 0;
  const ox0 = Math.round((X0 + X1 - orielW) / 2);
  for (let st = 1; st < s.storeys; st++) {
    const stTop = sb[st] - bands[st];
    const attic = st === s.storeys - 1 && k.family === 'amsterdam' && s.storeys >= 4;
    const wh = bands[st] - (attic ? 6 : 4);
    xs.forEach((cx, i) => {
      if (orielW && cx > ox0 - 2 && cx < ox0 + orielW + 2) return;
      window_(ctx, k, cx - (ww >> 1), stTop + 2, ww, wh, winOpts(k, s.night, seed, i, st), lo);
    });
    if (st === 1 && k.balcony && (k.family === 'london' || k.family === 'grand') && !lo) {
      const bx0 = xs.length >= 3 ? xs[0] - (ww >> 1) - 2 : X0 + 2;
      const bx1 = xs.length >= 3 ? xs[xs.length - 1] + (ww >> 1) + 3 : X1 - 2;
      ctx.fillStyle = k.trim;
      ctx.fillRect(bx0, sb[1] - 1, bx1 - bx0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(bx0, sb[1], bx1 - bx0, 1);
      ctx.fillStyle = F.iron;
      ctx.fillRect(bx0, sb[1] - 5, bx1 - bx0, 1);
      for (let x = bx0; x < bx1; x += 2) ctx.fillRect(x, sb[1] - 4, 1, 3);
    }
  }
  // Эркер: выступ через этажи выше первого, с окнами, крышкой и кронштейном снизу; тень на стене справа.
  if (orielW) {
    const oTop = upperTop + 2;
    const oBot = groundTop - 1;
    if (!lo) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(ox0 + orielW, oTop + 2, 2, oBot - oTop);
      wall(ctx, k.wall, ox0, oTop, ox0 + orielW, oBot, { h: k.wallColor.h, s: k.wallColor.s, l: k.wallColor.l + 3 }, seed + 9);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(ox0, oTop, 2, oBot - oTop);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(ox0 + orielW - 2, oTop, 2, oBot - oTop);
      const cap = k.roofMat === 'copper' ? k.roofColor : F.roof.copper[0];
      ctx.fillStyle = col(cap, -6);
      ctx.fillRect(ox0 - 1, oTop - 2, orielW + 2, 2);
      ctx.fillStyle = col(cap, 6);
      ctx.fillRect(ox0 + 1, oTop - 4, orielW - 2, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      for (let i = 0; i < 3; i++) ctx.fillRect(ox0 + 2 + i * 2, oBot + i, orielW - 4 - i * 4, 1);
    }
    const n2 = Math.max(2, Math.round(orielW / 11));
    for (let st = 1; st < s.storeys; st++) {
      const stTop = sb[st] - bands[st];
      for (let i = 0; i < n2; i++) {
        const cx = Math.round(ox0 + ((i + 0.5) * orielW) / n2);
        window_(ctx, k, cx - ((ww - 1) >> 1), stTop + 2, ww - 1, bands[st] - 4, winOpts(k, s.night, seed, 50 + i, st), lo);
      }
    }
  }
  if (lo) return;
  // Верх фасада.
  if (!s.gable) {
    if (k.top === 'parapet') {
      wall(ctx, k.wall === 'brick' ? 'brick' : 'stucco', X0, top, X1, top + S.parapet, k.wallColor, seed + 3);
      ctx.fillStyle = k.trim;
      ctx.fillRect(X0, top, W, 1);
      cornice(ctx, k, X0, X1, top + S.parapet - 3);
    } else if (k.top === 'cornice') cornice(ctx, k, X0, X1, top);
    else {
      // Свес крыши: водосток, тень под ним, у Мюнхена — концы стропил.
      ctx.fillStyle = F.roof.gutter;
      ctx.fillRect(X0, top, W, 1);
      ctx.fillStyle = F.shade;
      ctx.fillRect(X0, top + 1, W, 1);
      if (k.family === 'munich') {
        ctx.fillStyle = '#4a3020';
        for (let x = X0 + 1; x < X1; x += 3) ctx.fillRect(x, top + 1, 1, 1);
      }
    }
  } else {
    ctx.fillStyle = k.trim;
    ctx.fillRect(X0, top + topH - 1, W, 1);
  }
  // Водостоки по краям.
  if (k.family !== 'civic' && k.family !== 'grand') {
    ctx.fillStyle = F.pipe;
    for (const px of [X0 + 1, X1 - 2]) {
      ctx.fillRect(px, top + 1, 1, H - 1);
      for (let y = top + 4; y < bottom - 2; y += 7) ctx.fillRect(px - 1, y, 3, 1);
    }
  }
  // Полотнища Протектората между осями.
  if (k.banners && xs.length >= 4 && s.storeys >= 2) {
    for (const i of [0, xs.length - 2]) {
      const bx = Math.round((xs[i] + xs[i + 1]) / 2) - 2;
      const by = upperTop + 2;
      const bh = groundTop - upperTop - 4;
      ctx.fillStyle = F.banner.cloth;
      ctx.fillRect(bx, by, 5, bh);
      ctx.fillStyle = F.banner.edge;
      ctx.fillRect(bx, by, 5, 1);
      ctx.fillRect(bx + 4, by + 1, 1, bh - 1);
      ctx.fillStyle = F.banner.mark;
      ctx.fillRect(bx + 1, by + 4, 3, 3);
      ctx.fillStyle = F.banner.cloth;
      ctx.fillRect(bx + 2, by + 5, 1, 1);
    }
  }
  // Плакаты на первом этаже, бельё на верёвке между окнами.
  if (k.posters && !s.sign) {
    const px = X0 + 3 + (hv(seed, 1, 5) % Math.max(1, W - 10));
    ctx.fillStyle = pick(F.posters, seed, 2, 5);
    ctx.fillRect(px, groundTop + 4, 5, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px + 1, groundTop + 6, 3, 1);
    ctx.fillRect(px + 1, groundTop + 8, 2, 1);
  }
  if (k.laundry && s.storeys >= 2 && xs.length >= 2) {
    const ly = sb[1] - bands[1] + 1;
    const lx0 = xs[0] + (ww >> 1) + 1;
    const lx1 = xs[1] - (ww >> 1) - 1;
    ctx.fillStyle = 'rgba(30,30,30,0.6)';
    ctx.fillRect(lx0, ly, lx1 - lx0, 1);
    for (let x = lx0 + 1; x < lx1 - 2; x += 3) {
      ctx.fillStyle = pick(F.laundry, x, seed, 9);
      ctx.fillRect(x, ly + 1, 2, 3 + (hv(x, seed, 10) & 1));
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
        if ((hv(i, st, seed) & 3) === 0) ctx.fillRect(cx - 1, sb[st] - 1, 1, 2 + (hv(i, st, seed + 1) & 3));
      });
    }
  }
}

function winOpts(k: FacadeKit, night: number | null, seed: number, i: number, st: number): WinOpts {
  const key = i * 11 + st * 101;
  const F = FACADES;
  const dmg = r01(seed, key, 61);
  const damage: 0 | 1 | 2 = dmg < k.broken * 0.45 ? 2 : dmg < k.broken ? 1 : 0;
  return {
    lit: litAt(night, seed, key),
    curtain: r01(seed, key, 62) < k.curtains ? pick(F.curtains, seed, key, 63) : null,
    box: st > 0 && r01(seed, key, 64) < k.boxes,
    shutter: k.shutters && (k.family !== 'slum' || r01(seed, key, 65) < 0.5) ? k.shutters : null,
    damage,
  };
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
 */
export function paintRoof(ctx: Ctx, k: FacadeKit, X0: number, Y0: number, X1: number, Y1: number, eave: number, decor: RoofDecor, night: number | null): void {
  const R = FACADES.roof;
  const c = k.roofColor;
  const row = R.row[k.roofMat];
  const seed = k.seed + 31;
  if (k.roof === 'ns') {
    const rx = Math.round((X0 + X1) / 2);
    slope(ctx, k, X0, Y0, rx, Y1, c, R.south + 3, row, seed, 'v');
    slope(ctx, k, rx, Y0, X1, Y1, c, R.north + 2, row, seed + 1, 'v');
    ctx.fillStyle = R.ridgeCap;
    ctx.fillRect(rx - 1, Y0, 1, Y1 - Y0);
    ctx.fillStyle = 'rgba(255,240,220,0.18)';
    ctx.fillRect(rx, Y0, 1, Y1 - Y0);
    extras(ctx, k, X0, Y0, X1, Y1, seed);
    for (const x of decor.chimneys) chimney(ctx, k, x, Y0 + Math.max(4, Math.round((eave - Y0) * 0.25)), seed + x);
    return;
  }
  const ridge = Math.min(eave - 3, Y0 + Math.max(3, Math.round((eave - Y0) * R.ridge)));
  slope(ctx, k, X0, Y0, X1, ridge, c, R.north, Math.max(2, row - 1), seed + 2, 'h');
  if (k.roof === 'mansard') {
    // Мансарда: крутой нижний скат со слуховыми окнами, пологий верхний — светлее.
    const m = Math.max(6, Math.min(11, Math.round((eave - ridge) * 0.62)));
    slope(ctx, k, X0, ridge, X1, eave - m, c, R.south + 6, row, seed + 3, 'h');
    slope(ctx, k, X0, eave - m, X1, Y1, c, R.south - 3, row, seed + 4, 'h');
    ctx.fillStyle = 'rgba(255,248,236,0.25)';
    ctx.fillRect(X0, eave - m, X1 - X0, 1);
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
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ex, Y0);
      ctx.lineTo(ex + sx * hw, ridge);
      ctx.lineTo(ex, eave);
      ctx.stroke();
    }
    ctx.fillStyle = R.ridgeCap;
    ctx.fillRect(Math.round(X0 + hw), ridge - 1, Math.round(X1 - X0 - 2 * hw), 1);
    ctx.fillStyle = 'rgba(255,240,220,0.18)';
    ctx.fillRect(Math.round(X0 + hw), ridge, Math.round(X1 - X0 - 2 * hw), 1);
  } else {
    ctx.fillStyle = R.ridgeCap;
    ctx.fillRect(X0, ridge - 1, X1 - X0, 1);
    ctx.fillStyle = 'rgba(255,240,220,0.18)';
    ctx.fillRect(X0, ridge, X1 - X0, 1);
    for (let x = X0 + 2; x < X1; x += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, ridge - 1, 1, 2);
    }
  }
  extras(ctx, k, X0, Y0, X1, Y1, seed);
  for (const x of decor.chimneys) chimney(ctx, k, x, ridge, seed + x);
  if (eave - ridge >= 10) for (const x of decor.dormers) dormer(ctx, k, x, eave, litAt(night, seed, x, 0.4));
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
    if (dir === 'h') for (let x = X0 + 1; x < X1; x += 3) ctx.fillRect(x, Y0, 1, Y1 - Y0);
    else for (let y = Y0 + 1; y < Y1; y += 3) ctx.fillRect(X0, y, X1 - X0, 1);
    for (let y = Y0; y < Y1; y += 3) for (let x = X0; x < X1; x += 4) if ((hv(x, y, seed) & 7) === 0) {
      ctx.fillStyle = col(c, (hv(x, y, seed + 1) % 7) - 3);
      ctx.fillRect(x, y, 3, 2);
    }
    return;
  }
  const tw = k.roofMat === 'slate' ? 3 : 4;
  if (dir === 'h') {
    for (let y = Y1 - row, r = 0; y > Y0 - row; y -= row, r++) {
      const off = (r & 1) * (tw >> 1);
      for (let x = X0 - off; x < X1; x += tw) {
        const j = (hv(x, y, seed) % (R.jitter * 2 + 1)) - R.jitter;
        const x0 = Math.max(X0, x);
        const x1 = Math.min(X1, x + tw - (k.roofMat === 'slate' ? 0 : 1));
        const y0 = Math.max(Y0, y);
        if (x1 <= x0 || y0 >= Y1) continue;
        ctx.fillStyle = col(c, dl + j * 0.7);
        ctx.fillRect(x0, y0, x1 - x0, Math.min(row - 1, Y1 - y0));
        if (k.roofMat === 'pantile') {
          ctx.fillStyle = 'rgba(255,230,200,0.12)';
          ctx.fillRect(x0, y0, 1, Math.min(row - 1, Y1 - y0));
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
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
    for (let y = Y0 + 1; y < Y1; y += 3) for (let x = X0 + 1; x < X1; x += 3) if (hv(x, y, seed + 7) % 23 === 0) ctx.fillRect(x, y, 2, 1);
  }
  if (k.family !== 'slum') return;
  // Слобода: редкие заплаты из жести разного размера с ржавым потёком и дыры с обломанной черепицей.
  const P = FACADES.roof.patch;
  for (let y = Y0 + 2; y < Y1 - 6; y += P.step) {
    for (let x = X0 + 2; x < X1 - 10; x += P.step + 3) {
      const v = hv(x, y, seed + 9);
      const jx = x + (v >>> 8) % 4;
      const jy = y + (v >>> 12) % 3;
      if (v % P.tin === 0) {
        const w = 5 + ((v >>> 4) % 5);
        const h = 3 + ((v >>> 16) % 3);
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
        ctx.fillRect(rx, jy + h, 1, 1 + ((v >>> 24) % 3));
      } else if (v % P.hole === 0) {
        ctx.fillStyle = R.hole;
        ctx.fillRect(jx + 1, jy, 3, 2);
        ctx.fillRect(jx, jy + 1, 1, 1);
        ctx.fillStyle = P.broken;
        ctx.fillRect(jx + 1, jy + 2, 3, 1);
        ctx.fillRect(jx + 4, jy + 1, 1, 1);
      }
    }
  }
}

/** Труба на коньке: кладка, оголовок, горшки, тень на скате. */
function chimney(ctx: Ctx, k: FacadeKit, cx: number, ridge: number, seed: number): void {
  const C = FACADES.chimney;
  const x0 = cx - 2;
  const h = 6;
  ctx.fillStyle = C.shadow;
  ctx.fillRect(x0 + 2, ridge - 1, 6, 3);
  ctx.fillRect(x0 + 5, ridge - h + 1, 2, h - 2);
  const mat = k.wall === 'stone' ? 'stucco' : k.wall;
  wall(ctx, mat, x0, ridge - h, x0 + 5, ridge + 1, k.wall === 'stone' ? k.wallColor : k.family === 'london' || k.family === 'slum' || k.family === 'amsterdam' ? k.wallColor : FACADES.brick.amsterdam[0], seed);
  ctx.fillStyle = C.top;
  ctx.fillRect(x0 - 1, ridge - h - 1, 7, 1);
  ctx.fillStyle = C.soot;
  ctx.fillRect(x0, ridge - h, 5, 1);
  const pots = 1 + (hv(cx, seed, 3) % 3);
  for (let i = 0; i < pots; i++) {
    const px = x0 + (pots === 1 ? 2 : i * 2);
    ctx.fillStyle = C.pot;
    ctx.fillRect(px, ridge - h - 3, 1, 2);
    ctx.fillStyle = C.potDark;
    ctx.fillRect(px, ridge - h - 3, 1, 1);
  }
}

/** Слуховое окно на южном скате: щёки, лоб с окном, двускатная крышка, тень. */
function dormer(ctx: Ctx, k: FacadeKit, cx: number, eave: number, lit: boolean): void {
  const D = FACADES.dormer;
  const y1 = eave - 2;
  const y0 = y1 - 6;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(cx - 2, y1, 8, 1);
  const face = k.family === 'london' || k.family === 'grand' ? k.trim : col(k.wallColor, k.wall === 'brick' ? 0 : 2);
  ctx.fillStyle = face;
  ctx.fillRect(cx - 3, y0, 7, 6);
  ctx.fillStyle = D.cheek;
  ctx.fillRect(cx + 4, y0 + 1, 1, 5);
  ctx.fillStyle = lit ? FACADES.glass.night : FACADES.glass.day;
  ctx.fillRect(cx - 2, y0 + 1, 5, 4);
  ctx.fillStyle = k.trim;
  ctx.fillRect(cx, y0 + 1, 1, 4);
  ctx.fillRect(cx - 2, y0 + 3, 5, 1);
  // Крышка: треугольником (у мансарды — лучковый сандрик).
  ctx.fillStyle = col(k.roofColor, -4);
  for (let i = 0; i < 4; i++) ctx.fillRect(cx - 4 + i, y0 - 1 - i, 9 - i * 2, 1);
  ctx.fillStyle = col(k.roofColor, 6);
  ctx.fillRect(cx - 4, y0 - 1, 4, 1);
}
