import type { GameMap } from './GameMap';
import type { View } from '../core/Camera';
import { T, SOLID } from './tiles';
import { hash2, hash01 } from '../core/rng';
import { RENDER } from '../config/render';

/**
 * Цвет HSL → '#rrggbb'. Цвета тайлов считаются один раз при загрузке, а разбираются браузером при
 * каждой заливке (тысячи раз за кадр) — короткий hex разбирается заметно быстрее строки hsl().
 */
const hsl = (h: number, s: number, l: number): string => {
  const S = Math.max(0, Math.min(100, s)) / 100;
  const L = Math.max(0, Math.min(100, l)) / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map((c) => c.toString(16).padStart(2, '0')).join('');
};

/**
 * Отрисовка тайлов. Каждый кадр рисуются только видимые тайлы (~52×35 при масштабе 820×550),
 * координаты округляются в пространстве экрана — без щелей между тайлами и без размытия.
 * Цвета и маски соседей считаются один раз при загрузке карты.
 */
export class MapRenderer {
  private readonly color: string[];
  /** Для стен — биты соседей-пола (N=1,E=2,S=4,W=8); для пола — биты соседей-стен (+16 = стена по диагонали СЗ). */
  private readonly edges: Uint8Array;
  private readonly parcel: Int32Array;
  private readonly noise: Uint32Array;
  private xs = new Float64Array(0);
  private ys = new Float64Array(0);

  constructor(private readonly map: GameMap) {
    const { width: w, height: h } = map;
    const n = w * h;
    this.color = new Array<string>(n);
    this.edges = new Uint8Array(n);
    this.parcel = new Int32Array(n);
    this.noise = new Uint32Array(n);
    const seed = map.seed | 0;
    this.buildParcels(seed);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.computeTile(x, y);
  }

  private readonly roofColor = new Map<number, [number, number, number]>();

  /** Пересчитать тайл и соседей (игрок поставил/убрал блок). */
  refresh(tx: number, ty: number): void {
    for (let y = ty - 1; y <= ty + 1; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) if (this.map.inBounds(x, y)) this.computeTile(x, y);
    }
  }

  /** Цвет и маска соседей одного тайла. */
  private computeTile(x: number, y: number): void {
    const map = this.map;
    const seed = map.seed | 0;
    const P = RENDER.tiles;
    const i = y * map.width + x;
    const t = map.tiles[i];
    const hv = hash2(x, y, seed);
    this.noise[i] = hv;
    const jit = (hv / 4294967296 - 0.5) * 2;
    const solid = SOLID[t] === 1;
    let e = 0;
    const nb = (dx: number, dy: number) => map.isSolid(x + dx, y + dy);
    if (solid) {
      if (!nb(0, -1)) e |= 1;
      if (!nb(1, 0)) e |= 2;
      if (!nb(0, 1)) e |= 4;
      if (!nb(-1, 0)) e |= 8;
    } else {
      if (nb(0, -1)) e |= 1;
      if (nb(1, 0)) e |= 2;
      if (nb(0, 1)) e |= 4;
      if (nb(-1, 0)) e |= 8;
      if (nb(-1, -1)) e |= 16;
    }
    this.edges[i] = e;
    const tone = (c: { h: number; s: number; l: number; noise: number }) => hsl(c.h, c.s, c.l + jit * c.noise);
    switch (t) {
      case T.WALL: {
        const p = this.parcel[i];
        let rc = this.roofColor.get(p);
        if (!rc) {
          const r1 = hash01(p, 1, seed);
          const r2 = hash01(p, 2, seed);
          const r3 = hash01(p, 3, seed);
          const R = P.roof;
          rc = [R.hues[Math.floor(r1 * R.hues.length)], R.sat[0] + r2 * (R.sat[1] - R.sat[0]), R.light[0] + r3 * (R.light[1] - R.light[0])];
          this.roofColor.set(p, rc);
        }
        this.color[i] = hsl(rc[0], rc[1], rc[2] + jit * 0.8);
        break;
      }
      case T.METAL: this.color[i] = P.metal; break;
      case T.FLOOR: this.color[i] = tone(P.floor); break;
      case T.STREET: this.color[i] = tone(P.street); break;
      case T.PLAZA: this.color[i] = tone(P.plaza); break;
      case T.INTERIOR: this.color[i] = tone(P.interior); break;
      case T.COURTYARD: this.color[i] = tone(P.courtyard); break;
      case T.ARCH: this.color[i] = tone(P.arch); break;
      case T.DOOR: this.color[i] = P.doorFrame; break;
      case T.GATE: this.color[i] = P.gate; break;
      case T.BUNKER: this.color[i] = tone(P.bunker); break;
      case T.WASTE: this.color[i] = tone(P.waste); break;
      case T.BARRIER: this.color[i] = P.barrier; break;
      case T.SEWER: this.color[i] = tone(P.sewer); break;
      case T.SEWER_WATER: this.color[i] = tone(P.sewerWater); break;
      case T.SEWER_WALL: this.color[i] = tone(P.sewerWall); break;
      case T.ROCK: this.color[i] = tone(P.rock); break;
      default: this.color[i] = '#f0f';
    }
  }

  /** Разбивка застройки на «дома»: полосы по вертикали, внутри — нарезка по горизонтали. */
  private buildParcels(seed: number): void {
    const { width: w, height: h } = this.map;
    let y = 0;
    let band = 0;
    while (y < h) {
      const bh = 5 + (hash2(band, 7, seed) % 5);
      let x = 0;
      let cut = 0;
      while (x < w) {
        const cw = 4 + (hash2(band, cut + 100, seed) % 6);
        const id = band * 1000 + cut;
        for (let yy = y; yy < Math.min(h, y + bh); yy++) {
          for (let xx = x; xx < Math.min(w, x + cw); xx++) this.parcel[yy * w + xx] = id;
        }
        x += cw;
        cut++;
      }
      y += bh;
      band++;
    }
  }

  draw(ctx: CanvasRenderingContext2D, v: View): void {
    const map = this.map;
    const ts = map.tileSize;
    const w = map.width;
    const s = v.scale;
    const tx0 = Math.max(0, Math.floor(v.left / ts));
    const ty0 = Math.max(0, Math.floor(v.top / ts));
    const tx1 = Math.min(w - 1, Math.floor((v.left + v.width / s) / ts));
    const ty1 = Math.min(map.height - 1, Math.floor((v.top + v.height / s) / ts));
    if (tx1 < tx0 || ty1 < ty0) return;
    const cols = tx1 - tx0 + 2;
    const rows = ty1 - ty0 + 2;
    if (this.xs.length < cols) this.xs = new Float64Array(cols);
    if (this.ys.length < rows) this.ys = new Float64Array(rows);
    for (let k = 0; k < cols; k++) this.xs[k] = Math.round(((tx0 + k) * ts - v.left) * s);
    for (let k = 0; k < rows; k++) this.ys[k] = Math.round(((ty0 + k) * ts - v.top) * s);
    const xs = this.xs;
    const ys = this.ys;
    const px = (world: number) => Math.max(1, Math.round(world * s));
    const P = RENDER.tiles;

    // 1. Базовая заливка.
    for (let ty = ty0; ty <= ty1; ty++) {
      const r = ty - ty0;
      const y0 = ys[r];
      const hgt = ys[r + 1] - y0;
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = tx - tx0;
        ctx.fillStyle = this.color[ty * w + tx];
        ctx.fillRect(xs[c], y0, xs[c + 1] - xs[c], hgt);
      }
    }

    // 2. Детали по типам.
    const line = px(1);
    const shadow = px(P.shadowSize);
    for (let ty = ty0; ty <= ty1; ty++) {
      const r = ty - ty0;
      const y0 = ys[r];
      const y1 = ys[r + 1];
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = tx - tx0;
        const x0 = xs[c];
        const x1 = xs[c + 1];
        const i = ty * w + tx;
        const t = map.tiles[i];
        const e = this.edges[i];
        const hv = this.noise[i];
        const cw = x1 - x0;
        const ch = y1 - y0;
        switch (t) {
          case T.WALL: {
            // Швы между домами и светлый парапет у края крыши.
            ctx.fillStyle = P.roofSeam;
            if (tx + 1 < w && map.tiles[i + 1] === T.WALL && this.parcel[i + 1] !== this.parcel[i]) ctx.fillRect(x1 - line, y0, line, ch);
            if (ty + 1 < map.height && map.tiles[i + w] === T.WALL && this.parcel[i + w] !== this.parcel[i]) ctx.fillRect(x0, y1 - line, cw, line);
            if (e) {
              ctx.fillStyle = P.roofEdge;
              if (e & 1) ctx.fillRect(x0, y0, cw, line * 2);
              if (e & 4) ctx.fillRect(x0, y1 - line * 2, cw, line * 2);
              if (e & 8) ctx.fillRect(x0, y0, line * 2, ch);
              if (e & 2) ctx.fillRect(x1 - line * 2, y0, line * 2, ch);
            }
            continue;
          }
          case T.METAL:
            ctx.fillStyle = P.metalLine;
            ctx.fillRect(x0 + (cw >> 1), y0, line, ch);
            if (e & 1) ctx.fillRect(x0, y0, cw, line * 2);
            if (e & 4) ctx.fillRect(x0, y1 - line * 2, cw, line * 2);
            if (e & 8) ctx.fillRect(x0, y0, line * 2, ch);
            if (e & 2) ctx.fillRect(x1 - line * 2, y0, line * 2, ch);
            continue;
          case T.BARRIER: {
            const b = px(1.5);
            ctx.fillStyle = P.barrierEdge;
            ctx.fillRect(x0, y1 - b, cw, b);
            ctx.fillRect(x1 - b, y0, b, ch);
            ctx.fillStyle = P.barrierTop;
            ctx.fillRect(x0, y0, cw, b);
            ctx.fillRect(x0, y0, b, ch);
            continue;
          }
          case T.SEWER_WALL:
            // Кирпичная кладка со смещением рядов; кромка у прохода.
            ctx.fillStyle = P.sewerBrick;
            ctx.fillRect(x0, y0 + (ch >> 1), cw, line);
            ctx.fillRect(x0 + ((ty & 1) ? cw >> 1 : 0), y0, line, ch >> 1);
            ctx.fillRect(x0 + ((ty & 1) ? 0 : cw >> 1), y0 + (ch >> 1), line, ch >> 1);
            if (e) {
              ctx.fillStyle = P.sewerWallEdge;
              if (e & 1) ctx.fillRect(x0, y0, cw, line * 2);
              if (e & 4) ctx.fillRect(x0, y1 - line * 2, cw, line * 2);
              if (e & 8) ctx.fillRect(x0, y0, line * 2, ch);
              if (e & 2) ctx.fillRect(x1 - line * 2, y0, line * 2, ch);
            }
            continue;
          case T.SEWER:
            ctx.fillStyle = P.sewerLine;
            if ((tx % 3) === 0) ctx.fillRect(x0, y0, line, ch);
            if ((ty % 3) === 0) ctx.fillRect(x0, y0, cw, line);
            break;
          case T.SEWER_WATER:
            // Струи стока вдоль тоннеля.
            ctx.fillStyle = P.sewerFlow;
            ctx.fillRect(x0 + px((hv & 7) * 1.5), y0 + px(((hv >> 3) & 7) * 1.5), px(5), px(1));
            ctx.fillRect(x0 + px(((hv >> 6) & 7) * 1.5), y0 + px(((hv >> 9) & 7) * 1.5), px(1), px(4));
            break;
          case T.BUNKER:
            ctx.fillStyle = P.bunkerLine;
            if ((tx & 1) === 0) ctx.fillRect(x0, y0, line, ch);
            if ((ty & 1) === 0) ctx.fillRect(x0, y0, cw, line);
            break;
          case T.ROCK:
            // Трещины и камни.
            ctx.fillStyle = P.rockCrack;
            ctx.fillRect(x0 + px((hv & 15) * 0.8), y0 + px(((hv >> 4) & 15) * 0.8), px(4), px(1));
            ctx.fillRect(x0 + px(((hv >> 8) & 15) * 0.8), y0 + px(((hv >> 12) & 15) * 0.8), px(1), px(3));
            continue;
          case T.FLOOR:
          case T.WASTE:
          case T.COURTYARD:
            ctx.fillStyle = P.speckle;
            ctx.fillRect(x0 + px((hv & 15) * 0.8), y0 + px(((hv >> 4) & 15) * 0.8), px(2), px(2));
            ctx.fillRect(x0 + px(((hv >> 8) & 15) * 0.8), y0 + px(((hv >> 12) & 15) * 0.8), px(3), px(1));
            break;
          case T.STREET:
            if (hv % 9 === 0) {
              ctx.fillStyle = P.speckle;
              ctx.fillRect(x0 + px((hv >> 4) & 7), y0 + px((hv >> 8) & 15), px(6), px(1));
            }
            break;
          case T.PLAZA:
            ctx.fillStyle = P.plazaLine;
            ctx.fillRect(x0, y0, cw, line);
            ctx.fillRect(x0, y0, line, ch);
            break;
          case T.INTERIOR:
            ctx.fillStyle = P.interiorLine;
            ctx.fillRect(x0, y0 + (ch >> 1), cw, line);
            ctx.fillRect(x0 + ((hv & 1) ? cw >> 2 : (cw * 3) >> 2), y0, line, ch >> 1);
            break;
          case T.ARCH:
            ctx.fillStyle = P.archRoof;
            ctx.fillRect(x0, y0, cw, ch);
            break;
          case T.DOOR: {
            // Закрытая — полотно двери, открытая — проём, запертая — с красной полосой.
            const inset = px(2);
            if (map.doorClosed[i]) {
              ctx.fillStyle = P.door;
              ctx.fillRect(x0 + inset, y0 + inset, cw - inset * 2, ch - inset * 2);
              if (map.doorLocked[i]) {
                ctx.fillStyle = P.doorLocked;
                ctx.fillRect(x0 + inset, y0 + (ch >> 1) - inset, cw - inset * 2, inset * 2);
              }
            } else {
              ctx.fillStyle = P.doorOpen;
              ctx.fillRect(x0 + inset, y0 + inset, cw - inset * 2, ch - inset * 2);
            }
            break;
          }
          case T.GATE:
            ctx.fillStyle = P.gateStripe;
            for (let k = 0; k < 4; k++) ctx.fillRect(x0 + ((cw * k) >> 2), y0 + ((ch * k) >> 2), cw >> 3, ch >> 2);
            break;
        }
        // Тень от зданий (свет с северо-запада).
        if (e & 31) {
          ctx.fillStyle = P.shadow;
          if (e & 1) ctx.fillRect(x0, y0, cw, shadow);
          if (e & 8) ctx.fillRect(x0, y0 + (e & 1 ? shadow : 0), shadow, ch - (e & 1 ? shadow : 0));
          if (e & 16 && !(e & 1) && !(e & 8)) ctx.fillRect(x0, y0, shadow, shadow);
        }
      }
    }
  }
}
