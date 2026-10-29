/**
 * Сборка пиксельной пешки на кадр: тело — один спрайт (ноги, опущенные руки, корпус с головой; корпус со сдвигом
 * присел / сидит / выдох — целыми пикселями силуэта), подскок в шаг и бег — всей пешкой, плавно, целыми экранными
 * пикселями. Части тела (ноги и руки — общие у пешек в одинаковой одежде, корпус — свой у внешности и стороны) — в
 * кэше сеток, кадры — в кэше спрайтов (pixelSprites). Руки к делу — те же анимации poses.ts (ест, курит,
 * жестикулирует, бьёт, бросает, перезаряжает), записанные «вместо рисования», — отдельным спрайтом поверх. Ствол —
 * модель игры тонким контуром (pixelWeapons), кисти — поверх. Моргание и речь — пиксели поверх лица.
 * Описание — docs/rendering.md «Пиксельные пешки».
 */
import type { WeaponId } from '../../config/items';
import { PAWN } from '../../config/pawns';
import { WEAPON_POSE } from '../../config/weaponSprites';
import { PIXEL } from '../../config/pixelPawns';
import { WEAPON_SPRITES } from '../../config/weaponSprites';
import { Grid, line, outline, part, shade } from './grid';
import { ARM_A, ARM_B, faceSpots, newGrid, paintArmE, paintArmsSN, paintBack, paintLegs, paintUpper, shoulders, sleeveOf, type BodyDir, type Legs } from './pixelBody';
import { pixelSpecOf, type PixelSpec } from './pixelSpec';
import { drawGun, gunPoint } from './pixelWeapons';
import { EMPTY, SpriteCache, type Sprite } from './pixelSprites';
import { LruCache } from '../../core/spriteCache';
import type { PawnDir, PawnLook } from '../PawnRenderer';
import type { Character } from '../Character';
import type { MeleeSwing } from '../meleePose';
import { weaponPose } from '../weaponPose';

export interface Hand { x: number; y: number; color: string }
export interface Stick { x0: number; y0: number; x1: number; y1: number; color: string }
export interface Box { x: number; y: number; w: number; h: number; color: string }
/** Ствол в руках: точка (0, 0) модели — в координатах силуэта, угол, отражён ли (целится влево). */
export interface GunHold { id: WeaponId; x: number; y: number; ang: number; flip: boolean }

/** Кадр пешки: сторона, ноги, сдвиг корпуса, мимика, ствол, руки к делу и предметы (координаты силуэта). */
export interface PixelFrame {
  dir: PawnDir;
  legs: Legs;
  frame: number;
  /** Корпус, руки и ствол над ногами: сдвиг в пикселях силуэта (дробный; x — вперёд по взгляду сбоку). */
  bodyX: number;
  bodyY: number;
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
  /** Крен, рад: поворот всей пешки вокруг подошв (по ходу, покачивание в шаг; плюс — по часовой). */
  lean: number;
}

export function newFrame(): PixelFrame {
  return { dir: 'S', legs: 'stand', frame: 0, bodyX: 0, bodyY: 0, blink: false, talk: false, gun: null, hands: [], sticks: [], boxes: [], reload: false, cut: null, lean: 0 };
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

// ——— Поза ———
const OFF: [number, number] = [0, 0];
/**
 * Подскок пешки в шаг и в бег (пиксели силуэта, дробно — на экран целыми экранными пикселями, плавно): выше на
 * проходе ноги (phase — доля цикла 0..1), на бегу — вынос вперёд. Один массив на все вызовы.
 */
export function bodyOffset(legs: Legs, phase: number): [number, number] {
  const B = PIXEL.bob;
  OFF[0] = 0;
  OFF[1] = 0;
  if (legs === 'walk' || legs === 'run') {
    const run = legs === 'run';
    OFF[1] = -(1 - Math.abs(Math.sin(phase * Math.PI * 2))) * (run ? B.run : B.walk);
    OFF[0] = run ? B.lean : 0;
  }
  return OFF;
}
/** Корпус и руки над ногами — целыми пикселями силуэта, в спрайте: присел +4, сидит +3, выдох стоя (кадр 1) +1. */
export function upperShift(legs: Legs, frame: number): number {
  return legs === 'crouch' ? 4 : legs === 'sit' ? 3 : legs === 'stand' && frame === 1 ? 1 : 0;
}
/** Стоя — на выдохе (своя фаза у каждого): кадр 1. */
export function breathing(now: number, id: number): boolean {
  return Math.sin((now / PAWN.anim.idle.breathePeriod) * Math.PI * 2 + id * 1.7) > PIXEL.breathe;
}

/** Плечо руки (верх-лево кисти 2×2): S/N — левое и правое на экране, сбоку — ближнее (A) и дальнее (B); W — зеркально. */
function shoulderOf(dir: PawnDir, arm: 'A' | 'B'): [number, number] {
  const [a, b] = shoulders(dir === 'W' ? 'E' : dir);
  const p = arm === 'A' ? a : b;
  return dir === 'W' ? [2 * PIXEL.cx - p[0] - 1, p[1]] : [p[0], p[1]];
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
  /** Кисть на цевье — дальняя (сбоку, не перезарядка): темнее. */
  foreFar: boolean;
  work: { hand: Hand; arm: 'A' | 'B' }[];
}
const plan: ArmPlan = { arms: 3, gripH: null, foreH: null, foreFar: false, work: [] };
const GRIP: Hand = { x: 0, y: 0, color: '' };
const FORE: Hand = { x: 0, y: 0, color: '' };
function planArms(sp: PixelSpec, f: PixelFrame): ArmPlan {
  const side = f.dir === 'E' || f.dir === 'W';
  plan.arms = ARM_A | ARM_B;
  plan.gripH = null;
  plan.foreH = null;
  plan.foreFar = false;
  plan.work.length = 0;
  if (f.gun) {
    const sp0 = WEAPON_SPRITES[f.gun.id];
    const [gx, gy] = gunPoint(sp0.grip, f.gun.x, f.gun.y, f.gun.ang, f.gun.flip);
    GRIP.x = gx;
    GRIP.y = gy;
    GRIP.color = sp.hand;
    plan.gripH = GRIP;
    if (sp0.fore) {
      const [fx, fy] = gunPoint(sp0.fore, f.gun.x, f.gun.y, f.gun.ang, f.gun.flip);
      FORE.x = fx;
      FORE.y = fy;
      FORE.color = sp.hand;
      plan.foreH = FORE;
      plan.foreFar = side;
    }
    if (f.reload && f.hands.length) {
      plan.foreH = f.hands[f.hands.length - 1];
      plan.foreFar = false;
    }
    plan.arms = plan.foreH ? 0 : ARM_B;
    return plan;
  }
  for (let i = 0; i < f.hands.length && i < 2; i++) {
    const h = f.hands[i];
    let arm: 'A' | 'B' = side ? (plan.work.length ? 'B' : 'A') : h.x < PIXEL.cx ? 'A' : 'B';
    if (plan.work.length && plan.work[0].arm === arm) arm = arm === 'A' ? 'B' : 'A';
    plan.work.push({ hand: h, arm });
    plan.arms &= arm === 'A' ? ~ARM_A : ~ARM_B;
  }
  return plan;
}

/**
 * Нарисованные части (ноги, руки, корпус, накидка) — в кэше сеток: кадр тела собирается из готовых частей (ноги и руки
 * общие у одинаковой одежды, корпус — один на внешность и сторону), а не рисуется заново на каждый кадр шага.
 */
const parts = new LruCache<Grid>(PIXEL.cache.parts);
const NONE = new Grid(1, 1);
function partGrid(key: string, make: () => Grid | null): Grid | null {
  let g = parts.get(key);
  if (!g) {
    g = make() ?? NONE;
    parts.set(key, g);
  }
  return g === NONE ? null : g;
}

/**
 * Тело кадра одной сеткой: накидка, ноги, опущенные руки (только свободные), корпус с головой; корпус и руки — со
 * сдвигом upperShift. Контур — общий. Запад — восток, отражённый при рисовании.
 */
function composeBody(sp: PixelSpec, f: PixelFrame, arms: number): Grid {
  const bd: BodyDir = f.dir === 'W' ? 'E' : (f.dir as BodyDir);
  // Стоя кадр 1 — выдох: ноги и руки те же, что в кадре 0.
  const frame = f.legs === 'stand' ? 0 : f.frame;
  const pose = { legs: f.legs, frame };
  const lf = `${f.legs}${frame}`;
  const uy = upperShift(f.legs, f.frame);
  const g = newGrid();
  const put = (layer: Grid | null, dy: number) => {
    if (layer) g.paste(layer, 0, dy);
  };
  if (sp.cape) put(partGrid(`B|${sp.key}|${bd}`, () => paintBack(sp, bd)), uy);
  put(partGrid(`L|${sp.legsKey}|${bd}|${lf}`, () => paintLegs(sp, bd, pose)), 0);
  if (bd === 'E') {
    if (arms & ARM_B) put(partGrid(`F|${sp.armsKey}|${lf}`, () => paintArmE(sp, pose, true)), uy);
    put(partGrid(`U|${sp.key}|${bd}`, () => paintUpper(sp, bd)), uy);
    if (arms & ARM_A) put(partGrid(`N|${sp.armsKey}|${lf}`, () => paintArmE(sp, pose, false)), uy);
  } else {
    if (arms) put(partGrid(`A|${sp.armsKey}|${bd}|${lf}|${arms}`, () => paintArmsSN(sp, bd, pose, arms)), uy);
    put(partGrid(`U|${sp.key}|${bd}`, () => paintUpper(sp, bd)), uy);
  }
  if (f.cut !== null) g.cutBelow(f.cut);
  return outline(g);
}

/**
 * Руки к делу и к оружию (без ствола и без кистей на стволе — их рисует drawPixelFrame поверх ствола), предметы.
 * Пусто — null. Координаты — без сдвига корпуса (он при рисовании).
 */
function composeAction(sp: PixelSpec, f: PixelFrame, p: ArmPlan, cut: number | null): Grid | null {
  if (!p.gripH && !p.work.length && !f.sticks.length && !f.boxes.length) return null;
  const side = f.dir === 'E' || f.dir === 'W';
  const back = f.dir === 'N';
  const g = new Grid(PIXEL.grid.w + 16, PIXEL.grid.h + 8);
  g.ox = PIXEL.grid.ox + 8;
  g.oy = PIXEL.grid.oy + 4;
  if (p.gripH) {
    const gArm: 'A' | 'B' = side ? 'A' : p.gripH.x >= PIXEL.cx ? 'B' : 'A';
    const fArm: 'A' | 'B' = gArm === 'A' ? 'B' : 'A';
    if (p.foreH) drawArm(g, sp, shoulderOf(f.dir, fArm), p.foreH, p.foreFar, !side && fArm === 'A');
    drawArm(g, sp, shoulderOf(f.dir, gArm), p.gripH, false, side || gArm === 'A');
    if (f.reload) boxes(g, f);
  }
  if (!back) {
    for (const s of f.sticks) line(g, s.x0, s.y0, s.x1, s.y1, s.color, 1);
    if (!f.reload) boxes(g, f);
    for (const w of p.work) drawArm(g, sp, shoulderOf(f.dir, w.arm), w.hand, side && w.arm === 'B', w.arm === 'A');
    for (const w of p.work) drawHand(g, w.hand, side && w.arm === 'B');
  }
  if (cut !== null) g.cutBelow(cut);
  return outline(g);
}
function boxes(g: Grid, f: PixelFrame): void {
  for (const b of f.boxes) g.rect(Math.round(b.x), Math.round(b.y), Math.max(1, Math.round(b.w)), Math.max(1, Math.round(b.h)), b.color);
}

// ——— Кэш и ключи ———
/**
 * Счётчики кэша (замеры производительности, docs/rendering.md): попадания, промахи (собран новый спрайт), из них
 * сразу холстом (sync), время сборки, показы прежнего кадра; onMiss — ключ промаха (разбор, какие кадры не в кэше).
 */
export const pixelStats = { hits: 0, misses: 0, sync: 0, composeMs: 0, fallbacks: 0, onMiss: null as ((key: string) => void) | null };
// Для замеров в браузере (скилл playtest): window.__pixelStats.
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __pixelStats: typeof pixelStats }).__pixelStats = pixelStats;

const bodies = new SpriteCache(PIXEL.cache.bodies);
const actions = new SpriteCache(PIXEL.cache.actions);
/**
 * Последний показанный спрайт пешки (тело — по внешности, стороне и занятым рукам; руки к делу — по внешности,
 * стороне и делу): им заменяется новый кадр, пока тот не готов.
 */
const last = new Map<string, Sprite>();
let budgetUsed = 0;
/** Кадр карты (между pixelFrameStart и pixelFrameEnd): новый кадр пешки можно показать с опозданием на кадр-другой. */
let lazy = false;
/** Начало кадра карты: бюджет сборки спрайтов заново (вызывает EntityRenderer.drawBodies). */
export function pixelFrameStart(): void {
  budgetUsed = 0;
  lazy = true;
}
/** Конец кадра карты: дальше (интерфейс, листы) — каждый кадр сразу точно. */
export function pixelFrameEnd(): void {
  lazy = false;
}
const EMPTY_GRID = new Grid(1, 1);

/** Прежний спрайт пешки по ключу, если ещё жив (не вытеснен). */
function lastOf(lkey: string | null): Sprite | undefined {
  const spr = lkey === null ? undefined : last.get(lkey);
  return spr && !spr.dead ? spr : undefined;
}

/**
 * Спрайт слоя: из кэша; промах — собрать сетку и заказать картинку (готовится асинхронно), а пока показать прежний
 * спрайт этой пешки (lkey, иначе alt — например, тело той же пешки в другую сторону: повернётся на кадр позже).
 * Сборка за кадр — в бюджете composeBudget: сверх него — тоже прежний. Прежнего нет или кадр не карты — сразу холстом.
 */
function layer(cache: SpriteCache, key: string, lkey: string, alt: string | null, make: () => Grid | null): Sprite {
  let spr = cache.get(key);
  if (spr) pixelStats.hits++;
  else {
    const prev = lazy ? lastOf(lkey) ?? lastOf(alt) : undefined;
    if (prev && (cache.waiting(key) || budgetUsed > PIXEL.composeBudget)) {
      pixelStats.fallbacks++;
      return prev;
    }
    const t = performance.now();
    const g = make() ?? EMPTY_GRID;
    spr = (prev && cache.request(key, g)) || prev;
    if (!spr) {
      spr = cache.now(key, g);
      pixelStats.sync++;
    }
    const ms = performance.now() - t;
    budgetUsed += ms;
    pixelStats.misses++;
    pixelStats.composeMs += ms;
    pixelStats.onMiss?.(key);
  }
  last.set(lkey, spr);
  if (alt !== null) last.set(alt, spr);
  if (last.size > PIXEL.cache.bodies) last.delete(last.keys().next().value as string);
  return spr;
}

const r1 = (v: number) => Math.round(v);
function actionKey(sp: PixelSpec, f: PixelFrame, p: ArmPlan, cut: number | null): string {
  let k = `X|${sleeveOf(sp)}|${sp.hand}|${sp.band ?? ''}|${f.dir}|${cut ?? ''}|${f.reload ? 'r' : ''}`;
  if (p.gripH) k += `|g${r1(p.gripH.x)},${r1(p.gripH.y)}`;
  if (p.foreH) k += `|f${r1(p.foreH.x)},${r1(p.foreH.y)}${p.foreFar ? 'd' : ''}`;
  for (const w of p.work) k += `|h${w.arm}${r1(w.hand.x)},${r1(w.hand.y)}${w.hand.color}`;
  for (const s of f.sticks) k += `|s${r1(s.x0)},${r1(s.y0)},${r1(s.x1)},${r1(s.y1)}${s.color}`;
  for (const b of f.boxes) k += `|b${r1(b.x)},${r1(b.y)},${r1(b.w)},${r1(b.h)}${b.color}`;
  return k;
}

// ——— Рисование ———
/**
 * Спрайт на экран: (ox, oy) — экранная точка начала координат силуэта (целая, с подскоком), k — px экрана на пиксель
 * силуэта, shift — сдвиг по высоте в пикселях силуэта (руки к делу и ствол — вместе с корпусом), mirror — запад (ось —
 * между пикселями cx и cx + 1). Угол спрайта — точно на сетке силуэта (без округления): пиксель силуэта всегда
 * ложится на одни и те же пиксели экрана, в каком бы кадре и слое он ни был (без дрожания при дробном масштабе).
 */
function blit(ctx: CanvasRenderingContext2D, spr: Sprite, ox: number, oy: number, k: number, shift: number, mirror: boolean): void {
  if (spr === EMPTY) return;
  const w = spr.w * k;
  const h = spr.h * k;
  const y = oy + (spr.y0 + shift) * k;
  if (!mirror) {
    ctx.drawImage(spr.cv, 0, 0, spr.w, spr.h, ox + spr.x0 * k, y, w, h);
    return;
  }
  const x = ox + (2 * PIXEL.cx + 1 - spr.x0 - spr.w) * k;
  ctx.translate(x + w, y);
  ctx.scale(-1, 1);
  ctx.drawImage(spr.cv, 0, 0, spr.w, spr.h, 0, 0, w, h);
  ctx.scale(-1, 1);
  ctx.translate(-(x + w), -y);
}

/** Кисть на стволе — поверх модели: квадрат цвета руки с тёмной каймой в экранный пиксель. */
function handRect(ctx: CanvasRenderingContext2D, h: Hand, ox: number, oy: number, k: number, far: boolean): void {
  const size = Math.round(PIXEL.arm.hand * k);
  const x = Math.round(ox + h.x * k - size / 2);
  const y = Math.round(oy + h.y * k - size / 2);
  ctx.fillStyle = PIXEL.weapon.ink;
  ctx.fillRect(x - 1, y - 1, size + 2, size + 2);
  ctx.fillStyle = far ? shade(h.color, -0.25) : h.color;
  ctx.fillRect(x, y, size, size);
}

/** Моргание и речь — пиксели поверх лица (shift — корпус ниже: присел, сидит, выдох), по той же сетке, что спрайт. */
function faceOverlay(ctx: CanvasRenderingContext2D, sp: PixelSpec, f: PixelFrame, ox: number, oy: number, k: number, shift: number): void {
  if (!f.blink && !f.talk) return;
  const spots = faceSpots(sp, f.dir === 'W' ? 'E' : (f.dir as BodyDir));
  if (!spots) return;
  const west = f.dir === 'W';
  const at = (x: number, y: number, c: string) => {
    const fx = west ? 2 * PIXEL.cx - x : x;
    const x0 = Math.round(ox + fx * k);
    const y0 = Math.round(oy + (y + shift) * k);
    ctx.fillStyle = c;
    ctx.fillRect(x0, y0, Math.max(1, Math.round(ox + (fx + 1) * k) - x0), Math.max(1, Math.round(oy + (y + shift + 1) * k) - y0));
  };
  if (f.blink) for (const [x, y] of spots.eyes) at(x, y, shade(sp.skin, -0.35));
  if (f.talk) {
    const [x, y] = spots.mouth;
    const wide = f.dir === 'S' ? 2 : 1;
    for (let i = 0; i < wide; i++) {
      at(x + i, y, PIXEL.color.mouth);
      at(x + i, y + 1, shade(PIXEL.color.mouth, -0.3));
    }
  }
}

/**
 * Нарисовать кадр пешки: (sx, sy) — центр персонажа на экране, s — масштаб вида (px экрана на px мира). Тело —
 * одним спрайтом; руки к делу, ствол и кисти — поверх (спиной к нам — за телом); подскок в шаг (bodyX, bodyY) —
 * всей пешкой, целыми экранными пикселями. Учитывает текущее преобразование холста (лежащие — повёрнуты вызывающим).
 */
export function drawPixelFrame(ctx: CanvasRenderingContext2D, look: PawnLook, f: PixelFrame, sx: number, sy: number, s: number): void {
  const sp = pixelSpecOf(look);
  const k = s * PIXEL.unit;
  const p = planArms(sp, f);
  const west = f.dir === 'W';
  const bd: BodyDir = west ? 'E' : (f.dir as BodyDir);
  const ox = Math.round(sx - PIXEL.cx * k) + (bd === 'E' ? Math.round((west ? -f.bodyX : f.bodyX) * k) : 0);
  const oy = Math.round(sy + PIXEL.footY * s - PIXEL.ground * k) + Math.round(f.bodyY * k);
  const uy = upperShift(f.legs, f.frame);
  // Тело и руки к делу — из кэша; нового кадра ещё нет — пока прежний кадр этой пешки (догонит через кадр-другой).
  const cut = f.cut === null ? null : f.cut - uy;
  const tail = `${p.arms}|${f.cut ?? ''}`;
  const body = layer(bodies, `${sp.key}|${bd}|${f.legs}${f.frame}|${tail}`, `B|${sp.key}|${bd}|${tail}`, `T|${sp.key}|${tail}`, () => composeBody(sp, f, p.arms));
  const busy = p.gripH || p.work.length || f.sticks.length || f.boxes.length;
  const action = busy
    ? layer(actions, actionKey(sp, f, p, cut), `A|${sp.key}|${f.dir}|${f.gun?.id ?? ''}|${p.work.length}|${f.reload ? 'r' : ''}`, null, () => composeAction(sp, f, p, cut))
    : null;
  // Крен — поворот всей пешки вокруг подошв. Крупнее пикселя без крена — без сглаживания (чёткие пиксели); мельче
  // (камера далеко) и в крене — со сглаживанием (PIXEL.lean.smooth): иначе пиксели «шевелятся» при каждом угле.
  const tilt = Math.abs(f.lean) > PIXEL.lean.min;
  if (tilt) {
    const fx = sx;
    const fy = sy + PIXEL.footY * s;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(f.lean);
    ctx.translate(-fx, -fy);
  }
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = k < 1 || (tilt && PIXEL.lean.smooth);
  const behind = bd === 'N';
  if (behind) drawHeld(ctx, f, p, action, ox, oy, k, uy);
  blit(ctx, body, ox, oy, k, 0, west);
  if (!behind) drawHeld(ctx, f, p, action, ox, oy, k, uy);
  faceOverlay(ctx, sp, f, ox, oy, k, uy);
  ctx.imageSmoothingEnabled = prevSmooth;
  if (tilt) ctx.restore();
}

/** Руки к делу (слой), ствол (модель) и кисти на нём — со сдвигом корпуса uy. */
function drawHeld(ctx: CanvasRenderingContext2D, f: PixelFrame, p: ArmPlan, action: Sprite | null, ox: number, oy: number, k: number, uy: number): void {
  if (action) blit(ctx, action, ox, oy, k, uy, false);
  if (!f.gun) return;
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.save();
  drawGun(ctx, f.gun.id, ox + f.gun.x * k, oy + (f.gun.y + uy) * k, f.gun.ang, f.gun.flip, k);
  ctx.restore();
  ctx.imageSmoothingEnabled = sm;
  const hy = oy + Math.round(uy * k);
  if (p.foreH) handRect(ctx, p.foreH, ox, hy, k, p.foreFar);
  if (p.gripH) handRect(ctx, p.gripH, ox, hy, k, false);
}

/**
 * Ствол в руках по позе оружия игры (weaponPose: рукоять, угол, отражение, отдача, перезарядка, удар): точка модели
 * переводится в координаты силуэта линейно (как у фасолин) и поднимается к груди на PIXEL.gunLift.
 */
export function gunHold(c: Character, reloading: boolean, ang: number, swing: MeleeSwing | null = null): GunHold | null {
  if (!c.weapon) return null;
  const pw = weaponPose(c, reloading, ang, swing);
  const [x, y] = worldToFigure(pw.x - c.x, pw.y - c.y);
  return { id: c.weapon, x, y: y - PIXEL.gunLift, ang: pw.ang, flip: pw.flip };
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

/**
 * Кадр целиком в одной сетке без DOM (тесты, листы): тело и руки к делу (без ствола — он модель, не пиксели),
 * подскок — целыми пикселями силуэта.
 */
export function composeFrame(sp: PixelSpec, f: PixelFrame): Grid {
  const ff = { ...f, gun: null };
  const p = planArms(sp, ff);
  const west = f.dir === 'W';
  const uy = upperShift(f.legs, f.frame);
  const cut = f.cut === null ? null : f.cut - uy;
  const g = new Grid(PIXEL.grid.w + 16, PIXEL.grid.h + 8);
  g.ox = PIXEL.grid.ox + 8;
  g.oy = PIXEL.grid.oy + 4;
  const bx = west ? -Math.round(f.bodyX) : Math.round(f.bodyX);
  const by = Math.round(f.bodyY);
  const put = (layer: Grid | null, dx: number, dy: number) => {
    if (layer) g.paste(layer, g.ox - layer.ox + dx, g.oy - layer.oy + dy);
  };
  const body = composeBody(sp, ff, p.arms);
  const action = composeAction(sp, ff, p, cut);
  if (f.dir === 'N') put(action, bx, by + uy);
  put(west ? body.mirror() : body, bx, by);
  if (f.dir !== 'N') put(action, bx, by + uy);
  return g;
}

/** Для тестов и листов: сетка кадра без DOM. */
export function frameGrid(look: PawnLook, f: PixelFrame): Grid {
  return composeFrame(pixelSpecOf(look), f);
}
