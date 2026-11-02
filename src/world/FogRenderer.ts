import type { View } from '../core/Camera';
import type { VisibilityPolygon } from './visibility';
import { VISION } from '../config/vision';

/**
 * Туман войны: затемнение всего экрана, кроме области видимости. Карта в тени видна
 * (затемнённой), персонажи в тени не рисуются вовсе.
 *
 * Мягкий край: туман рисуется в маленькую маску (клетка VISION.soft.cell px мира) — залить цветом тумана, стереть
 * многоугольник обзора радиальным градиентом (до fadeStart — целиком, к краю радиуса — на нет) с размытием
 * (VISION.soft.blur px мира), — и одной картинкой растягивается на экран со сглаживанием. Тени за углами и край
 * обзора — плавные, а не ступенька по многоугольнику. Маска крошечная (~200×120), дорого только растяжение на экран
 * (в программной отрисовке без видеокарты — около 1 мс сверх прежних двух заливок).
 */
export class FogRenderer {
  private mask: HTMLCanvasElement | null = null;
  private mctx: CanvasRenderingContext2D | null = null;
  /** Размытие холста (ctx.filter) есть не везде: нет — край мягкий только от растяжения маски. */
  private blurOk = false;

  /**
   * holes — добавляет в путь прямоугольники, которых туман не касается (крыши домов: их видно и за углом — камера
   * сверху); прямоугольники не пересекаются, вырезаются правилом evenodd. Крыши — чёткие, мягкий только край обзора.
   */
  draw(target: CanvasRenderingContext2D, v: View, poly: VisibilityPolygon, cx: number, cy: number, radius: number = VISION.radius, color: string = VISION.fogColor, holes: ((ctx: CanvasRenderingContext2D) => void) | null = null): void {
    const ctx = target;
    const m = this.paintMask(v, poly, cx, cy, radius, color);
    if (holes) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, v.width, v.height);
      holes(ctx);
      ctx.clip('evenodd');
    }
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(m.canvas, 0, 0, m.w, m.h, -m.pad / m.k, -m.pad / m.k, m.w / m.k, m.h / m.k);
    ctx.imageSmoothingEnabled = smooth;
    if (holes) ctx.restore();
  }

  /** Маска тумана в клетках VISION.soft.cell px мира; k — пикселей маски на пиксель экрана, pad — поле маски. */
  private paintMask(v: View, poly: VisibilityPolygon, cx: number, cy: number, radius: number, color: string): { canvas: HTMLCanvasElement; w: number; h: number; k: number; pad: number } {
    const S = VISION.soft;
    const k = 1 / (S.cell * v.scale);
    const blur = S.blur / S.cell;
    // Поле: размытие у края маски тянет туман внутрь — край маски уводим за экран.
    const pad = Math.ceil(blur * 3) + 2;
    const w = Math.ceil(v.width * k) + pad * 2;
    const h = Math.ceil(v.height * k) + pad * 2;
    if (!this.mask) {
      this.mask = document.createElement('canvas');
      this.mctx = this.mask.getContext('2d')!;
      this.mctx.filter = 'blur(1px)';
      this.blurOk = this.mctx.filter === 'blur(1px)';
      this.mctx.filter = 'none';
    }
    const mask = this.mask;
    const g = this.mctx!;
    if (mask.width < w || mask.height < h) {
      mask.width = Math.max(mask.width, w);
      mask.height = Math.max(mask.height, h);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const p = poly.points;
    if (p.length >= 6) {
      // Экранные координаты → маска: (экран · k) + pad.
      const s = v.scale * k;
      const ox = pad - v.left * s;
      const oy = pad - v.top * s;
      g.globalCompositeOperation = 'destination-out';
      if (this.blurOk && blur > 0.05) g.filter = `blur(${blur.toFixed(2)}px)`;
      const sx = cx * s + ox;
      const sy = cy * s + oy;
      const r = radius * s;
      const grad = g.createRadialGradient(sx, sy, r * VISION.fadeStart, sx, sy, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(p[0] * s + ox, p[1] * s + oy);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] * s + ox, p[i + 1] * s + oy);
      g.closePath();
      g.fill();
      g.filter = 'none';
    }
    g.globalCompositeOperation = 'source-over';
    return { canvas: mask, w, h, k, pad };
  }
}
