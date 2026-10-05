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
  /** Сдвиг корпуса, px мира (выпад при ударе, отброс от попадания). */
  dx: number;
  dy: number;
}

export const anim: PawnAnim = { kind: 'stand', lean: 0, squash: 1, drop: 0, lift: 0, feet: true, dx: 0, dy: 0 };

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
  a.dx = 0;
  a.dy = 0;
  if (walking) return impulses(c, now, a);
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
    return impulses(c, now, a);
  }
  if (aiming || c.crouch) return impulses(c, now, a);
  const I = A.idle;
  a.lean = Math.sin((now / I.period) * TAU + ph) * I.lean;
  a.squash = 1 + I.breathe * Math.sin((now / I.breathePeriod) * TAU + ph * 0.7);
  a.lift = (0.5 + 0.5 * Math.sin((now / I.breathePeriod) * TAU + ph * 0.7)) * I.bob;
  if (isTalking(c, now)) a.lift += Math.max(0, Math.sin(now * A.talk.rate * 0.7 + ph)) * A.talk.bob;
  return impulses(c, now, a);
}

/** Ход удара 0..1 или -1, если не бьёт сейчас. */
function strikeProgress(c: Character, now: number): number {
  const p = (now - c.strikeAt) / PAWN.anim.strike.time;
  return p >= 0 && p < 1 ? p : -1;
}

/** Выдвижение руки в ударе: от -1 (замах назад) через 0 до 1 (удар) и обратно. */
function strikeExt(p: number): number {
  const S = PAWN.anim.strike;
  return p < S.windup ? -smooth(p / S.windup) * 0.5 : Math.sin(((p - S.windup) / (1 - S.windup)) * Math.PI);
}

/**
 * Толчки боя поверх позы: удар (выпад и наклон в сторону удара), бросок гранаты (откинулся и подался вперёд),
 * попадание (отброс от удара и наклон). Только сдвиг и наклон — тело то же.
 */
function impulses(c: Character, now: number, a: PawnAnim): PawnAnim {
  const A = PAWN.anim;
  const sp = strikeProgress(c, now);
  if (sp >= 0) {
    const S = A.strike;
    const e = strikeExt(sp);
    const k = c.strikeKind === 'blade' ? 1.3 : 1;
    a.dx += Math.cos(c.strikeAng) * S.lunge * e * k;
    a.dy += Math.sin(c.strikeAng) * S.lunge * e * 0.6 * k;
    a.lean += Math.cos(c.strikeAng) * S.lean * e;
  }
  const tp = (now - c.throwAt) / A.throw.time;
  if (tp >= 0 && tp < 1) {
    const T = A.throw;
    const e = tp < T.release ? -smooth(tp / T.release) : Math.sin(((tp - T.release) / (1 - T.release)) * Math.PI) * 0.8;
    a.lean += Math.cos(c.throwAng) * T.lean * e;
    a.dx += Math.cos(c.throwAng) * 1.4 * e;
  }
  const hp = (now - c.lastHurt) / A.hurt.time;
  if (hp >= 0 && hp < 1) {
    const H = A.hurt;
    const k = (1 - hp) * (1 - hp);
    a.dx += Math.cos(c.hurtAng) * H.push * k;
    a.dy += Math.sin(c.hurtAng) * H.push * 0.6 * k;
    a.lean += Math.cos(c.hurtAng) * H.lean * k;
  }
  return a;
}

/**
 * Угол ствола в ударе: дубинка размахивается дугой, нож колет коротко. 0 — не бьёт (или без оружия).
 * Прибавляется к направлению удара вызывающим.
 */
export function strikeSweep(c: Character, now: number): number {
  const sp = strikeProgress(c, now);
  if (sp < 0 || c.strikeKind === 'fist' || c.strikeKind === '') return 0;
  const S = PAWN.anim.strike;
  const w = c.strikeKind === 'blade' ? S.blade : S.club;
  const off = w * (2 * smooth(sp) - 1);
  return Math.cos(c.strikeAng) < 0 ? -off : off;
}

/** Бьёт ли сейчас (для вызывающего: направление ствола — по удару). */
export function isStriking(c: Character, now: number): boolean {
  return strikeProgress(c, now) >= 0;
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

/**
 * Руки в бою и на плацу (поверх спрайта, оружие они не скрывают): кулак выходит в ударе (руки по очереди),
 * бросок гранаты — рука назад и вперёд, строевой шаг — руки качаются в такт шагу (phase — фаза шага,
 * sn — sin(phase) шага, 0 — не идёт).
 */
export function drawActionHands(ctx: CanvasRenderingContext2D, c: Character, look: PawnLook, x: number, y: number, ps: number, dir: PawnDir, now: number, sn: number): void {
  const A = PAWN.anim;
  const col = handColor(look);
  const sp = strikeProgress(c, now);
  if (sp >= 0 && c.strikeKind === 'fist') {
    const S = A.strike;
    const e = strikeExt(sp);
    const r = S.rest + e * S.reach;
    const side = (Math.floor(c.strikeAt * 7) + c.id) % 2 ? 1 : -1;
    drawHand(ctx, x + (Math.cos(c.strikeAng) * r + side * S.side * 0.6) * ps, y + (Math.sin(c.strikeAng) * r * 0.6 + 1.5) * ps, ps, col);
    drawHand(ctx, x - side * S.side * ps, y + 5.5 * ps, ps, col);
  }
  const tp = (now - c.throwAt) / A.throw.time;
  if (tp >= 0 && tp < 1) {
    const T = A.throw;
    const ca = Math.cos(c.throwAng);
    const sa = Math.sin(c.throwAng);
    const back = smooth(Math.min(1, tp / T.release));
    let hx: number;
    let hy: number;
    if (tp < T.release) {
      hx = ca * -T.back * back + (1 - back) * 7;
      hy = 4 - back * 7 + sa * -2 * back;
    } else {
      const f = smooth((tp - T.release) / (1 - T.release));
      hx = ca * (-T.back + (T.back + T.fwd) * f);
      hy = -3 + sa * 3 * f + f * 4;
    }
    drawHand(ctx, x + hx * ps, y + hy * ps, ps, col);
  }
  if (c.marching && dir !== 'N' && sn !== 0 && !c.weapon) {
    const M = A.march;
    const sw = sn * M.swing;
    if (dir === 'S') {
      drawHand(ctx, x - 7.6 * ps, y + (5.5 - sw) * ps, ps, col);
      drawHand(ctx, x + 7.6 * ps, y + (5.5 + sw) * ps, ps, col);
    } else {
      const f = dir === 'W' ? -1 : 1;
      drawHand(ctx, x + f * (1.5 + sw) * ps, y + 5 * ps, ps, col);
    }
  }
}
