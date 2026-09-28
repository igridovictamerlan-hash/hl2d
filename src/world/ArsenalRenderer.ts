import type { View } from '../core/Camera';
import type { ArsenalSystem, Crate } from '../systems/Arsenal';
import { ARSENAL, ARSENAL_LOOK as L } from '../config/arsenal';

const DASH = [6, 4];
const NO_DASH: number[] = [];

/**
 * Склад Альянса на экране (только отрисовка): разметка площадки и места сброса, стеллажи со
 * стволами и ящики в зале — по запасам, мебель (стол кладовщика, окно выдачи, опись, койки караулки,
 * верстак), маяк площадки (мигает; сломан — искрит), ящики на площадке и в руках грузчиков, заряд
 * подполья, корабль Альянса с контейнером и тенью. Без save/restore и сборки строк на кадр.
 */
export class ArsenalRenderer {
  private glow: HTMLCanvasElement | null = null;

  /** Пол склада и всё, что на нём (до персонажей); тень корабля. */
  drawGround(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, ts: number, now: number): void {
    if (!A.present || !A.rect) return;
    const s = v.scale;
    const r = A.rect;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    const on = X(r.x + r.w) >= 0 && Y(r.y + r.h) >= 0 && X(r.x) <= v.width && Y(r.y) <= v.height;
    if (on) {
      this.pad(ctx, v, A, ts);
      this.storage(ctx, v, A, ts);
      this.furniture(ctx, v, A, ts);
      this.beacon(ctx, X, Y, s, A, now);
      for (const c of A.crates) this.crate(ctx, X(c.x), Y(c.y), L.crate * s, c);
      if (A.bomb && Math.floor(now * 3) % 2 === 0) {
        ctx.fillStyle = L.bomb;
        ctx.beginPath();
        ctx.arc(X(A.bomb.x), Y(A.bomb.y), 2.5 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const sv = A.shipView();
    if (sv) {
      // Тень корабля на земле: чем выше, тем дальше и бледнее.
      const S = L.ship;
      const lift = sv.k * ARSENAL.flight.height * S.shadowOffset;
      ctx.globalAlpha = 1 - sv.k * 0.5;
      ctx.fillStyle = S.shadow;
      ctx.beginPath();
      ctx.ellipse(X(sv.x + lift), Y(sv.y + lift), (S.length / 2) * s, (S.wing / 2) * s, this.heading(A), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Ящики в руках грузчиков (поверх пешек). */
  drawCarried(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, alpha: number): void {
    if (!A.present) return;
    const s = v.scale;
    for (const [c, crate] of A.carriedCrates) {
      if (!c.visible || !c.alive) continue;
      const x = c.prevX + (c.x - c.prevX) * alpha;
      const y = c.prevY + (c.y - c.prevY) * alpha;
      this.crate(ctx, (x + Math.cos(c.facing) * 5 - v.left) * s, (y + Math.sin(c.facing) * 5 - 3 - v.top) * s, L.carried * s, crate);
    }
  }

  /** Свечение маяка (после света суток — не темнеет ночью; туман закроет, если не видно). */
  drawGlow(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, now: number): void {
    if (!A.present || !A.beacon || A.beaconBroken || !this.blink(now)) return;
    const s = v.scale;
    const x = (A.beacon.x - v.left) * s;
    const y = (A.beacon.y - v.top) * s;
    const R = 26 * s;
    if (x < -R || y < -R || x > v.width + R || y > v.height + R) return;
    const g = this.glowSprite();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(g, x - R, y - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Корабль Альянса в небе (поверх тумана — его видно и слышно издалека). */
  drawShip(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, now: number): void {
    const sv = A.present ? A.shipView() : null;
    if (!sv) return;
    const S = L.ship;
    const k = 0.85 + sv.k * 0.35;
    const s = v.scale * k;
    const x = (sv.x - v.left) * v.scale;
    const y = (sv.y - v.top) * v.scale;
    const R = S.length * s;
    if (x < -R || y < -R || x > v.width + R || y > v.height + R) return;
    const a = this.heading(A);
    const c = Math.cos(a);
    const n = Math.sin(a);
    ctx.setTransform(c * s, n * s, -n * s, c * s, x, y);
    const Lh = S.length / 2;
    const W = S.wing / 2;
    // Контейнер под брюхом — пока летит к площадке.
    if (sv.phase === 'arrive' && !A.ship.aborted) {
      ctx.fillStyle = S.container;
      ctx.fillRect(-Lh * 0.42, -W * 0.62, Lh * 0.84, W * 1.24);
      ctx.fillStyle = S.containerTop;
      ctx.fillRect(-Lh * 0.38, -W * 0.52, Lh * 0.76, W * 0.3);
      ctx.strokeStyle = L.outline;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-Lh * 0.42, -W * 0.62, Lh * 0.84, W * 1.24);
    }
    // Лапы-захваты (под корпусом).
    ctx.strokeStyle = S.rib;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(Lh * 0.2, side * W * 0.4);
      ctx.lineTo(Lh * 0.02, side * W * 0.95);
      ctx.moveTo(-Lh * 0.12, side * W * 0.3);
      ctx.lineTo(-Lh * 0.34, side * W * 0.85);
    }
    ctx.stroke();
    // Двигатели по бокам груди.
    ctx.fillStyle = S.pod;
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(Lh * 0.22, -W * 0.62, Lh * 0.24, W * 0.17, 0, 0, Math.PI * 2);
    ctx.moveTo(Lh * 0.46, W * 0.62);
    ctx.ellipse(Lh * 0.22, W * 0.62, Lh * 0.24, W * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Корпус — сегментированное «насекомое»: крупная голова, грудь, длинное брюшко.
    ctx.fillStyle = S.hull;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-Lh, 0);
    ctx.lineTo(-Lh * 0.15, -W * 0.34);
    ctx.lineTo(Lh * 0.38, -W * 0.5);
    ctx.quadraticCurveTo(Lh * 1.02, -W * 0.52, Lh, 0);
    ctx.quadraticCurveTo(Lh * 1.02, W * 0.52, Lh * 0.38, W * 0.5);
    ctx.lineTo(-Lh * 0.15, W * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Пластины и рёбра брюшка.
    ctx.fillStyle = S.plate;
    ctx.fillRect(Lh * 0.05, -W * 0.34, Lh * 0.55, W * 0.68);
    ctx.strokeStyle = S.rib;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i <= 5; i++) {
      const px = -Lh * 0.2 - i * Lh * 0.14;
      ctx.moveTo(px, -W * 0.2);
      ctx.lineTo(px, W * 0.2);
    }
    ctx.stroke();
    // Огни: голубые на носу и хвосте, двигатели мерцают.
    ctx.fillStyle = S.light;
    ctx.beginPath();
    ctx.arc(Lh * 0.84, 0, 2.6, 0, Math.PI * 2);
    ctx.moveTo(-Lh * 0.9 + 1.8, 0);
    ctx.arc(-Lh * 0.9, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now * 20);
    ctx.fillStyle = S.engine;
    ctx.beginPath();
    ctx.arc(Lh * 0.02, -W * 0.62, 3.5, 0, Math.PI * 2);
    ctx.moveTo(Lh * 0.02 + 3.5, W * 0.62);
    ctx.arc(Lh * 0.02, W * 0.62, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ————— Части —————

  private heading(A: ArsenalSystem): number {
    const sh = A.ship;
    const p = A.pad!;
    return sh.phase === 'leave' ? Math.atan2(sh.to.y - p.y, sh.to.x - p.x) : Math.atan2(p.y - sh.from.y, p.x - sh.from.x);
  }

  private blink(now: number): boolean {
    const B = ARSENAL.beacon.blink;
    return now % B < B * 0.5;
  }

  /** Площадка: жёлто-чёрная кромка, круг посадки с крестом, места сброса. */
  private pad(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, ts: number): void {
    const r = A.padRect;
    if (!r) return;
    const s = v.scale;
    const x = (r.x - v.left) * s;
    const y = (r.y - v.top) * s;
    ctx.strokeStyle = L.padMark;
    ctx.lineWidth = 2 * s;
    ctx.setLineDash(DASH.map((d) => d * s));
    ctx.strokeRect(x + 3 * s, y + 3 * s, r.w * s - 6 * s, r.h * s - 6 * s);
    ctx.setLineDash(NO_DASH);
    const cx = x + (r.w * s) / 2;
    const cy = y + (r.h * s) / 2;
    ctx.strokeStyle = L.padLine;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.arc(cx, cy, L.padRing * s, 0, Math.PI * 2);
    ctx.moveTo(cx - L.padRing * 0.5 * s, cy);
    ctx.lineTo(cx + L.padRing * 0.5 * s, cy);
    ctx.moveTo(cx, cy - L.padRing * 0.5 * s);
    ctx.lineTo(cx, cy + L.padRing * 0.5 * s);
    ctx.stroke();
    ctx.strokeStyle = L.dropMark;
    ctx.lineWidth = 1 * s;
    const h = ts / 2 - 1;
    for (const d of A.drops) ctx.strokeRect((d.x - h - v.left) * s, (d.y - h - v.top) * s, h * 2 * s, h * 2 * s);
  }

  /** Стеллажи со стволами и ящики патронов/гранат по доле запасов. */
  private storage(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, ts: number): void {
    const s = v.scale;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    const h = ts / 2;
    const guns = Math.round((A.stock.weapons / ARSENAL.max.weapons) * A.racks.length);
    A.racks.forEach((p, i) => {
      ctx.fillStyle = L.rack;
      ctx.fillRect(X(p.x - h + 1), Y(p.y - h + 2), (ts - 2) * s, (ts - 4) * s);
      ctx.fillStyle = L.rackShelf;
      ctx.fillRect(X(p.x - h + 1), Y(p.y - 1), (ts - 2) * s, 2 * s);
      if (i < guns) {
        ctx.fillStyle = L.rifle;
        ctx.fillRect(X(p.x - h + 2), Y(p.y - 4), (ts - 4) * s, 1.6 * s);
        ctx.fillRect(X(p.x + h - 6), Y(p.y - 4), 4 * s, 3 * s);
      }
    });
    const ammo = Math.ceil((A.stock.ammo / ARSENAL.max.ammo) * A.ammoSlots.length);
    A.ammoSlots.forEach((p, i) => {
      if (i < ammo) this.box(ctx, X(p.x), Y(p.y), (ts - 3) * s, L.ammoBox, L.ammoLid, L.ammoMark);
    });
    const gr = Math.ceil((A.stock.grenades / ARSENAL.max.grenades) * A.grenadeSlots.length);
    A.grenadeSlots.forEach((p, i) => {
      if (i < gr) this.box(ctx, X(p.x), Y(p.y), (ts - 4) * s, L.grenadeBox, L.grenadeLid, L.grenadeMark);
    });
  }

  /** Стол кладовщика с терминалом, окно выдачи, стол описи, койки караулки, верстак. */
  private furniture(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, ts: number): void {
    const s = v.scale;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    const h = ts / 2;
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = 1 * s;
    for (const w of A.windowTiles) {
      ctx.fillStyle = L.counter;
      ctx.fillRect(X(w.x - h), Y(w.y - h), ts * s, ts * s);
      ctx.fillStyle = L.glass;
      ctx.fillRect(X(w.x - 2), Y(w.y - h), 4 * s, ts * s);
    }
    if (A.desk) {
      const d = A.desk;
      ctx.fillStyle = L.desk;
      ctx.fillRect(X(d.x - 10), Y(d.y - 6), 20 * s, 12 * s);
      ctx.strokeRect(X(d.x - 10), Y(d.y - 6), 20 * s, 12 * s);
      ctx.fillStyle = L.screen;
      ctx.fillRect(X(d.x - 7), Y(d.y - 4), 7 * s, 5 * s);
      ctx.fillStyle = L.paper;
      ctx.fillRect(X(d.x + 2), Y(d.y - 3), 5 * s, 6 * s);
    }
    if (A.ledgerDesk) {
      const d = A.ledgerDesk;
      ctx.fillStyle = L.deskTop;
      ctx.fillRect(X(d.x - 7), Y(d.y - 7), 14 * s, 14 * s);
      ctx.strokeRect(X(d.x - 7), Y(d.y - 7), 14 * s, 14 * s);
      ctx.fillStyle = L.paper;
      ctx.fillRect(X(d.x - 5), Y(d.y - 4), 6 * s, 8 * s);
      ctx.fillRect(X(d.x + 1), Y(d.y - 5), 4 * s, 5 * s);
    }
    for (const c of A.cots) {
      ctx.fillStyle = L.cot;
      ctx.fillRect(X(c.x - 6), Y(c.y - 7), 12 * s, 22 * s);
      ctx.fillStyle = L.blanket;
      ctx.fillRect(X(c.x - 5), Y(c.y), 10 * s, 14 * s);
      ctx.fillStyle = L.pillow;
      ctx.fillRect(X(c.x - 4), Y(c.y - 6), 8 * s, 4 * s);
    }
    A.benchTiles.forEach((b, i) => {
      ctx.fillStyle = L.bench;
      ctx.fillRect(X(b.x - h), Y(b.y - 6), ts * s, 12 * s);
      ctx.fillStyle = L.benchTop;
      ctx.fillRect(X(b.x - h), Y(b.y - 6), ts * s, 3 * s);
      if (i === 0) {
        ctx.fillStyle = L.vise;
        ctx.fillRect(X(b.x - 4), Y(b.y - 4), 8 * s, 6 * s);
      } else if (i === 1) {
        ctx.fillStyle = L.rifle;
        ctx.fillRect(X(b.x - 7), Y(b.y - 1), 14 * s, 2 * s);
      }
    });
  }

  /** Маяк площадки: мигает красным; сломан — тёмный и искрит. */
  private beacon(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number, s: number, A: ArsenalSystem, now: number): void {
    const b = A.beacon;
    if (!b) return;
    ctx.fillStyle = L.beaconBase;
    ctx.beginPath();
    ctx.arc(X(b.x), Y(b.y), 5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = A.beaconBroken ? L.beaconOff : this.blink(now) ? L.beaconOn : L.beaconOff;
    ctx.beginPath();
    ctx.arc(X(b.x), Y(b.y), 2.8 * s, 0, Math.PI * 2);
    ctx.fill();
    if (A.beaconBroken && (now * 5) % 1 < 0.2) {
      ctx.fillStyle = L.spark;
      ctx.fillRect(X(b.x + 3), Y(b.y - 4), 1.5 * s, 1.5 * s);
    }
  }

  /** Ящик по виду; для КПП — с белой биркой. */
  private crate(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, c: Crate): void {
    if (c.kind === 'ammo') this.box(ctx, x, y, size, L.ammoBox, L.ammoLid, L.ammoMark);
    else if (c.kind === 'grenades') this.box(ctx, x, y, size, L.grenadeBox, L.grenadeLid, L.grenadeMark);
    else this.box(ctx, x, y, size, L.weaponBox, L.weaponLid, L.rifle, 1.5);
    if (c.dir === 'out') {
      ctx.fillStyle = L.tagOut;
      ctx.fillRect(x - size * 0.45, y + size * 0.12, size * 0.3, size * 0.22);
    }
  }

  private box(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, body: string, lid: string, mark: string, long = 1): void {
    const w = size * long;
    const h = size * (long > 1 ? 0.55 : 0.8);
    ctx.fillStyle = body;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = lid;
    ctx.fillRect(x - w / 2, y - h / 2, w, h * 0.3);
    ctx.fillStyle = mark;
    ctx.fillRect(x - w * 0.12, y, w * 0.24, h * 0.18);
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = Math.max(1, size * 0.07);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  }

  /** Мягкое красное пятно маяка — один раз в холст. */
  private glowSprite(): HTMLCanvasElement {
    if (this.glow) return this.glow;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,80,60,0.9)');
    grad.addColorStop(0.35, 'rgba(255,40,30,0.35)');
    grad.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glow = c;
    return c;
  }
}
