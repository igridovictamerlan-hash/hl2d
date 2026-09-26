import { CAMERA } from '../config/camera';
import { clamp, damp, lerp } from './math';

/** Что видно на экране в данном кадре: левый верхний угол в мире и масштаб в пикселях устройства. */
export interface View {
  left: number;
  top: number;
  /** Пикселей устройства на пиксель мира (zoom × devicePixelRatio). */
  scale: number;
  /** Размер холста в пикселях устройства. */
  width: number;
  height: number;
}

/**
 * Камера следует за игроком с экспоненциальным сглаживанием и небольшим сдвигом к курсору.
 * Масштаб подбирается так, чтобы было видно минимум ~820×550 px мира (CAMERA.viewWidth/viewHeight).
 */
export class Camera {
  x = 0;
  y = 0;
  prevX = 0;
  prevY = 0;
  /** CSS-пикселей на пиксель мира. */
  zoom = 1;
  /** Масштаб без прицеливания. */
  private baseZoom = 1;
  /** Доля «прицельного» режима 0..1 (плавно). */
  private aimK = 0;
  dpr = 1;
  cssWidth = 1;
  cssHeight = 1;

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.dpr = dpr;
    this.baseZoom = Math.min(this.cssWidth / CAMERA.viewWidth, this.cssHeight / CAMERA.viewHeight);
    this.zoom = this.baseZoom * lerp(1, CAMERA.aimZoom, this.aimK);
  }

  /** Ширина/высота видимой области мира. */
  get viewWidth(): number {
    return this.cssWidth / this.zoom;
  }

  get viewHeight(): number {
    return this.cssHeight / this.zoom;
  }

  snapTo(x: number, y: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
  }

  /** Шаг слежения. mouseWorld — курсор в мире (для сдвига к прицелу); aiming — зажата ПКМ. */
  follow(tx: number, ty: number, mouseWX: number, mouseWY: number, dt: number, bounds: { x: number; y: number; w: number; h: number }, aiming = false): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.aimK = damp(this.aimK, aiming ? 1 : 0, CAMERA.aimRate, dt);
    this.zoom = this.baseZoom * lerp(1, CAMERA.aimZoom, this.aimK);
    const factor = lerp(CAMERA.lookAheadFactor, CAMERA.aimLookAheadFactor, this.aimK);
    const max = lerp(CAMERA.lookAheadMax, CAMERA.aimLookAheadMax, this.aimK);
    let ox = (mouseWX - tx) * factor;
    let oy = (mouseWY - ty) * factor;
    const len = Math.hypot(ox, oy);
    if (len > max) {
      ox *= max / len;
      oy *= max / len;
    }
    this.x = damp(this.x, tx + ox, CAMERA.followRate, dt);
    this.y = damp(this.y, ty + oy, CAMERA.followRate, dt);
    // Камера не выходит за границы уровня (город / канализация не видны друг из друга).
    this.x = this.clampAxis(this.x, this.viewWidth, bounds.x, bounds.w);
    this.y = this.clampAxis(this.y, this.viewHeight, bounds.y, bounds.h);
  }

  private clampAxis(c: number, view: number, from: number, size: number): number {
    return view >= size ? from + size / 2 : clamp(c, from + view / 2, from + size - view / 2);
  }

  /** Вид для отрисовки с интерполяцией между тиками логики. */
  view(alpha: number): View {
    const cx = lerp(this.prevX, this.x, alpha);
    const cy = lerp(this.prevY, this.y, alpha);
    const scale = this.zoom * this.dpr;
    const width = Math.round(this.cssWidth * this.dpr);
    const height = Math.round(this.cssHeight * this.dpr);
    return { left: cx - width / scale / 2, top: cy - height / scale / 2, scale, width, height };
  }

  /** Экран (CSS px относительно холста) → мир, по текущему положению камеры. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.x + (sx - this.cssWidth / 2) / this.zoom,
      y: this.y + (sy - this.cssHeight / 2) / this.zoom,
    };
  }
}
