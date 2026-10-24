import type { View } from '../core/Camera';
import type { Dugout, Dugouts } from '../systems/Dugouts';
import { DUGOUT_LOOK as L } from '../config/dugout';
import { WAR } from '../config/war';
import { T } from './tiles';
import type { GameMap } from './GameMap';

/** Целочисленный хеш двух координат (псевдослучайность по месту, без состояния и Rng). */
function hash(x: number, y: number, k: number): number {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Передовые блиндажи повстанцев на экране (только отрисовка): койки, ящик со штабелем по запасу, фонарь внутри; разрушенный
 * блиндаж — копоть на срубе и полу, обломки, дымок, мигающий заряд легионеров у входа. Без save/restore и сборки строк на кадр.
 */
export class DugoutRenderer {
  drawGround(ctx: CanvasRenderingContext2D, v: View, D: Dugouts, map: GameMap): void {
    if (!D.list.length) return;
    const ts = map.tileSize;
    for (const d of D.list) {
      const pad = ts * 3;
      const x0 = (d.rect.x - 1) * ts;
      const y0 = (d.rect.y - 1) * ts;
      const x1 = (d.rect.x + d.rect.w + 1) * ts;
      const y1 = (d.rect.y + d.rect.h + 1) * ts;
      if (x1 + pad < v.left || y1 + pad < v.top || x0 - pad > v.left + v.width / v.scale || y0 - pad > v.top + v.height / v.scale) continue;
      if (d.owner === 'ruined') this.ruined(ctx, v, d, map, D.now);
      else this.interior(ctx, v, d);
      if (d.raiders.length && d.charge > 0) this.charge(ctx, v, d, D.now);
    }
  }

  /** Койки, ящик и фонарь целого блиндажа. */
  private interior(ctx: CanvasRenderingContext2D, v: View, d: Dugout): void {
    const s = v.scale;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    const B = L.bunk;
    ctx.lineWidth = Math.max(1, s * 0.8);
    ctx.strokeStyle = L.outline;
    for (const k of d.bunks) {
      const x = X(k.x) - (B.w * s) / 2;
      const y = Y(k.y) - (B.h * s) / 2;
      ctx.fillStyle = B.frame;
      ctx.fillRect(x - s, y - s, (B.w + 2) * s, (B.h + 2) * s);
      ctx.fillStyle = B.mattress;
      ctx.fillRect(x, y, B.w * s, B.h * s);
      ctx.fillStyle = k.user ? B.blanketUsed : B.blanket;
      ctx.fillRect(x, y + B.h * s * 0.32, B.w * s, B.h * s * 0.68);
      ctx.fillStyle = B.pillow;
      ctx.fillRect(x + B.w * s * 0.12, y + B.h * s * 0.06, B.w * s * 0.76, B.h * s * 0.22);
      ctx.strokeRect(x - s, y - s, (B.w + 2) * s, (B.h + 2) * s);
    }
    this.crates(ctx, X(d.cache.x), Y(d.cache.y), s, d);
    // Фонарь посреди землянки.
    const Lt = L.lantern;
    const lx = X(d.x);
    const ly = Y(d.y);
    ctx.fillStyle = Lt.body;
    ctx.beginPath();
    ctx.arc(lx, ly, Lt.r * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = Lt.glass;
    ctx.beginPath();
    ctx.arc(lx, ly, Lt.r * s * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Ящик и штабель: чем больше комплектов, тем выше штабель; рядом ящик с гранатами. */
  private crates(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, d: Dugout): void {
    const C = L.crate;
    const n = Math.min(C.stackMax, Math.ceil(d.kits / C.stackPer));
    const w = C.w * s;
    const h = C.h * s;
    ctx.lineWidth = Math.max(1, s * 0.7);
    ctx.strokeStyle = L.outline;
    if (n === 0) {
      ctx.fillStyle = C.empty;
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    }
    for (let i = 0; i < n; i++) {
      // Штабель в два ряда: нижние рядом, верхние — выше и чуть в сторону.
      const row = i % 2;
      const lvl = Math.floor(i / 2);
      const x = cx - w / 2 + (row ? w * 0.5 : -w * 0.1);
      const y = cy - h / 2 - lvl * h * 0.55 + (row ? h * 0.12 : 0);
      ctx.fillStyle = C.body;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = C.lid;
      ctx.fillRect(x, y, w, h * 0.3);
      ctx.fillStyle = C.mark;
      ctx.fillRect(x + w * 0.4, y + h * 0.5, w * 0.2, h * 0.2);
      ctx.strokeRect(x, y, w, h);
    }
    if (d.grenades > 0) {
      const gw = w * 0.7;
      const gh = h * 0.8;
      const gx = cx - w / 2 - gw - s;
      const gy = cy - gh / 2 + h * 0.25;
      ctx.fillStyle = C.grenade;
      ctx.fillRect(gx, gy, gw, gh);
      ctx.fillStyle = C.grenadeMark;
      ctx.fillRect(gx + gw * 0.4, gy + gh * 0.15, gw * 0.2, gh * 0.7);
      ctx.strokeRect(gx, gy, gw, gh);
    }
  }

  /** Разрушенный блиндаж: копоть, обломки, пятно взрыва, дымок. */
  private ruined(ctx: CanvasRenderingContext2D, v: View, d: Dugout, map: GameMap, time: number): void {
    const R = L.ruin;
    const s = v.scale;
    const ts = map.tileSize;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    const r = d.rect;
    // Копоть по полу и по срубу кольца.
    for (let ty = r.y - 1; ty <= r.y + r.h; ty++) {
      for (let tx = r.x - 1; tx <= r.x + r.w; tx++) {
        const t = map.tileAt(tx, ty);
        const wall = t === T.DUGOUT_WALL;
        if (!wall && t !== T.DUGOUT) continue;
        const px = X(tx * ts);
        const py = Y(ty * ts);
        const w = ts * s;
        ctx.fillStyle = wall ? R.wallSoot : R.soot;
        ctx.fillRect(px, py, w, w);
        if (wall) {
          // Расщеплённое бревно: светлая щепа и обугленный торец, у каждого тайла свои.
          const a = hash(tx, ty, 1);
          const b = hash(tx, ty, 2);
          ctx.fillStyle = R.charred;
          ctx.fillRect(px + w * (0.1 + 0.5 * a), py + w * (0.15 + 0.5 * b), w * 0.3, w * 0.22);
          ctx.fillStyle = R.splinter;
          ctx.fillRect(px + w * (0.5 + 0.3 * b), py + w * (0.1 + 0.6 * a), w * 0.1, w * 0.3);
          ctx.fillRect(px + w * (0.1 + 0.3 * a), py + w * (0.6 + 0.2 * b), w * 0.3, w * 0.08);
        }
      }
    }
    // Пятно взрыва в середине и обломки по полу.
    const cx = X(d.x);
    const cy = Y(d.y);
    const rad = Math.max(r.w, r.h) * ts * 0.5 * s;
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = R.scorch;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * (1 - k * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = Math.max(1, s * 1.6);
    for (let i = 0; i < R.debris; i++) {
      const a = hash(r.x, r.y, 10 + i) * Math.PI * 2;
      const dist = hash(r.x, r.y, 40 + i) * (Math.max(r.w, r.h) * ts * 0.55 + ts * 0.6);
      const len = (2 + hash(r.x, r.y, 70 + i) * 4) * s;
      const ang = hash(r.x, r.y, 100 + i) * Math.PI;
      const px = cx + Math.cos(a) * dist * s;
      const py = cy + Math.sin(a) * dist * s;
      ctx.strokeStyle = i % 3 === 0 ? R.splinter : R.charred;
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(ang) * len, py - Math.sin(ang) * len);
      ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    }
    // Дымок поднимается, пока свежо.
    const age = time - d.ruinedAt;
    if (age >= 0 && age < R.smokeTime) {
      const fade = 1 - age / R.smokeTime;
      ctx.globalAlpha = fade;
      ctx.fillStyle = R.smoke;
      for (let i = 0; i < R.smokePuffs; i++) {
        const ph = (time * 0.35 + i / R.smokePuffs) % 1;
        const sx = cx + Math.sin(time * 0.8 + i * 2.1) * 4 * s;
        const sy = cy - ph * R.smokeRise * s;
        ctx.beginPath();
        ctx.arc(sx, sy, (3 + ph * 7) * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Заряд у входа: красная точка мигает, пока легионеры его закладывают. */
  private charge(ctx: CanvasRenderingContext2D, v: View, d: Dugout, time: number): void {
    const C = L.charge;
    if (Math.floor(time * C.rate * 2) % 2 !== 0) return;
    const s = v.scale;
    ctx.fillStyle = C.color;
    ctx.beginPath();
    ctx.arc((d.door.x - v.left) * s, (d.door.y - v.top) * s, C.r * s * (0.6 + 0.4 * Math.min(1, d.charge / WAR.dugout.sortie.blowTime)), 0, Math.PI * 2);
    ctx.fill();
  }
}
