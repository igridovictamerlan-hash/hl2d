/** Описание системы — docs/rendering.md («Окна и тени»). */
import { RENDER } from '../config/render';
import { hash2 } from '../core/rng';
import type { WindowSpot } from './windows';

/** Прямоугольник в своих координатах окна (u — вдоль стены, v — от внешней грани) → пиксели холста [x, y, w, h]. */
type Mapper = (u0: number, v0: number, u1: number, v1: number) => [number, number, number, number];

/** Свои координаты окна на тайле x0..x1 × y0..y1 (пиксели холста): u, v — px мира (тайл 16), сторона улицы — v < 0. */
function mapper(o: number, x0: number, y0: number, x1: number, y1: number): Mapper {
  const cw = x1 - x0;
  const ch = y1 - y0;
  // Пиксели холста на px мира: вдоль стены и поперёк.
  const ku = (o === 0 || o === 2 ? cw : ch) / 16;
  const kv = (o === 0 || o === 2 ? ch : cw) / 16;
  return (u0, v0, u1, v1) => {
    let ax: number, ay: number, bx: number, by: number;
    if (o === 0) [ax, ay, bx, by] = [x0 + u0 * ku, y0 + v0 * kv, x0 + u1 * ku, y0 + v1 * kv];
    else if (o === 2) [ax, ay, bx, by] = [x0 + u0 * ku, y1 - v1 * kv, x0 + u1 * ku, y1 - v0 * kv];
    else if (o === 3) [ax, ay, bx, by] = [x0 + v0 * kv, y0 + u0 * ku, x0 + v1 * kv, y0 + u1 * ku];
    else [ax, ay, bx, by] = [x1 - v1 * kv, y0 + u0 * ku, x1 - v0 * kv, y0 + u1 * ku];
    const rx0 = Math.round(ax);
    const ry0 = Math.round(ay);
    return [rx0, ry0, Math.max(rx0 + 1, Math.round(bx)) - rx0, Math.max(ry0 + 1, Math.round(by)) - ry0];
  };
}

/** Проём вдоль стены [ua, ub]: у парного окна внутренний край — на стыке тайлов. */
function spanOf(wnd: WindowSpot): [number, number] {
  const S = RENDER.windows.style[wnd.style];
  const ua = wnd.pair === 2 ? 0 : S.span[0] + (wnd.pair === 1 ? 0.5 : 0);
  const ub = wnd.pair === 1 ? 16 : wnd.pair === 2 ? 16 - S.span[0] - 0.5 : S.span[1];
  return [ua, ub];
}

/** Стекло окна текущей заливкой (свечение горящего окна ночью — MapRenderer.drawLitWindows). */
export function fillWindowGlass(ctx: CanvasRenderingContext2D, wnd: WindowSpot, x0: number, y0: number, x1: number, y1: number): void {
  const M = mapper(wnd.out, x0, y0, x1, y1);
  const [ua, ub] = spanOf(wnd);
  const [g0, g1] = RENDER.windows.style[wnd.style].glass;
  const [x, y, w, h] = M(wnd.pair === 2 ? 0 : ua + 1, g0, wnd.pair === 1 ? 16 : ub - 1, g1);
  ctx.fillRect(x, y, w, h);
}

/**
 * Окно на тайле стены (x0..x1 × y0..y1 — тайл в пикселях холста). Рисуется в своей системе координат: u — вдоль
 * стены (0..16 px мира), v — поперёк, от внешней грани (0, к улице) внутрь (16, к комнате); v < 0 — снаружи
 * (подоконник, ящик с цветами, ставни). Половинки парного окна стыкуются на границе тайлов.
 */
export function drawWindow(ctx: CanvasRenderingContext2D, wnd: WindowSpot, x0: number, y0: number, x1: number, y1: number): void {
  const W = RENDER.windows;
  const S = W.style[wnd.style];
  const cw = x1 - x0;
  const ch = y1 - y0;
  const M = mapper(wnd.out, x0, y0, x1, y1);
  const R = (u0: number, v0: number, u1: number, v1: number, color: string) => {
    const [x, y, w, h] = M(u0, v0, u1, v1);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const look = wnd.look;
  const pair = wnd.pair;
  const [ua, ub] = spanOf(wnd);
  const [g0, g1] = S.glass;
  const dark = look === 'broken' || look === 'boarded';
  const pane = dark ? W.broken : S.pane;
  if (Math.min(cw, ch) < W.detailMin) {
    // Мелко: только стекло (или ставни, доски).
    R(ua, g0 - 1, ub, g1 + 1, look === 'closed' ? W.shutters[(wnd.tint >>> 4) % W.shutters.length] : look === 'boarded' ? W.plank : pane);
    return;
  }
  const hv = hash2(wnd.x, wnd.y, 977);
  // Откосы — тень в толще стены.
  R(ua, 0, ub, 16, W.reveal);
  // Подоконник снаружи.
  if (S.sill && look !== 'boarded' && look !== 'closed') R(pair === 2 ? 0 : ua - 1, -1.5, pair === 1 ? 16 : ub + 1, 0.5, S.sill);
  // Рама и стекло; у широкого окна — переплёт посередине, у парного — на стыке.
  R(ua, g0 - 1, ub, g1 + 1, S.frame);
  R(pair === 2 ? 0 : ua + 1, g0, pair === 1 ? 16 : ub - 1, g1, pane);
  if (pair === 1) R(15.5, g0, 16, g1, S.frame);
  else if (pair === 2) R(0, g0, 0.5, g1, S.frame);
  else if (ub - ua >= 9 && wnd.style !== 'shop') R((ua + ub) / 2 - 0.5, g0, (ua + ub) / 2 + 0.5, g1, S.frame);
  if (!dark) {
    R(ua + 1.5, g0 + 0.4, ua + (wnd.style === 'shop' ? 5 : 3.5), g0 + 1.2, W.glint);
    if (wnd.style === 'shop') R(ua + 6, g0 + 0.4, ua + 7, g1 - 0.6, W.glint);
  }
  switch (look) {
    case 'curtains': {
      // Шторы раздвинуты по краям проёма, с внутренней стороны.
      const c = W.curtains[wnd.tint % W.curtains.length];
      if (pair !== 2) {
        R(ua - 0.5, 10.5, ua + 3, 14.5, c);
        R(ua + 1.2, 10.5, ua + 1.8, 14.5, W.curtainFold);
      }
      if (pair !== 1) {
        R(ub - 3, 10.5, ub + 0.5, 14.5, c);
        R(ub - 1.8, 10.5, ub - 1.2, 14.5, W.curtainFold);
      }
      break;
    }
    case 'flowers': {
      // Ящик с цветами на подоконнике снаружи: зелень и пара цветков.
      const bu0 = pair === 2 ? 0 : ua;
      const bu1 = pair === 1 ? 16 : ub;
      R(bu0, -5, bu1, -1, W.box);
      R(bu0, -1.6, bu1, -1, W.boxEdge);
      R(bu0 + 0.6, -5.6, bu1 - 0.6, -3, W.leafDark);
      R(bu0 + 1.2 + (hv & 1), -5.8, bu0 + 3.6 + (hv & 1), -3.6, W.leaf);
      R(bu1 - 4 - ((hv >>> 1) & 1), -5.4, bu1 - 1.4 - ((hv >>> 1) & 1), -3.2, W.leaf);
      for (let k = 0; k < 3; k++) {
        const u = bu0 + 1.5 + (((hv >>> (3 + k * 3)) & 7) / 7) * (bu1 - bu0 - 4);
        R(u, -5.6 + ((hv >>> (12 + k)) & 1), u + 1.6, -4 + ((hv >>> (12 + k)) & 1), W.flowers[(hv >>> (16 + k * 3)) % W.flowers.length]);
      }
      break;
    }
    case 'shutters': {
      // Ставни распахнуты и прижаты к стене по бокам окна.
      const c = W.shutters[(wnd.tint >>> 4) % W.shutters.length];
      if (pair !== 2) {
        R(ua - 4, -2.6, ua - 0.4, 0.4, c);
        R(ua - 4, -2.6, ua - 3.3, 0.4, W.shutterEdge);
      }
      if (pair !== 1) {
        R(ub + 0.4, -2.6, ub + 4, 0.4, c);
        R(ub + 3.3, -2.6, ub + 4, 0.4, W.shutterEdge);
      }
      break;
    }
    case 'closed': {
      // Ставни закрыты: створки поверх проёма снаружи, щель посередине.
      const c = W.shutters[(wnd.tint >>> 4) % W.shutters.length];
      const su0 = pair === 2 ? 0 : ua - 0.5;
      const su1 = pair === 1 ? 16 : ub + 0.5;
      R(su0, -1.6, su1, 3, c);
      R(su0, 2.4, su1, 3, W.shutterEdge);
      if (pair === 0) R((ua + ub) / 2 - 0.4, -1.6, (ua + ub) / 2 + 0.4, 3, W.shutterEdge);
      else if (pair === 1) R(15.6, -1.6, 16, 3, W.shutterEdge);
      break;
    }
    case 'boarded': {
      // Заколочено: доски поперёк проёма снаружи, швы и гвозди.
      const bu0 = pair === 2 ? 0 : ua - 1;
      const bu1 = pair === 1 ? 16 : ub + 1;
      R(bu0, -1.2, bu1, 3.6, W.plank);
      for (let u = bu0 + 2.6; u < bu1 - 1; u += 2.6) R(u, -1.2, u + 0.6, 3.6, W.plankSeam);
      R(bu0 + 1, 0.6, bu0 + 1.8, 1.4, W.nail);
      R(bu1 - 1.8, 0.6, bu1 - 1, 1.4, W.nail);
      break;
    }
    case 'broken': {
      // Разбито: тёмный проём, осколки у рамы.
      R(ua + 1, g0, ua + 2.6, g0 + 1.4, W.shard);
      R(ub - 2.4, g1 - 1.2, ub - 1, g1, W.shard);
      R(ua + 3, g1 - 1, ua + 3.8, g1, W.shard);
      break;
    }
    default:
      break;
  }
  if (wnd.style === 'shop') {
    // Товар в витрине — у внутренней грани.
    for (let u = ua + 1.5, k = 0; u < ub - 2; u += 3.2, k++) R(u, 12, u + 2, 14.2, W.goods[(hv >>> (k * 3)) % W.goods.length]);
  }
}
