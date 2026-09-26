import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import { STREET } from '../config/street';
import { T, SOLID } from '../world/tiles';
import { ZONE_NAMES } from '../config/names';
import { poiWorld } from './Population';

/** Бочка с огнём: где стоит и кто занял места вокруг. */
export interface Barrel {
  x: number;
  y: number;
  slots: Vec2[];
  taken: (Character | null)[];
}

/** Фонарь у стены проспекта: где столб (px мира) и куда смотрит (нормаль от стены к улице). */
export interface Lamp {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** Скамейка у стены проспекта: два места (центры якорей), нормаль от стены, кто сидит. */
export interface Bench {
  x: number;
  y: number;
  nx: number;
  ny: number;
  seats: Vec2[];
  taken: (Character | null)[];
}

/**
 * Уличная жизнь города: бочки с огнём во дворах (у них греются компании), «дома» — якоря в
 * подъездах и квартирах жилых кварталов, обращения Администратора на площади по таймеру.
 * Сами занятия — состояния CitizenBrain (chat, barrel, home, listen).
 */
export class StreetLifeSystem {
  readonly barrels: Barrel[] = [];
  /** Фонари и скамейки главного проспекта. */
  readonly lamps: Lamp[] = [];
  readonly benches: Bench[] = [];
  /** Якоря в помещениях жилых кварталов (подъезды, квартиры). */
  readonly homes: number[] = [];
  /** Идёт ли обращение и его номер (слушатель решает идти один раз на обращение). */
  broadcast = 0;
  broadcastUntil = 0;
  /** Где слушают: центр площади. */
  readonly plaza: Vec2 | null;
  private time = 0;
  private nextBroadcast: number = STREET.broadcast.first;
  private nextLine = 0;
  private line = 0;
  /** Сколько бесед и сборов у бочек было (для тестов и отладки). */
  readonly stats = { chats: 0, barrels: 0, homes: 0, listeners: 0, benches: 0, benchTalks: 0 };

  constructor(private readonly ctx: AiContext) {
    this.plaza = poiWorld(ctx, 'plaza_center');
    this.placeBarrels();
    this.placeAvenue();
    const { map, nav } = ctx;
    for (const a of nav.walkable) {
      if (map.tileAt(nav.ax(a) + 1, nav.ay(a) + 1) !== T.INTERIOR) continue;
      if (map.zones[nav.zone[a]]?.kind === 'residential') this.homes.push(a);
    }
  }

  get now(): number {
    return this.time;
  }

  get broadcasting(): boolean {
    return this.time < this.broadcastUntil;
  }

  /** Бочки — во дворах-колодцах и на широких местах жилых кварталов, не ближе minSpacing друг к другу. */
  private placeBarrels(): void {
    const B = STREET.barrel;
    const { map, nav, rng } = this.ctx;
    const open = (a: number) => {
      let n = 0;
      const ax = nav.ax(a);
      const ay = nav.ay(a);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (nav.isWalkable(ax + dx, ay + dy)) n++;
      return n;
    };
    const cands = nav.walkable.filter((a) => {
      const kind = map.zones[nav.zone[a]]?.kind;
      if (kind !== 'residential' && kind !== 'industrial') return false;
      const t = map.tileAt(nav.ax(a) + 1, nav.ay(a) + 1);
      return (t === T.COURTYARD || t === T.FLOOR || t === T.STREET) && open(a) >= B.minOpen;
    });
    rng.shuffle(cands);
    // Сначала дворы: там бочке место.
    cands.sort((a, b) => Number(map.tileAt(nav.ax(b) + 1, nav.ay(b) + 1) === T.COURTYARD) - Number(map.tileAt(nav.ax(a) + 1, nav.ay(a) + 1) === T.COURTYARD));
    for (const a of cands) {
      if (this.barrels.length >= B.count) break;
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      if (this.barrels.some((b) => Math.hypot(b.x - x, b.y - y) < B.minSpacing)) continue;
      const slots: Vec2[] = [];
      for (let k = 0; k < B.slots; k++) {
        const ang = (k / B.slots) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const s = nav.nearestWalkable(x + Math.cos(ang) * B.ringRadius, y + Math.sin(ang) * B.ringRadius, 1);
        if (s < 0) continue;
        const p = { x: nav.worldX(s), y: nav.worldY(s) };
        if (Math.hypot(p.x - x, p.y - y) < B.ringRadius * 0.6 || slots.some((q) => q.x === p.x && q.y === p.y)) continue;
        slots.push(p);
      }
      if (slots.length < 3) continue;
      this.barrels.push({ x, y, slots, taken: slots.map(() => null) });
    }
  }

  /**
   * Фонари и скамейки вдоль стен главного проспекта. Место — якорь 2×2 на плитке проспекта, за
   * которым (с одной стороны) сплошная стена; скамейка — два таких якоря подряд вдоль стены.
   * Раскладка детерминирована (без rng): одинакова при каждом запуске на той же карте.
   */
  private placeAvenue(): void {
    const A = STREET.avenue;
    const { map, nav } = this.ctx;
    const ts = map.tileSize;
    const zone = map.zones.findIndex((z) => z.kind === 'avenue' && z.name === ZONE_NAMES.avenue[0]);
    if (zone < 0) return;
    const gates = map.poisOf('gate_post').map((p) => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts }));
    const street = (x: number, y: number) => map.tileAt(x, y) === T.STREET && map.zoneGrid[y * map.width + x] === zone;
    const solid = (x: number, y: number) => x < 0 || y < 0 || x >= map.width || y >= map.height || SOLID[map.tileAt(x, y)] === 1;
    const nearDoor = (ax: number, ay: number) => {
      for (let y = ay - A.avoidDoor; y <= ay + 1 + A.avoidDoor; y++) for (let x = ax - A.avoidDoor; x <= ax + 1 + A.avoidDoor; x++) if (map.tileAt(x, y) === T.DOOR) return true;
      return false;
    };
    // Стороны: нормаль от стены к улице.
    const sides = [
      { nx: 0, ny: 1, wall: (ax: number, ay: number) => solid(ax, ay - 1) && solid(ax + 1, ay - 1) },
      { nx: 0, ny: -1, wall: (ax: number, ay: number) => solid(ax, ay + 2) && solid(ax + 1, ay + 2) },
      { nx: 1, ny: 0, wall: (ax: number, ay: number) => solid(ax - 1, ay) && solid(ax - 1, ay + 1) },
      { nx: -1, ny: 0, wall: (ax: number, ay: number) => solid(ax + 2, ay) && solid(ax + 2, ay + 1) },
    ];
    interface Spot { ax: number; ay: number; x: number; y: number; nx: number; ny: number }
    const spots: Spot[] = [];
    const key = new Map<number, Spot>();
    for (const a of nav.walkable) {
      const ax = nav.ax(a);
      const ay = nav.ay(a);
      if (!street(ax, ay) || !street(ax + 1, ay) || !street(ax, ay + 1) || !street(ax + 1, ay + 1)) continue;
      const side = sides.find((sd) => sd.wall(ax, ay));
      if (!side || nearDoor(ax, ay)) continue;
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      if (gates.some((g) => Math.hypot(g.x - x, g.y - y) < A.avoidGate)) continue;
      const sp = { ax, ay, x, y, nx: side.nx, ny: side.ny };
      spots.push(sp);
      key.set((ay * map.width + ax) * 4 + sides.indexOf(side), sp);
    }
    // Вдоль проспекта: сперва по одной оси, потом по другой.
    spots.sort((p, q) => p.ay - q.ay || p.ax - q.ax);
    const far = (list: readonly Vec2[], x: number, y: number, d: number) => list.every((o) => Math.hypot(o.x - x, o.y - y) >= d);
    for (const sp of spots) {
      if (this.lamps.length >= A.lampMax) break;
      // Столб — у самой стены, на середине якоря.
      const x = sp.x - sp.nx * (ts - 4);
      const y = sp.y - sp.ny * (ts - 4);
      if (far(this.lamps, x, y, A.lampEvery)) this.lamps.push({ x, y, nx: sp.nx, ny: sp.ny });
    }
    for (const sp of spots) {
      if (this.benches.length >= A.benchMax) break;
      // Второе место — через якорь вдоль стены (32 px): двое сидят рядом, не толкаясь.
      const tx = sp.ny !== 0 ? 2 : 0;
      const ty = sp.nx !== 0 ? 2 : 0;
      const side = sides.findIndex((sd) => sd.nx === sp.nx && sd.ny === sp.ny);
      const other = key.get(((sp.ay + ty) * map.width + sp.ax + tx) * 4 + side);
      if (!other) continue;
      const x = (sp.x + other.x) / 2 - sp.nx * (ts - 6);
      const y = (sp.y + other.y) / 2 - sp.ny * (ts - 6);
      if (!far(this.benches, x, y, A.benchEvery) || !far(this.lamps, x, y, A.gap)) continue;
      this.benches.push({ x, y, nx: sp.nx, ny: sp.ny, seats: [{ x: sp.x, y: sp.y }, { x: other.x, y: other.y }], taken: [null, null] });
    }
  }

  /** Сесть на скамейку: ближайшая со свободным местом (где уже сидят — привлекательнее). */
  takeBenchSeat(c: Character): { bench: Bench; seat: number } | null {
    const B = STREET.bench;
    let best: Bench | null = null;
    let bestScore = Infinity;
    for (const b of this.benches) {
      const d = Math.hypot(b.x - c.x, b.y - c.y);
      if (d > B.seek) continue;
      const free = b.taken.filter((t) => !t || !t.alive).length;
      if (!free) continue;
      const score = d - (free === 1 ? B.company : 0);
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (!best) return null;
    const seat = best.taken.findIndex((t) => !t || !t.alive);
    best.taken[seat] = c;
    this.stats.benches++;
    return { bench: best, seat };
  }

  releaseBenchSeat(c: Character): void {
    for (const b of this.benches) b.taken.forEach((t, k) => t === c && (b.taken[k] = null));
  }

  /** Занять место у ближайшей бочки со свободным местом (в пределах seek). */
  takeBarrelSlot(c: Character): { barrel: Barrel; slot: number } | null {
    let best: Barrel | null = null;
    let bestD: number = STREET.barrel.seek;
    for (const b of this.barrels) {
      const d = Math.hypot(b.x - c.x, b.y - c.y);
      if (d < bestD && b.taken.some((t) => !t || !t.alive)) {
        best = b;
        bestD = d;
      }
    }
    if (!best) return null;
    const slot = best.taken.findIndex((t) => !t || !t.alive);
    best.taken[slot] = c;
    this.stats.barrels++;
    return { barrel: best, slot };
  }

  releaseBarrelSlot(c: Character): void {
    for (const b of this.barrels) b.taken.forEach((t, k) => t === c && (b.taken[k] = null));
  }

  /** Дом поблизости (якорь в помещении жилого квартала) или -1. */
  homeNear(c: Character): number {
    const { nav, rng } = this.ctx;
    const r = STREET.home.seek * nav.map.tileSize;
    for (let k = 0; k < 12 && this.homes.length; k++) {
      const a = this.homes[Math.floor(rng.next() * this.homes.length)];
      if (Math.hypot(nav.worldX(a) - c.x, nav.worldY(a) - c.y) < r) {
        this.stats.homes++;
        return a;
      }
    }
    return -1;
  }

  update(dt: number): void {
    this.time += dt;
    const B = STREET.broadcast;
    const ctx = this.ctx;
    // Во время красного кода обращений нет (комендантский час, свои объявления).
    if (!this.plaza || ctx.war.curfew) return;
    if (this.time >= this.nextBroadcast) {
      this.nextBroadcast = this.time + B.every;
      this.broadcast++;
      this.broadcastUntil = this.time + B.duration;
      this.nextLine = this.time;
      ctx.bus.emit('announce', { text: 'Обращение Администратора · площадь' });
    }
    if (this.broadcasting && this.time >= this.nextLine) {
      this.nextLine = this.time + B.lineEvery;
      const lines = STREET.broadcastLines;
      ctx.bus.emit('log', { text: lines[this.line++ % lines.length], kind: 'world' });
    }
  }
}
