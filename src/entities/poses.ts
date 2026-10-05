import type { Character } from './Character';
import { PAWN } from '../config/pawns';
import { handColor, type PawnDir, type PawnLook } from './PawnRenderer';

/**
 * Бытовые анимации пешек (config/pawns.ts → PAWN.anim) — только отрисовка, на логику не влияют.
 * Тело — тот же спрайт из кэша; поза меняет наклон, сжатие и смещение, а руки-кружки с предметами
 * (ложка, карты, сигарета) рисуются поверх. Всё считается по часам и id пешки (фаза сдвинута, чтобы
 * толпа не дышала и не жестикулировала в такт), без выделения памяти на кадр.
 */

export type PoseKind = 'stand' | 'sleep' | 'sit';

/** Результат анимации на кадр: что добавить к ходьбе и позе. Один объект на все пешки — перезаписывается. */
export interface PawnAnim {
  kind: PoseKind;
  /** Добавка к наклону, рад. */
  lean: number;
  /** Множитель высоты (сжатие к ступням). */
  squash: number;
  /** Смещение вниз, px мира (сел, лёг). */
  drop: number;
  /** Подъём корпуса, px мира (дыхание, кивок говорящего). */
  lift: number;
  /** Рисовать ли ступни (сидящему и спящему — нет). */
  feet: boolean;
}

export const anim: PawnAnim = { kind: 'stand', lean: 0, squash: 1, drop: 0, lift: 0, feet: true };

const TAU = Math.PI * 2;

/** Фаза пешки — свой сдвиг по id (рад). */
function phaseOf(c: Character): number {
  return c.id * 2.399;
}

/** Говорит вслух сейчас (реплика, не рация). */
export function isTalking(c: Character, now: number): boolean {
  return !!c.speech && c.speech.until > now && c.speech.kind === 'say';
}

/**
 * Поза пешки на этот кадр: спит под одеялом, сидит, стоит без дела (вес с ноги на ногу, дыхание),
 * говорит (кивает). Идущая, целящаяся и присевшая пешка — как раньше (поза «стоит» без добавок).
 */
export function animOf(c: Character, now: number, walking: boolean, aiming: boolean): PawnAnim {
  const A = PAWN.anim;
  const ph = phaseOf(c);
  const a = anim;
  a.kind = 'stand';
  a.lean = 0;
  a.squash = 1;
  a.drop = 0;
  a.lift = 0;
  a.feet = true;
  if (walking) return a;
  if (c.asleep) {
    const S = A.sleep;
    a.kind = 'sleep';
    a.squash = S.squash * (1 + S.breathe * Math.sin((now / S.period) * TAU + ph));
    a.drop = S.drop;
    a.feet = false;
    return a;
  }
  if (c.seated) {
    const S = A.sit;
    a.kind = 'sit';
    a.squash = S.squash;
    a.drop = S.drop;
    a.lean = Math.sin((now / S.period) * TAU + ph) * S.sway;
    a.feet = false;
    if (isTalking(c, now)) a.lift = Math.max(0, Math.sin(now * A.talk.rate * 0.7 + ph)) * A.talk.bob;
    return a;
  }
  if (aiming || c.crouch) return a;
  const I = A.idle;
  a.lean = Math.sin((now / I.period) * TAU + ph) * I.lean;
  a.squash = 1 + I.breathe * Math.sin((now / I.breathePeriod) * TAU + ph * 0.7);
  a.lift = (0.5 + 0.5 * Math.sin((now / I.breathePeriod) * TAU + ph * 0.7)) * I.bob;
  if (isTalking(c, now)) a.lift += Math.max(0, Math.sin(now * A.talk.rate * 0.7 + ph)) * A.talk.bob;
  return a;
}

function smooth(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

/**
 * Цикл перекура: raise — как высоко рука с сигаретой (0 — внизу, 1 — у рта), exhale — ход выдоха
 * 0..1 (-1 — не выдыхает). Эффекты дымка берут отсюда же.
 */
export function smokeCycle(c: Character, now: number, out: { raise: number; exhale: number }): void {
  const S = PAWN.anim.smoke;
  const u = ((now / S.period + phaseOf(c) / TAU) % 1 + 1) % 1;
  const up = S.start + S.raise;
  const top = up + S.hold;
  const down = top + S.raise;
  out.raise = u < S.start ? 0 : u < up ? smooth((u - S.start) / S.raise) : u < top ? 1 : u < down ? 1 - smooth((u - top) / S.raise) : 0;
  out.exhale = u >= top && u < top + S.exhale ? (u - top) / S.exhale : -1;
}

const cyc = { raise: 0, exhale: -1 };

/** Руки в профиль/анфас: x в px пешки по стороне (в профиль ближняя к нам рука — у корпуса). */
function handX(dir: PawnDir, side: number): number {
  if (dir === 'E') return 1.6 * side;
  if (dir === 'W') return -1.6 * side;
  return 7.4 * side;
}

function drawHand(ctx: CanvasRenderingContext2D, x: number, y: number, ps: number, color: string): void {
  const H = PAWN.anim.hand;
  ctx.fillStyle = color;
  ctx.strokeStyle = PAWN.outline;
  ctx.lineWidth = Math.max(1, PAWN.outlineWidth * 0.7 * ps);
  ctx.beginPath();
  ctx.arc(x, y, H.r * ps, 0, TAU);
  ctx.fill();
  ctx.stroke();
}

/** Линия-предмет в руке (ложка, сигарета): из точки (x, y) на (dx, dy) px пешки. */
function drawStick(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, ps: number, color: string, w: number): void {
  ctx.strokeStyle = PAWN.outline;
  ctx.lineWidth = Math.max(1.4, (w + 1.2) * ps);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx * ps, y + dy * ps);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, w * ps);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx * ps, y + dy * ps);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/**
 * Руки с делом поверх спрайта (в осях пешки: x = 0 — её центр, y — центр над землёй): ест — ложка
 * ходит ко рту, играет — карта переворачивается, курит — сигарета идёт ко рту и обратно, говорит —
 * жестикулирует. Смотрит от нас (N) — руки скрыты корпусом, не рисуем. Возвращает, занята ли рука
 * делом (тогда оружие в руки не лезет — вызывающий решает).
 */
export function drawHandProps(ctx: CanvasRenderingContext2D, c: Character, look: PawnLook, x: number, y: number, ps: number, dir: PawnDir, now: number): boolean {
  if (dir === 'N') return false;
  const A = PAWN.anim;
  const H = A.hand;
  const ph = phaseOf(c);
  const col = handColor(look);
  const fwd = dir === 'W' ? -1 : 1;
  const side = dir === 'E' || dir === 'W';
  // Ложка и карты — за столом (сидит).
  if (c.seated === 'eat') {
    const E = A.eat;
    const u = ((now / E.period + ph / TAU) % 1 + 1) % 1;
    const p = u < E.bite ? smooth(u / E.bite) : u < E.bite + E.hold ? 1 : 1 - smooth((u - E.bite - E.hold) / (1 - E.bite - E.hold));
    const mx = side ? fwd * 4.2 : 1.8;
    const rx = side ? fwd * 3 : 3.6;
    const hx = rx + (mx - rx) * p;
    const hy = 7 + (H.mouthY + 0.8 - 7) * p;
    drawHand(ctx, x + handX(dir, -1) * (side ? 0.5 : 0.7) * ps, y + 7.5 * ps, ps, col);
    drawStick(ctx, x + hx * ps, y + hy * ps, -0.6 * fwd * (1 - p) + 0.9 * fwd * p, -3.6, ps, H.spoon, 1.1);
    drawHand(ctx, x + hx * ps, y + hy * ps, ps, col);
    return true;
  }
  if (c.seated === 'cards') {
    const C = A.cards;
    const u = ((now / C.period + ph / TAU) % 1 + 1) % 1;
    const p = u < C.lift ? smooth(u / C.lift) : 1 - smooth((u - C.lift) / (1 - C.lift));
    const lx = -4.6;
    drawHand(ctx, x + lx * ps, y + 4 * ps, ps, col);
    ctx.fillStyle = H.card;
    ctx.fillRect(x + (lx - 1.6) * ps, y + 1.4 * ps, 3.2 * ps, 2.6 * ps);
    const hx = 3.4 + p * 0.8;
    const hy = 6.5 - p * 4.2;
    drawHand(ctx, x + hx * ps, y + hy * ps, ps, col);
    ctx.fillStyle = H.card;
    ctx.strokeStyle = PAWN.outline;
    ctx.lineWidth = Math.max(1, PAWN.outlineWidth * 0.5 * ps);
    ctx.fillRect(x + (hx - 0.9) * ps, y + (hy - 3.2) * ps, 1.8 * ps, 3 * ps);
    ctx.strokeRect(x + (hx - 0.9) * ps, y + (hy - 3.2) * ps, 1.8 * ps, 3 * ps);
    return true;
  }
  if (c.smoking) {
    smokeCycle(c, now, cyc);
    const p = cyc.raise;
    const rx = side ? fwd * 3.2 : 7.2;
    const mx = side ? fwd * 4.4 : 1.7;
    const hx = rx + (mx - rx) * p;
    const hy = 3.2 + (H.mouthY + 0.6 - 3.2) * p;
    const px = x + hx * ps;
    const py = y + hy * ps;
    // Сигарета торчит вверх-вперёд; у рта — огонёк ярче.
    const tx = (side ? fwd * 2.8 : 0.4) * (1 - p) + (side ? fwd * 1.8 : -1.2) * p;
    drawStick(ctx, px, py, tx, -3.4, ps, H.cigarette, 1);
    ctx.fillStyle = p > 0.8 ? H.ember : '#c2602a';
    ctx.fillRect(px + tx * ps - 0.7 * ps, py - 3.4 * ps - 0.7 * ps, 1.4 * ps, 1.4 * ps);
    drawHand(ctx, px, py, ps, col);
    return true;
  }
  if (isTalking(c, now) && !c.weapon) {
    const T = A.talk;
    const t = now * T.rate + ph;
    const hx = (side ? fwd * 4.5 : 7.6) + Math.sin(t) * T.amp * 0.5;
    const hy = 2.2 - T.raise + Math.sin(t * 1.31 + 1) * T.amp;
    drawHand(ctx, x + hx * ps, y + hy * ps, ps, col);
    return true;
  }
  return false;
}

/** Спящий: одеяло до плеч (цвет — по внешности), складка и шов. Рисуется поверх спрайта. */
export function drawBlanket(ctx: CanvasRenderingContext2D, c: Character, x: number, y: number, ps: number): void {
  const S = PAWN.anim.sleep;
  const color = S.blankets[Math.abs(c.id) % S.blankets.length];
  const w = S.blanketHalf * ps;
  const top = y + S.blanketTop * ps;
  const h = (S.blanketBottom - S.blanketTop) * ps;
  ctx.fillStyle = color;
  ctx.strokeStyle = PAWN.outline;
  ctx.lineWidth = Math.max(1, PAWN.outlineWidth * 0.8 * ps);
  ctx.beginPath();
  ctx.roundRect(x - w, top, w * 2, h, 2.4 * ps);
  ctx.fill();
  ctx.stroke();
  // Отворот у плеч и тень справа.
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x - w + 0.8 * ps, top + 0.8 * ps, (w * 2 - 1.6 * ps), 2.2 * ps);
  ctx.fillStyle = S.blanketShade;
  ctx.fillRect(x + w * 0.35, top + 3 * ps, w * 0.65 - 0.8 * ps, h - 3.8 * ps);
}

/** «z» над спящим: три буквы поднимаются и тают по очереди. */
export function drawSleepZ(ctx: CanvasRenderingContext2D, c: Character, x: number, y: number, ps: number, now: number): void {
  const Z = PAWN.anim.sleep.z;
  const ph = phaseOf(c) / TAU;
  ctx.strokeStyle = Z.color;
  ctx.lineWidth = Math.max(1, 1.2 * ps);
  ctx.lineJoin = 'round';
  for (let k = 0; k < 3; k++) {
    const t = ((now / Z.every + ph + k / 3) % 1 + 1) % 1;
    const sz = (Z.size * (0.6 + t * 0.7)) * ps;
    const zx = x + (6 + t * 5 + Math.sin(t * 6 + k) * 1.2) * ps;
    const zy = y + (-11 - t * Z.rise) * ps;
    ctx.globalAlpha = Math.min(1, (1 - t) * 1.6) * (c.visible ? 1 : 0.4);
    ctx.beginPath();
    ctx.moveTo(zx - sz, zy - sz);
    ctx.lineTo(zx + sz, zy - sz);
    ctx.lineTo(zx - sz, zy + sz);
    ctx.lineTo(zx + sz, zy + sz);
    ctx.stroke();
  }
  ctx.globalAlpha = c.visible ? 1 : 0.4;
}
