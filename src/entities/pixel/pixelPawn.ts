/**
 * Сборка пиксельной пешки на кадр: тело по позе (pixelBody), ствол из модели игры (pixelWeapons) с руками на
 * рукояти и цевье, руки к делу (ест, курит, жестикулирует, бьёт, бросает, перезаряжает — те же анимации poses.ts,
 * записанные «вместо рисования»), предметы в руках, контур. Готовый спрайт — в кэше холстов по ключу кадра.
 * Описание — docs/rendering.md «Пиксельные пешки».
 */
import type { WeaponId } from '../../config/items';
import { PAWN } from '../../config/pawns';
import { WEAPON_POSE } from '../../config/weaponSprites';
import { PIXEL } from '../../config/pixelPawns';
import { LruCache } from '../../core/spriteCache';
import { Grid, line, outline, part, rgb, shade } from './grid';
import { ARM_A, ARM_B, paintBody, poseKey, shoulders, sleeveOf, upperOffset, type BodyDir, type BodyPose, type Legs } from './pixelBody';
import { pixelSpecOf, type PixelSpec } from './pixelSpec';
import { gunPoint, pixelGun, stampGun } from './pixelWeapons';
import type { PawnDir, PawnLook } from '../PawnRenderer';
import type { Character } from '../Character';
import type { MeleeSwing } from '../meleePose';
import { weaponPose } from '../weaponPose';

/** Сетка сборки шире сетки тела: длинный ствол, вспышка, руки в стороны. */
const CW = 80;
const CH = 66;
const COX = 28;
const COY = 18;

export interface Hand { x: number; y: number; color: string }
export interface Stick { x0: number; y0: number; x1: number; y1: number; color: string }
export interface Box { x: number; y: number; w: number; h: number; color: string }
/** Ствол в руках: рукоять — в координатах силуэта, угол, отражён ли (целится влево). */
export interface GunHold { id: WeaponId; x: number; y: number; ang: number; flip: boolean }

/** Кадр пешки: сторона, ноги, мимика, ствол, руки к делу и предметы (координаты силуэта). */
export interface PixelFrame {
  dir: PawnDir;
  legs: Legs;
  frame: number;
  blink: boolean;
  talk: boolean;
  gun: GunHold | null;
  hands: Hand[];
  sticks: Stick[];
  boxes: Box[];
  /** Перезаряжает: последняя рука к делу — вместо руки на цевье (идёт к поясу за магазином). */
  reload: boolean;
  /** В траншее — срезать ниже строки (координаты силуэта). */
  cut: number | null;
}

export function newFrame(): PixelFrame {
  return { dir: 'S', legs: 'stand', frame: 0, blink: false, talk: false, gun: null, hands: [], sticks: [], boxes: [], reload: false, cut: null };
}

// ——— Перевод координат ———
const PX = PAWN.scale / PIXEL.unit;
/**
 * Точки рук и предметов из poses.ts — в единицах фасолины (центр 0, рот −4.6, плечи −4.5, кисть у пояса 5.5, ступни
 * 14.2). У пиксельной пешки голова меньше и выше, поэтому высота переводится по опорным точкам, ширина — масштабом.
 */
const Y_MAP: readonly [number, number][] = [[-18, 2], [-10.5, 8], [-4, 11], [-2, 14], [6, 21.5], [14.2, 32]];
export function unitY(uy: number): number {
  const M = Y_MAP;
  if (uy <= M[0][0]) return M[0][1] + (uy - M[0][0]) * PX;
  for (let i = 1; i < M.length; i++) {
    if (uy <= M[i][0]) {
      const t = (uy - M[i - 1][0]) / (M[i][0] - M[i - 1][0]);
      return M[i - 1][1] + (M[i][1] - M[i - 1][1]) * t;
    }
  }
  return M[M.length - 1][1] + (uy - M[M.length - 1][0]) * PX;
}
export function unitX(ux: number): number {
  return PIXEL.cx + ux * PX;
}
/** Точка мира (px от центра персонажа) в координатах силуэта — линейно (ствол, чтобы дуло совпадало со вспышкой). */
export function worldToFigure(wx: number, wy: number): [number, number] {
  return [PIXEL.cx + wx / PIXEL.unit, PIXEL.ground + (wy - PIXEL.footY) / PIXEL.unit];
}

/**
 * Запись рук и предметов вместо рисования: функции poses.ts и meleePose.ts рисуют руки кружками и предметы
 * линиями и прямоугольниками — здесь те же вызовы запоминаются (в единицах фасолины), а пиксельная пешка рисует
 * по ним руки от плеча, предметы — пикселями. Контур (цвет обводки) не записывается.
 */
export class HandRecorder {
  hands: Hand[] = [];
  sticks: Stick[] = [];
  boxes: Box[] = [];
  fillStyle: string = '';
  strokeStyle: string = '';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalAlpha = 1;
  private arcs: number[] = [];
  private path: number[] = [];
  reset(): void {
    this.hands.length = 0;
    this.sticks.length = 0;
    this.boxes.length = 0;
    this.arcs.length = 0;
    this.path.length = 0;
  }
  beginPath(): void {
    this.arcs.length = 0;
    this.path.length = 0;
  }
  arc(x: number, y: number): void {
    this.arcs.push(x, y);
  }
  moveTo(x: number, y: number): void {
    this.path.length = 0;
    this.path.push(x, y);
  }
  lineTo(x: number, y: number): void {
    this.path.push(x, y);
  }
  closePath(): void {}
  fill(): void {
    for (let i = 0; i < this.arcs.length; i += 2) this.hands.push({ x: this.arcs[i], y: this.arcs[i + 1], color: this.fillStyle });
    this.arcs.length = 0;
  }
  stroke(): void {
    const p = this.path;
    if (p.length >= 4 && this.strokeStyle !== PAWN.outline && this.strokeStyle !== WEAPON_POSE.outline) {
      this.sticks.push({ x0: p[0], y0: p[1], x1: p[p.length - 2], y1: p[p.length - 1], color: this.strokeStyle });
    }
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.boxes.push({ x, y, w, h, color: this.fillStyle });
  }
  strokeRect(): void {}
  roundRect(): void {}
  save(): void {}
  restore(): void {}
  setTransform(): void {}
  /** Как CanvasRenderingContext2D — для функций поз. */
  get ctx(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }
  /** Переносит записанное (единицы фасолины, центр в 0) в кадр (координаты силуэта). */
  into(f: PixelFrame): void {
    for (const h of this.hands) f.hands.push({ x: unitX(h.x), y: unitY(h.y), color: h.color });
    for (const s of this.sticks) f.sticks.push({ x0: unitX(s.x0), y0: unitY(s.y0), x1: unitX(s.x1), y1: unitY(s.y1), color: s.color });
    for (const b of this.boxes) {
      const x0 = unitX(b.x);
      const y0 = unitY(b.y);
      f.boxes.push({ x: x0, y: y0, w: Math.max(1, unitX(b.x + b.w) - x0), h: Math.max(1, unitY(b.y + b.h) - y0), color: b.color });
    }
  }
}

// ——— Сборка ———
const bodies = new LruCache<Grid>(PIXEL.cache.bodies);
function bodyGrid(sp: PixelSpec, dir: BodyDir, pose: BodyPose): Grid {
  const key = `${sp.key}|${dir}|${poseKey(pose)}`;
  let g = bodies.get(key);
  if (!g) {
    g = paintBody(sp, dir, pose);
    bodies.set(key, g);
  }
  return g;
}

/** Плечо руки (верх-лево кисти 2×2) по стороне с учётом подъёма корпуса; W — зеркально E. */
function shoulderOf(dir: PawnDir, arm: 'A' | 'B', ux: number, uy: number): [number, number] {
  const [a, b] = shoulders(dir === 'W' ? 'E' : dir);
  const p = arm === 'A' ? a : b;
  if (dir === 'W') return [2 * PIXEL.cx - p[0] - 1 - ux, p[1] + uy];
  return [p[0] + ux, p[1] + uy];
}

function drawArm(g: Grid, sp: PixelSpec, from: [number, number], hand: Hand, far: boolean, marks: boolean): void {
  const col = shade(sleeveOf(sp), far ? -0.3 : 0);
  const hx = Math.round(hand.x - 1);
  const hy = Math.round(hand.y - 1);
  line(g, from[0], from[1], hx, hy, col, PIXEL.arm.w);
  if (marks && sp.band) {
    const bx = Math.round(from[0] + (hx - from[0]) * 0.28);
    const by = Math.round(from[1] + (hy - from[1]) * 0.28);
    g.rect(bx, by, 2, 2, sp.band);
  }
}
function drawHand(g: Grid, hand: Hand, far: boolean): void {
  part(g, Math.round(hand.x - 1), Math.round(hand.y - 1), PIXEL.arm.hand, PIXEL.arm.hand, shade(hand.color, far ? -0.25 : 0));
}

/** Чем заняты руки в кадре: у оружия — обе (у ножа и дубинки — одна), иначе — по рукам к делу. */
interface ArmPlan {
  arms: number;
  gripH: Hand | null;
  foreH: Hand | null;
  work: { hand: Hand; arm: 'A' | 'B' }[];
}
function planArms(sp: PixelSpec, f: PixelFrame): ArmPlan {
  const side = f.dir === 'E' || f.dir === 'W';
  const plan: ArmPlan = { arms: ARM_A | ARM_B, gripH: null, foreH: null, work: [] };
  const gun = f.gun ? pixelGun(f.gun.id) : null;
  if (f.gun && gun) {
    const [gx, gy] = gunPoint(gun, gun.grip, f.gun.x, f.gun.y, f.gun.ang, f.gun.flip);
    plan.gripH = { x: gx, y: gy, color: sp.hand };
    if (gun.fore) {
      const [fx, fy] = gunPoint(gun, gun.fore, f.gun.x, f.gun.y, f.gun.ang, f.gun.flip);
      plan.foreH = { x: fx, y: fy, color: sp.hand };
    }
    if (f.reload && f.hands.length) plan.foreH = f.hands[f.hands.length - 1];
    plan.arms = plan.foreH ? 0 : ARM_B;
    return plan;
  }
  for (const h of f.hands.slice(0, 2)) {
    let arm: 'A' | 'B' = side ? (plan.work.length ? 'B' : 'A') : h.x < PIXEL.cx ? 'A' : 'B';
    if (plan.work.some((w) => w.arm === arm)) arm = arm === 'A' ? 'B' : 'A';
    plan.work.push({ hand: h, arm });
    plan.arms &= arm === 'A' ? ~ARM_A : ~ARM_B;
  }
  return plan;
}
function poseOf(f: PixelFrame, arms: number): BodyPose {
  return { legs: f.legs, frame: f.frame, arms, blink: f.blink, talk: f.talk };
}

/** Тело кадра (опущенные руки — только свободные) с контуром; в траншее — по пояс. */
function composeBody(sp: PixelSpec, f: PixelFrame, arms: number): Grid {
  const bodyDir: BodyDir = f.dir === 'W' ? 'E' : f.dir;
  let body = bodyGrid(sp, bodyDir, poseOf(f, arms));
  if (f.dir === 'W') body = body.mirror();
  const g = new Grid(PIXEL.grid.w + 2, PIXEL.grid.h + 2);
  g.ox = PIXEL.grid.ox + 1;
  g.oy = PIXEL.grid.oy + 1;
  g.paste(body, 1, 1);
  if (f.cut !== null) g.cutBelow(f.cut);
  return outline(g);
}

/**
 * Руки к оружию и к делу, ствол, предметы в руках — отдельным слоем с контуром (общим для пешек с одинаковыми
 * рукавами и кистями: кэш не зависит от лица и одежды). Спиной к нам — слой рисуется до тела (за ним).
 */
function composeLayer(sp: PixelSpec, f: PixelFrame, plan: ArmPlan): Grid | null {
  if (!plan.gripH && !plan.work.length && !f.sticks.length && !f.boxes.length) return null;
  const bodyDir: BodyDir = f.dir === 'W' ? 'E' : f.dir;
  const side = bodyDir === 'E';
  const back = bodyDir === 'N';
  if (back && !plan.gripH) return null;
  const [ux0, uy] = upperOffset(bodyDir, poseOf(f, plan.arms));
  const ux = f.dir === 'W' ? -ux0 : ux0;
  const wide = !!f.gun;
  const g = wide ? new Grid(CW, CH) : new Grid(PIXEL.grid.w + 8, PIXEL.grid.h + 2);
  g.ox = wide ? COX : PIXEL.grid.ox + 4;
  g.oy = wide ? COY : PIXEL.grid.oy + 1;
  if (f.gun && plan.gripH) {
    // Сбоку — рукоять ближней рукой, цевьё дальней; спереди и сзади — каждая к своей стороне.
    const gun = pixelGun(f.gun.id);
    const gArm: 'A' | 'B' = side ? 'A' : plan.gripH.x >= PIXEL.cx ? 'B' : 'A';
    const fArm: 'A' | 'B' = gArm === 'A' ? 'B' : 'A';
    if (plan.foreH) drawArm(g, sp, shoulderOf(f.dir, fArm, ux, uy), plan.foreH, side, !side && fArm === 'A');
    stampGun(g, gun, f.gun.x, f.gun.y, f.gun.ang, f.gun.flip);
    if (f.reload && plan.foreH && f.boxes.length) boxes(g, f);
    drawArm(g, sp, shoulderOf(f.dir, gArm, ux, uy), plan.gripH, false, side || gArm === 'A');
    if (plan.foreH) drawHand(g, plan.foreH, side && !f.reload);
    drawHand(g, plan.gripH, false);
  }
  if (!back) {
    for (const s of f.sticks) line(g, s.x0, s.y0, s.x1, s.y1, s.color, 1);
    if (!f.reload) boxes(g, f);
    for (const w of plan.work) drawArm(g, sp, shoulderOf(f.dir, w.arm, ux, uy), w.hand, side && w.arm === 'B', w.arm === 'A');
    for (const w of plan.work) drawHand(g, w.hand, side && w.arm === 'B');
  }
  if (f.cut !== null) g.cutBelow(f.cut);
  return outline(g);
}

/** Кадр целиком в одной сетке (тесты, листы): тело и слой рук. */
export function composeFrame(sp: PixelSpec, f: PixelFrame): Grid {
  const plan = planArms(sp, f);
  const body = composeBody(sp, f, plan.arms);
  const layer = composeLayer(sp, f, plan);
  if (!layer) return body;
  const g = new Grid(CW, CH);
  g.ox = COX;
  g.oy = COY;
  const back = f.dir === 'N';
  if (back) g.paste(layer, COX - layer.ox, COY - layer.oy);
  g.paste(body, COX - body.ox, COY - body.oy);
  if (!back) g.paste(layer, COX - layer.ox, COY - layer.oy);
  return g;
}
function boxes(g: Grid, f: PixelFrame): void {
  for (const b of f.boxes) g.rect(Math.round(b.x), Math.round(b.y), Math.max(1, Math.round(b.w)), Math.max(1, Math.round(b.h)), b.color);
}

// ——— Холсты и кэш ———
/** Счётчики кэша (замеры производительности, docs/rendering.md). */
export const pixelStats = { hits: 0, misses: 0, composeMs: 0 };
// Для замеров в браузере (скилл playtest): window.__pixelStats.
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __pixelStats: typeof pixelStats }).__pixelStats = pixelStats;

/** Спрайт: холст (свой или лист атласа), прямоугольник на нём, угол в координатах силуэта, множитель. */
interface Sprite { cv: HTMLCanvasElement; sx: number; sy: number; sw: number; sh: number; x0: number; y0: number; q: number }

/** Рамка рисунка сетки (занятые пиксели). */
function bbox(g: Grid): [number, number, number, number] {
  let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (!g.c[y * g.w + x]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? [0, 0, 0, 0] : [x0, y0, x1, y1];
}
/** Пиксели рамки сетки — в буфер изображения с отступом (ox, oy), каждый пиксель — квадрат q×q. */
function paintImage(d: Uint8ClampedArray, stride: number, g: Grid, x0: number, y0: number, w: number, h: number, q: number, ox: number, oy: number): void {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = g.c[(y + y0) * g.w + x + x0];
    if (!c) continue;
    const [r, gg, b] = rgb(c);
    for (let j = 0; j < q; j++) {
      let o = ((oy + y * q + j) * stride + ox + x * q) * 4;
      for (let i = 0; i < q; i++, o += 4) {
        d[o] = r;
        d[o + 1] = gg;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
    }
  }
}

/** Сетка в холст: обрезка по рисунку, каждый пиксель — квадрат q×q. */
function toSprite(g: Grid, q: number): Sprite {
  const [x0, y0, x1, y1] = bbox(g);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const cv = document.createElement('canvas');
  cv.width = w * q;
  cv.height = h * q;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(cv.width, cv.height);
  paintImage(img.data, cv.width, g, x0, y0, w, h, q, 0, 0);
  ctx.putImageData(img, 0, 0);
  return { cv, sx: 0, sy: 0, sw: cv.width, sh: cv.height, x0: x0 - g.ox, y0: y0 - g.oy, q };
}

const r1 = (v: number) => Math.round(v);
/** Тело на запад — то же, что на восток, отражённое при рисовании: в кэше одно на две стороны. */
function bodyKey(sp: PixelSpec, f: PixelFrame, arms: number, q: number): string {
  return `${sp.key}|${f.dir === 'W' ? 'E' : f.dir}|${f.legs}${f.frame}${f.blink ? 'b' : ''}${f.talk ? 't' : ''}|${arms}|${f.cut ?? ''}|${q}`;
}
/** Ключ слоя рук: рукава, кисти, повязка, сторона, подъём корпуса, ствол, руки к делу и предметы. */
function layerKey(sp: PixelSpec, f: PixelFrame, plan: ArmPlan, q: number): string {
  const bodyDir: BodyDir = f.dir === 'W' ? 'E' : f.dir;
  const [ux, uy] = upperOffset(bodyDir, poseOf(f, plan.arms));
  let k = `${sleeveOf(sp)}|${sp.hand}|${sp.band ?? ''}|${f.dir}|${ux},${uy}|${f.cut ?? ''}|${q}`;
  if (f.gun) k += `|g${f.gun.id}:${r1(f.gun.x)},${r1(f.gun.y)}:${Math.round((f.gun.ang / (Math.PI * 2)) * PIXEL.weapon.angleSteps)}${f.gun.flip ? 'f' : ''}`;
  if (f.reload) k += '|r';
  for (const h of f.hands) k += `|h${r1(h.x)},${r1(h.y)}${h.color}`;
  for (const s of f.sticks) k += `|s${r1(s.x0)},${r1(s.y0)},${r1(s.x1)},${r1(s.y1)}${s.color}`;
  for (const b of f.boxes) k += `|b${r1(b.x)},${r1(b.y)},${r1(b.w)},${r1(b.h)}${b.color}`;
  return k;
}

/**
 * Ствол в руках по позе оружия игры (weaponPose: рукоять, угол, отражение, отдача, перезарядка, удар): рукоять
 * переводится в координаты силуэта линейно (дуло там же, где вспышка) и поднимается к груди на PIXEL.gunLift.
 */
export function gunHold(c: Character, reloading: boolean, ang: number, swing: MeleeSwing | null = null): GunHold | null {
  if (!c.weapon) return null;
  const p = weaponPose(c, reloading, ang, swing);
  const [x, y] = worldToFigure(p.x - c.x, p.y - c.y);
  return { id: c.weapon, x, y: y - PIXEL.gunLift, ang: p.ang, flip: p.flip };
}

/** Угол ствола — шагами (кэш), как в ключе. */
export function quantizeAngle(a: number): number {
  const n = PIXEL.weapon.angleSteps;
  return (Math.round((a / (Math.PI * 2)) * n) / n) * Math.PI * 2;
}

function cached(cache: LruCache<Sprite>, key: string, make: () => Grid | null, q: number): Sprite | null {
  let spr = cache.get(key);
  if (spr) {
    pixelStats.hits++;
    return spr === EMPTY ? null : spr;
  }
  const t = performance.now();
  const g = make();
  spr = g ? toSprite(g, q) : EMPTY;
  cache.set(key, spr);
  pixelStats.misses++;
  pixelStats.composeMs += performance.now() - t;
  return spr === EMPTY ? null : spr;
}
const EMPTY: Sprite = { cv: null as unknown as HTMLCanvasElement, sx: 0, sy: 0, sw: 0, sh: 0, x0: 0, y0: 0, q: 1 };
const layers = new LruCache<Sprite>(PIXEL.cache.layers);
const bodySprites = new LruCache<Sprite>(PIXEL.cache.sprites);

function blit(ctx: CanvasRenderingContext2D, spr: Sprite, sx: number, sy: number, s: number, k: number, mirror = false): void {
  const w = (spr.sw / spr.q) * k;
  const h = (spr.sh / spr.q) * k;
  const y = Math.round(sy + PIXEL.footY * s + (spr.y0 - PIXEL.ground) * k);
  if (!mirror) {
    ctx.drawImage(spr.cv, spr.sx, spr.sy, spr.sw, spr.sh, Math.round(sx + (spr.x0 - PIXEL.cx) * k), y, w, h);
    return;
  }
  // Отражение вокруг оси силуэта (между пикселями cx и cx + 1 — как Grid.mirror).
  const left = Math.round(sx + (2 * PIXEL.cx + 1 - spr.x0 - PIXEL.cx) * k - w);
  ctx.save();
  ctx.translate(left + w, y);
  ctx.scale(-1, 1);
  ctx.drawImage(spr.cv, spr.sx, spr.sy, spr.sw, spr.sh, 0, 0, w, h);
  ctx.restore();
}

/**
 * Нарисовать кадр пешки: (sx, sy) — центр персонажа на экране, s — масштаб вида (px экрана на px мира).
 * Тело и слой рук — из своих кэшей; холсты — целым множителем (чёткие пиксели), на экран — с уменьшением до
 * точного масштаба.
 */
export function drawPixelFrame(ctx: CanvasRenderingContext2D, look: PawnLook, f: PixelFrame, sx: number, sy: number, s: number): void {
  const sp = pixelSpecOf(look);
  const k = s * PIXEL.unit;
  const q = Math.max(1, Math.ceil(k - 0.04));
  if (f.gun) f.gun.ang = quantizeAngle(f.gun.ang);
  const plan = planArms(sp, f);
  const west = f.dir === 'W';
  const body = cached(bodySprites, bodyKey(sp, f, plan.arms, q), () => composeBody(sp, west ? { ...f, dir: 'E' } : f, plan.arms), q)!;
  const busy = !!plan.gripH || plan.work.length > 0 || f.sticks.length > 0 || f.boxes.length > 0;
  const layer = busy ? cached(layers, layerKey(sp, f, plan, q), () => composeLayer(sp, f, plan), q) : null;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = q - k > 0.05;
  const back = f.dir === 'N';
  if (layer && back) blit(ctx, layer, sx, sy, s, k);
  blit(ctx, body, sx, sy, s, k, west);
  if (layer && !back) blit(ctx, layer, sx, sy, s, k);
  ctx.imageSmoothingEnabled = prev;
}

const still = newFrame();
/**
 * Пешка стоя без дела (как drawPawnCached у фасолин): (x, y) — центр пешки, ps — масштаб пешки (s × PAWN.scale).
 * Для лежащих (тела, раненые, спящие, нокаут) — вызывающий поворачивает холст.
 */
export function drawPixelSprite(ctx: CanvasRenderingContext2D, look: PawnLook, x: number, y: number, ps: number, dir: PawnDir, blink = false): void {
  still.dir = dir;
  still.blink = blink;
  drawPixelFrame(ctx, look, still, x, y, ps / PAWN.scale);
}

/** Для тестов и листов: сетка кадра без DOM (без ствола). */
export function frameGrid(look: PawnLook, f: PixelFrame): Grid {
  return composeFrame(pixelSpecOf(look), { ...f, gun: null });
}

