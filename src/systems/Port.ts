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
  /** Куда смотрит нос (у причала — face причала, на ходу — по ходу). */
  heading: 'N' | 'S' | 'E' | 'W';
  moving: boolean;
}

/**
 * Баржи порта (груз — systems/Supply.ts через onArrive/onDepart): у каждого причала (POI `barge_berth`) своя баржа — стоит, отходит
 * от пирса к фарватеру (POI `channel`: x — столбец фарватера, ряды — протока), идёт по реке к протоке и протокой на
 * восток за край, возвращается тем же путём. Своя случайность — общая не сдвигается.
 */
export class PortSystem {
  readonly barges: Barge[] = [];
  /** Сколько раз баржа вернулась к причалу. */
  arrivals = 0;
  /** Река перекрыта (Supply: красный код, прорыв, шлюз закрыт) — ушедшие баржи не возвращаются. */
  blocked = false;
  /** Баржа встала к причалу (Supply: разгрузка) и отошла от него. */
  onArrive: ((b: Barge) => void) | null = null;
  onDepart: ((b: Barge) => void) | null = null;
  private readonly rng: Rng;
  /** Фарватер (px): столбец, ряд протоки, конец пути за краем. */
  private readonly laneX: number;
  private readonly exitY: number;
  private readonly exitX: number;
  private readonly ts: number;
  private time = 0;

  constructor(map: GameMap, seed: number) {
    this.rng = new Rng((seed ^ 0xba59e) >>> 0);
    const ts = map.tileSize;
    this.ts = ts;
    const ch = map.poisOf('channel')[0];
    this.laneX = ch ? (ch.x + 0.5) * ts : 0;
    this.exitY = ch ? (ch.y + ch.h! / 2) * ts : 0;
    this.exitX = ch ? (ch.x + ch.w! + PORT.exitPast) * ts : 0;
    for (const berth of map.poisOf('barge_berth')) {
      const b: Barge = { berth, phase: 'moored', d: 0, until: this.rng.range(0, PORT.moored[1]), x: 0, y: 0, heading: face(berth), moving: false };
      this.place(b);
      this.barges.push(b);
    }
  }

  /** Причал (центр стоянки) и длины участков: к фарватеру, по реке, протокой за край. */
  private legs(b: Barge): { bx: number; by: number; l1: number; l2: number; total: number } {
    const p = b.berth;
    const bx = (p.x + p.w! / 2) * this.ts;
    const by = (p.y + p.h! / 2) * this.ts;
    const l1 = Math.abs(this.laneX - bx);
    const l2 = Math.abs(this.exitY - by);
    return { bx, by, l1, l2, total: l1 + l2 + Math.max(0, this.exitX - this.laneX) };
  }

  private place(b: Barge): void {
    const { bx, by, l1, l2 } = this.legs(b);
    const out = b.phase !== 'in';
    const sx = this.laneX > bx ? 1 : -1;
    const sy = this.exitY > by ? 1 : -1;
    // Нос — по ходу: назад к причалу кормой вперёд не ходят — разворот на фарватере.
    const dirX = (k: number): Barge['heading'] => (k > 0 ? 'E' : 'W');
    const dirY = (k: number): Barge['heading'] => (k > 0 ? 'S' : 'N');
    if (b.d < l1) {
      b.x = bx + sx * b.d;
      b.y = by;
      b.heading = b.phase === 'moored' ? face(b.berth) : dirX(out ? sx : -sx);
    } else if (b.d < l1 + l2) {
      b.x = this.laneX;
      b.y = by + sy * (b.d - l1);
      b.heading = dirY(out ? sy : -sy);
    } else {
      b.x = this.laneX + (b.d - l1 - l2);
      b.y = this.exitY;
      b.heading = out ? 'E' : 'W';
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.barges) {
      const { total } = this.legs(b);
      b.moving = b.phase === 'out' || b.phase === 'in';
      if (b.phase === 'moored' && this.time >= b.until) {
        b.phase = 'out';
        this.onDepart?.(b);
      }
      else if (b.phase === 'out') {
        b.d += PORT.speed * dt;
        if (b.d >= total) {
          b.d = total;
          b.phase = 'away';
          b.until = this.time + this.rng.range(PORT.away[0], PORT.away[1]);
        }
      } else if (b.phase === 'away' && this.time >= b.until && !this.blocked) b.phase = 'in';
      else if (b.phase === 'in') {
        b.d -= PORT.speed * dt;
        if (b.d <= 0) {
          b.d = 0;
          b.phase = 'moored';
          b.until = this.time + this.rng.range(PORT.moored[0], PORT.moored[1]);
          this.arrivals++;
          this.onArrive?.(b);
        }
      }
      this.place(b);
    }
  }
}

const face = (p: Poi): Barge['heading'] => (p.face === 'N' || p.face === 'S' || p.face === 'E' ? p.face : 'W');
