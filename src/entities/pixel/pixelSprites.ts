/**
 * Спрайты пиксельных пешек: сетка (pixel/grid) — в картинку пиксель в пиксель (на экран — увеличением без сглаживания,
 * так что спрайт годен при любом масштабе камеры и места занимает мало); кэш с вытеснением самых давно нужных.
 * Картинка — ImageBitmap из ImageData (браузер готовит её асинхронно, без холста): создание холста, контекста и
 * putImageData было главной ценой промаха кэша. Общий лист-атлас пробовали: запись в лист после того, как с него уже
 * рисовали в этом кадре, заставляет браузер копировать весь лист (копия при записи) — кадр в разы дольше.
 */
import { rgb, type Grid } from './grid';

/** Спрайт: картинка (ImageBitmap или холст; пиксель силуэта — пиксель картинки), угол и размер в координатах силуэта. */
export interface Sprite {
  cv: HTMLCanvasElement | ImageBitmap;
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Картинка отпущена (вытеснена из кэша) — рисовать её больше нельзя. */
  dead?: boolean;
}

/** Пустой спрайт (в слое ничего нет — например, обе руки заняты): рисовать нечего, но кэшируется. */
export const EMPTY: Sprite = { cv: null as unknown as HTMLCanvasElement, x0: 0, y0: 0, w: 0, h: 0 };

/** Рамка рисунка сетки (занятые пиксели): x0, y0, x1, y1; пусто — null. */
export function bbox(g: Grid): [number, number, number, number] | null {
  let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
  const { w, h, c } = g;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!c[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** Пиксели рамки сетки — в новую картинку. */
function imageOf(g: Grid, b: [number, number, number, number]): ImageData {
  const w = b[2] - b[0] + 1;
  const h = b[3] - b[1] + 1;
  const img = new ImageData(w, h);
  const d = img.data;
  let o = 0;
  for (let y = 0; y < h; y++) {
    const row = (y + b[1]) * g.w + b[0];
    for (let x = 0; x < w; x++, o += 4) {
      const c = g.c[row + x];
      if (!c) continue;
      const [r, gg, bb] = rgb(c);
      d[o] = r;
      d[o + 1] = gg;
      d[o + 2] = bb;
      d[o + 3] = 255;
    }
  }
  return img;
}

/** Угол и размер рамки в координатах силуэта. */
function frameOf(g: Grid, b: [number, number, number, number]): Omit<Sprite, 'cv'> {
  return { x0: b[0] - g.ox, y0: b[1] - g.oy, w: b[2] - b[0] + 1, h: b[3] - b[1] + 1 };
}

const bitmaps = typeof createImageBitmap === 'function';

/**
 * Кэш спрайтов по ключу, вытесняется самый давно нужный. Картинка готовится без холста — createImageBitmap
 * (асинхронно, через кадр-другой): пока не готова, вызывающий рисует прежний кадр той же пешки. Показать больше
 * нечего (пешка только появилась) — сразу холстом (now). Нет createImageBitmap — всегда холстом.
 */
export class SpriteCache {
  private readonly map = new Map<string, Sprite>();
  private readonly pending = new Set<string>();
  constructor(private readonly max: number) {}

  get(key: string): Sprite | undefined {
    const spr = this.map.get(key);
    if (spr) {
      this.map.delete(key);
      this.map.set(key, spr);
    }
    return spr;
  }

  /** Картинка под ключ уже готовится. */
  waiting(key: string): boolean {
    return this.pending.has(key);
  }

  /** Заказать спрайт из сетки: готов сразу — он (пустая сетка, нет createImageBitmap), иначе null — придёт позже. */
  request(key: string, g: Grid): Sprite | null {
    const b = bbox(g);
    if (!b) {
      this.store(key, EMPTY);
      return EMPTY;
    }
    if (!bitmaps) return this.now(key, g);
    const fr = frameOf(g, b);
    this.pending.add(key);
    createImageBitmap(imageOf(g, b)).then(
      (bmp) => {
        if (!this.pending.delete(key)) {
          bmp.close();
          return;
        }
        this.store(key, { cv: bmp, ...fr });
      },
      () => this.pending.delete(key),
    );
    return null;
  }

  /** Спрайт сразу, холстом (показать больше нечего); заказанная картинка, если придёт, его заменит. */
  now(key: string, g: Grid): Sprite {
    const b = bbox(g);
    const spr = b ? canvasSprite(g, b) : EMPTY;
    this.store(key, spr);
    return spr;
  }

  private store(key: string, spr: Sprite): void {
    const old = this.map.get(key);
    if (old && old !== spr) release(old);
    this.map.delete(key);
    this.map.set(key, spr);
    if (this.map.size > this.max) {
      const k0 = this.map.keys().next().value as string;
      const victim = this.map.get(k0)!;
      this.map.delete(k0);
      release(victim);
    }
  }

  /** Отпустить всё. */
  clear(): void {
    for (const spr of this.map.values()) release(spr);
    this.map.clear();
    this.pending.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** Холст под спрайт (сразу, синхронно). */
function canvasSprite(g: Grid, b: [number, number, number, number]): Sprite {
  const img = imageOf(g, b);
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  cv.getContext('2d')!.putImageData(img, 0, 0);
  return { cv, ...frameOf(g, b) };
}

function release(spr: Sprite): void {
  if (spr === EMPTY || typeof ImageBitmap === 'undefined' || !(spr.cv instanceof ImageBitmap)) return;
  spr.cv.close();
  spr.dead = true;
}
