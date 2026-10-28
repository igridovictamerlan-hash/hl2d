/**
 * Пиксельный рисовальщик тела пешки (без DOM): ноги по позе (стоит, шаг, бег, присел, сидит), корпус с одеждой,
 * формой и бронёй, руки по бокам (машут в шаг), голова с лицом, причёской, убором и маской. Стороны S, E, N
 * (W — зеркало E). Руки к оружию и к делу рисует сборщик (pixelPawn) — здесь только «опущенные» руки по флагам.
 * Координаты — силуэта 24×36: центр x = 12, подошвы y = 34 (PIXEL.cx, PIXEL.ground).
 */
import { PIXEL } from '../../config/pixelPawns';
import { Grid, line, part, shade, type Pattern } from './grid';
import type { HeadGear, PixelSpec } from './pixelSpec';

export type BodyDir = 'S' | 'E' | 'N';
export type Legs = 'stand' | 'walk' | 'run' | 'crouch' | 'sit';

export interface BodyPose {
  legs: Legs;
  /** Кадр шага или бега. */
  frame: number;
  /** Руки по бокам: ARM_A — левая на экране (сбоку — ближняя), ARM_B — правая (сбоку — дальняя). */
  arms: number;
  blink: boolean;
  talk: boolean;
}
export const ARM_A = 1;
export const ARM_B = 2;

const C = PIXEL.color;
const INK = C.ink;
const GLASS = C.glass;

export function newGrid(): Grid {
  const g = new Grid(PIXEL.grid.w, PIXEL.grid.h);
  g.ox = PIXEL.grid.ox;
  g.oy = PIXEL.grid.oy;
  return g;
}

/** Фаза шага по кадру: sin и cos. */
function phase(pose: BodyPose): [number, number] {
  if (pose.legs !== 'walk' && pose.legs !== 'run') return [0, 0];
  const n = pose.legs === 'run' ? PIXEL.runFrames : PIXEL.walkFrames;
  const a = (2 * Math.PI * pose.frame) / n;
  return [Math.sin(a), Math.cos(a)];
}

/** Сдвиг корпуса (пиксели силуэта): выше на проходе ноги, на бегу — ещё и вперёд; присел и сел — ниже. */
export function upperOffset(dir: BodyDir, pose: BodyPose): [number, number] {
  if (pose.legs === 'crouch') return [0, 4];
  if (pose.legs === 'sit') return [0, 3];
  // Стоит: кадр 1 — выдох (корпус на пиксель ниже).
  if (pose.legs === 'stand') return [0, pose.frame === 1 ? 1 : 0];
  const [sw] = phase(pose);
  const run = pose.legs === 'run';
  return [run && dir === 'E' ? 1 : 0, -Math.round((1 - Math.abs(sw)) * (run ? 2 : 1))];
}

/** Плечи (откуда руки): S/N — левое и правое на экране; E — ближнее и дальнее. */
export function shoulders(dir: BodyDir): [[number, number], [number, number]] {
  return dir === 'E' ? [[12, 15], [11, 14]] : [[5, 14], [17, 14]];
}

/** Цвет рукава: майка без верха — голые руки. */
export function sleeveOf(sp: PixelSpec): string {
  return sp.topKind === 'undershirt' && !sp.outer ? sp.skin : sp.sleeve;
}

/** Камуфляж — пятнами по клетке 2×2 (одинаково со всех сторон). */
function camoOf(sp: PixelSpec): Pattern | undefined {
  const cols = sp.camo;
  if (!cols || !cols.length) return undefined;
  return (x, y) => {
    const h = ((Math.floor(x / 2) * 73856093) ^ (Math.floor(y / 2) * 19349663)) >>> 0;
    const v = h % (cols.length + 4);
    return v < cols.length ? cols[v] : null;
  };
}
/** Узор ткани без верха: полоски, клетка, вязка, ромбы. */
function topPattern(sp: PixelSpec): Pattern | undefined {
  const b = sp.pattern2;
  switch (sp.pattern) {
    case 'stripes': return (_x, y) => (y % 2 ? b : null);
    case 'plaid': return (x, y) => (x % 3 === 0 || y % 3 === 0 ? b : null);
    case 'knit': return (x) => (x % 2 ? shade(sp.top, -0.12) : null);
    case 'argyle': return (x, y) => ((x + y) % 4 === 0 || (x - y + 40) % 4 === 0 ? b : null);
    default: return undefined;
  }
}
/** Верх до колен: пальто, шинель, халат, роба, тренч, шуба. */
function longOuter(sp: PixelSpec): boolean {
  const o = sp.outer;
  return o === 'ragcoat' || o === 'trench' || o === 'camel' || o === 'fur' || o === 'greatcoat' || o === 'labcoat' || o === 'robe';
}
/** Распахнутый верх: видна рубашка или свитер посередине. */
function openOuter(sp: PixelSpec): boolean {
  const o = sp.outer;
  return o === 'cardigan' || o === 'blazer' || o === 'suit' || o === 'tux' || o === 'greatcoat' || o === 'labcoat' || o === 'camel' || o === 'suitcoat';
}
function lapels(sp: PixelSpec): boolean {
  const o = sp.outer;
  return o === 'blazer' || o === 'suit' || o === 'tux' || o === 'suitcoat';
}

// ——— Ноги ———
function legsSN(g: Grid, sp: PixelSpec, pose: BodyPose): void {
  const pat = camoOf(sp);
  const P = sp.pants;
  const B = sp.boots;
  if (pose.legs === 'crouch') {
    part(g, 7, 26, 4, 5, P, false, pat);
    part(g, 13, 26, 4, 5, P, false, pat);
    part(g, 6, 31, 5, 3, B, true);
    part(g, 13, 31, 5, 3, B, true);
    return;
  }
  if (pose.legs === 'sit') {
    part(g, 8, 25, 4, 3, shade(P, 0.08), false, pat);
    part(g, 12, 25, 4, 3, shade(P, 0.08), false, pat);
    part(g, 8, 28, 4, 3, P, false, pat);
    part(g, 12, 28, 4, 3, P, false, pat);
    part(g, 7, 31, 5, 2, B, true);
    part(g, 12, 31, 5, 2, B, true);
    return;
  }
  const [sw] = phase(pose);
  const amp = pose.legs === 'run' ? PIXEL.stride.sideRunLift : PIXEL.stride.sideLift;
  const liftL = sw > 0 ? Math.round(sw * amp) : 0;
  const liftR = sw < 0 ? Math.round(-sw * amp) : 0;
  part(g, 8, 22, 4, 9 - liftL, P, false, pat);
  part(g, 12, 22, 4, 9 - liftR, P, false, pat);
  part(g, 7, 31 - liftL, 5, 3, B, true);
  part(g, 12, 31 - liftR, 5, 3, B, true);
}

/** Нога сбоку: от бедра, ступня смещена на off (наклон по строкам), поднята на lift. */
function legE(g: Grid, sp: PixelSpec, hip: number, off: number, lift: number, far: boolean, pat?: Pattern): void {
  const k = far ? PIXEL.shade.far : 0;
  const rows = 9 - lift;
  for (let j = 0; j < rows; j++) {
    const sh = Math.round((off * j) / 8);
    for (let i = 0; i < 4; i++) {
      const base = pat?.(hip + sh + i, 22 + j) ?? sp.pants;
      const e = i === 0 ? 0.12 : i === 3 ? -0.2 : 0;
      g.set(hip + sh + i, 22 + j, shade(base, Math.round((k + e) * 100) / 100));
    }
  }
  part(g, hip + off, 31 - lift, 6, 3, shade(sp.boots, k), true);
}
function legsE(g: Grid, sp: PixelSpec, pose: BodyPose): void {
  const pat = camoOf(sp);
  const far = (c: string) => shade(c, PIXEL.shade.far);
  if (pose.legs === 'crouch') {
    part(g, 9, 27, 3, 4, far(sp.pants), false);
    part(g, 7, 31, 5, 3, far(sp.boots), true);
    part(g, 10, 26, 6, 3, sp.pants, false, pat);
    part(g, 13, 28, 3, 3, sp.pants, false, pat);
    part(g, 13, 31, 6, 3, sp.boots, true);
    return;
  }
  if (pose.legs === 'sit') {
    part(g, 10, 26, 7, 2, far(sp.pants));
    part(g, 10, 25, 8, 3, sp.pants, false, pat);
    part(g, 15, 27, 3, 4, sp.pants, false, pat);
    part(g, 15, 31, 5, 2, sp.boots, true);
    return;
  }
  const [sw, cw] = phase(pose);
  const run = pose.legs === 'run';
  const amp = run ? PIXEL.stride.run : PIXEL.stride.walk;
  const lift = run ? PIXEL.stride.runLift : PIXEL.stride.lift;
  const fo = Math.round(sw * amp);
  legE(g, sp, 11, -fo, cw < 0 ? Math.round(-cw * lift) : 0, true, pat);
  legE(g, sp, 10, fo, cw > 0 ? Math.round(cw * lift) : 0, false, pat);
}

// ——— Руки по бокам ———
/** Повязка, нашивка и шевроны на рукаве (строки от плеча). */
function sleeveMarks(u: Grid, sp: PixelSpec, x: number, y: number, w: number, left: boolean): void {
  if (left && sp.band) u.rect(x, y + 2, w, 2, sp.band);
  if (!left && sp.patch) u.set(x + (w > 2 ? 1 : 0), y + 1, sp.patch);
  if (sp.acc.has('chevrons')) { u.rect(x, y + 3, w, 1, sp.trim); u.rect(x, y + 5, w, 1, sp.trim); }
  if (!left && sp.acc.has('medic')) { u.rect(x, y + 2, w, 2, '#f2f2f2'); u.set(x + (w > 2 ? 1 : 0), y + 2, '#c93030'); }
}
function restArmsSN(u: Grid, sp: PixelSpec, pose: BodyPose, back: boolean): void {
  const [sw] = phase(pose);
  const run = pose.legs === 'run';
  const a = Math.round(sw * (run ? 2 : 1));
  const base = run ? 7 : pose.legs === 'crouch' || pose.legs === 'sit' ? 7 : 9;
  const col = sleeveOf(sp);
  const pat = camoOf(sp);
  if (pose.arms & ARM_A) {
    const L = base - (back ? -a : a);
    part(u, 5, 14, 2, L, col, false, pat);
    sleeveMarks(u, sp, 5, 14, 2, !back);
    part(u, 5, 14 + L, 2, 2, sp.hand);
  }
  if (pose.arms & ARM_B) {
    const L = base + (back ? -a : a);
    part(u, 17, 14, 2, L, col, false, pat);
    sleeveMarks(u, sp, 17, 14, 2, back);
    part(u, 17, 14 + L, 2, 2, sp.hand);
  }
}
/** Рука сбоку: от плеча, кисть смещена на hx. */
function armE(u: Grid, sp: PixelSpec, hx: number, len: number, far: boolean): void {
  const k = far ? -0.3 : 0;
  const col = sleeveOf(sp);
  const pat = camoOf(sp);
  for (let j = 0; j < len; j++) {
    const sh = Math.round((hx * j) / (len - 1));
    for (let i = 0; i < 3; i++) {
      const base = pat?.(11 + sh + i, 14 + j) ?? col;
      const e = i === 0 ? 0.12 : i === 2 ? -0.2 : 0;
      u.set(11 + sh + i, 14 + j, shade(base, Math.round((k + e) * 100) / 100));
    }
  }
  if (!far) sleeveMarks(u, sp, 11, 14, 3, true);
  part(u, 11 + hx, 14 + len, 3, 2, shade(sp.hand, k));
}
function restArmsE(u: Grid, sp: PixelSpec, pose: BodyPose, far: boolean): void {
  const [sw] = phase(pose);
  const run = pose.legs === 'run';
  const amp = run ? PIXEL.stride.run : PIXEL.stride.walk;
  const swing = Math.round(sw * amp * (run ? 0.9 : 0.6));
  const seated = pose.legs === 'crouch' || pose.legs === 'sit';
  const len = run ? 6 : seated ? 7 : 9;
  if (far && pose.arms & ARM_B) armE(u, sp, seated ? 2 : swing, len, true);
  if (!far && pose.arms & ARM_A) armE(u, sp, seated ? 2 : -swing, len, false);
}

// ——— Корпус ———
const PATCH_AT: readonly [number, number][] = [[9, 17], [13, 20], [8, 21], [14, 15]];
const HOLE_AT: readonly [number, number][] = [[14, 18], [10, 21], [12, 16], [9, 19]];

function torsoS(u: Grid, sp: PixelSpec, back: boolean): void {
  const camo = camoOf(sp);
  const coat = sp.outer ? sp.outerColor : sp.top;
  const pat = sp.outer ? undefined : camo ?? topPattern(sp);
  const long = longOuter(sp);
  // Пончо и шуба шире в плечах.
  const wide = sp.outer === 'sack' || sp.outer === 'fur';
  if (wide) part(u, 6, 13, 12, long ? 16 : 13, coat, true);
  else part(u, 7, 13, 10, long ? 16 : 11, coat, true, pat);
  if (long) part(u, 6, 24, 12, 5, coat, false);
  if (long && sp.frayed) for (let x = 6; x < 18; x += 2) u.set(x, 28, null);
  if (!long && sp.skirt) {
    part(u, 7, 23, 10, 3, sp.skirt);
    part(u, 6, 26, 12, 3, sp.skirt);
    if (sp.frayed) for (let x = 6; x < 18; x += 3) u.set(x, 28, null);
  }
  if (back) {
    if (sp.outer === 'quilted') for (const y of [16, 19, 22]) u.rect(8, y, 8, 1, shade(coat, -0.14));
    if (sp.outer === 'trench' || sp.outer === 'french') u.rect(7, 21, 10, 1, shade(coat, -0.2));
    if (long) u.rect(11, 22, 1, 7, shade(coat, -0.2));
    return;
  }
  // Верх нараспашку — видна рубашка (свитер) посередине.
  if (openOuter(sp)) {
    const inner = topPattern(sp);
    for (let y = 13; y <= (long ? 27 : 22); y++) for (const x of [11, 12]) u.set(x, y, inner?.(x, y) ?? (y === 13 ? shade(sp.top, 0.12) : sp.top));
  }
  if (lapels(sp)) {
    const sh = shade(sp.top, 0.1);
    u.rect(10, 13, 4, 2, sh);
    u.rect(10, 15, 1, 1, shade(coat, -0.2));
    u.rect(13, 15, 1, 1, shade(coat, -0.2));
    if (sp.outer === 'suit' && sp.outerTrim) { u.rect(10, 17, 1, 5, sp.outerTrim); u.rect(13, 17, 1, 5, sp.outerTrim); }
    if (sp.outer === 'tux') u.rect(10, 13, 4, 3, '#f2efe6');
  }
  switch (sp.outer) {
    case 'quilted':
      for (const y of [16, 19, 22]) u.rect(8, y, 8, 1, shade(coat, -0.14));
      u.rect(11, 14, 1, 9, shade(coat, -0.28));
      u.rect(9, 13, 6, 1, shade(coat, 0.12));
      break;
    case 'zip':
      u.rect(9, 13, 6, 1, shade(coat, 0.15));
      u.rect(11, 14, 1, 9, shade(coat, -0.3));
      u.set(11, 15, C.metal);
      break;
    case 'cardigan':
      for (const y of [15, 18, 21]) u.set(10, y, shade(coat, 0.3));
      break;
    case 'trench':
      u.rect(7, 21, 10, 1, shade(coat, -0.22));
      u.set(11, 21, C.metal);
      for (const y of [15, 18]) { u.set(9, y, shade(coat, -0.3)); u.set(14, y, shade(coat, -0.3)); }
      u.rect(9, 13, 6, 1, shade(coat, 0.15));
      u.rect(11, 22, 1, 6, shade(coat, -0.25));
      break;
    case 'peacoat':
      for (const y of [15, 18]) { u.set(10, y, sp.outerTrim ?? '#b9b0a0'); u.set(13, y, sp.outerTrim ?? '#b9b0a0'); }
      u.rect(9, 13, 6, 1, shade(coat, 0.15));
      break;
    case 'french':
      u.rect(8, 15, 3, 2, shade(coat, -0.15));
      u.rect(13, 15, 3, 2, shade(coat, -0.15));
      u.rect(7, 21, 10, 1, '#3a2f22');
      for (const y of [14, 17, 20]) u.set(11, y, '#d9b24a');
      break;
    case 'camel':
      u.rect(7, 13, 10, 2, sp.outerTrim ?? '#6b5a3e');
      break;
    case 'fur':
      for (const [x, y] of [[8, 16], [14, 18], [10, 22], [13, 25], [8, 26], [15, 23]]) u.set(x, y, shade(coat, 0.15));
      u.rect(7, 13, 10, 2, sp.outerTrim ?? shade(coat, 0.2));
      break;
    case 'sack':
      u.rect(6, 20, 12, 1, '#a8946a');
      break;
    case 'ragcoat':
      u.rect(11, 14, 1, 14, shade(coat, -0.3));
      break;
    case 'greatcoat':
      u.rect(9, 13, 2, 3, shade(coat, 0.12));
      u.rect(13, 13, 2, 3, shade(coat, 0.12));
      for (const y of [16, 19, 22]) { u.set(10, y, '#9aa3ab'); u.set(13, y, '#9aa3ab'); }
      break;
    case 'labcoat':
      u.rect(9, 13, 2, 3, shade(coat, -0.08));
      u.rect(13, 13, 2, 3, shade(coat, -0.08));
      u.rect(8, 19, 2, 2, shade(coat, -0.1));
      break;
    default:
      break;
  }
  // Низ без верха: воротник, пуговицы, вырез, рубчик.
  if (!sp.outer) {
    switch (sp.topKind) {
      case 'shirt':
        u.rect(10, 13, 4, 1, shade(sp.top, 0.22));
        for (const y of [15, 17, 19, 21]) u.set(11, y, shade(sp.top, -0.25));
        break;
      case 'undershirt':
      case 'tee':
        u.rect(10, 13, 4, 1, sp.skin);
        if (sp.topKind === 'undershirt') { u.rect(7, 13, 1, 2, sp.skin); u.rect(16, 13, 1, 2, sp.skin); u.rect(9, 14, 6, 1, sp.skin); }
        break;
      case 'sweater':
        for (let x = 7; x < 17; x += 2) u.set(x, 23, shade(sp.top, -0.18));
        u.rect(10, 13, 4, 1, shade(sp.top, -0.1));
        break;
      case 'turtleneck':
        u.rect(10, 12, 4, 2, shade(sp.top, 0.08));
        break;
      case 'blouse':
        u.rect(9, 13, 6, 1, shade(sp.top, 0.3));
        u.set(11, 14, shade(sp.top, 0.3));
        u.set(12, 14, shade(sp.top, 0.3));
        break;
      case 'uniform':
        u.rect(9, 13, 6, 1, shade(sp.top, -0.18));
        u.rect(9, 15, 2, 1, shade(sp.top, -0.15));
        u.rect(13, 15, 2, 1, shade(sp.top, -0.15));
        u.rect(11, 14, 1, 9, shade(sp.top, -0.12));
        break;
      case 'fatigues':
        u.rect(9, 13, 6, 1, shade(sp.top, -0.15));
        u.rect(8, 15, 3, 2, shade(sp.top, -0.12));
        u.rect(13, 15, 3, 2, shade(sp.top, -0.12));
        break;
      case 'jumpsuit':
        if (sp.collar) u.rect(9, 13, 6, 1, sp.collar);
        if (sp.zip) u.rect(11, 14, 1, 9, shade(sp.top, -0.25));
        break;
      default:
        break;
    }
  }
}

function torsoE(u: Grid, sp: PixelSpec): void {
  const camo = camoOf(sp);
  const coat = sp.outer ? sp.outerColor : sp.top;
  const pat = sp.outer ? undefined : camo ?? topPattern(sp);
  const long = longOuter(sp);
  const wide = sp.outer === 'sack' || sp.outer === 'fur';
  part(u, wide ? 8 : 9, 13, wide ? 9 : 7, long ? 16 : 11, coat, true, pat);
  if (long) part(u, 8, 24, 9, 5, coat);
  if (long && sp.frayed) for (let x = 8; x < 17; x += 2) u.set(x, 28, null);
  if (!long && sp.skirt) { part(u, 9, 23, 7, 3, sp.skirt); part(u, 8, 26, 9, 3, sp.skirt); }
  if (sp.outer === 'quilted') for (const y of [16, 19, 22]) u.rect(10, y, 5, 1, shade(coat, -0.14));
  if (sp.outer === 'trench' || sp.outer === 'french') u.rect(9, 21, 7, 1, shade(coat, -0.22));
  if (sp.outer === 'camel' || sp.outer === 'fur') u.rect(10, 13, 5, 2, sp.outerTrim ?? shade(coat, 0.2));
  if (openOuter(sp)) u.rect(15, 13, 1, long ? 14 : 9, sp.top);
  if (lapels(sp)) u.rect(14, 13, 2, 3, shade(sp.top, 0.1));
  if (!sp.outer && sp.topKind === 'shirt') u.rect(13, 13, 3, 1, shade(sp.top, 0.22));
  if (!sp.outer && sp.topKind === 'turtleneck') u.rect(11, 12, 3, 2, shade(sp.top, 0.08));
  if (!sp.outer && sp.topKind === 'jumpsuit' && sp.collar) u.rect(11, 13, 4, 1, sp.collar);
}

function armorS(u: Grid, sp: PixelSpec, back: boolean): void {
  const A = sp.armorColor;
  switch (sp.armor) {
    case 'vest':
      part(u, 8, 14, 8, 8, A, true);
      if (!back) for (const x of [8, 10, 12, 14]) part(u, x, 20, 2, 2, shade(A, -0.12));
      break;
    case 'flak':
      part(u, 7, 13, 10, 9, A, true);
      for (const y of [15, 17, 19]) u.rect(8, y, 8, 1, shade(A, -0.14));
      u.rect(8, 12, 8, 1, shade(A, -0.08));
      if (!back) u.rect(11, 12, 2, 2, sp.top);
      break;
    case 'recon':
      part(u, 8, 14, 8, 8, A, true);
      for (const y of [16, 18, 20]) u.rect(8, y, 8, 1, shade(A, 0.12));
      part(u, 6, 13, 3, 2, shade(A, -0.05));
      part(u, 15, 13, 3, 2, shade(A, -0.05));
      break;
    case 'marine':
      part(u, 7, 13, 10, 10, A, true);
      if (!back) part(u, 9, 14, 6, 5, shade(A, 0.15), true);
      else part(u, 8, 14, 8, 8, shade(A, -0.1), true);
      u.rect(9, 12, 6, 1, shade(A, -0.2));
      for (const y of [19, 21]) u.rect(8, y, 8, 1, shade(A, -0.16));
      break;
    case 'plate':
      part(u, 8, 14, 8, 8, A, true);
      u.set(9, 13, A);
      u.set(14, 13, A);
      if (!back) for (const x of [8, 11, 14]) part(u, x, 18, 2, 3, shade(A, -0.14));
      if (!back && sp.acc.has('radio')) { part(u, 13, 15, 2, 2, '#2b2f33'); u.set(14, 13, C.strap); u.set(14, 12, C.strap); }
      break;
    case 'chest':
      u.rect(9, 13, 1, 4, shade(A, -0.1));
      u.rect(14, 13, 1, 4, shade(A, -0.1));
      if (back) { line(u, 9, 14, 14, 20, shade(A, -0.1)); line(u, 14, 14, 9, 20, shade(A, -0.1)); }
      else for (const x of [8, 10, 12, 14]) part(u, x, 17, 2, 3, x % 4 ? A : shade(A, -0.12));
      break;
    default:
      break;
  }
}
function armorE(u: Grid, sp: PixelSpec): void {
  const A = sp.armorColor;
  switch (sp.armor) {
    case 'vest':
    case 'plate':
    case 'recon':
      part(u, 10, 14, 6, 8, A, true);
      if (sp.armor === 'recon') for (const y of [16, 18, 20]) u.rect(10, y, 6, 1, shade(A, 0.12));
      else part(u, 15, 18, 2, 3, shade(A, -0.12));
      part(u, 8, 15, 2, 6, shade(A, -0.15));
      break;
    case 'flak':
      part(u, 9, 13, 8, 9, A, true);
      for (const y of [15, 17, 19]) u.rect(10, y, 6, 1, shade(A, -0.14));
      u.rect(10, 12, 5, 1, shade(A, -0.08));
      break;
    case 'marine':
      part(u, 8, 13, 9, 10, A, true);
      part(u, 13, 14, 4, 5, shade(A, 0.15), true);
      for (const y of [19, 21]) u.rect(9, y, 7, 1, shade(A, -0.16));
      break;
    case 'chest':
      part(u, 14, 16, 3, 4, A);
      u.rect(11, 13, 1, 4, shade(A, -0.1));
      break;
    default:
      break;
  }
}

/** Пояс, верёвка, подтяжки, фартук, жилет, крест, номер, ошейник, сумка, патронташ, навесное — спереди и сзади. */
function extrasS(u: Grid, sp: PixelSpec, back: boolean): void {
  const long = longOuter(sp);
  if (sp.suspenders && !sp.outer) { u.rect(9, 13, 1, 10, sp.suspenders); u.rect(14, 13, 1, 10, sp.suspenders); }
  if (sp.hivis) {
    part(u, 8, 14, 8, 9, sp.hivis, true);
    u.rect(8, 17, 8, 1, '#e8e6dc');
    u.rect(8, 20, 8, 1, '#e8e6dc');
  }
  if (sp.apron && !back) {
    part(u, 9, 15, 6, long ? 12 : 11, sp.apron);
    u.set(10, 13, sp.apron);
    u.set(13, 13, sp.apron);
    u.set(10, 14, sp.apron);
    u.set(13, 14, sp.apron);
  }
  if (sp.belt && !long && !sp.skirt) {
    u.rect(7, 23, 10, 1, sp.belt);
    if (!back) u.rect(11, 23, 2, 1, C.metal);
  }
  if (sp.rope) { u.rect(7, 21, 10, 1, '#a8946a'); if (!back) u.set(12, 22, '#a8946a'); }
  if (!back) {
    if (sp.cross) { u.rect(13, 15, 3, 1, sp.cross); u.rect(14, 14, 1, 3, sp.cross); }
    if (sp.number) { u.rect(9, 15, 3, 2, sp.number); u.set(10, 16, '#3a3f46'); u.set(9, 15, '#3a3f46'); }
    if (sp.watch) { u.set(14, 18, '#d9b24a'); u.set(13, 19, '#d9b24a'); }
    if (sp.pocket) u.set(9, 15, sp.pocket);
    if (sp.brooch) u.set(9, 14, sp.brooch);
    if (sp.medals) { u.set(9, 16, '#d9b24a'); u.set(10, 16, '#c93030'); u.set(9, 17, '#d9b24a'); }
    if (sp.acc.has('radio') && sp.armor !== 'plate') { part(u, 13, 15, 2, 2, '#2b2f33'); u.set(14, 14, C.strap); u.set(14, 13, C.strap); }
    if (sp.acc.has('aiguillette')) { line(u, 15, 13, 13, 17, '#d9b24a'); }
    if (sp.acc.has('scanner')) { part(u, 14, 21, 2, 2, '#26303a'); u.set(14, 21, '#8fffc8'); }
    if (sp.acc.has('grenades')) { u.set(8, 22, '#4f5f3a'); u.set(10, 22, '#4f5f3a'); }
    if (sp.acc.has('pouches')) { u.rect(13, 22, 2, 2, shade(sp.belt ?? '#2a2a2a', 0.1)); }
    if (sp.bag) { line(u, 8, 13, 15, 21, shade(sp.bag, -0.2)); part(u, 14, 20, 4, 4, sp.bag, true); }
    if (sp.bandolier) {
      line(u, 8, 14, 15, 22, sp.bandolier);
      for (const [x, y] of [[9, 15], [11, 17], [13, 19]]) u.set(x, y, '#6f9a4a');
    }
  } else {
    if (sp.number) { u.rect(9, 16, 6, 2, sp.number); u.set(10, 17, '#3a3f46'); u.set(13, 17, '#3a3f46'); }
    if (sp.bag) line(u, 8, 13, 15, 21, shade(sp.bag, -0.2));
  }
  if (sp.acc.has('epaulettes')) { u.rect(7, 13, 2, 1, '#d9b24a'); u.rect(15, 13, 2, 1, '#d9b24a'); }
  if (sp.acc.has('lamp') && !back) { part(u, 7, 13, 2, 2, '#3a3f45'); u.set(8, 14, '#ffe9a8'); }
  // Поношенность: заплаты, дыры, пятна.
  sp.patches.slice(0, 3).forEach((c, k) => { const [x, y] = PATCH_AT[k]; u.over(x, y, c); u.over(x + 1, y, c); u.over(x, y + 1, shade(c, -0.1)); });
  for (let k = 0; k < Math.min(sp.holes, 4); k++) { const [x, y] = HOLE_AT[k]; u.over(x, y, '#1e1a17'); }
  for (let k = 0; k < Math.min(sp.stains, 2); k++) { const [x, y] = HOLE_AT[3 - k]; u.over(x - 1, y + 1, shade(u.get(x - 1, y + 1) ?? sp.top, -0.18)); }
  if (sp.pads) {
    const big = sp.bigPads;
    part(u, big ? 3 : 4, 12, big ? 5 : 4, big ? 5 : 4, sp.pads, true);
    part(u, 16, 12, big ? 5 : 4, big ? 5 : 4, sp.pads, true);
    if (big) { u.rect(4, 13, 3, 1, sp.trim); u.rect(17, 13, 3, 1, sp.trim); }
  }
}
function extrasE(u: Grid, sp: PixelSpec): void {
  const long = longOuter(sp);
  if (sp.hivis) { part(u, 9, 14, 7, 9, sp.hivis, true); u.rect(9, 17, 7, 1, '#e8e6dc'); u.rect(9, 20, 7, 1, '#e8e6dc'); }
  if (sp.apron) part(u, 14, 15, 3, long ? 12 : 11, sp.apron);
  if (sp.belt && !long && !sp.skirt) u.rect(9, 23, 7, 1, sp.belt);
  if (sp.rope) u.rect(9, 21, 7, 1, '#a8946a');
  if (sp.number) u.rect(13, 15, 2, 2, sp.number);
  if (sp.cross) { u.rect(12, 15, 3, 1, sp.cross); u.rect(13, 14, 1, 3, sp.cross); }
  if (sp.acc.has('radio')) part(u, 14, 15, 2, 2, '#2b2f33');
  if (sp.acc.has('lamp')) { part(u, 12, 12, 2, 2, '#3a3f45'); u.set(13, 12, '#ffe9a8'); }
  if (sp.acc.has('epaulettes')) u.rect(11, 13, 3, 1, '#d9b24a');
  if (sp.bag) part(u, 8, 20, 3, 4, sp.bag, true);
  if (sp.bandolier) line(u, 10, 14, 15, 22, sp.bandolier);
  if (sp.pads) part(u, 9, 12, sp.bigPads ? 6 : 5, sp.bigPads ? 5 : 4, sp.pads, true);
  if (sp.pads && sp.bigPads) u.rect(10, 13, 4, 1, sp.trim);
}

/** За спиной: накидка, ранец, баллон, длинные волосы (спереди и сбоку — то, что видно из-за корпуса). */
function behind(g: Grid, sp: PixelSpec, dir: BodyDir): void {
  if (dir === 'S') {
    if (sp.cape) part(g, 5, 13, 14, 15, shade(sp.cape, -0.1), true);
    if (sp.tank) part(g, 15, 9, 3, 5, sp.tank, true);
    if (sp.hairStyle === 'long' && sp.head !== 'hood') { part(g, 7, 7, 10, 7, shade(sp.hair, -0.1), true); }
  } else if (dir === 'E') {
    if (sp.cape) part(g, 6, 13, 5, 15, shade(sp.cape, -0.1), true);
    if (sp.tank) part(g, 5, 11, 3, 11, sp.tank, true);
    if (sp.pack) { part(g, 5, 14, 5, 8, sp.pack, true); if (sp.acc.has('antenna')) line(g, 6, 13, 5, 6, '#16181b'); }
  }
}
/** Сзади поверх спины: ранец, баллон, накидка. */
function backGear(u: Grid, sp: PixelSpec): void {
  if (sp.cape) { part(u, 6, 13, 12, 16, sp.cape, true); u.rect(6, 13, 12, 1, shade(sp.cape, 0.12)); }
  if (sp.pack) {
    part(u, 8, 14, 8, 9, sp.pack, true);
    u.rect(9, 17, 6, 1, shade(sp.pack, -0.15));
    if (sp.acc.has('antenna')) line(u, 14, 14, 15, 6, '#16181b');
  }
  if (sp.tank) { part(u, 9, 12, 6, 10, sp.tank, true); u.rect(9, 15, 6, 1, shade(sp.tank, -0.2)); }
}

// ——— Голова ———
function faceS(u: Grid, sp: PixelSpec, pose: BodyPose): void {
  const sk = sp.skin;
  if (sp.stubble) { u.rect(9, 10, 6, 2, shade(sk, -0.12)); u.rect(10, 11, 4, 1, shade(sk, -0.18)); }
  const eye = pose.blink ? shade(sk, -0.35) : INK;
  u.set(10, 8, eye);
  u.set(13, 8, eye);
  if (!pose.blink) { u.set(10, 7, shade(sp.hair, 0.05)); u.set(13, 7, shade(sp.hair, 0.05)); }
  u.set(12, 9, shade(sk, -0.12));
  if (sp.wrinkles) { u.set(9, 9, shade(sk, -0.14)); u.set(14, 9, shade(sk, -0.14)); }
  if (sp.freckles) { u.set(10, 9, '#c08a6a'); u.set(13, 9, '#c08a6a'); }
  if (pose.talk) { u.rect(11, 10, 2, 1, C.mouth); u.rect(11, 11, 2, 1, shade(C.mouth, -0.3)); }
  else u.rect(11, 10, 2, 1, shade(sk, -0.3));
  if (sp.glasses) {
    u.rect(9, 8, 2, 1, '#9ab4cc');
    u.rect(13, 8, 2, 1, '#9ab4cc');
    u.rect(11, 8, 2, 1, '#2a2622');
    u.set(9, 8, '#2a2622');
    u.set(14, 8, '#2a2622');
  }
}
function faceE(u: Grid, sp: PixelSpec, pose: BodyPose): void {
  const sk = sp.skin;
  u.set(16, 8, sk);
  u.set(16, 9, shade(sk, -0.12));
  if (sp.stubble) u.rect(13, 10, 3, 2, shade(sk, -0.12));
  u.set(14, 8, pose.blink ? shade(sk, -0.35) : INK);
  if (!pose.blink) u.set(14, 7, shade(sp.hair, 0.05));
  if (pose.talk) { u.set(15, 10, C.mouth); u.set(15, 11, shade(C.mouth, -0.3)); }
  else u.set(15, 10, shade(sk, -0.3));
  if (sp.wrinkles) u.set(13, 9, shade(sk, -0.14));
  u.set(11, 8, shade(sk, -0.16));
  if (sp.glasses) { u.rect(14, 8, 2, 1, '#9ab4cc'); u.rect(11, 8, 3, 1, '#2a2622'); }
}
function hairS(u: Grid, sp: PixelSpec, back: boolean): void {
  const h = sp.hair;
  const st = sp.hairStyle;
  if (st === 'bald') {
    if (back) u.rect(9, 5, 6, 1, shade(sp.skin, 0.1));
    return;
  }
  if (!back) {
    u.rect(9, 4, 6, 1, h);
    u.rect(8, 5, 8, 1, h);
    u.set(8, 6, h);
    u.set(15, 6, h);
    if (st === 'messy') { u.set(9, 3, h); u.set(12, 3, h); u.set(14, 3, h); u.rect(9, 6, 3, 1, h); }
    if (st === 'long') { u.rect(7, 6, 2, 7, h); u.rect(15, 6, 2, 7, h); u.set(7, 6, shade(h, 0.1)); }
    if (st === 'bun') part(u, 10, 2, 4, 2, h, true);
  } else {
    part(u, 8, 4, 8, st === 'long' ? 9 : 7, h, true);
    if (st === 'long') part(u, 7, 7, 10, 7, h, true);
    if (st === 'messy') { u.set(9, 3, h); u.set(12, 3, h); u.set(14, 3, h); }
    if (st === 'bun') part(u, 10, 2, 4, 3, h, true);
  }
}
function hairE(u: Grid, sp: PixelSpec): void {
  const h = sp.hair;
  const st = sp.hairStyle;
  if (st === 'bald') return;
  u.rect(10, 4, 5, 1, h);
  u.rect(9, 5, 7, 1, h);
  u.rect(9, 6, 2, 3, h);
  if (st === 'messy') { u.set(11, 3, h); u.set(13, 3, h); u.rect(14, 6, 2, 1, h); }
  if (st === 'long') part(u, 8, 6, 3, 8, h, true);
  if (st === 'bun') part(u, 7, 4, 3, 3, h, true);
}

function maskS(u: Grid, sp: PixelSpec, back: boolean): void {
  const f = sp.face;
  if (!f) return;
  if (back) {
    if (f === 'balaclava') part(u, 8, 5, 8, 7, sp.faceColor, true);
    else if (f === 'scarf') part(u, 10, 10, 4, 2, sp.faceColor);
    else u.rect(8, 8, 8, 1, C.strap);
    return;
  }
  switch (f) {
    case 'gas':
      part(u, 9, 7, 6, 5, sp.faceColor, true);
      u.rect(9, 8, 2, 2, GLASS);
      u.rect(13, 8, 2, 2, GLASS);
      u.set(9, 8, sp.lens);
      u.set(13, 8, sp.lens);
      part(u, 11, 10, 2, 3, sp.filter);
      u.set(8, 8, C.strap);
      u.set(15, 8, C.strap);
      break;
    case 's10':
      part(u, 8, 6, 8, 6, sp.faceColor, true);
      u.rect(9, 8, 2, 1, sp.lens);
      u.rect(13, 8, 2, 1, sp.lens);
      part(u, 11, 10, 2, 2, shade(sp.faceColor, 0.15));
      part(u, 14, 10, 2, 2, sp.filter);
      u.set(15, 10, sp.filterRing);
      break;
    case 'balaclava':
      part(u, 8, 5, 8, 7, sp.faceColor, true);
      u.rect(9, 8, 6, 1, sp.skin);
      u.set(10, 8, INK);
      u.set(13, 8, INK);
      break;
    case 'scarf':
      part(u, 8, 9, 8, 3, sp.faceColor);
      u.set(12, 10, shade(sp.faceColor, -0.15));
      break;
    case 'goggles':
      u.rect(8, 7, 8, 1, C.strap);
      u.rect(9, 7, 2, 2, sp.lens);
      u.rect(13, 7, 2, 2, sp.lens);
      break;
  }
}
function maskE(u: Grid, sp: PixelSpec): void {
  switch (sp.face) {
    case 'gas':
      part(u, 12, 7, 4, 5, sp.faceColor);
      u.rect(14, 8, 2, 1, GLASS);
      u.set(14, 8, sp.lens);
      part(u, 16, 10, 2, 2, sp.filter);
      u.rect(10, 8, 2, 1, C.strap);
      break;
    case 's10':
      part(u, 11, 6, 5, 6, sp.faceColor);
      u.rect(14, 8, 2, 1, sp.lens);
      part(u, 12, 10, 2, 2, sp.filter);
      u.set(12, 10, sp.filterRing);
      part(u, 16, 9, 1, 2, shade(sp.faceColor, 0.15));
      break;
    case 'balaclava':
      part(u, 9, 5, 7, 7, sp.faceColor, true);
      u.rect(13, 8, 3, 1, sp.skin);
      u.set(14, 8, INK);
      break;
    case 'scarf':
      part(u, 12, 9, 5, 3, sp.faceColor);
      break;
    case 'goggles':
      u.rect(9, 7, 5, 1, C.strap);
      u.rect(14, 7, 2, 2, sp.lens);
      break;
    default:
      break;
  }
}

/** Головной убор или шлем: спереди (S), сзади (N), сбоку (E). */
function headgear(u: Grid, sp: PixelSpec, dir: BodyDir): void {
  const k = sp.head;
  if (!k) return;
  const H = sp.headColor;
  const T = sp.headTrim;
  const back = dir === 'N';
  const side = dir === 'E';
  const dk = (c: string, v = -0.2) => shade(c, v);
  const camo: Pattern | undefined = sp.headCamo?.length
    ? (x, y) => {
        const h = ((Math.floor(x / 2) * 73856093) ^ (Math.floor(y / 2) * 19349663)) >>> 0;
        const v = h % (sp.headCamo!.length + 3);
        return v < sp.headCamo!.length ? sp.headCamo![v] : null;
      }
    : undefined;
  switch (k as HeadGear) {
    case 'ushanka':
      if (side) { part(u, 8, 2, 9, 4, H, true); part(u, 8, 5, 9, 2, T); part(u, 10, 7, 3, 4, T, true); part(u, 8, 7, 2, 4, T); }
      else if (back) { part(u, 7, 2, 10, 4, H, true); part(u, 7, 5, 10, 6, T, true); }
      else { part(u, 7, 2, 10, 4, H, true); part(u, 7, 5, 10, 2, T); part(u, 6, 6, 2, 5, T, true); part(u, 16, 6, 2, 5, T, true); }
      break;
    case 'beanie':
      if (side) { part(u, 9, 2, 7, 4, H, true); part(u, 8, 5, 8, 2, dk(H, -0.12)); }
      else { part(u, 8, 2, 8, 4, H, true); part(u, 7, 5, 10, 2, dk(H, -0.12)); for (let x = 8; x < 16; x += 2) u.set(x, 3, dk(H, -0.1)); }
      if (sp.headTrim && sp.headTrim !== dk(H, -0.3)) part(u, side ? 11 : 11, 0, 2, 2, T, false);
      break;
    case 'kerchief':
      if (side) { part(u, 9, 3, 7, 4, H, true); part(u, 9, 7, 4, 4, H); part(u, 7, 10, 3, 3, H); u.set(11, 4, T); u.set(14, 5, T); u.set(10, 8, T); }
      else if (back) { part(u, 8, 3, 8, 9, H, true); part(u, 10, 12, 4, 2, H); for (const [x, y] of [[10, 4], [13, 5], [9, 7], [14, 8], [11, 10], [13, 11]]) u.set(x, y, T); }
      else { part(u, 8, 3, 8, 4, H, true); u.rect(8, 7, 1, 4, H); u.rect(15, 7, 1, 4, dk(H)); part(u, 10, 12, 4, 1, H); for (const [x, y] of [[10, 4], [13, 5], [9, 6], [14, 3]]) u.set(x, y, T); }
      break;
    case 'flatcap':
      if (side) { part(u, 9, 3, 7, 3, H, true); part(u, 14, 5, 4, 1, dk(H, -0.25)); }
      else { part(u, 8, 3, 8, 3, H, true); if (!back) part(u, 7, 5, 10, 2, dk(H, -0.25)); else u.rect(8, 5, 8, 1, dk(H)); }
      break;
    case 'beret':
      if (side) { part(u, 8, 3, 9, 3, H, true); u.set(7, 5, H); }
      else { part(u, 7, 3, 10, 3, H, true); u.set(16, 5, H); u.set(11, 2, dk(H)); }
      break;
    case 'fedora':
    case 'bowler':
      if (side) { part(u, 10, 1, 6, 4, H, k === 'bowler'); u.rect(10, 4, 6, 1, T); part(u, 7, 5, 11, 1, dk(H, -0.15)); }
      else { part(u, 9, 1, 6, 4, H, k === 'bowler'); u.rect(9, 4, 6, 1, T); part(u, k === 'fedora' ? 6 : 7, 5, k === 'fedora' ? 12 : 10, 1, dk(H, -0.15)); if (k === 'fedora') u.rect(11, 1, 2, 1, dk(H, -0.15)); }
      break;
    case 'pillbox':
      part(u, side ? 11 : 10, 3, 4, 2, H);
      if (!back) for (const [x, y] of side ? [[13, 5], [15, 6], [14, 7]] : [[9, 5], [11, 6], [13, 5], [14, 7], [10, 7]]) u.set(x, y, T);
      break;
    case 'tophat':
      if (side) { part(u, 10, -3, 6, 8, H); u.rect(10, 3, 6, 1, T); part(u, 8, 5, 10, 1, dk(H, -0.1)); }
      else { part(u, 9, -3, 6, 8, H); u.rect(9, 3, 6, 1, T); part(u, 7, 5, 10, 1, dk(H, -0.1)); }
      break;
    case 'hood':
      if (side) { part(u, 8, 3, 8, 4, H, true); part(u, 8, 7, 4, 6, H); part(u, 15, 4, 1, 3, dk(H)); }
      else if (back) { part(u, 7, 3, 10, 11, H, true); u.rect(11, 2, 2, 1, H); }
      else { part(u, 7, 3, 10, 3, H, true); part(u, 7, 6, 2, 7, H); part(u, 15, 6, 2, 7, dk(H, -0.1)); part(u, 8, 12, 8, 2, H); u.rect(9, 6, 6, 1, shade(sp.skin, -0.3)); }
      break;
    case 'cap':
      if (side) { part(u, 9, 3, 7, 3, H, true); part(u, 15, 5, 3, 1, dk(H, -0.3)); }
      else { part(u, 8, 3, 8, 3, H, true); if (!back) part(u, 8, 6, 8, 1, dk(H, -0.3)); else u.rect(9, 6, 6, 1, dk(H)); }
      break;
    case 'chef':
      if (side) { part(u, 9, -1, 7, 6, H, true); u.rect(9, 4, 7, 1, dk(H, -0.06)); }
      else { part(u, 8, -1, 8, 6, H, true); u.rect(8, 4, 8, 1, dk(H, -0.06)); u.set(11, 0, dk(H, -0.08)); }
      break;
    case 'bandana':
      if (side) { part(u, 9, 3, 7, 3, H, true); u.rect(7, 5, 2, 1, H); u.set(7, 6, H); }
      else { part(u, 8, 3, 8, 3, H, true); if (back) { part(u, 11, 6, 2, 2, H); } }
      break;
    case 'flak':
      if (side) { part(u, 8, 2, 9, 5, H, true); part(u, 8, 6, 10, 2, dk(H, -0.18)); u.rect(9, 4, 7, 1, T); }
      else { part(u, 7, 2, 10, 5, H, true); part(u, 6, 6, 12, 2, dk(H, -0.18)); u.rect(8, 4, 8, 1, T); }
      break;
    case 'peaked':
      if (side) { part(u, 8, 2, 9, 3, H, true); u.rect(9, 5, 7, 1, T); part(u, 14, 6, 4, 1, '#0e1013'); }
      else { part(u, 7, 2, 10, 3, H, true); u.rect(8, 5, 8, 1, T); if (!back) { part(u, 8, 6, 8, 1, '#0e1013'); u.rect(11, 3, 2, 1, '#d9b24a'); } }
      break;
    case 'cadet':
      if (side) { part(u, 9, 3, 7, 2, H); u.set(15, 2, H); }
      else { part(u, 9, 3, 6, 2, H); u.rect(10, 2, 4, 1, dk(H, -0.1)); }
      break;
    case 'recon':
      if (side) { part(u, 8, 2, 9, 10, H, true); u.rect(13, 7, 4, 2, sp.visor); u.set(15, 7, sp.eye); }
      else if (back) { part(u, 7, 2, 10, 10, H, true); u.rect(11, 3, 2, 7, dk(H, -0.1)); }
      else { part(u, 7, 2, 10, 10, H, true); u.rect(8, 7, 8, 2, sp.visor); u.set(9, 7, sp.eye); u.set(14, 7, sp.eye); u.rect(9, 10, 6, 1, dk(H, -0.15)); }
      if (T) u.rect(side ? 9 : 8, 4, side ? 7 : 8, 1, T);
      break;
    case 'marine':
      if (side) {
        part(u, 8, 3, 9, 9, H, true);
        u.rect(13, 7, 4, 1, sp.visor);
        u.set(15, 7, sp.eye);
        u.rect(15, 9, 2, 2, dk(H, -0.3));
        u.rect(9, 6, 3, 1, dk(H, -0.12));
      } else if (back) {
        part(u, 7, 3, 10, 9, H, true);
        u.rect(11, 4, 2, 7, dk(H, -0.12));
      } else {
        part(u, 7, 3, 10, 9, H, true);
        u.rect(8, 7, 8, 1, sp.visor);
        u.rect(11, 8, 2, 3, sp.visor);
        if (sp.eyes >= 2) { u.set(9, 7, sp.eye); u.set(14, 7, sp.eye); } else u.set(13, 7, sp.eye);
        u.rect(10, 10, 1, 1, dk(H, -0.3));
        u.rect(13, 10, 1, 1, dk(H, -0.3));
      }
      if (T) u.rect(11, 3, 2, side ? 1 : 2, T);
      break;
    case 'mich':
      if (side) {
        part(u, 8, 2, 9, 5, H, true, camo);
        if (sp.hgoggles) { u.rect(12, 5, 5, 1, C.strap); u.set(15, 5, sp.hgoggles); }
        if (sp.nvg) part(u, 15, 2, 2, 2, '#1a1c1e');
      } else {
        part(u, 7, 2, 10, 5, H, true, camo);
        if (sp.hgoggles) { u.rect(7, 5, 10, 1, C.strap); if (!back) { u.set(9, 5, sp.hgoggles); u.set(14, 5, sp.hgoggles); } }
        if (sp.nvg && !back) part(u, 11, 1, 2, 2, '#1a1c1e');
      }
      break;
    case 'fieldcap':
      if (side) { part(u, 9, 2, 7, 4, H, true); part(u, 15, 5, 3, 1, dk(H, -0.25)); }
      else { part(u, 8, 2, 8, 4, H, true); if (!back) part(u, 8, 6, 8, 1, dk(H, -0.25)); }
      break;
  }
}

/** Голова целиком: волосы, лицо, маска, убор; ошейник и шея. */
function headS(u: Grid, sp: PixelSpec, pose: BodyPose, back: boolean): void {
  const fullHelmet = sp.head === 'recon' || sp.head === 'marine';
  u.rect(10, 12, 4, 1, shade(sp.skin, -0.2));
  if (!fullHelmet) {
    part(u, 8, 5, 8, 7, sp.skin, true);
    if (!back) faceS(u, sp, pose);
    hairS(u, sp, back);
    maskS(u, sp, back);
  }
  if (sp.beacon) { u.rect(9, 12, 6, 1, sp.beacon[0]); if (!back) u.set(11, 12, sp.beacon[1]); }
  headgear(u, sp, back ? 'N' : 'S');
  neckS(u, sp, back);
}
function headE(u: Grid, sp: PixelSpec, pose: BodyPose): void {
  const fullHelmet = sp.head === 'recon' || sp.head === 'marine';
  u.rect(10, 12, 3, 1, shade(sp.skin, -0.2));
  if (!fullHelmet) {
    part(u, 9, 5, 7, 7, sp.skin, true);
    faceE(u, sp, pose);
    hairE(u, sp);
    maskE(u, sp);
  }
  if (sp.beacon) { u.rect(10, 12, 5, 1, sp.beacon[0]); u.set(14, 12, sp.beacon[1]); }
  headgear(u, sp, 'E');
  neckE(u, sp);
}
/** Шарф, галстук, бабочка, жемчуг, шаль; галстук костюма. */
function neckS(u: Grid, sp: PixelSpec, back: boolean): void {
  const c = sp.neckColor;
  if (sp.tie && !back) { u.rect(11, 13, 2, 1, sp.tie); u.rect(11, 14, 1, 6, sp.tie); }
  switch (sp.neck) {
    case 'scarf':
      part(u, 9, 12, 6, 2, c);
      if (!back) part(u, 13, 14, 2, 4, shade(c, -0.08));
      break;
    case 'tie':
      if (!back) { u.rect(11, 13, 2, 1, c); u.rect(11, 14, 1, 6, c); }
      break;
    case 'bow':
      if (!back) { u.rect(10, 13, 4, 1, c); u.set(11, 13, shade(c, -0.2)); }
      break;
    case 'pearls':
      if (!back) for (let x = 9; x < 15; x += 2) u.set(x, 13, '#f2efe6');
      break;
    case 'shawl':
      part(u, 6, 13, 12, 3, c, true);
      break;
    default:
      break;
  }
}
function neckE(u: Grid, sp: PixelSpec): void {
  const c = sp.neckColor;
  if (sp.tie) u.rect(15, 13, 1, 5, sp.tie);
  if (sp.neck === 'scarf') { part(u, 10, 12, 6, 2, c); part(u, 8, 13, 2, 4, shade(c, -0.08)); }
  if (sp.neck === 'tie') u.rect(15, 13, 1, 5, c);
  if (sp.neck === 'bow') u.rect(15, 13, 1, 1, c);
  if (sp.neck === 'shawl') part(u, 9, 13, 8, 3, c, true);
}

/**
 * Тело пешки на сторону (без контура — его даёт сборщик после рук и оружия). Ноги — в слое земли, корпус и
 * голова — в слое, который поднимается и опускается в шаг (upperOffset).
 */
export function paintBody(sp: PixelSpec, dir: BodyDir, pose: BodyPose): Grid {
  const g = newGrid();
  const u = g.blank();
  const back = dir === 'N';
  behind(g, sp, dir);
  if (dir === 'E') {
    legsE(g, sp, pose);
    restArmsE(u, sp, pose, true);
    torsoE(u, sp);
    armorE(u, sp);
    extrasE(u, sp);
    headE(u, sp, pose);
    restArmsE(u, sp, pose, false);
  } else {
    legsSN(g, sp, pose);
    restArmsSN(u, sp, pose, back);
    torsoS(u, sp, back);
    armorS(u, sp, back);
    if (back) backGear(u, sp);
    extrasS(u, sp, back);
    headS(u, sp, pose, back);
  }
  const [dx, dy] = upperOffset(dir, pose);
  g.paste(u, dx, dy);
  return g;
}

/** Ключ позы для кэша. */
export function poseKey(pose: BodyPose): string {
  return `${pose.legs}${pose.frame}${pose.arms}${pose.blink ? 'b' : ''}${pose.talk ? 't' : ''}`;
}

