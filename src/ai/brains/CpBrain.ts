import type { Brain } from '../Brain';
import { BARKS } from '../../config/barks';
import { streetBark } from '../streetBark';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { Cell } from '../../systems/LawSystem';
import { Mover } from '../Mover';
import { StateMachine, type State } from '../StateMachine';
import { randomAnchorAround, zoneIds } from '../destinations';
import { poiWorld } from '../../systems/Population';
import { faceMovement, faceTowards, turnTowards } from '../facing';
import { canSeeCircle } from '../../world/visibility';
import { CHARACTER } from '../../config/entities';
import { CP_UNITS } from '../../config/cpUnits';
import type { Corpse } from '../../systems/CombatSystem';
import { LAW } from '../../config/law';
import { VISION } from '../../config/vision';
import { dist, type Vec2 } from '../../core/math';
import { Gunner } from '../Gunner';
import { COMBAT } from '../../config/combat';
import { ALARM } from '../../config/underground';
import { hasLoyalty, loyaltyTier } from '../../systems/Loyalty';
import { FACTIONS, CP_DIVISIONS } from '../../config/factions';

const near: Character[] = [];

export interface CpOptions {
  /** Пост часового (КПП), px мира. */
  post?: Vec2;
  facing?: number;
  /** Номер фронта (пограничного КПП), к которому приписан. */
  front?: number;
  /** Место медика HELIX на КПП. */
  medicStation?: Vec2;
}

/** Состояния, из которых можно сразу перейти в бой. */
const CAN_FIGHT = new Set(['patrol', 'patrol-again', 'post', 'guard', 'hunt', 'approach', 'chase', 'medic', 'heal', 'check', 'bodyguard']);

/**
 * Сотрудник ГО. Патрулирует узкие места и ключевые точки, иногда стоит постом.
 * Часовой КПП (GRID) стоит на посту и держит коридор; медик HELIX лечит раненых.
 * Нарушение: приказ «стоять» → подход → проверка CID → штраф/арест → конвой в КПЗ.
 * Вооружённый враг (повстанец с оружием, напавший на Альянс) — бой на поражение;
 * безоружного повстанца пытается задержать. Ранен — отходит к медику/в бункер.
 * При красном коде патрульные прочёсывают город по данным «Надзора».
 */
export class CpBrain implements Brain {
  readonly mover: Mover;
  readonly gunner: Gunner;
  readonly fsm: StateMachine<CpBrain>;
  readonly guardPost: Vec2 | null;
  readonly guardFacing: number;
  readonly front: number;
  readonly medicStation: Vec2 | null;
  target: Character | null = null;
  /** Кого лечит медик. */
  patient: Character | null = null;
  cell: Cell | null = null;
  postLeft = 0;
  postFacing = 0;
  lostTime = 0;
  repath = 0;
  healCooldown = 0;
  retreatTo: Vec2 | null = null;
  /** Наблюдатель OBS: какое тело сканирует и сколько осталось. */
  corpse: Corpse | null = null;
  scanLeft = 0;
  /** Кого сопровождает (охрана доверенного лоялиста) и до какого времени. */
  ward: Character | null = null;
  wardUntil = 0;
  private scan = 0;
  /** Куда патруль не ходит: пустошь за стеной и лагерь сопротивления. */
  readonly patrolAvoid: ReadonlySet<number>;

  constructor(
    public self: Character,
    public ctx: AiContext,
    opts: CpOptions = {},
  ) {
    this.guardPost = opts.post ?? null;
    this.guardFacing = opts.facing ?? 0;
    this.front = opts.front ?? -1;
    this.medicStation = opts.medicStation ?? null;
    this.patrolAvoid = zoneIds(ctx, ['outlands', 'wasteland', 'rebel_camp']);
    this.mover = new Mover(LAW.cpWalkSpeed);
    this.gunner = new Gunner(ctx.rng);
    this.fsm = new StateMachine<CpBrain>(
      this,
      [PATROL, PATROL_AGAIN, POST, GUARD, APPROACH, CHECK, CHASE, ESCORT, FIGHT, RETREAT, MEDIC, HEAL, HUNT, BODYGUARD, SCAN],
      this.idleState,
    );
    this.scan = ctx.rng.range(0, LAW.scanInterval);
  }

  get stateName(): string {
    const t = this.target ? ` → #${this.target.cid}` : this.gunner.target ? ` → ${this.gunner.target.name}` : '';
    const div = this.self.division ? `${CP_DIVISIONS[this.self.division].short} · ` : '';
    return `${div}${this.fsm.current}${t}`;
  }

  /**
   * Прочёсывать: красный код — все патрульные; жёлтый — патрульные в радиусе ALARM.respondRadius
   * от тревоги (или от известного нападавшего).
   */
  shouldHunt(): boolean {
    const war = this.ctx.war;
    if (this.guardPost || this.medicStation || war.code === 'green') return false;
    if (war.code === 'red') return true;
    const p = war.nearestKnown(this.self.x, this.self.y);
    return !!p && Math.hypot(p.x - this.self.x, p.y - this.self.y) < ALARM.respondRadius;
  }

  /** Может ли быть охраной (свободный патрульный). */
  get canGuard(): boolean {
    const cur = this.fsm.current;
    return !this.guardPost && !this.medicStation && !this.target && (cur === 'patrol' || cur === 'post' || cur === 'patrol-again');
  }

  /** Сопровождать ward до времени until (охрана доверенного лоялиста). */
  assignGuard(ward: Character, until: number): void {
    this.ward = ward;
    this.wardUntil = until;
    this.fsm.change('bodyguard');
  }

  /** Куда возвращаться после разбирательства. */
  get idleState(): string {
    if (this.medicStation) return 'medic';
    if (this.guardPost) return 'guard';
    if (this.ward?.alive && this.ctx.law.now < this.wardUntil) return 'bodyguard';
    return this.ctx.war && this.shouldHunt() ? 'hunt' : 'patrol';
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    this.self = self;
    this.ctx = ctx;
    this.healCooldown -= dt;
    let cur = this.fsm.current;
    // Бой: гарнизон отстреливается из любого состояния (даже на конвое).
    const engaged = this.gunner.update(self, ctx, dt);
    if (!engaged && (cur === 'patrol' || cur === 'post' || cur === 'guard') && ctx.rng.chance(BARKS.ambientPerSec * dt)) streetBark(self, ctx);
    if (engaged && this.gunner.target) ctx.war.sighted(this.gunner.target);
    const wounded = self.health < self.maxHealth * COMBAT.woundedFraction;
    if (wounded && cur !== 'retreat' && cur !== 'escort') this.fsm.change('retreat');
    else if (engaged && this.gunner.target && CAN_FIGHT.has(cur) && cur !== 'check') {
      // Отпускаем проверяемого — не до него.
      if (this.target && this.target.law.handler === self && this.target.law.phase !== 'cuffed') ctx.law.clear(this.target);
      this.target = null;
      this.fsm.change('fight');
    }
    cur = this.fsm.current;
    // Красный код: патрульные — на прочёсывание.
    if ((cur === 'patrol' || cur === 'post' || cur === 'patrol-again') && !this.guardPost && !this.medicStation && this.shouldHunt()) {
      this.fsm.change('hunt');
    }
    cur = this.fsm.current;
    if (cur === 'patrol' || cur === 'post' || cur === 'guard' || cur === 'hunt' || cur === 'medic') {
      this.scan -= dt;
      if (this.scan <= 0) {
        this.scan = LAW.scanInterval;
        this.lookAround();
      }
    }
    this.fsm.update(dt);
    this.mover.update(self, ctx, dt);
    const now = this.fsm.current;
    // Цель или тревога (ранили, стреляют рядом) перебивают дежурный взгляд.
    if (this.gunner.look(self, ctx, dt)) return;
    if (now !== 'check' && now !== 'post' && now !== 'guard' && now !== 'medic') faceMovement(self, ctx, dt);
  }

  /** Осмотреться: раненые свои (HELIX), нарушения, иногда — проверка «для порядка». */
  private lookAround(): void {
    const { self, ctx } = this;
    const law = ctx.law;
    const zone = ctx.map.zoneAtWorld(self.x, self.y);
    const atCheckpoint = zone?.kind === 'checkpoint';
    // Техник TECH: сканер в воздухе, пока есть заряд.
    if (self.division === 'tech' && !ctx.scanners.of(self) && ctx.map.levelAt(self.x, self.y) === 'city') {
      if (!ctx.scanners.deploy(self)) self.say('Сканер пошёл.', ctx.law.now, 2);
    }
    // Наблюдатель OBS: неотсканированное тело в городе поблизости — идёт сканировать.
    if (self.division === 'jury' && !this.guardPost) {
      const O = CP_UNITS.obs;
      const c = ctx.combat.corpses.find(
        (k) => !k.scanned && k.killer && !FACTIONS[k.killer.faction].authority && Math.hypot(k.x - self.x, k.y - self.y) < O.seek && ctx.map.levelAt(k.x, k.y) === 'city',
      );
      if (c) {
        this.corpse = c;
        this.fsm.change('scan');
        return;
      }
    }
    if (self.division === 'helix') {
      const p = this.findPatient(this.medicStation ? 450 : 260);
      if (p) {
        this.patient = p;
        this.fsm.change('heal');
        return;
      }
    }
    for (const o of ctx.entities.near(self.x, self.y, VISION.npcRange, near)) {
      if (o === self) continue;
      const v = law.observe(self, o);
      if (!v) continue;
      if (v === 'rebel') ctx.war.sighted(o);
      // Вооружённого врага берёт на себя бой (Gunner), остальных — задерживаем.
      if (ctx.combat.threat(self, o)) continue;
      // Часовой не уходит с поста ради беготни по городу.
      if (this.guardPost && !atCheckpoint) continue;
      this.engage(o, v);
      return;
    }
    if (ctx.war.code === 'red' || this.medicStation) return;
    for (const o of near) {
      // Работника ГСР на раздаче плановой проверкой не дёргают.
      if (o === self || !law.checkable(o) || o === ctx.economy.dispenser) continue;
      const inCheckpoint = ctx.map.zoneAtWorld(o.x, o.y)?.kind === 'checkpoint';
      // Код жёлтый — проверки чаще.
      // Неблагонадёжных проверяют чаще, лоялистов — реже.
      const chance = atCheckpoint && inCheckpoint
        ? LAW.checkpointCheckChance
        : LAW.randomCheckChance * (ctx.war.code === 'yellow' ? LAW.alarmCheckMul : 1) * (hasLoyalty(o) ? loyaltyTier(o).checkMul : 1);
      if (ctx.rng.chance(chance) && law.canSee(self, o)) {
        this.engage(o, 'routine');
        return;
      }
    }
  }

  /** Раненый сотрудник Альянса поблизости. */
  findPatient(range: number): Character | null {
    let best: Character | null = null;
    let bestD = range;
    for (const o of this.ctx.entities.near(this.self.x, this.self.y, range, near)) {
      if (o === this.self || !FACTIONS[o.faction].authority || o.health >= o.maxHealth * 0.75) continue;
      const d = Math.hypot(o.x - this.self.x, o.y - this.self.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
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

  /** Идти в точку (перестраивая путь при неудаче). */
  goToPoint(p: Vec2, dt: number, interval = 2): void {
    this.repath -= dt;
    if (this.repath > 0 && this.mover.status !== 'failed' && this.mover.status !== 'idle') return;
    this.repath = interval;
    const a = this.ctx.nav.nearestWalkable(p.x, p.y, 5);
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
      const a = randomAnchorAround(self, ctx, LAW.patrolDistance[0], LAW.patrolDistance[1], b.patrolAvoid);
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

/** Пост далеко (подкрепление из Цитадели) — к нему бегом. */
function guardSpeed(b: CpBrain): number {
  const p = b.guardPost!;
  return dist(b.self.x, b.self.y, p.x, p.y) > LAW.cpRunToPost ? LAW.cpRunSpeed : LAW.cpWalkSpeed;
}

const GUARD: State<CpBrain> = {
  name: 'guard',
  enter(b) {
    b.mover.speed = guardSpeed(b);
    const p = b.guardPost!;
    const a = b.ctx.nav.nearestWalkable(p.x, p.y, 3);
    if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
  },
  update(b, dt) {
    const p = b.guardPost!;
    if (b.mover.status === 'arrived' || dist(b.self.x, b.self.y, p.x, p.y) < 12) {
      b.mover.stop();
      turnTowards(b.self, b.guardFacing, dt, 3);
    } else {
      b.mover.speed = guardSpeed(b);
      if (b.mover.status === 'failed' || b.mover.status === 'idle') {
        const a = b.ctx.nav.nearestWalkable(p.x, p.y, 3);
        if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
      }
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
    if (b.fsm.time < LAW.checkTime * (b.self.division === 'jury' ? LAW.juryCheckMul : 1)) return;
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

/** Бой: стоит (часовой — на посту) и стреляет, пока есть цель. */
const FIGHT: State<CpBrain> = {
  name: 'fight',
  enter(b) {
    b.mover.stop();
  },
  update(b) {
    if (!b.gunner.target) return b.idleState;
    // Отошёл от поста — вернуться на пост (там укрытие).
    if (b.guardPost && dist(b.self.x, b.self.y, b.guardPost.x, b.guardPost.y) > 24 && b.mover.status !== 'moving' && b.mover.status !== 'pending') {
      const a = b.ctx.nav.nearestWalkable(b.guardPost.x, b.guardPost.y, 3);
      if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
    }
  },
};

/** Ранен: отходит в бункер КПП / к медику / к Нексусу и ждёт лечения. */
const RETREAT: State<CpBrain> = {
  name: 'retreat',
  enter(b) {
    b.mover.speed = LAW.cpRunSpeed * 0.9;
    b.repath = 0;
    const f = b.front >= 0 ? b.ctx.war.fronts[b.front] : null;
    let dest: Vec2 | null = null;
    if (f && f.bunker.length) {
      const a = f.bunker[Math.floor(b.ctx.rng.next() * f.bunker.length)];
      dest = { x: b.ctx.nav.worldX(a), y: b.ctx.nav.worldY(a) };
    } else dest = poiWorld(b.ctx, 'nexus_desk');
    b.retreatTo = dest;
  },
  update(b, dt) {
    if (b.retreatTo && dist(b.self.x, b.self.y, b.retreatTo.x, b.retreatTo.y) > 20) b.goToPoint(b.retreatTo, dt);
    else {
      b.mover.stop();
      // В укрытии — перевязаться своим (аптечка, бинт), если давно не попадали.
      if (b.ctx.combat.now - b.self.lastHurt > COMBAT.selfHealCalm) {
        const kit = b.self.inventory.has('medkit') ? 'medkit' : b.self.inventory.has('bandage') ? 'bandage' : null;
        if (kit && b.ctx.economy.use(b.self, kit)) b.self.say('Перевязываюсь.', b.ctx.law.now, 1.5);
      }
    }
    // Регенерация поднимает до COMBAT.regenCap — возвращаемся чуть ниже, не дожидаясь медика.
    if (b.self.health >= b.self.maxHealth * (COMBAT.regenCap - 0.05)) {
      b.mover.speed = LAW.cpWalkSpeed;
      return b.idleState;
    }
  },
};

/** Медик HELIX на КПП: ждёт в бункере, выходит к раненым. */
const MEDIC: State<CpBrain> = {
  name: 'medic',
  enter(b) {
    b.mover.speed = LAW.cpWalkSpeed;
  },
  update(b, dt) {
    const st = b.medicStation!;
    if (dist(b.self.x, b.self.y, st.x, st.y) > 20) b.goToPoint(st, dt);
    else b.mover.stop();
  },
};

/** Лечение раненого сотрудника: подойти и лечить, пока не поправится. */
const HEAL: State<CpBrain> = {
  name: 'heal',
  enter(b) {
    b.mover.speed = LAW.cpRunSpeed * 0.85;
    b.repath = 0;
  },
  update(b, dt) {
    const p = b.patient;
    if (!p || !p.alive || p.health >= p.maxHealth * 0.95) {
      b.patient = null;
      b.mover.speed = LAW.cpWalkSpeed;
      return b.idleState;
    }
    if (dist(b.self.x, b.self.y, p.x, p.y) > COMBAT.healRange) {
      b.follow(p, dt, 0.6);
      return;
    }
    b.mover.stop();
    faceTowards(b.self, p.x, p.y, dt);
    if (b.healCooldown <= 0 && b.ctx.combat.heal(p, COMBAT.healAmount)) {
      b.healCooldown = COMBAT.healCooldown;
      b.self.say('Держись, латаю.', b.ctx.law.now, 1.5);
    }
  },
};

/** Красный код: идти к последней известной позиции прорвавшихся. */
const HUNT: State<CpBrain> = {
  name: 'hunt',
  enter(b) {
    b.mover.speed = LAW.cpWalkSpeed * 1.3;
    b.repath = 0;
  },
  update(b, dt) {
    if (!b.shouldHunt()) {
      b.mover.speed = LAW.cpWalkSpeed;
      return 'patrol';
    }
    const p = b.ctx.war.nearestKnown(b.self.x, b.self.y);
    if (!p) {
      if (b.mover.status !== 'moving' && b.mover.status !== 'pending') {
        const a = randomAnchorAround(b.self, b.ctx, 10, 40, b.patrolAvoid);
        if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
      }
      return;
    }
    b.goToPoint(p, dt, 3);
  },
};

/** Охрана: держится в нескольких шагах за подопечным, отвечает огнём; по истечении — назад в патруль. */
const BODYGUARD: State<CpBrain> = {
  name: 'bodyguard',
  enter(b) {
    b.mover.speed = LAW.cpWalkSpeed * 1.25;
    b.repath = 0;
    if (b.ward) b.self.say('Юнит на сопровождении. Держитесь рядом.', b.ctx.law.now, 3);
  },
  update(b, dt) {
    const w = b.ward;
    if (!w || !w.alive || b.ctx.law.now >= b.wardUntil) {
      b.ward = null;
      return 'patrol';
    }
    const d = Math.hypot(w.x - b.self.x, w.y - b.self.y);
    b.repath -= dt;
    if (d > 70 && (b.repath <= 0 || b.mover.status === 'idle' || b.mover.status === 'arrived')) {
      b.repath = 0.8;
      const a = b.ctx.nav.nearestWalkable(w.x, w.y, 3);
      if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
    } else if (d < 44) b.mover.stop();
    b.mover.speed = d > 160 ? CHARACTER.runSpeed * 0.9 : LAW.cpWalkSpeed * 1.25;
  },
  exit(b) {
    b.mover.speed = LAW.cpWalkSpeed;
  },
};

/** Наблюдатель OBS: подойти к телу, сканировать CP_UNITS.obs.scanTime с, объявить убийцу в розыск. */
const SCAN: State<CpBrain> = {
  name: 'scan',
  enter(b) {
    b.scanLeft = CP_UNITS.obs.scanTime;
    b.repath = 0;
    b.mover.speed = LAW.cpWalkSpeed * 1.2;
  },
  update(b, dt) {
    const c = b.corpse;
    if (!c || c.scanned || !b.ctx.combat.corpses.includes(c)) {
      b.corpse = null;
      return b.idleState;
    }
    if (dist(b.self.x, b.self.y, c.x, c.y) > CP_UNITS.obs.reach - 8) {
      b.goToPoint(c, dt, 2);
      return;
    }
    b.mover.stop();
    faceTowards(b.self, c.x, c.y, dt);
    if (b.scanLeft === CP_UNITS.obs.scanTime) b.self.say('Сканирую тело.', b.ctx.law.now, 2);
    if ((b.scanLeft -= dt) <= 0) {
      b.ctx.crime.investigate(c, b.self);
      b.corpse = null;
      return b.idleState;
    }
  },
  exit(b) {
    b.mover.speed = LAW.cpWalkSpeed;
  },
};
