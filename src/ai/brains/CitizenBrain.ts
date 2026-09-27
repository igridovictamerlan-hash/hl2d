import type { Brain } from '../Brain';
import { BARKS } from '../../config/barks';
import { streetBark } from '../streetBark';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import type { ZoneKind } from '../../world/GameMap';
import { Mover } from '../Mover';
import { StateMachine, type State } from '../StateMachine';
import { randomAnchorAround, randomAnchorInZone, zoneIds } from '../destinations';
import { faceMovement, faceTowards, turnTowards } from '../facing';
import { AI } from '../../config/ai';
import { CHARACTER } from '../../config/entities';
import { LAW } from '../../config/law';
import { FACTIONS } from '../../config/factions';
import { ECONOMY } from '../../config/economy';
import { ITEMS, type ItemId } from '../../config/items';
import type { RepairSpot } from '../../systems/EconomySystem';
import type { TrashPile } from '../../systems/LaborSystem';
import { LABOR } from '../../config/labor';
import { CRIME } from '../../config/crime';
import type { Vec2 } from '../../core/math';
import { STREET } from '../../config/street';
import type { Barrel, Bench, CardTable, NoticeBoard } from '../../systems/StreetLife';
import { FAMILIES } from '../../config/families';
import { lineOfSight } from '../../world/visibility';
import { CWU_HQ } from '../../config/cwuHq';
import { PARTISANS } from '../../config/underground';

/** Работа по профессии (ГСР, вортигонт, отброс общества). */
type Job =
  | { kind: 'dispense' }
  | { kind: 'repair'; spot: RepairSpot }
  | { kind: 'clerk'; until: number }
  | { kind: 'pack'; until: number; station: Vec2 | null; belt: Vec2 | null }
  | { kind: 'apply'; until: number }
  | { kind: 'rest'; spot: Vec2; until: number; lines: readonly string[] }
  | { kind: 'office'; until: number }
  | { kind: 'hire'; until: number }
  | { kind: 'deliver'; carry: boolean }
  | { kind: 'clean'; pile: TrashPile }
  | { kind: 'scavenge'; pile: TrashPile; left: number }
  | { kind: 'heal'; patient: Character; repath: number }
  | { kind: 'pickpocket'; victim: Character; left: number; until: number; repath: number }
  | { kind: 'rob'; victim: Character; left: number; until: number; repath: number; threatened: boolean }
  | { kind: 'paper'; desk: Vec2; until: number; nextPay: number };

/** Чем отличаются гражданин, рабочий ГСР и повстанец в поведении «на улице». */
export interface StreetProfile {
  /** Шанс пойти в «свою» зону вместо случайной точки. */
  favouriteChance: number;
  favourite: ZoneKind[];
  /** Повстанцы уходят подальше, завидев ГО. */
  avoidCp: boolean;
}

const PROFILES: Record<'citizen' | 'cwu' | 'rebel' | 'vort', StreetProfile> = {
  citizen: { favouriteChance: AI.citizen.plazaChance, favourite: ['plaza'], avoidCp: false },
  cwu: { favouriteChance: 0.6, favourite: ['plaza', 'industrial'], avoidCp: false },
  rebel: { favouriteChance: 0.2, favourite: ['industrial', 'residential'], avoidCp: true },
  vort: { favouriteChance: 0.4, favourite: ['residential', 'industrial'], avoidCp: false },
};

const near: Character[] = [];

/** Состояния, в которых мозг сам решает, куда смотреть (не «по ходу движения»). */
const SELF_FACING = new Set(['stopped', 'chat', 'barrel', 'listen', 'bench', 'cards', 'smoke', 'notice']);

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
  /** Уличная жизнь: собеседник (ведущий заговорил первым), время беседы, реплики. */
  partner: Character | null = null;
  chatLead = false;
  chatUntil = 0;
  chatPair: readonly [string, string] | null = null;
  chatLine = 0;
  nextLine = 0;
  meetUntil = 0;
  lastChat = -1e9;
  /** Место у бочки, сколько стоять (у бочки, дома, на обращении). */
  barrel: { barrel: Barrel; slot: number } | null = null;
  /** Место на скамейке проспекта. */
  bench: { bench: Bench; seat: number } | null = null;
  /** Место за столом для карт, доска объявлений. */
  table: { table: CardTable; seat: number } | null = null;
  board: NoticeBoard | null = null;
  stayUntil = 0;
  /** На какое обращение Администратора уже решали, идти ли. */
  heardBroadcast = 0;
  /** Остановился оглядеться: до какого времени, куда смотрит, куда шёл. */
  glanceUntil = 0;
  glanceDir = 0;
  glanceGoal = -1;
  /** Бунт (спецагент поднял): вокруг какой точки и до какого времени. */
  riotAt: Vec2 | null = null;
  riotUntil = 0;

  constructor(
    public self: Character,
    public ctx: AiContext,
  ) {
    const [smin, smax] = CHARACTER.npcWalkSpeed;
    this.walkSpeed = ctx.rng.range(smin, smax);
    this.mover = new Mover(this.walkSpeed);
    this.avoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands', 'wasteland', 'rebel_camp']);
    this.mover.avoidZones = this.avoid;
    const f = self.faction === 'cwu' || self.faction === 'rebel' || self.faction === 'vort' ? self.faction : 'citizen';
    this.profile = PROFILES[f];
    this.fsm = new StateMachine<CitizenBrain>(this, [IDLE, WALK, STOPPED, FLEE, QUEUE, SHOP, WORK, SHELTER, PANIC, CHAT, BARREL, HOME, LISTEN, BENCH, CARDS, SMOKE, NOTICE, RIOT], 'idle');
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
      else if (self.profession === 'cook' && ctx.economy.open && !ctx.economy.dispenser && (cur === 'idle' || cur === 'walk')) {
        if (ctx.economy.claimDispenser(self)) {
          this.job = { kind: 'dispense' };
          this.fsm.change('work');
        }
      }
    }
    if (this.profile.avoidCp && (cur === 'walk' || cur === 'idle')) this.watchForCp(dt);
    this.checkBroadcast();
    if ((cur === 'walk' || cur === 'idle' || cur === 'queue') && ctx.rng.chance(BARKS.ambientPerSec * dt)) streetBark(self, ctx);
    this.fsm.update(dt);
    this.mover.update(self, ctx, dt);
    if (!SELF_FACING.has(this.fsm.current) && this.glanceUntil <= ctx.law.now) faceMovement(self, ctx, dt);
  }

  /**
   * Втянуть в бунт: бегать вокруг center и кричать лозунги до until (для ГО — нарушение 'riot').
   * Занятых делом, задержанных и лоялистов не втягивает.
   */
  startRiot(self: Character, center: Vec2, until: number): boolean {
    const cur = this.fsm.current;
    if (this.job || self.law.phase !== 'none' || cur === 'panic' || cur === 'shelter' || cur === 'queue') return false;
    if (self.loyalty >= PARTISANS.riot.maxLoyalty) return false;
    this.riotAt = center;
    this.riotUntil = until;
    self.law.riotUntil = until;
    this.fsm.change('riot');
    return true;
  }

  /** Житель, у которого есть уличная жизнь (не вортигонт, не на работе). */
  get street(): boolean {
    const f = this.self.faction;
    return (f === 'citizen' || f === 'cwu' || f === 'rebel') && !this.job;
  }

  /** Обращение Администратора: жители поблизости идут на площадь послушать. */
  private checkBroadcast(): void {
    const st = this.ctx.street;
    const cur = this.fsm.current;
    if (!st?.broadcasting || this.heardBroadcast === st.broadcast || (cur !== 'idle' && cur !== 'walk') || !this.street) return;
    this.heardBroadcast = st.broadcast;
    const B = STREET.broadcast;
    const p = st.plaza!;
    if (this.self.faction === 'rebel' || Math.hypot(p.x - this.self.x, p.y - this.self.y) > B.radius || !this.ctx.rng.chance(B.joinChance)) return;
    this.fsm.change('listen');
  }

  /** Свободен ли житель для разговора. */
  private chattable(o: Character): boolean {
    const b = o.brain;
    if (o === this.self || !o.alive || o.isPlayer || !(b instanceof CitizenBrain) || !b.street) return false;
    if (b.fsm.current !== 'idle' && b.fsm.current !== 'walk') return false;
    return o.law.phase === 'none' && this.ctx.law.now - b.lastChat > STREET.chat.cooldown && b.glanceUntil <= this.ctx.law.now;
  }

  /** Заговорить с ближайшим свободным жителем (он останавливается и ждёт). */
  private startChat(): boolean {
    const { self, ctx } = this;
    if (ctx.law.now - this.lastChat < STREET.chat.cooldown) return false;
    let best: Character | null = null;
    let bestD: number = STREET.chat.seek;
    for (const o of ctx.entities.near(self.x, self.y, STREET.chat.seek, near)) {
      if (!this.chattable(o)) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < bestD && lineOfSight(ctx.map, self.x, self.y, o.x, o.y)) {
        best = o;
        bestD = d;
      }
    }
    if (!best) return false;
    return this.beginChat(best);
  }

  /** Семья: заговорить с родственником — даже далеко (идёт к нему через полгорода). */
  private startFamilyChat(): boolean {
    const { self, ctx } = this;
    if (ctx.law.now - this.lastChat < STREET.chat.cooldown) return false;
    let best: Character | null = null;
    let bestD: number = FAMILIES.visitSeek;
    for (const o of ctx.families.kin(self)) {
      if (!this.chattable(o)) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < bestD && ctx.map.levelAt(o.x, o.y) === ctx.map.levelAt(self.x, self.y)) {
        best = o;
        bestD = d;
      }
    }
    if (!best) return false;
    ctx.street.stats.family++;
    return this.beginChat(best);
  }

  private beginChat(best: Character): boolean {
    const { self, ctx } = this;
    const pb = best.brain as CitizenBrain;
    this.partner = best;
    this.chatLead = true;
    pb.partner = self;
    pb.chatLead = false;
    pb.fsm.change('chat');
    ctx.street.stats.chats++;
    return true;
  }

  /** Уличное занятие вместо прогулки (или null — просто прогуляться). */
  private streetActivity(): string | null {
    const { ctx } = this;
    // Воры и бандиты «работают» на улице: им не до бесед и бочек.
    const hustler = this.self.profession === 'thief' || this.self.profession === 'bandit';
    if (!this.street || hustler || ctx.war.code === 'red' || !ctx.street || !ctx.rng.chance(STREET.activityChance)) return null;
    const W = STREET.weights;
    const st = ctx.street;
    // Скамейки — только при зелёном коде; родня — если есть семья; карты — в общежитиях.
    const bench = ctx.war.code === 'green' && st.benches.length ? W.bench : 0;
    const family = this.self.family >= 0 ? W.family : 0;
    // Рабочим ГСР засиживаться за картами некогда.
    const cards = st.tables.length && this.self.faction !== 'cwu' ? W.cards : 0;
    const notice = st.boards.length ? W.notice : 0;
    let r = ctx.rng.range(0, W.chat + W.barrel + W.home + bench + family + cards + W.smoke + notice);
    if ((r -= W.chat) < 0) return this.startChat() ? 'chat' : null;
    if ((r -= W.barrel) < 0) return 'barrel';
    if ((r -= bench) < 0) return 'bench';
    if ((r -= family) < 0) return this.startFamilyChat() ? 'chat' : 'home';
    if ((r -= cards) < 0) return 'cards';
    if ((r -= W.smoke) < 0) return 'smoke';
    if ((r -= notice) < 0) return 'notice';
    return 'home';
  }

  /** Беседа окончена: оба расходятся (иногда ведущий уводит собеседника гулять вместе). */
  endChat(stroll: boolean): void {
    const p = this.partner;
    const { ctx } = this;
    this.partner = null;
    this.lastChat = ctx.law.now;
    const pb = p?.brain instanceof CitizenBrain && p.brain.partner === this.self ? p.brain : null;
    if (pb) {
      pb.partner = null;
      pb.lastChat = ctx.law.now;
    }
    if (stroll && pb && p) {
      const goal = this.pickGoal();
      const side = goal >= 0 ? randomAnchorAround({ x: ctx.nav.worldX(goal), y: ctx.nav.worldY(goal) }, ctx, 1, 3, this.avoid) : -1;
      if (goal >= 0 && side >= 0) {
        this.mover.speed = pb.mover.speed = Math.min(this.walkSpeed, pb.walkSpeed);
        this.mover.goTo(this.self, ctx, goal);
        pb.mover.goTo(p, ctx, side);
        this.fsm.change('walk');
        pb.fsm.change('walk');
        return;
      }
    }
    if (pb && pb.fsm.current === 'chat') {
      pb.idleLeft = ctx.rng.range(1, 3);
      pb.fsm.change('idle');
    }
    if (this.fsm.current === 'chat') {
      this.idleLeft = ctx.rng.range(1, 3);
      this.fsm.change('idle');
    }
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
    const job = this.pickJob();
    if (job) {
      this.job = job;
      return 'work';
    }
    if (self.faction === 'vort') return 'walk';
    if (eco.open && eco.cycle !== this.consideredCycle && !eco.hasBeenServed(self) && self.faction !== 'rebel') {
      this.consideredCycle = eco.cycle;
      if (ctx.rng.chance(ECONOMY.rations.npcJoinChance)) return 'queue';
    }
    if (eco.shopCounter && self.money >= 6 && self.hunger < 75 && ctx.rng.chance(ECONOMY.shop.npcVisitChance)) return 'shop';
    return this.streetActivity() ?? 'walk';
  }

  /**
   * Работа по профессии: повар — раздача и прилавок; фасовщик — завод; курьер — коробки с завода
   * к будке; уборщик — поломки и мусор; медик ГСР — раненые рядом; вортигонт — мусор;
   * отброс общества — порыться в мусоре.
   */
  private pickJob(): Job | null {
    const { ctx, self } = this;
    const eco = ctx.economy;
    const labor = ctx.labor;
    // Лоялист — бумажная работа для Администратора в канцелярии Нексуса (за столом, за плату).
    const PW = LABOR.paperwork;
    // Идёт раздача, а паёк не получен — сначала очередь.
    const rationsFirst = eco.open && !eco.hasBeenServed(self);
    if (self.faction === 'citizen' && self.profession === 'citizen' && self.loyalty >= PW.minLoyalty && !rationsFirst && !ctx.war.curfew && labor.desks.length && ctx.rng.chance(PW.chance)) {
      const desk = labor.claimDesk(self);
      if (desk) return { kind: 'paper', desk, until: ctx.law.now + ctx.rng.range(PW.time[0], PW.time[1]), nextPay: ctx.law.now + PW.payEvery };
    }
    // Штаб ГСР: гражданин идёт устраиваться (если есть места), рабочий — на перерыв.
    const hq = ctx.cwuHq;
    if (hq?.present && !ctx.war.curfew && !rationsFirst) {
      const H = CWU_HQ;
      // Лоялисты работают с бумагами в канцелярии — в штаб идут остальные.
      if (self.faction === 'citizen' && self.profession === 'citizen' && self.loyalty < PW.minLoyalty && !self.isPlayer && self.law.phase === 'none' && ctx.rng.chance(H.hire.chance) && hq.vacancy() && hq.apply(self)) {
        return { kind: 'apply', until: ctx.law.now + H.hire.waitMax };
      }
      if (self.faction === 'cwu' && self.profession !== 'cwu_head' && !self.carrying && hq.restSpots.length && ctx.rng.chance(H.rest.chance)) {
        return { kind: 'rest', spot: ctx.rng.pick(hq.restSpots), until: ctx.law.now + ctx.rng.range(H.rest.time[0], H.rest.time[1]), lines: H.lines.rest };
      }
    }
    switch (self.profession) {
      case 'cwu_head': {
        // Глава ГСР: к стойке, если ждут соискатели; иначе кабинет или обход штаба.
        if (!hq?.present) return null;
        if (hq.queue.length) return { kind: 'hire', until: ctx.law.now + 60 };
        const H = CWU_HQ.head;
        if (hq.roundSpots.length && ctx.rng.chance(H.roundChance)) {
          return { kind: 'rest', spot: ctx.rng.pick(hq.roundSpots), until: ctx.law.now + ctx.rng.range(H.round[0], H.round[1]), lines: CWU_HQ.lines.head };
        }
        return { kind: 'office', until: ctx.law.now + ctx.rng.range(H.desk[0], H.desk[1]) };
      }
      case 'cook': {
        if (eco.open && (!eco.dispenser || eco.dispenser === self) && eco.claimDispenser(self)) return { kind: 'dispense' };
        if (eco.shopCounter && ctx.rng.chance(0.5)) {
          const busy = ctx.entities.near(eco.shopCounter.x, eco.shopCounter.y, 40).some((o) => o.profession === 'cook' && o !== self);
          if (!busy) return { kind: 'clerk', until: ctx.law.now + ctx.rng.range(40, 80) };
        }
        return null;
      }
      case 'packer': {
        if (!labor.factory || labor.boxes >= LABOR.factory.maxBoxes) return null;
        const st = labor.claimStation(self);
        return st ? { kind: 'pack', until: ctx.law.now + ctx.rng.range(40, 90), station: st, belt: st.belt } : null;
      }
      case 'courier':
        if (self.carrying) return { kind: 'deliver', carry: true };
        return labor.factoryStore && labor.deliveryNeeded ? { kind: 'deliver', carry: false } : null;
      case 'janitor': {
        // Поломки важнее мусора.
        const spots = eco.brokenSpots().filter((r) => !r.worker && r.kind === 'fuse');
        if (spots.length) {
          spots.sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y));
          spots[0].worker = self;
          return { kind: 'repair', spot: spots[0] };
        }
        return this.cleanJob();
      }
      case 'vort_slave':
        return this.cleanJob();
      case 'cwu_medic': {
        const M = LABOR.medic;
        let best: Character | null = null;
        for (const o of ctx.entities.near(self.x, self.y, M.seek, near)) {
          if (o === self || !o.alive || o.isPlayer || o.hostile || o.faction === 'rebel' || o.faction === 'vort') continue;
          if (o.health >= o.maxHealth * M.below || o.law.phase !== 'none') continue;
          if (!FACTIONS[o.faction].authority && o.money < M.fee) continue;
          if (!best || o.health < best.health) best = o;
        }
        return best && (self.inventory.has('bandage') || self.inventory.has('medkit')) ? { kind: 'heal', patient: best, repath: 0 } : null;
      }
      case 'thief': {
        if (!ctx.rng.chance(CRIME.npc.chance) || this.cpInSight(250)) return null;
        let victim: Character | null = null;
        let bestD = Infinity;
        for (const o of ctx.entities.near(self.x, self.y, CRIME.npc.seek, near)) {
          if (!ctx.crime.victimOk(self, o) || o.money < CRIME.npc.minMoney || o.profession === 'thief') continue;
          const d = Math.hypot(o.x - self.x, o.y - self.y);
          if (d < bestD) {
            bestD = d;
            victim = o;
          }
        }
        return victim ? { kind: 'pickpocket', victim, left: CRIME.pickpocket.time, until: ctx.law.now + CRIME.npc.giveUp, repath: 0 } : null;
      }
      case 'bandit': {
        // Гоп-стоп: жертва в подворотне, ГО рядом не видно.
        if (!ctx.rng.chance(CRIME.rob.npcChance) || this.cpInSight(260)) return null;
        let victim: Character | null = null;
        let bestD = Infinity;
        for (const o of ctx.entities.near(self.x, self.y, CRIME.rob.seek, near)) {
          if (!ctx.crime.robOk(self, o) || o.money < CRIME.npc.minMoney || o.profession === 'bandit' || o.isPlayer) continue;
          const d = Math.hypot(o.x - self.x, o.y - self.y);
          if (d < bestD) {
            bestD = d;
            victim = o;
          }
        }
        return victim ? { kind: 'rob', victim, left: CRIME.rob.time, until: ctx.law.now + CRIME.npc.giveUp, repath: 0, threatened: false } : null;
      }
      case 'outcast': {
        const pile = labor.trash.filter((p) => !p.searched).sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y))[0];
        return pile && ctx.rng.chance(0.6) ? { kind: 'scavenge', pile, left: LABOR.trash.searchTime } : null;
      }
    }
    return null;
  }

  /** Видит ли сотрудника Альянса поблизости (вор не идёт на дело при свидетелях). */
  cpInSight(r: number): boolean {
    for (const o of this.ctx.entities.near(this.self.x, this.self.y, r, near)) {
      if (FACTIONS[o.faction].authority && o.alive && this.ctx.law.canSee(this.self, o)) return true;
    }
    return false;
  }

  /** Ближайшая свободная куча мусора (не дальше ~полгорода). */
  private cleanJob(): Job | null {
    const pile = this.ctx.labor.nearestTrash(this.self.x, this.self.y, true, 1400);
    if (!pile) return null;
    pile.worker = this.self;
    return { kind: 'clean', pile };
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
  update(b, dt) {
    const now = b.ctx.law.now;
    // Остановился оглядеться — потом дальше к той же цели.
    if (b.glanceUntil > now) {
      turnTowards(b.self, b.glanceDir, dt, 3);
      return;
    }
    if (b.glanceGoal >= 0) {
      b.mover.goTo(b.self, b.ctx, b.glanceGoal);
      b.glanceGoal = -1;
      return;
    }
    const st = b.mover.status;
    if (b.mover.goal < 0 || st === 'arrived' || st === 'failed' || st === 'idle') {
      b.idleLeft = st === 'failed' ? 0.6 : 0;
      return 'idle';
    }
    const G = STREET.glance;
    if (b.street && st === 'moving' && b.self.moveSpeed > 8 && b.ctx.rng.chance(G.perSec * dt)) {
      b.glanceGoal = b.mover.goal;
      b.mover.stop();
      b.glanceUntil = now + b.ctx.rng.range(G.time[0], G.time[1]);
      b.glanceDir = b.self.facing + b.ctx.rng.range(-2.2, 2.2);
    }
  },
  exit(b) {
    b.glanceUntil = 0;
    b.glanceGoal = -1;
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
    const labor = b.ctx.labor;
    if (job.kind === 'dispense') b.goToPoint(eco.dispenserSpot);
    else if (job.kind === 'repair') b.goToPoint(job.spot);
    else if (job.kind === 'pack') {
      const f = job.station ?? labor.factory;
      if (f) b.goToPoint(f);
    } else if (job.kind === 'rest') b.goToPoint(job.spot);
    else if (job.kind === 'office' || job.kind === 'hire' || job.kind === 'apply') {
      const hq = b.ctx.cwuHq;
      const to = job.kind === 'office' ? hq.desk : job.kind === 'hire' ? hq.counter : hq.queueSpot(b.self);
      if (to) b.goToPoint(to);
    } else if (job.kind === 'deliver') {
      const to = job.carry ? labor.boothDrop : labor.factoryStore;
      if (to) b.goToPoint(to);
    } else if (job.kind === 'clean' || job.kind === 'scavenge') b.goToPoint(job.pile);
    else if (job.kind === 'heal') b.goToPoint(job.patient);
    else if (job.kind === 'pickpocket') b.goToPoint(job.victim);
    else if (job.kind === 'paper') {
      // В Нексус жителю обычно не нужно (избегает), в канцелярию — можно.
      b.mover.avoidZones = undefined;
      b.goToPoint(job.desk);
    } else if (eco.shopCounter) b.goToPoint(eco.shopCounter);
  },
  update(b, dt) {
    const job = b.job;
    const eco = b.ctx.economy;
    const labor = b.ctx.labor;
    const done = () => {
      if (job?.kind === 'dispense') eco.releaseDispenser(b.self);
      if (job?.kind === 'repair' && job.spot.worker === b.self) job.spot.worker = null;
      if (job?.kind === 'clean' && job.pile.worker === b.self) job.pile.worker = null;
      if (job?.kind === 'pack') {
        labor.stopPacking(b.self);
        labor.releaseStation(b.self);
      }
      if (job?.kind === 'apply') b.ctx.cwuHq.leave(b.self);
      if (job?.kind === 'paper') labor.releaseDesk(b.self);
      b.mover.avoidZones = b.avoid;
      b.mover.speed = b.walkSpeed;
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
        // Открылась раздача, а у окна никого — повар бросает прилавок и идёт выдавать.
        const toWindow = b.self.profession === 'cook' && eco.open && !eco.dispenser;
        if (b.ctx.law.now > job.until || !eco.shopCounter || toWindow) return done();
        if (st === 'arrived') b.mover.stop();
        if (b.fsm.time % 10 < dt) eco.markWorked(b.self);
        return;
      }
      case 'paper': {
        const now = b.ctx.law.now;
        if (now > job.until || b.ctx.war.curfew) return done();
        const d = job.desk;
        if (Math.hypot(d.x - b.self.x, d.y - b.self.y) < 14) {
          b.mover.stop();
          faceTowards(b.self, d.x, d.y - 16, dt);
          if (now >= job.nextPay) {
            job.nextPay = now + LABOR.paperwork.payEvery;
            labor.payPaperwork(b.self);
            if (b.ctx.rng.chance(0.4)) b.self.say(b.ctx.rng.pick(['Форма 7-Б… подпись…', 'Рапорт о лояльности квартала.', 'Отчёт для Администратора готов.', 'Штамп. Следующий.']), now, 2.5);
          }
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(d);
        return;
      }
      case 'rest': {
        const now = b.ctx.law.now;
        if (now > job.until || b.ctx.war.curfew) return done();
        if (Math.hypot(job.spot.x - b.self.x, job.spot.y - b.self.y) < 20) {
          b.mover.stop();
          if (b.self.profession === 'cwu_head') b.ctx.economy.markWorked(b.self);
          if (b.fsm.time % 9 < dt && b.ctx.rng.chance(0.35)) b.self.say(b.ctx.rng.pick(job.lines), now, 3);
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(job.spot);
        return;
      }
      case 'office':
      case 'hire': {
        // Глава ГСР: за столом в кабинете или у стойки найма напротив соискателя.
        const hq = b.ctx.cwuHq;
        const now = b.ctx.law.now;
        if (job.kind === 'office' && hq.queue.length) {
          b.job = { kind: 'hire', until: now + 60 };
          if (hq.counter) b.goToPoint(hq.counter);
          return;
        }
        if (now > job.until || (job.kind === 'hire' && !hq.queue.length)) return done();
        const to = job.kind === 'office' ? hq.desk : hq.counter;
        if (!to) return done();
        if (Math.hypot(to.x - b.self.x, to.y - b.self.y) < 14) {
          b.mover.stop();
          b.ctx.economy.markWorked(b.self);
          const look = job.kind === 'hire' ? hq.applicantSpot : { x: to.x, y: to.y - 16 };
          if (look) faceTowards(b.self, look.x, look.y, dt);
          if (job.kind === 'office' && b.fsm.time % 12 < dt && b.ctx.rng.chance(0.25)) b.self.say(b.ctx.rng.pick(CWU_HQ.lines.head), now, 3);
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(to);
        return;
      }
      case 'apply': {
        // Соискатель: в очереди у стойки найма; приняли — он уже рабочий ГСР.
        const hq = b.ctx.cwuHq;
        if (b.self.faction !== 'citizen') {
          b.job = null;
          return done();
        }
        const spot = hq.queueSpot(b.self);
        if (!spot || b.ctx.law.now > job.until || b.ctx.war.curfew) return done();
        if (Math.hypot(spot.x - b.self.x, spot.y - b.self.y) < 12) {
          b.mover.stop();
          if (hq.counter) faceTowards(b.self, hq.counter.x, hq.counter.y, dt);
        } else if (st === 'idle' || st === 'arrived' || b.fsm.time % 2 < dt) b.goToPoint(spot);
        return;
      }
      case 'pack': {
        const f = job.station ?? labor.factory;
        const belt = job.belt ?? (f ? { x: f.x, y: f.y - 20 } : null);
        if (!f || !belt || b.ctx.law.now > job.until) return done();
        if (Math.hypot(f.x - b.self.x, f.y - b.self.y) < 26) {
          b.mover.stop();
          faceTowards(b.self, belt.x, belt.y, dt);
          labor.packStep(b.self, dt);
          if (labor.boxes >= LABOR.factory.maxBoxes) return done();
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(f);
        return;
      }
      case 'deliver': {
        const to = job.carry ? labor.boothDrop : labor.factoryStore;
        if (!to) return done();
        if (Math.hypot(to.x - b.self.x, to.y - b.self.y) < 26) {
          b.mover.stop();
          if (!job.carry) {
            if (!labor.takeBox(b.self)) return done();
            job.carry = true;
            b.mover.speed = b.walkSpeed * LABOR.booth.carrySpeedMul;
            b.goToPoint(labor.boothDrop);
          } else {
            labor.deliverBox(b.self);
            if (b.self.carrying) {
              // Склад будки полон — ждём у будки.
              if (b.fsm.time > 40) return done();
              return;
            }
            return done();
          }
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(to);
        return;
      }
      case 'clean': {
        if (!labor.trash.includes(job.pile)) return done();
        if (Math.hypot(job.pile.x - b.self.x, job.pile.y - b.self.y) < 22) {
          b.mover.stop();
          faceTowards(b.self, job.pile.x, job.pile.y, dt);
          if (labor.cleanStep(b.self, job.pile, dt)) return done();
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(job.pile);
        return;
      }
      case 'scavenge': {
        if (!labor.trash.includes(job.pile) || job.pile.searched) return done();
        if (Math.hypot(job.pile.x - b.self.x, job.pile.y - b.self.y) < 22) {
          b.mover.stop();
          faceTowards(b.self, job.pile.x, job.pile.y, dt);
          if ((job.left -= dt) <= 0) {
            const got = labor.search(b.self, job.pile);
            if (got) b.self.say(b.ctx.rng.pick(['О, повезло…', 'Сгодится.', 'Это пригодится.']), b.ctx.law.now, 2);
            return done();
          }
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(job.pile);
        return;
      }
      case 'rob': {
        const v = job.victim;
        const crime = b.ctx.crime;
        const combat = b.ctx.combat;
        const holster = () => {
          if (b.self.weapon) combat.equip(b.self, null);
        };
        if (!crime.robOk(b.self, v) || b.ctx.law.now > job.until || b.cpInSight(220)) {
          holster();
          return done();
        }
        if (Math.hypot(v.x - b.self.x, v.y - b.self.y) < CRIME.rob.reach) {
          b.mover.stop();
          faceTowards(b.self, v.x, v.y, dt);
          if (!job.threatened) {
            job.threatened = true;
            if (b.self.inventory.has('rebel_pistol')) combat.equip(b.self, 'rebel_pistol');
            b.self.say(b.ctx.rng.pick(['Гони токены, быстро!', 'Стоять. Кошелёк сюда.', 'Тихо! Деньги давай.']), b.ctx.law.now, 2);
          }
          if ((job.left -= dt) <= 0) {
            crime.rob(b.self, v);
            holster();
            const away = b.goalAwayFrom(v.x, v.y);
            b.job = null;
            b.mover.speed = b.walkSpeed * 1.3;
            if (away >= 0) b.mover.goTo(b.self, b.ctx, away);
            return 'walk';
          }
          return;
        }
        job.repath -= dt;
        if (job.repath <= 0 || st === 'idle' || st === 'arrived') {
          job.repath = 0.6;
          b.goToPoint(v);
        }
        return;
      }
      case 'pickpocket': {
        const v = job.victim;
        const crime = b.ctx.crime;
        if (!crime.victimOk(b.self, v) || b.ctx.law.now > job.until || b.cpInSight(200)) return done();
        if (crime.behind(b.self, v)) {
          b.mover.stop();
          faceTowards(b.self, v.x, v.y, dt);
          if ((job.left -= dt) <= 0) {
            crime.pickpocket(b.self, v);
            // Уходит быстрым шагом подальше.
            const away = b.goalAwayFrom(v.x, v.y);
            b.job = null;
            b.mover.speed = b.walkSpeed * 1.3;
            if (away >= 0) b.mover.goTo(b.self, b.ctx, away);
            return 'walk';
          }
          return;
        }
        // Заходит за спину: точка позади жертвы.
        job.repath -= dt;
        if (job.repath <= 0 || st === 'idle' || st === 'arrived') {
          job.repath = 0.6;
          b.goToPoint({ x: v.x - Math.cos(v.facing) * 18, y: v.y - Math.sin(v.facing) * 18 });
        }
        return;
      }
      case 'heal': {
        const p = job.patient;
        if (!p.alive || p.health >= p.maxHealth * LABOR.medic.below || p.law.phase !== 'none') return done();
        if (Math.hypot(p.x - b.self.x, p.y - b.self.y) < LABOR.medic.range) {
          b.mover.stop();
          faceTowards(b.self, p.x, p.y, dt);
          const err = labor.treat(b.self, p);
          if (!err) {
            b.self.say('Держитесь, сейчас перевяжу.', b.ctx.law.now, 2);
            p.say('Спасибо, доктор.', b.ctx.law.now + 0.5, 2);
          }
          return done();
        }
        job.repath -= dt;
        if (job.repath <= 0 || st === 'idle' || st === 'arrived') {
          job.repath = 1.5;
          b.goToPoint(p);
        }
        return;
      }
    }
  },
  exit(b) {
    // Ушёл с работы (тревога, приказ ГО, паника) — снять брони; коробку курьер держит при себе.
    const job = b.job;
    if (job?.kind === 'dispense') b.ctx.economy.releaseDispenser(b.self);
    if (job?.kind === 'repair' && job.spot.worker === b.self) job.spot.worker = null;
    if (job?.kind === 'clean' && job.pile.worker === b.self) job.pile.worker = null;
    if (job?.kind === 'pack') b.ctx.labor.stopPacking(b.self);
    b.job = null;
    b.mover.speed = b.walkSpeed;
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

/** Бунт: бегать вокруг точки, кричать лозунги (PARTISANS.riot). */
const RIOT: State<CitizenBrain> = {
  name: 'riot',
  enter(b) {
    b.mover.speed = CHARACTER.walkSpeed * PARTISANS.riot.speed;
    b.mover.stop();
  },
  update(b, dt) {
    const { ctx, self } = b;
    const now = ctx.law.now;
    if (now >= b.riotUntil || !b.riotAt) {
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
    const st = b.mover.status;
    if (st !== 'moving' && st !== 'pending') {
      const a = randomAnchorAround(b.riotAt, ctx, 0, PARTISANS.riot.spread, b.avoid);
      if (a >= 0) b.mover.goTo(self, ctx, a);
    }
    if (ctx.rng.chance(PARTISANS.riot.shoutPerSec * dt) && !(self.speech && self.speech.until > now)) self.say(ctx.rng.pick(PARTISANS.lines.riot), now, 2);
  },
  exit(b) {
    b.mover.speed = b.walkSpeed;
    b.riotAt = null;
    b.self.law.riotUntil = 0;
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

/** Разговор вдвоём: ведущий подходит, оба стоят лицом друг к другу и обмениваются репликами. */
const CHAT: State<CitizenBrain> = {
  name: 'chat',
  enter(b) {
    const C = STREET.chat;
    b.chatUntil = 0;
    b.chatPair = null;
    b.chatLine = 0;
    const kin = !!b.partner && b.partner.family >= 0 && b.partner.family === b.self.family;
    b.meetUntil = b.ctx.law.now + (kin ? FAMILIES.meetTimeout : C.meetTimeout);
    if (!b.chatLead) b.mover.stop();
    else if (b.partner) b.goToPoint(b.partner);
  },
  update(b, dt) {
    const C = STREET.chat;
    const { ctx, self } = b;
    const now = ctx.law.now;
    const p = b.partner;
    const pb = p?.brain instanceof CitizenBrain ? p.brain : null;
    if (!p || !p.alive || !pb || pb.partner !== self || pb.fsm.current !== 'chat') {
      b.partner = null;
      b.idleLeft = ctx.rng.range(0.5, 2);
      return 'idle';
    }
    const d = Math.hypot(p.x - self.x, p.y - self.y);
    if (!b.chatUntil) {
      faceTowards(self, p.x, p.y, dt);
      if (now > b.meetUntil) return b.endChat(false);
      if (!b.chatLead) return;
      if (d <= C.gap + 8) {
        b.mover.stop();
        b.chatUntil = pb.chatUntil = now + ctx.rng.range(C.time[0], C.time[1]);
        b.nextLine = now + 0.4;
      } else if (b.mover.status !== 'moving' && b.mover.status !== 'pending') b.goToPoint(p);
      return;
    }
    b.mover.stop();
    faceTowards(self, p.x, p.y, dt);
    if (!b.chatLead) return;
    // Ведущий ведёт беседу: вопрос — ответ собеседника — новая пара.
    if (now >= b.nextLine) {
      if (!b.chatPair || b.chatLine >= 2) {
        const kin = p.family >= 0 && p.family === self.family;
        b.chatPair = ctx.rng.pick(kin ? FAMILIES.dialogues : STREET.dialogues);
        b.chatLine = 0;
      }
      const who = b.chatLine === 0 ? self : p;
      who.say(b.chatPair[b.chatLine], now, 2.6);
      b.chatLine++;
      b.nextLine = now + ctx.rng.range(C.lineEvery[0], C.lineEvery[1]);
    }
    if (now >= b.chatUntil) b.endChat(ctx.rng.chance(C.strollChance));
  },
  exit(b) {
    // Прервали (проверка ГО, стрельба) — собеседник тоже расходится.
    const p = b.partner;
    if (!p) return;
    const now = b.ctx.law.now;
    b.partner = null;
    b.lastChat = now;
    const pb = p.brain instanceof CitizenBrain && p.brain.partner === b.self ? p.brain : null;
    if (!pb) return;
    pb.partner = null;
    pb.lastChat = now;
    if (pb.fsm.current === 'chat') {
      pb.idleLeft = b.ctx.rng.range(1, 3);
      pb.fsm.change('idle');
    }
  },
};

/** Погреться у бочки с огнём: занять место в кругу, постоять, перекинуться словом. */
const BARREL: State<CitizenBrain> = {
  name: 'barrel',
  enter(b) {
    b.stayUntil = 0;
    b.meetUntil = b.ctx.law.now + 60;
    b.barrel = b.ctx.street.takeBarrelSlot(b.self);
    if (!b.barrel || !b.goToPoint(b.barrel.barrel.slots[b.barrel.slot])) b.idleLeft = 0.5;
  },
  update(b, dt) {
    const B = STREET.barrel;
    const { ctx, self } = b;
    const now = ctx.law.now;
    const r = b.barrel;
    if (!r) return 'idle';
    const slot = r.barrel.slots[r.slot];
    const st = b.mover.status;
    if (!b.stayUntil) {
      if (st === 'failed' || now > b.meetUntil) return 'idle';
      if (st === 'arrived' || Math.hypot(slot.x - self.x, slot.y - self.y) < 10) {
        b.mover.stop();
        b.stayUntil = now + ctx.rng.range(B.time[0], B.time[1]);
      } else if (st === 'idle') b.goToPoint(slot);
      return;
    }
    faceTowards(self, r.barrel.x, r.barrel.y, dt);
    if (ctx.rng.chance(dt / ((B.lineEvery[0] + B.lineEvery[1]) / 2)) && !(self.speech && self.speech.until > now)) self.say(ctx.rng.pick(STREET.barrelLines), now, 2.8);
    if (now >= b.stayUntil) {
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
  },
  exit(b) {
    b.ctx.street.releaseBarrelSlot(b.self);
    b.barrel = null;
  },
};

/** Посидеть на скамейке проспекта (зелёный код); сосед по скамейке — беседа, ведёт младший по id. */
const BENCH: State<CitizenBrain> = {
  name: 'bench',
  enter(b) {
    b.stayUntil = 0;
    b.chatPair = null;
    b.chatLine = 0;
    b.meetUntil = b.ctx.law.now + 70;
    b.bench = b.ctx.street.takeBenchSeat(b.self);
    if (!b.bench || !b.goToPoint(b.bench.bench.seats[b.bench.seat])) b.idleLeft = 0.5;
  },
  update(b, dt) {
    const B = STREET.bench;
    const { ctx, self } = b;
    const now = ctx.law.now;
    const r = b.bench;
    if (!r) return 'idle';
    const bench = r.bench;
    const seat = bench.seats[r.seat];
    // Код сменился — встаём и уходим.
    if (ctx.war.code !== 'green') return 'idle';
    const st = b.mover.status;
    if (!b.stayUntil) {
      if (st === 'failed' || now > b.meetUntil) return 'idle';
      if (st === 'arrived' || Math.hypot(seat.x - self.x, seat.y - self.y) < 10) {
        b.mover.stop();
        b.stayUntil = now + ctx.rng.range(B.time[0], B.time[1]);
        b.nextLine = now + ctx.rng.range(1, 2.5);
      } else if (st === 'idle') b.goToPoint(seat);
      return;
    }
    b.mover.stop();
    const n = bench.taken[1 - r.seat];
    const nb = n && n.alive && n.brain instanceof CitizenBrain && n.brain.fsm.current === 'bench' && n.brain.stayUntil > 0 ? n.brain : null;
    if (nb && n) {
      // Сидят вдвоём — повернулись друг к другу вполоборота (к улице и к соседу).
      faceTowards(self, (n.x + seat.x) / 2 + bench.nx * 40, (n.y + seat.y) / 2 + bench.ny * 40, dt);
      if (self.id < n.id && now >= b.nextLine) {
        if (!b.chatPair || b.chatLine >= 2) {
          b.chatPair = ctx.rng.pick(STREET.dialogues);
          b.chatLine = 0;
          ctx.street.stats.benchTalks++;
        }
        const who = b.chatLine === 0 ? self : n;
        who.say(b.chatPair[b.chatLine], now, 2.6);
        b.chatLine++;
        b.nextLine = now + ctx.rng.range(B.lineEvery[0], B.lineEvery[1]);
      }
      // Досидеть вместе: собеседник не уходит раньше ведущего.
      if (self.id < n.id) nb.stayUntil = Math.max(nb.stayUntil, b.stayUntil);
    } else {
      faceTowards(self, seat.x + bench.nx * 60, seat.y + bench.ny * 60, dt);
      if (now >= b.nextLine) {
        b.nextLine = now + ctx.rng.range(B.soloLineEvery[0], B.soloLineEvery[1]);
        if (!(self.speech && self.speech.until > now)) self.say(ctx.rng.pick(STREET.benchLines), now, 2.6);
      }
    }
    if (now >= b.stayUntil) {
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
  },
  exit(b) {
    b.ctx.street.releaseBenchSeat(b.self);
    b.bench = null;
    b.stayUntil = 0;
  },
};

/** Зайти домой — в подъезд или квартиру жилого квартала — и побыть там. */
const HOME: State<CitizenBrain> = {
  name: 'home',
  enter(b) {
    b.stayUntil = 0;
    // Семья — к себе домой (комната общежития, особняк), иначе — в ближайший дом.
    const fam = b.ctx.families.of(b.self);
    const own = !!fam && fam.homeAnchor >= 0 && b.ctx.rng.chance(0.8);
    const a = own ? fam!.homeAnchor : b.ctx.street.homeNear(b.self);
    if (own) b.ctx.street.stats.homes++;
    if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
    else b.idleLeft = 0.5;
  },
  update(b) {
    const st = b.mover.status;
    const now = b.ctx.law.now;
    if (!b.stayUntil) {
      if (st === 'failed' || st === 'idle') return 'idle';
      if (st === 'arrived') b.stayUntil = now + b.ctx.rng.range(STREET.home.time[0], STREET.home.time[1]);
      return;
    }
    if (now >= b.stayUntil) {
      b.idleLeft = 0.5;
      return 'walk';
    }
  },
};

/** Карты в общей комнате общежития: сесть за стол, играть; сидящий с меньшим id ведёт игру репликами. */
const CARDS: State<CitizenBrain> = {
  name: 'cards',
  enter(b) {
    b.stayUntil = 0;
    b.meetUntil = b.ctx.law.now + 80;
    b.table = b.ctx.street.takeTableSeat(b.self);
    if (!b.table || !b.goToPoint(b.table.table.seats[b.table.seat])) b.idleLeft = 0.5;
  },
  update(b, dt) {
    const C = STREET.cards;
    const { ctx, self } = b;
    const now = ctx.law.now;
    const r = b.table;
    if (!r) return 'idle';
    const t = r.table;
    const seat = t.seats[r.seat];
    const st = b.mover.status;
    if (!b.stayUntil) {
      if (st === 'failed' || now > b.meetUntil) return 'idle';
      if (st === 'arrived' || Math.hypot(seat.x - self.x, seat.y - self.y) < 10) {
        b.mover.stop();
        b.stayUntil = now + ctx.rng.range(C.time[0], C.time[1]);
        b.nextLine = now + ctx.rng.range(1, 3);
      } else if (st === 'idle') b.goToPoint(seat);
      return;
    }
    b.mover.stop();
    faceTowards(self, t.x, t.y, dt);
    // Играют, если за столом ещё кто-то сидит.
    const others = t.taken.filter((o) => o && o !== self && o.alive && o.brain instanceof CitizenBrain && o.brain.fsm.current === 'cards' && o.brain.stayUntil > 0) as Character[];
    if (others.length && now >= b.nextLine) {
      b.nextLine = now + ctx.rng.range(C.lineEvery[0], C.lineEvery[1]);
      if (!(self.speech && self.speech.until > now)) self.say(ctx.rng.pick(STREET.cardLines), now, 2.4);
    }
    if (now >= b.stayUntil) {
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
  },
  exit(b) {
    b.ctx.street.releaseTableSeat(b.self);
    b.table = null;
    b.stayUntil = 0;
  },
};

/** Перекур: отойти в сторонку, постоять с сигаретой (огонёк и дымок), пробормотать что-нибудь. */
const SMOKE: State<CitizenBrain> = {
  name: 'smoke',
  enter(b) {
    const S = STREET.smoke;
    b.stayUntil = 0;
    const a = randomAnchorAround(b.self, b.ctx, S.spot[0], S.spot[1], b.avoid);
    if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
    else b.idleLeft = 0.5;
  },
  update(b, dt) {
    const S = STREET.smoke;
    const { ctx, self } = b;
    const now = ctx.law.now;
    const st = b.mover.status;
    if (!b.stayUntil) {
      if (st === 'failed' || st === 'idle') return 'idle';
      if (st === 'arrived') {
        b.stayUntil = now + ctx.rng.range(S.time[0], S.time[1]);
        b.nextLine = now + ctx.rng.range(2, 5);
        b.glanceDir = ctx.rng.range(0, Math.PI * 2);
        self.smoking = true;
        ctx.street.stats.smokes++;
      }
      return;
    }
    turnTowards(self, b.glanceDir, dt);
    if (now >= b.nextLine) {
      b.nextLine = now + ctx.rng.range(S.lineEvery[0], S.lineEvery[1]);
      if (!(self.speech && self.speech.until > now)) self.say(ctx.rng.pick(STREET.smokeLines), now, 2.4);
    }
    if (now >= b.stayUntil) {
      b.idleLeft = ctx.rng.range(0.5, 2);
      return 'walk';
    }
  },
  exit(b) {
    b.self.smoking = false;
    b.stayUntil = 0;
  },
};

/** Доска объявлений: подойти, прочитать, хмыкнуть. */
const NOTICE: State<CitizenBrain> = {
  name: 'notice',
  enter(b) {
    b.stayUntil = 0;
    b.board = b.ctx.street.boardNear(b.self);
    if (!b.board || !b.goToPoint(b.board.stand)) b.idleLeft = 0.5;
  },
  update(b, dt) {
    const N = STREET.notice;
    const { ctx, self } = b;
    const now = ctx.law.now;
    const board = b.board;
    if (!board) return 'idle';
    const st = b.mover.status;
    if (!b.stayUntil) {
      if (st === 'failed' || st === 'idle') return 'idle';
      if (st === 'arrived' || Math.hypot(board.stand.x - self.x, board.stand.y - self.y) < 12) {
        b.mover.stop();
        b.stayUntil = now + ctx.rng.range(N.time[0], N.time[1]);
        b.nextLine = now + ctx.rng.range(1.5, 3);
        ctx.street.stats.notices++;
      }
      return;
    }
    faceTowards(self, board.x, board.y, dt);
    if (b.nextLine > 0 && now >= b.nextLine) {
      b.nextLine = 0;
      if (!(self.speech && self.speech.until > now)) self.say(ctx.rng.pick(STREET.noticeLines), now, 2.6);
    }
    if (now >= b.stayUntil) {
      b.idleLeft = ctx.rng.range(0.5, 2);
      return 'walk';
    }
  },
  exit(b) {
    b.board = null;
    b.stayUntil = 0;
  },
};

/** Слушать обращение Администратора на площади. */
const LISTEN: State<CitizenBrain> = {
  name: 'listen',
  enter(b) {
    const { ctx } = b;
    const p = ctx.street.plaza;
    const S = STREET.broadcast.spread;
    const a = p ? randomAnchorAround(p, ctx, S[0], S[1], b.avoid) : -1;
    if (a >= 0) {
      b.mover.speed = b.walkSpeed;
      b.mover.goTo(b.self, ctx, a);
      ctx.street.stats.listeners++;
    } else b.idleLeft = 0.5;
  },
  update(b, dt) {
    const { ctx, self } = b;
    const st = ctx.street;
    if (!st.broadcasting || b.mover.status === 'failed' || b.mover.goal < 0) {
      b.idleLeft = ctx.rng.range(1, 4);
      return 'idle';
    }
    if (b.mover.status === 'arrived' || self.moveSpeed < 4) {
      const p = st.plaza!;
      faceTowards(self, p.x, p.y, dt);
      if (ctx.rng.chance(dt * 0.015) && !(self.speech && self.speech.until > ctx.law.now)) self.say(ctx.rng.pick(STREET.listenLines), ctx.law.now, 2);
    }
  },
};
