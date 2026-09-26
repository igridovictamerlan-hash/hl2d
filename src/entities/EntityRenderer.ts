import type { Character } from './Character';
import type { View } from '../core/Camera';
import { FACTIONS, colorsOf, rankOf } from '../config/factions';
import { RENDER } from '../config/render';
import { lerp } from '../core/math';
import { drawWeapon } from './WeaponRenderer';
import { drawPawn, drawPawnShadow, lookSeed, pawnDir } from './PawnRenderer';
import { PAWN } from '../config/pawns';

/** Подпись роли: ГО и повстанцы — с рангом, жители — с номером CID. */
export function roleLabel(c: Character): string {
  const f = FACTIONS[c.faction];
  const r = rankOf(c.faction, c.rank);
  let s = r ? `${f.role} · ${r.short}` : c.faction === 'admin' ? f.role : `${f.role} · #${c.cid}`;
  if (c.division) s += ` · ${c.division.toUpperCase()}`;
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
      const look = { faction: c.faction, rank: c.rank, color: colorsOf(c.faction, c.rank).color, seed: lookSeed(c.id) };
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
      drawPawn(ctx, look, x, y, ps, dir);
      if (dir !== 'N') drawWeapon(ctx, c, x, y, s, reloading);
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
      ctx.fillStyle = r ? r.color : f.label;
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
