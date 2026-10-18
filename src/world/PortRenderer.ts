import type { View } from '../core/Camera';
import type { PortSystem } from '../systems/Port';
import { PORT_LOOK as L } from '../config/port';

/** Баржи порта: корпус с носом по ходу, палуба с контейнерами, рубка на корме, кильватерный след на ходу. */
export class PortRenderer {
  drawGround(ctx: CanvasRenderingContext2D, v: View, port: PortSystem, ts: number): void {
    const s = v.scale;
    for (const b of port.barges) {
      if (b.phase === 'away') continue;
      const vertical = b.heading === 'N' || b.heading === 'S';
      const beam = Math.min(b.berth.w!, b.berth.h!) * ts * 0.9;
      const len = Math.max(b.berth.w!, b.berth.h!) * ts;
      const w = (vertical ? beam : len) * s;
      const h = (vertical ? len : beam) * s;
      const cx = (b.x - v.left) * s;
      const cy = (b.y - v.top) * s;
      if (cx + w < 0 || cy + h < 0 || cx - w > v.width || cy - h > v.height) continue;
      const x = cx - w / 2;
      const y = cy - h / 2;
      // Направление носа (единичный вектор) и толщина «носовой» части.
      const fx = b.heading === 'E' ? 1 : b.heading === 'W' ? -1 : 0;
      const fy = b.heading === 'S' ? 1 : b.heading === 'N' ? -1 : 0;
      const bow = Math.min(w, h) * 0.6;
      if (b.moving) {
        ctx.fillStyle = L.wake;
        const wl = Math.min(w, h) * 1.4;
        if (vertical) ctx.fillRect(cx - w * 0.35, fy > 0 ? y - wl : y + h, w * 0.7, wl);
        else ctx.fillRect(fx > 0 ? x - wl : x + w, cy - h * 0.35, wl, h * 0.7);
      }
      // Корпус: прямоугольник без носа + треугольник носа.
      const hx = fx > 0 ? x : fx < 0 ? x + bow : x;
      const hy = fy > 0 ? y : fy < 0 ? y + bow : y;
      const hw = vertical ? w : w - bow;
      const hh = vertical ? h - bow : h;
      ctx.fillStyle = L.rim;
      ctx.fillRect(hx - 1, hy - 1, hw + 2, hh + 2);
      ctx.beginPath();
      if (fx > 0) { ctx.moveTo(x + w - bow - 1, y - 1); ctx.lineTo(x + w + 1, cy); ctx.lineTo(x + w - bow - 1, y + h + 1); }
      else if (fx < 0) { ctx.moveTo(x + bow + 1, y - 1); ctx.lineTo(x - 1, cy); ctx.lineTo(x + bow + 1, y + h + 1); }
      else if (fy > 0) { ctx.moveTo(x - 1, y + h - bow - 1); ctx.lineTo(cx, y + h + 1); ctx.lineTo(x + w + 1, y + h - bow - 1); }
      else { ctx.moveTo(x - 1, y + bow + 1); ctx.lineTo(cx, y - 1); ctx.lineTo(x + w + 1, y + bow + 1); }
      ctx.fill();
      ctx.fillStyle = L.hull;
      ctx.fillRect(hx, hy, hw, hh);
      ctx.fillStyle = L.deck;
      const inset = Math.max(2, Math.min(w, h) * 0.12);
      ctx.fillRect(hx + inset, hy + inset, hw - inset * 2, hh - inset * 2);
      // Рубка — на корме (против носа), контейнеры — от рубки к носу.
      const cab = Math.min(w, h) * 0.55;
      ctx.fillStyle = L.cabin;
      const sx = vertical ? cx - cab / 2 : fx > 0 ? hx + inset : hx + hw - inset - cab;
      const sy = vertical ? (fy > 0 ? hy + inset : hy + hh - inset - cab) : cy - cab / 2;
      ctx.fillRect(sx, sy, cab, cab);
      ctx.fillStyle = L.window;
      ctx.fillRect(sx + cab * 0.2, sy + cab * 0.2, cab * 0.6, cab * 0.25);
      const span = (vertical ? hh : hw) - cab - inset * 3;
      const n = 3;
      const box = span / n - 2;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = L.cargo[(b.berth.id ?? 0) + k] ?? L.cargo[k % L.cargo.length];
        const along = k * (box + 2) + inset * 2 + cab;
        const bw = Math.min(w, h) * 0.62;
        if (vertical) ctx.fillRect(cx - bw / 2, fy > 0 ? hy + along : hy + hh - along - box, bw, box);
        else ctx.fillRect(fx > 0 ? hx + along : hx + hw - along - box, cy - bw / 2, box, bw);
      }
    }
  }
}
