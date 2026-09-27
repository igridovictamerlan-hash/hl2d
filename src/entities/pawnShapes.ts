import { PAWN } from '../config/pawns';
import type { PawnDir } from './PawnRenderer';

/** Общие фигуры пешек (PawnRenderer, pawnArmor): контуры туловища и головы, обводка, цвет. */
type Ctx = CanvasRenderingContext2D;

/** Светлее (k > 0) или темнее (k < 0) цвета #rrggbb. */
export function tint(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function stroke(ctx: Ctx, w: number, color: string = PAWN.outline): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

export function fillStroke(ctx: Ctx, fill: string, w: number = PAWN.seamWidth): void {
  ctx.fillStyle = fill;
  ctx.fill();
  stroke(ctx, w);
}

/** Туловище: округлые плечи, расширение к поясу, круглый низ; в профиле — уже. */
export function bodyPath(ctx: Ctx, d: PawnDir): void {
  const B = PAWN.body;
  const side = d === 'E';
  const sh = side ? B.shoulder * 0.78 : B.shoulder;
  const wa = side ? B.waist * 0.84 : B.waist;
  const dx = side ? 0.4 : 0;
  ctx.beginPath();
  ctx.moveTo(dx - sh, B.top + 3);
  ctx.quadraticCurveTo(dx - sh, B.top, dx - sh + 3, B.top);
  ctx.lineTo(dx + sh - 3, B.top);
  ctx.quadraticCurveTo(dx + sh, B.top, dx + sh, B.top + 3);
  ctx.bezierCurveTo(dx + wa, B.bottom - 7, dx + wa, B.bottom, dx, B.bottom);
  ctx.bezierCurveTo(dx - wa, B.bottom, dx - wa, B.bottom - 7, dx - sh, B.top + 3);
  ctx.closePath();
}

/** Голова: спереди/сзади — круг с заострённым подбородком, в профиле — с носом и подбородком. */
export function headPath(ctx: Ctx, d: PawnDir, hx: number): void {
  const H = PAWN.head;
  const r = H.r;
  const cy = H.y;
  ctx.beginPath();
  if (d === 'E') {
    const cx = hx;
    ctx.moveTo(cx - r, cy);
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.bezierCurveTo(cx + r + 0.2, cy + 1.2, cx + r + 1.5, cy + 1.8, cx + r + 0.7, cy + 2.9);
    ctx.bezierCurveTo(cx + r, cy + 3.5, cx + r - 0.2, cy + 4.2, cx + r - 0.9, cy + 5);
    ctx.bezierCurveTo(cx + r - 1.6, cy + r + H.chin, cx + 1, cy + r + H.chin, cx - 1.5, cy + r - 0.4);
    ctx.bezierCurveTo(cx - r + 1, cy + r - 2, cx - r, cy + 3, cx - r, cy);
  } else {
    const chin = d === 'N' ? 0.3 : H.chin;
    ctx.moveTo(-r, cy);
    ctx.arc(0, cy, r, Math.PI, 0);
    ctx.bezierCurveTo(r, cy + r * 0.6, r * 0.45, cy + r + chin, 0, cy + r + chin);
    ctx.bezierCurveTo(-r * 0.45, cy + r + chin, -r, cy + r * 0.6, -r, cy);
  }
  ctx.closePath();
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
