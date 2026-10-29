/**
 * Оружие пиксельных пешек: те же модели (config/weaponSprites.ts), что у фасолин, но мельче (по руке пиксельной
 * пешки, PIXEL.weapon.scale) и с тонким контуром вместо толстой обводки RimWorld — чётко видно, что в руках.
 * Модель рисуется в холст один раз на ствол и шаг масштаба, на экран — с поворотом за прицелом (плавно, без шагов
 * угла). Руки — на рукояти и цевье модели.
 */
import type { WeaponId } from '../../config/items';
import { WEAPON_POSE, WEAPON_SPRITES, type SpritePart } from '../../config/weaponSprites';
import { PAWN } from '../../config/pawns';
import { PIXEL } from '../../config/pixelPawns';

/** Пиксель силуэта на единицу модели оружия. */
export const GUN_FIG = (WEAPON_POSE.scale * PAWN.scale * PIXEL.weapon.scale) / PIXEL.unit;

interface GunSprite { cv: HTMLCanvasElement; ox: number; oy: number; k: number }
const sprites = new Map<string, GunSprite>();

function bounds(parts: readonly SpritePart[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  };
  for (const p of parts) {
    if ('r' in p) { add(p.r[0], p.r[1]); add(p.r[2], p.r[3]); }
    else if ('p' in p) for (const [x, y] of p.p) add(x, y);
    else if ('l' in p) for (const [x, y] of p.l) add(x, y, p.w / 2);
    else add(p.o[0], p.o[1], p.o[2]);
  }
  const m = PIXEL.weapon.outline * 2 + 1.5;
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

function shape(ctx: CanvasRenderingContext2D, part: SpritePart, outline: boolean): void {
  const W = PIXEL.weapon;
  ctx.beginPath();
  if ('l' in part) {
    part.l.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineWidth = part.w + (outline ? W.outline * 2 : 0);
    ctx.strokeStyle = outline ? W.ink : part.c;
    ctx.stroke();
    return;
  }
  if ('r' in part) ctx.rect(part.r[0], part.r[1], part.r[2] - part.r[0], part.r[3] - part.r[1]);
  else if ('p' in part) {
    part.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  } else ctx.arc(part.o[0], part.o[1], part.o[2], 0, Math.PI * 2);
  if (outline) {
    ctx.lineWidth = W.outline * 2;
    ctx.strokeStyle = W.ink;
    ctx.stroke();
  } else {
    ctx.fillStyle = part.c;
    ctx.fill();
  }
}

/** Модель в холст при k px экрана на единицу модели (кэш по шагу масштаба). */
function gunSprite(id: WeaponId, k: number): GunSprite {
  const step = PIXEL.weapon.cacheStep;
  const q = Math.max(step, Math.ceil(k / step) * step);
  const key = `${id}:${q}`;
  let g = sprites.get(key);
  if (g) return g;
  const sp = WEAPON_SPRITES[id];
  const [x0, y0, x1, y1] = bounds(sp.parts);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil((x1 - x0) * q));
  cv.height = Math.max(1, Math.ceil((y1 - y0) * q));
  const ctx = cv.getContext('2d')!;
  ctx.scale(q, q);
  ctx.translate(-x0, -y0);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const p of sp.parts) shape(ctx, p, true);
  for (const p of sp.parts) {
    shape(ctx, p, false);
    if (p.glow) {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = p.c;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  g = { cv, ox: -x0 * q, oy: -y0 * q, k: q };
  sprites.set(key, g);
  return g;
}

/**
 * Ствол на экране: (x, y) — точка модели (0, 0) в координатах холста, ang — угол, flip — отражён (целится влево),
 * k — px холста на пиксель силуэта. Поверх текущего преобразования холста (интерфейс масштабирован под экран) —
 * вызывающий обрамляет save/restore.
 */
export function drawGun(ctx: CanvasRenderingContext2D, id: WeaponId, x: number, y: number, ang: number, flip: boolean, k: number): void {
  const mk = GUN_FIG * k;
  const img = gunSprite(id, mk);
  const f = mk / img.k;
  const c = Math.cos(ang) * f;
  const s = Math.sin(ang) * f;
  const fy = flip ? -1 : 1;
  ctx.transform(c, s, -s * fy, c * fy, x, y);
  ctx.drawImage(img.cv, -img.ox, -img.oy);
}

/** Точка модели (единицы WEAPON_SPRITES) в координатах силуэта при точке (0, 0) модели в (x, y), угле и отражении. */
export function gunPoint(p: readonly [number, number], x: number, y: number, ang: number, flip: boolean): [number, number] {
  const lx = p[0] * GUN_FIG;
  const ly = p[1] * GUN_FIG * (flip ? -1 : 1);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [x + lx * c - ly * s, y + lx * s + ly * c];
}
