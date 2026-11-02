import type { View } from '../core/Camera';
import type { Light } from './Lighting';
import { Rng } from '../core/rng';
import { COZY } from '../config/lighting';

/**
 * Уют поверх картинки (только отрисовка, своя случайность — не игровая): дымок из труб на крышах
 * (сносит ветром, расплывается), пылинки, кружащие в свете фонарей ночью, светлячки у зелени тёмной ночью,
 * плёночное зерно. Массивы фиксированного размера, без save/restore и сборки строк на кадр. Что рисовать —
 * по настройкам атмосферы (world/atmosphere.ts).
 */
export class Ambience {
  enabled = true;
  smoke = true;
  motes = true;
  fireflies = true;
  grain = true;
  /** Деревья, сады и клумбы (px мира) — у них светлячки. */
  private greens: { x: number; y: number; seed: number }[] = [];
  private readonly fireflyStyle = `rgb(${COZY.fireflies.color})`;
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
  private grainTex: HTMLCanvasElement | null = null;
  private pattern: CanvasPattern | null = null;
  private frame = 0;
  private gx = 0;
  private gy = 0;
  private puff: HTMLCanvasElement | null = null;
  private readonly moteStyle = `rgb(${COZY.motes.color})`;

  /** Зелень для светлячков: деревья, сады, клумбы (px мира). */
  setGreens(points: readonly { x: number; y: number }[]): void {
    this.greens = points.map((p, i) => ({ x: p.x, y: p.y, seed: i * 7.31 + 1.7 }));
  }

  setWorld(chimneys: { x: number; y: number }[]): void {
    this.chimneys = chimneys;
    this.acc.length = chimneys.length;
    this.acc.fill(0);
    this.count = 0;
  }

  /** Дымок: рождается у труб на экране (чаще в темноте — топят печи), летит по ветру, тает. */
  update(v: View, dt: number, dark: number): void {
    if (!this.enabled || !this.smoke) {
      this.count = 0;
      return;
    }
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

  /** Клуб дыма: мягкое пятно (плотная середина, прозрачный край) — одна картинка на все частицы. */
  private puffSprite(): HTMLCanvasElement {
    if (this.puff) return this.puff;
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    grad.addColorStop(0, `rgba(${COZY.smoke.color},1)`);
    grad.addColorStop(0.45, `rgba(${COZY.smoke.color},0.7)`);
    grad.addColorStop(1, `rgba(${COZY.smoke.color},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 48, 48);
    this.puff = c;
    return c;
  }

  /** Дымок из труб (до карты света — ночью он тёмный, у фонарей — подсвечен): мягкие клубы, тают к краю. */
  drawSmoke(ctx: CanvasRenderingContext2D, v: View): void {
    if (!this.enabled || !this.smoke || this.count === 0) return;
    const S = COZY.smoke;
    const s = v.scale;
    const img = this.puffSprite();
    for (let i = 0; i < this.count; i++) {
      const t = 1 - this.life[i] / this.max[i];
      const x = (this.x[i] - v.left) * s;
      const y = (this.y[i] - v.top) * s;
      const r = this.size[i] * (0.7 + t * 2.2) * s;
      if (x < -r || y < -r || x > v.width + r || y > v.height + r) continue;
      // Проявляется быстро, тает медленно.
      ctx.globalAlpha = S.alpha * Math.min(1, t * 6) * (1 - t);
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  /** Пылинки, кружащие в свете горящих фонарей (поверх света, светятся). */
  drawMotes(ctx: CanvasRenderingContext2D, v: View, lights: readonly Light[], lamps: number, time: number): void {
    if (!this.enabled || !this.motes || lamps <= 0.05) return;
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
   * Светлячки у зелени тёмной ночью (dark — насколько темно): кружат у дерева или клумбы, мигают; светятся
   * (сложением, поверх света суток). Не больше maxSpots мест на экране.
   */
  drawFireflies(ctx: CanvasRenderingContext2D, v: View, dark: number, time: number): void {
    const F = COZY.fireflies;
    if (!this.enabled || !this.fireflies || dark < F.dark || !this.greens.length) return;
    const s = v.scale;
    const R = F.radius;
    const fade = Math.min(1, (dark - F.dark) / 0.15);
    const size = Math.max(1, F.size * s);
    const pad = R * s + 8;
    let spots = 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = this.fireflyStyle;
    for (const g of this.greens) {
      const cx = (g.x - v.left) * s;
      const cy = (g.y - v.top) * s;
      if (cx < -pad || cy < -pad || cx > v.width + pad || cy > v.height + pad) continue;
      if (++spots > F.maxSpots) break;
      for (let m = 0; m < F.perSpot; m++) {
        const a = g.seed + m * 2.9;
        const px = cx + Math.sin(time * 0.31 + a) * R * s * Math.cos(time * 0.17 + a * 0.7);
        const py = cy + Math.sin(time * 0.23 + a * 1.9) * R * 0.8 * s - 4 * s;
        // Мигают: длинные паузы, короткая вспышка.
        const blink = Math.max(0, Math.sin(time * 1.3 + a * 3.1));
        const al = F.alpha * fade * blink * blink * blink;
        if (al < 0.03) continue;
        ctx.globalAlpha = al * 0.35;
        ctx.fillRect(px - size, py - size, size * 3, size * 3);
        ctx.globalAlpha = al;
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
    if (!this.enabled || !this.grain) return;
    const G = COZY.grain;
    if (!this.grainTex) {
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
      this.grainTex = c;
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
