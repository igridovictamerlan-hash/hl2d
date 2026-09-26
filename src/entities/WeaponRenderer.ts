import type { Character } from './Character';
import { WEAPON_SPRITES, WEAPON_POSE, type SpritePart } from '../config/weaponSprites';
import { weaponPose } from './weaponPose';

/**
 * Оружие в руках (вид сверху) и кисти рук. Рисуется в системе персонажа: поворот на взгляд,
 * сдвиг по позе (у плеча / в прицеле / у бедра), доворот на перезарядке, откат от отдачи.
 * x, y — центр кружка на экране, s — пикселей экрана на пиксель мира.
 */
export function drawWeapon(ctx: CanvasRenderingContext2D, c: Character, x: number, y: number, s: number, reloading: boolean): void {
  if (!c.weapon) return;
  const sp = WEAPON_SPRITES[c.weapon];
  const pose = weaponPose(c, c.weapon, reloading);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(c.facing);
  ctx.scale(s, s);
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.ang);
  ctx.scale(WEAPON_POSE.scale, WEAPON_POSE.scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Обводка всего силуэта — чтобы читался на любом полу.
  ctx.strokeStyle = WEAPON_POSE.outline;
  ctx.lineWidth = 1.2;
  for (const part of sp.parts) if (!('l' in part)) shape(ctx, part, true);
  for (const part of sp.parts) {
    if (part.glow) {
      ctx.shadowColor = part.c;
      ctx.shadowBlur = 6 * s * WEAPON_POSE.scale;
    }
    shape(ctx, part, false);
    ctx.shadowBlur = 0;
  }
  // Кисти: пистолет у бедра — одна рука, остальное — как в спрайте.
  const aimed = c.aiming || c.aim > 0.5;
  const hands = sp.hold === 'pistol' && !aimed ? sp.hands.slice(-1) : sp.hands;
  ctx.fillStyle = WEAPON_POSE.gloves[c.faction] ?? WEAPON_POSE.gloves.citizen;
  ctx.strokeStyle = WEAPON_POSE.handOutline;
  ctx.lineWidth = 0.8;
  for (const [hx, hy] of hands) {
    ctx.beginPath();
    ctx.arc(hx, hy, WEAPON_POSE.handRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function shape(ctx: CanvasRenderingContext2D, part: SpritePart, outline: boolean): void {
  ctx.beginPath();
  if ('r' in part) {
    const [x0, y0, x1, y1] = part.r;
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  } else if ('p' in part) {
    part.p.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
  } else if ('o' in part) {
    ctx.arc(part.o[0], part.o[1], part.o[2], 0, Math.PI * 2);
  } else {
    part.l.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.strokeStyle = part.c;
    ctx.lineWidth = part.w;
    ctx.stroke();
    return;
  }
  if (outline) ctx.stroke();
  else {
    ctx.fillStyle = part.c;
    ctx.fill();
  }
}
