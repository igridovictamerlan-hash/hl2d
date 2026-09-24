import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { faceMovement } from '../facing';
import { dist } from '../../core/math';

/**
 * Задержанный (NPC или игрок): идёт за конвоиром в наручниках, заходит в камеру, сидит,
 * после срока выходит за ворота Нексуса. Этапы задаёт LawSystem (law.phase).
 */
export class PrisonerBrain implements Brain {
  readonly mover = new Mover(95);
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

  update(self: Character, ctx: AiContext, dt: number): void {
    const law = self.law;
    this.repath -= dt;
    switch (law.phase) {
      case 'cuffed': {
        const h = law.handler;
        if (!h) break;
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
        const cell = ctx.law.cells[law.cell];
        if (cell) this.go(self, ctx, ctx.law.cellAnchor(cell));
        break;
      }
      case 'jailed':
        this.mover.stop();
        break;
      case 'releasing': {
        const gate = ctx.map.poisOf('nexus_gate')[0];
        if (!gate) {
          this.done = true;
          break;
        }
        const ts = ctx.map.tileSize;
        const a = ctx.nav.nearestWalkable((gate.x + 0.5) * ts, (gate.y + 0.5) * ts, 6);
        this.go(self, ctx, a);
        if (this.mover.status === 'arrived' || this.mover.status === 'failed') this.done = true;
        break;
      }
    }
    this.mover.update(self, ctx, dt);
    faceMovement(self, ctx, dt);
  }
}
