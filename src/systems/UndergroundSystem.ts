import type { Character } from '../entities/Character';
import type { EntityManager } from '../entities/EntityManager';
import type { GameMap, HatchPair, Level } from '../world/GameMap';
import type { NavGrid } from '../world/NavGrid';
import type { Vec2 } from '../core/math';
import { UNDERGROUND } from '../config/underground';

/** Люк рядом с персонажем: откуда и куда он ведёт. */
export interface HatchUse {
  hatch: HatchPair;
  from: Vec2;
  to: Vec2;
}

/**
 * Канализация и люки. Город и канализация — две области одной сетки без прохода между ними;
 * люки — порталы: персонаж у люка (E у игрока, мозг у NPC) через UNDERGROUND.climbTime секунд
 * оказывается у парного люка на другом уровне.
 */
export class UndergroundSystem {
  constructor(
    private readonly map: GameMap,
    private readonly nav: NavGrid,
    private readonly entities: EntityManager,
  ) {}

  get hatches(): readonly HatchPair[] {
    return this.map.hatches;
  }

  levelOf(x: number, y: number): Level {
    return this.map.levelAt(x, y);
  }

  /** Люк в радиусе r от точки (на её уровне). */
  hatchNear(x: number, y: number, r: number = UNDERGROUND.useRadius): HatchUse | null {
    const sewer = this.levelOf(x, y) === 'sewer';
    let best: HatchUse | null = null;
    let bestD = r;
    for (const h of this.map.hatches) {
      const from = sewer ? h.sewer : h.city;
      const d = Math.hypot(from.x - x, from.y - y);
      if (d < bestD) {
        bestD = d;
        best = { hatch: h, from, to: sewer ? h.city : h.sewer };
      }
    }
    return best;
  }

  /**
   * Маршрут на другой уровень: люк, минимизирующий путь «сюда → люк» + «парный люк → цель»
   * (по прямой — для выбора достаточно). null — цель на том же уровне или люков нет.
   */
  route(from: Vec2, to: Vec2): HatchUse | null {
    const a = this.levelOf(from.x, from.y);
    if (a === this.levelOf(to.x, to.y)) return null;
    let best: HatchUse | null = null;
    let bestD = Infinity;
    for (const h of this.map.hatches) {
      const enter = a === 'sewer' ? h.sewer : h.city;
      const exit = a === 'sewer' ? h.city : h.sewer;
      const d = Math.hypot(enter.x - from.x, enter.y - from.y) + Math.hypot(exit.x - to.x, exit.y - to.y);
      if (d < bestD) {
        bestD = d;
        best = { hatch: h, from: enter, to: exit };
      }
    }
    return best;
  }

  /** Ближайший люк на уровне точки (для отхода «под землю»). */
  nearestHatch(x: number, y: number): HatchUse | null {
    return this.hatchNear(x, y, Infinity);
  }

  /** Вылезти у точки to: ближайший свободный якорь рядом, без интерполяции «полёта». */
  climb(c: Character, to: Vec2): void {
    const nav = this.nav;
    let a = -1;
    for (let r = 0; r <= 3 && a < 0; r++) {
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const cand = nav.nearestWalkable(to.x + Math.cos(ang) * r * 20, to.y + Math.sin(ang) * r * 20, 2);
        if (cand < 0) continue;
        const x = nav.worldX(cand);
        const y = nav.worldY(cand);
        if (this.entities.list.some((o) => o !== c && o.alive && Math.hypot(o.x - x, o.y - y) < c.radius * 2)) continue;
        a = cand;
        break;
      }
    }
    if (a < 0) a = nav.nearestWalkable(to.x, to.y, 4);
    if (a < 0) return;
    c.x = c.prevX = nav.worldX(a);
    c.y = c.prevY = nav.worldY(a);
    c.vx = c.vy = c.wantX = c.wantY = 0;
    c.aim = 0;
  }
}
