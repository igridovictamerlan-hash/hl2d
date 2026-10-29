/** Описание системы — docs/rendering.md («Окна и тени»). */
import type { GameMap } from './GameMap';
import { LIGHTING } from '../config/lighting';
import { HEIGHT_UNIT, sunAlpha, sunOffset } from './shadows';

/** Солнце для кусков карты: шаг положения, прозрачность теней (ступенькой) и ключ кэша (шаг и прозрачность). */
export interface SunState {
  step: number;
  alpha: number;
  key: number;
}

/**
 * Тени от зданий по солнцу — запекаются в куски карты (MapRenderer): в обычном кадре ничего не стоят, кусок
 * перерисовывается, когда солнце сдвинулось на шаг (LIGHTING.sun.steps за день) или тень сменила прозрачность.
 * Высоты — MapRenderer.heights (этажи × HEIGHT_UNIT). Тень тайла — его квадрат, протянутый по смещению солнца на
 * высоту (шестиугольник); соседние тайлы одной высоты в ряду — один прямоугольник. Маска куска (свой холст): сперва
 * тени низких (укрытия, клумбы, изгородь) и вычет их оснований, потом тени высоких и вычет их оснований — тень дома
 * ложится на землю, пол и низкое, но не на стены и крыши; заливка непрозрачная одним путём (перекрытия не темнее),
 * прозрачность — при наложении на кусок.
 */
export class ShadowRenderer {
  /** Самая длинная тень (тайлов): на столько кусок берёт отбрасывающих снаружи и столько задевает правка тайла. */
  readonly reach: number;
  private mask: HTMLCanvasElement | null = null;

  constructor(
    private readonly map: GameMap,
    private readonly heights: Uint8Array,
  ) {
    let top = 0;
    for (let i = 0; i < heights.length; i++) if (heights[i] > top) top = heights[i];
    const S = LIGHTING.sun;
    this.reach = Math.ceil(((top / HEIGHT_UNIT) * S.storey * S.lenMax * S.penumbra) / map.tileSize) + 1;
  }

  /** Солнце в долю суток f (ближайший шаг, прозрачность — ступенями alphaLevels); ночью — null. */
  sunAt(f: number): SunState | null {
    const S = LIGHTING.sun;
    const a = sunAlpha(f);
    if (a <= 0.01) return null;
    const step = Math.round(((f - S.rise) / (S.set - S.rise)) * S.steps);
    const level = Math.max(1, Math.round((a / S.alpha) * S.alphaLevels));
    return { step, alpha: (S.alpha * level) / S.alphaLevels, key: step * 64 + level };
  }

  /**
   * Наложить тени на кусок карты тайлов ax..bx × ay..by (без правой и нижней границы): g — холст куска, res — его px
   * на px мира.
   */
  paint(g: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, res: number, sun: SunState): void {
    const S = LIGHTING.sun;
    const map = this.map;
    const ts = map.tileSize;
    const w = Math.max(1, Math.round((bx - ax) * ts * res));
    const h = Math.max(1, Math.round((by - ay) * ts * res));
    this.mask ??= document.createElement('canvas');
    const mask = this.mask;
    if (mask.width !== w || mask.height !== h) {
      mask.width = w;
      mask.height = h;
    }
    const m = mask.getContext('2d')!;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, w, h);
    m.setTransform(res, 0, 0, res, -ax * ts * res, -ay * ts * res);
    const { dx, dy } = sunOffset(sun.step / S.steps);
    const r = this.reach;
    const low = LIGHTING.storeys.low * HEIGHT_UNIT;
    const x0 = Math.max(0, ax - r);
    const y0 = Math.max(0, ay - r);
    const x1 = Math.min(map.width, bx + r);
    const y1 = Math.min(map.height, by + r);
    const cx0 = Math.max(0, ax - 1);
    const cy0 = Math.max(0, ay - 1);
    const cx1 = Math.min(map.width, bx + 1);
    const cy1 = Math.min(map.height, by + 1);
    const isLow = (hh: number) => hh > 0 && hh < low;
    const isTall = (hh: number) => hh >= low;
    this.sweep(m, x0, y0, x1, y1, dx, dy, isLow);
    this.clear(m, cx0, cy0, cx1, cy1, isLow);
    this.sweep(m, x0, y0, x1, y1, dx, dy, isTall);
    this.clear(m, cx0, cy0, cx1, cy1, isTall);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = sun.alpha;
    g.drawImage(mask, 0, 0);
    g.restore();
  }

  /**
   * Тени отбрасывающих (pick по высоте) в прямоугольнике тайлов x0..x1 × y0..y1 (без правой и нижней границы):
   * полутень (длиннее в penumbra раз, вполовину) и тень — каждая одним путём (без двойного затемнения перекрытий).
   */
  private sweep(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, dx: number, dy: number, pick: (h: number) => boolean): void {
    const ts = this.map.tileSize;
    const w = this.map.width;
    const H = this.heights;
    g.fillStyle = '#000';
    for (const pass of [0, 1]) {
      const m = pass === 0 ? LIGHTING.sun.penumbra : 1;
      g.globalAlpha = pass === 0 ? 0.5 : 1;
      g.beginPath();
      let any = false;
      for (let y = y0; y < y1; y++) {
        let x = x0;
        while (x < x1) {
          const h = H[y * w + x];
          if (!pick(h)) {
            x++;
            continue;
          }
          let e = x + 1;
          while (e < x1 && H[y * w + e] === h) e++;
          const k = (h / HEIGHT_UNIT) * m;
          hexagon(g, x * ts, y * ts, e * ts, (y + 1) * ts, dx * k, dy * k);
          any = true;
          x = e;
        }
      }
      if (any) g.fill();
    }
    g.globalAlpha = 1;
  }

  /** Вычесть из маски основания тайлов (pick по высоте) в прямоугольнике x0..x1 × y0..y1. */
  private clear(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, pick: (h: number) => boolean): void {
    const ts = this.map.tileSize;
    const w = this.map.width;
    const H = this.heights;
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    let any = false;
    for (let y = y0; y < y1; y++) {
      let x = x0;
      while (x < x1) {
        if (!pick(H[y * w + x])) {
          x++;
          continue;
        }
        let e = x + 1;
        while (e < x1 && pick(H[y * w + e])) e++;
        g.rect(x * ts, y * ts, (e - x) * ts, ts);
        any = true;
        x = e;
      }
    }
    if (any) g.fill();
    g.globalCompositeOperation = 'source-over';
  }
}

/**
 * Прямоугольник x0..x1 × y0..y1, протянутый на (ox, oy): выпуклый шестиугольник, всегда по часовой стрелке —
 * в одном пути их объединение заливается без дыр (правило nonzero).
 */
function hexagon(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, ox: number, oy: number): void {
  if (ox >= 0 && oy >= 0) {
    g.moveTo(x0, y0);
    g.lineTo(x1, y0);
    g.lineTo(x1 + ox, y0 + oy);
    g.lineTo(x1 + ox, y1 + oy);
    g.lineTo(x0 + ox, y1 + oy);
    g.lineTo(x0, y1);
  } else if (ox < 0 && oy >= 0) {
    g.moveTo(x0, y0);
    g.lineTo(x1, y0);
    g.lineTo(x1, y1);
    g.lineTo(x1 + ox, y1 + oy);
    g.lineTo(x0 + ox, y1 + oy);
    g.lineTo(x0 + ox, y0 + oy);
  } else if (ox < 0) {
    g.moveTo(x0 + ox, y0 + oy);
    g.lineTo(x1 + ox, y0 + oy);
    g.lineTo(x1, y0);
    g.lineTo(x1, y1);
    g.lineTo(x0, y1);
    g.lineTo(x0 + ox, y1 + oy);
  } else {
    g.moveTo(x0, y0);
    g.lineTo(x0 + ox, y0 + oy);
    g.lineTo(x1 + ox, y0 + oy);
    g.lineTo(x1 + ox, y1 + oy);
    g.lineTo(x1, y1);
    g.lineTo(x0, y1);
  }
  g.closePath();
}
