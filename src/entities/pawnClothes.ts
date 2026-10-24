import { PAWN } from '../config/pawns';
import { CLOTHES, type ClothesLook, type OuterId } from '../config/clothes';
import { bodyPath, fillStroke, roundRect, stroke, tint } from './pawnShapes';
import type { PawnDir } from './PawnRenderer';

/**
 * Гражданская одежда по достатку (config/clothes.ts) — слоями поверх туловища пешки. Координаты — px
 * модели от центра персонажа (как в PawnRenderer): туловище от B.top до B.bottom, голова — H.y, H.r;
 * d — S (лицо), N (спина), E (профиль, перед — +x). Порядок: clothedBody (туловище, подол, юбка, шарф —
 * до головы) → голова (PawnRenderer) → clothesHead (головной убор, очки).
 */
type Ctx = CanvasRenderingContext2D;
type Pt = readonly [number, number];

const B = PAWN.body;
const H = PAWN.head;
const OW = PAWN.outlineWidth;
const SW = PAWN.seamWidth;
const D = CLOTHES.detail;
const TOP = B.top;

/** Длинные — с подолом ниже туловища (до щиколоток). */
const LONG: ReadonlySet<OuterId> = new Set(['ragcoat', 'trench', 'camel']);
/** Верх с юбкой: кромка верха поверх юбки. */
const SHORT_OVER_SKIRT: ReadonlySet<OuterId> = new Set(['cardigan', 'zip', 'blazer']);

function poly(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, w: number, color: string = PAWN.outline): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  stroke(ctx, w, color);
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string, w = 0.5): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  fillStroke(ctx, color, w);
}

/** Зеркальная пара точек для вида спереди/сзади: слева (−x) и справа. */
function mirror(pts: readonly Pt[]): Pt[] {
  return pts.map(([x, y]) => [-x, y] as Pt);
}

/** Мех: замкнутый контур с «гребешками» наружу (от центра фигуры). */
function fluffy(ctx: Ctx, pts: readonly Pt[], bump = 1, step = 2.3): void {
  let cx = 0;
  let cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length;
  cy /= pts.length;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % pts.length];
    const len = Math.hypot(qx - px, qy - py);
    const n = Math.max(1, Math.round(len / step));
    let nx = -(qy - py) / (len || 1);
    let ny = (qx - px) / (len || 1);
    for (let k = 0; k < n; k++) {
      const ax = px + ((qx - px) * k) / n;
      const ay = py + ((qy - py) * k) / n;
      const bx = px + ((qx - px) * (k + 1)) / n;
      const by = py + ((qy - py) * (k + 1)) / n;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      ctx.quadraticCurveTo(mx + nx * bump, my + ny * bump, bx, by);
    }
  }
  ctx.closePath();
}

/** Пучки меха — светлые и тёмные штрихи в заданных местах. */
function tufts(ctx: Ctx, at: readonly Pt[]): void {
  at.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 0.7, y + 0.7, x + 0.2, y + 1.7);
    stroke(ctx, 0.6, i % 2 ? D.furDark : D.fur);
  });
}

// ——————————————————————————— Туловище ———————————————————————————

/**
 * Туловище в комплекте: заливка низа, узор, брюки, детали низа, верх, поношенность, тень — внутри контура;
 * потом контур, длинный подол, юбка, фартук, мех, шарф и воротники (спереди и в профиле — до головы).
 */
export function clothedBody(ctx: Ctx, d: PawnDir, C: ClothesLook, skin: string, band?: string): void {
  const side = d === 'E';
  bodyPath(ctx, d);
  ctx.fillStyle = C.topColor;
  ctx.fill();
  ctx.save();
  bodyPath(ctx, d);
  ctx.clip();
  pattern(ctx, d, C);
  const hem = C.top === 'sweater' || C.top === 'turtleneck' ? 9.6 : 7.2;
  if (C.top !== 'dress') {
    ctx.fillStyle = C.pants ?? CLOTHES.pants[C.tier];
    ctx.fillRect(-14, hem, 28, 12);
  }
  topDetails(ctx, d, C, skin, hem);
  if (C.suspenders && (!C.outer || C.outer === 'sack')) suspenders(ctx, d, C.suspenders);
  if (C.outer && C.outer !== 'fur') outer(ctx, d, C);
  if (C.rope) ropeBelt(ctx, d, C.outer === 'sack' ? 5.6 : 7.2);
  wear(ctx, d, C);
  if (band && d !== 'N') {
    ctx.beginPath();
    ctx.rect(side ? -3 : 4.2, TOP + 3.2, side ? 5 : 4, 2);
    fillStroke(ctx, band, 0.6);
  }
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(side ? -1 : 2.5, -20, 20, 40);
  ctx.restore();
  bodyPath(ctx, d);
  stroke(ctx, OW);

  if (C.skirt && C.outer !== 'fur') {
    skirt(ctx, d, C.skirt);
    if (C.outer && SHORT_OVER_SKIRT.has(C.outer)) outerOverSkirt(ctx, d, C);
  }
  if (C.apron) apron(ctx, d, C.apron);
  if (C.outer && LONG.has(C.outer)) longHem(ctx, d, C.outerColor ?? C.topColor, C.frayed ?? false, C.outer === 'trench');
  if (C.outer === 'fur') furCoat(ctx, d, C.outerColor ?? '#7a5a3e');
  if (C.outer === 'camel' && d !== 'N') furCollar(ctx, d, C.trim ?? '#5a4434');
  if (d !== 'N') neckwear(ctx, d, C);
  else neckBack(ctx, C);
  if (C.brooch && d === 'S') {
    dot(ctx, -3.6, TOP + 4.2, 1.1, C.brooch, 0.6);
    dot(ctx, -3.6, TOP + 4.2, 0.45, '#8a1c2a', 0.3);
  }
}

/** Узор низа: полоски, клетка, вязка, ромбы (внутри контура). */
function pattern(ctx: Ctx, d: PawnDir, C: ClothesLook): void {
  const p2 = C.pattern2 ?? tint(C.topColor, -0.3);
  switch (C.pattern) {
    case 'stripes':
      ctx.fillStyle = p2;
      for (let y = TOP + 1; y < 14; y += 2.4) ctx.fillRect(-14, y, 28, 1.1);
      break;
    case 'plaid':
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = p2;
      for (let y = TOP + 1; y < 14; y += 3.6) ctx.fillRect(-14, y, 28, 1.2);
      for (let x = -9; x < 10; x += 3.6) ctx.fillRect(x, -10, 1.2, 30);
      ctx.globalAlpha = 1;
      break;
    case 'knit':
      // Вязка: ряды «ёлочкой».
      for (let y = TOP + 2.5; y < 9; y += 2.2) {
        ctx.beginPath();
        for (let x = -9; x < 10; x += 2) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + 1, y + 1);
          ctx.lineTo(x + 2, y);
        }
        stroke(ctx, 0.45, p2);
      }
      break;
    case 'argyle': {
      // Ромбы: в профиле — один ряд.
      const xs = d === 'E' ? [-1.6, 3.4] : [-6, -2, 2, 6];
      xs.forEach((x, i) => {
        poly(ctx, [[x, TOP + 3.2], [x + 2, TOP + 6], [x, TOP + 8.8], [x - 2, TOP + 6]]);
        ctx.fillStyle = i % 2 ? p2 : tint(C.topColor, -0.22);
        ctx.fill();
      });
      ctx.setLineDash([0.6, 0.6]);
      ctx.beginPath();
      for (const x of xs) {
        ctx.moveTo(x - 2, TOP + 3.2);
        ctx.lineTo(x + 2, TOP + 8.8);
        ctx.moveTo(x + 2, TOP + 3.2);
        ctx.lineTo(x - 2, TOP + 8.8);
      }
      stroke(ctx, 0.35, tint(C.topColor, 0.4));
      ctx.setLineDash([]);
      break;
    }
  }
}

/** Детали низа: вырез майки, воротник рубахи, горловина и резинка свитера, блузка, вырез платья, ремень. */
function topDetails(ctx: Ctx, d: PawnDir, C: ClothesLook, skin: string, hem: number): void {
  const side = d === 'E';
  const c = C.topColor;
  switch (C.top) {
    case 'undershirt': {
      // Майка: открытые плечи и глубокий вырез.
      ctx.fillStyle = skin;
      if (side) {
        poly(ctx, [[2.6, -8], [12, -8], [12, TOP + 4], [5.2, TOP + 3.4]]);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0.2, TOP + 2.6, 2.2, 3.4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const outerPts: Pt[] = [[-12, -8], [-4.8, -8], [-4.8, TOP + 3], [-6.6, TOP + 6.8], [-12, TOP + 6.8]];
        poly(ctx, outerPts);
        ctx.fill();
        poly(ctx, mirror(outerPts));
        ctx.fill();
        if (d === 'S') {
          ctx.beginPath();
          ctx.moveTo(-3.2, -8);
          ctx.lineTo(-3.2, TOP + 1.4);
          ctx.quadraticCurveTo(0, TOP + 5.2, 3.2, TOP + 1.4);
          ctx.lineTo(3.2, -8);
          ctx.closePath();
          ctx.fill();
        }
      }
      break;
    }
    case 'tee':
      if (d === 'S') {
        ctx.beginPath();
        ctx.moveTo(-3, TOP);
        ctx.quadraticCurveTo(0, TOP + 3, 3, TOP);
        stroke(ctx, 1, tint(c, -0.2));
      }
      break;
    case 'shirt':
      if (d === 'S') {
        const l: Pt[] = [[-3.8, TOP - 0.2], [-0.3, TOP + 3], [-2.6, TOP + 3.9]];
        for (const p of [l, mirror(l)]) {
          poly(ctx, p);
          fillStroke(ctx, tint(c, -0.05));
        }
        line(ctx, 0, TOP + 3, 0, hem, 0.5, tint(c, -0.3));
        for (const y of [TOP + 5.4, TOP + 8.4, TOP + 11.2]) if (y < hem) dot(ctx, 0.5, y, 0.4, tint(c, -0.35), 0.2);
      } else if (side) {
        poly(ctx, [[3.2, TOP - 0.2], [6.2, TOP + 1.4], [4.4, TOP + 3.2]]);
        fillStroke(ctx, tint(c, -0.05));
      } else {
        ctx.beginPath();
        ctx.rect(-4, TOP - 0.4, 8, 1.8);
        fillStroke(ctx, tint(c, -0.06), 0.6);
      }
      break;
    case 'sweater':
    case 'turtleneck': {
      // Горловина (у водолазки — высокая), резинка внизу.
      const hi = C.top === 'turtleneck';
      ctx.beginPath();
      if (d === 'S') {
        ctx.moveTo(-4.2, TOP - 1);
        ctx.lineTo(-4.2, TOP + (hi ? 3.4 : 1.2));
        ctx.quadraticCurveTo(0, TOP + (hi ? 5 : 3.2), 4.2, TOP + (hi ? 3.4 : 1.2));
        ctx.lineTo(4.2, TOP - 1);
      } else if (side) {
        ctx.moveTo(-1.6, TOP - 1);
        ctx.lineTo(-1.6, TOP + (hi ? 3 : 1.2));
        ctx.lineTo(5.4, TOP + (hi ? 3.6 : 1.8));
        ctx.lineTo(5.4, TOP - 1);
      } else {
        ctx.rect(-4.2, TOP - 1, 8.4, hi ? 4 : 2);
      }
      fillStroke(ctx, tint(c, -0.08), SW);
      ctx.beginPath();
      for (let x = -4; x <= 4; x += 1.1) {
        ctx.moveTo(side ? x * 0.8 + 1.8 : x, TOP + 0.2);
        ctx.lineTo(side ? x * 0.8 + 1.8 : x, TOP + (hi ? 2.8 : 1));
      }
      stroke(ctx, 0.35, tint(c, -0.3));
      ctx.beginPath();
      ctx.rect(-14, hem - 2, 28, 2);
      fillStroke(ctx, tint(c, -0.1), 0.5);
      ctx.beginPath();
      for (let x = -9; x <= 9; x += 1.1) {
        ctx.moveTo(x, hem - 1.8);
        ctx.lineTo(x, hem - 0.2);
      }
      stroke(ctx, 0.35, tint(c, -0.3));
      break;
    }
    case 'blouse':
      if (d === 'S') {
        for (const x of [-2.2, 2.2]) {
          ctx.beginPath();
          ctx.ellipse(x, TOP + 1.8, 2.4, 1.8, x < 0 ? 0.35 : -0.35, 0, Math.PI * 2);
          fillStroke(ctx, tint(c, 0.25), 0.6);
        }
        for (const y of [TOP + 5, TOP + 7.6, TOP + 10]) dot(ctx, 0, y, 0.45, tint(c, -0.3), 0.2);
      } else if (side) {
        ctx.beginPath();
        ctx.ellipse(4.2, TOP + 1.4, 2.2, 1.5, -0.3, 0, Math.PI * 2);
        fillStroke(ctx, tint(c, 0.25), 0.6);
      }
      break;
    case 'dress':
      if (d === 'S') {
        ctx.beginPath();
        ctx.moveTo(-3.2, -8);
        ctx.lineTo(-3.2, TOP);
        ctx.quadraticCurveTo(0, TOP + 4, 3.2, TOP);
        ctx.lineTo(3.2, -8);
        ctx.closePath();
        ctx.fillStyle = skin;
        ctx.fill();
        stroke(ctx, SW);
      } else if (side) {
        poly(ctx, [[3, -8], [12, -8], [12, TOP + 2.8], [4.8, TOP + 2.2]]);
        ctx.fillStyle = skin;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.rect(-14, 6.4, 28, 1.4);
      fillStroke(ctx, tint(c, -0.3), 0.5);
      return;
  }
  // Ремень брюк (у заправленного низа и без верёвки).
  if (hem < 9 && !C.rope) {
    ctx.beginPath();
    ctx.rect(-14, hem - 0.4, 28, 1.6);
    fillStroke(ctx, C.tier === 'rich' ? '#1a1410' : '#3a2e24', 0.5);
    if (d !== 'N') {
      ctx.beginPath();
      ctx.rect(side ? 4.2 : -1, hem - 0.2, 2, 1.2);
      fillStroke(ctx, C.tier === 'rich' ? D.gold : '#8d9299', 0.4);
    }
  }
}

function suspenders(ctx: Ctx, d: PawnDir, color: string): void {
  ctx.lineCap = 'butt';
  if (d === 'S') {
    line(ctx, -3.4, TOP - 1, -3.2, 7.4, 1.4, color);
    line(ctx, 3.4, TOP - 1, 3.2, 7.4, 1.4, color);
    dot(ctx, -3.2, 6.6, 0.45, '#8d9299', 0.3);
    dot(ctx, 3.2, 6.6, 0.45, '#8d9299', 0.3);
  } else if (d === 'N') {
    line(ctx, -3.8, TOP - 1, 3, 7.4, 1.4, color);
    line(ctx, 3.8, TOP - 1, -3, 7.4, 1.4, color);
  } else {
    line(ctx, 1.4, TOP - 1, 1.8, 7.4, 1.4, color);
  }
  ctx.lineCap = 'round';
}

function ropeBelt(ctx: Ctx, d: PawnDir, y: number): void {
  ctx.beginPath();
  ctx.rect(-14, y - 0.2, 28, 1.6);
  fillStroke(ctx, D.rope, 0.5);
  ctx.beginPath();
  for (let x = -10; x < 10; x += 1.1) {
    ctx.moveTo(x, y + 1.3);
    ctx.lineTo(x + 0.9, y - 0.1);
  }
  stroke(ctx, 0.35, tint(D.rope, -0.4));
  if (d === 'N') return;
  const kx = d === 'E' ? 4.6 : 1.6;
  dot(ctx, kx, y + 0.6, 1, D.rope, 0.5);
  line(ctx, kx, y + 1.4, kx - 0.6, y + 4.6, 0.8, D.rope);
  line(ctx, kx + 0.3, y + 1.4, kx + 1.2, y + 4, 0.8, D.rope);
}

// ——————————————————————————— Верх ———————————————————————————

/**
 * Полы спереди: от горловины (±neck на TOP) клином к застёжке (y = close) и вниз; gap > 0 — распахнуто
 * (видна полоса низа). В профиле — одна пола, кромка на x = edge.
 */
function panels(ctx: Ctx, d: PawnDir, color: string, neck: number, close: number, gap: number, edge = 5): void {
  if (d === 'N') {
    ctx.fillStyle = color;
    ctx.fillRect(-14, TOP - 4, 28, 30);
    return;
  }
  if (d === 'E') {
    poly(ctx, [[-14, -8], [edge - 2.6, -8], [edge - 2.6, TOP], [edge, close], [edge, 20], [-14, 20]]);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(edge - 2.6, TOP);
    ctx.lineTo(edge, close);
    ctx.lineTo(edge, 20);
    stroke(ctx, SW);
    return;
  }
  const left: Pt[] = [[-14, -8], [-neck, -8], [-neck, TOP], [-gap, close], [-gap, 20], [-14, 20]];
  for (const p of [left, mirror(left)]) {
    poly(ctx, p);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.beginPath();
  for (const k of [-1, 1]) {
    ctx.moveTo(k * neck, TOP);
    ctx.lineTo(k * gap, close);
    ctx.lineTo(k * gap, 20);
  }
  stroke(ctx, SW);
}

/** Лацканы (S — пара, E — один у кромки). */
function lapels(ctx: Ctx, d: PawnDir, color: string, neck: number, close: number, wide = 1, satin = false): void {
  if (d === 'N') return;
  const pts: Pt[] = d === 'E'
    ? [[2.4, TOP], [2.4 + 3.4 * wide, TOP + 1.2], [4.8, close]]
    : [[-neck, TOP], [-neck - 2.6 * wide, TOP + 1.4], [-neck - 1.4 * wide, TOP + 2.6], [-neck - 2 * wide, TOP + 3.4], [0, close]];
  for (const p of d === 'E' ? [pts] : [pts, mirror(pts)]) {
    poly(ctx, p);
    fillStroke(ctx, color);
    if (satin) {
      ctx.beginPath();
      ctx.moveTo(p[0][0] * 0.9, p[0][1] + 0.6);
      ctx.lineTo(p[p.length - 1][0] * 0.5 + p[1][0] * 0.3, p[p.length - 1][1] - 1.6);
      stroke(ctx, 0.8, D.satin);
    }
  }
}

function buttons(ctx: Ctx, xs: readonly number[], ys: readonly number[], color: string, r = 0.65): void {
  for (const x of xs) for (const y of ys) dot(ctx, x, y, r, color, 0.4);
}

function flap(ctx: Ctx, x: number, y: number, w: number, color: string): void {
  ctx.beginPath();
  ctx.rect(x, y, w, 1.1);
  fillStroke(ctx, tint(color, -0.12), 0.5);
}

/** Задняя сторона верха: шов по спине, разрез внизу, полоса воротника. */
function backSeams(ctx: Ctx, color: string, vent: boolean): void {
  line(ctx, 0, TOP + 2.4, 0, vent ? 10 : 14, 0.5, tint(color, -0.3));
  if (vent) line(ctx, 0, 10, 0, 16, SW);
  ctx.beginPath();
  ctx.rect(-4.6, TOP - 0.4, 9.2, 2.2);
  fillStroke(ctx, tint(color, -0.1), 0.6);
}

function outer(ctx: Ctx, d: PawnDir, C: ClothesLook): void {
  const col = C.outerColor ?? '#5a5650';
  const trim = C.trim ?? tint(col, -0.3);
  const side = d === 'E';
  const S = d === 'S';
  switch (C.outer) {
    case 'quilted': {
      panels(ctx, d, col, 2.4, TOP + 3, 0, 5.4);
      // Стёганые «трубы»: вертикальные строчки.
      ctx.beginPath();
      const xs = side ? [-3.4, -0.8, 1.8, 4.2] : d === 'N' ? [-7.8, -5.2, -2.6, 0, 2.6, 5.2, 7.8] : [-7.8, -5.2, -2.6, 2.6, 5.2, 7.8];
      for (const x of xs) {
        ctx.moveTo(x, TOP + 2.2);
        ctx.lineTo(x, 14);
      }
      stroke(ctx, 0.6, tint(col, -0.3));
      if (S) {
        const l: Pt[] = [[-2.4, TOP - 0.2], [-5.6, TOP + 0.6], [-3.6, TOP + 3.4], [0, TOP + 3]];
        for (const p of [l, mirror(l)]) { poly(ctx, p); fillStroke(ctx, tint(col, -0.1)); }
        buttons(ctx, [0], [0.6, 4, 7.4, 10.8], '#2a2622', 0.7);
      } else if (side) {
        poly(ctx, [[2.6, TOP - 0.2], [5.8, TOP + 0.8], [4.6, TOP + 3.4]]);
        fillStroke(ctx, tint(col, -0.1));
        buttons(ctx, [4.6], [0.6, 4, 7.4, 10.8], '#2a2622', 0.6);
      } else backSeams(ctx, col, false);
      break;
    }
    case 'ragcoat':
      panels(ctx, d, col, 3.2, TOP + 2.4, 1.6, 4.4);
      lapels(ctx, d, tint(col, -0.12), 3.2, TOP + 3.4, 0.7);
      if (d === 'N') backSeams(ctx, col, true);
      break;
    case 'sack': {
      // Накидка из мешковины: до пояса, рваный край, грубое плетение.
      ctx.beginPath();
      ctx.moveTo(-14, -8);
      ctx.lineTo(14, -8);
      const hemY = side ? 5.2 : 5.6;
      for (let x = 14, k = 0; x >= -14; x -= 1.8, k++) ctx.lineTo(x, hemY + (k % 2 ? 1.6 : 0) + (k % 3 === 0 ? 0.6 : 0));
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      stroke(ctx, SW);
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      for (let x = -14; x < 14; x += 1.3) {
        ctx.moveTo(x, -8);
        ctx.lineTo(x + 8, 8);
      }
      for (let y = -8; y < 8; y += 1.3) {
        ctx.moveTo(-14, y);
        ctx.lineTo(14, y);
      }
      stroke(ctx, 0.3, tint(col, -0.22));
      ctx.restore();
      if (S) {
        ctx.beginPath();
        ctx.ellipse(0, TOP + 0.6, 3.4, 1.4, 0, 0, Math.PI * 2);
        fillStroke(ctx, tint(col, -0.3), 0.5);
      }
      break;
    }
    case 'cardigan': {
      panels(ctx, d, col, 2.6, TOP + 4, 1.4, 4.8);
      ctx.beginPath();
      ctx.rect(-14, 11.6, 28, 3);
      fillStroke(ctx, tint(col, -0.1), 0.5);
      ctx.beginPath();
      for (let x = -9; x <= 9; x += 1) {
        ctx.moveTo(x, 11.8);
        ctx.lineTo(x, 13.8);
      }
      stroke(ctx, 0.3, tint(col, -0.3));
      if (S) {
        buttons(ctx, [-2.2], [TOP + 5.2, 4.2, 7.4], tint(col, 0.35), 0.55);
        flap(ctx, -6.8, 7.6, 3.4, col);
        flap(ctx, 3.4, 7.6, 3.4, col);
      } else if (side) buttons(ctx, [4.2], [TOP + 5.2, 4.2, 7.4], tint(col, 0.35), 0.5);
      else backSeams(ctx, col, false);
      break;
    }
    case 'zip': {
      panels(ctx, d, col, 3.2, TOP + 1.6, 0, 5.4);
      if (S) {
        ctx.beginPath();
        ctx.rect(-3.4, TOP - 0.6, 6.8, 2.6);
        fillStroke(ctx, tint(col, -0.1), 0.6);
        line(ctx, 0, TOP + 2, 0, 14, 0.6, tint(col, -0.5));
        ctx.beginPath();
        ctx.rect(-0.6, TOP + 2.2, 1.2, 1.8);
        fillStroke(ctx, '#9aa0a8', 0.3);
        line(ctx, -6.4, 3.6, -4.4, 8, 0.7, tint(col, -0.35));
        line(ctx, 6.4, 3.6, 4.4, 8, 0.7, tint(col, -0.35));
      } else if (side) {
        line(ctx, 5.4, TOP + 1.6, 5.4, 14, 0.6, tint(col, -0.5));
        line(ctx, 1.2, 4, 3, 8, 0.7, tint(col, -0.35));
      } else {
        backSeams(ctx, col, false);
        line(ctx, -8, TOP + 3.6, 8, TOP + 3.6, 0.5, tint(col, -0.3));
      }
      ctx.beginPath();
      ctx.rect(-14, 11.8, 28, 2.4);
      fillStroke(ctx, tint(col, -0.14), 0.5);
      break;
    }
    case 'blazer':
    case 'tux':
    case 'suit': {
      const close = C.outer === 'suit' ? 6.4 : 5;
      if (C.outer === 'suit' && S) {
        // Жилет тройки — в вырезе пиджака.
        poly(ctx, [[-3, -2], [0, TOP + 5], [3, -2], [3, 10], [-3, 10]]);
        fillStroke(ctx, trim);
        buttons(ctx, [0], [TOP + 6.6, TOP + 8.6], tint(trim, 0.4), 0.4);
      }
      panels(ctx, d, col, 2.8, close, 0, 5.6);
      const tux = C.outer === 'tux';
      lapels(ctx, d, tux ? trim : tint(col, -0.12), 2.8, close, 1, tux);
      if (S) {
        buttons(ctx, [0], C.outer === 'suit' ? [7.6, 10.4] : [6.4, 9.4], tint(col, tux ? 0.15 : -0.45), 0.7);
        if (!tux) {
          flap(ctx, -6.8, 9.6, 3.6, col);
          flap(ctx, 3.2, 9.6, 3.6, col);
        }
        line(ctx, 3.2, 1.8, 6, 1.8, 0.6, tint(col, -0.35));
        if (C.pocket) {
          poly(ctx, [[3.6, 1.8], [4.4, 0.4], [5, 1.2], [5.6, 0.5], [5.8, 1.8]]);
          fillStroke(ctx, C.pocket, 0.4);
        }
        if (C.watch) {
          ctx.beginPath();
          ctx.moveTo(-0.4, 7.4);
          ctx.quadraticCurveTo(-2.6, 9.4, -5, 8.2);
          stroke(ctx, 0.55, D.gold);
          dot(ctx, -5, 8.2, 0.6, D.gold, 0.3);
        }
      } else if (side) {
        flap(ctx, 0.2, 9.6, 3.6, col);
        buttons(ctx, [5.2], [close + 1.4], tint(col, -0.45), 0.6);
      } else backSeams(ctx, col, true);
      break;
    }
    case 'trench':
    case 'camel': {
      const trench = C.outer === 'trench';
      panels(ctx, d, col, 3, TOP + (trench ? 3.2 : 2.4), 0, 5.6);
      lapels(ctx, d, tint(col, -0.1), 3, TOP + (trench ? 4.2 : 3.4), trench ? 1.25 : 1);
      if (S) {
        if (trench) {
          ctx.beginPath();
          ctx.moveTo(-6.8, TOP + 1.8);
          ctx.quadraticCurveTo(-5.4, TOP + 6, -2.2, TOP + 6.4);
          stroke(ctx, 0.6, tint(col, -0.3));
          buttons(ctx, [-2.4, 2.4], [1.2, 4], trim, 0.6);
          buttons(ctx, [-2.4, 2.4], [10.8], trim, 0.6);
        } else buttons(ctx, [0], [3.4, 6.6, 9.8], tint(col, -0.4), 0.7);
        flap(ctx, -7, 9.4, 3.6, col);
        flap(ctx, 3.4, 9.4, 3.6, col);
      } else if (side) {
        buttons(ctx, trench ? [4.6, 2.8] : [4.8], [3.4, 6.6], trench ? trim : tint(col, -0.4), 0.55);
        flap(ctx, 0.2, 9.4, 3.6, col);
      } else {
        backSeams(ctx, col, true);
        if (trench) line(ctx, -8, TOP + 4.6, 8, TOP + 4.6, 0.6, tint(col, -0.3));
      }
      if (trench) {
        ctx.beginPath();
        ctx.rect(-14, 6.2, 28, 1.9);
        fillStroke(ctx, trim, 0.5);
        if (d !== 'N') {
          ctx.beginPath();
          ctx.rect(side ? 3.4 : -1.4, 6.1, 2.8, 2.1);
          fillStroke(ctx, tint(trim, -0.3), 0.4);
        }
      }
      break;
    }
    case 'peacoat': {
      panels(ctx, d, col, 3.4, TOP + 3, 0, 6);
      if (S) {
        const l: Pt[] = [[-3.4, TOP - 0.3], [-7.2, TOP + 1.2], [-5.6, TOP + 4.8], [0, TOP + 3]];
        for (const p of [l, mirror(l)]) { poly(ctx, p); fillStroke(ctx, tint(col, -0.12)); }
        buttons(ctx, [-2.6, 2.6], [-0.4, 2.8, 6], trim, 0.62);
        line(ctx, -5.8, 6, -5.8, 9.8, 0.7, tint(col, -0.35));
        line(ctx, 5.8, 6, 5.8, 9.8, 0.7, tint(col, -0.35));
      } else if (side) {
        poly(ctx, [[2.8, TOP - 0.3], [6.4, TOP + 1], [5, TOP + 4.6]]);
        fillStroke(ctx, tint(col, -0.12));
        buttons(ctx, [3.4, 5.4], [-0.4, 2.8, 6], trim, 0.55);
      } else {
        ctx.beginPath();
        ctx.rect(-6.6, TOP - 0.6, 13.2, 3.6);
        fillStroke(ctx, tint(col, -0.12), 0.6);
        line(ctx, 0, TOP + 3, 0, 14, 0.5, tint(col, -0.3));
      }
      break;
    }
    case 'french': {
      panels(ctx, d, col, 3, TOP + 2, 0, 5.8);
      const gold = trim;
      if (S) {
        ctx.beginPath();
        ctx.rect(-3.4, TOP - 0.8, 6.8, 2.8);
        fillStroke(ctx, tint(col, -0.1), 0.6);
        line(ctx, -3.2, TOP + 1.9, 3.2, TOP + 1.9, 0.5, gold);
        for (const [x, y, w, h] of [[-6.4, 0.6, 3.4, 3], [3, 0.6, 3.4, 3], [-7, 8.4, 3.8, 3.6], [3.2, 8.4, 3.8, 3.6]] as const) {
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          fillStroke(ctx, tint(col, -0.05), 0.5);
          flap(ctx, x, y, w, col);
          dot(ctx, x + w / 2, y + 0.6, 0.35, gold, 0.2);
        }
        if (C.medals) {
          D.medal.forEach((m, i) => {
            ctx.beginPath();
            ctx.rect(-6.4 + i * 1.2, -1, 1.1, 1.2);
            fillStroke(ctx, m, 0.3);
          });
        }
        buttons(ctx, [0], [0, 2.8, 5.4, 9, 11.6], gold, 0.65);
      } else if (side) {
        ctx.beginPath();
        ctx.rect(1.6, TOP - 0.8, 4.6, 2.8);
        fillStroke(ctx, tint(col, -0.1), 0.6);
        ctx.beginPath();
        ctx.rect(1.2, 0.6, 3.2, 3);
        fillStroke(ctx, tint(col, -0.05), 0.5);
        flap(ctx, 1.2, 0.6, 3.2, col);
        buttons(ctx, [5.4], [0, 2.8, 5.4, 9, 11.6], gold, 0.55);
      } else backSeams(ctx, col, false);
      ctx.beginPath();
      ctx.rect(-14, 6.4, 28, 1.6);
      fillStroke(ctx, tint(col, -0.4), 0.5);
      if (d !== 'N') {
        ctx.beginPath();
        ctx.rect(side ? 3.6 : -1.2, 6.3, 2.4, 1.8);
        fillStroke(ctx, gold, 0.4);
      }
      break;
    }
  }
}

/** Кромка короткого верха поверх юбки (кофта, куртка, пиджак). */
function outerOverSkirt(ctx: Ctx, d: PawnDir, C: ClothesLook): void {
  const col = C.outerColor ?? C.topColor;
  const gap = C.outer === 'cardigan' ? 1.4 : 0;
  const parts: Pt[][] = d === 'E'
    ? [[[-5.4, 7.2], [4.8, 7.2], [5, 10], [-5.8, 10]]]
    : d === 'N' ? [[[-7.4, 7.2], [7.4, 7.2], [7.8, 10], [-7.8, 10]]]
    : [[[-7.4, 7.2], [-gap, 7.2], [-gap, 10], [-7.8, 10]], mirror([[-7.4, 7.2], [-gap, 7.2], [-gap, 10], [-7.8, 10]])];
  for (const p of parts) {
    poly(ctx, p);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p[3][0], p[3][1]);
    ctx.lineTo(p[2][0], p[2][1]);
    if (gap) ctx.lineTo(p[1][0], p[1][1]);
    stroke(ctx, SW);
  }
  if (C.outer === 'cardigan') {
    ctx.beginPath();
    for (const p of parts) for (let x = Math.min(p[0][0], p[1][0]) + 0.6; x < Math.max(p[0][0], p[1][0]); x += 1) {
      ctx.moveTo(x, 8.2);
      ctx.lineTo(x, 9.8);
    }
    stroke(ctx, 0.3, tint(col, -0.3));
  }
}

/** Юбка: расклёшенная от пояса до щиколоток, складки. */
function skirt(ctx: Ctx, d: PawnDir, color: string): void {
  const side = d === 'E';
  const [l, r, lb, rb] = side ? [-5.4, 6.2, -6.8, 7.6] : [-7.4, 7.4, -9.4, 9.4];
  ctx.beginPath();
  ctx.moveTo(l, 7.4);
  ctx.lineTo(r, 7.4);
  ctx.lineTo(rb, 14);
  ctx.quadraticCurveTo((l + r) / 2, 15.2, lb, 14);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(side ? 1 : 2.5, 0, 20, 20);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(l, 7.4);
  ctx.lineTo(lb, 14);
  ctx.quadraticCurveTo((l + r) / 2, 15.2, rb, 14);
  ctx.lineTo(r, 7.4);
  stroke(ctx, OW);
  ctx.beginPath();
  for (const k of side ? [-0.5, 3] : [-3.4, 0, 3.4]) {
    ctx.moveTo(k, 9);
    ctx.lineTo(k * 1.3, 14.2);
  }
  stroke(ctx, 0.5, tint(color, -0.3));
}

function apron(ctx: Ctx, d: PawnDir, color: string): void {
  if (d === 'N') {
    line(ctx, -7.4, 7, 7.4, 7, 1, color);
    dot(ctx, -1, 7, 0.9, color, 0.4);
    dot(ctx, 1, 7, 0.9, color, 0.4);
    return;
  }
  ctx.beginPath();
  if (d === 'E') roundRect(ctx, 2, 6.6, 5.4, 7.6, 1);
  else roundRect(ctx, -4.8, 6.6, 9.6, 7.8, 1.2);
  fillStroke(ctx, color, SW);
  // Штопка поперёк.
  ctx.setLineDash([0.6, 0.6]);
  line(ctx, d === 'E' ? 3 : -3.4, 11, d === 'E' ? 6.4 : 0.6, 11.6, 0.5, tint(color, -0.4));
  ctx.setLineDash([]);
  line(ctx, -7.6, 6.8, 7.6, 6.8, 0.9, color);
}

/** Длинный подол ниже туловища (пальто, плащ): разрез спереди или сзади, рваный — зубцами. */
function longHem(ctx: Ctx, d: PawnDir, color: string, frayed: boolean, belted: boolean): void {
  const side = d === 'E';
  const [l, r, lb, rb] = side ? [-5.6, 6.6, -6.4, 7.4] : [-7.6, 7.6, -8.6, 8.6];
  const yTop = belted ? 8 : 7.4;
  const yb = 14.8;
  const bottom: Pt[] = [];
  const steps = 10;
  for (let k = 0; k <= steps; k++) {
    const x = rb + ((lb - rb) * k) / steps;
    bottom.push([x, yb + (frayed ? (k % 2 ? -1.2 : 0.3) : -Math.sin((k / steps) * Math.PI) * -0.4)]);
  }
  ctx.beginPath();
  ctx.moveTo(l, yTop);
  ctx.lineTo(r, yTop);
  ctx.lineTo(rb, yb);
  for (const [x, y] of bottom) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(side ? -1 : 2.5, 0, 20, 20);
  if (frayed) {
    ctx.fillStyle = tint(color, -0.2);
    ctx.fillRect(-14, yb - 2.4, 28, 0.6);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(l, yTop);
  ctx.lineTo(lb, yb);
  for (let k = bottom.length - 1; k >= 0; k--) ctx.lineTo(bottom[k][0], bottom[k][1]);
  ctx.lineTo(r, yTop);
  stroke(ctx, OW);
  // Разрез: спереди — полы, сзади — шлица, в профиле — кромка полы.
  if (d === 'S') line(ctx, 0, yTop, 0, yb, SW);
  else if (d === 'N') line(ctx, 0, 10, 0, yb, SW);
  else line(ctx, 5.8, yTop, 6.6, yb, SW);
}

/** Шуба: пушистая фигура поверх туловища до щиколоток, мех пучками, пушистый воротник. */
function furCoat(ctx: Ctx, d: PawnDir, color: string): void {
  const side = d === 'E';
  const half: Pt[] = side
    ? [[-4.6, TOP - 0.4], [-5.8, TOP + 2], [-6.8, 5], [-7.4, 10], [-7.4, 14.8], [-2, 15.2], [3, 15.2], [8, 14.8], [7.8, 9], [7.2, 4], [6.2, TOP + 1.2], [3, TOP - 0.6]]
    : [[-6.6, TOP - 0.2], [-8, TOP + 2.4], [-8.8, 6], [-9.4, 10.6], [-9.8, 14.8], [-4, 15.3], [0, 15.1], [4, 15.3], [9.8, 14.8], [9.4, 10.6], [8.8, 6], [8, TOP + 2.4], [6.6, TOP - 0.2], [2.4, TOP - 0.8], [-2.4, TOP - 0.8]];
  fluffy(ctx, half, 0.9);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(side ? -1 : 2.5, -20, 20, 40);
  tufts(ctx, side
    ? [[-3.4, 0], [0.8, 2.4], [4.4, 0.6], [-4.4, 6], [-0.4, 8], [3.6, 6.4], [-3, 11.6], [1.4, 12.8], [5, 11]]
    : [[-6, 0], [-2.4, 2], [2.6, 1], [6, 2.4], [-7, 6.6], [-3.6, 8.2], [3.8, 7.4], [7, 9], [-6.4, 12], [-2.6, 12.8], [3, 12.4], [6.4, 13]]);
  if (d === 'S') {
    ctx.beginPath();
    ctx.moveTo(0, TOP + 3);
    for (let y = TOP + 3; y < 15; y += 1.6) ctx.quadraticCurveTo(y % 3.2 < 1.6 ? 0.8 : -0.8, y + 0.8, 0, y + 1.6);
    stroke(ctx, 0.7, tint(color, -0.4));
  } else if (side) line(ctx, 5.6, TOP + 3, 6.6, 15, 0.7, tint(color, -0.4));
  ctx.restore();
  fluffy(ctx, half, 0.9);
  stroke(ctx, OW);
  if (d !== 'N') furCollar(ctx, d, tint(color, 0.12));
}

/** Пушистый воротник (шуба, пальто с мехом): S — два лепестка, E — один. */
function furCollar(ctx: Ctx, d: PawnDir, color: string): void {
  const lobe: Pt[] = d === 'E'
    ? [[0.4, TOP - 0.8], [6.6, TOP - 0.2], [6.2, TOP + 3.6], [3.4, TOP + 5]]
    : [[-1.6, TOP - 1], [-7.2, TOP + 0.4], [-6.6, TOP + 4.2], [-3, TOP + 5.6], [0, TOP + 3.6]];
  for (const p of d === 'E' ? [lobe] : [lobe, mirror(lobe)]) {
    fluffy(ctx, p, 0.7, 1.8);
    fillStroke(ctx, color, OW * 0.9);
    tufts(ctx, [[(p[1][0] + p[2][0]) / 2, TOP + 1], [(p[0][0] + p[3][0]) / 2, TOP + 2.4]]);
  }
}

/** Только шея (шарф, галстук…) — поверх формы, когда низа и верха из ателье нет (комплект `bare`). */
export function clothesNeck(ctx: Ctx, d: PawnDir, C: ClothesLook): void {
  if (d !== 'N') neckwear(ctx, d, C);
  else neckBack(ctx, C);
}

/** Шарф, галстук, бабочка, жемчуг, шаль — спереди и в профиле (до головы). */
function neckwear(ctx: Ctx, d: PawnDir, C: ClothesLook): void {
  const col = C.neckColor ?? '#7a4a3a';
  const side = d === 'E';
  switch (C.neck) {
    case 'scarf':
      ctx.beginPath();
      if (side) roundRect(ctx, -1.6, TOP - 1.4, 7.4, 3.6, 1.6);
      else roundRect(ctx, -5, TOP - 1.4, 10, 3.6, 1.6);
      fillStroke(ctx, col, SW);
      ctx.beginPath();
      if (side) roundRect(ctx, 4, TOP + 1, 2.4, 6.6, 0.6);
      else roundRect(ctx, -4.2, TOP + 1, 2.8, 7.6, 0.6);
      fillStroke(ctx, tint(col, -0.08), SW);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const x = (side ? 4.4 : -3.8) + k * 0.8;
        const y = TOP + (side ? 7.6 : 8.6);
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 1.2);
      }
      stroke(ctx, 0.5, col);
      // Полоски шарфа.
      line(ctx, side ? 4 : -4.2, TOP + 4.4, side ? 6.4 : -1.4, TOP + 4.4, 0.6, tint(col, 0.3));
      break;
    case 'tie':
      if (side) {
        line(ctx, 5.6, TOP + 1.2, 6.2, TOP + 6.4, 1.1, col);
        break;
      }
      ctx.beginPath();
      ctx.moveTo(-0.9, TOP + 2.4);
      ctx.lineTo(0.9, TOP + 2.4);
      ctx.lineTo(1.2, TOP + 8);
      ctx.lineTo(0, TOP + 9.2);
      ctx.lineTo(-1.2, TOP + 8);
      ctx.closePath();
      fillStroke(ctx, col);
      break;
    case 'bow':
      if (side) {
        dot(ctx, 5.6, TOP + 1.6, 0.9, col, 0.4);
        break;
      }
      poly(ctx, [[0, TOP + 2.2], [-2.6, TOP + 1], [-2.6, TOP + 3.6]]);
      fillStroke(ctx, col, 0.5);
      poly(ctx, [[0, TOP + 2.2], [2.6, TOP + 1], [2.6, TOP + 3.6]]);
      fillStroke(ctx, col, 0.5);
      dot(ctx, 0, TOP + 2.2, 0.7, col, 0.4);
      break;
    case 'pearls': {
      const pts: Pt[] = side
        ? [[2.4, TOP + 0.6], [3.4, TOP + 1.8], [4.4, TOP + 2.8], [5.4, TOP + 3.4]]
        : Array.from({ length: 9 }, (_, i) => {
          const t = (i / 8) * Math.PI;
          return [-Math.cos(t) * 3.6, TOP + 0.8 + Math.sin(t) * 3.2] as Pt;
        });
      for (const [x, y] of pts) dot(ctx, x, y, 0.55, D.pearl, 0.3);
      break;
    }
    case 'shawl': {
      // Шаль на плечах: углом вниз на грудь, бахрома.
      const pts: Pt[] = side
        ? [[-5.2, TOP - 0.4], [6.4, TOP + 0.4], [5.6, TOP + 6.4], [-5.6, TOP + 5.4]]
        : [[-7.8, TOP + 0.4], [-3.4, TOP - 1], [3.4, TOP - 1], [7.8, TOP + 0.4], [7.6, TOP + 5.4], [0, TOP + 9.4], [-7.6, TOP + 5.4]];
      poly(ctx, pts);
      fillStroke(ctx, col, SW);
      ctx.beginPath();
      for (let i = 1; i < 6; i++) {
        const x = -6.8 + i * 1.3;
        ctx.moveTo(x, TOP + 5.6 + i * 0.7);
        ctx.lineTo(x, TOP + 7 + i * 0.7);
      }
      stroke(ctx, 0.4, tint(col, -0.3));
      ctx.beginPath();
      ctx.moveTo(-3.6, TOP + 1);
      ctx.quadraticCurveTo(0, TOP + 5.4, 3.6, TOP + 1);
      stroke(ctx, 0.5, tint(col, -0.2));
      break;
    }
  }
}

/** Сзади — до головы: голова закрывает середину, видны края воротника, меха и шарфа у плеч. */
function neckBack(ctx: Ctx, C: ClothesLook): void {
  const fur = C.outer === 'fur' ? tint(C.outerColor ?? '#7a5a3e', 0.12) : C.outer === 'camel' ? C.trim ?? '#5a4434' : null;
  if (fur) {
    fluffy(ctx, [[-7.4, TOP - 1.2], [7.4, TOP - 1.2], [7.8, TOP + 3], [-7.8, TOP + 3]], 0.7, 1.8);
    fillStroke(ctx, fur, OW * 0.9);
  } else if (C.neck === 'scarf') {
    ctx.beginPath();
    roundRect(ctx, -5.4, TOP - 0.8, 10.8, 3.6, 1.6);
    fillStroke(ctx, C.neckColor ?? '#7a4a3a', SW);
  } else if (C.neck === 'shawl') {
    poly(ctx, [[-7.8, TOP], [7.8, TOP], [0, TOP + 11]]);
    fillStroke(ctx, C.neckColor ?? '#e8e2d4', SW);
  }
}

// ——————————————————————————— Поношенность ———————————————————————————

const PATCHES: Record<PawnDir, readonly (readonly [number, number, number, number])[]> = {
  S: [[-6.4, 0.2, 4.2, 3.8], [2.6, 8.2, 4, 3.4]],
  N: [[-2.6, 2, 4.6, 4], [2.6, 8.6, 4, 3.2]],
  E: [[-0.6, 2, 4.2, 3.8], [-4, 8.6, 3.6, 3.2]],
  W: [],
};
const HOLES: Record<PawnDir, readonly Pt[]> = {
  S: [[4.6, 3.4], [-3.8, 10.6], [1.6, 12.4]],
  N: [[-4.2, 6.2], [3.8, 11.2], [0.4, 1]],
  E: [[2.6, 6], [-2.2, 11.6], [4, 1.2]],
  W: [],
};
const STAINS: Record<PawnDir, readonly Pt[]> = {
  S: [[2.8, 5.6], [-5.2, 8.4]],
  N: [[1.6, 4.4], [-4.6, 10.4]],
  E: [[1.2, 7.4], [-2.8, 3.2]],
  W: [],
};

/** Заплаты со стежками, дыры с бахромой, пятна (внутри контура). */
function wear(ctx: Ctx, d: PawnDir, C: ClothesLook): void {
  (C.patches ?? []).forEach((color, i) => {
    const p = PATCHES[d][i];
    if (!p) return;
    const [x, y, w, h] = p;
    // Кусок ткани чуть набекрень, пришит грубыми стежками через край.
    poly(ctx, [[x, y + 0.4], [x + w, y], [x + w + 0.3, y + h - 0.2], [x + 0.2, y + h + 0.2]]);
    fillStroke(ctx, color, 0.45);
    ctx.beginPath();
    for (let k = 0.6; k < w; k += 1.1) {
      ctx.moveTo(x + k, y + 0.4 - (k / w) * 0.4 - 0.5);
      ctx.lineTo(x + k + 0.2, y + 0.4 - (k / w) * 0.4 + 0.5);
      ctx.moveTo(x + k + 0.2, y + h - 0.3 + (k / w) * 0.4);
      ctx.lineTo(x + k + 0.4, y + h + 0.7 + (k / w) * 0.4);
    }
    stroke(ctx, 0.3, D.thread);
  });
  for (let i = 0; i < (C.holes ?? 0); i++) {
    const h = HOLES[d][i];
    if (!h) continue;
    const [x, y] = h;
    poly(ctx, [[x - 1, y - 0.4], [x - 0.2, y - 1], [x + 0.9, y - 0.6], [x + 1.1, y + 0.5], [x + 0.2, y + 1], [x - 0.8, y + 0.7]]);
    ctx.fillStyle = D.hole;
    ctx.fill();
    stroke(ctx, 0.5, D.holeRim);
  }
  ctx.fillStyle = D.stain;
  for (let i = 0; i < (C.stains ?? 0); i++) {
    const s = STAINS[d][i];
    if (!s) continue;
    ctx.beginPath();
    ctx.ellipse(s[0], s[1], 1.8, 1.2, 0.4, 0, Math.PI * 2);
    ctx.ellipse(s[0] + 1.2, s[1] + 0.8, 0.8, 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ——————————————————————————— Голова ———————————————————————————

/** После головы: головной убор и очки. */
export function clothesHead(ctx: Ctx, d: PawnDir, C: ClothesLook, hx: number, hat = true): void {
  const col = C.hatColor ?? '#4a4440';
  switch (hat ? C.hat : undefined) {
    case 'ushanka': ushanka(ctx, d, col, C.hatTrim ?? tint(col, 0.2), hx); break;
    case 'beanie': beanie(ctx, d, col, C.hatTrim, hx, (C.holes ?? 0) > 0); break;
    case 'kerchief': kerchief(ctx, d, col, C.hatTrim, hx); break;
    case 'flatcap': flatcap(ctx, d, col, hx); break;
    case 'beret': beret(ctx, d, col, hx); break;
    case 'fedora': brimmed(ctx, d, col, C.hatTrim ?? tint(col, -0.4), hx, 'fedora'); break;
    case 'bowler': brimmed(ctx, d, col, C.hatTrim ?? tint(col, 0.2), hx, 'bowler'); break;
    case 'tophat': brimmed(ctx, d, col, C.hatTrim ?? tint(col, 0.2), hx, 'tophat'); break;
    case 'pillbox': pillbox(ctx, d, col, C.hatTrim ?? '#e8e2d4', hx); break;
    case 'hood': hood(ctx, d, col, hx); break;
  }
  // Платок, натянутый на лицо (слот шеи), — поверх лица и под очками.
  if (C.neck === 'mask' && d !== 'N') faceMask(ctx, d, C.neckColor ?? '#1d1d1f', hx);
  if (C.glasses && d !== 'N') glasses(ctx, d, hx);
}

/** Головной убор целиком скрывает причёску (платок, капюшон). */
export function hidesHair(C: ClothesLook): boolean {
  return C.hat === 'kerchief' || C.hat === 'hood';
}

/** Платок на нижней половине лица (бандит; вещь «платок на лицо»). */
export function faceMask(ctx: Ctx, d: PawnDir, color: string, hx: number): void {
  const H = PAWN.head;
  const cy = H.y;
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(hx - 2, cy + 0.6);
    ctx.lineTo(hx + H.r + 1.2, cy + 0.6);
    ctx.lineTo(hx + H.r - 0.6, cy + 5.6);
    ctx.lineTo(hx - 1, cy + H.r);
  } else {
    ctx.moveTo(-H.r + 0.4, cy + 0.4);
    ctx.lineTo(H.r - 0.4, cy + 0.4);
    ctx.lineTo(H.r * 0.5, cy + H.r + 0.4);
    ctx.lineTo(0, cy + H.r + 2.2);
    ctx.lineTo(-H.r * 0.5, cy + H.r + 0.4);
  }
  ctx.closePath();
  fillStroke(ctx, color, PAWN.outlineWidth * 0.8);
}

/** Капюшон (вор, спецагент; вещь «капюшон»): накрывает голову и плечи, лицо в тени. */
export function hood(ctx: Ctx, d: PawnDir, color: string, hx: number): void {
  const H = PAWN.head;
  const cy = H.y;
  const r = H.r + 1.6;
  ctx.save();
  ctx.beginPath();
  if (d === 'N') {
    ctx.arc(0, cy, r, 0, Math.PI * 2);
  } else if (d === 'E') {
    ctx.moveTo(hx + r - 3, cy - r + 1);
    ctx.bezierCurveTo(hx + 1, cy - r - 2.2, hx - r - 1.5, cy - r, hx - r - 1, cy + 3);
    ctx.lineTo(hx - r + 1, cy + r + 0.5);
    ctx.lineTo(hx + 1, cy + r - 1);
    ctx.bezierCurveTo(hx - 2, cy + 2, hx + 0.5, cy - 4, hx + r - 3, cy - r + 1);
  } else {
    // Спереди: край капюшона обрамляет лицо.
    ctx.moveTo(-r, cy + r - 1);
    ctx.bezierCurveTo(-r - 0.6, cy - r - 2.4, r + 0.6, cy - r - 2.4, r, cy + r - 1);
    ctx.lineTo(r - 2.6, cy + r - 2);
    ctx.bezierCurveTo(r - 2.2, cy - 3, -r + 2.2, cy - 3, -r + 2.6, cy + r - 2);
  }
  ctx.closePath();
  fillStroke(ctx, color, PAWN.outlineWidth);
  if (d === 'S') {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(-r + 2.6, cy - 3.6, (r - 2.6) * 2, 2.6);
  }
  ctx.restore();
}


function ushanka(ctx: Ctx, d: PawnDir, col: string, front: string, hx: number): void {
  const cy = H.y;
  const r = H.r;
  // Уши-клапаны.
  const flaps: Pt[] = d === 'E' ? [[hx - 2.4, cy - 2]] : d === 'S' ? [[-r - 0.4, cy - 2], [r + 0.4, cy - 2]] : [];
  for (const [x, y] of flaps) {
    ctx.beginPath();
    roundRect(ctx, x - 2, y, 4, 7.4, 1.8);
    fillStroke(ctx, col, OW * 0.9);
    tufts(ctx, [[x - 0.8, y + 2], [x + 0.6, y + 4.4]]);
  }
  if (d === 'N') {
    ctx.beginPath();
    roundRect(ctx, -r - 1.2, cy - 3, 2 * r + 2.4, 7.6, 2.4);
    fillStroke(ctx, col, OW * 0.9);
  }
  // Купол.
  const w = r + 1.4;
  const x0 = d === 'E' ? hx : 0;
  ctx.beginPath();
  ctx.moveTo(x0 - w, cy - 1.4);
  ctx.bezierCurveTo(x0 - w, cy - r - 4.2, x0 + w, cy - r - 4.2, x0 + w, cy - 1.4);
  ctx.closePath();
  fillStroke(ctx, col, OW);
  tufts(ctx, [[x0 - 3.6, cy - r - 0.4], [x0 + 0.4, cy - r - 1.4], [x0 + 3.4, cy - r - 0.2]]);
  // Отогнутый передний клапан — мех светлее.
  if (d !== 'N') {
    ctx.beginPath();
    if (d === 'E') roundRect(ctx, hx - 1, cy - 5.6, r + 2.2, 3.6, 1.6);
    else roundRect(ctx, -w + 0.4, cy - 5.4, 2 * w - 0.8, 3.6, 1.6);
    fillStroke(ctx, front, OW * 0.9);
    tufts(ctx, d === 'E' ? [[hx + 1.4, cy - 5], [hx + 4.6, cy - 4.8]] : [[-4.4, cy - 4.8], [-0.6, cy - 5], [3.6, cy - 4.8]]);
  }
}

function beanie(ctx: Ctx, d: PawnDir, col: string, pom: string | undefined, hx: number, holed: boolean): void {
  const cy = H.y;
  const r = H.r;
  const x0 = d === 'E' ? hx : 0;
  const w = r + 0.9;
  ctx.beginPath();
  ctx.moveTo(x0 - w, cy - 1.6);
  ctx.bezierCurveTo(x0 - w, cy - r - 3.2, x0 + w, cy - r - 3.2, x0 + w, cy - 1.6);
  ctx.closePath();
  fillStroke(ctx, col, OW);
  ctx.beginPath();
  for (let x = -w + 2; x < w - 1; x += 1.6) {
    ctx.moveTo(x0 + x, cy - r + 0.4);
    ctx.lineTo(x0 + x * 1.05, cy - 4);
  }
  stroke(ctx, 0.4, tint(col, -0.3));
  // Отворот.
  ctx.beginPath();
  roundRect(ctx, x0 - w, cy - 4.4, 2 * w, 2.9, 1);
  fillStroke(ctx, tint(col, -0.06), OW * 0.9);
  ctx.beginPath();
  for (let x = -w + 1; x < w; x += 1) {
    ctx.moveTo(x0 + x, cy - 4);
    ctx.lineTo(x0 + x, cy - 1.9);
  }
  stroke(ctx, 0.35, tint(col, -0.3));
  if (holed) {
    poly(ctx, [[x0 + 2, cy - r + 0.8], [x0 + 3, cy - r + 0.2], [x0 + 3.8, cy - r + 1.2], [x0 + 2.8, cy - r + 2]]);
    ctx.fillStyle = D.hole;
    ctx.fill();
  }
  if (pom) {
    ctx.beginPath();
    ctx.arc(x0 - (d === 'E' ? 1 : 0), cy - r - 2.6, 2.2, 0, Math.PI * 2);
    fillStroke(ctx, pom, OW * 0.9);
    tufts(ctx, [[x0 - 1, cy - r - 3.6]]);
  }
}

function kerchief(ctx: Ctx, d: PawnDir, col: string, dots: string | undefined, hx: number): void {
  const cy = H.y;
  const r = H.r;
  ctx.beginPath();
  if (d === 'S') {
    ctx.moveTo(-r - 0.9, cy + 4.6);
    ctx.bezierCurveTo(-r - 1.6, cy - r - 2.6, r + 1.6, cy - r - 2.6, r + 0.9, cy + 4.6);
    ctx.lineTo(r - 1.8, cy + 4.6);
    ctx.lineTo(r - 1.4, cy - 1.6);
    ctx.quadraticCurveTo(0, cy - 5.2, -r + 1.4, cy - 1.6);
    ctx.lineTo(-r + 1.8, cy + 4.6);
  } else if (d === 'N') {
    ctx.moveTo(-r - 0.9, cy + 3);
    ctx.bezierCurveTo(-r - 1.6, cy - r - 2.6, r + 1.6, cy - r - 2.6, r + 0.9, cy + 3);
    ctx.lineTo(0, cy + r + 6);
  } else {
    ctx.moveTo(hx + r - 1.4, cy - 4);
    ctx.bezierCurveTo(hx + r, cy - r - 2.6, hx - r - 2, cy - r - 2, hx - r - 1.2, cy + 2);
    ctx.lineTo(hx - r - 2.6, cy + 8.6);
    ctx.lineTo(hx - r + 2, cy + 4.6);
    ctx.lineTo(hx + 1, cy + 4.8);
    ctx.quadraticCurveTo(hx - 1.4, cy - 0.4, hx + r - 1.4, cy - 4);
  }
  ctx.closePath();
  fillStroke(ctx, col, OW);
  if (dots) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = dots;
    for (let y = cy - r - 2; y < cy + r + 6; y += 2.4) {
      for (let x = -r - 3; x < r + 3; x += 2.4) {
        ctx.beginPath();
        ctx.arc(x + (d === 'E' ? hx : 0) + ((y - cy) % 4.8 === 0 ? 0 : 1.2), y, 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  if (d === 'S') {
    // Узел под подбородком.
    ctx.beginPath();
    ctx.moveTo(-r + 1.8, cy + 4.4);
    ctx.quadraticCurveTo(-1, cy + r + 1, 0.6, cy + r + 1.8);
    ctx.moveTo(r - 1.8, cy + 4.4);
    ctx.quadraticCurveTo(1.6, cy + r + 1, 0.6, cy + r + 1.8);
    stroke(ctx, 1.1, col);
    dot(ctx, 0.6, cy + r + 1.8, 0.9, col, 0.5);
  }
}

function flatcap(ctx: Ctx, d: PawnDir, col: string, hx: number): void {
  const cy = H.y;
  const r = H.r;
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(hx - r - 0.8, cy - 2.6);
    ctx.bezierCurveTo(hx - r - 1, cy - r - 2, hx + r, cy - r - 1.6, hx + r + 2.6, cy - 4);
    ctx.lineTo(hx + r + 3.8, cy - 2.8);
    ctx.lineTo(hx + r - 0.4, cy - 2.2);
  } else {
    ctx.moveTo(-r - 1.2, cy - 2.4);
    ctx.bezierCurveTo(-r - 1.6, cy - r - 2.2, r + 1.6, cy - r - 2.2, r + 1.2, cy - 2.4);
  }
  ctx.closePath();
  fillStroke(ctx, col, OW);
  // Клинья и пуговка.
  ctx.beginPath();
  const x0 = d === 'E' ? hx : 0;
  ctx.moveTo(x0 - 3.6, cy - 3);
  ctx.lineTo(x0, cy - r - 0.8);
  ctx.lineTo(x0 + 3.6, cy - 3);
  stroke(ctx, 0.4, tint(col, -0.3));
  dot(ctx, x0, cy - r - 0.8, 0.6, tint(col, -0.15), 0.4);
  if (d === 'S') {
    ctx.beginPath();
    ctx.ellipse(0, cy - 2.4, r - 0.6, 1.4, 0, 0, Math.PI);
    fillStroke(ctx, tint(col, -0.22), OW * 0.8);
  }
}

function beret(ctx: Ctx, d: PawnDir, col: string, hx: number): void {
  const cy = H.y;
  const r = H.r;
  const x0 = d === 'E' ? hx - 0.6 : 0.8;
  ctx.save();
  ctx.translate(x0, cy - r + 1);
  ctx.rotate(d === 'E' ? 0.12 : -0.12);
  ctx.beginPath();
  ctx.ellipse(0, 0, r + 1.6, 3.4, 0, 0, Math.PI * 2);
  fillStroke(ctx, col, OW);
  ctx.beginPath();
  ctx.ellipse(0, -0.8, r - 1.4, 1.6, 0, Math.PI * 1.1, Math.PI * 1.9);
  stroke(ctx, 0.6, tint(col, 0.25));
  line(ctx, 0, -3.4, 0.4, -4.6, 1, PAWN.outline);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo((d === 'E' ? hx : 0) - r + 0.6, cy - 3.4);
  ctx.quadraticCurveTo(d === 'E' ? hx : 0, cy - 5, (d === 'E' ? hx : 0) + r - 0.6, cy - 3.4);
  stroke(ctx, 1, tint(col, -0.3));
}

/** Шляпы с полями: федора (залом), котелок (купол), цилиндр (высокая тулья). */
function brimmed(ctx: Ctx, d: PawnDir, col: string, band: string, hx: number, kind: 'fedora' | 'bowler' | 'tophat'): void {
  const cy = H.y;
  const r = H.r;
  const x0 = d === 'E' ? hx + 0.4 : 0;
  const by = cy - 3.4;
  const brim = kind === 'fedora' ? r + 3.8 : kind === 'bowler' ? r + 1.8 : r + 2.6;
  ctx.beginPath();
  ctx.ellipse(x0, by, brim, d === 'E' ? 1.4 : 2, 0, 0, Math.PI * 2);
  fillStroke(ctx, tint(col, -0.08), OW);
  if (kind === 'bowler') {
    ctx.beginPath();
    ctx.ellipse(x0, by + 0.2, brim, 1.6, 0, 0, Math.PI);
    stroke(ctx, 0.7, tint(col, 0.25));
  }
  const w = r - 1.2;
  ctx.beginPath();
  if (kind === 'fedora') {
    ctx.moveTo(x0 - w, by);
    ctx.lineTo(x0 - w + 0.6, cy - r - 2.6);
    ctx.quadraticCurveTo(x0, cy - r - 1.2, x0 + w - 0.6, cy - r - 2.6);
    ctx.lineTo(x0 + w, by);
  } else if (kind === 'bowler') {
    ctx.moveTo(x0 - w, by);
    ctx.bezierCurveTo(x0 - w, cy - r - 4.4, x0 + w, cy - r - 4.4, x0 + w, by);
  } else {
    ctx.moveTo(x0 - w + 0.4, by);
    ctx.lineTo(x0 - w - 0.4, cy - r - 7.4);
    ctx.quadraticCurveTo(x0, cy - r - 8.2, x0 + w + 0.4, cy - r - 7.4);
    ctx.lineTo(x0 + w - 0.4, by);
  }
  ctx.closePath();
  fillStroke(ctx, col, OW);
  // Лента над полями и блик.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = band;
  ctx.fillRect(x0 - w - 2, by - 2.2, 2 * w + 4, 1.9);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x0 - w + 1, cy - r - 9, 1.2, 12);
  ctx.restore();
  if (kind === 'fedora' && d !== 'N') line(ctx, x0 - 0.4, cy - r - 1.6, x0 + 0.4, cy - r - 0.4, 0.6, tint(col, -0.35));
}

function pillbox(ctx: Ctx, d: PawnDir, col: string, feather: string, hx: number): void {
  const cy = H.y;
  const r = H.r;
  const x0 = (d === 'E' ? hx : 0) + 2;
  const y0 = cy - r - 0.4;
  // Перо.
  ctx.beginPath();
  ctx.moveTo(x0 + 2.6, y0);
  ctx.quadraticCurveTo(x0 + 7.4, y0 - 5.6, x0 + 4.2, y0 - 9);
  ctx.quadraticCurveTo(x0 + 4.6, y0 - 4.4, x0 + 1.6, y0 - 0.6);
  ctx.closePath();
  fillStroke(ctx, feather, OW * 0.8);
  line(ctx, x0 + 2.2, y0 - 0.4, x0 + 4.4, y0 - 8, 0.4, tint(feather, -0.3));
  // Тулья-таблетка.
  ctx.beginPath();
  ctx.moveTo(x0 - 3.6, y0 + 1.4);
  ctx.lineTo(x0 - 3.4, y0 - 1.6);
  ctx.ellipse(x0, y0 - 1.6, 3.4, 1.2, 0, Math.PI, 0);
  ctx.lineTo(x0 + 3.6, y0 + 1.4);
  ctx.ellipse(x0, y0 + 1.4, 3.6, 1.2, 0, 0, Math.PI);
  fillStroke(ctx, col, OW);
  ctx.beginPath();
  ctx.ellipse(x0, y0 - 1.6, 3.4, 1.2, 0, 0, Math.PI * 2);
  fillStroke(ctx, tint(col, 0.15), OW * 0.7);
  // Вуаль на глаза.
  if (d === 'S') {
    ctx.beginPath();
    for (let x = -4.4; x <= 5; x += 1.1) {
      ctx.moveTo(x, cy - 4.6);
      ctx.lineTo(x - 0.6, cy - 0.8);
    }
    for (let y = cy - 4.2; y < cy - 0.6; y += 1.1) {
      ctx.moveTo(-4.8, y);
      ctx.lineTo(5, y);
    }
    stroke(ctx, 0.25, D.veil);
  }
}

function glasses(ctx: Ctx, d: PawnDir, hx: number): void {
  const E = PAWN.eye;
  ctx.fillStyle = D.lens;
  if (d === 'E') {
    const ex = hx + H.r - 2.4;
    ctx.beginPath();
    ctx.arc(ex, E.y, 1.7, 0, Math.PI * 2);
    ctx.fill();
    stroke(ctx, 0.6, D.frame);
    line(ctx, ex - 1.7, E.y, hx - 2.4, E.y - 0.6, 0.6, D.frame);
    return;
  }
  for (const x of [-E.dx, E.dx]) {
    ctx.beginPath();
    ctx.arc(x, E.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    stroke(ctx, 0.6, D.frame);
  }
  ctx.beginPath();
  ctx.moveTo(-E.dx + 1.8, E.y - 0.3);
  ctx.quadraticCurveTo(0, E.y - 1.1, E.dx - 1.8, E.y - 0.3);
  stroke(ctx, 0.5, D.frame);
}
