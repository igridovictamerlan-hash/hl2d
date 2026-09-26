import type { View } from '../core/Camera';
import type { VisibilityPolygon } from './visibility';
import { VISION } from '../config/vision';

/**
 * Туман войны: затемнение всего экрана, кроме области видимости. Карта в тени видна
 * (затемнённой), персонажи в тени не рисуются вовсе.
 *
 * Рисуется прямо на экран двумя заливками, без промежуточного холста на весь экран (его очистка,
 * заливка и копирование каждый кадр заметно роняли FPS): 1) всё вне многоугольника обзора
 * (прямоугольник экрана + многоугольник, правило evenodd) — цветом тумана; 2) сам многоугольник —
 * радиальным градиентом от прозрачного (до fadeStart) к цвету тумана на краю радиуса обзора.
 */
export class FogRenderer {
  draw(target: CanvasRenderingContext2D, v: View, poly: VisibilityPolygon, cx: number, cy: number, radius: number = VISION.radius, color: string = VISION.fogColor): void {
    const ctx = target;
    const s = v.scale;
    const p = poly.points;
    const trace = () => {
      ctx.moveTo((p[0] - v.left) * s, (p[1] - v.top) * s);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo((p[k] - v.left) * s, (p[k + 1] - v.top) * s);
      ctx.closePath();
    };
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(0, 0, v.width, v.height);
    if (p.length >= 6) trace();
    ctx.fill('evenodd');
    if (p.length < 6) return;
    const sx = (cx - v.left) * s;
    const sy = (cy - v.top) * s;
    const r = radius * s;
    const g = ctx.createRadialGradient(sx, sy, r * VISION.fadeStart, sx, sy, r);
    g.addColorStop(0, transparent(color));
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath();
    trace();
    ctx.fill();
  }
}

/** Тот же цвет с нулевой прозрачностью (иначе градиент к «transparent» темнеет посередине). */
function transparent(color: string): string {
  const m = /^rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(color.replace(/\s/g, ''));
  return m ? `rgba(${m[1]},${m[2]},${m[3]},0)` : 'rgba(0,0,0,0)';
}
