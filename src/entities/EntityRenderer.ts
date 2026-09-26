import type { Character } from './Character';
import type { View } from '../core/Camera';
import { FACTIONS, CP_DIVISIONS, colorsOf, rankOf } from '../config/factions';
import { LOYALTY } from '../config/loyalty';
import { PROFESSIONS, DEFAULT_PROFESSION } from '../config/professions';
import { RENDER } from '../config/render';
import { lerp } from '../core/math';
import { drawWeapon } from './WeaponRenderer';
import { drawPawnShadow, lookSeed, pawnDir } from './PawnRenderer';
import { drawPawnCached } from './PawnCache';
import { PAWN } from '../config/pawns';

/** Подпись роли: ГО и повстанцы — с рангом, жители — с номером CID. */
export function roleLabel(c: Character): string {
  // Партизан в маскировке подписан как гражданин.
  if (c.disguised) return `${FACTIONS.citizen.role} · #${c.cid}`;
  const f = FACTIONS[c.faction];
  const r = rankOf(c.faction, c.rank);
  const prof = c.profession ? PROFESSIONS[c.profession] : null;
  // Профессия вместо названия фракции там, где она своя (не «Гражданин»/«Солдат»).
  const role = prof && prof.id !== DEFAULT_PROFESSION[c.faction] ? prof.name : f.role;
  let s = r ? `${role} · ${r.short}` : c.faction === 'admin' || c.faction === 'vort' ? role : `${role} · #${c.cid}`;
  if (c.division) s += ` · ${CP_DIVISIONS[c.division].short}`;
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
    for (const { c, x, y } of shown) {
      ctx.globalAlpha = c.visible ? 1 : 0.4;
      const dir = pawnDir(c.facing);
      // Партизан в маскировке выглядит как гражданин.
      const faction = c.disguised ? 'citizen' : c.faction;
      const rank = c.disguised ? 0 : c.rank;
      const loyalist = isLoyalistUniform(c);
      const look = { faction, rank, color: loyalist ? LOYALTY.uniform.color : colorsOf(faction, rank).color, seed: lookSeed(c.id), profession: c.disguised ? null : c.profession };
      const reloading = c.reloadUntil > now;
      if (c.isPlayer) {
        // Выделение игрока — эллипс у ног.
        ctx.strokeStyle = PAWN.playerRing;
        ctx.lineWidth = Math.max(1, s * 1.3);
        ctx.beginPath();
        ctx.ellipse(x, y + PAWN.shadow.y * ps, (PAWN.shadow.rx + 3) * ps, (PAWN.shadow.ry + 1.8) * ps, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawPawnShadow(ctx, x, y, ps);
      // Смотрит от нас — оружие за спиной, иначе — в руках перед собой.
      if (dir === 'N') drawWeapon(ctx, c, x, y, s, reloading);
      drawPawnCached(ctx, look, x, y, ps, dir);
      if (dir !== 'N') drawWeapon(ctx, c, x, y, s, reloading);
      // Курьер несёт коробку перед собой.
      if (c.carrying) {
        const bx = x + Math.cos(c.facing) * 6 * ps;
        const by = y + 4 * ps + Math.sin(c.facing) * 3 * ps;
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
    }
    ctx.globalAlpha = 1;
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
      ctx.strokeText(c.name, x, ny);
      ctx.fillStyle = c.isPlayer ? E.playerNameColor : E.nameColor;
      ctx.fillText(c.name, x, ny);
      ctx.font = scaleFont(E.roleFont, dpr);
      const role = roleLabel(c);
      ctx.strokeText(role, x, ny + 10 * dpr);
      ctx.fillStyle = isLoyalistUniform(c) ? LOYALTY.uniform.label : r ? r.color : f.label;
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
