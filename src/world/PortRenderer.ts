import type { View } from '../core/Camera';
import type { PortSystem } from '../systems/Port';
import type { SupplySystem } from '../systems/Supply';
import type { StreetShop } from '../systems/StreetShops';
import type { ItemId } from '../config/items';
import { PORT_LOOK as L, SUPPLY, SUPPLY_LOOK as G } from '../config/port';
import { ARBAT } from '../config/arbat';

/** Баржи порта: корпус с носом по ходу, палуба с контейнерами, рубка на корме, кильватерный след на ходу. */
export class PortRenderer {
  drawGround(ctx: CanvasRenderingContext2D, v: View, port: PortSystem, ts: number): void {
    const s = v.scale;
    for (const b of port.barges) {
      if (b.phase === 'away') continue;
      const vertical = b.heading === 'N' || b.heading === 'S';
      const beam = Math.min(b.berth.w!, b.berth.h!) * ts * 0.9;
      const len = Math.max(b.berth.w!, b.berth.h!) * ts;
      const w = (vertical ? beam : len) * s;
      const h = (vertical ? len : beam) * s;
      const cx = (b.x - v.left) * s;
      const cy = (b.y - v.top) * s;
      if (cx + w < 0 || cy + h < 0 || cx - w > v.width || cy - h > v.height) continue;
      const x = cx - w / 2;
      const y = cy - h / 2;
      // Направление носа (единичный вектор) и толщина «носовой» части.
      const fx = b.heading === 'E' ? 1 : b.heading === 'W' ? -1 : 0;
      const fy = b.heading === 'S' ? 1 : b.heading === 'N' ? -1 : 0;
      const bow = Math.min(w, h) * 0.6;
      if (b.moving) {
        ctx.fillStyle = L.wake;
        const wl = Math.min(w, h) * 1.4;
        if (vertical) ctx.fillRect(cx - w * 0.35, fy > 0 ? y - wl : y + h, w * 0.7, wl);
        else ctx.fillRect(fx > 0 ? x - wl : x + w, cy - h * 0.35, wl, h * 0.7);
      }
      // Корпус: прямоугольник без носа + треугольник носа.
      const hx = fx > 0 ? x : fx < 0 ? x + bow : x;
      const hy = fy > 0 ? y : fy < 0 ? y + bow : y;
      const hw = vertical ? w : w - bow;
      const hh = vertical ? h - bow : h;
      ctx.fillStyle = L.rim;
      ctx.fillRect(hx - 1, hy - 1, hw + 2, hh + 2);
      ctx.beginPath();
      if (fx > 0) { ctx.moveTo(x + w - bow - 1, y - 1); ctx.lineTo(x + w + 1, cy); ctx.lineTo(x + w - bow - 1, y + h + 1); }
      else if (fx < 0) { ctx.moveTo(x + bow + 1, y - 1); ctx.lineTo(x - 1, cy); ctx.lineTo(x + bow + 1, y + h + 1); }
      else if (fy > 0) { ctx.moveTo(x - 1, y + h - bow - 1); ctx.lineTo(cx, y + h + 1); ctx.lineTo(x + w + 1, y + h - bow - 1); }
      else { ctx.moveTo(x - 1, y + bow + 1); ctx.lineTo(cx, y - 1); ctx.lineTo(x + w + 1, y + bow + 1); }
      ctx.fill();
      ctx.fillStyle = L.hull;
      ctx.fillRect(hx, hy, hw, hh);
      ctx.fillStyle = L.deck;
      const inset = Math.max(2, Math.min(w, h) * 0.12);
      ctx.fillRect(hx + inset, hy + inset, hw - inset * 2, hh - inset * 2);
      // Рубка — на корме (против носа), контейнеры — от рубки к носу.
      const cab = Math.min(w, h) * 0.55;
      ctx.fillStyle = L.cabin;
      const sx = vertical ? cx - cab / 2 : fx > 0 ? hx + inset : hx + hw - inset - cab;
      const sy = vertical ? (fy > 0 ? hy + inset : hy + hh - inset - cab) : cy - cab / 2;
      ctx.fillRect(sx, sy, cab, cab);
      ctx.fillStyle = L.window;
      ctx.fillRect(sx + cab * 0.2, sy + cab * 0.2, cab * 0.6, cab * 0.25);
      const span = (vertical ? hh : hw) - cab - inset * 3;
      const n = 3;
      const box = span / n - 2;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = L.cargo[(b.berth.id ?? 0) + k] ?? L.cargo[k % L.cargo.length];
        const along = k * (box + 2) + inset * 2 + cab;
        const bw = Math.min(w, h) * 0.62;
        if (vertical) ctx.fillRect(cx - bw / 2, fy > 0 ? hy + along : hy + hh - along - box, bw, box);
        else ctx.fillRect(fx > 0 ? hx + along : hx + hw - along - box, cy - bw / 2, box, bw);
      }
    }
  }

  /**
   * Груз (только отрисовка): штабели ящиков у пирсов, стеллажи склада штаба ТС с ящиками по запасу (по 10 на
   * стеллаж, этикетка — цветом товара), полки лавок у задней стены и окошки ларьков — товар поштучно.
   */
  drawCargo(ctx: CanvasRenderingContext2D, v: View, supply: SupplySystem, shops: readonly StreetShop[]): void {
    const s = v.scale;
    const on = (x: number, y: number, m: number) => x > -m && y > -m && x < v.width + m && y < v.height + m;
    const sx = (x: number) => (x - v.left) * s;
    const sy = (y: number) => (y - v.top) * s;
    ctx.lineWidth = Math.max(1, 1.1 * s);
    ctx.strokeStyle = G.outline;
    for (const k of supply.docks) {
      const x = sx(k.pile.x);
      const y = sy(k.pile.y);
      if (!k.crates.length || !on(x, y, 80)) continue;
      // Штабель 3×N, по два яруса: верхний ярус — со сдвигом вверх.
      for (let i = 0; i < k.crates.length; i++) {
        const tier = i >= 9 ? 1 : 0;
        const j = i % 9;
        crate(ctx, x + ((j % 3) - 1) * 9 * s, y + (Math.floor(j / 3) - 1) * 8 * s - tier * 4 * s, s, G.goods[k.crates[i].item]?.[0]);
      }
    }
    if (supply.racks.length) {
      let item = 0;
      let left = 0;
      const ids = SUPPLY.manifest;
      for (const r of supply.racks) {
        const x = sx(r.x);
        const y = sy(r.y);
        const vis = on(x, y, 80);
        if (vis) {
          ctx.fillStyle = G.shelfDark;
          ctx.fillRect(x - 28 * s, y - 9 * s, 56 * s, 18 * s);
          ctx.strokeRect(x - 28 * s, y - 9 * s, 56 * s, 18 * s);
          ctx.fillStyle = G.shelf;
          ctx.fillRect(x - 26 * s, y - 1 * s, 52 * s, 2 * s);
        }
        for (let slot = 0; slot < 10; slot++) {
          while (left <= 0 && item < ids.length) left = supply.crateCount(ids[item++][0]);
          if (left <= 0) break;
          left--;
          if (vis) crate(ctx, x - 21 * s + (slot % 5) * 10.5 * s, y - 4.5 * s + Math.floor(slot / 5) * 9 * s, s, G.goods[ids[item - 1][0]]?.[0]);
        }
      }
    }
    for (const sh of shops) {
      if (!sh.stock.length) continue;
      if (sh.rack.length) {
        const t0 = sh.rack[0];
        if (!on(sx(t0.x), sy(t0.y), 160 * s)) continue;
        const d = sh.rackDir;
        // Доска стеллажа вдоль стены (полтайла в глубину), на ней товар в два ряда по три.
        ctx.fillStyle = G.shelfDark;
        for (const t of sh.rack) {
          const hw = (d.x ? 5 : 8) * s;
          const hh = (d.x ? 8 : 5) * s;
          const x = sx(t.x + d.x * 3);
          const y = sy(t.y + d.y * 3);
          ctx.fillRect(x - hw, y - hh, hw * 2, hh * 2);
          ctx.strokeRect(x - hw, y - hh, hw * 2, hh * 2);
        }
        let tile = 0;
        let n = 0;
        for (const id of sh.stock) {
          const qty = sh.shelf.get(id) ?? 0;
          for (let k = 0; k < qty && tile < sh.rack.length; k++) {
            const t = sh.rack[tile];
            const along = ((n % 3) - 1) * 5;
            const deep = n < 3 ? 5 : 1;
            good(ctx, sx(t.x + d.x * deep + (d.x ? 0 : along)), sy(t.y + d.y * deep + (d.x ? along : 0)), s, id);
            if (++n >= ARBAT.supply.perTile) {
              n = 0;
              tile++;
            }
          }
        }
      } else if (sh.kind === 'kiosk') {
        const x = sx((sh.front.x + sh.look.x) / 2);
        const y = sy((sh.front.y + sh.look.y) / 2);
        if (!on(x, y, 40)) continue;
        const along = sh.rackDir.x ? 0 : 1;
        let k = 0;
        for (const id of sh.stock) {
          const qty = Math.min(4, sh.shelf.get(id) ?? 0);
          for (let i = 0; i < qty; i++, k++) good(ctx, x + (k - 3) * 4 * s * along, y + (k - 3) * 4 * s * (1 - along), s, id);
        }
      }
    }
  }
}

function crate(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tag?: string): void {
  ctx.fillStyle = G.crate;
  ctx.fillRect(x - 4 * s, y - 3.4 * s, 8 * s, 6.8 * s);
  ctx.strokeRect(x - 4 * s, y - 3.4 * s, 8 * s, 6.8 * s);
  ctx.fillStyle = tag ?? G.crateTape;
  ctx.fillRect(x - 1.6 * s, y - 1.2 * s, 3.2 * s, 2.4 * s);
}

/** Одна штука товара на полке (мелко, по форме и цвету товара). */
function good(ctx: CanvasRenderingContext2D, x: number, y: number, s0: number, id: ItemId): void {
  const s = s0 * G.glyph;
  const g = G.goods[id];
  if (!g) return;
  const [color, shape] = g;
  ctx.fillStyle = color;
  switch (shape) {
    case 'loaf':
      ctx.beginPath();
      ctx.ellipse(x, y, 2.6 * s, 1.7 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bottle':
      ctx.fillRect(x - 1 * s, y - 2.4 * s, 2 * s, 4.8 * s);
      ctx.fillRect(x - 0.5 * s, y - 3.4 * s, 1 * s, 1 * s);
      break;
    case 'can':
    case 'roll':
      ctx.beginPath();
      ctx.arc(x, y, 1.6 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bunch':
      ctx.fillRect(x - 0.4 * s, y, 0.8 * s, 2.6 * s);
      ctx.beginPath();
      ctx.arc(x, y - 0.6 * s, 1.5 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'paper':
      ctx.fillRect(x - 1.8 * s, y - 2.2 * s, 3.6 * s, 4.4 * s);
      break;
    default:
      ctx.fillRect(x - 1.6 * s, y - 1.6 * s, 3.2 * s, 3.2 * s);
  }
  ctx.strokeRect(x - 1.6 * s, y - 1.6 * s, 3.2 * s, 3.2 * s);
}
