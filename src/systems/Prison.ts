import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Cell } from './LawSystem';
import { isUnderground } from './LawSystem';
import { PRISON } from '../config/prison';
import { randomAnchorAround } from '../ai/destinations';
import { T } from '../world/tiles';

/** Пост охраны тюрьмы: точка и куда смотреть. */
export interface PrisonPost {
  x: number;
  y: number;
  facing: number;
}

/** Боец армии сопротивления (не подполье): его выручает армия при выходе в город. */
export function isArmy(c: Character): boolean {
  const k = c.role?.kind;
  return c.faction === 'rebel' && (k === 'army' || k === 'leader' || k === 'hydra' || (!k && !isUnderground(c)));
}

/**
 * Тюрьма Альянса: посты охраны (SU.GUARD, роль jailer) и их обход, кабинет начальника — третьего
 * инспектора SU.INSP (роль warden: допрос подпольщиков у камеры, обход корпуса), ворота. Камеры и
 * заключённые — в LawSystem (Cell.prison), изъятое — LawSystem.evidence. Решает, когда армия при выходе
 * в город идёт не на Нексус, а выручать своих (rescue).
 */
export class PrisonSystem {
  readonly present: boolean;
  readonly posts: PrisonPost[] = [];
  /** Место начальника за столом допросной. */
  readonly desk: Vec2 | null = null;
  /** Центр здания и зона тюрьмы. */
  readonly center: Vec2 | null = null;
  private readonly zone: number = -1;
  /** Армия идёт на тюрьму (а не на Нексус); сколько сидело, когда решили. */
  rescue = false;
  private rescueFrom = 0;
  readonly stats = { rescues: 0, freedByArmy: 0, freedByUnderground: 0, assaults: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const ts = map.tileSize;
    const p = map.poisOf('prison')[0];
    this.present = !!p && ctx.law.hasPrison;
    if (!p || p.w == null || p.h == null) return;
    this.center = { x: (p.x + p.w / 2) * ts, y: (p.y + p.h / 2) * ts };
    this.zone = map.zoneAtTile(p.x, p.y)?.id ?? -1;
    const gate = ctx.law.prisonGate;
    // Центр блока камер — туда смотрят посты коридора.
    const cells = ctx.law.prisonCells;
    const block = cells.length ? { x: cells.reduce((n, c) => n + c.x, 0) / cells.length, y: cells.reduce((n, c) => n + c.y, 0) / cells.length } : this.center;
    for (const q of map.poisOf('prison_post')) {
      const a = nav.nearestWalkable((q.x + 0.5) * ts, (q.y + 0.5) * ts, 2);
      if (a < 0) continue;
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      // Во дворе (бетон) — лицом к воротам, в коридоре — вдоль коридора к камерам.
      const yard = map.tileAt(q.x, q.y) === T.BUNKER;
      const to = yard && gate ? gate : block;
      this.posts.push({ x, y, facing: Math.atan2(to.y - y, to.x - x) });
    }
    const d = map.poisOf('prison_desk')[0];
    const office = map.poisOf('prison_office')[0];
    if (d && office && office.w != null && office.h != null) {
      // Со стороны кабинета, у стола.
      const ox = (office.x + office.w / 2) * ts;
      const oy = (office.y + office.h / 2) * ts;
      const dx = (d.x + 0.5) * ts;
      const dy = (d.y + 0.5) * ts;
      const len = Math.hypot(ox - dx, oy - dy) || 1;
      const a = nav.nearestWalkable(dx + ((ox - dx) / len) * 24, dy + ((oy - dy) / len) * 24, 2);
      this.desk = a >= 0 ? { x: nav.worldX(a), y: nav.worldY(a) } : null;
    }
  }

  /** Внутри тюрьмы (зона). */
  inside(x: number, y: number): boolean {
    return this.zone >= 0 && this.ctx.map.zoneAtWorld(x, y)?.id === this.zone;
  }

  /** Точка обхода рядом с постом: в тюрьме, не у дверей камер и входа. */
  sentrySpot(post: Vec2): Vec2 | null {
    const { ctx } = this;
    const S = PRISON.sentry;
    const none = new Set<number>();
    for (let k = 0; k < 12; k++) {
      const a = randomAnchorAround(post, ctx, S.radius[0], S.radius[1], none);
      if (a < 0) continue;
      const x = ctx.nav.worldX(a);
      const y = ctx.nav.worldY(a);
      if (!this.inside(x, y) || ctx.law.inAnyCell(x, y, 4) || this.nearDoor(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  private nearDoor(x: number, y: number): boolean {
    const r = PRISON.sentry.doorClear;
    for (const d of this.ctx.doors.groups) if (Math.hypot(d.x - x, d.y - y) < r) return true;
    return false;
  }

  /** Камера, где сидит подпольщик, которого ещё допрашивают (или null). */
  questionCell(): Cell | null {
    for (const c of this.ctx.law.prisonCells) {
      for (const s of c.slots) if (s.occupant && isUnderground(s.occupant) && !this.ctx.insurgency.brokeUnder(s.occupant)) return c;
    }
    return null;
  }

  /** Сколько армии в тюрьме и на воле. */
  armyCounts(): { jailed: number; free: number } {
    let jailed = 0;
    let free = 0;
    for (const c of this.ctx.entities.list) {
      if (!c.alive || !isArmy(c)) continue;
      const cell = c.law.cell >= 0 ? this.ctx.law.cells[c.law.cell] : null;
      if (c.law.phase === 'jailed' && cell?.prison) jailed++;
      else if (c.law.phase === 'none') free++;
    }
    return { jailed, free };
  }

  /** Занятая камера тюрьмы, ближайшая к точке (свои-подпольщики — первыми, если underground). */
  occupiedCellNear(x: number, y: number, skip: ReadonlySet<Cell> | null = null): Cell | null {
    let best: Cell | null = null;
    let bestD = Infinity;
    for (const c of this.ctx.law.prisonCells) {
      if (skip?.has(c) || !c.slots.some((s) => s.occupant)) continue;
      const d = Math.hypot(c.frontX - x, c.frontY - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  update(): void {
    if (!this.present) return;
    const war = this.ctx.war;
    const R = PRISON.rescue;
    const { jailed, free } = this.armyCounts();
    if (!war.cityPush) {
      this.rescue = false;
      return;
    }
    if (!this.rescue) {
      if (jailed >= R.min && free < jailed * R.ratio) {
        this.rescue = true;
        this.rescueFrom = jailed;
        this.stats.rescues++;
        this.ctx.law.log(`Надзор: повстанцы идут на тюрьму Альянса — выручать своих (${jailed} в камерах)! Охране — к бою!`, 'radio');
        this.ctx.bus.emit('announce', { text: 'Повстанцы штурмуют тюрьму' });
      }
    } else if (jailed < R.min || jailed <= this.rescueFrom * (1 - R.freed)) {
      this.rescue = false;
      this.ctx.law.log(`Сопротивление: из тюрьмы вызволили своих — теперь на Нексус!`, 'world');
    }
  }
}
