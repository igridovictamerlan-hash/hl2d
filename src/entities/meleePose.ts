import type { Character } from './Character';
import { MELEE, MELEE_LOOK } from '../config/melee';
import { PAWN } from '../config/pawns';
import { WEAPON_POSE } from '../config/weaponSprites';

const DEG = Math.PI / 180;

/**
 * Фаза удара для анимации (только картинка): u — дуга (−1 — замах у начала дуги, 0 — покой, +1 — конец
 * дуги), e — вынос (−1 — отведено, 0 — покой, +1 — до конца вперёд). null — удара нет.
 */
interface Phase {
  u: number;
  e: number;
}

const phase: Phase = { u: 0, e: 0 };

const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);
const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k));

/** Где сейчас рука/оружие в ударе: замах → взмах за trail.sweep с → возврат за отход. */
function attackPhase(c: Character, now: number): Phase | null {
  const a = c.melee.attack;
  if (!a || a.broken || now >= a.end || now < a.start) return null;
  const s = a.strike;
  const sweep = MELEE_LOOK.trail.sweep;
  if (now < a.at) {
    const k = easeOut(Math.min(1, (now - a.start) / Math.max(0.01, s.windup)));
    phase.u = -k;
    phase.e = s.motion === 'thrust' ? -k : -0.4 * k;
  } else if (now < a.at + sweep) {
    const q = easeOut((now - a.at) / sweep);
    phase.u = -1 + 2 * q;
    phase.e = s.motion === 'thrust' ? -1 + 2 * q : Math.sin(Math.PI * q) * 0.6;
  } else {
    const r = easeInOut(Math.min(1, (now - a.at - sweep) / Math.max(0.01, a.end - a.at - sweep)));
    phase.u = 1 - r;
    phase.e = s.motion === 'thrust' ? Math.pow(1 - r, 1.6) : 0;
  }
  return phase;
}

/** Доля поднятого блока (плавно за 0.08 с). */
function guardAmount(c: Character, now: number): number {
  return c.melee.block ? Math.min(1, (now - c.melee.blockSince) / 0.08) : 0;
}

/** Холодное оружие в ударе или блоке: поворот (рад) и вынос (px мира) к позе weaponPose. */
export interface MeleeSwing {
  dAng: number;
  dExt: number;
}

const swing: MeleeSwing = { dAng: 0, dExt: 0 };

/** Поза дубинки или ножа в ударе (по дуге или выпадом) и в блоке (поперёк); null — обычная поза. */
export function meleeSwing(c: Character, now: number): MeleeSwing | null {
  const W = MELEE_LOOK.weapon;
  const p = attackPhase(c, now);
  if (p) {
    const s = c.melee.attack!.strike;
    swing.dAng = s.motion === 'slash' ? s.side * p.u * (p.u < 0 ? W.windupAng : W.swingAng) * DEG : 0;
    swing.dExt = (p.e < 0 ? p.e * W.pull : p.e * W.ext) * PAWN.scale;
    return swing;
  }
  const g = guardAmount(c, now);
  if (g <= 0) return null;
  // Поперёк корпуса, концом вверх по экрану.
  const up = Math.cos(c.facing) >= 0 ? -1 : 1;
  swing.dAng = up * W.blockAng * DEG * g;
  swing.dExt = -W.blockPull * PAWN.scale * g;
  return swing;
}

/** Кулаки видны: стойка (бьёт, закрывается, получил удар), без оружия в руках. */
export function fistsShown(c: Character, now: number): boolean {
  return !c.weapon && (c.melee.engaged || c.melee.block || (!!c.melee.attack && now < c.melee.attack.end)) && c.melee.ko <= now;
}

/**
 * Кулаки (px мира от центра пешки, y — с высотой): out[0..1] — левый, out[2..3] — правый. В стойке — у
 * груди, в блоке — у лица; бьющая рука — выпадом (джеб, прямой) или дугой сбоку (хук).
 */
export function fistPositions(c: Character, now: number, out: Float32Array): void {
  const F = MELEE_LOOK.fists;
  const g = guardAmount(c, now);
  const p = attackPhase(c, now);
  const s = p ? c.melee.attack!.strike : null;
  const k = PAWN.scale;
  for (let i = 0; i < 2; i++) {
    const hand = i === 0 ? -1 : 1;
    // Покой: у груди / в блоке: у лица.
    const fwd = F.fwd + (F.guardFwd - F.fwd) * g;
    const side = F.side + (F.guardSide - F.side) * g;
    let dist = Math.hypot(fwd, side);
    let phi = hand * Math.atan2(side, fwd);
    let y = F.y + (F.guardY - F.y) * g;
    if (p && s && s.hand === hand) {
      if (s.motion === 'thrust') {
        dist += p.e < 0 ? p.e * F.pull : p.e * F.ext;
        phi *= 1 - Math.max(0, p.e) * 0.85;
        y += (F.guardY * 0.35 - y) * Math.max(0, p.e);
      } else {
        // Хук: от бока (замах) поперёк перед собой.
        const t = (p.u + 1) / 2;
        phi = hand * (82 - 97 * t) * DEG;
        dist = Math.hypot(F.fwd, F.hookSide) * (0.85 + 0.15 * t) + Math.max(0, p.e) * F.ext * 0.55 - Math.max(0, -p.u) * F.pull * 0.4;
        y += (F.guardY * 0.45 - y) * Math.max(0, p.e);
      }
    }
    const a = c.facing + phi;
    out[i * 2] = Math.cos(a) * dist * k;
    out[i * 2 + 1] = Math.sin(a) * dist * k + y * k;
  }
}

const fists = new Float32Array(4);

/** Кулаки пешки: ox, oy — экранный центр пешки, s — масштаб вида, hand — цвет (перчатки или кожа). */
export function drawFists(ctx: CanvasRenderingContext2D, c: Character, ox: number, oy: number, s: number, now: number, hand: string): void {
  fistPositions(c, now, fists);
  const r = MELEE_LOOK.fists.r * PAWN.scale * s;
  ctx.fillStyle = hand;
  ctx.strokeStyle = WEAPON_POSE.outline;
  ctx.lineWidth = Math.max(1, WEAPON_POSE.outlineWidth * PAWN.scale * s * 0.9);
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const x = ox + fists[i * 2] * s;
    const y = oy + fists[i * 2 + 1] * s;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
}

/** Вздрагивание от удара: наклон (рад, по часовой — вправо) и сдвиг (px мира); 0 — нет. */
export function flinchOf(c: Character, now: number): { lean: number; dx: number; dy: number; flash: number } {
  const F = MELEE_LOOK.flinch;
  const m = c.melee;
  const t = now - m.struckAt;
  if (t < 0 || t >= F.time) return NO_FLINCH;
  const k = (1 - t / F.time) ** 2 * (0.4 + 0.6 * m.struckPow);
  flinch.lean = Math.cos(m.struckAng) * F.lean * k;
  flinch.dx = Math.cos(m.struckAng) * F.shift * k;
  flinch.dy = Math.sin(m.struckAng) * F.shift * k * 0.5;
  flinch.flash = t < F.flash ? F.flashAlpha * (1 - t / F.flash) * (0.5 + 0.5 * m.struckPow) : 0;
  return flinch;
}

const NO_FLINCH = { lean: 0, dx: 0, dy: 0, flash: 0 };
const flinch = { lean: 0, dx: 0, dy: 0, flash: 0 };

/** Полуугол блока (для дуги-щита). */
export const GUARD_ARC = MELEE.block.arc * DEG;
