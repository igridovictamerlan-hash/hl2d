import { PAWN } from '../config/pawns';
import type { PawnDir } from './PawnRenderer';
import { bodyPath, fillStroke, headPath, roundRect, stroke, tint } from './pawnShapes';

/**
 * Военное снаряжение армии сопротивления и HYDRA (style: 'tactical', PAWN.professionOutfits) — по
 * мотивам военных модов RimWorld: полевая форма (у ветеранов — камуфляж), плитник или разгрузка с
 * подсумками, шлем MICH с чехлом, очками или креплением ПНВ; HYDRA — как SAS: тёмный комбинезон,
 * серый тактический жилет, противогаз S10 с синим фильтром. Всё в координатах пешки (px мира от
 * центра, восток; запад — отражение). Поля одежды:
 *  base — форма, camo — пятна камуфляжа (цвета через пробел), rig — 'plate' (плитник) / 'chest'
 *  (разгрузка) / нет, rigColor, helmet — цвет шлема, helmetCamo — чехол в камуфляже, hgoggles —
 *  очки на шлеме (цвет линз), nvg — крепление ПНВ, face — 'bare' / 'balaclava' / 'gasmask' /
 *  'maybeMask' (балаклава у части бойцов), mask/lens/filter/filterRing — противогаз, lambda — нашивка.
 */
type Ctx = CanvasRenderingContext2D;
type Outfit = Record<string, string | boolean | number>;

const T = PAWN.tactical;

/** Пятна камуфляжа внутри текущего клипа: фиксированный рисунок, смещённый по зерну. */
function camo(ctx: Ctx, colors: string[], x0: number, y0: number, w: number, h: number, salt: number): void {
  const spots = T.camoSpots;
  for (let k = 0; k < spots.length; k++) {
    const [fx, fy, rx, ry, rot] = spots[(k + salt) % spots.length];
    ctx.beginPath();
    ctx.ellipse(x0 + fx * w, y0 + fy * h, rx, ry, rot, 0, Math.PI * 2);
    ctx.fillStyle = colors[k % colors.length];
    ctx.fill();
  }
}

function camoColors(O: Outfit, key = 'camo'): string[] {
  return String(O[key] ?? '').split(' ').filter(Boolean);
}

/** Лицо под маской: балаклава или противогаз, по зерну — у части бойцов с 'maybeMask'. */
export function tacticalFace(O: Outfit, seed: number): 'bare' | 'balaclava' | 'gasmask' {
  const f = O.face as string | undefined;
  if (f === 'maybeMask') return ((Math.imul(seed ^ 0x5bd1e995, 2654435761) >>> 0) % 1000) / 1000 < T.maskChance ? 'balaclava' : 'bare';
  return f === 'balaclava' || f === 'gasmask' ? f : 'bare';
}

/** Форма, камуфляж, плитник или разгрузка с подсумками, пояс; рукава. */
export function tacticalBody(ctx: Ctx, d: PawnDir, O: Outfit, seed: number): void {
  const top = PAWN.body.top;
  const side = d === 'E';
  const base = O.base as string;
  const rig = O.rig as string | undefined;
  const rc = (O.rigColor as string | undefined) ?? tint(base, -0.15);
  bodyPath(ctx, d);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const cc = camoColors(O);
  if (cc.length) camo(ctx, cc, -10, top, 20, 20, seed % 5);
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(side ? -1 : 2.5, -20, 20, 40);
  if (rig === 'plate') {
    // Плитник: пластина на груди (на спине — целиком), камербанд по бокам, три подсумка под магазины.
    ctx.beginPath();
    if (d === 'S') roundRect(ctx, -6.2, top + 1.2, 12.4, 9.2, 1.4);
    else if (d === 'N') roundRect(ctx, -6.8, top + 0.8, 13.6, 10, 1.4);
    else roundRect(ctx, -3.6, top + 1.2, 9.4, 9.2, 1.4);
    fillStroke(ctx, rc);
    ctx.beginPath();
    ctx.rect(-10, top + 7.6, 20, 3.2);
    fillStroke(ctx, tint(rc, -0.12), 0.6);
    // Ячейки MOLLE.
    ctx.beginPath();
    for (let y = top + 3.2; y < top + 7; y += 1.5) {
      ctx.moveTo(side ? -3 : -5.6, y);
      ctx.lineTo(side ? 5.2 : 5.6, y);
    }
    stroke(ctx, 0.45, tint(rc, -0.35));
    if (d !== 'N') {
      ctx.beginPath();
      const at = side ? [0.4, 3.2] : [-5.2, -1.6, 2];
      for (const px of at) roundRect(ctx, px, top + 6.6, 3.2, 3.8, 0.6);
      fillStroke(ctx, tint(rc, 0.1), 0.6);
      // Административный подсумок и нашивка.
      if (d === 'S') {
        ctx.beginPath();
        roundRect(ctx, -2.6, top + 2.4, 5.2, 3.2, 0.6);
        fillStroke(ctx, tint(rc, 0.06), 0.55);
      }
    } else {
      // Сзади: гидратор.
      ctx.beginPath();
      roundRect(ctx, -3.4, top + 2, 6.8, 7, 1.6);
      fillStroke(ctx, tint(rc, -0.08), 0.6);
    }
  } else if (rig === 'chest') {
    // Разгрузка: ряд подсумков поперёк груди, лямки крест-накрест на спине.
    if (d === 'N') {
      ctx.beginPath();
      ctx.moveTo(-6.4, top + 0.6);
      ctx.lineTo(5.4, top + 9);
      ctx.moveTo(6.4, top + 0.6);
      ctx.lineTo(-5.4, top + 9);
      stroke(ctx, 1.6, rc);
    } else {
      ctx.beginPath();
      ctx.moveTo(side ? -2 : -5.6, top + 0.6);
      ctx.lineTo(side ? -1.4 : -4.6, top + 5);
      ctx.moveTo(side ? 3 : 5.6, top + 0.6);
      ctx.lineTo(side ? 3.6 : 4.6, top + 5);
      stroke(ctx, 1.5, rc);
      ctx.beginPath();
      if (side) roundRect(ctx, -2.6, top + 4.6, 8.4, 4.4, 0.8);
      else roundRect(ctx, -7, top + 4.6, 14, 4.4, 0.8);
      fillStroke(ctx, rc);
      ctx.beginPath();
      const at = side ? [0.4, 3] : [-4.6, -1.5, 1.6, 4.7];
      for (const px of at) {
        ctx.moveTo(px, top + 4.8);
        ctx.lineTo(px, top + 8.8);
      }
      stroke(ctx, 0.5, tint(rc, -0.35));
    }
  } else if (d === 'S') {
    // Без снаряжения — полевая рубаха: карманы и планка.
    ctx.beginPath();
    ctx.rect(-5.4, top + 2.6, 3, 2.6);
    ctx.rect(2.4, top + 2.6, 3, 2.6);
    fillStroke(ctx, tint(base, 0.12), 0.6);
    ctx.beginPath();
    ctx.moveTo(0, top + 0.6);
    ctx.lineTo(0, 7.6);
    stroke(ctx, 0.6, tint(base, -0.4));
  }
  // Ремень.
  ctx.beginPath();
  ctx.rect(-12, 9.6, 24, 2);
  fillStroke(ctx, (O.belt as string) ?? T.belt, 0.6);
  ctx.restore();
  bodyPath(ctx, d);
  stroke(ctx, PAWN.outlineWidth);
  // Рукава и нашивка-молния «Грозы» на плече.
  const sleeves = side ? [0.5] : [-PAWN.body.shoulder - 0.2, PAWN.body.shoulder + 0.2];
  for (const px of sleeves) {
    ctx.beginPath();
    ctx.ellipse(px, top + 2.4, 3, 2.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = base;
    ctx.fill();
    if (cc.length) {
      ctx.save();
      ctx.clip();
      camo(ctx, cc, px - 3, top - 0.4, 6, 5.6, (seed + 3) % 5);
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(px, top + 2.4, 3, 2.8, 0, 0, Math.PI * 2);
    }
    stroke(ctx, PAWN.outlineWidth * 0.85);
  }
  if (O.lambda && d !== 'N') {
    const lx = side ? 0.5 : -PAWN.body.shoulder - 0.2;
    ctx.beginPath();
    ctx.rect(lx - 1.6, top + 1.4, 3.2, 2.6);
    fillStroke(ctx, T.patch, 0.5);
    ctx.beginPath();
    ctx.moveTo(lx + 0.6, top + 1.7);
    ctx.lineTo(lx - 0.6, top + 2.8);
    ctx.lineTo(lx + 0.5, top + 2.8);
    ctx.lineTo(lx - 0.6, top + 3.9);
    stroke(ctx, 0.55, O.lambda as string);
  }
}

/** Балаклава: голова тёмная, прорезь для глаз цвета кожи (глаза — face()). */
export function balaclava(ctx: Ctx, d: PawnDir, skin: string, color: string, hx: number): void {
  headPath(ctx, d, hx);
  ctx.fillStyle = color;
  ctx.fill();
  if (d !== 'N') {
    ctx.save();
    headPath(ctx, d, hx);
    ctx.clip();
    ctx.fillStyle = skin;
    const E = PAWN.eye;
    if (d === 'E') ctx.fillRect(hx + 1.2, E.y - 1.9, 8, 3.8);
    else ctx.fillRect(-5.6, E.y - 1.9, 11.2, 3.8);
    ctx.restore();
  }
  ctx.save();
  headPath(ctx, d, hx);
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(d === 'E' ? hx - 22 : 3, -40, 20, 60);
  ctx.restore();
  headPath(ctx, d, hx);
  stroke(ctx, PAWN.outlineWidth);
}

/**
 * Противогаз S10 (SAS): чёрная резиновая маска на всё лицо, две большие каплевидные линзы, переговорное
 * устройство посередине, фильтр сбоку с синим кольцом; сзади — ремни.
 */
export function gasMaskS10(ctx: Ctx, d: PawnDir, O: Outfit, hx: number): void {
  const H = PAWN.head;
  const mask = O.mask as string;
  headPath(ctx, d, hx);
  ctx.fillStyle = mask;
  ctx.fill();
  ctx.save();
  headPath(ctx, d, hx);
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(d === 'E' ? hx - 22 : 3, -40, 20, 60);
  ctx.restore();
  headPath(ctx, d, hx);
  stroke(ctx, PAWN.outlineWidth);
  const cy = H.y;
  if (d === 'N') {
    ctx.beginPath();
    ctx.moveTo(-H.r + 1, cy - 1.4);
    ctx.lineTo(H.r - 1, cy + 2.6);
    ctx.moveTo(H.r - 1, cy - 1.4);
    ctx.lineTo(-H.r + 1, cy + 2.6);
    stroke(ctx, 1, tint(mask, 0.25));
    return;
  }
  const lens = O.lens as string;
  const lenses: [number, number, number][] = d === 'E' ? [[hx + 4.4, cy + 0.2, 0.3]] : [[-3, cy + 0.4, -0.35], [3, cy + 0.4, 0.35]];
  for (const [lx, ly, rot] of lenses) {
    ctx.beginPath();
    ctx.ellipse(lx, ly, d === 'E' ? 2 : 2.4, 2.9, rot, 0, Math.PI * 2);
    fillStroke(ctx, lens, 1);
    ctx.fillStyle = T.lensShine;
    ctx.fillRect(lx - 1.2, ly - 1.8, 1, 1.4);
  }
  // Переговорное устройство.
  ctx.beginPath();
  if (d === 'E') roundRect(ctx, hx + 5.6, cy + 3.8, 3, 3, 1);
  else roundRect(ctx, -1.8, cy + 4.2, 3.6, 3, 1);
  fillStroke(ctx, tint(mask, 0.18), 0.7);
  // Фильтр слева на щеке (у S10 — сбоку), синее кольцо.
  const fx = d === 'E' ? hx + 2 : -5.4;
  const fy = cy + 5.4;
  ctx.beginPath();
  ctx.ellipse(fx, fy, 2.6, 2.4, 0, 0, Math.PI * 2);
  fillStroke(ctx, O.filter as string, 0.8);
  ctx.beginPath();
  ctx.ellipse(fx, fy, 1.6, 1.4, 0, 0, Math.PI * 2);
  stroke(ctx, 0.9, O.filterRing as string);
}

/**
 * Шлем MICH: купол до бровей, вырез у ушей, боковые рельсы; чехол (в камуфляже у ветеранов),
 * очки на лбу или крепление ПНВ спереди.
 */
export function michHelmet(ctx: Ctx, d: PawnDir, O: Outfit, hx: number, seed: number): void {
  const H = PAWN.head;
  const R = H.r + 1.1;
  const hc = H.y - 1.6;
  const cx = d === 'E' ? hx - 0.2 : 0;
  const color = O.helmet as string;
  const path = (): void => {
    ctx.beginPath();
    if (d === 'N') {
      ctx.moveTo(cx - R, hc + 3.4);
      ctx.lineTo(cx - R, hc);
      ctx.arc(cx, hc, R, Math.PI, 0);
      ctx.lineTo(cx + R, hc + 3.4);
      ctx.quadraticCurveTo(cx, hc + 4.6, cx - R, hc + 3.4);
    } else if (d === 'E') {
      ctx.moveTo(cx - R, hc + 3.4);
      ctx.lineTo(cx - R, hc);
      ctx.arc(cx, hc, R, Math.PI, 0);
      ctx.lineTo(cx + R, hc + 0.2);
      ctx.lineTo(cx + 2.4, hc + 0.2);
      ctx.lineTo(cx + 0.6, hc + 3.2);
      ctx.quadraticCurveTo(cx - R + 1, hc + 4.4, cx - R, hc + 3.4);
    } else {
      ctx.moveTo(-R, hc + 3.2);
      ctx.lineTo(-R, hc);
      ctx.arc(0, hc, R, Math.PI, 0);
      ctx.lineTo(R, hc + 3.2);
      ctx.lineTo(R - 1.8, hc + 3.2);
      ctx.lineTo(R - 2.2, hc + 0.2);
      ctx.quadraticCurveTo(0, hc - 0.6, -R + 2.2, hc + 0.2);
      ctx.lineTo(-R + 1.8, hc + 3.2);
    }
    ctx.closePath();
  };
  path();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  const cc = O.helmetCamo ? camoColors(O) : [];
  if (cc.length) camo(ctx, cc, cx - R, hc - R, R * 2, R * 1.4, seed % 5);
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(d === 'E' ? cx - 22 : 3.4, hc - 20, 20, 40);
  ctx.restore();
  path();
  stroke(ctx, PAWN.outlineWidth);
  // Боковые рельсы.
  ctx.beginPath();
  if (d === 'E') roundRect(ctx, cx - 3.6, hc - 0.6, 5.4, 1.4, 0.5);
  else if (d === 'S') {
    roundRect(ctx, -R - 0.4, hc - 1.4, 1.6, 3.4, 0.5);
    roundRect(ctx, R - 1.2, hc - 1.4, 1.6, 3.4, 0.5);
  }
  if (d !== 'N') fillStroke(ctx, T.rail, 0.5);
  ctx.beginPath();
  ctx.arc(cx - 0.6, hc - 0.6, R - 1.8, Math.PI * 1.15, Math.PI * 1.5);
  stroke(ctx, 0.9, tint(color, 0.3));
  const gog = O.hgoggles as string | undefined;
  if (gog) {
    // Очки на шлеме: резинка вокруг и две линзы надо лбом.
    ctx.beginPath();
    if (d === 'N') {
      ctx.moveTo(cx - R + 0.2, hc - 1.6);
      ctx.quadraticCurveTo(cx, hc - 0.4, cx + R - 0.2, hc - 1.6);
    } else if (d === 'E') {
      ctx.moveTo(cx - R + 0.2, hc - 1.2);
      ctx.lineTo(cx + R - 0.2, hc - 2.6);
    } else {
      ctx.moveTo(-R + 0.2, hc - 1.2);
      ctx.quadraticCurveTo(0, hc - 2.2, R - 0.2, hc - 1.2);
    }
    stroke(ctx, 1.3, T.strap);
    if (d !== 'N') {
      const at = d === 'E' ? [cx + 4.6] : [-2.4, 2.4];
      for (const gx of at) {
        ctx.beginPath();
        ctx.ellipse(gx, d === 'E' ? hc - 2.6 : hc - 2, d === 'E' ? 1.6 : 2.2, 1.6, 0, 0, Math.PI * 2);
        fillStroke(ctx, gog, 0.8);
        ctx.fillStyle = T.lensShine;
        ctx.fillRect(gx - 1, (d === 'E' ? hc - 2.6 : hc - 2) - 1, 0.9, 0.8);
      }
    }
  }
  if (O.nvg && d !== 'N') {
    // Крепление ПНВ — площадка спереди на куполе.
    ctx.beginPath();
    if (d === 'E') roundRect(ctx, cx + R - 2.4, hc - 4.2, 2.8, 2.4, 0.6);
    else roundRect(ctx, -1.6, hc - R + 1.4, 3.2, 2.6, 0.6);
    fillStroke(ctx, T.nvg, 0.6);
  }
}
