import type { View } from '../core/Camera';
import type { VisibilityPolygon } from './visibility';
import { VISION } from '../config/vision';

/**
 * Туман войны: затемняющий слой на весь экран, из которого «вырезана» область видимости.
 * Карта в тени видна (затемнённой), персонажи в тени не рисуются вовсе.
 */
export class FogRenderer {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;

  draw(target: CanvasRenderingContext2D, v: View, poly: VisibilityPolygon, cx: number, cy: number): void {
    if (this.canvas.width !== v.width || this.canvas.height !== v.height) {
      this.canvas.width = v.width;
      this.canvas.height = v.height;
    }
    const ctx = this.ctx;
    const s = v.scale;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, v.width, v.height);
    ctx.fillStyle = VISION.fogColor;
    ctx.fillRect(0, 0, v.width, v.height);
    ctx.globalCompositeOperation = 'destination-out';
    const sx = (cx - v.left) * s;
    const sy = (cy - v.top) * s;
    const r = VISION.radius * s;
    const g = ctx.createRadialGradient(sx, sy, r * VISION.fadeStart, sx, sy, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    const p = poly.points;
    ctx.beginPath();
    ctx.moveTo((p[0] - v.left) * s, (p[1] - v.top) * s);
    for (let k = 2; k < p.length; k += 2) ctx.lineTo((p[k] - v.left) * s, (p[k + 1] - v.top) * s);
    ctx.closePath();
    ctx.fill();
    target.drawImage(this.canvas, 0, 0);
  }
}
