/**
 * Оружие пиксельных пешек: те же модели (config/weaponSprites.ts), что у фасолин, переведены в пиксели силуэта —
 * отрисовка одной заливкой с 4× запасом и выбор самого частого цвета в каждом пикселе (чёткие края без размытия).
 * Поворот — в сетке силуэта (выборка по ближайшему пикселю), чтобы ствол был той же пиксельной сеткой, что пешка.
 */
import type { WeaponId } from '../../config/items';
import { WEAPON_POSE, WEAPON_SPRITES, type SpritePart } from '../../config/weaponSprites';
import { PAWN } from '../../config/pawns';
import { PIXEL } from '../../config/pixelPawns';
import { Grid, hex } from './grid';

export interface PixelGun {
  grid: Grid;
  /** Рукоять, цевьё и дульный срез — в пикселях сетки ствола. */
  grip: [number, number];
  fore: [number, number] | null;
  muzzle: [number, number];
  /** Дальше всего от рукояти (для рамки поворота). */
  reach: number;
}

const SS = 4;
const guns = new Map<WeaponId, PixelGun>();

/** Пиксель модели в пикселях силуэта: модели оружия — в масштабе пешки, как у фасолин. */
export const GUN_K = (WEAPON_POSE.scale * PAWN.scale) / PIXEL.unit;

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
  return [x0 - 1, y0 - 1, x1 + 1, y1 + 1];
}

function fillPart(ctx: CanvasRenderingContext2D, part: SpritePart): void {
  ctx.beginPath();
  if ('l' in part) {
    part.l.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = part.c;
    ctx.lineWidth = part.w;
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }
  if ('r' in part) ctx.rect(part.r[0], part.r[1], part.r[2] - part.r[0], part.r[3] - part.r[1]);
  else if ('p' in part) {
    part.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  } else ctx.arc(part.o[0], part.o[1], part.o[2], 0, Math.PI * 2);
  ctx.fillStyle = part.c;
  ctx.fill();
}

/** Ствол в пикселях (кэш). Нужен DOM (холст для выборки). */
export function pixelGun(id: WeaponId): PixelGun {
  let g = guns.get(id);
  if (g) return g;
  const sp = WEAPON_SPRITES[id];
  const [x0, y0, x1, y1] = bounds(sp.parts);
  const k = GUN_K;
  const W = Math.max(1, Math.ceil((x1 - x0) * k));
  const H = Math.max(1, Math.ceil((y1 - y0) * k));
  const cv = document.createElement('canvas');
  cv.width = W * SS;
  cv.height = H * SS;
  const ctx = cv.getContext('2d')!;
  ctx.scale(k * SS, k * SS);
  ctx.translate(-x0, -y0);
  for (const p of sp.parts) fillPart(ctx, p);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const grid = new Grid(W, H);
  const votes = new Map<number, number>();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    votes.clear();
    let n = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const o = ((y * SS + j) * cv.width + (x * SS + i)) * 4;
      if (d[o + 3] < 128) continue;
      n++;
      // Цвет с огрублением до 4 бит на канал — сглаженные края не дают своих цветов.
      const key = ((d[o] >> 3) << 10) | ((d[o + 1] >> 3) << 5) | (d[o + 2] >> 3);
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
    if (n < (SS * SS * PIXEL.weapon.alpha) / 255) continue;
    let best = -1;
    let bn = 0;
    for (const [key, v] of votes) if (v > bn) { bn = v; best = key; }
    grid.put(x, y, hex(((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4));
  }
  const loc = (p: [number, number]): [number, number] => [(p[0] - x0) * k, (p[1] - y0) * k];
  const grip = loc(sp.grip);
  const corners = [[0, 0], [W, 0], [0, H], [W, H]];
  const reach = Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - grip[0], cy - grip[1]))) + 1;
  g = { grid, grip, fore: sp.fore ? loc(sp.fore) : null, muzzle: loc(sp.muzzle), reach };
  guns.set(id, g);
  return g;
}

/** Точка ствола (пиксели сетки ствола) в координатах силуэта при рукояти в (hx, hy), повороте ang и отражении. */
export function gunPoint(gun: PixelGun, p: [number, number], hx: number, hy: number, ang: number, flip: boolean): [number, number] {
  const lx = p[0] - gun.grip[0];
  const ly = (p[1] - gun.grip[1]) * (flip ? -1 : 1);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [hx + lx * c - ly * s, hy + lx * s + ly * c];
}

/** Впечатать ствол в сетку силуэта: рукоять — в (hx, hy), поворот ang, flip — отражён (целится влево). */
export function stampGun(dst: Grid, gun: PixelGun, hx: number, hy: number, ang: number, flip: boolean): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const R = Math.ceil(gun.reach);
  for (let fy = Math.floor(hy - R); fy <= Math.ceil(hy + R); fy++) {
    for (let fx = Math.floor(hx - R); fx <= Math.ceil(hx + R); fx++) {
      const dx = fx + 0.5 - hx;
      const dy = fy + 0.5 - hy;
      const lx = dx * c + dy * s;
      let ly = -dx * s + dy * c;
      if (flip) ly = -ly;
      const col = gun.grid.px(Math.floor(gun.grip[0] + lx), Math.floor(gun.grip[1] + ly));
      if (col) dst.set(fx, fy, col);
    }
  }
}
