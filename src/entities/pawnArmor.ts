import { PAWN } from '../config/pawns';
import type { PawnDir } from './PawnRenderer';
import { bodyPath, fillStroke, headPath, roundRect, stroke, tint } from './pawnShapes';

/**
 * Снаряжение силового блока по эскизам RimWorld (PAWN.cpUnits): PCU — каска и стёганый бронежилет
 * («flak»), противогаз с круглыми линзами, у офицера — фуражка; SU — облегчённая сегментная броня и
 * шлем с вырезом для лица и визором поверх балаклавы («recon»); аксессуары — рация, фонарь на плече,
 * шевроны, аксельбант, погоны, гранаты, планшет, сумка медика, ранец с антенной, баллон катафракта,
 * плащ, полы плаща. Всё в координатах пешки (px мира от центра, восток; запад — отражение).
 */
type Ctx = CanvasRenderingContext2D;
type Outfit = Record<string, string | boolean | number>;

const G = PAWN.gear;

/** Аксессуары пешки: acc — всегда, accMaybe — у доли PAWN.accChance (по зерну внешности). */
export function accessoriesOf(O: Outfit, seed: number): Set<string> {
  const set = new Set<string>();
  for (const a of String(O.acc ?? '').split(' ')) if (a) set.add(a);
  let k = 0;
  for (const a of String(O.accMaybe ?? '').split(' ')) {
    if (!a) continue;
    k++;
    const h = (Math.imul(seed ^ Math.imul(k, 0x9e3779b1), 2246822519) >>> 0) % 1000;
    if (h < PAWN.accChance * 1000) set.add(a);
  }
  return set;
}

/** Плечи для наплечников: в профиле одно, спереди и сзади — два. */
function shoulders(d: PawnDir, out: number): number[] {
  return d === 'E' ? [0.5] : [-(PAWN.body.shoulder + out), PAWN.body.shoulder + out];
}

/** Наплечник: овал с бликом, снизу — полоса trim (если задана). */
function pad(ctx: Ctx, px: number, py: number, rx: number, ry: number, color: string, trim: string | null): void {
  ctx.beginPath();
  ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (trim) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = trim;
    ctx.fillRect(px - rx - 1, py + ry - 1.9, rx * 2 + 2, 1.2);
    ctx.fillStyle = PAWN.shade;
    ctx.fillRect(px - rx - 1, py + ry - 0.7, rx * 2 + 2, 3);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
  stroke(ctx, PAWN.outlineWidth * 0.85);
  ctx.beginPath();
  ctx.arc(px - 0.4, py - 0.3, Math.min(rx, ry) * 0.6, Math.PI * 1.1, Math.PI * 1.7);
  stroke(ctx, 0.8, tint(color, 0.32));
}

/** Пояс с пряжкой и подсумками. */
function belt(ctx: Ctx, d: PawnDir, color: string, pouches: boolean): void {
  ctx.beginPath();
  ctx.rect(-12, 7.6, 24, 2.3);
  fillStroke(ctx, color);
  if (d === 'S') {
    ctx.beginPath();
    ctx.rect(-1.3, 7.8, 2.6, 1.9);
    fillStroke(ctx, G.buckle, 0.5);
  }
  if (!pouches) return;
  ctx.beginPath();
  const at = d === 'S' ? [-6.4, -3.6, 3.4] : d === 'N' ? [-4.8, 2.2] : [3.4];
  for (const px of at) ctx.rect(px, 7.2, 2.6, 3);
  fillStroke(ctx, tint(color, 0.25), 0.6);
}

// ————— PCU: каска, бронежилет, противогаз —————

/** Форма PCU и стёганый бронежилет (у рекрута жилета нет — рубашка с карманами). */
export function flakBody(ctx: Ctx, d: PawnDir, O: Outfit, trim: string, acc: Set<string>): void {
  const top = PAWN.body.top;
  const side = d === 'E';
  const base = O.base as string;
  const vest = O.vest !== false;
  const flak = typeof O.flak === 'string' ? O.flak : G.flak;
  bodyPath(ctx, d);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(side ? -1 : 2.5, -20, 20, 40);
  if (vest) {
    ctx.beginPath();
    if (d === 'S') {
      ctx.moveTo(-6.8, top + 0.8);
      ctx.lineTo(-2.2, top + 0.8);
      ctx.lineTo(0, top + 2.8);
      ctx.lineTo(2.2, top + 0.8);
      ctx.lineTo(6.8, top + 0.8);
      ctx.lineTo(9, 8.4);
      ctx.lineTo(-9, 8.4);
    } else if (d === 'N') {
      ctx.moveTo(-7.4, top + 0.4);
      ctx.lineTo(7.4, top + 0.4);
      ctx.lineTo(9, 8.4);
      ctx.lineTo(-9, 8.4);
    } else {
      ctx.moveTo(-4.8, top + 0.6);
      ctx.lineTo(2.6, top + 0.6);
      ctx.lineTo(5.4, top + 2.6);
      ctx.lineTo(7.6, 8.4);
      ctx.lineTo(-6, 8.4);
    }
    ctx.closePath();
    fillStroke(ctx, flak);
    // Стёжка: вертикальные швы, поперечная стяжка, блик по верхнему краю.
    ctx.beginPath();
    const seams = d === 'S' ? [-5.4, -2.8, 2.8, 5.4] : d === 'N' ? [-5, -1.7, 1.7, 5] : [-3, 0, 3];
    for (const sx of seams) {
      ctx.moveTo(sx, top + (d === 'S' && Math.abs(sx) < 3 ? 3.6 : 2));
      ctx.lineTo(sx * 1.08, 7.8);
    }
    stroke(ctx, 0.55, tint(flak, -0.32));
    ctx.beginPath();
    ctx.moveTo(-9, 3.4);
    ctx.lineTo(9, 3.4);
    stroke(ctx, 1.1, tint(flak, -0.2));
    ctx.beginPath();
    if (d === 'S') {
      ctx.moveTo(-6, top + 1.7);
      ctx.lineTo(-2.8, top + 1.7);
    } else if (d === 'N') {
      ctx.moveTo(-6.2, top + 1.4);
      ctx.lineTo(-1, top + 1.4);
    } else {
      ctx.moveTo(-3.6, top + 1.5);
      ctx.lineTo(1.8, top + 1.5);
    }
    stroke(ctx, 0.8, tint(flak, 0.3));
    // Номер юнита цвета ранга: на груди, на спине — полоса.
    ctx.beginPath();
    if (d === 'S') ctx.rect(2.6, top + 4.4, 3.2, 1.3);
    else if (d === 'N') ctx.rect(-4.5, top + 2.2, 9, 1.4);
    else ctx.rect(1.2, top + 4.4, 2.6, 1.3);
    fillStroke(ctx, trim, 0.5);
  } else {
    // Рекрут — форменная рубашка: карманы и планка.
    ctx.beginPath();
    if (d === 'S') {
      ctx.rect(-5.4, top + 2.6, 3, 2.6);
      ctx.rect(2.4, top + 2.6, 3, 2.6);
    } else if (side) ctx.rect(1.4, top + 2.6, 3, 2.6);
    if (d !== 'N') fillStroke(ctx, tint(base, 0.14), 0.6);
    if (d === 'S') {
      ctx.beginPath();
      ctx.moveTo(0, top + 0.6);
      ctx.lineTo(0, 7.6);
      stroke(ctx, 0.6, tint(base, -0.4));
    }
  }
  belt(ctx, d, O.belt as string, acc.has('pouches'));
  ctx.restore();
  bodyPath(ctx, d);
  stroke(ctx, PAWN.outlineWidth);
  // Высокий воротник жилета и мягкие наплечники.
  if (vest && d !== 'N') {
    ctx.beginPath();
    ctx.ellipse(side ? 1 : 0, top + 0.9, side ? 3.4 : 4.8, 1.9, 0, 0, Math.PI * 2);
    fillStroke(ctx, tint(flak, -0.12), PAWN.outlineWidth * 0.8);
  }
  for (const px of shoulders(d, 0.2)) pad(ctx, px, top + 2.2, 3, 2.8, vest ? flak : tint(base, 0.12), null);
}

/** Голова в противогазе PCU: резиновая маска, две круглые линзы с бликом, фильтр; сзади — ремни. */
export function gasMaskHead(ctx: Ctx, d: PawnDir, hx: number): void {
  const H = PAWN.head;
  const E = PAWN.eye;
  headPath(ctx, d, hx);
  ctx.fillStyle = G.mask;
  ctx.fill();
  ctx.save();
  headPath(ctx, d, hx);
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(d === 'E' ? hx - 22 : 3, -40, 20, 60);
  ctx.restore();
  headPath(ctx, d, hx);
  stroke(ctx, PAWN.outlineWidth);
  if (d === 'N') {
    ctx.beginPath();
    ctx.moveTo(-H.r + 0.6, -9);
    ctx.quadraticCurveTo(0, -7.4, H.r - 0.6, -9);
    ctx.moveTo(-H.r + 1.4, -5.4);
    ctx.quadraticCurveTo(0, -4.2, H.r - 1.4, -5.4);
    stroke(ctx, 0.9, tint(G.mask, 0.25));
    return;
  }
  const lenses = d === 'E' ? [hx + H.r - 2.5] : [-E.dx - 0.2, E.dx + 0.2];
  for (const lx of lenses) {
    ctx.beginPath();
    ctx.arc(lx, E.y, d === 'E' ? 1.7 : 1.95, 0, Math.PI * 2);
    ctx.fillStyle = G.lens;
    ctx.fill();
    stroke(ctx, 0.9, G.lensRim);
    ctx.beginPath();
    ctx.arc(lx - 0.5, E.y - 0.5, 0.55, 0, Math.PI * 2);
    ctx.fillStyle = G.shine;
    ctx.fill();
  }
  // Фильтр — «морда» маски.
  ctx.beginPath();
  if (d === 'E') roundRect(ctx, hx + H.r - 3.2, -7, 4.6, 3.6, 1.2);
  else roundRect(ctx, -2.3, -6.6, 4.6, 3.8, 1.3);
  fillStroke(ctx, G.filter, 0.8);
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const fx = d === 'E' ? hx + H.r - 2.2 + k * 1.2 : -1.2 + k * 1.2;
    ctx.moveTo(fx, d === 'E' ? -6.4 : -6);
    ctx.lineTo(fx, d === 'E' ? -4 : -3.4);
  }
  stroke(ctx, 0.5, tint(G.filter, -0.4));
}

/** Каска PCU (как flak helmet RimWorld): купол ниже бровей с полями, полоса цвета ранга. */
export function flakHelmet(ctx: Ctx, d: PawnDir, trim: string, hx: number): void {
  const H = PAWN.head;
  const R = H.r + 1;
  const hc = H.y - 2.4;
  const cx = d === 'E' ? hx - 0.4 : 0;
  const path = (): void => {
    ctx.beginPath();
    if (d === 'N') {
      ctx.moveTo(cx - R, hc + 3.6);
      ctx.lineTo(cx - R, hc);
      ctx.arc(cx, hc, R, Math.PI, 0);
      ctx.lineTo(cx + R, hc + 3.6);
      ctx.quadraticCurveTo(cx, hc + 5.2, cx - R, hc + 3.6);
    } else if (d === 'E') {
      ctx.moveTo(cx - R, hc + 3.2);
      ctx.lineTo(cx - R, hc);
      ctx.arc(cx, hc, R, Math.PI, 0);
      ctx.lineTo(cx + R + 1.8, hc + 1.2);
      ctx.lineTo(cx + R + 1.4, hc + 2.1);
      ctx.lineTo(cx + 0.6, hc + 2.1);
      ctx.quadraticCurveTo(cx - R + 1.2, hc + 4, cx - R, hc + 3.2);
    } else {
      ctx.moveTo(-R - 0.9, hc + 2);
      ctx.lineTo(-R, hc);
      ctx.arc(0, hc, R, Math.PI, 0);
      ctx.lineTo(R + 0.9, hc + 2);
    }
    ctx.closePath();
  };
  path();
  ctx.fillStyle = G.helmet;
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(d === 'E' ? cx - 22 : 3.4, hc - 20, 20, 40);
  ctx.fillStyle = trim;
  ctx.fillRect(cx - 12, hc - 2.6, 24, 1.5);
  ctx.restore();
  path();
  stroke(ctx, PAWN.outlineWidth);
  if (d !== 'N') {
    ctx.beginPath();
    ctx.moveTo(d === 'E' ? cx - R + 0.6 : -R - 0.4, hc + 1.1);
    ctx.lineTo(d === 'E' ? cx + R + 1.3 : R + 0.4, hc + 1.1);
    stroke(ctx, 0.7, tint(G.helmet, -0.35));
  }
  ctx.beginPath();
  ctx.arc(cx - 0.6, hc - 0.6, R - 1.8, Math.PI * 1.15, Math.PI * 1.5);
  stroke(ctx, 1, tint(G.helmet, 0.35));
}

/** Фуражка офицера и инспектора: тулья шире головы, околыш цвета ранга, козырёк, кокарда. */
export function peakedCap(ctx: Ctx, d: PawnDir, trim: string, hx: number): void {
  const H = PAWN.head;
  const cx = d === 'E' ? hx - 0.2 : 0;
  const y0 = H.y - 3.2;
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(cx - 6.6, y0);
    ctx.lineTo(cx - 7.8, y0 - 5.2);
    ctx.quadraticCurveTo(cx, y0 - 7.8, cx + 8.6, y0 - 5);
    ctx.lineTo(cx + 6.8, y0);
  } else {
    ctx.moveTo(-6.8, y0);
    ctx.lineTo(-9.4, y0 - 5);
    ctx.quadraticCurveTo(0, y0 - 8.4, 9.4, y0 - 5);
    ctx.lineTo(6.8, y0);
  }
  ctx.closePath();
  fillStroke(ctx, G.cap, PAWN.outlineWidth);
  ctx.beginPath();
  ctx.rect(cx - 6.7, y0 - 2, 13.4, 2);
  fillStroke(ctx, trim, 0.6);
  if (d === 'S') {
    ctx.beginPath();
    ctx.moveTo(-6.2, y0);
    ctx.quadraticCurveTo(0, y0 + 3.2, 6.2, y0);
    ctx.quadraticCurveTo(0, y0 + 1.2, -6.2, y0);
    fillStroke(ctx, G.peak, 0.8);
  } else if (d === 'E') {
    ctx.beginPath();
    ctx.moveTo(cx + 4, y0);
    ctx.quadraticCurveTo(cx + 9.5, y0 + 0.6, cx + 10.2, y0 + 1.8);
    ctx.lineTo(cx + 4.4, y0 + 1);
    ctx.closePath();
    fillStroke(ctx, G.peak, 0.8);
  }
  if (d !== 'N') {
    ctx.beginPath();
    ctx.arc(d === 'E' ? cx + 5.2 : 0, y0 - 3.8, 1.2, 0, Math.PI * 2);
    fillStroke(ctx, G.gold, 0.6);
  }
}

// ————— SU: рекон-броня и шлем с визором —————

/** Облегчённая сегментная броня SU: нагрудная пластина, сегменты живота, набедренники. */
export function reconBody(ctx: Ctx, d: PawnDir, O: Outfit, trim: string, acc: Set<string>): void {
  const top = PAWN.body.top;
  const side = d === 'E';
  const armor = O.armor as string;
  const hi = tint(armor, 0.3);
  const lo = tint(armor, -0.25);
  bodyPath(ctx, d);
  ctx.fillStyle = O.base as string;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(side ? -1 : 2.5, -20, 20, 40);
  ctx.beginPath();
  if (d === 'S') {
    ctx.moveTo(-6.4, top + 0.8);
    ctx.lineTo(6.4, top + 0.8);
    ctx.lineTo(7.6, top + 4.2);
    ctx.lineTo(3.8, top + 6.6);
    ctx.lineTo(-3.8, top + 6.6);
    ctx.lineTo(-7.6, top + 4.2);
  } else if (d === 'N') {
    ctx.moveTo(-7, top + 0.6);
    ctx.lineTo(7, top + 0.6);
    ctx.lineTo(7.8, top + 6.4);
    ctx.lineTo(-7.8, top + 6.4);
  } else {
    ctx.moveTo(-3.4, top + 0.8);
    ctx.lineTo(4.4, top + 0.8);
    ctx.lineTo(6.8, top + 4.4);
    ctx.lineTo(4.4, top + 6.6);
    ctx.lineTo(-3.8, top + 6.6);
  }
  ctx.closePath();
  fillStroke(ctx, armor);
  ctx.beginPath();
  if (side) {
    roundRect(ctx, -2.6, top + 7.2, 8, 1.6, 0.6);
    roundRect(ctx, -2.4, top + 9.2, 7.6, 1.5, 0.6);
  } else {
    roundRect(ctx, -5.2, top + 7.2, 10.4, 1.6, 0.6);
    roundRect(ctx, -4.8, top + 9.2, 9.6, 1.5, 0.6);
  }
  fillStroke(ctx, lo, 0.6);
  // Шов, полосы цвета ранга, блик.
  ctx.beginPath();
  if (d === 'S') {
    ctx.moveTo(0, top + 1);
    ctx.lineTo(0, top + 6.4);
  } else if (d === 'N') {
    ctx.moveTo(0, top + 1);
    ctx.lineTo(0, top + 6.2);
  }
  stroke(ctx, PAWN.seamWidth);
  ctx.beginPath();
  if (d === 'S') {
    ctx.moveTo(-6, top + 3.2);
    ctx.lineTo(-3, top + 4.8);
    ctx.moveTo(6, top + 3.2);
    ctx.lineTo(3, top + 4.8);
  } else if (d === 'N') {
    ctx.moveTo(-3.6, top + 2.6);
    ctx.lineTo(3.6, top + 2.6);
  } else {
    ctx.moveTo(1.6, top + 3.4);
    ctx.lineTo(5, top + 5);
  }
  stroke(ctx, 1.2, trim);
  ctx.beginPath();
  if (d === 'S') {
    ctx.moveTo(-5, top + 1.7);
    ctx.lineTo(-1.2, top + 1.7);
  } else if (side) {
    ctx.moveTo(-2.4, top + 1.7);
    ctx.lineTo(3.2, top + 1.7);
  }
  stroke(ctx, 0.9, hi);
  belt(ctx, d, O.belt as string, true);
  // Набедренники.
  ctx.beginPath();
  if (side) roundRect(ctx, -0.6, 10.2, 6.8, 3.2, 1.2);
  else {
    roundRect(ctx, -6.6, 10.2, 5.6, 3.2, 1.2);
    roundRect(ctx, 1, 10.2, 5.6, 3.2, 1.2);
  }
  fillStroke(ctx, lo, 0.7);
  ctx.restore();
  bodyPath(ctx, d);
  stroke(ctx, PAWN.outlineWidth);
  if (d !== 'N') {
    ctx.beginPath();
    ctx.ellipse(side ? 1 : 0, top + 0.7, side ? 3 : 4.2, 1.6, 0, 0, Math.PI * 2);
    fillStroke(ctx, lo, PAWN.outlineWidth * 0.8);
  }
  const big = acc.has('bigPads');
  for (const px of shoulders(d, big ? 0.8 : 0.2)) pad(ctx, px, top + 2.3, big ? 4.1 : 3.3, big ? 3.8 : 3, armor, trim);
}

/** Шлем SU: оболочка с вырезом для лица, под ней балаклава, визор на глазах, гарнитура. */
export function reconHelmet(ctx: Ctx, d: PawnDir, O: Outfit, trim: string, hx: number): void {
  const H = PAWN.head;
  headPath(ctx, d, hx);
  ctx.fillStyle = G.balaclava;
  ctx.fill();
  stroke(ctx, PAWN.outlineWidth);
  const R = H.r + 1.1;
  const cy = H.y - 0.6;
  const cx = d === 'E' ? hx + 0.2 : 0;
  const shell = O.armor as string;
  const lo = tint(shell, -0.3);
  const path = (): void => {
    ctx.beginPath();
    if (d === 'E') {
      ctx.moveTo(cx - R, cy + 3);
      ctx.lineTo(cx - R, cy);
      ctx.arc(cx, cy, R, Math.PI, Math.PI * 1.97);
      ctx.lineTo(cx + R + 0.6, cy + 1.2);
      ctx.lineTo(cx + 1, cy + 2.4);
      ctx.quadraticCurveTo(cx - 1, cy + 5.6, cx - R + 0.6, cy + 5.2);
    } else if (d === 'N') {
      ctx.moveTo(-R, cy + 2);
      ctx.lineTo(-R, cy);
      ctx.arc(0, cy, R, Math.PI, 0);
      ctx.lineTo(R - 0.4, cy + 5.2);
      ctx.quadraticCurveTo(0, cy + 7, -R + 0.4, cy + 5.2);
    } else {
      ctx.moveTo(-R, cy + 2);
      ctx.lineTo(-R, cy);
      ctx.arc(0, cy, R, Math.PI, 0);
      ctx.lineTo(R - 0.2, cy + 5.4);
      ctx.lineTo(R - 2.6, cy + 6.2);
      ctx.lineTo(R - 2.8, cy + 0.8);
      ctx.quadraticCurveTo(0, cy - 3.6, -R + 2.8, cy + 0.8);
      ctx.lineTo(-R + 2.6, cy + 6.2);
      ctx.lineTo(-R + 0.2, cy + 5.4);
    }
    ctx.closePath();
  };
  path();
  ctx.fillStyle = shell;
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(d === 'E' ? cx - 22 : 3.4, cy - 20, 20, 40);
  ctx.restore();
  path();
  stroke(ctx, PAWN.outlineWidth);
  // Гребень цвета ранга и блик.
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(cx - 3.4, cy - R + 1.1);
    ctx.quadraticCurveTo(cx + 0.6, cy - R - 0.3, cx + 3.8, cy - R + 1.6);
  } else {
    ctx.moveTo(0, cy - R + 0.3);
    ctx.lineTo(0, cy - R + (d === 'N' ? 6 : 3.2));
  }
  stroke(ctx, 1.4, trim);
  ctx.beginPath();
  ctx.arc(cx - 0.5, cy - 0.4, R - 1.7, Math.PI * 1.12, Math.PI * 1.45);
  stroke(ctx, 0.9, tint(shell, 0.35));
  // Наушник с микрофоном.
  const ears = d === 'E' ? [cx - 1.4] : [-R + 0.7, R - 0.7];
  for (const ex of ears) {
    ctx.beginPath();
    ctx.arc(ex, cy + 2.2, d === 'E' ? 2 : 1.3, 0, Math.PI * 2);
    fillStroke(ctx, lo, PAWN.outlineWidth * 0.8);
  }
  if (d === 'N') return;
  if (d === 'E') {
    ctx.beginPath();
    ctx.moveTo(cx - 0.4, cy + 3.4);
    ctx.quadraticCurveTo(cx + 3, cy + 6.4, cx + R - 1, cy + 5.4);
    stroke(ctx, 0.7, lo);
  }
  // Визор поверх глаз.
  ctx.beginPath();
  if (d === 'E') roundRect(ctx, cx + 1.4, cy + 0.3, R + 0.6, 3, 1.2);
  else roundRect(ctx, -R + 2.2, cy + 0.2, (R - 2.2) * 2, 3.2, 1.4);
  fillStroke(ctx, G.reconVisor, PAWN.seamWidth);
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(cx + 3, cy + 1.6);
    ctx.lineTo(cx + R + 1.2, cy + 1.6);
  } else {
    ctx.moveTo(-R + 3.6, cy + 1.7);
    ctx.lineTo(R - 3.6, cy + 1.7);
  }
  stroke(ctx, 0.8, G.reconGlow);
}

// ————— Аксессуары —————

/** За спиной (до туловища): плащ, полы плаща, ранец и баллон в профиле, антенна спереди и в профиле. */
export function accBack(ctx: Ctx, d: PawnDir, O: Outfit, acc: Set<string>): void {
  const top = PAWN.body.top;
  if (acc.has('cape') && d !== 'N') {
    const cape = O.cape as string;
    ctx.beginPath();
    if (d === 'S') {
      ctx.moveTo(-7.4, top + 1.2);
      ctx.lineTo(-10.6, 15.8);
      ctx.quadraticCurveTo(0, 17.2, 10.6, 15.8);
      ctx.lineTo(7.4, top + 1.2);
    } else {
      ctx.moveTo(-2.6, top + 0.6);
      ctx.lineTo(-11.4, 16);
      ctx.quadraticCurveTo(-5, 16.8, 1.5, 15.2);
      ctx.lineTo(1.2, top + 2);
    }
    ctx.closePath();
    fillStroke(ctx, cape, PAWN.outlineWidth);
  }
  if (acc.has('coat')) {
    ctx.beginPath();
    if (d === 'E') {
      ctx.moveTo(-5.6, 2);
      ctx.lineTo(-8.8, 16.4);
      ctx.lineTo(5.4, 16.2);
      ctx.lineTo(5, 2);
    } else {
      ctx.moveTo(-8.8, 2);
      ctx.lineTo(-10.2, 16.6);
      ctx.lineTo(10.2, 16.6);
      ctx.lineTo(8.8, 2);
    }
    ctx.closePath();
    fillStroke(ctx, O.coat as string, PAWN.outlineWidth);
  }
  if (d === 'E') {
    if (acc.has('tank')) {
      ctx.beginPath();
      roundRect(ctx, -12.4, top - 4.4, 5, 13, 2);
      fillStroke(ctx, G.tank, PAWN.outlineWidth);
      ctx.beginPath();
      ctx.moveTo(-12.4, top - 1);
      ctx.lineTo(-7.4, top - 1);
      ctx.moveTo(-12.4, top + 5.4);
      ctx.lineTo(-7.4, top + 5.4);
      stroke(ctx, 0.8, tint(G.tank, -0.35));
    } else if (acc.has('pack') && O.style !== 'marine') {
      ctx.beginPath();
      roundRect(ctx, -9.6, top + 1.2, 5, 8.6, 1.6);
      fillStroke(ctx, G.pack, PAWN.outlineWidth);
    }
  }
  if (acc.has('antenna') && d !== 'N') antenna(ctx, d === 'E' ? -7.6 : 5.4, d === 'E' ? -9.8 : 7.2);
}

function antenna(ctx: Ctx, x0: number, x1: number): void {
  const top = PAWN.body.top;
  ctx.beginPath();
  ctx.moveTo(x0, top + 1.4);
  ctx.lineTo(x1, -25);
  stroke(ctx, 0.9, G.antenna);
  ctx.beginPath();
  ctx.arc(x1, -25, 0.9, 0, Math.PI * 2);
  ctx.fillStyle = G.antenna;
  ctx.fill();
}

/** Поверх туловища и наплечников (до головы). */
export function accBody(ctx: Ctx, d: PawnDir, O: Outfit, trim: string, acc: Set<string>): void {
  const B = PAWN.body;
  const top = B.top;
  const side = d === 'E';
  if (acc.has('coat')) {
    // Распахнутый плащ: полы по бокам, броня видна посередине; сзади — целиком, со шлицей.
    const coat = O.coat as string;
    ctx.beginPath();
    if (d === 'S') {
      for (const k of [-1, 1]) {
        ctx.moveTo(k * 7.4, top + 0.8);
        ctx.lineTo(k * 3.2, top + 1.2);
        ctx.lineTo(k * 4.2, 8);
        ctx.lineTo(k * 5.6, 16.4);
        ctx.lineTo(k * 10.2, 16.2);
        ctx.lineTo(k * 9.2, 5);
        ctx.closePath();
      }
    } else if (d === 'N') {
      ctx.moveTo(-7.6, top + 0.6);
      ctx.lineTo(7.6, top + 0.6);
      ctx.lineTo(10.2, 16.4);
      ctx.lineTo(-10.2, 16.4);
      ctx.closePath();
    } else {
      ctx.moveTo(-5.4, top + 0.8);
      ctx.lineTo(2.8, top + 0.8);
      ctx.lineTo(3.2, 8);
      ctx.lineTo(5.2, 16.2);
      ctx.lineTo(-8.4, 16.4);
      ctx.lineTo(-6.6, 5);
      ctx.closePath();
    }
    fillStroke(ctx, coat, PAWN.outlineWidth);
    ctx.beginPath();
    if (d === 'N') {
      ctx.moveTo(0, 9);
      ctx.lineTo(0, 16.4);
    } else if (d === 'S') {
      ctx.moveTo(-3.4, top + 1.4);
      ctx.lineTo(-5.4, top + 5.4);
      ctx.moveTo(3.4, top + 1.4);
      ctx.lineTo(5.4, top + 5.4);
    }
    stroke(ctx, 0.7, tint(coat, 0.3));
  }
  if (acc.has('cape') && d === 'N') {
    const cape = O.cape as string;
    ctx.beginPath();
    ctx.moveTo(-7.8, top + 3.2);
    ctx.lineTo(7.8, top + 3.2);
    ctx.lineTo(10.4, 15.8);
    ctx.quadraticCurveTo(0, 17, -10.4, 15.8);
    ctx.closePath();
    fillStroke(ctx, cape, PAWN.outlineWidth);
    ctx.beginPath();
    for (const fx of [-4, 0, 4]) {
      ctx.moveTo(fx * 0.7, top + 5);
      ctx.lineTo(fx * 1.2, 15.6);
    }
    stroke(ctx, 0.7, tint(cape, -0.35));
  }
  if (acc.has('pack') && O.style !== 'marine') {
    if (d === 'N') {
      ctx.beginPath();
      roundRect(ctx, -4.4, top + 1.6, 8.8, 7.4, 1.6);
      fillStroke(ctx, G.pack, PAWN.outlineWidth * 0.9);
      ctx.beginPath();
      ctx.moveTo(-4.4, top + 3.6);
      ctx.lineTo(4.4, top + 3.6);
      stroke(ctx, 0.7, tint(G.pack, 0.25));
      if (acc.has('medic')) cross(ctx, 0, top + 6, 1.4);
    } else if (d === 'S') {
      ctx.beginPath();
      ctx.moveTo(-5, top + 0.8);
      ctx.lineTo(-5.6, top + 5.8);
      ctx.moveTo(5, top + 0.8);
      ctx.lineTo(5.6, top + 5.8);
      stroke(ctx, 1.2, tint(G.pack, -0.2));
    }
  }
  if (acc.has('chevrons')) {
    ctx.beginPath();
    for (const px of shoulders(d, 0.4)) {
      for (let k = 0; k < 2; k++) {
        const y = top + 5.2 + k * 1.2;
        ctx.moveTo(px - 1.6, y);
        ctx.lineTo(px, y + 1.1);
        ctx.lineTo(px + 1.6, y);
      }
    }
    stroke(ctx, 0.9, trim);
  }
  if (acc.has('band') && d !== 'N') {
    const px = side ? 0.4 : B.shoulder + 0.4;
    ctx.beginPath();
    ctx.rect(px - 2, top + 4.6, 4, 2.4);
    fillStroke(ctx, trim, 0.6);
  }
  if (acc.has('medic')) {
    const px = side ? 0.4 : d === 'N' ? -B.shoulder - 0.4 : B.shoulder + 0.4;
    ctx.beginPath();
    ctx.rect(px - 2, top + 4.6, 4, 2.4);
    fillStroke(ctx, G.medic, 0.6);
    cross(ctx, px, top + 5.8, 0.9);
    if (d !== 'N') {
      const bx = side ? -3.2 : -7.6;
      ctx.beginPath();
      roundRect(ctx, bx, 7.4, 3.4, 3.2, 0.6);
      fillStroke(ctx, G.medic, 0.6);
      cross(ctx, bx + 1.7, 9, 0.9);
    }
  }
  if (acc.has('radio') && d !== 'N') {
    const rx = side ? 2.2 : -6.2;
    ctx.beginPath();
    roundRect(ctx, rx, top + 2.4, side ? 2.4 : 2.8, 3.8, 0.6);
    fillStroke(ctx, G.radio, 0.7);
    ctx.beginPath();
    ctx.moveTo(rx + 0.9, top + 2.4);
    ctx.lineTo(rx + 0.5, top - 0.8);
    stroke(ctx, 0.8, G.antenna);
    ctx.fillStyle = trim;
    ctx.fillRect(rx + 0.7, top + 3.2, 1, 0.8);
  }
  if (acc.has('scanner') && d !== 'N') {
    const sx = side ? 2.6 : 1.2;
    ctx.beginPath();
    roundRect(ctx, sx, top + 2.4, side ? 2.8 : 4.2, 3.2, 0.6);
    fillStroke(ctx, G.scanner, 0.7);
    ctx.fillStyle = G.screen;
    ctx.fillRect(sx + 0.6, top + 3, side ? 1.6 : 3, 2);
  }
  if (acc.has('grenades')) {
    const at = d === 'S' ? [4.6, 7] : d === 'N' ? [-6.4, -4] : [4.2];
    for (const gx of at) {
      ctx.beginPath();
      ctx.arc(gx, 10.4, 1.35, 0, Math.PI * 2);
      fillStroke(ctx, G.grenade, 0.6);
      ctx.fillStyle = G.antenna;
      ctx.fillRect(gx - 0.5, 8.6, 1, 0.8);
    }
  }
  if (acc.has('lamp')) {
    // Фонарь на правом плече (спереди — слева на экране, сзади — справа).
    ctx.beginPath();
    if (side) roundRect(ctx, 0.6, top - 1, 3.8, 2.4, 0.8);
    else roundRect(ctx, d === 'N' ? 6 : -9.4, top - 0.6, 3.4, 2.4, 0.8);
    fillStroke(ctx, G.lamp, 0.7);
    if (d !== 'N') {
      ctx.beginPath();
      if (side) ctx.arc(4.6, top + 0.2, 0.9, 0, Math.PI * 2);
      else ctx.arc(-7.7, top + 1.6, 0.8, 0, Math.PI * 2);
      ctx.fillStyle = G.lampLens;
      ctx.fill();
    }
  }
  if (acc.has('epaulettes')) {
    for (const px of shoulders(d, acc.has('bigPads') ? 0.8 : 0.2)) {
      ctx.beginPath();
      roundRect(ctx, px - 2.6, top - 0.4, 5.2, 1.8, 0.7);
      fillStroke(ctx, G.gold, 0.6);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        ctx.moveTo(px - 2 + k * 1.33, top + 1.4);
        ctx.lineTo(px - 2 + k * 1.33, top + 2.4);
      }
      stroke(ctx, 0.5, G.gold);
    }
  }
  if (acc.has('aiguillette') && d !== 'N') {
    ctx.beginPath();
    if (side) {
      ctx.moveTo(0.4, top + 2.2);
      ctx.quadraticCurveTo(2.2, top + 6.4, 4.8, top + 3.4);
    } else {
      ctx.moveTo(-7.6, top + 2.2);
      ctx.bezierCurveTo(-6.6, top + 6.2, -3.2, top + 6.4, -1.4, top + 3.2);
      ctx.moveTo(-7.4, top + 2.8);
      ctx.bezierCurveTo(-6.2, top + 7.6, -2.6, top + 7.8, -1.4, top + 3.2);
    }
    stroke(ctx, 0.9, G.gold);
  }
}

/** Поверх головы (вид сзади): баллон катафракта и антенна ранца ближе к зрителю, чем голова. */
export function accTop(ctx: Ctx, d: PawnDir, acc: Set<string>): void {
  if (d !== 'N') return;
  const top = PAWN.body.top;
  if (acc.has('tank')) {
    ctx.beginPath();
    roundRect(ctx, -4.2, top - 4.6, 8.4, 14, 2.4);
    fillStroke(ctx, G.tank, PAWN.outlineWidth);
    ctx.beginPath();
    ctx.moveTo(-4.2, top - 1);
    ctx.lineTo(4.2, top - 1);
    ctx.moveTo(-4.2, top + 6);
    ctx.lineTo(4.2, top + 6);
    stroke(ctx, 0.8, tint(G.tank, -0.35));
    ctx.beginPath();
    ctx.arc(-1.6, top - 2.8, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = tint(G.tank, 0.4);
    ctx.fill();
  }
  if (acc.has('antenna')) antenna(ctx, 4.6, 6.8);
}

/** Красный крест медика. */
function cross(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = G.cross;
  ctx.fillRect(x - r, y - r * 0.32, r * 2, r * 0.64);
  ctx.fillRect(x - r * 0.32, y - r, r * 0.64, r * 2);
}
