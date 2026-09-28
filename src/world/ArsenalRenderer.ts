import type { View } from '../core/Camera';
import type { ArsenalSystem, Crate, Slot } from '../systems/Arsenal';
import { ARSENAL, ARSENAL_LOOK as L } from '../config/arsenal';

const DASH = [6, 4];
const NO_DASH: number[] = [];

/**
 * Склад Альянса на экране (только отрисовка; что видно — то и лежит в ячейках): стеллажи зала с
 * ящиками патронов, решётчатый отсек с гранатами, стойки со стволами, расходный стеллаж у окна,
 * мастерская (верстак: ствол в работе, искры; ящики стволов в консервации), бытовка, контора,
 * караулка; крыльцо — жёлто-чёрная кромка, круг посадки, места сброса, мачты прожекторов, шлагбаум в
 * проёме, маяк; ящики на крыльце и в руках; пункты боепитания в проходных КПП; корабль с тенью.
 * Без save/restore и сборки строк на кадр.
 */
export class ArsenalRenderer {
  private glow: HTMLCanvasElement | null = null;
  /** Шрифт надписей на полу — пересобирается только при смене масштаба. */
  private font = '';
  private fontScale = -1;

  /** Пол склада и всё, что на нём (до персонажей); пункты КПП; тень корабля. */
  drawGround(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, ts: number, now: number): void {
    if (!A.present || !A.rect) return;
    const s = v.scale;
    const r = A.rect;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    for (const p of A.points) {
      const px = X(p.x);
      const py = Y(p.y);
      if (px > -60 && py > -60 && px < v.width + 60 && py < v.height + 60) this.point(ctx, px, py, s, p.kits, p.grenades);
    }
    const on = X(r.x + r.w) >= 0 && Y(r.y + r.h) >= 0 && X(r.x) <= v.width && Y(r.y) <= v.height;
    if (on) {
      this.floorMarks(ctx, v, A);
      this.porch(ctx, v, A, ts, now);
      this.furniture(ctx, v, A, ts, now);
      for (const sl of A.slots) this.slot(ctx, X(sl.x), Y(sl.y), s, ts, sl);
      this.vaultBars(ctx, v, A, ts);
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

  /** Груз в руках грузчиков и оружейника (поверх пешек). */
  drawCarried(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, alpha: number): void {
    if (!A.present) return;
    const s = v.scale;
    for (const [c, crate] of A.carriedCrates) {
      if (!c.visible || !c.alive) continue;
      const x = c.prevX + (c.x - c.prevX) * alpha;
      const y = c.prevY + (c.y - c.prevY) * alpha;
      const px = (x + Math.cos(c.facing) * 5 - v.left) * s;
      const py = (y + Math.sin(c.facing) * 5 - 3 - v.top) * s;
      if (crate.kind === 'gun') this.gun(ctx, px, py, s, Math.abs(Math.cos(c.facing)) > 0.7 ? 0 : Math.PI / 2, crate.broken);
      else this.crate(ctx, px, py, L.carried * s, crate);
    }
  }

  /** Свечение маяка и ламп мачт (после света суток; туман закроет, если не видно). */
  drawGlow(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, now: number): void {
    if (!A.present) return;
    const s = v.scale;
    const g = this.glowSprite();
    ctx.globalCompositeOperation = 'lighter';
    if (A.beacon && !A.beaconBroken && this.blink(now)) {
      const x = (A.beacon.x - v.left) * s;
      const y = (A.beacon.y - v.top) * s;
      const R = 26 * s;
      if (x > -R && y > -R && x < v.width + R && y < v.height + R) ctx.drawImage(g, x - R, y - R, R * 2, R * 2);
    }
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

  /**
   * Разметка пола: жёлтая рамка проходов в зале, красная — в отсеке гранат, место приёмки на крыльце,
   * надписи по трафарету у нижней стены каждого помещения.
   */
  private floorMarks(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem): void {
    const s = v.scale;
    const F = L.floor;
    const e = F.inset * s;
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash(DASH.map((d) => d * s));
    for (const r of A.rooms) {
      if (r.kind !== 'hall' && r.kind !== 'vault') continue;
      ctx.strokeStyle = r.kind === 'hall' ? F.lane : F.vault;
      ctx.strokeRect((r.x - v.left) * s + e, (r.y - v.top) * s + e, r.w * s - 2 * e, r.h * s - 2 * e);
    }
    const rs = A.receiveSpot;
    if (rs) {
      ctx.strokeStyle = F.receive;
      ctx.strokeRect((rs.x - 40 - v.left) * s, (rs.y - 18 - v.top) * s, 80 * s, 36 * s);
    }
    ctx.setLineDash(NO_DASH);
    const q = Math.round(s * 8) / 8;
    if (q !== this.fontScale) {
      this.fontScale = q;
      this.font = `bold ${Math.max(6, Math.round(F.labelSize * q))}px sans-serif`;
    }
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = F.label;
    for (const r of A.rooms) {
      if (r.kind === 'pad') {
        if (rs) ctx.fillText(F.labels.pad, (rs.x - v.left) * s, (rs.y + 26 - v.top) * s);
        continue;
      }
      ctx.fillText(F.labels[r.kind], (r.x + r.w / 2 - v.left) * s, (r.y + r.h - 9 - v.top) * s);
    }
  }

  /** Крыльцо: жёлто-чёрная кромка вдоль ограды, круг посадки, места сброса, мачты, шлагбаум, маяк. */
  private porch(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, ts: number, now: number): void {
    const r = A.padRect;
    if (!r || !A.pad) return;
    const s = v.scale;
    const x = (r.x - v.left) * s;
    const y = (r.y - v.top) * s;
    const w = r.w * s;
    const h = r.h * s;
    // Кромка: сплошная жёлтая и поверх — чёрные штрихи.
    ctx.lineWidth = 4 * s;
    ctx.strokeStyle = L.padMark;
    ctx.strokeRect(x + 3 * s, y + 3 * s, w - 6 * s, h - 6 * s);
    ctx.strokeStyle = L.hazard;
    ctx.setLineDash(DASH.map((d) => d * s));
    ctx.strokeRect(x + 3 * s, y + 3 * s, w - 6 * s, h - 6 * s);
    ctx.setLineDash(NO_DASH);
    // Круг посадки: два кольца и крест, по кругу — метки-шевроны.
    const cx = (A.pad.x - v.left) * s;
    const cy = (A.pad.y - v.top) * s;
    const R = L.padRing * s;
    ctx.strokeStyle = L.padLine;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.moveTo(cx + R * 0.62, cy);
    ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
    ctx.moveTo(cx - R * 0.35, cy);
    ctx.lineTo(cx + R * 0.35, cy);
    ctx.moveTo(cx, cy - R * 0.35);
    ctx.lineTo(cx, cy + R * 0.35);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const c = Math.cos(a);
      const n = Math.sin(a);
      ctx.moveTo(cx + c * R * 0.78 - n * 5 * s, cy + n * R * 0.78 + c * 5 * s);
      ctx.lineTo(cx + c * R * 0.9, cy + n * R * 0.9);
      ctx.lineTo(cx + c * R * 0.78 + n * 5 * s, cy + n * R * 0.78 - c * 5 * s);
    }
    ctx.stroke();
    // Места сброса — уголки.
    ctx.strokeStyle = L.dropMark;
    ctx.lineWidth = 1.2 * s;
    const hh = ts / 2;
    ctx.beginPath();
    for (const d of A.drops) {
      const dx = (d.x - v.left) * s;
      const dy = (d.y - v.top) * s;
      const e = hh * s;
      const k = 4 * s;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.moveTo(dx + sx * e, dy + sy * (e - k));
        ctx.lineTo(dx + sx * e, dy + sy * e);
        ctx.lineTo(dx + sx * (e - k), dy + sy * e);
      }
    }
    ctx.stroke();
    // Мачты прожекторов: опора и плафон.
    for (const m of A.masts) {
      const mx = (m.x - v.left) * s;
      const my = (m.y - v.top) * s;
      ctx.fillStyle = L.mast;
      ctx.beginPath();
      ctx.arc(mx, my, 5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = L.lamp;
      ctx.beginPath();
      ctx.arc(mx, my, 2.6 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Шлагбаум в проёме: стойки по краям и полосатая стрела поперёк.
    if (A.gate) {
      const gx = (A.gate.x - v.left) * s;
      const gy = (A.gate.y - v.top) * s;
      const half = 3 * ts * s;
      const horiz = A.gateDir.y !== 0;
      const ax = horiz ? gx - half : gx;
      const ay = horiz ? gy : gy - half;
      const bx = horiz ? gx + half : gx;
      const by = horiz ? gy : gy + half;
      ctx.lineWidth = 3 * s;
      ctx.strokeStyle = L.boom;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.strokeStyle = L.boomStripe;
      ctx.setLineDash(DASH.map((d) => d * s));
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      ctx.fillStyle = L.mast;
      ctx.fillRect(ax - 3 * s, ay - 3 * s, 6 * s, 6 * s);
      ctx.fillRect(bx - 3 * s, by - 3 * s, 6 * s, 6 * s);
    }
    // Маяк: мигает красным; сломан — тёмный и искрит.
    const b = A.beacon;
    if (b) {
      const bx = (b.x - v.left) * s;
      const by = (b.y - v.top) * s;
      ctx.fillStyle = L.beaconBase;
      ctx.beginPath();
      ctx.arc(bx, by, 5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = A.beaconBroken ? L.beaconOff : this.blink(now) ? L.beaconOn : L.beaconOff;
      ctx.beginPath();
      ctx.arc(bx, by, 2.8 * s, 0, Math.PI * 2);
      ctx.fill();
      if (A.beaconBroken && (now * 5) % 1 < 0.2) {
        ctx.fillStyle = L.spark;
        ctx.fillRect(bx + 3 * s, by - 4 * s, 1.5 * s, 1.5 * s);
      }
    }
  }

  /** Ячейка: стеллаж (зал, отсек), стойка у стены, расходный стеллаж, ящик на ремонт — и что в ней. */
  private slot(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ts: number, sl: Slot): void {
    const h = (ts / 2) * s;
    const c = sl.crate;
    if (sl.area === 'rack') {
      // Стойка у стены: планка вдоль стены и крюки; ствол — вдоль стены.
      const along = sl.wy !== 0;
      const ox = sl.wx * h * 0.55;
      const oy = sl.wy * h * 0.55;
      ctx.fillStyle = L.rackWall;
      if (along) ctx.fillRect(x - h, y + oy - 2 * s, h * 2, 4 * s);
      else ctx.fillRect(x + ox - 2 * s, y - h, 4 * s, h * 2);
      if (c) this.gun(ctx, x + ox * 0.4, y + oy * 0.4, s, along ? 0 : Math.PI / 2, c.broken);
      return;
    }
    if (sl.area === 'repair') {
      // Открытый ящик со стволами в смазке.
      ctx.fillStyle = L.bench;
      ctx.fillRect(x - h + s, y - h + 2 * s, h * 2 - 2 * s, h * 2 - 4 * s);
      ctx.strokeStyle = L.outline;
      ctx.lineWidth = s;
      ctx.strokeRect(x - h + s, y - h + 2 * s, h * 2 - 2 * s, h * 2 - 4 * s);
      const n = c && c.kind === 'weapons' ? c.left : 0;
      ctx.fillStyle = L.rifle;
      for (let k = 0; k < n; k++) ctx.fillRect(x - h + 3 * s, y - h + (4 + k * 3.5) * s, h * 2 - 6 * s, 1.8 * s);
      return;
    }
    // Стеллаж: стальная рама, доски; ящик сверху.
    ctx.fillStyle = sl.area === 'shelf' ? L.counter : L.shelfDark;
    ctx.fillRect(x - h, y - h, h * 2, h * 2);
    ctx.fillStyle = L.shelf;
    ctx.fillRect(x - h + s, y - h + s, h * 2 - 2 * s, h * 2 - 2 * s);
    ctx.fillStyle = L.shelfBoard;
    ctx.fillRect(x - h + s, y - 0.5 * s, h * 2 - 2 * s, s);
    if (!c) return;
    if (c.kind === 'gun') this.gun(ctx, x, y, s, 0, c.broken);
    else this.crate(ctx, x, y, (ts - 3) * s, c);
  }

  /** Решётка гранатного отсека на двери: заперта — прутья. */
  private vaultBars(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, ts: number): void {
    if (A.vaultOpen) return;
    const s = v.scale;
    const h = (ts / 2) * s;
    ctx.strokeStyle = L.cage;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    for (const d of A.vaultDoorTiles) {
      const x = (d.x - v.left) * s;
      const y = (d.y - v.top) * s;
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(x - h, y + k * h * 0.6);
        ctx.lineTo(x + h, y + k * h * 0.6);
        ctx.moveTo(x + k * h * 0.6, y - h);
        ctx.lineTo(x + k * h * 0.6, y + h);
      }
    }
    ctx.stroke();
  }

  /** Мебель: окно выдачи, стол кладовщика, стол описи, стол бытовки, койки, верстак (ствол, искры). */
  private furniture(ctx: CanvasRenderingContext2D, v: View, A: ArsenalSystem, ts: number, now: number): void {
    const s = v.scale;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    const h = ts / 2;
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = s;
    for (const w of A.windowTiles) {
      ctx.fillStyle = L.counter;
      ctx.fillRect(X(w.x - h), Y(w.y - h), ts * s, ts * s);
      ctx.fillStyle = L.glass;
      ctx.fillRect(X(w.x - 2), Y(w.y - h), 4 * s, ts * s);
    }
    if (A.desk) {
      const d = A.desk;
      ctx.fillStyle = L.desk;
      ctx.fillRect(X(d.x - 7), Y(d.y - 14), 14 * s, 28 * s);
      ctx.strokeRect(X(d.x - 7), Y(d.y - 14), 14 * s, 28 * s);
      ctx.fillStyle = L.screen;
      ctx.fillRect(X(d.x - 4), Y(d.y - 11), 8 * s, 6 * s);
      ctx.fillStyle = L.paper;
      ctx.fillRect(X(d.x - 4), Y(d.y + 1), 8 * s, 10 * s);
      ctx.fillStyle = L.ammoMark;
      ctx.fillRect(X(d.x - 2), Y(d.y + 6), 4 * s, 2 * s);
    }
    if (A.ledgerDesk) {
      const d = A.ledgerDesk;
      ctx.fillStyle = L.deskTop;
      ctx.fillRect(X(d.x - 14), Y(d.y - 6), 28 * s, 13 * s);
      ctx.strokeRect(X(d.x - 14), Y(d.y - 6), 28 * s, 13 * s);
      ctx.fillStyle = L.paper;
      ctx.fillRect(X(d.x - 11), Y(d.y - 4), 7 * s, 9 * s);
      ctx.fillRect(X(d.x - 2), Y(d.y - 3), 6 * s, 8 * s);
      ctx.fillStyle = L.rifleWood;
      ctx.fillRect(X(d.x + 6), Y(d.y - 4), 6 * s, 9 * s);
    }
    // Стол бытовки: столешница, кружки, термос.
    if (A.tables.length) {
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const t of A.tables) {
        x0 = Math.min(x0, t.x);
        x1 = Math.max(x1, t.x);
      }
      const ty = A.tables[0].y;
      ctx.fillStyle = L.table;
      ctx.fillRect(X(x0 - h + 1), Y(ty - h + 2), (x1 - x0 + ts - 2) * s, (ts - 4) * s);
      ctx.strokeRect(X(x0 - h + 1), Y(ty - h + 2), (x1 - x0 + ts - 2) * s, (ts - 4) * s);
      ctx.fillStyle = L.tableTop;
      ctx.fillRect(X(x0 - h + 2), Y(ty - h + 3), (x1 - x0 + ts - 4) * s, 2 * s);
      ctx.fillStyle = L.mug;
      for (let k = 0; k < A.tables.length; k += 2) {
        ctx.beginPath();
        ctx.arc(X(A.tables[k].x), Y(ty), 2 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const c of A.cots) {
      ctx.fillStyle = L.cot;
      ctx.fillRect(X(c.x - 6), Y(c.y - 7), 12 * s, 22 * s);
      ctx.fillStyle = L.blanket;
      ctx.fillRect(X(c.x - 5), Y(c.y), 10 * s, 14 * s);
      ctx.fillStyle = L.pillow;
      ctx.fillRect(X(c.x - 4), Y(c.y - 6), 8 * s, 4 * s);
    }
    // Верстак: доски, тиски; ствол в работе — на верстаке, летят искры.
    if (A.benchTiles.length) {
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const b of A.benchTiles) {
        x0 = Math.min(x0, b.x);
        x1 = Math.max(x1, b.x);
      }
      const by = A.benchTiles[0].y;
      ctx.fillStyle = L.bench;
      ctx.fillRect(X(x0 - h), Y(by - 6), (x1 - x0 + ts) * s, 12 * s);
      ctx.strokeRect(X(x0 - h), Y(by - 6), (x1 - x0 + ts) * s, 12 * s);
      ctx.fillStyle = L.benchTop;
      ctx.fillRect(X(x0 - h), Y(by - 6), (x1 - x0 + ts) * s, 3 * s);
      ctx.fillStyle = L.vise;
      ctx.fillRect(X(x0 - 4), Y(by - 4), 8 * s, 6 * s);
      if (A.workbench.gun) {
        const mx = (x0 + x1) / 2;
        this.gun(ctx, X(mx), Y(by), s, 0, A.workbench.progress < 0.5);
        if ((now * 7) % 1 < 0.35) {
          ctx.fillStyle = L.spark;
          const k = (now * 13) % 1;
          ctx.fillRect(X(mx + 6 + k * 4), Y(by - 3 - k * 5), 1.5 * s, 1.5 * s);
          ctx.fillRect(X(mx + 3 - k * 3), Y(by - 5 - k * 3), 1.2 * s, 1.2 * s);
        }
        // Полоска готовности.
        ctx.fillStyle = L.padMark;
        ctx.fillRect(X(x0 - h), Y(by + 7), (x1 - x0 + ts) * s * A.workbench.progress, 2 * s);
      }
    }
  }

  /** Пункт боепитания КПП: стопка ящиков по числу комплектов, гранаты — оливковые. */
  private point(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, kits: number, grenades: number): void {
    const ammo = Math.ceil(kits / ARSENAL.perCrate.ammo);
    const g = Math.ceil(grenades / ARSENAL.perCrate.grenades);
    const size = 11 * s;
    let k = 0;
    const put = (body: string, lid: string, mark: string) => {
      const col = k % 3;
      const row = Math.floor(k / 3);
      this.box(ctx, x + (col - 1) * size * 1.05, y - row * size * 0.55, size, body, lid, mark);
      k++;
    };
    for (let i = 0; i < ammo; i++) put(L.ammoBox, L.ammoLid, L.ammoMark);
    for (let i = 0; i < g; i++) put(L.grenadeBox, L.grenadeLid, L.grenadeMark);
    if (!k) {
      ctx.strokeStyle = L.dropMark;
      ctx.lineWidth = s;
      ctx.strokeRect(x - size * 1.6, y - size * 0.6, size * 3.2, size * 1.2);
    }
  }

  /** Ящик по виду. */
  private crate(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, c: Crate): void {
    if (c.kind === 'ammo') this.box(ctx, x, y, size, L.ammoBox, L.ammoLid, L.ammoMark);
    else if (c.kind === 'grenades') this.box(ctx, x, y, size, L.grenadeBox, L.grenadeLid, L.grenadeMark);
    else this.box(ctx, x, y, size, L.weaponBox, L.weaponLid, L.rifle, 1.5);
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

  /** Ствол (сверху): приклад, ствольная коробка, магазин; в консервации — в серой смазке. */
  private gun(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ang: number, broken: boolean): void {
    const c = Math.cos(ang) * s;
    const n = Math.sin(ang) * s;
    const seg = (a: number, b: number, w: number, col: string) => {
      ctx.fillStyle = col;
      // Прямоугольник вдоль оси ствола: от a до b, толщина w (без поворота холста — по двум осям).
      const x0 = x + c * a;
      const y0 = y + n * a;
      const x1 = x + c * b;
      const y1 = y + n * b;
      ctx.fillRect(Math.min(x0, x1) - (Math.abs(n) * w) / 2, Math.min(y0, y1) - (Math.abs(c) * w) / 2, Math.abs(x1 - x0) + Math.abs(n) * w, Math.abs(y1 - y0) + Math.abs(c) * w);
    };
    const body = broken ? L.weaponLid : L.rifle;
    seg(-7, -3, 3, broken ? L.weaponBox : L.rifleWood);
    seg(-3, 4, 2.6, body);
    seg(4, 9, 1.4, body);
    seg(0, 1.5, 3.6, body);
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
