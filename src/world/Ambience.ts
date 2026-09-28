import type { View } from '../core/Camera';
import type { Light } from './Lighting';
import { Rng } from '../core/rng';
import { COZY } from '../config/lighting';

/**
 * Уют поверх картинки (только отрисовка, своя случайность — не игровая): дымок из труб на крышах
 * (сносит ветром, расплывается), пылинки, кружащие в свете фонарей ночью, плёночное зерно.
 * Массивы фиксированного размера, без save/restore и сборки строк на кадр.
 */
export class Ambience {
  enabled = true;
  /** Упрощённо (слабая машина): без зерна и пылинок, дымок остаётся. */
  lite = false;
  private readonly rng = new Rng(0xc0ffee);
  private chimneys: { x: number; y: number }[] = [];
  private readonly n = COZY.smoke.max;
  private readonly x = new Float32Array(this.n);
  private readonly y = new Float32Array(this.n);
  private readonly vx = new Float32Array(this.n);
  private readonly vy = new Float32Array(this.n);
  private readonly life = new Float32Array(this.n);
  private readonly max = new Float32Array(this.n);
  private readonly size = new Float32Array(this.n);
  private count = 0;
  private readonly acc: number[] = [];
  private grain: HTMLCanvasElement | null = null;
  private pattern: CanvasPattern | null = null;
  private frame = 0;
  private gx = 0;
  private gy = 0;
  private readonly smokeStyle = `rgb(${COZY.smoke.color})`;
  private readonly moteStyle = `rgb(${COZY.motes.color})`;

  setWorld(chimneys: { x: number; y: number }[]): void {
    this.chimneys = chimneys;
    this.acc.length = chimneys.length;
    this.acc.fill(0);
    this.count = 0;
  }

  /** Дымок: рождается у труб на экране (чаще в темноте — топят печи), летит по ветру, тает. */
  update(v: View, dt: number, dark: number): void {
    if (!this.enabled) return;
    const S = COZY.smoke;
    const r = this.rng;
    // Старые частицы.
    let k = 0;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      this.x[k] = this.x[i] + this.vx[i] * dt;
      this.y[k] = this.y[i] + this.vy[i] * dt;
      this.vx[k] = this.vx[i];
      this.vy[k] = this.vy[i];
      this.life[k] = life;
      this.max[k] = this.max[i];
      this.size[k] = this.size[i];
      k++;
    }
    this.count = k;
    const pad = 80;
    const rate = S.perSec * (1 + (S.nightMul - 1) * dark) * dt;
    for (let c = 0; c < this.chimneys.length; c++) {
      const ch = this.chimneys[c];
      const sx = (ch.x - v.left) * v.scale;
      const sy = (ch.y - v.top) * v.scale;
      if (sx < -pad || sy < -pad || sx > v.width + pad || sy > v.height + pad) continue;
      this.acc[c] += rate;
      while (this.acc[c] >= 1) {
        this.acc[c] -= 1;
        if (this.count >= this.n) break;
        const i = this.count++;
        this.x[i] = ch.x + r.range(-2, 2);
        this.y[i] = ch.y + r.range(-2, 2);
        this.vx[i] = S.wind[0] + r.range(-2, 2);
        this.vy[i] = S.wind[1] - S.rise + r.range(-2, 2);
        this.max[i] = this.life[i] = r.range(S.life[0], S.life[1]);
        this.size[i] = r.range(S.size[0], S.size[1]);
      }
    }
  }

  /** Дымок из труб (до карты света — ночью он тёмный, у фонарей — подсвечен). */
  drawSmoke(ctx: CanvasRenderingContext2D, v: View): void {
    if (!this.enabled || this.count === 0) return;
    const S = COZY.smoke;
    const s = v.scale;
    ctx.fillStyle = this.smokeStyle;
    for (let i = 0; i < this.count; i++) {
      const t = 1 - this.life[i] / this.max[i];
      const x = (this.x[i] - v.left) * s;
      const y = (this.y[i] - v.top) * s;
      const r = this.size[i] * (0.6 + t * 1.8) * s;
      if (x < -r || y < -r || x > v.width + r || y > v.height + r) continue;
      // Проявляется быстро, тает медленно.
      ctx.globalAlpha = S.alpha * Math.min(1, t * 6) * (1 - t);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Пылинки, кружащие в свете горящих фонарей (поверх света, светятся). */
  drawMotes(ctx: CanvasRenderingContext2D, v: View, lights: readonly Light[], lamps: number, time: number): void {
    if (!this.enabled || this.lite || lamps <= 0.05) return;
    const M = COZY.motes;
    const s = v.scale;
    const R = M.radius;
    const size = Math.max(1, M.size * s);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = this.moteStyle;
    for (const L of lights) {
      if (!L.night || !L.bloom) continue;
      const cx = (L.x - v.left) * s;
      const cy = (L.y - v.top) * s;
      if (cx < -60 || cy < -60 || cx > v.width + 60 || cy > v.height + 60) continue;
      for (let m = 0; m < M.perLamp; m++) {
        const a = L.seed * 1.7 + m * 2.3;
        const px = cx + Math.sin(time * 0.45 + a) * R * s * Math.cos(time * 0.21 + a * 0.5);
        const py = cy + Math.cos(time * 0.37 + a * 1.3) * R * 0.7 * s;
        ctx.globalAlpha = M.alpha * lamps * (0.5 + 0.5 * Math.sin(time * 2.1 + a));
        ctx.fillRect(px, py, size, size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Плёночное зерно: тайл шума (светлые и тёмные точки с малой прозрачностью) со сдвигом раз в два
   * кадра, обычным наложением — самый дешёвый способ смешивания на весь экран.
   */
  drawGrain(ctx: CanvasRenderingContext2D, v: View): void {
    if (!this.enabled || this.lite) return;
    const G = COZY.grain;
    if (!this.grain) {
      const c = document.createElement('canvas');
      c.width = c.height = G.size;
      const g = c.getContext('2d')!;
      const img = g.createImageData(G.size, G.size);
      const r = new Rng(0x5eed);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = r.next() - 0.5;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = n > 0 ? 255 : 0;
        img.data[i + 3] = Math.round(Math.abs(n) * 2 * 255);
      }
      g.putImageData(img, 0, 0);
      this.grain = c;
      this.pattern = ctx.createPattern(c, 'repeat');
    }
    if (!this.pattern) return;
    if ((this.frame++ & 1) === 0) {
      this.gx = Math.floor(this.rng.next() * G.size);
      this.gy = Math.floor(this.rng.next() * G.size);
    }
    ctx.globalAlpha = G.alpha;
    ctx.fillStyle = this.pattern;
    ctx.setTransform(1, 0, 0, 1, -this.gx, -this.gy);
    ctx.fillRect(this.gx, this.gy, v.width, v.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }
}
