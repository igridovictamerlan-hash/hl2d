import type { FactionId } from '../config/factions';
import { PAWN } from '../config/pawns';

export type PawnDir = 'S' | 'N' | 'E' | 'W';

/** Внешность пешки: фракция и ранг (цвет формы/брони), зерно (кожа, волосы, причёска). */
export interface PawnLook {
  faction: FactionId;
  rank: number;
  color: string;
  seed: number;
}

type HairStyle = keyof typeof PAWN.hairStyles;
type Ctx = CanvasRenderingContext2D;

/** Сторона взгляда по углу (как в RimWorld: четыре стороны). */
export function pawnDir(facing: number): PawnDir {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  if (Math.abs(c) >= Math.abs(s)) return c >= 0 ? 'E' : 'W';
  return s >= 0 ? 'S' : 'N';
}

/** Зерно внешности из строки (имя тела) или числа (id персонажа). */
export function lookSeed(v: string | number): number {
  if (typeof v === 'number') return Math.imul(v ^ 0x9e3779b9, 2654435761) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[(((seed >>> salt) ^ Math.imul(seed, salt + 7)) >>> 0) % list.length];
}

function hairStyleOf(seed: number): HairStyle {
  let roll = ((seed >>> 13) % 1000) / 1000;
  for (const [k, p] of Object.entries(PAWN.hairStyles) as [HairStyle, number][]) {
    if ((roll -= p) < 0) return k;
  }
  return 'short';
}

/** Светлее (k > 0) или темнее (k < 0) цвета #rrggbb. */
export function tint(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/**
 * Пешка в стиле RimWorld. x, y — экран (центр персонажа), s — пикселей экрана на px мира.
 * Запад — отражение востока. Тень — отдельно (drawPawnShadow).
 */
export function drawPawn(ctx: Ctx, look: PawnLook, x: number, y: number, s: number, dir: PawnDir): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir === 'W' ? -s : s, s);
  const d: PawnDir = dir === 'W' ? 'E' : dir;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const O = PAWN.outfits[look.faction] ?? PAWN.outfits.citizen;
  const base = O.base === 'rank' ? look.color : (O.base as string);
  const armor = O.armor === 'rank' ? look.color : (O.armor as string | undefined);
  const vest = !!armor && O.vest !== false && look.rank >= ((O.vestFromRank as number | undefined) ?? 99);
  let head = O.head as string;
  if (head === 'bandana' && !vest) head = 'hair';
  const hairy = head === 'hair' || head === 'bandana' || head === 'cap';
  const style: HairStyle = hairy ? hairStyleOf(look.seed) : 'bald';
  const skin = pick(PAWN.skins, look.seed, 3);
  const hair = pick(PAWN.hairs, look.seed, 11);
  const H = PAWN.head;
  const hx = d === 'E' ? H.sideShift : 0;

  // Сзади: длинные волосы и пучок.
  if (hairy && d !== 'N') backHair(ctx, d, style, hair, hx);
  if (hairy && style === 'bun') bun(ctx, hair, hx);

  // Туловище, одежда, броня.
  bodyPath(ctx, d);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(d === 'E' ? -1 : 2.5, -20, 20, 40);
  clothes(ctx, d, O, base, armor, vest);
  ctx.restore();
  bodyPath(ctx, d);
  stroke(ctx, PAWN.outlineWidth);
  if (vest && armor) shoulderPads(ctx, d, armor);

  // Голова.
  headPath(ctx, d, hx);
  ctx.fillStyle = head === 'ota' ? (O.helmet as string) : skin;
  ctx.fill();
  ctx.save();
  headPath(ctx, d, hx);
  ctx.clip();
  ctx.fillStyle = PAWN.shade;
  ctx.fillRect(d === 'E' ? hx - 20 - 2 : 3, -40, 20, 60);
  if (head === 'mask') maskInside(ctx, d, O, hx);
  if (head === 'ota') otaInside(ctx, d, hx);
  ctx.restore();
  headPath(ctx, d, hx);
  stroke(ctx, PAWN.outlineWidth);

  // Лицо, причёска, головной убор.
  if (head === 'mask') maskOver(ctx, d, O, hx);
  else if (head === 'ota') otaOver(ctx, d, O, hx);
  else {
    if (d !== 'N') face(ctx, d, hx);
    if (hairy) frontHair(ctx, d, style, hair, hx);
    if (head === 'bandana') bandana(ctx, d, O.cloth as string, hx);
    if (head === 'cap') cap(ctx, d, O.cap as string, hx);
  }
  ctx.restore();
}

function stroke(ctx: Ctx, w: number, color: string = PAWN.outline): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function fillStroke(ctx: Ctx, fill: string, w: number = PAWN.seamWidth): void {
  ctx.fillStyle = fill;
  ctx.fill();
  stroke(ctx, w);
}

/** Туловище: округлые плечи, расширение к поясу, круглый низ; в профиле — уже. */
function bodyPath(ctx: Ctx, d: PawnDir): void {
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

/** Одежда под бронёй и сама броня (внутри контура туловища — клип уже стоит). */
function clothes(ctx: Ctx, d: PawnDir, O: Record<string, unknown>, base: string, armor: string | undefined, vest: boolean): void {
  const top = PAWN.body.top;
  const side = d === 'E';
  if (!vest) {
    // Гражданская одежда: воротник, молния, карман; ГСР — повязка; администратор — костюм.
    if (d === 'S') {
      if (O.collar) {
        ctx.beginPath();
        ctx.moveTo(-3.6, top);
        ctx.lineTo(0, top + 3.6);
        ctx.lineTo(3.6, top);
        fillStroke(ctx, O.collar as string);
      }
      if (O.tie) {
        ctx.beginPath();
        ctx.moveTo(-0.9, top + 2.4);
        ctx.lineTo(0.9, top + 2.4);
        ctx.lineTo(1.2, top + 8);
        ctx.lineTo(0, top + 9.2);
        ctx.lineTo(-1.2, top + 8);
        ctx.closePath();
        fillStroke(ctx, O.tie as string);
        // Лацканы.
        ctx.beginPath();
        ctx.moveTo(-3.6, top);
        ctx.lineTo(-1.6, top + 8);
        ctx.moveTo(3.6, top);
        ctx.lineTo(1.6, top + 8);
        stroke(ctx, PAWN.seamWidth);
      }
      if (O.zip) {
        ctx.beginPath();
        ctx.moveTo(0, top + 3.6);
        ctx.lineTo(0, PAWN.body.bottom);
        stroke(ctx, 0.6, tint(base, -0.45));
        ctx.beginPath();
        ctx.rect(-5.4, top + 5.5, 3.2, 2.6);
        fillStroke(ctx, tint(base, -0.12), 0.6);
      }
    } else if (side) {
      ctx.beginPath();
      ctx.moveTo(-1, PAWN.body.top + 8);
      ctx.lineTo(6, PAWN.body.top + 8);
      stroke(ctx, 0.6, tint(base, -0.35));
    }
    // Пояс брюк.
    ctx.beginPath();
    ctx.rect(-12, 7.2, 24, 1.6);
    fillStroke(ctx, tint(base, -0.35), 0.6);
    if (O.armband && d !== 'N') {
      ctx.beginPath();
      ctx.rect(side ? -3 : 4.2, top + 3.2, side ? 5 : 4, 2);
      fillStroke(ctx, O.armband as string, 0.6);
    }
    return;
  }
  if (!armor) return;
  const belt = (O.belt as string) ?? '#2a2a2a';
  const hi = tint(armor, 0.28);
  // Нагрудная пластина с вырезом у горла (спереди), спинная (сзади), половина (в профиле).
  ctx.beginPath();
  if (d === 'S') {
    ctx.moveTo(-5.8, top + 2.6);
    ctx.lineTo(-2.2, top + 1.4);
    ctx.lineTo(0, top + 3.6);
    ctx.lineTo(2.2, top + 1.4);
    ctx.lineTo(5.8, top + 2.6);
    ctx.lineTo(6.2, 6.4);
    ctx.lineTo(-6.2, 6.4);
  } else if (d === 'N') {
    ctx.moveTo(-6, top + 1.6);
    ctx.lineTo(6, top + 1.6);
    ctx.lineTo(6.4, 6.4);
    ctx.lineTo(-6.4, 6.4);
  } else {
    ctx.moveTo(-1.5, top + 1.4);
    ctx.lineTo(6, top + 2.4);
    ctx.lineTo(7.2, 6.4);
    ctx.lineTo(-1.8, 6.4);
  }
  ctx.closePath();
  fillStroke(ctx, armor);
  // Блик по верхнему краю пластины.
  ctx.beginPath();
  if (d === 'S') {
    ctx.moveTo(-5, top + 3.4);
    ctx.lineTo(-2.2, top + 2.5);
    ctx.moveTo(2.2, top + 2.5);
    ctx.lineTo(5, top + 3.4);
  } else if (d === 'N') {
    ctx.moveTo(-5.2, top + 2.5);
    ctx.lineTo(5.2, top + 2.5);
  } else {
    ctx.moveTo(-0.8, top + 2.3);
    ctx.lineTo(5.4, top + 3.1);
  }
  stroke(ctx, 0.9, hi);
  // Центральный щиток (спереди) / ребро (сзади).
  if (d === 'S') {
    ctx.beginPath();
    ctx.rect(-2.3, top + 5.4, 4.6, 4.6);
    fillStroke(ctx, tint(armor, -0.22));
    ctx.beginPath();
    ctx.moveTo(-1.5, top + 6.3);
    ctx.lineTo(1.5, top + 6.3);
    stroke(ctx, 0.6, hi);
  } else if (d === 'N') {
    ctx.beginPath();
    ctx.moveTo(0, top + 2.4);
    ctx.lineTo(0, 6);
    stroke(ctx, PAWN.seamWidth);
  } else {
    ctx.beginPath();
    ctx.rect(2.5, top + 5.4, 3.6, 4.2);
    fillStroke(ctx, tint(armor, -0.22));
  }
  // Пояс с пряжкой.
  ctx.beginPath();
  ctx.rect(-12, 6.4, 24, 2.4);
  fillStroke(ctx, belt);
  if (d !== 'N') {
    ctx.beginPath();
    ctx.rect(side ? 4 : -1.3, 6.7, 2.6, 1.8);
    fillStroke(ctx, '#8d9299', 0.5);
  }
  // Набедренник/подсумки.
  ctx.beginPath();
  if (d === 'S') {
    ctx.moveTo(-4.8, 8.8);
    ctx.lineTo(4.8, 8.8);
    ctx.lineTo(4.2, 12.6);
    ctx.quadraticCurveTo(0, 14.4, -4.2, 12.6);
  } else if (d === 'N') {
    ctx.moveTo(-5.4, 8.8);
    ctx.lineTo(5.4, 8.8);
    ctx.lineTo(4.8, 11.2);
    ctx.lineTo(-4.8, 11.2);
  } else {
    ctx.moveTo(0.5, 8.8);
    ctx.lineTo(6.8, 8.8);
    ctx.lineTo(6, 12.8);
    ctx.lineTo(1, 12.8);
  }
  ctx.closePath();
  fillStroke(ctx, tint(armor, -0.12));
  ctx.beginPath();
  if (d === 'S') ctx.rect(-2.2, 9.6, 4.4, 2.6);
  else if (d === 'N') ctx.rect(-6.5, 8.9, 3, 2.4);
  else ctx.rect(2, 9.6, 3.4, 2.4);
  fillStroke(ctx, tint(armor, -0.3));
}

/** Наплечники поверх контура туловища (как у брони RimWorld). */
function shoulderPads(ctx: Ctx, d: PawnDir, armor: string): void {
  const top = PAWN.body.top;
  const pads = d === 'E' ? [0.6] : [-PAWN.body.shoulder + 0.4, PAWN.body.shoulder - 0.4];
  for (const px of pads) {
    ctx.beginPath();
    ctx.ellipse(px, top + 2.2, 3.3, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = armor;
    ctx.fill();
    stroke(ctx, PAWN.outlineWidth * 0.85);
    ctx.beginPath();
    ctx.arc(px, top + 2.2, 1.9, Math.PI * 1.1, Math.PI * 1.75);
    stroke(ctx, 0.8, tint(armor, 0.32));
  }
}

/** Голова: спереди/сзади — круг с заострённым подбородком, в профиле — с носом и подбородком. */
function headPath(ctx: Ctx, d: PawnDir, hx: number): void {
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

/** Глаза с тяжёлыми веками и рот (как у пешек RimWorld). */
function face(ctx: Ctx, d: PawnDir, hx: number): void {
  const E = PAWN.eye;
  const eyes = d === 'E' ? [hx + PAWN.head.r - 2.4] : [-E.dx, E.dx];
  for (const ex of eyes) {
    ctx.beginPath();
    ctx.ellipse(ex, E.y, E.rx, E.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = E.color;
    ctx.fill();
    // Веко — прикрывает верх глаза.
    ctx.beginPath();
    ctx.moveTo(ex - E.rx - 0.5, E.y - E.ry * E.lid);
    ctx.lineTo(ex + E.rx + 0.5, E.y - E.ry * E.lid);
    stroke(ctx, 0.8);
  }
  const M = PAWN.mouth;
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(hx + PAWN.head.r - 2.6, M.y);
    ctx.lineTo(hx + PAWN.head.r - 0.9, M.y - 0.2);
  } else {
    ctx.moveTo(-M.w / 2, M.y);
    ctx.quadraticCurveTo(0, M.y + 0.35, M.w / 2, M.y);
  }
  stroke(ctx, 0.7);
}

/** Длинные волосы за головой (на плечи). */
function backHair(ctx: Ctx, d: PawnDir, style: HairStyle, hair: string, hx: number): void {
  if (style !== 'long' && style !== 'messy') return;
  const H = PAWN.head;
  const long = style === 'long';
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(hx - 1, H.y - H.r);
    ctx.quadraticCurveTo(hx - H.r - 3, H.y - 2, hx - H.r - 1.5, H.y + (long ? 10 : 5));
    ctx.lineTo(hx - 2, H.y + (long ? 8 : 4));
  } else {
    const w = H.r + (long ? 2.4 : 1.6);
    ctx.moveTo(-w, H.y);
    ctx.lineTo(-w + 0.5, H.y + (long ? 10.5 : 6));
    ctx.lineTo(-w + 3, H.y + (long ? 9 : 5));
    ctx.lineTo(w - 3, H.y + (long ? 9 : 5));
    ctx.lineTo(w - 0.5, H.y + (long ? 10.5 : 6));
    ctx.lineTo(w, H.y);
  }
  ctx.closePath();
  ctx.fillStyle = tint(hairHex(hair), -0.15);
  ctx.fill();
  stroke(ctx, PAWN.outlineWidth);
}

function hairHex(c: string): string {
  return c.startsWith('#') ? c : '#555555';
}

function bun(ctx: Ctx, hair: string, hx: number): void {
  const H = PAWN.head;
  ctx.beginPath();
  ctx.arc(hx - 0.5, H.y - H.r - 1.6, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = hair;
  ctx.fill();
  stroke(ctx, PAWN.outlineWidth);
}

/**
 * Причёска спереди: объём шире головы, неровный край; лохматая — с прядями-чёлкой на лоб;
 * длинная — пряди по бокам лица. Сзади — затылок целиком, в профиле — верх и затылок.
 */
function frontHair(ctx: Ctx, d: PawnDir, style: HairStyle, hair: string, hx: number): void {
  if (style === 'bald') return;
  const H = PAWN.head;
  const r = H.r;
  const cy = H.y;
  const vol = style === 'messy' ? 1.8 : 0.9;
  ctx.beginPath();
  if (d === 'N') {
    const w = r + vol;
    const low = style === 'long' ? cy + r + 3 : cy + r * 0.55;
    ctx.moveTo(-w, cy + 1);
    ctx.bezierCurveTo(-w, cy - r - vol * 1.6, w, cy - r - vol * 1.6, w, cy + 1);
    ctx.lineTo(w - 0.8, low);
    ctx.lineTo(w * 0.35, low - 1.6);
    ctx.lineTo(0, low + 0.6);
    ctx.lineTo(-w * 0.35, low - 1.6);
    ctx.lineTo(-w + 0.8, low);
  } else if (d === 'E') {
    const back = style === 'long' ? cy + 8 : cy + 2.5;
    ctx.moveTo(hx + r - 1, cy - 3.6);
    ctx.bezierCurveTo(hx + r + 0.5, cy - r - vol * 1.2, hx - r - vol, cy - r - vol * 1.4, hx - r - vol, cy + 1);
    ctx.lineTo(hx - r - vol + 0.6, back);
    ctx.lineTo(hx - r + 3, back - 1.2);
    ctx.lineTo(hx - 1.5, cy - 1.8);
    ctx.lineTo(hx + 1.5, cy - 3.2);
    if (style === 'messy') {
      ctx.lineTo(hx + 3.5, cy - 1.2);
      ctx.lineTo(hx + 4.4, cy - 3.6);
      ctx.lineTo(hx + r - 0.2, cy - 1.8);
    }
  } else {
    const w = r + vol;
    const side = style === 'long' ? cy + 7.5 : style === 'messy' ? cy + 2.5 : cy - 0.5;
    ctx.moveTo(-w, side);
    ctx.bezierCurveTo(-w - 0.4, cy - r - vol * 1.8, w + 0.4, cy - r - vol * 1.8, w, side);
    if (style === 'messy') {
      // Чёлка прядями.
      ctx.lineTo(w - 1.8, cy - 1);
      ctx.lineTo(3.8, cy - 0.4);
      ctx.lineTo(2.8, cy - 3.4);
      ctx.lineTo(0.6, cy - 1.2);
      ctx.lineTo(-1, cy - 3.8);
      ctx.lineTo(-3.4, cy - 0.8);
      ctx.lineTo(-4.4, cy - 3.4);
      ctx.lineTo(-w + 1.8, cy - 1);
    } else if (style === 'long') {
      ctx.lineTo(w - 2, side - 0.5);
      ctx.lineTo(r - 2, cy - 3.2);
      ctx.lineTo(1.5, cy - 4.2);
      ctx.lineTo(-1.5, cy - 3.6);
      ctx.lineTo(-r + 2, cy - 3.2);
      ctx.lineTo(-w + 2, side - 0.5);
    } else {
      ctx.lineTo(r - 0.8, cy - 3.2);
      ctx.lineTo(2.4, cy - 4.4);
      ctx.lineTo(0.2, cy - 3.6);
      ctx.lineTo(-2.2, cy - 4.5);
      ctx.lineTo(-r + 0.8, cy - 3.2);
    }
  }
  ctx.closePath();
  ctx.fillStyle = hair;
  ctx.fill();
  stroke(ctx, PAWN.outlineWidth);
  // Пряди — тёмные штрихи.
  ctx.beginPath();
  if (d === 'N') {
    ctx.moveTo(-2, cy - r + 1);
    ctx.quadraticCurveTo(-3, cy, -2.2, cy + 3);
    ctx.moveTo(2.5, cy - r + 1.5);
    ctx.quadraticCurveTo(3.2, cy, 2.2, cy + 2.5);
  } else if (d === 'E') {
    ctx.moveTo(hx + 1, cy - r + 0.5);
    ctx.quadraticCurveTo(hx - 3, cy - 4, hx - r + 0.5, cy + 0.5);
  } else {
    ctx.moveTo(-1.5, cy - r);
    ctx.quadraticCurveTo(-3.5, cy - 5, -4.5, cy - 2.5);
    ctx.moveTo(2, cy - r + 0.3);
    ctx.quadraticCurveTo(3.4, cy - 5.5, 4.6, cy - 2.8);
  }
  stroke(ctx, 0.6, tint(hairHex(hair), -0.45));
}

function bandana(ctx: Ctx, d: PawnDir, cloth: string, hx: number): void {
  const H = PAWN.head;
  const cy = H.y;
  const r = H.r;
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(hx + r - 0.4, cy - 4.8);
    ctx.quadraticCurveTo(hx, cy - 6.6, hx - r - 0.2, cy - 3.4);
    ctx.lineTo(hx - r, cy - 1);
    ctx.quadraticCurveTo(hx, cy - 4.2, hx + r, cy - 2.4);
  } else {
    ctx.moveTo(-r - 0.3, cy - 3.2);
    ctx.quadraticCurveTo(0, cy - 7, r + 0.3, cy - 3.2);
    ctx.lineTo(r + 0.2, cy - 0.8);
    ctx.quadraticCurveTo(0, cy - 4.6, -r - 0.2, cy - 0.8);
  }
  ctx.closePath();
  fillStroke(ctx, cloth, PAWN.outlineWidth * 0.8);
  if (d !== 'S') {
    // Узел и концы сзади.
    const kx = d === 'E' ? hx - r : 0;
    const ky = d === 'E' ? cy - 2.2 : cy - 3;
    ctx.beginPath();
    ctx.moveTo(kx, ky);
    ctx.lineTo(kx - (d === 'E' ? 4 : 2), ky + 5);
    ctx.lineTo(kx - (d === 'E' ? 2 : 0.5), ky + 5.4);
    ctx.closePath();
    ctx.moveTo(kx, ky);
    ctx.lineTo(kx + (d === 'E' ? -1 : 2), ky + 5.6);
    ctx.lineTo(kx + (d === 'E' ? 0.8 : 3.4), ky + 5);
    ctx.closePath();
    fillStroke(ctx, cloth);
  }
}

function cap(ctx: Ctx, d: PawnDir, color: string, hx: number): void {
  const H = PAWN.head;
  const cy = H.y;
  const r = H.r;
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(hx - r - 0.6, cy - 2.4);
    ctx.bezierCurveTo(hx - r, cy - r - 2.4, hx + r, cy - r - 2.4, hx + r + 0.4, cy - 3.2);
    ctx.lineTo(hx + r + 4.2, cy - 3);
    ctx.lineTo(hx + r + 4, cy - 1.8);
    ctx.lineTo(hx - r - 0.6, cy - 1.6);
  } else {
    ctx.moveTo(-r - 0.6, cy - 2.2);
    ctx.bezierCurveTo(-r, cy - r - 2.6, r, cy - r - 2.6, r + 0.6, cy - 2.2);
    ctx.lineTo(-r - 0.6, cy - 2.2);
  }
  ctx.closePath();
  fillStroke(ctx, color, PAWN.outlineWidth);
  if (d === 'S') {
    ctx.beginPath();
    ctx.ellipse(0, cy - 2.2, r - 1, 1.4, 0, 0, Math.PI);
    fillStroke(ctx, tint(color, -0.25), PAWN.outlineWidth * 0.8);
  }
  ctx.beginPath();
  ctx.moveTo(d === 'E' ? hx - 2 : -3, cy - r + 0.5);
  ctx.quadraticCurveTo(d === 'E' ? hx + 1 : 0, cy - r - 1.2, d === 'E' ? hx + 4 : 3, cy - r + 0.5);
  stroke(ctx, 0.8, tint(color, 0.3));
}

/** Метрокоп: каска и противогаз — заливки в пределах головы. */
function maskInside(ctx: Ctx, d: PawnDir, O: Record<string, unknown>, hx: number): void {
  const H = PAWN.head;
  const cy = H.y;
  ctx.fillStyle = O.helmet as string;
  if (d === 'N') {
    ctx.fillRect(-20, cy - 20, 40, 40);
    return;
  }
  ctx.fillRect(-20, cy - 20, 40, 20 - 2.8);
  if (d === 'E') ctx.fillRect(-20, cy - 20, hx - 1.5 + 20, 40);
  ctx.fillStyle = O.mask as string;
  if (d === 'E') ctx.fillRect(hx - 1.5, cy - 2.8, 20, 20);
  else ctx.fillRect(-20, cy - 2.8, 40, 20);
  // Тень под каской.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(d === 'E' ? hx - 1.5 : -20, cy - 2.8, 40, 1.2);
}

/** Метрокоп: край каски, линзы, фильтр, ремни — поверх контура головы. */
function maskOver(ctx: Ctx, d: PawnDir, O: Record<string, unknown>, hx: number): void {
  const H = PAWN.head;
  const cy = H.y;
  const r = H.r;
  const helmet = O.helmet as string;
  // Козырёк каски.
  ctx.beginPath();
  if (d === 'E') {
    ctx.moveTo(hx - r - 0.4, cy - 2.2);
    ctx.lineTo(hx + r + 1.2, cy - 3.4);
  } else if (d === 'S') {
    ctx.moveTo(-r - 0.4, cy - 2.8);
    ctx.lineTo(r + 0.4, cy - 2.8);
  } else {
    ctx.moveTo(-r + 1, cy + 1);
    ctx.quadraticCurveTo(0, cy + 2.4, r - 1, cy + 1);
  }
  stroke(ctx, 1.6, tint(helmet, -0.35));
  ctx.beginPath();
  ctx.arc(hx, cy - 1, r - 1.6, Math.PI * 1.15, Math.PI * 1.55);
  stroke(ctx, 0.8, tint(helmet, 0.35));
  if (d === 'N') return;
  // Линзы.
  const lenses = d === 'E' ? [hx + r - 2.5] : [-3.1, 3.1];
  for (const lx of lenses) {
    ctx.beginPath();
    ctx.arc(lx, cy - 0.4, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = O.lens as string;
    ctx.fill();
    stroke(ctx, 0.9, O.lensRim as string);
    ctx.beginPath();
    ctx.arc(lx - 0.7, cy - 1.1, 0.55, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
  }
  // Фильтр-«рыло».
  ctx.beginPath();
  if (d === 'E') ctx.rect(hx + r - 1.2, cy + 2.2, 3.4, 3.2);
  else ctx.rect(-2.1, cy + 3, 4.2, 3.4);
  fillStroke(ctx, '#7b8189', PAWN.outlineWidth * 0.7);
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const gy = (d === 'E' ? cy + 3 : cy + 3.9) + k * 0.9;
    ctx.moveTo(d === 'E' ? hx + r - 0.6 : -1.3, gy);
    ctx.lineTo(d === 'E' ? hx + r + 1.6 : 1.3, gy);
  }
  stroke(ctx, 0.45, '#3d4247');
  // Ремни к каске.
  if (d === 'S') {
    ctx.beginPath();
    ctx.moveTo(-r + 0.6, cy + 1.5);
    ctx.lineTo(-5.2, cy + 0.6);
    ctx.moveTo(r - 0.6, cy + 1.5);
    ctx.lineTo(5.2, cy + 0.6);
    stroke(ctx, 0.7, tint(helmet, -0.3));
  }
}

function otaInside(ctx: Ctx, d: PawnDir, hx: number): void {
  const cy = PAWN.head.y;
  ctx.fillStyle = '#1a1f27';
  if (d === 'S') ctx.fillRect(-5.2, cy - 3.8, 10.4, 7.4);
  else if (d === 'E') ctx.fillRect(hx + 0.5, cy - 3.8, 12, 7);
}

/** OTA: шлем с одним красным глазом, рёбра шлема. */
function otaOver(ctx: Ctx, d: PawnDir, O: Record<string, unknown>, hx: number): void {
  const H = PAWN.head;
  const cy = H.y;
  const r = H.r;
  const helmet = O.helmet as string;
  ctx.beginPath();
  ctx.moveTo(hx - (d === 'E' ? 3 : 0), cy - r - 0.2);
  ctx.lineTo(hx - (d === 'E' ? 3 : 0), cy - 4);
  stroke(ctx, 1.2, tint(helmet, 0.3));
  ctx.beginPath();
  ctx.arc(hx, cy, r - 1.4, Math.PI * 1.1, Math.PI * 1.5);
  stroke(ctx, 0.8, tint(helmet, 0.4));
  if (d === 'N') {
    ctx.beginPath();
    ctx.rect(-3, cy + 1, 6, 3);
    fillStroke(ctx, tint(helmet, -0.3));
    return;
  }
  ctx.save();
  ctx.fillStyle = O.visor as string;
  ctx.shadowColor = O.visor as string;
  ctx.shadowBlur = 5 * Math.abs(ctx.getTransform().a);
  ctx.beginPath();
  ctx.arc(d === 'E' ? hx + r - 2.2 : -1.8, cy - 0.8, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Решётка респиратора.
  ctx.beginPath();
  const gx = d === 'E' ? hx + r - 3.5 : -2;
  for (let k = 0; k < 3; k++) {
    ctx.moveTo(gx, cy + 2 + k);
    ctx.lineTo(gx + 3.6, cy + 2 + k);
  }
  stroke(ctx, 0.5, '#5a6372');
}

/** Тень под ногами пешки. */
export function drawPawnShadow(ctx: Ctx, x: number, y: number, s: number): void {
  const S = PAWN.shadow;
  ctx.fillStyle = S.color;
  ctx.beginPath();
  ctx.ellipse(x, y + S.y * s, S.rx * s, S.ry * s, 0, 0, Math.PI * 2);
  ctx.fill();
}
