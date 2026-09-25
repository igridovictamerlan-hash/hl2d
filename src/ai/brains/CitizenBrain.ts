import type { Brain } from '../Brain';
import { BARKS } from '../../config/barks';
import { streetBark } from '../streetBark';
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
import { ECONOMY } from '../../config/economy';
import { ITEMS, type ItemId } from '../../config/items';
import type { RepairSpot } from '../../systems/EconomySystem';
import type { Vec2 } from '../../core/math';

/** Работа ГСР. */
type Job = { kind: 'dispense' } | { kind: 'repair'; spot: RepairSpot } | { kind: 'clerk'; until: number };

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
  job: Job | null = null;
  /** В какой раздаче уже решали, идти ли в очередь. */
  consideredCycle = 0;
  lastSlot = -1;
  panicFrom: Vec2 | null = null;
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
    this.fsm = new StateMachine<CitizenBrain>(this, [IDLE, WALK, STOPPED, FLEE, QUEUE, SHOP, WORK, SHELTER, PANIC], 'idle');
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
    } else if (cur !== 'panic') {
      const now = ctx.law.now;
      const shot = self.panicUntil < now ? ctx.combat.heardShot(self, 220, 0.4) : null;
      if (shot && self.faction !== 'rebel') {
        // Стрельба рядом — бежать прочь.
        self.panicUntil = now + ctx.rng.range(4, 6);
        this.panicFrom = { x: shot.x, y: shot.y };
        this.fsm.change('panic');
      } else if (ctx.war.curfew && cur !== 'shelter') this.fsm.change('shelter');
      else if (!ctx.war.curfew && cur === 'shelter') this.fsm.change('idle');
      else if (self.faction === 'cwu' && ctx.economy.open && !ctx.economy.dispenser && (cur === 'idle' || cur === 'walk')) {
        if (ctx.economy.claimDispenser(self)) {
          this.job = { kind: 'dispense' };
          this.fsm.change('work');
        }
      }
    }
    if (this.profile.avoidCp && (cur === 'walk' || cur === 'idle')) this.watchForCp(dt);
    if ((cur === 'walk' || cur === 'idle' || cur === 'queue') && ctx.rng.chance(BARKS.ambientPerSec * dt)) streetBark(self, ctx);
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

  /** Что делать после паузы: работа, очередь, магазин или прогулка. */
  decide(): string {
    const { ctx, self } = this;
    const eco = ctx.economy;
    if (self.faction === 'cwu') {
      const job = this.pickJob();
      if (job) {
        this.job = job;
        return 'work';
      }
    }
    if (eco.open && eco.cycle !== this.consideredCycle && !eco.hasBeenServed(self) && self.faction !== 'rebel') {
      this.consideredCycle = eco.cycle;
      if (ctx.rng.chance(ECONOMY.rations.npcJoinChance)) return 'queue';
    }
    if (eco.shopCounter && self.money >= 6 && self.hunger < 75 && ctx.rng.chance(ECONOMY.shop.npcVisitChance)) return 'shop';
    return 'walk';
  }

  /** Работа для ГСР: выдача рационов, ремонт, прилавок магазина. */
  private pickJob(): Job | null {
    const { ctx, self } = this;
    const eco = ctx.economy;
    if (eco.open && (!eco.dispenser || eco.dispenser === self) && eco.claimDispenser(self)) return { kind: 'dispense' };
    const spots = eco.brokenSpots().filter((r) => !r.worker);
    if (spots.length) {
      spots.sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y));
      spots[0].worker = self;
      return { kind: 'repair', spot: spots[0] };
    }
    if (eco.shopCounter && ctx.rng.chance(0.35)) {
      const busy = ctx.entities.near(eco.shopCounter.x, eco.shopCounter.y, 40).some((o) => o.faction === 'cwu' && o !== self);
      if (!busy) return { kind: 'clerk', until: ctx.law.now + ctx.rng.range(40, 80) };
    }
    return null;
  }

  goToPoint(p: Vec2): boolean {
    const a = this.ctx.nav.nearestWalkable(p.x, p.y, 4);
    if (a < 0) return false;
    this.mover.goTo(this.self, this.ctx, a);
    return true;
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
    if (b.idleLeft <= 0) return b.decide();
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

/** Очередь за рационом: встать на своё место, продвигаться, получить паёк. */
const QUEUE: State<CitizenBrain> = {
  name: 'queue',
  enter(b) {
    b.mover.speed = b.walkSpeed;
    b.mover.avoidZones = b.avoid;
    b.lastSlot = -1;
    if (b.ctx.economy.joinQueue(b.self) < 0) b.idleLeft = 0.5;
  },
  update(b, dt) {
    const eco = b.ctx.economy;
    const idx = eco.queue.indexOf(b.self);
    if (idx < 0 || !eco.open) {
      b.idleLeft = eco.hasBeenServed(b.self) ? 2 : 0.5;
      eco.leaveQueue(b.self);
      return 'idle';
    }
    const slot = eco.queueSlot(idx);
    const d = Math.hypot(slot.x - b.self.x, slot.y - b.self.y);
    if (idx !== b.lastSlot || (d > 14 && b.mover.status !== 'moving' && b.mover.status !== 'pending')) {
      b.lastSlot = idx;
      if (d > 8) b.goToPoint(slot);
    }
    if (d <= 10 && b.mover.status !== 'moving') {
      b.mover.stop();
      faceTowards(b.self, eco.window.x, eco.window.y, dt);
    }
  },
  exit(b) {
    b.ctx.economy.leaveQueue(b.self);
  },
};

/** Сходить в магазин ГСР и купить еды. */
const SHOP: State<CitizenBrain> = {
  name: 'shop',
  enter(b) {
    const c = b.ctx.economy.shopCounter;
    if (!c || !b.goToPoint(c)) b.idleLeft = 0.5;
  },
  update(b) {
    const st = b.mover.status;
    if (st === 'failed' || st === 'idle') return 'idle';
    if (st !== 'arrived') return;
    const affordable = ECONOMY.shop.stock.filter((id: ItemId) => ITEMS[id].kind === 'food' && (ITEMS[id].price ?? 1e9) <= b.self.money);
    if (affordable.length) {
      const id = b.ctx.rng.pick(affordable);
      if (!b.ctx.economy.buy(b.self, id)) b.self.say(`Мне ${ITEMS[id].name.toLowerCase()}, пожалуйста.`, b.ctx.law.now, 2);
    }
    b.idleLeft = b.ctx.rng.range(2, 5);
    return 'idle';
  },
};

/** Работа ГСР. */
const WORK: State<CitizenBrain> = {
  name: 'work',
  enter(b) {
    b.mover.speed = b.walkSpeed;
    const job = b.job;
    const eco = b.ctx.economy;
    if (!job) return;
    if (job.kind === 'dispense') b.goToPoint(eco.dispenserSpot);
    else if (job.kind === 'repair') b.goToPoint(job.spot);
    else if (eco.shopCounter) b.goToPoint(eco.shopCounter);
  },
  update(b, dt) {
    const job = b.job;
    const eco = b.ctx.economy;
    const done = () => {
      if (job?.kind === 'dispense') eco.releaseDispenser(b.self);
      if (job?.kind === 'repair' && job.spot.worker === b.self) job.spot.worker = null;
      b.job = null;
      b.idleLeft = b.ctx.rng.range(1, 4);
      return 'idle';
    };
    if (!job) return done();
    const st = b.mover.status;
    if (st === 'failed') return done();
    switch (job.kind) {
      case 'dispense': {
        if (!eco.open || (eco.dispenser && eco.dispenser !== b.self)) return done();
        const d = Math.hypot(eco.dispenserSpot.x - b.self.x, eco.dispenserSpot.y - b.self.y);
        if (d < 24) {
          b.mover.stop();
          const q = eco.queueSlot(0);
          faceTowards(b.self, q.x, q.y, dt);
          eco.markWorked(b.self);
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(eco.dispenserSpot);
        return;
      }
      case 'repair': {
        if (!job.spot.broken) return done();
        if (Math.hypot(job.spot.x - b.self.x, job.spot.y - b.self.y) < 30) {
          b.mover.stop();
          faceTowards(b.self, job.spot.x, job.spot.y, dt);
          if (eco.repairStep(b.self, job.spot, dt)) return done();
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(job.spot);
        return;
      }
      case 'clerk': {
        if (b.ctx.law.now > job.until || !eco.shopCounter) return done();
        if (st === 'arrived') b.mover.stop();
        if (b.fsm.time % 10 < dt) eco.markWorked(b.self);
        return;
      }
    }
  },
  exit(b) {
    if (b.job?.kind === 'dispense') b.ctx.economy.releaseDispenser(b.self);
  },
};

/** Комендантский час: уйти в ближайший подъезд/двор и сидеть там до отбоя. */
const SHELTER: State<CitizenBrain> = {
  name: 'shelter',
  enter(b) {
    b.mover.speed = CHARACTER.walkSpeed * 1.05;
    b.mover.avoidZones = b.avoid;
    const a = b.ctx.war.nearestShelter(b.self.x, b.self.y, b.self);
    if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
  },
  update(b) {
    const st = b.mover.status;
    if (st === 'arrived') b.mover.stop();
    else if (st === 'failed' || (st === 'idle' && b.ctx.war.outdoors(b.self))) {
      const a = b.ctx.war.nearestShelter(b.self.x, b.self.y, b.self);
      if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
    }
  },
  exit(b) {
    b.mover.speed = b.walkSpeed;
    b.ctx.war.releaseShelter(b.self);
  },
};

/** Стрельба рядом: бежать прочь несколько секунд. */
const PANIC: State<CitizenBrain> = {
  name: 'panic',
  enter(b) {
    b.mover.speed = CHARACTER.runSpeed * 0.85;
    const p = b.panicFrom;
    const goal = p ? b.goalAwayFrom(p.x, p.y) : -1;
    if (goal >= 0) b.mover.goTo(b.self, b.ctx, goal);
    b.self.say(b.ctx.rng.pick(['Стреляют!', 'Бежим!', 'Ложись!']), b.ctx.law.now, 1.5);
  },
  update(b) {
    if (b.self.panicUntil < b.ctx.law.now || b.mover.status === 'arrived' || b.mover.status === 'failed') {
      b.idleLeft = 1;
      return 'idle';
    }
  },
  exit(b) {
    b.mover.speed = b.walkSpeed;
  },
};
