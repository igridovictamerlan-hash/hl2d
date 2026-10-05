import { ITEMS } from '../config/items';
import type { Character, SpeechKind } from './Character';
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
import { animOf, drawActionHands, drawBlanket, drawHandProps, drawSleepZ, drawWorkHands, hurtFlash, isStriking, strikeSweep } from './poses';
import { CHARACTER } from '../config/entities';
import { drawPawnCached } from './PawnCache';
import { PAWN } from '../config/pawns';
import { apparentFaction, displayName } from './cover';
import { CROUCH, DOWNED } from '../config/tactics';
import type { PawnLook } from './PawnRenderer';

/**
 * Подпись роли над пешкой — коротко: юнит у ВС («PCU.03»), юнит у армии («Ветеран»), профессия или
 * сторона у остальных («Бандит», «ТС», «Гражданин»); задержанный — «задержан», сидящий — «в КПЗ».
 * Номер CID, семья и банда — только в подробной подписи под курсором (labelDetail).
 */
export function roleLabel(c: Character): string {
  let s: string;
  // Партизан в маскировке подписан по личине: гражданин, рабочий ТС, сотрудник ВС.
  if (c.disguised) {
    const cv = c.cover;
    const cr = cv ? rankOf(cv.faction, cv.rank) : null;
    const cp = cv?.profession ? PROFESSIONS[cv.profession] : null;
    s = !cv || cv.faction === 'citizen' ? FACTIONS.citizen.role : cv.faction === 'cp' && cr ? cr.short : cp && cp.id !== DEFAULT_PROFESSION[cv.faction] ? cp.name : FACTIONS[cv.faction].role;
  } else {
    const r = rankOf(c.faction, c.rank);
    const prof = c.profession ? PROFESSIONS[c.profession] : null;
    // Сопротивление: юнит и есть роль; ВС — юнит («ВС» уже в позывном); остальные — профессия или сторона.
    s = c.faction === 'rebel' && r ? r.name : c.faction === 'cp' && r ? r.short : prof && prof.id !== DEFAULT_PROFESSION[c.faction] ? prof.name : FACTIONS[c.faction].role;
  }
  const phase = c.law.phase;
  if (phase === 'cuffed' || phase === 'entering') return 'задержан';
  // Бессрочно сидят только в тюрьме Протектората (повстанцы).
  if (phase === 'jailed') return c.law.jailUntil === Infinity ? 'в тюрьме' : 'в КПЗ';
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
    return { faction, rank, color: loyalist ? LOYALTY.uniform.color : colorsOf(faction, rank).color, seed: lookSeed(c.id), profession: c.disguised ? c.cover?.profession ?? null : c.profession, kin: fam?.seed, band: gang?.def.color ?? fam?.color, helmet: gearColor(c, 'head'), vest: gearColor(c, 'torso') };
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
      // Спящий лежит лицом к нам.
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
      const an = animOf(c, now, walking, c.aiming || c.recoil > W.aimRecoil);
      const lying = an.kind === 'sleep' || an.kind === 'ko';
      const dir = lying ? 'S' : c.bodyDir;
      const speed = Math.hypot(c.gaitVx, c.gaitVy);
      const amt = walking ? Math.min(1, speed / CHARACTER.walkSpeed) : 0;
      const phase = (c.stride / W.stride) * Math.PI;
      const sn = Math.sin(phase);
      // Хромает — шаг неровный: подскок на одной ноге сильнее, корпус кренится; строевой шаг — чётче и выше.
      const limping = walking && c.limpUntil > now;
      const marching = walking && c.marching;
      const bobMul = limping ? (sn > 0 ? PAWN.anim.limp.hard : PAWN.anim.limp.soft) : marching ? PAWN.anim.march.bob : 1;
      const bob = Math.abs(sn) * W.bob * amt * bobMul + an.lift;
      const horiz = speed > 0 ? Math.abs(c.gaitVx) / speed : 0;
      const lean = walking ? Math.max(-W.leanMax, Math.min(W.leanMax, (c.gaitVx / CHARACTER.runSpeed) * W.lean)) + sn * W.sway * amt * (1 - horiz) + (limping ? sn * PAWN.anim.limp.lean : 0) + an.lean : an.lean;
      // Поворот вокруг точки у ног: ступни на земле, корпус наклоняется.
      const footY = W.foot.y * ps;
      const cs = Math.cos(lean);
      const si = Math.sin(lean);
      // Присел — ниже ростом (сжат по вертикали к ступням).
      const k = (c.crouch ? CROUCH.squash : 1) * an.squash;
      ctx.setTransform(cs, si, -si * k, cs * k, gx + an.dx * ps, gy + footY + (an.drop + an.dy) * ps);
      // Дальше — в осях пешки: x = 0 у её центра, y — центр над землёй с подъёмом шага.
      const x = 0;
      const y = -footY - bob * ps;
      if (an.feet) drawFeet(ctx, dir, look, ps, walking ? phase : null, amt, marching ? PAWN.anim.march.lift : 1);
      // Ствол: целится или стоит — куда смотрит, идёт без прицела — по ходу.
      const striking = isStriking(c, now);
      const hold = striking ? c.strikeAng + strikeSweep(c, now) : pawnDir(c.facing) === dir || !walking ? c.facing : Math.atan2(c.gaitVy, c.gaitVx);
      // Смотрит от нас — оружие за спиной, иначе — в руках перед собой.
      const hand = c.weapon ? handColor(look) : null;
      const armed = !!c.weapon && !lying;
      if (armed && dir === 'N') drawWeapon(ctx, c, x, y, s, reloading, hold, hand);
      drawPawnCached(ctx, look, x, y, ps, dir);
      const flash = hurtFlash(c, now);
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash.toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(x, y + 3 * ps, 8 * ps, 11 * ps, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (lying) {
        if (c.asleep) {
          drawBlanket(ctx, c, x, y, ps);
          drawSleepZ(ctx, c, x, y, ps, now);
        }
      } else if (!drawHandProps(ctx, c, look, x, y, ps, dir, now) && armed && dir !== 'N') drawWeapon(ctx, c, x, y, s, reloading, hold, hand);
      if (!lying) drawWorkHands(ctx, c, look, x, y, ps, dir, now);
      if (!lying) drawActionHands(ctx, c, look, x, y, ps, dir, now, marching ? sn : 0);
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



  /**
   * Подписи и реплики — коротко и без каши в толпе (RENDER.entity.labels): под ногами имя и роль,
   * над головой реплика. Порядок важности: игрок, под курсором (ещё строка подробностей — CID, семья
   * или банда), тяжелораненый, говорящий, дальше — кто ближе к игроку. Подпись, налезающая на уже
   * поставленную, сокращается до имени или не рисуется; реплик на экране не больше maxBubbles.
   * Камера отдалена — роли (меньше roleZoom) и имена (меньше nameZoom) остаются только у важных.
   * hoverX/hoverY — курсор в пикселях холста (null — нет).
   */
  drawLabels(ctx: CanvasRenderingContext2D, v: View, list: readonly Character[], alpha: number, dpr: number, now: number, showAll: boolean, player: Character | null = null, hoverX: number | null = null, hoverY: number | null = null): void {
    const s = v.scale;
    const E = RENDER.entity;
    const L = E.labels;
    const zoom = s / dpr;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    // Кто под курсором: ближайший к нему в hoverRadius px мира.
    let hovered: Character | null = null;
    let hoverD = L.hoverRadius * s;
    const cand = labelCand;
    cand.length = 0;
    const px = player ? player.x : v.left + v.width / s / 2;
    const py = player ? player.y : v.top + v.height / s / 2;
    for (const c of list) {
      if (!c.alive || (!c.visible && !showAll)) continue;
      const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
      const cy = (lerp(c.prevY, c.y, alpha) - v.top) * s;
      if (x < -200 || cy < -80 || x > v.width + 200 || cy > v.height + 80) continue;
      if (hoverX !== null && hoverY !== null) {
        const d = Math.hypot(hoverX - x, hoverY - cy);
        if (d < hoverD) {
          hoverD = d;
          hovered = c;
        }
      }
      const speaking = !!c.speech && c.speech.until > now;
      let score = -Math.hypot(c.x - px, c.y - py);
      if (c === player) score += 1e6;
      if (c.downed) score += 5e3;
      if (speaking) score += 3e3;
      if (speaking && c.speech!.kind !== 'say') score += E.bubble.radioScore;
      cand.push({ c, x, cy, score, speaking });
    }
    for (const e of cand) if (e.c === hovered) e.score += 1e5;
    cand.sort((a, b) => b.score - a.score);
    const placed = labelRects;
    placed.length = 0;
    const pad = L.pad * dpr;
    const free = (x0: number, y0: number, x1: number, y1: number): boolean => {
      for (const r of placed) if (x0 < r.x1 + pad && x1 > r.x0 - pad && y0 < r.y1 + pad && y1 > r.y0 - pad) return false;
      return true;
    };
    const nameFont = scaleFont(E.nameFont, dpr);
    const roleFont = scaleFont(E.roleFont, dpr);
    // Сперва реплики (важнее подписей): не налезают друг на друга, не больше maxBubbles; рисуются поверх подписей.
    const said = labelBubbles;
    said.length = 0;
    for (const { c, x, cy, speaking } of cand) {
      if (!speaking || said.length >= L.maxBubbles) continue;
      const key = c === player || c === hovered || c.downed;
      const radio = c.speech!.kind !== 'say';
      if (!key && !radio && zoom < L.nameZoom) continue;
      const bottom = cy + (PAWN.head.y - PAWN.head.r) * s * PAWN.scale - 4 * dpr;
      const lay = bubbleLayout(ctx, c.speech!.text, c.speech!.kind, dpr);
      const y0 = bottom - lay.h;
      if (!key && !free(x - lay.w / 2, y0, x + lay.w / 2, bottom)) continue;
      placed.push({ x0: x - lay.w / 2, y0, x1: x + lay.w / 2, y1: bottom });
      said.push({ c, x, y: bottom, lay });
    }
    for (const { c, x, cy } of cand) {
      const key = c === player || c === hovered || c.downed;
      ctx.globalAlpha = c.visible ? 1 : 0.5;
      if (!key && zoom < L.nameZoom) continue;
      // Как в RimWorld: имя под ногами, роль под именем.
      const ny = cy + PAWN.body.bottom * s * PAWN.scale + 12 * dpr;
      const name = displayName(c);
      const nw = textWidth(ctx, name, E.nameFont, dpr);
      const wantRole = key || zoom >= L.roleZoom;
      const gang = !c.disguised ? this.gangs?.of(c) ?? null : null;
      const role = !wantRole ? '' : c.downed ? `ранен · ${Math.max(0, Math.ceil(c.downedUntil - now))} с` : roleLabel(c);
      const rw = role ? textWidth(ctx, role, E.roleFont, dpr) : 0;
      const detail = c === hovered && c !== player ? labelDetail(c, this.families, gang) : '';
      const dw = detail ? textWidth(ctx, detail, E.roleFont, dpr) : 0;
      const lines = 1 + (role ? 1 : 0) + (detail ? 1 : 0);
      const w = Math.max(nw, rw, dw);
      const y0 = ny - 10 * dpr;
      let showRole = !!role;
      let showDetail = !!detail;
      if (!key && !free(x - w / 2, y0, x + w / 2, y0 + lines * 10 * dpr + 2 * dpr)) {
        // Тесно: только имя, а если и ему негде — ничего.
        if (!free(x - nw / 2, y0, x + nw / 2, ny + 2 * dpr)) continue;
        showRole = false;
        showDetail = false;
      }
      const n = 1 + (showRole ? 1 : 0) + (showDetail ? 1 : 0);
      placed.push({ x0: x - (showRole || showDetail ? w : nw) / 2, y0, x1: x + (showRole || showDetail ? w : nw) / 2, y1: y0 + n * 10 * dpr + 2 * dpr });
      const r = rankOf(c.faction, c.rank);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = E.labelShadow;
      ctx.font = nameFont;
      ctx.strokeText(name, x, ny);
      // Ники сопротивления: армия — жёлтые, глава и HYDRA — красные (партизан в маскировке — как все).
      ctx.fillStyle = c.faction === 'rebel' && !c.disguised && r ? r.color : c.isPlayer ? E.playerNameColor : E.nameColor;
      ctx.fillText(name, x, ny);
      ctx.font = roleFont;
      let ly = ny;
      if (showRole) {
        ly += 10 * dpr;
        ctx.strokeText(role, x, ly);
        ctx.fillStyle = c.downed ? E.downed.label : gang ? gang.def.color : isLoyalistUniform(c) ? LOYALTY.uniform.label : r ? r.color : FACTIONS[c.faction].label;
        ctx.fillText(role, x, ly);
      }
      if (showDetail) {
        ly += 10 * dpr;
        ctx.strokeText(detail, x, ly);
        ctx.fillStyle = L.detailColor;
        ctx.fillText(detail, x, ly);
      }
    }
    for (const b of said) {
      ctx.globalAlpha = b.c.visible ? 1 : 0.5;
      drawBubble(ctx, b.lay, b.c.speech!.kind, b.x, b.y, dpr);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
  }
}

/** Раскладка облачка: строки (перенос по словам), ширина и высота в px экрана. */
interface BubbleLayout {
  lines: string[];
  w: number;
  h: number;
  /** Отступ текста слева под значок рации. */
  icon: number;
}

const layoutCache = new Map<string, BubbleLayout>();

/** Перенос реплики по словам не шире RENDER.entity.bubble.maxWidth, не больше maxLines строк (кэш по тексту). */
function bubbleLayout(ctx: CanvasRenderingContext2D, text: string, kind: SpeechKind, dpr: number): BubbleLayout {
  const key = kind + dpr + text;
  let lay = layoutCache.get(key);
  if (lay) return lay;
  const B = RENDER.entity.bubble;
  const font = RENDER.entity.speechFont;
  const icon = kind === 'say' ? 0 : 13 * dpr;
  const max = B.maxWidth * dpr - icon;
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(ctx, next, font, dpr) > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > B.maxLines) {
    lines.length = B.maxLines;
    lines[B.maxLines - 1] += '…';
  }
  let w = 0;
  for (const l of lines) w = Math.max(w, textWidth(ctx, l, font, dpr));
  w += icon + B.pad * 2 * dpr + 4 * dpr;
  const tag = kind === 'dispatch' ? 9 * dpr : 0;
  const h = lines.length * B.lineH * dpr + B.pad * 2 * dpr + tag;
  lay = { lines, w, h, icon };
  if (layoutCache.size > 600) layoutCache.clear();
  layoutCache.set(key, lay);
  return lay;
}

/**
 * Облачко над головой: обычное — тёмное; рация — зелёное с рамкой и значком рации; Надзор — синее с биркой
 * «НАДЗОР». bottom — нижний край (хвостик смотрит на голову).
 */
function drawBubble(ctx: CanvasRenderingContext2D, lay: BubbleLayout, kind: SpeechKind, x: number, bottom: number, dpr: number): void {
  const E = RENDER.entity;
  const B = E.bubble;
  const st = kind === 'radio' ? B.radio : kind === 'dispatch' ? B.dispatch : null;
  const x0 = Math.round(x - lay.w / 2);
  const y0 = Math.round(bottom - lay.h);
  const w = Math.round(lay.w);
  const h = Math.round(lay.h);
  const t = B.tail * dpr;
  ctx.fillStyle = st ? st.bg : E.speechBg;
  ctx.fillRect(x0, y0, w, h);
  // Хвостик к голове.
  ctx.beginPath();
  ctx.moveTo(x - t, y0 + h);
  ctx.lineTo(x, y0 + h + t);
  ctx.lineTo(x + t, y0 + h);
  ctx.closePath();
  ctx.fill();
  let ty = y0;
  if (st) {
    ctx.strokeStyle = st.rim;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    if (kind === 'dispatch') {
      // Бирка «НАДЗОР» в верхнем левом углу.
      const D = B.dispatch;
      ctx.font = scaleFont(D.tagFont, dpr);
      const tw = ctx.measureText(D.tag).width + 6 * dpr;
      ctx.fillStyle = D.tagBg;
      ctx.fillRect(x0, y0, tw, 9 * dpr);
      ctx.fillStyle = D.tagText;
      ctx.textAlign = 'left';
      ctx.fillText(D.tag, x0 + 3 * dpr, y0 + 7.5 * dpr);
      ty += 9 * dpr;
    }
    drawRadioIcon(ctx, x0 + B.pad * dpr + 1 * dpr, ty + B.pad * dpr + 1 * dpr, dpr, st.icon);
  }
  ctx.font = scaleFont(E.speechFont, dpr);
  ctx.fillStyle = st ? st.text : E.speechText;
  ctx.textAlign = st ? 'left' : 'center';
  const tx = st ? x0 + lay.icon + B.pad * dpr + 2 * dpr : x;
  for (let i = 0; i < lay.lines.length; i++) {
    ctx.fillText(lay.lines[i], tx, ty + B.pad * dpr + (i + 1) * B.lineH * dpr - 3 * dpr);
  }
}

/** Значок рации: корпус, антенна, две дуги сигнала. */
function drawRadioIcon(ctx: CanvasRenderingContext2D, x: number, y: number, dpr: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y + 3 * dpr, 5 * dpr, 7 * dpr);
  ctx.fillRect(x + 1 * dpr, y, 1 * dpr, 3 * dpr);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  ctx.arc(x + 6 * dpr, y + 3 * dpr, 2.5 * dpr, -0.9, 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 6 * dpr, y + 3 * dpr, 4.5 * dpr, -0.9, 0.9);
  ctx.stroke();
}

const drawOrder: { c: Character; x: number; y: number }[] = [];
const labelCand: { c: Character; x: number; cy: number; score: number; speaking: boolean }[] = [];
const labelRects: { x0: number; y0: number; x1: number; y1: number }[] = [];
const labelBubbles: { c: Character; x: number; y: number; lay: BubbleLayout }[] = [];

/** Подробности под курсором: CID (у жителей), семья или банда. */
function labelDetail(c: Character, families: FamilySystem | null, gang: ReturnType<GangSystem['of']>): string {
  if (c.downed) return '';
  const cid = c.faction === 'citizen' || c.faction === 'cwu' || c.disguised ? `#${c.cid}` : '';
  const fam = !c.disguised ? families?.of(c) ?? null : null;
  const extra = gang ? `«${gang.def.name}»` : fam ? familyTitle(fam.surname) : '';
  return cid && extra ? `${cid} · ${extra}` : cid || extra;
}

const widthCache = new Map<string, number>();
/** Ширина текста (кэш по шрифту и строке: в толпе одни и те же имена и роли каждый кадр). */
function textWidth(ctx: CanvasRenderingContext2D, text: string, font: string, dpr: number): number {
  const key = font + dpr + text;
  let w = widthCache.get(key);
  if (w === undefined) {
    if (widthCache.size > 4000) widthCache.clear();
    ctx.font = scaleFont(font, dpr);
    w = ctx.measureText(text).width;
    widthCache.set(key, w);
  }
  return w;
}

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
export function drawFeet(ctx: CanvasRenderingContext2D, dir: string, look: PawnLookLite, ps: number, phase: number | null, amt: number, liftMul = 1): void {
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
    const lift = Math.max(0, -k * sn) * F.lift * amt * liftMul;
    const fx = side ? (phase === null ? (i === 0 ? 1.2 : -1.2) : k * cs * F.swing * amt) * fwd : (i === 0 ? -F.dx : F.dx);
    ctx.beginPath();
    ctx.ellipse(fx * ps, -lift * ps, F.rx * ps, F.ry * ps, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** Цвет надетого в слоте (шлем, бронежилет) — для пешки; ничего — undefined. */
function gearColor(c: Character, slot: 'head' | 'torso'): string | undefined {
  const id = c.gear[slot];
  return id ? ITEMS[id].gear?.color : undefined;
}
