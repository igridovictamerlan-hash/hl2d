import type { Character } from './Character';
import type { View } from '../core/Camera';
import { FACTIONS } from '../config/factions';
import { RENDER } from '../config/render';
import { lerp } from '../core/math';

/**
 * Кружки персонажей и подписи над ними (имя + роль). Подписи рисуются в экранных пикселях —
 * они чёткие и одного размера при любом масштабе.
 */
export class EntityRenderer {
  draw(ctx: CanvasRenderingContext2D, v: View, list: readonly Character[], alpha: number, dpr: number): void {
    const s = v.scale;
    // Сначала кружки, потом подписи — подписи всегда поверх.
    for (const c of list) {
      if (!c.alive) continue;
      const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
      const y = (lerp(c.prevY, c.y, alpha) - v.top) * s;
      const r = c.radius * s;
      if (x < -r * 3 || y < -r * 3 || x > v.width + r * 3 || y > v.height + r * 3) continue;
      const f = FACTIONS[c.faction];
      // Тень.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(x + r * 0.18, y + r * 0.22, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, s * 1.5);
      ctx.strokeStyle = f.outline;
      ctx.stroke();
      // Направление взгляда.
      ctx.fillStyle = f.outline;
      ctx.beginPath();
      ctx.arc(x + Math.cos(c.facing) * r * 0.62, y + Math.sin(c.facing) * r * 0.62, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      if (c.isPlayer) {
        ctx.strokeStyle = RENDER.entity.playerRing;
        ctx.lineWidth = Math.max(1, s * 1.1);
        ctx.beginPath();
        ctx.arc(x, y, r + s * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const E = RENDER.entity;
    for (const c of list) {
      if (!c.alive) continue;
      const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
      const y = (lerp(c.prevY, c.y, alpha) - v.top) * s - c.radius * s - 4 * dpr;
      if (x < -200 || y < -40 || x > v.width + 200 || y > v.height + 60) continue;
      const f = FACTIONS[c.faction];
      ctx.font = scaleFont(E.roleFont, dpr);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = E.labelShadow;
      const role = `${f.role} · #${c.cid}`;
      ctx.strokeText(role, x, y);
      ctx.fillStyle = f.label;
      ctx.fillText(role, x, y);
      ctx.font = scaleFont(E.nameFont, dpr);
      const ny = y - 11 * dpr;
      ctx.strokeText(c.name, x, ny);
      ctx.fillStyle = c.isPlayer ? E.playerNameColor : E.nameColor;
      ctx.fillText(c.name, x, ny);
    }
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
