import { PIXEL } from '../../config/pixelPawns';

/**
 * Стиль пешек: пиксельные (свой стиль Верхнеречья) или прежние фасолины. Выбор — в меню («Пешки»), помнится в
 * браузере. Только отрисовка: логика и тесты от него не зависят.
 */
export type PawnStyle = 'pixel' | 'bean';

let style: PawnStyle = PIXEL.defaultStyle;

export function pawnStyle(): PawnStyle {
  return style;
}

export function isPixelStyle(): boolean {
  return style === 'pixel';
}

/** Стиль из браузера (как выбрал игрок в прошлый раз). */
export function loadPawnStyle(): PawnStyle {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(PIXEL.storageKey) : null;
    if (v === 'pixel' || v === 'bean') style = v;
  } catch {
    /* по умолчанию */
  }
  return style;
}

export function setPawnStyle(s: PawnStyle): void {
  style = s;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PIXEL.storageKey, s);
  } catch {
    /* не запомним — не страшно */
  }
}
