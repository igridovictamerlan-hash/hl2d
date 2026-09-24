import type { Brain } from '../Brain';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Cell } from '../../systems/LawSystem';
import { Mover } from '../Mover';
import { StateMachine, type State } from '../StateMachine';
import { randomAnchorAround } from '../destinations';
import { faceMovement, faceTowards, turnTowards } from '../facing';
import { canSeeCircle } from '../../world/visibility';
import { LAW } from '../../config/law';
import { VISION } from '../../config/vision';
import { dist, type Vec2 } from '../../core/math';

const near: Character[] = [];

/**
 * Сотрудник ГО. Патрулирует узкие места и ключевые точки, иногда стоит постом.
 * Часовой КПП (guardPost) стоит на своём посту и проверяет почти всех в коридоре.
 * Заметив нарушение: приказ «стоять» → подход → проверка CID → штраф/арест → конвой в КПЗ.
 * Беглеца преследует бегом; потерял из виду — объявляет в розыск.
 */
export class CpBrain implements Brain {
  readonly mover: Mover;
  readonly fsm: StateMachine<CpBrain>;
  target: Character | null = null;
  cell: Cell | null = null;
  postLeft = 0;
  postFacing = 0;
  lostTime = 0;
  repath = 0;
  private scan = 0;

  constructor(
    public self: Character,
    public ctx: AiContext,
    /** Пост часового (КПП) в px мира; null — патрульный. */
    readonly guardPost: Vec2 | null = null,
    readonly guardFacing = 0,
  ) {
    this.mover = new Mover(LAW.cpWalkSpeed);
    this.fsm = new StateMachine<CpBrain>(this, [PATROL, PATROL_AGAIN, POST, GUARD, APPROACH, CHECK, CHASE, ESCORT], guardPost ? 'guard' : 'patrol');
    this.scan = ctx.rng.range(0, LAW.scanInterval);
  }

  get stateName(): string {
    const t = this.target ? ` → #${this.target.cid}` : '';
    return `${this.fsm.current}${t}`;
  }

  /** Куда возвращаться после разбирательства. */
  get idleState(): string {
    return this.guardPost ? 'guard' : 'patrol';
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    this.self = self;
    this.ctx = ctx;
    const cur = this.fsm.current;
    if (cur === 'patrol' || cur === 'post' || cur === 'guard') {
      this.scan -= dt;
      if (this.scan <= 0) {
        this.scan = LAW.scanInterval;
        this.lookAround();
      }
    }
    this.fsm.update(dt);
    this.mover.update(self, ctx, dt);
    if (this.fsm.current !== 'check' && this.fsm.current !== 'post' && this.fsm.current !== 'guard') faceMovement(self, ctx, dt);
  }

  /** Осмотреться: нарушения — сразу, остальных иногда проверить «для порядка». */
  private lookAround(): void {
    const { self, ctx } = this;
    const law = ctx.law;
    const zone = ctx.map.zoneAtWorld(self.x, self.y);
    const atCheckpoint = zone?.kind === 'checkpoint';
    for (const o of ctx.entities.near(self.x, self.y, VISION.npcRange, near)) {
      if (o === self) continue;
      const v = law.observe(self, o);
      if (v) {
        this.engage(o, v);
        return;
      }
    }
    for (const o of near) {
      if (o === self || !law.checkable(o)) continue;
      const inCheckpoint = ctx.map.zoneAtWorld(o.x, o.y)?.kind === 'checkpoint';
      const chance = atCheckpoint && inCheckpoint ? LAW.checkpointCheckChance : LAW.randomCheckChance;
      if (ctx.rng.chance(chance) && law.canSee(self, o)) {
        this.engage(o, 'routine');
        return;
      }
    }
  }

  engage(o: Character, reason: Parameters<AiContext['law']['order']>[2]): void {
    this.ctx.law.order(this.self, o, reason);
    this.target = o;
    this.fsm.change(o.law.phase === 'fleeing' ? 'chase' : 'approach');
  }

  /** Цель всё ещё «наша»? */
  ownsTarget(): boolean {
    const t = this.target;
    return !!t && t.alive && t.law.handler === this.self;
  }

  drop(): string {
    this.target = null;
    this.cell = null;
    this.mover.speed = LAW.cpWalkSpeed;
    return this.idleState;
  }

  /** Идти к персонажу, перестраивая путь раз в interval. */
  follow(t: Character, dt: number, interval: number): void {
    this.repath -= dt;
    if (this.repath > 0 && (this.mover.status === 'moving' || this.mover.status === 'pending')) return;
    this.repath = interval;
    const a = this.ctx.nav.nearestWalkable(t.x, t.y, 4);
    if (a >= 0) this.mover.goTo(this.self, this.ctx, a);
  }
}

const PATROL: State<CpBrain> = {
  name: 'patrol',
  enter(b) {
    b.mover.speed = LAW.cpWalkSpeed;
    const { ctx, self } = b;
    // Чаще всего — к узкому месту (там ставят посты), иначе — случайная точка.
    let goal = -1;
    for (let k = 0; k < 12 && goal < 0; k++) {
      const a = randomAnchorAround(self, ctx, LAW.patrolDistance[0], LAW.patrolDistance[1], new Set());
      if (a >= 0 && (ctx.nav.cost[a] > 1 || k > 8)) goal = a;
    }
    if (goal >= 0) b.mover.goTo(self, ctx, goal);
  },
  update(b) {
    const st = b.mover.status;
    if (st === 'arrived') return b.ctx.rng.chance(LAW.postChance) ? 'post' : 'patrol-again';
    if (st === 'failed' || st === 'idle') return 'patrol-again';
  },
};

/** Технический переход «патруль → снова патруль» (перезапуск enter). */
const PATROL_AGAIN: State<CpBrain> = {
  name: 'patrol-again',
  update: () => 'patrol',
};

const POST: State<CpBrain> = {
  name: 'post',
  enter(b) {
    b.mover.stop();
    b.postLeft = b.ctx.rng.range(LAW.postTime[0], LAW.postTime[1]);
    b.postFacing = b.ctx.rng.range(0, Math.PI * 2);
  },
  update(b, dt) {
    b.postLeft -= dt;
    // Осматривается по сторонам.
    if (b.ctx.rng.chance(dt * 0.4)) b.postFacing = b.ctx.rng.range(0, Math.PI * 2);
    turnTowards(b.self, b.postFacing, dt, 2);
    if (b.postLeft <= 0) return 'patrol';
  },
};

const GUARD: State<CpBrain> = {
  name: 'guard',
  enter(b) {
    b.mover.speed = LAW.cpWalkSpeed;
    const p = b.guardPost!;
    const a = b.ctx.nav.nearestWalkable(p.x, p.y, 3);
    if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
  },
  update(b, dt) {
    const p = b.guardPost!;
    if (b.mover.status === 'arrived' || dist(b.self.x, b.self.y, p.x, p.y) < 12) {
      b.mover.stop();
      turnTowards(b.self, b.guardFacing, dt, 3);
    } else if (b.mover.status === 'failed' || b.mover.status === 'idle') {
      const a = b.ctx.nav.nearestWalkable(p.x, p.y, 3);
      if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
    }
  },
};

const APPROACH: State<CpBrain> = {
  name: 'approach',
  enter(b) {
    b.mover.speed = LAW.cpWalkSpeed * 1.15;
    b.repath = 0;
    b.lostTime = 0;
  },
  update(b, dt) {
    if (!b.ownsTarget()) return b.drop();
    const t = b.target!;
    if (t.law.phase === 'fleeing') return 'chase';
    const d = dist(b.self.x, b.self.y, t.x, t.y);
    if (d < LAW.talkDistance) {
      b.ctx.law.beginCheck(b.self, t);
      return 'check';
    }
    // Далеко ушёл из виду — бросаем (он не бежал, просто разминулись).
    if (!canSeeCircle(b.ctx.map, b.self.x, b.self.y, t.x, t.y, t.radius)) {
      b.lostTime += dt;
      if (b.lostTime > LAW.chaseLoseTime) {
        b.ctx.law.clear(t);
        return b.drop();
      }
    } else b.lostTime = 0;
    b.follow(t, dt, 0.6);
  },
};

const CHECK: State<CpBrain> = {
  name: 'check',
  enter(b) {
    b.mover.stop();
  },
  update(b, dt) {
    if (!b.ownsTarget()) return b.drop();
    const t = b.target!;
    faceTowards(b.self, t.x, t.y, dt);
    if (t.law.phase === 'fleeing') return 'chase';
    if (dist(b.self.x, b.self.y, t.x, t.y) > LAW.talkDistance * 2) {
      // Игрок отошёл во время проверки — это неподчинение.
      b.ctx.law.startFlee(t);
      return 'chase';
    }
    if (b.fsm.time < LAW.checkTime) return;
    const verdict = b.ctx.law.judge(t);
    b.ctx.law.apply(b.self, t, verdict);
    return verdict.kind === 'arrest' ? 'escort' : b.drop();
  },
};

const CHASE: State<CpBrain> = {
  name: 'chase',
  enter(b) {
    b.mover.speed = LAW.cpRunSpeed;
    b.repath = 0;
    b.lostTime = 0;
  },
  update(b, dt) {
    if (!b.ownsTarget()) return b.drop();
    const t = b.target!;
    if (t.law.phase !== 'fleeing') return t.law.phase === 'cuffed' ? 'escort' : b.drop();
    if (dist(b.self.x, b.self.y, t.x, t.y) < LAW.catchDistance) {
      b.ctx.law.arrest(b.self, t, 'resisting');
      return 'escort';
    }
    if (canSeeCircle(b.ctx.map, b.self.x, b.self.y, t.x, t.y, t.radius)) b.lostTime = 0;
    else {
      b.lostTime += dt;
      if (b.lostTime > LAW.chaseLoseTime) {
        b.ctx.law.lost(t);
        return b.drop();
      }
    }
    b.follow(t, dt, 0.4);
  },
};

/** Конвой: ведёт задержанного к свободной камере, заводит, возвращается к службе. */
const ESCORT: State<CpBrain> = {
  name: 'escort',
  enter(b) {
    b.mover.speed = LAW.cpWalkSpeed;
    const t = b.target;
    if (!t) return;
    const law = b.ctx.law;
    const cell = law.freeCell(b.self.x, b.self.y);
    if (!cell) {
      law.releaseNoCell(b.self, t);
      b.target = null;
      return;
    }
    b.cell = cell;
    law.reserve(cell, t);
    const a = law.frontAnchor(cell);
    if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
  },
  update(b, dt) {
    const t = b.target;
    const cell = b.cell;
    if (!t || !cell) return b.drop();
    const phase = t.law.phase;
    if (phase === 'jailed') return b.drop();
    if (phase !== 'cuffed' && phase !== 'entering') {
      if (cell.reserved === t) cell.reserved = null;
      return b.drop();
    }
    if (phase === 'entering') {
      faceTowards(b.self, cell.x, cell.y, dt);
      if (b.fsm.time > 25) return b.drop();
      return;
    }
    const st = b.mover.status;
    const atFront = dist(b.self.x, b.self.y, cell.frontX, cell.frontY) < 30;
    if ((st === 'arrived' || atFront) && dist(b.self.x, b.self.y, t.x, t.y) < 90) {
      b.ctx.law.putInCell(t, cell);
      return;
    }
    if (st === 'arrived' || st === 'failed' || st === 'idle') {
      // Ждём, пока задержанный подтянется, и перестраиваем путь при неудаче.
      if (!atFront) {
        const a = b.ctx.law.frontAnchor(cell);
        if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
      }
    }
  },
};
