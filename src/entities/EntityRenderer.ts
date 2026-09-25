import type { Character } from './Character';
import type { View } from '../core/Camera';
import { FACTIONS, colorsOf, rankOf } from '../config/factions';
import { RENDER } from '../config/render';
import { lerp } from '../core/math';
import { WEAPONS } from '../config/items';

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
    for (const c of list) {
      if (!c.alive || (!c.visible && !showAll)) continue;
      const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
      const y = (lerp(c.prevY, c.y, alpha) - v.top) * s;
      const r = c.radius * s;
      if (x < -r * 3 || y < -r * 3 || x > v.width + r * 3 || y > v.height + r * 3) continue;
      const col = colorsOf(c.faction, c.rank);
      ctx.globalAlpha = c.visible ? 1 : 0.4;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(x + r * 0.18, y + r * 0.22, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, s * 1.5);
      ctx.strokeStyle = col.outline;
      ctx.stroke();
      // Нос-треугольник: куда смотрит.
      const cf = Math.cos(c.facing);
      const sf = Math.sin(c.facing);
      ctx.fillStyle = col.outline;
      ctx.beginPath();
      ctx.moveTo(x + cf * r * 1.32, y + sf * r * 1.32);
      ctx.lineTo(x + cf * r * 0.72 - sf * r * 0.42, y + sf * r * 0.72 + cf * r * 0.42);
      ctx.lineTo(x + cf * r * 0.72 + sf * r * 0.42, y + sf * r * 0.72 - cf * r * 0.42);
      ctx.closePath();
      ctx.fill();
      // Оружие в правой руке: силуэт по классу (длина и толщина), видно, кто чем вооружён.
      if (c.weapon) {
        const w = WEAPONS[c.weapon];
        const g = RENDER.weapons[w.class];
        const hx = x - sf * r * 0.42;
        const hy = y + cf * r * 0.42;
        ctx.strokeStyle = w.class === 'melee' ? RENDER.entity.stunstick : RENDER.entity.gun;
        ctx.lineWidth = Math.max(2, s * g.width);
        ctx.beginPath();
        ctx.moveTo(hx + cf * r * 0.2, hy + sf * r * 0.2);
        ctx.lineTo(hx + cf * r * g.len, hy + sf * r * g.len);
        ctx.stroke();
      }
      // Оглушён дубинкой — голубые искры.
      if (c.stunUntil > now) {
        ctx.strokeStyle = RENDER.entity.stun;
        ctx.lineWidth = Math.max(1, s * 1.2);
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = now * 9 + (k * Math.PI * 2) / 3;
          ctx.moveTo(x + Math.cos(a) * r * 1.1, y + Math.sin(a) * r * 1.1);
          ctx.lineTo(x + Math.cos(a + 0.5) * r * 1.35, y + Math.sin(a + 0.5) * r * 1.35);
        }
        ctx.stroke();
      }
      // Наручники.
      if (c.law.phase === 'cuffed' || c.law.phase === 'entering') {
        ctx.strokeStyle = 'rgba(230,230,230,0.9)';
        ctx.lineWidth = Math.max(1, s);
        ctx.beginPath();
        ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (c.isPlayer) {
        ctx.strokeStyle = RENDER.entity.playerRing;
        ctx.lineWidth = Math.max(1, s * 1.1);
        ctx.beginPath();
        ctx.arc(x, y, r + s * 3, 0, Math.PI * 2);
        ctx.stroke();
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
      const y = (lerp(c.prevY, c.y, alpha) - v.top) * s - c.radius * s - 4 * dpr;
      if (x < -200 || y < -60 || x > v.width + 200 || y > v.height + 60) continue;
      const f = FACTIONS[c.faction];
      const r = rankOf(c.faction, c.rank);
      ctx.globalAlpha = c.visible ? 1 : 0.5;
      ctx.font = scaleFont(E.roleFont, dpr);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = E.labelShadow;
      const role = roleLabel(c);
      ctx.strokeText(role, x, y);
      ctx.fillStyle = r ? r.color : f.label;
      ctx.fillText(role, x, y);
      ctx.font = scaleFont(E.nameFont, dpr);
      const ny = y - 11 * dpr;
      ctx.strokeText(c.name, x, ny);
      ctx.fillStyle = c.isPlayer ? E.playerNameColor : E.nameColor;
      ctx.fillText(c.name, x, ny);
      if (c.speech && c.speech.until > now) this.bubble(ctx, c.speech.text, x, ny - 14 * dpr, dpr);
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
