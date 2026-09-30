import type { View } from '../core/Camera';
import type { Vec2 } from '../core/math';
import type { PrisonSystem, PrisonRoomKind } from '../systems/Prison';
import type { Cell } from '../systems/LawSystem';
import type { GameMap } from './GameMap';
import type { DoorGroup } from '../systems/DoorSystem';
import { PRISON, PRISON_LOOK as L } from '../config/prison';
import { ARSENAL, ARSENAL_LOOK as AL } from '../config/arsenal';
import { WEAPONS, type WeaponId } from '../config/items';
import { RENDER } from '../config/render';
import { T } from './tiles';

const DASH = [6, 4];
const NO_DASH: number[] = [];

/**
 * Тюрьма Альянса на экране (только отрисовка): двухъярусные нары, унитаз и раковина в камерах; стойка
 * оформления с перегородкой и монитором, место задержанного, скамья, рамка металлоискателя у входа;
 * койки, стол и шкафчики караулки; стол начальника с лампой, ковёр, шкаф, знамя; стол допросной с
 * лампой и стульями; стеллажи изъятого; оружейная — стойки со стволами (сколько в запасе) и стеллажи с
 * ящиками патронов и гранат, огонёк замка на двери; решётки шлюза и разметка; двор — посадочная площадка
 * (кромка, круг, места сброса, мачты, мигающие маяки); надписи по трафарету. Без save/restore: повороты
 * через setTransform, в конце — единичная матрица.
 */
export class PrisonRenderer {
  private glow: HTMLCanvasElement | null = null;
  private font = '';
  private fontScale = -1;

  /** Пол тюрьмы и всё, что на нём (до персонажей). */
  drawGround(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem, cells: readonly Cell[], map: GameMap, evidence: number, now: number): void {
    const r = P.rect;
    if (!P.present || !r) return;
    const s = v.scale;
    if ((r.x + r.w - v.left) * s < 0 || (r.y + r.h - v.top) * s < 0 || (r.x - v.left) * s > v.width || (r.y - v.top) * s > v.height) return;
    const ts = map.tileSize;
    this.floorMarks(ctx, v, P);
    this.pad(ctx, v, P, ts, now);
    for (const c of cells) if (c.prison) this.cell(ctx, v, c, ts);
    this.reception(ctx, v, P, map);
    this.guardroom(ctx, v, P, map);
    this.office(ctx, v, P, map);
    this.interrogation(ctx, v, P);
    this.evidence(ctx, v, P, map, evidence);
    this.armory(ctx, v, P, map, now);
    for (const d of P.sallyDoors) this.grate(ctx, v, d, ts);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.labels(ctx, v, P);
  }

  /** Мигающие посадочные маяки двора (после света суток). */
  drawGlow(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem, now: number): void {
    if (!P.present || !P.beacons.length) return;
    const s = v.scale;
    const g = this.glowSprite();
    ctx.globalCompositeOperation = 'lighter';
    P.beacons.forEach((b, k) => {
      if (!this.blink(now, k)) return;
      const x = (b.x - v.left) * s;
      const y = (b.y - v.top) * s;
      const R = 24 * s;
      if (x > -R && y > -R && x < v.width + R && y < v.height + R) ctx.drawImage(g, x - R, y - R, R * 2, R * 2);
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  private blink(now: number, k: number): boolean {
    const B = PRISON.beacon.blink;
    return (now + (k * B) / 2) % B < B * 0.5;
  }

  /** Локальная система координат: начало o (px мира), ось u — по (ux, uy), ось w — поперёк. */
  private frame(ctx: CanvasRenderingContext2D, v: View, o: Vec2, ux: number, uy: number): void {
    const s = v.scale;
    ctx.setTransform(ux * s, uy * s, -uy * s, ux * s, (o.x - v.left) * s, (o.y - v.top) * s);
  }

  /** Прямоугольник вокруг тайлов (центры) — px мира. */
  private bbox(tiles: readonly Vec2[], ts: number): { x: number; y: number; w: number; h: number } | null {
    if (!tiles.length) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const t of tiles) {
      x0 = Math.min(x0, t.x);
      y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x);
      y1 = Math.max(y1, t.y);
    }
    const h = ts / 2;
    return { x: x0 - h, y: y0 - h, w: x1 - x0 + ts, h: y1 - y0 + ts };
  }

  /** Сторона стены у тайла мебели (единичный вектор к стене) или null. */
  private wallSide(map: GameMap, p: Vec2): Vec2 | null {
    const ts = map.tileSize;
    const tx = Math.floor(p.x / ts);
    const ty = Math.floor(p.y / ts);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const t = map.tileAt(tx + dx, ty + dy);
      if (map.isSolid(tx + dx, ty + dy) && t !== T.BARRIER && t !== T.DOOR) return { x: dx, y: dy };
    }
    return null;
  }

  private rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, line = true): void {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    if (line) ctx.strokeRect(x, y, w, h);
  }

  // ————— Разметка и надписи —————

  private floorMarks(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem): void {
    const s = v.scale;
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash(DASH.map((d) => d * s));
    for (const r of P.rooms) {
      if (r.kind !== 'armory' && r.kind !== 'sally') continue;
      const e = 4 * s;
      ctx.strokeStyle = r.kind === 'armory' ? L.laneRed : L.laneSally;
      ctx.strokeRect((r.x - v.left) * s + e, (r.y - v.top) * s + e, r.w * s - 2 * e, r.h * s - 2 * e);
    }
    // Место задержанного у стойки: жёлтый квадрат и следы.
    const it = P.intakeSpot;
    if (it) {
      ctx.strokeStyle = L.laneSally;
      ctx.strokeRect((it.x - 12 - v.left) * s, (it.y - 12 - v.top) * s, 24 * s, 24 * s);
    }
    ctx.setLineDash(NO_DASH);
    if (it) {
      ctx.fillStyle = L.laneSally;
      for (const dx of [-4, 4]) ctx.fillRect((it.x + dx - 2 - v.left) * s, (it.y - 4 - v.top) * s, 4 * s, 8 * s);
    }
  }

  /** Надписи по трафарету — поверх мебели, у стены помещения. */
  private labels(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem): void {
    const s = v.scale;
    const q = Math.round(s * 8) / 8;
    if (q !== this.fontScale) {
      this.fontScale = q;
      this.font = `bold ${Math.max(6, Math.round(L.labelSize * q))}px sans-serif`;
    }
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = L.label;
    for (const r of P.rooms) {
      const label = L.labels[r.kind as PrisonRoomKind];
      if (r.kind === 'yard') {
        if (P.pad) ctx.fillText(label, (P.pad.x - v.left) * s, (P.pad.y + L.padRing + 9 - v.top) * s);
        continue;
      }
      // Надпись — вдоль длинной стороны, у стены.
      const x = r.x + r.w / 2;
      const y = r.y + r.h - 8;
      ctx.fillText(label, (x - v.left) * s, (y - v.top) * s);
    }
  }

  // ————— Двор-площадка —————

  private pad(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem, ts: number, now: number): void {
    const r = P.padRect;
    const s = v.scale;
    if (r) {
      // Кромка площадки: жёлтая с чёрными штрихами.
      const x = (r.x - v.left) * s;
      const y = (r.y - v.top) * s;
      ctx.lineWidth = 3 * s;
      ctx.strokeStyle = AL.padMark;
      ctx.strokeRect(x + 4 * s, y + 4 * s, r.w * s - 8 * s, r.h * s - 8 * s);
      ctx.strokeStyle = AL.hazard;
      ctx.setLineDash(DASH.map((d) => d * s));
      ctx.strokeRect(x + 4 * s, y + 4 * s, r.w * s - 8 * s, r.h * s - 8 * s);
      ctx.setLineDash(NO_DASH);
    }
    if (P.pad) {
      // Круг посадки: два кольца, крест, шевроны.
      const cx = (P.pad.x - v.left) * s;
      const cy = (P.pad.y - v.top) * s;
      const R = L.padRing * s;
      ctx.strokeStyle = AL.padLine;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.moveTo(cx + R * 0.6, cy);
      ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2);
      ctx.moveTo(cx - R * 0.32, cy);
      ctx.lineTo(cx + R * 0.32, cy);
      ctx.moveTo(cx, cy - R * 0.32);
      ctx.lineTo(cx, cy + R * 0.32);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + Math.PI / 8;
        const c = Math.cos(a);
        const n = Math.sin(a);
        ctx.moveTo(cx + c * R * 0.76 - n * 4 * s, cy + n * R * 0.76 + c * 4 * s);
        ctx.lineTo(cx + c * R * 0.9, cy + n * R * 0.9);
        ctx.lineTo(cx + c * R * 0.76 + n * 4 * s, cy + n * R * 0.76 - c * 4 * s);
      }
      ctx.stroke();
    }
    // Места сброса — уголки.
    ctx.strokeStyle = AL.dropMark;
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    const e = (ts / 2) * s;
    const k = 4 * s;
    for (const d of P.drops) {
      const dx = (d.x - v.left) * s;
      const dy = (d.y - v.top) * s;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.moveTo(dx + sx * e, dy + sy * (e - k));
        ctx.lineTo(dx + sx * e, dy + sy * e);
        ctx.lineTo(dx + sx * (e - k), dy + sy * e);
      }
    }
    ctx.stroke();
    // Мачты прожекторов.
    for (const m of P.masts) {
      const mx = (m.x - v.left) * s;
      const my = (m.y - v.top) * s;
      ctx.fillStyle = AL.mast;
      ctx.beginPath();
      ctx.arc(mx, my, 5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = AL.lamp;
      ctx.beginPath();
      ctx.arc(mx, my, 2.6 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Посадочные маяки — мигают поочерёдно.
    P.beacons.forEach((b, i) => {
      const bx = (b.x - v.left) * s;
      const by = (b.y - v.top) * s;
      ctx.fillStyle = AL.beaconBase;
      ctx.fillRect(bx - 5 * s, by - 5 * s, 10 * s, 10 * s);
      ctx.fillStyle = this.blink(now, i) ? AL.beaconOn : AL.beaconOff;
      ctx.beginPath();
      ctx.arc(bx, by, 3 * s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ————— Камеры —————

  /** Камера: у дальней от двери стены — унитаз и раковина, вдоль длинных стен — двухъярусные нары. */
  private cell(ctx: CanvasRenderingContext2D, v: View, c: Cell, ts: number): void {
    const b = c.bounds;
    const X0 = b.x0 * ts;
    const Y0 = b.y0 * ts;
    const W = (b.x1 - b.x0 + 1) * ts;
    const H = (b.y1 - b.y0 + 1) * ts;
    const d = c.door;
    if (!d) return;
    let o: Vec2;
    let ux = 0;
    let uy = 0;
    let len: number;
    let wid: number;
    if (d.x >= X0 + W) [o, ux, len, wid] = [{ x: X0, y: Y0 + H / 2 }, 1, W, H];
    else if (d.x <= X0) [o, ux, len, wid] = [{ x: X0 + W, y: Y0 + H / 2 }, -1, W, H];
    else if (d.y >= Y0 + H) [o, uy, len, wid] = [{ x: X0 + W / 2, y: Y0 }, 1, H, W];
    else [o, uy, len, wid] = [{ x: X0 + W / 2, y: Y0 + H }, -1, H, W];
    this.frame(ctx, v, o, ux, uy);
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = 1;
    const hw = wid / 2;
    // Унитаз: бачок у стены и чаша; раковина рядом.
    const tw = -hw + 8;
    this.rect(ctx, 1, tw - 4, 4, 8, L.toiletDark);
    ctx.fillStyle = L.toilet;
    ctx.beginPath();
    ctx.ellipse(9, tw, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = L.toiletDark;
    ctx.beginPath();
    ctx.ellipse(9.5, tw, 2.6, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    this.rect(ctx, 1, hw - 11, 6, 8, L.sink);
    // Нары: рама, матрас, подушка у дальней стены, одеяло; второй ярус — сдвинутый контур и лесенка.
    if (len < 56) return;
    for (const side of [-1, 1]) {
      const w0 = side < 0 ? -hw + 2 : hw - 18;
      const u0 = 18;
      const bl = Math.min(34, len - 30);
      this.rect(ctx, u0, w0, bl, 16, L.bunkFrame);
      this.rect(ctx, u0 + 1.5, w0 + 1.5, bl - 3, 13, L.mattress, false);
      this.rect(ctx, u0 + 2, w0 + 3, 6, 10, L.pillow, false);
      this.rect(ctx, u0 + 12, w0 + 2, bl - 14, 12, L.blanket, false);
      ctx.strokeStyle = L.bunk;
      ctx.strokeRect(u0 - 1.5, w0 - 1.5, bl, 16);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        ctx.moveTo(u0 + bl + 1, w0 + 3 + k * 5);
        ctx.lineTo(u0 + bl + 4, w0 + 3 + k * 5);
      }
      ctx.stroke();
      ctx.strokeStyle = L.outline;
    }
  }

  // ————— Приёмная —————

  private reception(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem, map: GameMap): void {
    const ts = map.tileSize;
    const s = v.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = s;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    // Стойка оформления: корпус, столешница, монитор и бумаги у дежурного, стекло — к задержанному.
    const c = this.bbox(P.counter, ts);
    if (c) {
      this.rect(ctx, X(c.x + 1), Y(c.y + 1), (c.w - 2) * s, (c.h - 2) * s, L.counter);
      ctx.fillStyle = L.counterTop;
      ctx.fillRect(X(c.x + 3), Y(c.y + 3), (c.w - 6) * s, (c.h - 6) * s);
      const it = P.intakeSpot;
      const vertical = c.h > c.w;
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      ctx.fillStyle = L.glass;
      if (vertical) {
        const gx = it && it.x > cx ? c.x + c.w - 3 : c.x + 1;
        ctx.fillRect(X(gx), Y(c.y + 1), 2 * s, (c.h - 2) * s);
        const mx = it && it.x > cx ? c.x + 3 : c.x + c.w - 9;
        this.rect(ctx, X(mx), Y(cy - 8), 6 * s, 7 * s, L.screen);
        this.rect(ctx, X(mx), Y(cy + 2), 6 * s, 8 * s, L.paper);
      } else {
        const gy = it && it.y > cy ? c.y + c.h - 3 : c.y + 1;
        ctx.fillRect(X(c.x + 1), Y(gy), (c.w - 2) * s, 2 * s);
        const my = it && it.y > cy ? c.y + 3 : c.y + c.h - 9;
        this.rect(ctx, X(cx - 8), Y(my), 7 * s, 6 * s, L.screen);
        this.rect(ctx, X(cx + 2), Y(my), 8 * s, 6 * s, L.paper);
      }
    }
    // Скамья для ожидающих: сиденье на ножках.
    const b = this.bbox(P.benches, ts);
    if (b) {
      const vertical = b.h > b.w;
      if (vertical) {
        this.rect(ctx, X(b.x + 3), Y(b.y + 1), (b.w - 6) * s, (b.h - 2) * s, L.bench);
        ctx.fillStyle = L.benchTop;
        ctx.fillRect(X(b.x + 4), Y(b.y + 2), (b.w - 8) * s, (b.h - 4) * s);
      } else {
        this.rect(ctx, X(b.x + 1), Y(b.y + 3), (b.w - 2) * s, (b.h - 6) * s, L.bench);
        ctx.fillStyle = L.benchTop;
        ctx.fillRect(X(b.x + 2), Y(b.y + 4), (b.w - 4) * s, (b.h - 8) * s);
      }
    }
    // Рамка металлоискателя за дверью корпуса (со стороны приёмной).
    const f = this.bbox(P.frontDoor, ts);
    const rec = P.rooms.find((q) => q.kind === 'reception');
    if (f && rec) {
      const horiz = f.w > f.h;
      const dcx = f.x + f.w / 2;
      const dcy = f.y + f.h / 2;
      const rx = rec.x + rec.w / 2;
      const ry = rec.y + rec.h / 2;
      const nx = horiz ? 0 : Math.sign(rx - dcx);
      const ny = horiz ? Math.sign(ry - dcy) : 0;
      const fx = dcx + nx * 22;
      const fy = dcy + ny * 22;
      const ax = horiz ? 1 : 0;
      const ay = horiz ? 0 : 1;
      const half = 14;
      ctx.fillStyle = L.detector;
      ctx.fillRect(X(fx - ax * half - 3), Y(fy - ay * half - 3), 6 * s, 6 * s);
      ctx.fillRect(X(fx + ax * half - 3), Y(fy + ay * half - 3), 6 * s, 6 * s);
      ctx.fillRect(X(fx - ax * half - (ax ? 0 : 1.5)), Y(fy - ay * half - (ay ? 0 : 1.5)), (ax * half * 2 + (ax ? 0 : 3)) * s, (ay * half * 2 + (ay ? 0 : 3)) * s);
      ctx.fillStyle = L.detectorLight;
      ctx.fillRect(X(fx - ax * half - 1), Y(fy - ay * half - 1), 2 * s, 2 * s);
    }
  }

  // ————— Караулка —————

  private guardroom(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem, map: GameMap): void {
    const ts = map.tileSize;
    const s = v.scale;
    // Койки — изголовьем к стене.
    for (const c of P.cots) {
      const w = this.wallSide(map, c) ?? { x: 0, y: -1 };
      this.frame(ctx, v, { x: c.x + w.x * (ts / 2), y: c.y + w.y * (ts / 2) }, -w.x, -w.y);
      ctx.strokeStyle = L.outline;
      ctx.lineWidth = 1;
      this.rect(ctx, 0, -6, 24, 12, L.cot);
      this.rect(ctx, 1.5, -4.5, 5, 9, L.pillow, false);
      this.rect(ctx, 9, -5, 14, 10, L.blanket, false);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = s;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    // Стол: столешница, кружки, карты; табуреты по длинным сторонам.
    const t = this.bbox(P.tables, ts);
    if (t) {
      const horiz = t.w >= t.h;
      for (const k of [0.3, 0.7]) {
        ctx.fillStyle = L.chair;
        if (horiz) {
          ctx.fillRect(X(t.x + t.w * k - 3), Y(t.y - 5), 6 * s, 5 * s);
          ctx.fillRect(X(t.x + t.w * k - 3), Y(t.y + t.h), 6 * s, 5 * s);
        } else {
          ctx.fillRect(X(t.x - 5), Y(t.y + t.h * k - 3), 5 * s, 6 * s);
          ctx.fillRect(X(t.x + t.w), Y(t.y + t.h * k - 3), 5 * s, 6 * s);
        }
      }
      this.rect(ctx, X(t.x + 1), Y(t.y + 1), (t.w - 2) * s, (t.h - 2) * s, L.table);
      ctx.fillStyle = L.tableTop;
      ctx.fillRect(X(t.x + 2), Y(t.y + 2), (t.w - 4) * s, 2 * s);
      ctx.fillStyle = AL.mug;
      ctx.beginPath();
      ctx.arc(X(t.x + t.w * 0.3), Y(t.y + t.h / 2), 2 * s, 0, Math.PI * 2);
      ctx.arc(X(t.x + t.w * 0.72), Y(t.y + t.h / 2 + 1), 2 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = L.paper;
      ctx.fillRect(X(t.x + t.w / 2 - 3), Y(t.y + t.h / 2 - 2), 5 * s, 4 * s);
    }
    // Шкафчики: две дверцы, решётка вентиляции.
    for (const l of P.lockers) {
      this.rect(ctx, X(l.x - 7), Y(l.y - 7), 14 * s, 14 * s, L.locker);
      ctx.fillStyle = L.lockerLine;
      ctx.fillRect(X(l.x - 0.5), Y(l.y - 7), s, 14 * s);
      for (let k = 0; k < 3; k++) {
        ctx.fillRect(X(l.x - 5), Y(l.y - 5 + k * 2), 3 * s, 0.8 * s);
        ctx.fillRect(X(l.x + 2), Y(l.y - 5 + k * 2), 3 * s, 0.8 * s);
      }
    }
  }

  // ————— Кабинет начальника —————

  private office(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem, map: GameMap): void {
    const ts = map.tileSize;
    const s = v.scale;
    const room = P.rooms.find((q) => q.kind === 'office');
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = s;
    if (room) {
      // Ковёр посередине, шкаф с делами в углу.
      const rw = room.w * 0.5;
      const rh = room.h * 0.5;
      this.rect(ctx, X(room.x + (room.w - rw) / 2), Y(room.y + (room.h - rh) / 2), rw * s, rh * s, L.rugEdge, false);
      ctx.fillStyle = L.rug;
      ctx.fillRect(X(room.x + (room.w - rw) / 2 + 3), Y(room.y + (room.h - rh) / 2 + 3), (rw - 6) * s, (rh - 6) * s);
      this.rect(ctx, X(room.x + 2), Y(room.y + 2), 12 * s, 10 * s, L.cabinet);
      ctx.fillStyle = L.lockerLine;
      ctx.fillRect(X(room.x + 4), Y(room.y + 6), 8 * s, 0.8 * s);
    }
    const d = this.bbox(P.deskTiles, ts);
    if (d) {
      this.rect(ctx, X(d.x + 1), Y(d.y + 2), (d.w - 2) * s, (d.h - 4) * s, L.desk);
      ctx.fillStyle = L.deskTop;
      ctx.fillRect(X(d.x + 2), Y(d.y + 3), (d.w - 4) * s, 2 * s);
      ctx.fillStyle = L.paper;
      ctx.fillRect(X(d.x + d.w * 0.3), Y(d.y + d.h / 2 - 3), 7 * s, 6 * s);
      ctx.fillStyle = L.lamp;
      ctx.beginPath();
      ctx.arc(X(d.x + d.w * 0.78), Y(d.y + d.h / 2), 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
      // Знамя Альянса на стене за столом.
      if (room) {
        const cx = room.x + room.w / 2;
        const cy = room.y + room.h / 2;
        const dx = d.x + d.w / 2 - cx;
        const dy = d.y + d.h / 2 - cy;
        let bx: number;
        let by: number;
        let bw = 10;
        let bh = 4;
        if (Math.abs(dx) / room.w > Math.abs(dy) / room.h) {
          bx = dx > 0 ? room.x + room.w - 4 : room.x;
          by = cy - 5;
          bw = 4;
          bh = 10;
        } else {
          bx = cx - 5;
          by = dy > 0 ? room.y + room.h - 4 : room.y;
        }
        this.rect(ctx, X(bx), Y(by), bw * s, bh * s, L.flag);
        ctx.fillStyle = L.flagMark;
        ctx.fillRect(X(bx + bw / 2 - 1), Y(by + bh / 2 - 1), 2 * s, 2 * s);
      }
    }
  }

  // ————— Допросная —————

  private interrogation(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem): void {
    const d = this.bbox(P.itable, 16);
    if (!d) return;
    const s = v.scale;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = s;
    const vertical = d.h > d.w;
    // Стол у стены; стулья — по концам (допрашиваемый и следователь друг напротив друга).
    ctx.fillStyle = L.chair;
    if (vertical) {
      ctx.fillRect(X(d.x + d.w / 2 - 4), Y(d.y - 7), 8 * s, 6 * s);
      ctx.fillRect(X(d.x + d.w / 2 - 4), Y(d.y + d.h + 1), 8 * s, 6 * s);
    } else {
      ctx.fillRect(X(d.x - 7), Y(d.y + d.h / 2 - 4), 6 * s, 8 * s);
      ctx.fillRect(X(d.x + d.w + 1), Y(d.y + d.h / 2 - 4), 6 * s, 8 * s);
    }
    this.rect(ctx, X(d.x + 1), Y(d.y + 1), (d.w - 2) * s, (d.h - 2) * s, L.table);
    ctx.fillStyle = L.tableTop;
    ctx.fillRect(X(d.x + 2), Y(d.y + 2), (d.w - 4) * s, (d.h - 4) * s);
    ctx.fillStyle = L.paper;
    ctx.fillRect(X(d.x + d.w / 2 - 3), Y(d.y + d.h / 2 - 4), 6 * s, 8 * s);
    ctx.fillStyle = L.lamp;
    ctx.beginPath();
    ctx.arc(X(d.x + (vertical ? d.w / 2 : d.w - 5)), Y(d.y + (vertical ? d.h - 5 : d.h / 2)), 2.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // ————— Изъятое —————

  private evidence(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem, map: GameMap, count: number): void {
    const s = v.scale;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    const h = map.tileSize / 2;
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = s;
    // Постоянные коробки дел + по мешку на каждого, чьё изъятое здесь.
    let bags = 2 + count;
    for (const q of P.evidenceShelves) {
      this.rect(ctx, X(q.x - h), Y(q.y - h), h * 2 * s, h * 2 * s, L.shelfDark, false);
      ctx.fillStyle = L.shelf;
      ctx.fillRect(X(q.x - h + 1), Y(q.y - h + 1), (h * 2 - 2) * s, (h * 2 - 2) * s);
      for (let k = 0; k < 2 && bags > 0; k++, bags--) {
        const bx = q.x - 5 + k * 5;
        const by = q.y - 4 + k * 3;
        this.rect(ctx, X(bx - 3), Y(by - 3), 7 * s, 6 * s, L.evidenceBag);
        ctx.fillStyle = L.evidenceTag;
        ctx.fillRect(X(bx), Y(by - 2), 2 * s, 2 * s);
      }
    }
  }

  // ————— Оружейная —————

  private armory(ctx: CanvasRenderingContext2D, v: View, P: PrisonSystem, map: GameMap, now: number): void {
    const s = v.scale;
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    const h = map.tileSize / 2;
    ctx.strokeStyle = L.outline;
    ctx.lineWidth = s;
    // Стойки: панель у стены, крюки; ствол — если есть в запасе.
    P.racks.forEach((r, k) => {
      const along = r.wy !== 0;
      // Панель у стены (перфорированная), ствол висит вдоль неё.
      ctx.fillStyle = L.rack;
      if (along) ctx.fillRect(X(r.x - h), Y(r.y + (r.wy > 0 ? h - 7 : -h)), h * 2 * s, 7 * s);
      else ctx.fillRect(X(r.x + (r.wx > 0 ? h - 7 : -h)), Y(r.y - h), 7 * s, h * 2 * s);
      const px = r.x + r.wx * (h - 4);
      const py = r.y + r.wy * (h - 4);
      ctx.fillStyle = L.rackHook;
      if (along) {
        ctx.fillRect(X(r.x - 5), Y(py - 1), 1.5 * s, 2 * s);
        ctx.fillRect(X(r.x + 4), Y(py - 1), 1.5 * s, 2 * s);
      } else {
        ctx.fillRect(X(px - 1), Y(r.y - 5), 2 * s, 1.5 * s);
        ctx.fillRect(X(px - 1), Y(r.y + 4), 2 * s, 1.5 * s);
      }
      if (k < P.stock.guns) this.gun(ctx, X(px), Y(py), s, !along, P.rackWeapon(k));
    });
    // Стеллажи боекомплекта: ящики патронов, потом гранат — по два на полку.
    let ammo = Math.ceil(P.stock.kits / ARSENAL.perCrate.ammo);
    let gren = Math.ceil(P.stock.grenades / ARSENAL.perCrate.grenades);
    for (const q of P.shelves) {
      ctx.fillStyle = L.shelfDark;
      ctx.fillRect(X(q.x - h), Y(q.y - h), h * 2 * s, h * 2 * s);
      ctx.fillStyle = L.shelf;
      ctx.fillRect(X(q.x - h + 1), Y(q.y - h + 1), (h * 2 - 2) * s, (h * 2 - 2) * s);
      ctx.fillStyle = L.shelfBoard;
      ctx.fillRect(X(q.x - h + 1), Y(q.y - 0.5), (h * 2 - 2) * s, s);
      for (let k = 0; k < 2; k++) {
        const y = q.y - 3.5 + k * 7;
        if (ammo > 0) {
          ammo--;
          this.box(ctx, X(q.x), Y(y), 11 * s, AL.ammoBox, AL.ammoLid, AL.ammoMark);
        } else if (gren > 0) {
          gren--;
          this.box(ctx, X(q.x), Y(y), 11 * s, AL.grenadeBox, AL.grenadeLid, AL.grenadeMark);
        }
      }
    }
    // Огонёк замка у двери: красный — заперто, зелёный — открыто, выбита — искрит.
    const d = P.armoryDoor;
    const f = P.armoryFront;
    if (d && f) {
      const lx = d.x + (f.x - d.x) * 0.35 + (Math.abs(f.x - d.x) > Math.abs(f.y - d.y) ? 0 : d.half + 3);
      const ly = d.y + (f.y - d.y) * 0.35 + (Math.abs(f.x - d.x) > Math.abs(f.y - d.y) ? d.half + 3 : 0);
      const broken = P.armoryBrokenUntil > now;
      ctx.fillStyle = broken ? AL.spark : P.armoryLocked ? AL.beaconOn : L.detectorLight;
      ctx.beginPath();
      ctx.arc(X(lx), Y(ly), 1.8 * s, 0, Math.PI * 2);
      ctx.fill();
      if (broken && (now * 6) % 1 < 0.3) ctx.fillRect(X(lx + 2), Y(ly - 3), 1.4 * s, 1.4 * s);
    }
  }

  /** Решётка шлюза: закрыта — прутья поперёк проёма и рама. */
  private grate(ctx: CanvasRenderingContext2D, v: View, d: DoorGroup, ts: number): void {
    if (!d.closed) return;
    const s = v.scale;
    const C = RENDER.effects.cage;
    const x0 = Math.round((d.bounds.x0 * ts - v.left) * s);
    const y0 = Math.round((d.bounds.y0 * ts - v.top) * s);
    const x1 = Math.round(((d.bounds.x1 + 1) * ts - v.left) * s);
    const y1 = Math.round(((d.bounds.y1 + 1) * ts - v.top) * s);
    const w = x1 - x0;
    const h = y1 - y0;
    const vertical = h > w;
    ctx.fillStyle = C.floor;
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = C.bar;
    const bw = Math.max(1, s * 1.2);
    const step = C.step * s;
    if (vertical) for (let by = y0 + step / 2; by < y1; by += step) ctx.fillRect(x0, by - bw / 2, w, bw);
    else for (let bx = x0 + step / 2; bx < x1; bx += step) ctx.fillRect(bx - bw / 2, y0, bw, h);
    ctx.fillStyle = C.frame;
    const t = Math.max(1.5, 2 * s);
    if (vertical) {
      ctx.fillRect(x0, y0, w, t);
      ctx.fillRect(x0, y1 - t, w, t);
    } else {
      ctx.fillRect(x0, y0, t, h);
      ctx.fillRect(x1 - t, y0, t, h);
    }
  }

  private box(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, body: string, lid: string, mark: string): void {
    const w = size;
    const h = size * 0.55;
    ctx.fillStyle = body;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = lid;
    ctx.fillRect(x - w / 2, y - h / 2, w, h * 0.3);
    ctx.fillStyle = mark;
    ctx.fillRect(x - w * 0.12, y, w * 0.24, h * 0.2);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  }

  /** Ствол на стойке (сверху): длина и цвет по классу — винтовка, ПП, пистолет, дробовик. */
  private gun(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, vertical: boolean, id: WeaponId): void {
    const cls = WEAPONS[id].class;
    const len = cls === 'pistol' || cls === 'magnum' ? 8 : cls === 'smg' ? 12 : 15;
    const wood = cls === 'rifle' || cls === 'shotgun';
    const seg = (a: number, b: number, w: number, col: string) => {
      ctx.fillStyle = col;
      if (vertical) ctx.fillRect(x - (w * s) / 2, y + a * s, w * s, (b - a) * s);
      else ctx.fillRect(x + a * s, y - (w * s) / 2, (b - a) * s, w * s);
    };
    const half = len / 2;
    seg(-half, -half + len * 0.3, 3.4, wood ? AL.rifleWood : AL.rifle);
    seg(-half + len * 0.3, half - len * 0.25, 3, AL.rifle);
    seg(half - len * 0.25, half, 1.6, AL.rifle);
    if (cls !== 'pistol' && cls !== 'magnum') seg(-1, 1.5, 4.4, AL.rifle);
  }

  private glowSprite(): HTMLCanvasElement {
    if (this.glow) return this.glow;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,90,70,0.9)');
    grad.addColorStop(0.35, 'rgba(255,50,40,0.35)');
    grad.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glow = c;
    return c;
  }
}
