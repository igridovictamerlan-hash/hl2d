import type { Character } from './Character';
import { WEAPON_SPRITES, WEAPON_POSE, type SpritePart } from '../config/weaponSprites';
import { weaponPose } from './weaponPose';
import { PAWN } from '../config/pawns';

/**
 * Оружие в руках пешки (стиль RimWorld): плоская модель сбоку с тёмным контуром, повёрнута за
 * прицелом, влево — отражена. v — вид (left, top, scale) для перевода мира в экран.
 */
export function drawWeapon(ctx: CanvasRenderingContext2D, c: Character, ox: number, oy: number, s: number, reloading: boolean): void {
  if (!c.weapon) return;
  const sp = WEAPON_SPRITES[c.weapon];
  const pose = weaponPose(c, reloading);
  ctx.save();
  // ox, oy — экранная позиция центра персонажа (с интерполяцией); поза считается от c.x, c.y.
  ctx.translate(ox + (pose.x - c.x) * s, oy + (pose.y - c.y) * s);
  ctx.rotate(pose.ang);
  const k = s * WEAPON_POSE.scale * PAWN.scale;
  ctx.scale(k, pose.flip ? -k : k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Контур: сначала все детали толстой тёмной обводкой, потом заливка — единый силуэт.
  ctx.strokeStyle = WEAPON_POSE.outline;
  ctx.lineWidth = WEAPON_POSE.outlineWidth * 2;
  for (const part of sp.parts) shape(ctx, part, 'outline');
  for (const part of sp.parts) {
    shape(ctx, part, 'fill');
    // Свечение — полупрозрачный ореол той же детали (дешевле shadowBlur при десятках стволов).
    if (part.glow) {
      ctx.globalAlpha *= 0.35;
      ctx.strokeStyle = part.c;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.globalAlpha /= 0.35;
      ctx.strokeStyle = WEAPON_POSE.outline;
    }
  }
  ctx.restore();
}

function shape(ctx: CanvasRenderingContext2D, part: SpritePart, mode: 'outline' | 'fill'): void {
  ctx.beginPath();
  if ('l' in part) {
    part.l.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    if (mode === 'outline') {
      const w = ctx.lineWidth;
      ctx.lineWidth = part.w + WEAPON_POSE.outlineWidth * 2;
      ctx.stroke();
      ctx.lineWidth = w;
    } else {
      ctx.strokeStyle = part.c;
      ctx.lineWidth = part.w;
      ctx.stroke();
      ctx.strokeStyle = WEAPON_POSE.outline;
    }
    return;
  }
  if ('r' in part) {
    const [x0, y0, x1, y1] = part.r;
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  } else if ('p' in part) {
    part.p.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
  } else {
    ctx.arc(part.o[0], part.o[1], part.o[2], 0, Math.PI * 2);
  }
  if (mode === 'outline') ctx.stroke();
  else {
    ctx.fillStyle = part.c;
    ctx.fill();
  }
}
