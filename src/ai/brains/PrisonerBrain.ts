import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { faceMovement, faceTowards } from '../facing';
import { lineOfSight } from '../../world/visibility';
import { LAW } from '../../config/law';
import { dist } from '../../core/math';
import { CHARACTER } from '../../config/entities';

/**
 * Задержанный (NPC или игрок): идёт за конвоиром в наручниках, заходит в камеру, сидит,
 * после срока выходит за ворота Управы (из тюрьмы — за её ворота). Этапы задаёт LawSystem (law.phase).
 */
export class PrisonerBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed);
  /** Вышел за ворота после отсидки — LawSystem вернёт прежний мозг. */
  done = false;
  private repath = 0;
  private goal = -1;

  constructor(private readonly self: Character) {}

  get stateName(): string {
    return `задержан · ${this.self.law.phase}`;
  }

  private go(self: Character, ctx: AiContext, anchor: number): void {
    if (anchor < 0) return;
    if (anchor === this.goal && this.mover.status !== 'failed' && this.mover.status !== 'idle') return;
    this.goal = anchor;
    this.mover.goTo(self, ctx, anchor);
  }

  /**
   * Идёт впереди конвоира (LAW.escortHold): точка — на ahead px по ходу конвоира (куда ведёт его путь) и side px вбок;
   * догоняет её сам, без пути (рядом, стен между ними нет). Отстал или угол — false: следом по пути, как прежде.
   */
  private leadBy(self: Character, h: Character, ctx: AiContext, dt: number): boolean {
    const E = LAW.escortHold;
    const gap = dist(self.x, self.y, h.x, h.y);
    if (gap > E.maxGap || !lineOfSight(ctx.map, self.x, self.y, h.x, h.y)) return false;
    const hb = h.brain;
    const head = hb?.mover.heading(h) ?? null;
    let fx = head ? head.x : Math.cos(h.facing);
    let fy = head ? head.y : Math.sin(h.facing);
    // Стоит конвоир — стоит и задержанный (лицом по ходу).
    const moving = Math.hypot(h.vx, h.vy) > 8;
    if (!head && !moving) {
      fx = (self.x - h.x) / Math.max(1, gap);
      fy = (self.y - h.y) / Math.max(1, gap);
    }
    const tx = h.x + fx * E.ahead - fy * E.side;
    const ty = h.y + fy * E.ahead + fx * E.side;
    const d = dist(self.x, self.y, tx, ty);
    this.mover.stop();
    this.goal = -1;
    if (d > 2) {
      const sp = Math.max(E.speed[0], Math.min(E.speed[1], Math.hypot(h.vx, h.vy) + d * E.catchUp));
      self.wantX = ((tx - self.x) / d) * sp;
      self.wantY = ((ty - self.y) / d) * sp;
    } else self.wantX = self.wantY = 0;
    faceTowards(self, self.x + fx * 40, self.y + fy * 40, dt);
    h.leading = self;
    return true;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const law = self.law;
    this.repath -= dt;
    switch (law.phase) {
      case 'cuffed': {
        const h = law.handler;
        if (!h) break;
        // Конвой «за локоть»: впереди конвоира по его ходу, руки за спиной; конвоир держит за руку.
        if (ctx.law.escortHold && !self.isPlayer && this.leadBy(self, h, ctx, dt)) return;
        if (h.leading === self) h.leading = null;
        this.mover.speed = Math.min(160, Math.max(85, h.moveSpeed * 1.1));
        if (dist(self.x, self.y, h.x, h.y) > 40) {
          if (this.repath <= 0) {
            this.repath = 0.5;
            this.goal = -1;
            this.go(self, ctx, ctx.nav.nearestWalkable(h.x, h.y, 4));
          }
        } else {
          this.mover.stop();
          this.goal = -1;
        }
        break;
      }
      case 'entering': {
        if (law.handler?.leading === self) law.handler.leading = null;
        const cell = ctx.law.cells[law.cell];
        if (cell) this.go(self, ctx, ctx.law.cellAnchor(cell, self));
        break;
      }
      case 'jailed':
        this.mover.stop();
        break;
      case 'releasing': {
        // Из тюрьмы — за её ворота, из КПЗ — за ворота Управы.
        const spot = ctx.law.releaseSpot.get(self);
        const gate = ctx.map.poisOf('nexus_gate')[0];
        if (!spot && !gate) {
          this.done = true;
          break;
        }
        const ts = ctx.map.tileSize;
        const a = spot ? ctx.nav.nearestWalkable(spot.x, spot.y, 6) : ctx.nav.nearestWalkable((gate.x + 0.5) * ts, (gate.y + 0.5) * ts, 6);
        this.go(self, ctx, a);
        if (this.mover.status === 'arrived' || this.mover.status === 'failed') this.done = true;
        break;
      }
    }
    this.mover.update(self, ctx, dt);
    faceMovement(self, ctx, dt);
  }
}
