import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement, faceTowards } from '../facing';
import { randomAnchorAround, zoneIds } from '../destinations';
import { canSeeCircle } from '../../world/visibility';
import { COMBAT } from '../../config/combat';
import { WAR } from '../../config/war';
import { CHARACTER } from '../../config/entities';

type Mode = 'raid' | 'assault' | 'infiltrate' | 'retreat';

/**
 * Боец сопротивления из пустошей.
 *  raid — занимает позицию на пустоши с видом на ворота КПП и перестреливается с часовыми;
 *  assault — идёт на прорыв через коридор КПП в город (стреляет по пути);
 *  infiltrate — прорвался: прячется в кварталах, отстреливается, если нашли;
 *  retreat — ранен или без патронов: уходит вглубь пустоши (исчезает).
 */
export class RebelBrain implements Brain {
  readonly mover: Mover;
  readonly gunner: Gunner;
  mode: Mode = 'raid';
  /** Дошёл до края пустоши при отходе — WarSystem уберёт. */
  departed = false;
  private relocate = 0;
  private goal = -1;
  private repath = 0;

  constructor(
    private self: Character,
    private ctx: AiContext,
    readonly front: number,
    /** Когда отряд пойдёт на штурм (Infinity — не пойдёт). */
    private assaultAt: number,
  ) {
    this.mover = new Mover(ctx.rng.range(75, 90));
    this.gunner = new Gunner(ctx.rng);
  }

  get stateName(): string {
    return `${this.mode}${this.gunner.target ? ' · бой' : ''}`;
  }

  orderAssault(): void {
    if (this.mode === 'raid') this.assaultAt = 0;
  }

  infiltrate(): void {
    this.mode = 'infiltrate';
    this.goal = -1;
    this.mover.speed = CHARACTER.runSpeed * 0.8;
  }

  private go(anchor: number): void {
    if (anchor < 0) return;
    this.goal = anchor;
    this.mover.goTo(this.self, this.ctx, anchor);
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    this.self = self;
    this.ctx = ctx;
    const f = ctx.war.fronts[this.front];
    const w = ctx.combat.weaponOf(self);
    const outOfAmmo = !w || (self.mag <= 0 && ctx.combat.reserveAmmo(self) <= 0);
    if (this.mode !== 'infiltrate' && this.mode !== 'retreat' && (self.health < self.maxHealth * COMBAT.woundedFraction || outOfAmmo)) {
      this.mode = 'retreat';
      this.goal = -1;
    }
    if (this.mode === 'raid' && ctx.combat.now >= this.assaultAt) {
      this.mode = 'assault';
      this.goal = -1;
    }
    const fighting = this.gunner.update(self, ctx, dt);
    this.relocate -= dt;
    this.repath -= dt;

    switch (this.mode) {
      case 'raid': {
        if (!f) break;
        // Позиция: пустошь, с видом на внешние ворота.
        if (this.goal < 0 || this.relocate <= 0 || this.mover.status === 'failed') {
          this.relocate = ctx.rng.range(WAR.relocateEvery[0], WAR.relocateEvery[1]);
          // Позиция с видом вдоль коридора на посты часовых (иначе — хотя бы на ворота).
          let pick = -1;
          for (let k = 0; k < 40 && pick < 0; k++) {
            const a = ctx.rng.pick(f.outlands);
            const x = ctx.nav.worldX(a);
            const y = ctx.nav.worldY(a);
            const seesPost = f.posts.some((p) => canSeeCircle(ctx.map, x, y, p.x, p.y, 8));
            const seesGate = canSeeCircle(ctx.map, x, y, f.outerGate.x, f.outerGate.y, 4);
            if (seesPost || (k > 30 && seesGate)) pick = a;
          }
          if (pick >= 0) this.go(pick);
        }
        // Стреляя — стоит на месте.
        if (fighting && this.gunner.target) this.mover.stop();
        else if (this.mover.status === 'idle' && this.goal >= 0) this.go(this.goal);
        break;
      }
      case 'assault': {
        if (!f) break;
        if (this.goal < 0 || this.mover.status === 'failed' || this.mover.status === 'arrived') {
          // Цель — за внутренними воротами, в город.
          const beyond = { x: f.apron.x + (f.apron.x - f.outerGate.x) * 0.6, y: f.apron.y + (f.apron.y - f.outerGate.y) * 0.6 };
          this.go(ctx.nav.nearestWalkable(beyond.x, beyond.y, 8));
        }
        // Прорыв: перебежками — стреляет, но не останавливается надолго.
        this.mover.speed = fighting ? 55 : CHARACTER.runSpeed * 0.75;
        break;
      }
      case 'infiltrate': {
        if (fighting && this.gunner.target && self.health > self.maxHealth * 0.5) {
          this.mover.stop();
          this.goal = -1;
          break;
        }
        if (this.goal < 0 || this.mover.status === 'arrived' || this.mover.status === 'failed' || this.mover.status === 'idle') {
          const avoid = zoneIds(ctx, ['nexus', 'cells', 'checkpoint', 'outlands', 'plaza', 'avenue']);
          const g = randomAnchorAround(self, ctx, 12, 45, avoid);
          this.mover.speed = CHARACTER.runSpeed * 0.7;
          this.go(g);
        }
        break;
      }
      case 'retreat': {
        if (!f) {
          this.departed = true;
          break;
        }
        this.mover.speed = CHARACTER.runSpeed * 0.7;
        if (this.goal < 0 || this.mover.status === 'failed') {
          // Самая дальняя от ворот точка пустоши.
          let best = -1;
          let bestD = -1;
          for (const a of f.outlands) {
            const d = Math.hypot(ctx.nav.worldX(a) - f.outerGate.x, ctx.nav.worldY(a) - f.outerGate.y);
            if (d > bestD) {
              bestD = d;
              best = a;
            }
          }
          this.go(best);
        }
        if (this.mover.status === 'arrived') this.departed = true;
        break;
      }
    }
    this.mover.update(self, ctx, dt);
    if (this.gunner.target && this.gunner.target.alive) faceTowards(self, this.gunner.target.x, this.gunner.target.y, dt);
    else faceMovement(self, ctx, dt);
  }
}
