import type { View } from '../core/Camera';
import type { Character } from '../entities/Character';
import type { NavGrid } from '../world/NavGrid';
import { lerp } from '../core/math';

/**
 * Отладка (F3): пути NPC, их состояния, кто кому мешает/уступает, проходимые якоря около игрока.
 */
export class DebugOverlay {
  enabled = false;

  draw(ctx: CanvasRenderingContext2D, v: View, list: readonly Character[], nav: NavGrid, player: Character, alpha: number, dpr: number): void {
    if (!this.enabled) return;
    const s = v.scale;
    const sx = (x: number) => (x - v.left) * s;
    const sy = (y: number) => (y - v.top) * s;

    // Якоря 2×2 вокруг игрока: зелёный — проходим, серый — узкий (дороже для A*).
    const ax0 = Math.max(0, Math.floor(v.left / nav.ts) - 1);
    const ay0 = Math.max(0, Math.floor(v.top / nav.ts) - 1);
    const ax1 = Math.min(nav.w - 1, Math.ceil((v.left + v.width / s) / nav.ts));
    const ay1 = Math.min(nav.h - 1, Math.ceil((v.top + v.height / s) / nav.ts));
    for (let ay = ay0; ay <= ay1; ay++) {
      for (let ax = ax0; ax <= ax1; ax++) {
        const i = ay * nav.w + ax;
        if (!nav.walk[i]) continue;
        ctx.fillStyle = nav.cost[i] > 1 ? 'rgba(200,200,200,0.35)' : 'rgba(90,220,120,0.35)';
        ctx.fillRect(sx((ax + 1) * nav.ts) - dpr, sy((ay + 1) * nav.ts) - dpr, 2 * dpr, 2 * dpr);
      }
    }

    ctx.font = `${10 * dpr}px monospace`;
    ctx.textAlign = 'center';
    for (const c of list) {
      const m = c.brain?.mover;
      if (!m) continue;
      const x = sx(lerp(c.prevX, c.x, alpha));
      const y = sy(lerp(c.prevY, c.y, alpha));
      if (m.status === 'moving' && m.path.length > 0) {
        ctx.strokeStyle = 'rgba(120,200,255,0.55)';
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = m.wp; k < m.path.length; k++) ctx.lineTo(sx(m.path[k].x), sy(m.path[k].y));
        ctx.stroke();
      }
      if (m.blocker) {
        ctx.strokeStyle = m.yieldFrom ? 'rgba(255,210,80,0.9)' : 'rgba(255,80,80,0.9)';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(sx(m.blocker.x), sy(m.blocker.y));
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(180,230,255,0.95)';
      ctx.fillText(c.brain!.stateName, x, y + (c.radius * s) + 12 * dpr);
    }
    ctx.fillStyle = 'rgba(255,211,107,0.9)';
    ctx.fillText(`${Math.floor(player.x / nav.ts)},${Math.floor(player.y / nav.ts)}`, sx(player.x), sy(player.y) + player.radius * s + 12 * dpr);
  }
}
