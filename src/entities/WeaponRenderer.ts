import type { Character } from './Character';
import type { WeaponId } from '../config/items';
import { WEAPON_SPRITES, WEAPON_POSE, type SpritePart, type WeaponSprite } from '../config/weaponSprites';
import { weaponPose } from './weaponPose';
import type { MeleeSwing } from './meleePose';
import { PAWN } from '../config/pawns';

/** Спрайт ствола в кэше: холст, где на нём x = 0, y = 0 модели, и масштаб. */
interface Cached {
  canvas: HTMLCanvasElement;
  ox: number;
  oy: number;
  k: number;
}

const cache = new Map<string, Cached>();

/** Границы модели (с запасом на контур и ореол). */
function bounds(sp: WeaponSprite): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  };
  for (const p of sp.parts) {
    if ('r' in p) {
      add(p.r[0], p.r[1]);
      add(p.r[2], p.r[3]);
    } else if ('p' in p) for (const [x, y] of p.p) add(x, y);
    else if ('l' in p) for (const [x, y] of p.l) add(x, y, p.w);
    else add(p.o[0], p.o[1], p.o[2]);
  }
  const m = WEAPON_POSE.outlineWidth * 2 + 2;
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

/** Модель в холст при масштабе k (px экрана на единицу модели). */
function sprite(id: WeaponId, k: number): Cached {
  const q = Math.max(WEAPON_POSE.cacheStep, Math.round(k / WEAPON_POSE.cacheStep) * WEAPON_POSE.cacheStep);
  const key = `${id}:${q}`;
  let c = cache.get(key);
  if (c) return c;
  const sp = WEAPON_SPRITES[id];
  const [x0, y0, x1, y1] = bounds(sp);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((x1 - x0) * q));
  canvas.height = Math.max(1, Math.ceil((y1 - y0) * q));
  const g = canvas.getContext('2d')!;
  g.scale(q, q);
  g.translate(-x0, -y0);
  paint(g, sp);
  c = { canvas, ox: -x0 * q, oy: -y0 * q, k: q };
  cache.set(key, c);
  return c;
}

/** Нарисовать модель: сначала все детали толстой тёмной обводкой, потом заливка — единый силуэт. */
function paint(ctx: CanvasRenderingContext2D, sp: WeaponSprite): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = WEAPON_POSE.outline;
  ctx.lineWidth = WEAPON_POSE.outlineWidth * 2;
  for (const part of sp.parts) shape(ctx, part, 'outline');
  for (const part of sp.parts) {
    shape(ctx, part, 'fill');
    // Свечение — полупрозрачный ореол той же детали.
    if (part.glow) {
      ctx.globalAlpha *= 0.35;
      ctx.strokeStyle = part.c;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.globalAlpha /= 0.35;
      ctx.strokeStyle = WEAPON_POSE.outline;
    }
  }
}

/**
 * Оружие в руках пешки (стиль RimWorld): плоская модель сбоку с тёмным контуром, повёрнута за
 * прицелом, влево — отражена; руки — на рукояти и на цевье (у пистолета — обе на рукояти).
 * ox, oy — экранная позиция центра персонажа; s — масштаб вида; hand — цвет рук (перчатки или кожа);
 * swing — дубинка или нож в ударе и блоке.
 */
export function drawWeapon(ctx: CanvasRenderingContext2D, c: Character, ox: number, oy: number, s: number, reloading: boolean, ang: number = c.facing, hand: string | null = null, swing: MeleeSwing | null = null): void {
  if (!c.weapon) return;
  const sp = WEAPON_SPRITES[c.weapon];
  const pose = weaponPose(c, reloading, ang, swing);
  const k = s * WEAPON_POSE.scale * PAWN.scale;
  const img = sprite(c.weapon, k);
  const f = k / img.k;
  ctx.save();
  // Поза считается от c.x, c.y (без интерполяции) — переносим её к экранной позиции.
  ctx.translate(ox + (pose.x - c.x) * s, oy + (pose.y - c.y) * s);
  ctx.rotate(pose.ang);
  ctx.scale(f, pose.flip ? -f : f);
  ctx.drawImage(img.canvas, -img.ox, -img.oy);
  if (hand) {
    // Руки: кружки с контуром в точках хвата (в единицах холста спрайта).
    const r = WEAPON_POSE.hand * img.k;
    ctx.fillStyle = hand;
    ctx.strokeStyle = WEAPON_POSE.outline;
    ctx.lineWidth = WEAPON_POSE.outlineWidth * img.k;
    ctx.beginPath();
    ctx.arc(sp.grip[0] * img.k, sp.grip[1] * img.k, r, 0, Math.PI * 2);
    if (sp.fore) {
      ctx.moveTo(sp.fore[0] * img.k + r, sp.fore[1] * img.k);
      ctx.arc(sp.fore[0] * img.k, sp.fore[1] * img.k, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
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
