import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { GangOp } from '../../systems/Gangs';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement, faceTowards } from '../facing';
import { CHARACTER } from '../../config/entities';
import { COMBAT } from '../../config/combat';
import { GANGS } from '../../config/gangs';
import { canSeeCircle } from '../../world/visibility';

/**
 * Боец банды на деле (GangSystem.startOp) — мозг на время дела, потом прежний (finish):
 *  racket — к прилавку лавки, постоять, первый собирает дань;
 *  raid — в чужой район, бродить там (стычка начнётся сама — GangSystem.scanFeuds);
 *  hit — к патрульному ГО у района, ближе engage — ствол в руки (враг Альянса, розыск), огонь;
 *  convoy — наперерез колонне склада, ближе engage и на виду — огонь; брошенные ящики — в общак;
 *  buy — к барыге, купить ствол в общак.
 * Стреляет по врагам (Gunner): бойцам чужой банды в стычке и, раз напал, — по ГО.
 */
export class GangOpBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed * 1.05);
  readonly gunner: Gunner;
  private repath = 0;
  private stay = 0;
  prey: Character | null = null;

  constructor(self: Character, ctx: AiContext, readonly op: GangOp, private readonly saved: Brain | null) {
    this.gunner = new Gunner(ctx.rng);
    void self;
  }

  get stateName(): string {
    return `банда · ${this.op.kind}${this.gunner.target ? ' · бой' : ''}`;
  }

  /** Дело кончено: ствол в карман, прежний мозг (розыск остаётся). */
  finish(self: Character, ctx: AiContext): void {
    if (self.brain !== this) return;
    ctx.combat.equip(self, null);
    self.hostile = false;
    self.brain = this.saved;
    self.wantX = self.wantY = 0;
  }

  private goTo(self: Character, ctx: AiContext, p: { x: number; y: number }): void {
    const a = ctx.nav.nearestWalkable(p.x, p.y, 4);
    if (a >= 0) this.mover.goTo(self, ctx, a);
  }

  /** Патрульный ГО в городе у района (не на КПП, не в Нексусе). */
  private pickPrey(self: Character, ctx: AiContext): Character | null {
    let best: Character | null = null;
    let bestD: number = GANGS.ops.hit.seek;
    for (const o of ctx.entities.list) {
      if (!o.alive || o.faction !== 'cp' || !o.fit || ctx.map.levelAt(o.x, o.y) !== 'city') continue;
      const k = ctx.map.zoneAtWorld(o.x, o.y)?.kind;
      if (k === 'nexus' || k === 'cells' || k === 'checkpoint' || k === 'outlands' || k === 'wasteland' || k === 'arsenal') continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const op = this.op;
    const now = ctx.combat.now;
    if (self.law.phase !== 'none') return;
    if (self.health < self.maxHealth * COMBAT.woundedFraction) {
      this.finish(self, ctx);
      return;
    }
    this.repath -= dt;
    const fighting = this.gunner.update(self, ctx, dt);
    if (fighting && this.gunner.target) {
      this.mover.stop();
    } else {
      switch (op.kind) {
        case 'racket':
        case 'buy': {
          const to = op.target;
          if (!to || op.done) {
            this.finish(self, ctx);
            return;
          }
          if (Math.hypot(to.x - self.x, to.y - self.y) < 20) {
            this.mover.stop();
            if (op.shop) faceTowards(self, op.shop.look.x, op.shop.look.y, dt);
            this.stay += dt;
            const need = op.kind === 'racket' ? GANGS.ops.racket.stay : 1.5;
            if (this.stay >= need && op.team[0] === self) {
              if (op.kind === 'racket') ctx.gangs.collectRacket(op, self);
              else ctx.gangs.buyAtFence(op, self);
            }
          } else if (this.repath <= 0 || this.mover.status === 'idle' || this.mover.status === 'failed') {
            this.repath = 2;
            this.goTo(self, ctx, op.team[0] === self ? to : { x: to.x + 20, y: to.y + 14 });
          }
          break;
        }
        case 'raid': {
          const to = op.target;
          if (!to) {
            this.finish(self, ctx);
            return;
          }
          const st = this.mover.status;
          if (st === 'idle' || st === 'arrived' || st === 'failed') {
            // В чужом районе — бродить около цели.
            const near = Math.hypot(to.x - self.x, to.y - self.y) < 200;
            const a = near && op.rival ? ctx.gangs.turfAnchor(op.rival) : -1;
            if (a >= 0 && Math.hypot(ctx.nav.worldX(a) - to.x, ctx.nav.worldY(a) - to.y) < 500) this.mover.goTo(self, ctx, a);
            else this.goTo(self, ctx, to);
          }
          break;
        }
        case 'hit': {
          if (!this.prey?.alive || this.repath <= 0) {
            this.prey = this.pickPrey(self, ctx);
            if (!this.prey) {
              this.finish(self, ctx);
              return;
            }
          }
          const p = this.prey;
          const d = Math.hypot(p.x - self.x, p.y - self.y);
          if (!self.hostile && d < GANGS.ops.hit.engage) this.attack(self, ctx, 'hit');
          if (this.repath <= 0 || this.mover.status === 'idle' || this.mover.status === 'failed') {
            this.repath = 1.5;
            this.goTo(self, ctx, p);
          }
          break;
        }
        case 'convoy': {
          const v = op.convoy;
          const live = !!v && ctx.arsenal.convoys.includes(v);
          // Ящики на земле рядом — в общак.
          if (ctx.gangs.lootToStash(op.gang, self)) break;
          const loose = ctx.arsenal.looseOutside.filter((cr) => Math.hypot(cr.x - self.x, cr.y - self.y) < 600);
          if (loose.length) {
            if (this.repath <= 0 || this.mover.status !== 'moving') {
              this.repath = 1;
              this.goTo(self, ctx, loose[0]);
            }
            break;
          }
          if (!live) {
            this.finish(self, ctx);
            return;
          }
          const lead = v!.lead;
          const d = Math.hypot(lead.x - self.x, lead.y - self.y);
          if (!self.hostile && d < GANGS.ops.convoy.engage && canSeeCircle(ctx.map, self.x, self.y, lead.x, lead.y, lead.radius)) this.attack(self, ctx, 'convoy');
          if (this.repath <= 0 || this.mover.status === 'idle' || this.mover.status === 'failed') {
            this.repath = 1.5;
            this.goTo(self, ctx, lead);
          }
          break;
        }
      }
    }
    void now;
    this.mover.update(self, ctx, dt);
    if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
  }

  /** Напасть на Альянс: вся команда достаёт стволы — враги Альянса, в розыске. */
  private attack(self: Character, ctx: AiContext, what: 'hit' | 'convoy'): void {
    for (const c of this.op.team) {
      if (!c.alive || c.hostile) continue;
      c.hostile = true;
      c.law.wanted = true;
    }
    self.say(ctx.rng.pick(what === 'hit' ? GANGS.lines.hit : GANGS.lines.convoy), ctx.law.now, 2);
    ctx.law.log(`${this.op.gang.def.name}: нападение на ${what === 'hit' ? 'патруль ГО' : 'конвой склада'}!`, 'radio');
    ctx.war.raiseAlarm(self.x, self.y, what === 'hit' ? 'банда напала на патруль' : 'банда напала на конвой ГО', false);
  }
}
