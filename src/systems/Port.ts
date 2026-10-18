import { PORT } from '../config/port';
import { Rng } from '../core/rng';
import type { GameMap, Poi } from '../world/GameMap';

export type BargePhase = 'moored' | 'out' | 'away' | 'in';

export interface Barge {
  berth: Poi;
  phase: BargePhase;
  /** Пройдено по пути от причала (px) и когда кончается стоянка или отлучка (часы порта). */
  d: number;
  until: number;
  x: number;
  y: number;
  /** Куда смотрит нос: 'N' | 'S' у причала и на выходе к фарватеру, 'E' | 'W' на фарватере. */
  heading: 'N' | 'S' | 'E' | 'W';
  moving: boolean;
}

/**
 * Баржи порта (картинка, на логику мира не влияет): у каждого причала (POI `barge_berth`) своя баржа — стоит, отходит
 * к фарватеру посередине водохранилища, уходит на восток за край, возвращается. Своя случайность — общая не сдвигается.
 */
export class PortSystem {
  readonly barges: Barge[] = [];
  /** Сколько раз баржа вернулась к причалу. */
  arrivals = 0;
  private readonly rng: Rng;
  private readonly lane: number;
  private readonly exitX: number;
  private time = 0;

  constructor(map: GameMap, seed: number) {
    this.rng = new Rng((seed ^ 0xba59e) >>> 0);
    const ts = map.tileSize;
    const res = map.poisOf('reservoir')[0];
    this.lane = res ? (res.y + res.h! / 2) * ts : 0;
    this.exitX = res ? (res.x + res.w! + PORT.exitPast) * ts : 0;
    for (const berth of map.poisOf('barge_berth')) {
      const b: Barge = { berth, phase: 'moored', d: 0, until: this.rng.range(0, PORT.moored[1]), x: 0, y: 0, heading: berth.face === 'N' ? 'N' : 'S', moving: false };
      this.place(b, ts);
      this.barges.push(b);
    }
    this.ts = ts;
  }

  private readonly ts: number;

  /** Причал (центр стоянки) и длина пути: к фарватеру, потом по нему за край. */
  private legs(b: Barge, ts: number): { bx: number; by: number; l1: number; total: number } {
    const p = b.berth;
    const bx = (p.x + p.w! / 2) * ts;
    const by = (p.y + p.h! / 2) * ts;
    const l1 = Math.abs(this.lane - by);
    return { bx, by, l1, total: l1 + Math.max(0, this.exitX - bx) };
  }

  private place(b: Barge, ts: number): void {
    const { bx, by, l1 } = this.legs(b, ts);
    const toLane = this.lane > by ? 1 : -1;
    const outbound = b.phase !== 'in';
    if (b.d < l1) {
      b.x = bx;
      b.y = by + toLane * b.d;
      // Нос — по ходу: от причала к фарватеру, назад к причалу кормой вперёд не ходят — разворот на фарватере.
      b.heading = (outbound ? toLane : -toLane) > 0 ? 'S' : 'N';
      if (b.phase === 'moored') b.heading = b.berth.face === 'N' ? 'N' : 'S';
    } else {
      b.x = bx + (b.d - l1);
      b.y = this.lane;
      b.heading = outbound ? 'E' : 'W';
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.barges) {
      const { total } = this.legs(b, this.ts);
      b.moving = b.phase === 'out' || b.phase === 'in';
      if (b.phase === 'moored' && this.time >= b.until) b.phase = 'out';
      else if (b.phase === 'out') {
        b.d += PORT.speed * dt;
        if (b.d >= total) {
          b.d = total;
          b.phase = 'away';
          b.until = this.time + this.rng.range(PORT.away[0], PORT.away[1]);
        }
      } else if (b.phase === 'away' && this.time >= b.until) b.phase = 'in';
      else if (b.phase === 'in') {
        b.d -= PORT.speed * dt;
        if (b.d <= 0) {
          b.d = 0;
          b.phase = 'moored';
          b.until = this.time + this.rng.range(PORT.moored[0], PORT.moored[1]);
          this.arrivals++;
        }
      }
      this.place(b, this.ts);
    }
  }
}
