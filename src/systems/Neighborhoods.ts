/** Описание системы — docs/population.md. */
import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import { HOODS } from '../config/crowd';
import { T, SOLID } from '../world/tiles';
import { randomAnchorAround } from '../ai/destinations';

/** Районный центр жилого квартала: место, где «свои» гуляют, встречаются и делают дела. */
export interface Hub {
  /** id зоны квартала. */
  zone: number;
  name: string;
  x: number;
  y: number;
}

/** Тайлы под открытым небом, на которых стоит районный центр (не в помещении, не в дверях). */
const OPEN = new Set<number>([T.FLOOR, T.STREET, T.PLAZA, T.COURTYARD, T.ARCH]);

/**
 * Люди живут своим районом (HOODS): у каждого жилого квартала — районный центр (самое просторное место у его
 * середины). Прогулка горожанина — у своего дома и районного центра, в центр города — изредка; ушёл далеко от
 * дома — идёт к нему. Раньше каждая третья прогулка из любого конца города шла на площадь раздачи, и
 * вечером половина города стояла у Управы. В безголовых тестах выключено (enabled = false): прежнее поведение.
 */
export class Neighborhoods {
  readonly hubs: Hub[] = [];
  /** id зоны → районный центр. */
  private readonly byZone = new Map<number, Hub>();
  /** Центр площади раздачи (центр города). */
  readonly plaza: Vec2 | null;
  enabled = true;

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const ts = map.tileSize;
    const pc = map.poisOf('plaza_center')[0];
    this.plaza = pc ? { x: (pc.x + 0.5) * ts, y: (pc.y + 0.5) * ts } : null;
    const H = HOODS;
    for (const z of map.zones) {
      if (z.kind !== 'residential') continue;
      const anchors = nav.anchorsByZone.get(z.id);
      if (!anchors || anchors.length < H.minAnchors) continue;
      let sx = 0;
      let sy = 0;
      for (const a of anchors) {
        sx += nav.worldX(a);
        sy += nav.worldY(a);
      }
      const cx = sx / anchors.length;
      const cy = sy / anchors.length;
      let best = -1;
      let bestScore = -Infinity;
      for (const a of anchors) {
        const x = nav.worldX(a);
        const y = nav.worldY(a);
        const d = Math.hypot(x - cx, y - cy) / ts;
        if (d > H.seek) continue;
        const tx = Math.floor(x / ts);
        const ty = Math.floor(y / ts);
        if (!OPEN.has(map.tileAt(tx, ty))) continue;
        let open = 0;
        for (let dy = -H.open; dy <= H.open; dy++) {
          for (let dx = -H.open; dx <= H.open; dx++) {
            const t = map.tileAt(tx + dx, ty + dy);
            if (SOLID[t] === 0 && t !== T.INTERIOR) open++;
          }
        }
        const score = open - d * H.per;
        if (score > bestScore) {
          bestScore = score;
          best = a;
        }
      }
      if (best < 0) continue;
      const hub: Hub = { zone: z.id, name: z.name, x: nav.worldX(best), y: nav.worldY(best) };
      this.hubs.push(hub);
      this.byZone.set(z.id, hub);
    }
  }

  /** Районный центр точки: своего квартала, иначе ближайший. */
  hubAt(x: number, y: number): Hub | null {
    const z = this.ctx.map.zoneAtWorld(x, y);
    const own = z ? this.byZone.get(z.id) : undefined;
    if (own) return own;
    let best: Hub | null = null;
    let bestD = Infinity;
    for (const h of this.hubs) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  /** Дом жителя (или где он сейчас, если дома нет). */
  homeOf(c: Character): Vec2 {
    return this.ctx.housing?.of(c)?.at ?? c;
  }

  /** Районный центр жителя — по его дому. */
  hubOf(c: Character): Hub | null {
    const h = this.homeOf(c);
    return this.hubAt(h.x, h.y);
  }

  /** У районного центра жителя (не дальше HOODS.local тайлов). -1 — не нашлось. */
  localGoal(c: Character, avoid: ReadonlySet<number>): number {
    const hub = this.hubOf(c) ?? this.homeOf(c);
    return randomAnchorAround(hub, this.ctx, 0, HOODS.local, avoid);
  }

  /** У своего дома (HOODS.home тайлов). -1 — не нашлось. */
  homeGoal(c: Character, avoid: ReadonlySet<number>): number {
    return randomAnchorAround(this.homeOf(c), this.ctx, HOODS.home[0], HOODS.home[1], avoid);
  }

  /** Вокруг себя (HOODS.wander тайлов), а ушёл от дома дальше HOODS.leash — к дому. */
  wanderGoal(c: Character, avoid: ReadonlySet<number>): number {
    const home = this.homeOf(c);
    if (Math.hypot(home.x - c.x, home.y - c.y) > HOODS.leash * this.ctx.map.tileSize) return this.homeGoal(c, avoid);
    return randomAnchorAround(c, this.ctx, HOODS.wander[0], HOODS.wander[1], avoid);
  }

  /** Центр города: точка на площади раздачи или рядом. -1 — нет площади. */
  centerGoal(avoid: ReadonlySet<number>): number {
    if (!this.plaza) return -1;
    return randomAnchorAround(this.plaza, this.ctx, 0, 14, avoid);
  }
}
