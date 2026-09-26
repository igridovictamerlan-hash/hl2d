import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import { STREET } from '../config/street';
import { T } from '../world/tiles';
import { poiWorld } from './Population';

/** Бочка с огнём: где стоит и кто занял места вокруг. */
export interface Barrel {
  x: number;
  y: number;
  slots: Vec2[];
  taken: (Character | null)[];
}

/**
 * Уличная жизнь города: бочки с огнём во дворах (у них греются компании), «дома» — якоря в
 * подъездах и квартирах жилых кварталов, обращения Администратора на площади по таймеру.
 * Сами занятия — состояния CitizenBrain (chat, barrel, home, listen).
 */
export class StreetLifeSystem {
  readonly barrels: Barrel[] = [];
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
  readonly stats = { chats: 0, barrels: 0, homes: 0, listeners: 0 };

  constructor(private readonly ctx: AiContext) {
    this.plaza = poiWorld(ctx, 'plaza_center');
    this.placeBarrels();
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
