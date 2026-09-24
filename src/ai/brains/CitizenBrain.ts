import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { ZoneKind } from '../../world/GameMap';
import { Mover } from '../Mover';
import { StateMachine, type State } from '../StateMachine';
import { randomAnchorAround, randomAnchorInZone, zoneIds } from '../destinations';
import { faceMovement, faceTowards } from '../facing';
import { AI } from '../../config/ai';
import { CHARACTER } from '../../config/entities';
import { LAW } from '../../config/law';
import { FACTIONS } from '../../config/factions';

/** Чем отличаются гражданин, рабочий ГСР и повстанец в поведении «на улице». */
export interface StreetProfile {
  /** Шанс пойти в «свою» зону вместо случайной точки. */
  favouriteChance: number;
  favourite: ZoneKind[];
  /** Повстанцы уходят подальше, завидев ГО. */
  avoidCp: boolean;
}

const PROFILES: Record<'citizen' | 'cwu' | 'rebel', StreetProfile> = {
  citizen: { favouriteChance: AI.citizen.plazaChance, favourite: ['plaza'], avoidCp: false },
  cwu: { favouriteChance: 0.6, favourite: ['plaza', 'industrial'], avoidCp: false },
  rebel: { favouriteChance: 0.2, favourite: ['industrial', 'residential'], avoidCp: true },
};

const near: Character[] = [];

/**
 * Житель города (гражданин, ГСР, повстанец): стоит → идёт → стоит. Иногда нарушает:
 * бежит или лезет в запретную зону. По приказу ГО останавливается (или убегает — решает
 * LawSystem). Работа, очереди и рационы — этап 3.
 */
export class CitizenBrain implements Brain {
  readonly mover: Mover;
  readonly fsm: StateMachine<CitizenBrain>;
  readonly avoid: ReadonlySet<number>;
  readonly profile: StreetProfile;
  readonly walkSpeed: number;
  idleLeft = 0;
  private cpCheck = 0;

  constructor(
    public self: Character,
    public ctx: AiContext,
  ) {
    const [smin, smax] = CHARACTER.npcWalkSpeed;
    this.walkSpeed = ctx.rng.range(smin, smax);
    this.mover = new Mover(this.walkSpeed);
    this.avoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands']);
    this.mover.avoidZones = this.avoid;
    const f = self.faction === 'cwu' || self.faction === 'rebel' ? self.faction : 'citizen';
    this.profile = PROFILES[f];
    this.fsm = new StateMachine<CitizenBrain>(this, [IDLE, WALK, STOPPED, FLEE], 'idle');
    // Разносим начальные таймеры, чтобы толпа не двинулась синхронно.
    this.idleLeft = ctx.rng.range(0, AI.citizen.idleTime[1]);
  }

  get stateName(): string {
    return this.mover.yieldFrom ? `${this.fsm.current} · уступает` : this.fsm.current;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    this.self = self;
    this.ctx = ctx;
    const phase = self.law.phase;
    const cur = this.fsm.current;
    if (phase === 'ordered' || phase === 'checking') {
      if (cur !== 'stopped') this.fsm.change('stopped');
    } else if (phase === 'fleeing') {
      if (cur !== 'flee') this.fsm.change('flee');
    } else if (cur === 'stopped' || cur === 'flee') {
      this.idleLeft = 1;
      this.fsm.change('idle');
    }
    if (this.profile.avoidCp && (cur === 'walk' || cur === 'idle')) this.watchForCp(dt);
    this.fsm.update(dt);
    this.mover.update(self, ctx, dt);
    if (this.fsm.current !== 'stopped') faceMovement(self, ctx, dt);
  }

  /** Повстанец: заметил ГО рядом — уходит в сторону (не бегом, чтобы не привлечь внимание). */
  private watchForCp(dt: number): void {
    this.cpCheck -= dt;
    if (this.cpCheck > 0) return;
    this.cpCheck = 0.6;
    for (const o of this.ctx.entities.near(this.self.x, this.self.y, 150, near)) {
      if (!FACTIONS[o.faction].authority || !this.ctx.law.canSee(this.self, o)) continue;
      const goal = this.goalAwayFrom(o.x, o.y);
      if (goal >= 0) {
        this.mover.speed = this.walkSpeed;
        this.mover.goTo(this.self, this.ctx, goal);
        if (this.fsm.current !== 'walk') this.fsm.change('walk');
      }
      return;
    }
  }

  goalAwayFrom(x: number, y: number): number {
    let best = -1;
    let bestD = -1;
    for (let k = 0; k < 8; k++) {
      const a = randomAnchorAround(this.self, this.ctx, 12, 40, this.avoid);
      if (a < 0) continue;
      const d = Math.hypot(this.ctx.nav.worldX(a) - x, this.ctx.nav.worldY(a) - y);
      if (d > bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  pickGoal(): number {
    const { ctx, profile } = this;
    const f = this.self.faction;
    this.mover.speed = this.walkSpeed;
    this.mover.avoidZones = this.avoid;
    // Нарушения: в запретную зону или бегом.
    if (ctx.rng.chance(LAW.npc.trespassChance[f] ?? 0)) {
      const g = randomAnchorInZone(ctx, 'restricted');
      if (g >= 0) {
        this.mover.avoidZones = undefined;
        return g;
      }
    }
    if (ctx.rng.chance(LAW.npc.runChance[f] ?? 0)) this.mover.speed = CHARACTER.runSpeed * 0.9;
    if (ctx.rng.chance(profile.favouriteChance)) {
      const g = randomAnchorInZone(ctx, ctx.rng.pick(profile.favourite));
      if (g >= 0 && !this.avoid.has(ctx.nav.zone[g])) return g;
    }
    const C = AI.citizen;
    return randomAnchorAround(this.self, ctx, C.wanderDistance[0], C.wanderDistance[1], this.avoid);
  }
}

const IDLE: State<CitizenBrain> = {
  name: 'idle',
  enter(b) {
    b.mover.stop();
    b.mover.speed = b.walkSpeed;
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
    if (b.mover.status === 'moving' || b.mover.status === 'pending') return;
    const goal = b.pickGoal();
    if (goal < 0) return;
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

/** ГО приказал стоять или проверяет документы. */
const STOPPED: State<CitizenBrain> = {
  name: 'stopped',
  enter(b) {
    b.mover.stop();
  },
  update(b, dt) {
    const h = b.self.law.handler;
    if (h) faceTowards(b.self, h.x, h.y, dt);
  },
};

/** Убегает от ГО. Когда LawSystem снимает погоню — назад в idle. */
const FLEE: State<CitizenBrain> = {
  name: 'flee',
  enter(b) {
    b.mover.speed = CHARACTER.runSpeed * 0.85;
    b.mover.avoidZones = b.avoid;
    const h = b.self.law.handler;
    const goal = h ? b.goalAwayFrom(h.x, h.y) : -1;
    if (goal >= 0) b.mover.goTo(b.self, b.ctx, goal);
  },
  update(b) {
    const st = b.mover.status;
    if (st === 'arrived' || st === 'failed' || st === 'idle') {
      const h = b.self.law.handler;
      const goal = h ? b.goalAwayFrom(h.x, h.y) : -1;
      if (goal >= 0) b.mover.goTo(b.self, b.ctx, goal);
    }
  },
  exit(b) {
    b.mover.speed = b.walkSpeed;
  },
};
