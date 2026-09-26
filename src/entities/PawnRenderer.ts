import type { FactionId } from '../config/factions';
import { PAWN } from '../config/pawns';

export type PawnDir = 'S' | 'N' | 'E' | 'W';

/** Внешность пешки: фракция и ранг (цвет формы), форма, зерно (кожа, волосы, причёска). */
export interface PawnLook {
  faction: FactionId;
  rank: number;
  color: string;
  seed: number;
}

/** Сторона взгляда по углу (как в RimWorld: четыре стороны). */
export function pawnDir(facing: number): PawnDir {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  if (Math.abs(c) >= Math.abs(s)) return c >= 0 ? 'E' : 'W';
  return s >= 0 ? 'S' : 'N';
}

/** Зерно внешности из строки (имя тела) или числа (id персонажа). */
export function lookSeed(v: string | number): number {
  if (typeof v === 'number') return (Math.imul(v ^ 0x9e3779b9, 2654435761) >>> 0);
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[(((seed >>> salt) ^ Math.imul(seed, salt + 7)) >>> 0) % list.length];
}

/**
 * Пешка в стиле RimWorld: туловище-«фасолина» цвета формы, крупная голова, контур. x, y — экран
 * (центр персонажа), s — пикселей экрана на px мира. Тень рисуется отдельно (drawPawnShadow).
 */
export function drawPawn(ctx: CanvasRenderingContext2D, look: PawnLook, x: number, y: number, s: number, dir: PawnDir): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir === 'W' ? -s : s, s);
  const side = dir === 'E' || dir === 'W';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = PAWN.outlineWidth;
  ctx.strokeStyle = PAWN.outline;
  const gear = PAWN.gear[look.faction] ?? PAWN.gear.citizen;
  const skin = pick(PAWN.skins, look.seed, 3);
  const hair = pick(PAWN.hairs, look.seed, 11);
  const roll = ((look.seed >>> 17) % 1000) / 1000;
  const hairStyle = roll < PAWN.baldChance ? 'bald' : roll < PAWN.baldChance + PAWN.longChance ? 'long' : 'short';
  const headKind = look.faction === 'rebel' && look.rank < PAWN.rebelBandanaRank ? 'hair' : gear.head;
  const H = PAWN.head;
  const hx = side ? H.sideShift : 0;
  const hy = H.y;

  // Длинные волосы — за головой и на плечах.
  const showHair = headKind === 'hair' || headKind === 'bandana' || headKind === 'cap';
  if (showHair && hairStyle === 'long' && dir !== 'N') {
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.ellipse(side ? hx - 2 : 0, hy + 3, H.r + 1.2, H.r + 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Туловище.
  bodyPath(ctx, side);
  ctx.fillStyle = look.color;
  ctx.fill();
  ctx.stroke();
  // Воротник и галстук администратора.
  if (gear.collar && dir !== 'N') {
    ctx.fillStyle = gear.collar;
    ctx.beginPath();
    ctx.moveTo(side ? 1 : -3.5, PAWN.body.top + 0.5);
    ctx.lineTo(side ? 5 : 3.5, PAWN.body.top + 0.5);
    ctx.lineTo(side ? 3 : 0, PAWN.body.top + 5);
    ctx.closePath();
    ctx.fill();
    if (!side) {
      ctx.fillStyle = gear.tie;
      ctx.fillRect(-0.8, PAWN.body.top + 3, 1.6, 6);
    }
  }

  // Голова.
  ctx.beginPath();
  if (side) ctx.ellipse(hx, hy, H.r - 0.4, H.r, 0, 0, Math.PI * 2);
  else ctx.arc(0, hy, H.r, 0, Math.PI * 2);
  const helmetFull = headKind === 'ota';
  ctx.fillStyle = helmetFull ? gear.helmet : skin;
  ctx.fill();

  // Всё, что на голове, — в пределах головы (клип), контур — поверх.
  ctx.save();
  ctx.clip();
  if (headKind === 'hair' || headKind === 'bandana' || headKind === 'cap') {
    if (hairStyle !== 'bald' || dir === 'N') {
      ctx.fillStyle = hair;
      if (dir === 'N') ctx.fillRect(-20, hy - 20, 40, 40);
      else if (side) {
        ctx.fillRect(-20, hy - 20, 40, 20 - 3.2);
        ctx.fillRect(-20, hy - 20, hx - 2.5 + 20, 40);
      } else ctx.fillRect(-20, hy - 20, 40, 20 - 3.2);
    }
    if (headKind === 'bandana') {
      ctx.fillStyle = gear.cloth;
      ctx.fillRect(-20, hy - 5.5, 40, 2.6);
    }
    if (headKind === 'cap') {
      ctx.fillStyle = gear.cap;
      ctx.fillRect(-20, hy - 20, 40, 20 - 3.8);
    }
  } else if (headKind === 'mask') {
    // Метрокоп: каска сверху, противогаз на лице.
    // В профиле каска закрывает и затылок, противогаз — лицо целиком (кожи не видно).
    ctx.fillStyle = gear.helmet;
    if (dir === 'N') ctx.fillRect(-20, hy - 20, 40, 40);
    else {
      ctx.fillRect(-20, hy - 20, 40, 20 - 2.6);
      if (side) ctx.fillRect(-20, hy - 20, hx - 1 + 20, 40);
      ctx.fillStyle = gear.mask;
      if (side) ctx.fillRect(hx - 1, hy - 2.6, 20, 20);
      else ctx.fillRect(-20, hy - 2.6, 40, 20);
    }
  } else if (headKind === 'ota') {
    ctx.fillStyle = '#20262f';
    if (dir === 'S') ctx.fillRect(-5, hy - 3.5, 10, 5);
    else if (side) ctx.fillRect(hx + 1, hy - 3.5, 10, 5);
  }
  ctx.restore();
  // Контур головы.
  ctx.beginPath();
  if (side) ctx.ellipse(hx, hy, H.r - 0.4, H.r, 0, 0, Math.PI * 2);
  else ctx.arc(0, hy, H.r, 0, Math.PI * 2);
  ctx.stroke();

  // Детали поверх контура: глаза, линзы, козырёк, «глаз» OTA, узел банданы.
  const E = PAWN.eye;
  if (headKind === 'mask' && dir !== 'N') {
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = gear.lensRim;
    ctx.fillStyle = gear.lens;
    const lenses = side ? [hx + 3.6] : [-E.dx - 0.4, E.dx + 0.4];
    for (const lx of lenses) {
      ctx.beginPath();
      ctx.arc(lx, hy - 0.8, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Фильтр противогаза.
    ctx.fillStyle = '#6e737a';
    ctx.strokeStyle = PAWN.outline;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    if (side) ctx.rect(hx + 5.5, hy + 2, 3.5, 3);
    else ctx.rect(-1.8, hy + 3.4, 3.6, 2.8);
    ctx.fill();
    ctx.stroke();
  } else if (headKind === 'ota' && dir !== 'N') {
    ctx.fillStyle = gear.visor;
    ctx.shadowColor = gear.visor;
    ctx.shadowBlur = 4 * Math.abs(ctx.getTransform().a);
    ctx.beginPath();
    ctx.arc(side ? hx + 4.5 : 0, hy - 1, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else if (dir !== 'N' && headKind !== 'ota') {
    ctx.fillStyle = E.color;
    const eyes = side ? [hx + 4.2] : [-E.dx, E.dx];
    for (const ex of eyes) {
      ctx.beginPath();
      ctx.arc(ex, E.y, E.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (headKind === 'cap' && dir !== 'N') {
    ctx.fillStyle = gear.cap;
    ctx.strokeStyle = PAWN.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (side) ctx.rect(hx + 3, hy - 5.2, 7.5, 1.8);
    else ctx.rect(-6, hy - 4.6, 12, 1.8);
    ctx.fill();
    ctx.stroke();
  }
  if (headKind === 'bandana' && dir !== 'S') {
    ctx.strokeStyle = gear.cloth;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const kx = side ? hx - H.r + 0.5 : 0;
    ctx.moveTo(kx, hy - 4.2);
    ctx.lineTo(kx - (side ? 3.5 : 1.5), hy + 1);
    ctx.moveTo(kx, hy - 4.2);
    ctx.lineTo(kx - (side ? 1.5 : -1.5), hy + 1.8);
    ctx.stroke();
  }
  ctx.restore();
}

/** Туловище: округлые плечи, расширение к поясу, круглый низ. В профиле — уже. */
function bodyPath(ctx: CanvasRenderingContext2D, side: boolean): void {
  const B = PAWN.body;
  const sh = side ? B.shoulder * 0.78 : B.shoulder;
  const wa = side ? B.waist * 0.82 : B.waist;
  ctx.beginPath();
  ctx.moveTo(-sh, B.top + 3);
  ctx.quadraticCurveTo(-sh, B.top, -sh + 3, B.top);
  ctx.lineTo(sh - 3, B.top);
  ctx.quadraticCurveTo(sh, B.top, sh, B.top + 3);
  ctx.bezierCurveTo(wa, B.bottom - 7, wa, B.bottom, 0, B.bottom);
  ctx.bezierCurveTo(-wa, B.bottom, -wa, B.bottom - 7, -sh, B.top + 3);
  ctx.closePath();
}

/** Тень под ногами пешки. */
export function drawPawnShadow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const S = PAWN.shadow;
  ctx.fillStyle = S.color;
  ctx.beginPath();
  ctx.ellipse(x, y + S.y * s, S.rx * s, S.ry * s, 0, 0, Math.PI * 2);
  ctx.fill();
}
