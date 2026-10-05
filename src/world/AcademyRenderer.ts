import type { View } from '../core/Camera';
import type { Vec2 } from '../core/math';
import type { AcademySystem } from '../systems/Academy';
import type { GameMap, Poi } from './GameMap';
import { ACADEMY_LOOK as L } from '../config/academy';

const DASH = [6, 4];
const NO_DASH: number[] = [];

/** Мебель академии по тайлам (центры, px мира) — собирается раз на карту. */
interface Furniture {
  map: GameMap;
  desks: Vec2[];
  board: Vec2[];
  line: Vec2[];
  lockers: Vec2[];
  tables: Vec2[];
  rail: Vec2[];
  turnstile: Vec2[];
  counter: Vec2[];
  headDesk: Vec2[];
}

/**
 * Академия ВС на экране (только отрисовка): плац — разметка строя, линия, флагшток с флагом Протектората;
 * тир — мишени-силуэты с кольцами на стойках, огневой рубеж (стойка) с номерами полос, разметка полос; класс —
 * доска с мелом, парты со стульями, кафедра; кубрик — двухъярусные койки и шкафчики; столовая — столы с
 * подносами и скамьями; кабинет — стол с лампой и бумагами; вахта — ограждение, турникет, стойка дежурного
 * со стеклом; надписи по трафарету. Без save/restore.
 */
export class AcademyRenderer {
  private font = '';
  private fontScale = -1;
  private f: Furniture | null = null;

  private furniture(map: GameMap): Furniture {
    if (this.f?.map === map) return this.f;
    const ts = map.tileSize;
    const c = (t: Poi['type']) => map.poisOf(t).map((p) => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts }));
    this.f = {
      map,
      desks: c('academy_desk'), board: c('academy_board'), line: c('academy_line'), lockers: c('academy_locker'), tables: c('academy_table'),
      rail: c('academy_rail'), turnstile: c('academy_turnstile'), counter: c('academy_counter'), headDesk: c('academy_head_desk'),
    };
    return this.f;
  }

  /** Пол академии и всё, что на нём (до персонажей). */
  drawGround(ctx: CanvasRenderingContext2D, v: View, A: AcademySystem, map: GameMap, now: number): void {
    const r = A.rect;
    if (!A.present || !r) return;
    const s = v.scale;
    if ((r.x + r.w - v.left) * s < 0 || (r.y + r.h - v.top) * s < 0 || (r.x - v.left) * s > v.width || (r.y - v.top) * s > v.height) return;
    const ts = map.tileSize;
    const F = this.furniture(map);
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = L.outline;

    // ——— Плац: рамка, места строя, линия перед строем ———
    const pl = A.areas.plac;
    if (pl) {
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = L.lineSoft;
      ctx.setLineDash(DASH.map((d) => d * s));
      ctx.strokeRect(X(pl.x) + 6 * s, Y(pl.y) + 6 * s, pl.w * s - 12 * s, pl.h * s - 12 * s);
      ctx.setLineDash(NO_DASH);
    }
    ctx.strokeStyle = L.mark;
    ctx.lineWidth = 1.3 * s;
    ctx.beginPath();
    for (const p of A.ranks) {
      const e = 6 * s;
      ctx.moveTo(X(p.x) - e, Y(p.y) - e);
      ctx.lineTo(X(p.x) + e, Y(p.y) - e);
      ctx.lineTo(X(p.x) + e, Y(p.y) + e);
      ctx.lineTo(X(p.x) - e, Y(p.y) + e);
      ctx.closePath();
    }
    ctx.stroke();
    if (A.front) {
      ctx.fillStyle = L.mark;
      ctx.beginPath();
      ctx.arc(X(A.front.x), Y(A.front.y), 4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Маршрут строевой — пунктир по углам.
    if (A.drillLoop.length > 2) {
      ctx.strokeStyle = L.lineSoft;
      ctx.setLineDash([3 * s, 7 * s]);
      ctx.beginPath();
      A.drillLoop.forEach((p, k) => (k ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }

    // ——— Тир: полосы, мишени, огневой рубеж ———
    ctx.lineWidth = 1 * s;
    A.lanes.forEach((l, k) => {
      ctx.strokeStyle = L.lineSoft;
      ctx.setLineDash(DASH.map((d) => d * s));
      ctx.beginPath();
      ctx.moveTo(X(l.spot.x), Y(l.spot.y));
      ctx.lineTo(X(l.target.x), Y(l.target.y));
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      // Номер полосы — на полу у места стрелка.
      ctx.fillStyle = L.mark;
      this.text(ctx, s, String(k + 1), X(l.spot.x + Math.cos(l.spot.facing + Math.PI) * 18), Y(l.spot.y + Math.sin(l.spot.facing + Math.PI) * 18));
    });
    for (const t of A.targets) this.target(ctx, X(t.x), Y(t.y), s);
    for (const p of F.line) this.plank(ctx, X(p.x), Y(p.y), ts * s, L.woodDark, L.wood);

    // ——— Класс: доска, парты, кафедра ———
    for (const p of F.board) {
      const e = (ts / 2) * s;
      ctx.fillStyle = L.boardFrame;
      ctx.fillRect(X(p.x) - e, Y(p.y) - e, e * 2, e * 2);
      ctx.fillStyle = L.board;
      ctx.fillRect(X(p.x) - e + 2 * s, Y(p.y) - e + 2 * s, e * 2 - 4 * s, e * 2 - 4 * s);
    }
    if (F.board.length) {
      ctx.strokeStyle = L.chalk;
      ctx.lineWidth = 1 * s;
      ctx.beginPath();
      F.board.forEach((p, k) => {
        const y0 = Y(p.y) - 3 * s;
        ctx.moveTo(X(p.x) - 5 * s, y0 + (k % 2) * 3 * s);
        ctx.lineTo(X(p.x) + 5 * s, y0 + (k % 2) * 3 * s);
        ctx.moveTo(X(p.x) - 4 * s, y0 + 5 * s);
        ctx.lineTo(X(p.x) + 3 * s, y0 + 5 * s);
      });
      ctx.stroke();
    }
    for (const p of F.desks) this.plank(ctx, X(p.x), Y(p.y), ts * s, L.woodDark, L.woodLight);
    for (const p of A.seats) this.stool(ctx, X(p.x), Y(p.y), s);
    if (A.lectern) {
      ctx.strokeStyle = L.outline;
      ctx.lineWidth = 1.2 * s;
      ctx.fillStyle = L.wood;
      const lx = X(A.lectern.x + Math.cos(A.lectern.facing) * 12);
      const ly = Y(A.lectern.y + Math.sin(A.lectern.facing) * 12);
      ctx.fillRect(lx - 6 * s, ly - 4 * s, 12 * s, 8 * s);
      ctx.strokeRect(lx - 6 * s, ly - 4 * s, 12 * s, 8 * s);
    }

    // ——— Кубрик: двухъярусные койки, шкафчики ———
    A.bunks.forEach((b, k) => this.bunk(ctx, X(b.x), Y(b.y), ts * s, k));
    for (const p of F.lockers) this.locker(ctx, X(p.x), Y(p.y), ts * s);

    // ——— Столовая: столы с подносами ———
    for (const p of F.tables) {
      this.plank(ctx, X(p.x), Y(p.y), ts * s, L.woodDark, L.wood);
      ctx.fillStyle = L.tray;
      ctx.fillRect(X(p.x) - 3 * s, Y(p.y) - 2.5 * s, 6 * s, 5 * s);
    }

    // ——— Кабинет: стол начальника курса с лампой и бумагами ———
    for (const p of F.headDesk) this.plank(ctx, X(p.x), Y(p.y), ts * s, L.woodDark, L.wood);
    if (F.headDesk.length) {
      const p = F.headDesk[0];
      ctx.fillStyle = L.paper;
      ctx.fillRect(X(p.x) - 4 * s, Y(p.y) - 3 * s, 7 * s, 5 * s);
      ctx.fillStyle = L.lamp;
      ctx.beginPath();
      ctx.arc(X(F.headDesk[F.headDesk.length - 1].x), Y(F.headDesk[F.headDesk.length - 1].y), 2.6 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // ——— Вахта: ограждение, турникет, стойка дежурного ———
    for (const p of F.rail) {
      const e = (ts / 2) * s;
      ctx.fillStyle = L.metalDark;
      ctx.fillRect(X(p.x) - e, Y(p.y) - 2 * s, e * 2, 4 * s);
      ctx.fillRect(X(p.x) - e, Y(p.y) - e, 4 * s, e * 2);
      ctx.fillStyle = L.metal;
      ctx.fillRect(X(p.x) - e, Y(p.y) - 1 * s, e * 2, 2 * s);
    }
    for (const p of F.turnstile) {
      ctx.fillStyle = L.metalDark;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 3 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = L.metal;
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3 + now * 0;
        ctx.moveTo(X(p.x), Y(p.y));
        ctx.lineTo(X(p.x) + Math.cos(a) * 7 * s, Y(p.y) + Math.sin(a) * 7 * s);
      }
      ctx.stroke();
    }
    for (const p of F.counter) {
      this.plank(ctx, X(p.x), Y(p.y), ts * s, L.woodDark, L.wood);
      ctx.fillStyle = L.glass;
      ctx.fillRect(X(p.x) - (ts / 2) * s, Y(p.y) - 1.5 * s, ts * s, 3 * s);
    }

    // ——— Флагшток на плацу ———
    if (A.flag) this.flag(ctx, X(A.flag.x), Y(A.flag.y), s, now);
    this.labels(ctx, v, A);
  }

  private text(ctx: CanvasRenderingContext2D, s: number, t: string, x: number, y: number): void {
    const q = Math.round(s * 8) / 8;
    if (q !== this.fontScale) {
      this.fontScale = q;
      this.font = `bold ${Math.max(6, Math.round(L.labelSize * q))}px sans-serif`;
    }
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, x, y);
  }

  /** Надписи по трафарету — у края помещения. */
  private labels(ctx: CanvasRenderingContext2D, v: View, A: AcademySystem): void {
    const s = v.scale;
    ctx.fillStyle = L.label;
    const labels: Partial<Record<string, string>> = L.labels;
    for (const [k, r] of Object.entries(A.areas)) {
      const text = labels[k];
      if (!r || !text) continue;
      this.text(ctx, s, text, (r.x + r.w / 2 - v.left) * s, (r.y + r.h - 7 - v.top) * s);
    }
  }

  /** Доска (стол, стойка) на тайле: тёмная рамка, светлая столешница. */
  private plank(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, edge: string, top: string): void {
    const e = size / 2 - 1;
    ctx.fillStyle = edge;
    ctx.fillRect(x - e, y - e, e * 2, e * 2);
    ctx.fillStyle = top;
    ctx.fillRect(x - e + 1.5, y - e + 1.5, e * 2 - 3, e * 2 - 3);
  }

  private stool(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.fillStyle = L.woodDark;
    ctx.fillRect(x - 4 * s, y - 4 * s, 8 * s, 8 * s);
  }

  /** Мишень на стойке: силуэт по пояс с кольцами. */
  private target(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    ctx.fillStyle = L.post;
    ctx.fillRect(x - 1.5 * s, y - 2 * s, 3 * s, 9 * s);
    ctx.fillStyle = L.target;
    ctx.strokeStyle = L.targetRing;
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.ellipse(x, y + 1 * s, 6 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.moveTo(x + 3 * s, y - 5 * s);
    ctx.arc(x, y - 5 * s, 3 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 1 * s, 3 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = L.targetBull;
    ctx.beginPath();
    ctx.arc(x, y + 1 * s, 1.3 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Двухъярусная койка 2×2 тайла: рама, матрасы, одеяла, подушки. */
  private bunk(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number, k: number): void {
    const e = ts - 2;
    ctx.fillStyle = L.metalDark;
    ctx.fillRect(x - e, y - e, e * 2, e * 2);
    for (const [ox, w] of [[-e + 2, e - 3], [1, e - 3]] as const) {
      ctx.fillStyle = L.mattress;
      ctx.fillRect(x + ox, y - e + 2, w, e * 2 - 4);
      ctx.fillStyle = k % 2 ? L.blanketB : L.blanket;
      ctx.fillRect(x + ox, y - e + 2 + (e * 2 - 4) * 0.3, w, (e * 2 - 4) * 0.7);
      ctx.fillStyle = L.pillow;
      ctx.fillRect(x + ox + 1, y - e + 3, w - 2, (e * 2 - 4) * 0.2);
    }
  }

  private locker(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number): void {
    const e = ts / 2 - 1;
    ctx.fillStyle = L.metalDark;
    ctx.fillRect(x - e, y - e, e * 2, e * 2);
    ctx.fillStyle = L.metal;
    ctx.fillRect(x - e + 1.5, y - e + 1.5, e * 2 - 3, e * 2 - 3);
    ctx.fillStyle = L.metalDark;
    ctx.fillRect(x - 1, y - e + 3, 2, e * 2 - 6);
  }

  /** Флагшток: тень, основание, флаг Протектората колышется на ветру. */
  private flag(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, now: number): void {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y, 22 * s, 3 * s);
    ctx.fillStyle = L.metalDark;
    ctx.beginPath();
    ctx.arc(x, y, 4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = L.flagPole;
    ctx.beginPath();
    ctx.arc(x, y, 2 * s, 0, Math.PI * 2);
    ctx.fill();
    const w = Math.sin((now / L.flagWave) * Math.PI * 2) * 2 * s;
    ctx.fillStyle = L.flag;
    ctx.beginPath();
    ctx.moveTo(x + 2 * s, y - 6 * s);
    ctx.quadraticCurveTo(x + 10 * s, y - 6 * s + w, x + 18 * s, y - 6 * s);
    ctx.lineTo(x + 18 * s, y + 4 * s);
    ctx.quadraticCurveTo(x + 10 * s, y + 4 * s + w, x + 2 * s, y + 4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = L.flagStripe;
    ctx.fillRect(x + 8 * s, y - 4 * s + w * 0.5, 3 * s, 6 * s);
  }
}
