import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { StateMachine, type State } from '../StateMachine';
import { randomAnchorAround, randomAnchorInZone, zoneIds } from '../destinations';
import { AI } from '../../config/ai';
import { CHARACTER } from '../../config/entities';

/**
 * Гражданин (этап 1): стоит → идёт в случайное место или на площадь → стоит.
 * Избегает Нексуса, КПЗ и запретной зоны. На следующих этапах добавятся очереди,
 * работа, нарушения, бегство от ГО и арест.
 */
export class CitizenBrain implements Brain {
  readonly mover: Mover;
  private readonly fsm: StateMachine<CitizenBrain>;
  private readonly avoid: ReadonlySet<number>;
  idleLeft = 0;

  constructor(
    public self: Character,
    public ctx: AiContext,
  ) {
    const [smin, smax] = CHARACTER.npcWalkSpeed;
    this.mover = new Mover(ctx.rng.range(smin, smax));
    this.avoid = zoneIds(ctx, ['nexus', 'cells', 'restricted']);
    this.mover.avoidZones = this.avoid;
    this.fsm = new StateMachine<CitizenBrain>(this, [IDLE, WALK], 'idle');
    // Разносим начальные таймеры, чтобы толпа не двинулась синхронно.
    this.idleLeft = ctx.rng.range(0, AI.citizen.idleTime[1]);
  }

  get stateName(): string {
    return this.mover.yieldFrom ? `${this.fsm.current} · уступает` : this.fsm.current;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    this.self = self;
    this.ctx = ctx;
    this.fsm.update(dt);
    this.mover.update(self, ctx, dt);
    faceMovement(self, ctx, dt);
  }

  pickGoal(): number {
    const C = AI.citizen;
    if (this.ctx.rng.chance(C.plazaChance)) {
      const g = randomAnchorInZone(this.ctx, 'plaza');
      if (g >= 0) return g;
    }
    return randomAnchorAround(this.self, this.ctx, C.wanderDistance[0], C.wanderDistance[1], this.avoid);
  }
}

const IDLE: State<CitizenBrain> = {
  name: 'idle',
  enter(b) {
    b.mover.stop();
    if (b.idleLeft <= 0) b.idleLeft = b.ctx.rng.range(AI.citizen.idleTime[0], AI.citizen.idleTime[1]);
  },
  update(b, dt) {
    if (b.mover.yieldFrom) return;
    b.idleLeft -= dt;
    if (b.idleLeft <= 0) return 'walk';
  },
};

const WALK: State<CitizenBrain> = {
  name: 'walk',
  enter(b) {
    const goal = b.pickGoal();
    if (goal < 0) {
      b.idleLeft = 1;
      return;
    }
    b.mover.goTo(b.self, b.ctx, goal);
  },
  update(b) {
    const st = b.mover.status;
    if (b.mover.goal < 0 || st === 'arrived' || st === 'failed' || st === 'idle') {
      b.idleLeft = st === 'failed' ? 0.6 : 0;
      return 'idle';
    }
  },
};

const near: Character[] = [];

/** Взгляд по ходу движения; стоя — на ближайшего соседа. */
function faceMovement(self: Character, ctx: AiContext, dt: number): void {
  let target: number | null = null;
  if (self.moveSpeed > 8) target = Math.atan2(self.vy, self.vx);
  else {
    const other = self.brain?.mover.yieldFrom;
    if (other) target = Math.atan2(other.y - self.y, other.x - self.x);
    else {
      let best = 70;
      for (const o of ctx.entities.near(self.x, self.y, 70, near)) {
        if (o === self) continue;
        const d = Math.hypot(o.x - self.x, o.y - self.y);
        if (d < best) {
          best = d;
          target = Math.atan2(o.y - self.y, o.x - self.x);
        }
      }
    }
  }
  if (target === null) return;
  let diff = target - self.facing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const maxTurn = 8 * dt;
  self.facing += Math.max(-maxTurn, Math.min(maxTurn, diff));
}
