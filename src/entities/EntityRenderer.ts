import type { Character } from './Character';
import type { View } from '../core/Camera';
import { FACTIONS, colorsOf, rankOf } from '../config/factions';
import { LOYALTY } from '../config/loyalty';
import { familyTitle, type FamilySystem } from '../systems/Families';
import type { GangSystem } from '../systems/Gangs';
import { PROFESSIONS, DEFAULT_PROFESSION } from '../config/professions';
import { RENDER } from '../config/render';
import { lerp } from '../core/math';
import { drawWeapon } from './WeaponRenderer';
import { bootColor, drawPawnShadow, handColor, lookSeed, pawnDir } from './PawnRenderer';
import { isWalking } from './gait';
import { CHARACTER } from '../config/entities';
import { drawPawnCached } from './PawnCache';
import { PAWN } from '../config/pawns';
import { apparentFaction, displayName } from './cover';
import { CROUCH, DOWNED } from '../config/tactics';
import type { PawnLook } from './PawnRenderer';

/** Подпись роли: ГО и повстанцы — с рангом, жители — с номером CID. */
export function roleLabel(c: Character): string {
  // Партизан в маскировке подписан по личине: гражданин, рабочий ГСР, сотрудник ГО или OTA.
  if (c.disguised) {
    const cv = c.cover;
    if (!cv || cv.faction === 'citizen') return `${FACTIONS.citizen.role} · #${c.cid}`;
    const cr = rankOf(cv.faction, cv.rank);
    const cp = cv.profession ? PROFESSIONS[cv.profession] : null;
    if (cv.faction === 'cp' && cr) return `${FACTIONS.cp.role} · ${cr.short}`;
    return cp ? cp.name : `${FACTIONS[cv.faction].role} · #${c.cid}`;
  }
  const f = FACTIONS[c.faction];
  const r = rankOf(c.faction, c.rank);
  const prof = c.profession ? PROFESSIONS[c.profession] : null;
  // Профессия вместо названия фракции там, где она своя (не «Гражданин»/«Солдат»).
  const role = prof && prof.id !== DEFAULT_PROFESSION[c.faction] ? prof.name : f.role;
  // Сопротивление: юнит и есть роль («Ветеран», «Сержант HYDRA»).
  let s = c.faction === 'rebel' && r ? r.name : r ? `${role} · ${r.short}` : c.faction === 'admin' || c.faction === 'vort' ? role : `${role} · #${c.cid}`;
  const phase = c.law.phase;
  if (phase === 'cuffed' || phase === 'entering') s += ' · задержан';
  else if (phase === 'jailed') s += ' · в КПЗ';
  return s;
}

/**
 * Кружки персонажей и подписи над ними (имя, роль, реплика). Кружки рисуются до тумана войны,
 * подписи — после, в экранных пикселях: чёткие и одного размера при любом масштабе.
 * Невидимых игроку (c.visible = false) не рисуем, кроме режима отладки.
 */
export class EntityRenderer {
  /** Семьи горожан (повязка, общая внешность, подпись); задаёт Game. */
  families: FamilySystem | null = null;
  /** Банды: повязка цвета банды и её название в подписи. */
  gangs: GangSystem | null = null;

  /** Внешность пешки: партизан в маскировке — по личине; лоялист — в форме; семья и банда — повязка. */
  lookOf(c: Character): PawnLook {
    const faction = apparentFaction(c);
    const rank = c.disguised ? c.cover?.rank ?? 0 : c.rank;
    const loyalist = isLoyalistUniform(c);
    const fam = !c.disguised ? this.families?.of(c) ?? null : null;
    const gang = !c.disguised ? this.gangs?.of(c) ?? null : null;
    return { faction, rank, color: loyalist ? LOYALTY.uniform.color : colorsOf(faction, rank).color, seed: lookSeed(c.id), profession: c.disguised ? c.cover?.profession ?? null : c.profession, kin: fam?.seed, band: gang?.def.color ?? fam?.color };
  }

  drawBodies(ctx: CanvasRenderingContext2D, v: View, list: readonly Character[], alpha: number, showAll: boolean, now: number): void {
    const s = v.scale;
    // Пешка мельче круга столкновений (PAWN.scale) — как в RimWorld.
    const ps = s * PAWN.scale;
    // Пешки сверху вниз по экрану: нижняя перекрывает верхнюю (как в RimWorld).
    const shown = drawOrder;
    shown.length = 0;
    for (const c of list) {
      if (!c.alive || (!c.visible && !showAll)) continue;
      const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
      const y = (lerp(c.prevY, c.y, alpha) - v.top) * s;
      const m = 30 * s;
      if (x < -m || y < -m || x > v.width + m || y > v.height + m) continue;
      shown.push({ c, x, y });
    }
    shown.sort((a, b) => a.y - b.y);
    const W = PAWN.walk;
    for (const { c, x: gx, y: gy } of shown) {
      ctx.globalAlpha = c.visible ? 1 : 0.4;
      // Сторона — по походке (идёт — по ходу, боком — профилем; целится или стоит — куда смотрит).
      const dir = c.bodyDir;
      const look = this.lookOf(c);
      const reloading = c.reloadUntil > now;
      // Тяжело ранен — лежит.
      if (c.downed) {
        this.downedBody(ctx, c, look, gx, gy, s, ps, now);
        continue;
      }
      if (c.isPlayer) {
        // Выделение игрока — эллипс у ног.
        ctx.strokeStyle = PAWN.playerRing;
        ctx.lineWidth = Math.max(1, s * 1.3);
        ctx.beginPath();
        ctx.ellipse(gx, gy + PAWN.shadow.y * ps, (PAWN.shadow.rx + 3) * ps, (PAWN.shadow.ry + 1.8) * ps, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawPawnShadow(ctx, gx, gy, ps);
      // Шаг: фаза по пройденному пути (полупериод синуса — один шаг), корпус подпрыгивает на каждом
      // шаге; наклон в сторону движения по горизонтали, при ходьбе вверх/вниз — покачивание в такт.
      const walking = isWalking(c);
      const speed = Math.hypot(c.gaitVx, c.gaitVy);
      const amt = walking ? Math.min(1, speed / CHARACTER.walkSpeed) : 0;
      const phase = (c.stride / W.stride) * Math.PI;
      const sn = Math.sin(phase);
      const bob = Math.abs(sn) * W.bob * amt;
      const horiz = speed > 0 ? Math.abs(c.gaitVx) / speed : 0;
      const lean = walking ? Math.max(-W.leanMax, Math.min(W.leanMax, (c.gaitVx / CHARACTER.runSpeed) * W.lean)) + sn * W.sway * amt * (1 - horiz) : 0;
      // Поворот вокруг точки у ног: ступни на земле, корпус наклоняется.
      const footY = W.foot.y * ps;
      const cs = Math.cos(lean);
      const si = Math.sin(lean);
      // Присел — ниже ростом (сжат по вертикали к ступням).
      const k = c.crouch ? CROUCH.squash : 1;
      ctx.setTransform(cs, si, -si * k, cs * k, gx, gy + footY);
      // Дальше — в осях пешки: x = 0 у её центра, y — центр над землёй с подъёмом шага.
      const x = 0;
      const y = -footY - bob * ps;
      drawFeet(ctx, dir, look, ps, walking ? phase : null, amt);
      // Ствол: целится или стоит — куда смотрит, идёт без прицела — по ходу.
      const hold = pawnDir(c.facing) === dir || !walking ? c.facing : Math.atan2(c.gaitVy, c.gaitVx);
      // Смотрит от нас — оружие за спиной, иначе — в руках перед собой.
      const hand = c.weapon ? handColor(look) : null;
      if (dir === 'N') drawWeapon(ctx, c, x, y, s, reloading, hold, hand);
      drawPawnCached(ctx, look, x, y, ps, dir);
      if (dir !== 'N') drawWeapon(ctx, c, x, y, s, reloading, hold, hand);
      // Курьер несёт коробку перед собой.
      if (c.carrying) {
        const bx = x + Math.cos(hold) * 6 * ps;
        const by = y + 4 * ps + Math.sin(hold) * 3 * ps;
        ctx.fillStyle = RENDER.effects.box;
        ctx.strokeStyle = PAWN.outline;
        ctx.lineWidth = Math.max(1, 1.1 * ps);
        ctx.fillRect(bx - 5 * ps, by - 4 * ps, 10 * ps, 8 * ps);
        ctx.strokeRect(bx - 5 * ps, by - 4 * ps, 10 * ps, 8 * ps);
        ctx.fillStyle = RENDER.effects.boxTape;
        ctx.fillRect(bx - 0.8 * ps, by - 4 * ps, 1.6 * ps, 8 * ps);
      }
      // Оглушён дубинкой — голубые искры вокруг головы.
      if (c.stunUntil > now) {
        const hy = y + PAWN.head.y * ps;
        ctx.strokeStyle = RENDER.entity.stun;
        ctx.lineWidth = Math.max(1, s * 1.2);
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = now * 9 + (k * Math.PI * 2) / 3;
          const r = PAWN.head.r * ps;
          ctx.moveTo(x + Math.cos(a) * r * 1.2, hy + Math.sin(a) * r * 0.6);
          ctx.lineTo(x + Math.cos(a + 0.5) * r * 1.45, hy + Math.sin(a + 0.5) * r * 0.75);
        }
        ctx.stroke();
      }
      // Наручники — кольца на поясе.
      if (c.law.phase === 'cuffed' || c.law.phase === 'entering') {
        ctx.strokeStyle = 'rgba(230,230,230,0.95)';
        ctx.lineWidth = Math.max(1, s * 1.1);
        for (const dx of [-2.2, 2.2]) {
          ctx.beginPath();
          ctx.arc(x + dx * ps, y + 6 * ps, 2 * ps, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  /** Лежащий тяжелораненый: лужа крови, пешка на боку (слабо шевелится), кольцо — сколько осталось. */
  private downedBody(ctx: CanvasRenderingContext2D, c: Character, look: PawnLook, gx: number, gy: number, s: number, ps: number, now: number): void {
    const D = RENDER.entity.downed;
    ctx.fillStyle = D.blood;
    ctx.beginPath();
    ctx.ellipse(gx + 2 * s, gy + 4 * s, 15 * s, 8 * s, 0.3, 0, Math.PI * 2);
    ctx.fill();
    const a = (lookSeed(c.id) % 2 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(now * 2.5 + c.id) * D.wobble;
    const cs = Math.cos(a);
    const si = Math.sin(a);
    ctx.setTransform(cs, si, -si, cs, gx, gy);
    drawPawnCached(ctx, look, 0, -2 * ps, ps, 'S');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const left = Math.max(0, Math.min(1, (c.downedUntil - now) / DOWNED.time));
    const r = D.ringR * s;
    ctx.lineWidth = Math.max(1.5, 1.8 * s);
    ctx.strokeStyle = D.ringBack;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = D.ring;
    ctx.beginPath();
    ctx.arc(gx, gy, r, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
    ctx.stroke();
  }



  drawLabels(ctx: CanvasRenderingContext2D, v: View, list: readonly Character[], alpha: number, dpr: number, now: number, showAll: boolean): void {
    const s = v.scale;
    const E = RENDER.entity;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    for (const c of list) {
      if (!c.alive || (!c.visible && !showAll)) continue;
      const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
      const cy = (lerp(c.prevY, c.y, alpha) - v.top) * s;
      // Как в RimWorld: имя под ногами, роль под именем; реплика — над головой.
      const feet = cy + PAWN.body.bottom * s * PAWN.scale;
      if (x < -200 || cy < -80 || x > v.width + 200 || cy > v.height + 80) continue;
      const f = FACTIONS[c.faction];
      const r = rankOf(c.faction, c.rank);
      ctx.globalAlpha = c.visible ? 1 : 0.5;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = E.labelShadow;
      ctx.font = scaleFont(E.nameFont, dpr);
      const ny = feet + 12 * dpr;
      const shown = displayName(c);
      ctx.strokeText(shown, x, ny);
      // Ники сопротивления: армия — жёлтые, глава и HYDRA — красные (партизан в маскировке — как все).
      ctx.fillStyle = c.faction === 'rebel' && !c.disguised && r ? r.color : c.isPlayer ? E.playerNameColor : E.nameColor;
      ctx.fillText(shown, x, ny);
      ctx.font = scaleFont(E.roleFont, dpr);
      const fam = !c.disguised ? this.families?.of(c) ?? null : null;
      const gang = !c.disguised ? this.gangs?.of(c) ?? null : null;
      const role = c.downed ? `тяжело ранен · ${Math.max(0, Math.ceil(c.downedUntil - now))} с` : gang ? `${roleLabel(c)} · ${gang.def.name}` : fam ? `${roleLabel(c)} · ${familyTitle(fam.surname)}` : roleLabel(c);
      ctx.strokeText(role, x, ny + 10 * dpr);
      ctx.fillStyle = c.downed ? RENDER.entity.downed.label : gang ? gang.def.color : isLoyalistUniform(c) ? LOYALTY.uniform.label : r ? r.color : f.label;
      ctx.fillText(role, x, ny + 10 * dpr);
      const top = cy + (PAWN.head.y - PAWN.head.r) * s * PAWN.scale;
      if (c.speech && c.speech.until > now) this.bubble(ctx, c.speech.text, x, top - 6 * dpr, dpr);
    }
    ctx.globalAlpha = 1;
  }

  private bubble(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, dpr: number): void {
    ctx.font = scaleFont(RENDER.entity.speechFont, dpr);
    const w = ctx.measureText(text).width + 12 * dpr;
    const h = 17 * dpr;
    ctx.fillStyle = RENDER.entity.speechBg;
    ctx.fillRect(x - w / 2, y - h + 4 * dpr, w, h);
    ctx.fillStyle = RENDER.entity.speechText;
    ctx.fillText(text, x, y);
  }
}

const drawOrder: { c: Character; x: number; y: number }[] = [];

type PawnLookLite = Parameters<typeof bootColor>[0];

const fontCache = new Map<string, string>();
/** «600 11px Font» → с учётом devicePixelRatio. */
function scaleFont(font: string, dpr: number): string {
  const key = font + dpr;
  let f = fontCache.get(key);
  if (!f) {
    f = font.replace(/(\d+(?:\.\d+)?)px/, (_, n) => `${(Number(n) * dpr).toFixed(1)}px`);
    fontCache.set(key, f);
  }
  return f;
}

/** Гражданин-лоялист (не партизан в маскировке) — в светло-фиолетовой форме. */
export function isLoyalistUniform(c: Character): boolean {
  return c.faction === 'citizen' && !c.disguised && c.loyalty >= LOYALTY.uniform.min;
}

/**
 * Ступни у земли (до пешки — корпус их перекрывает сверху): спереди и сзади — рядом, шагающая
 * приподнята; в профиль — одна впереди, другая позади, выносится вперёд по фазе шага. phase —
 * фаза шага (null — стоит), amt — доля шага от скорости.
 */
export function drawFeet(ctx: CanvasRenderingContext2D, dir: string, look: PawnLookLite, ps: number, phase: number | null, amt: number): void {
  const F = PAWN.walk.foot;
  const sn = phase === null ? 0 : Math.sin(phase);
  const cs = phase === null ? 1 : Math.cos(phase);
  ctx.fillStyle = bootColor(look);
  ctx.strokeStyle = PAWN.outline;
  ctx.lineWidth = Math.max(1, PAWN.outlineWidth * 0.8 * ps);
  const side = dir === 'E' || dir === 'W';
  const fwd = dir === 'W' ? -1 : 1;
  for (let i = 0; i < 2; i++) {
    // Ступня 0 опорная в первом шаге (уходит назад), 1 — переносится вперёд и приподнята.
    const k = i === 0 ? 1 : -1;
    const lift = Math.max(0, -k * sn) * F.lift * amt;
    const fx = side ? (phase === null ? (i === 0 ? 1.2 : -1.2) : k * cs * F.swing * amt) * fwd : (i === 0 ? -F.dx : F.dx);
    ctx.beginPath();
    ctx.ellipse(fx * ps, -lift * ps, F.rx * ps, F.ry * ps, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
