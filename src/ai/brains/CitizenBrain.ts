import { LINES } from '../../config/lines';
import { phrase } from '../../systems/phrases';
import { ARSENAL } from '../../config/arsenal';
import type { HaulTask, ArmorerTask } from '../../systems/Arsenal';
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
import { apparentFaction } from '../../entities/cover';
import { ECONOMY } from '../../config/economy';
import { ARBAT } from '../../config/arbat';
import type { CanteenSeat, StreetShop, SupplyTarget } from '../../systems/StreetShops';
import { ROUTINE } from '../../config/routine';
import { BRAWL, FISTS } from '../../config/brawl';
import { HOUSING } from '../../config/housing';
import { ITEMS, WEAPONS, type ItemId } from '../../config/items';
import type { RepairSpot } from '../../systems/EconomySystem';
import type { TrashPile } from '../../systems/LaborSystem';
import type { Corpse } from '../../systems/CombatSystem';
import { CrimeScenes } from '../../systems/CrimeScenes';
import { LABOR } from '../../config/labor';
import { CRIME } from '../../config/crime';
import type { Vec2 } from '../../core/math';
import { STREET } from '../../config/street';
import type { Barrel, Bench, CardTable, NoticeBoard } from '../../systems/StreetLife';
import { FAMILIES } from '../../config/families';
import { lineOfSight } from '../../world/visibility';
import { CWU_HQ } from '../../config/cwuHq';
import { PARTISANS } from '../../config/underground';
import { GANGS } from '../../config/gangs';
import { Gunner } from '../Gunner';
import { followColumn, watchSector } from '../Tactics';
import type { Gang } from '../../systems/Gangs';

/** Работа по профессии (ТС, поднадзорный, отброс общества). */
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
  /** Курьер: коробка из штаба ТС в лавку, ларёк или столовую. */
  | { kind: 'supply'; target: SupplyTarget; carry: boolean }
  /** Продавец за прилавком своей лавки, повар столовой у котла. */
  | { kind: 'vend'; shop: StreetShop; until: number; nextLine: number }
  | { kind: 'cookpot'; until: number; nextLine: number }
  | { kind: 'clean'; pile: TrashPile }
  | { kind: 'scavenge'; pile: TrashPile; left: number }
  | { kind: 'heal'; patient: Character; repath: number }
  | { kind: 'pickpocket'; victim: Character; left: number; until: number; repath: number }
  | { kind: 'rob'; victim: Character; left: number; until: number; repath: number; threatened: boolean }
  | { kind: 'loot'; corpse: Corpse; left: number; until: number }
  | { kind: 'shank'; victim: Character; until: number; repath: number }
  | { kind: 'paper'; desk: Vec2; until: number; nextPay: number }
  | { kind: 'haul'; task: HaulTask; carry: boolean; until: number; done?: boolean; fails?: number }
  | { kind: 'armory'; task: ArmorerTask; stage: 'pick' | 'bench' | 'drop'; until: number; t: number; done?: boolean; fails?: number };

/** Чем отличаются гражданин, рабочий ТС и повстанец в поведении «на улице». */
export interface StreetProfile {
  /** Шанс пойти в «свою» зону вместо случайной точки. */
  favouriteChance: number;
  favourite: ZoneKind[];
  /** Повстанцы уходят подальше, завидев ВС. */
  avoidCp: boolean;
}

const PROFILES: Record<'citizen' | 'cwu' | 'rebel' | 'vort', StreetProfile> = {
  citizen: { favouriteChance: AI.citizen.plazaChance, favourite: ['plaza'], avoidCp: false },
  cwu: { favouriteChance: 0.6, favourite: ['plaza', 'industrial'], avoidCp: false },
  rebel: { favouriteChance: 0.2, favourite: ['industrial', 'residential'], avoidCp: true },
  vort: { favouriteChance: 0.4, favourite: ['residential', 'industrial'], avoidCp: false },
};

const near: Character[] = [];
const near2: Character[] = [];

/** Состояния, в которых мозг сам решает, куда смотреть (не «по ходу движения»). */
/** Досуг, который голод прерывает (работу, сон, очередь и дела — нет). */
const LEISURE: ReadonlySet<string> = new Set(['walk', 'idle', 'home', 'bench', 'barrel', 'smoke', 'notice', 'listen', 'cards', 'chat']);
const SELF_FACING = new Set(['brawl', 'crew', 'stopped', 'chat', 'barrel', 'listen', 'bench', 'cards', 'smoke', 'notice', 'canteen', 'shopping']);

/**
 * Житель города (гражданин, ТС, повстанец): стоит → идёт → стоит. Иногда нарушает:
 * бежит или лезет в запретную зону. По приказу ВС останавливается (или убегает — решает
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
  /** Место за столом общей столовой и лавка, куда идёт за покупкой. */
  seat: CanteenSeat | null = null;
  shopGo: StreetShop | null = null;
  board: NoticeBoard | null = null;
  stayUntil = 0;
  /** На какое обращение Коменданта уже решали, идти ли. */
  heardBroadcast = 0;
  /** Остановился оглядеться: до какого времени, куда смотрит, куда шёл. */
  glanceUntil = 0;
  glanceDir = 0;
  glanceGoal = -1;
  /** Бунт (спецагент поднял): вокруг какой точки и до какого времени. */
  riotAt: Vec2 | null = null;
  riotUntil = 0;
  /** Продавец и повар столовой: перерыв после смены до… */
  offUntil = 0;
  /** Когда пора заглянуть домой; дома — спит ли. */
  nextHome = 0;
  sleeping = false;
  /** Распорядок: идёт домой спать до утра; была ли смена на прошлом решении. */
  nightSleep = false;
  /** Раз в секунду: не пора ли бросить досуг и пойти поесть. */
  private hungerCheck = 0;
  wasOnShift = true;
  /** Драка: перестроить путь к противнику через… */
  brawlRepath = 0;
  private turfTimer = 0;
  private turfWarnAt = 0;
  /** Столовая: сперва за супом к раздаче. */
  soupFirst = false;
  /** Боец банды: стрелок (стычки) и идёт ли бой. */
  gunner: Gunner | null = null;
  private inFight = false;
  private fightRepath = 0;
  /**
   * Банда: по городу — не меньше GANGS.pairs.min. Ведущий — escort (кто идёт за ним колонной), ведомый —
   * crewLead (за кем идёт, состояние 'crew'). crewLegs — сколько ещё точек города обойти; waitGoal —
   * куда шёл, пока ждёт отставших (crewWait — сколько уже ждал за выход).
   */
  escort: Character[] = [];
  crewLead: Character | null = null;
  crewLegs = 0;
  private crewWait = 0;
  private waitGoal = -1;
  readonly column = { repath: 0 };

  constructor(
    public self: Character,
    public ctx: AiContext,
  ) {
    const [smin, smax] = CHARACTER.npcWalkSpeed;
    this.walkSpeed = ctx.rng.range(smin, smax);
    this.mover = new Mover(this.walkSpeed);
    this.avoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands', 'wasteland', 'rebel_camp', 'arsenal', 'prison', 'academy']);
    this.mover.avoidZones = this.avoid;
    const f = self.faction === 'cwu' || self.faction === 'rebel' || self.faction === 'vort' ? self.faction : 'citizen';
    this.profile = PROFILES[f];
    this.fsm = new StateMachine<CitizenBrain>(this, [CREW, IDLE, WALK, STOPPED, FLEE, QUEUE, SHOP, WORK, SHELTER, PANIC, CHAT, BARREL, HOME, LISTEN, BENCH, CARDS, SMOKE, NOTICE, RIOT, CANTEEN, SHOPPING, BRAWL_STATE], 'idle');
    // Разносим начальные таймеры, чтобы толпа не двинулась синхронно.
    this.idleLeft = ctx.rng.range(0, AI.citizen.idleTime[1]);
    this.nextHome = ctx.law.now + ctx.rng.range(HOUSING.visit.first[0], HOUSING.visit.first[1]);
  }

  get stateName(): string {
    return this.mover.yieldFrom ? `${this.fsm.current} · уступает` : this.fsm.current;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    this.self = self;
    this.ctx = ctx;
    const phase = self.law.phase;
    // Банда: стычка с чужими (или с ВС, раз напал) — бой поверх любого занятия.
    if (self.gang >= 0 && phase === 'none' && this.gangFight(dt)) return;
    // Ведёт своих по городу: отстали — ждёт (решения не принимаются, пока стоит).
    if (this.fsm.current !== 'brawl' && (this.escort.length || (self.gang >= 0 && phase === 'none')) && this.crewTick(dt)) {
      this.mover.update(self, ctx, dt);
      return;
    }
    const cur = this.fsm.current;
    if ((phase === 'ordered' || phase === 'checking') && cur === 'crew') {
      // Ведомого проверяет ВС — стоит, но из пары не уходит (ведущий ждёт).
      this.mover.stop();
      this.mover.update(self, ctx, dt);
      const h = self.law.handler;
      if (h) faceTowards(self, h.x, h.y, dt);
      return;
    }
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
      // Грузчик с ящиком в конвое на КПП от выстрелов не разбегается — там всегда стреляют.
      // Бандиты от стрельбы не разбегаются (у них свой бой — gangFight), иначе пара распадается.
      // Стрельбы в тире академии — учебные: от них не разбегаются.
      if (shot && !shot.shooter?.cadet && self.faction !== 'rebel' && self.gang < 0) {
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
      } else if ((this.hungerCheck -= dt) <= 0) {
        // Голод отвлекает от досуга (не от работы и не от сна): бросить и решить заново — за едой.
        this.hungerCheck = 1;
        if (LEISURE.has(cur) && !this.nightSleep && this.starving()) {
          this.idleLeft = 0.1;
          this.fsm.change('idle');
        }
      }
    }
    if (this.profile.avoidCp && (cur === 'walk' || cur === 'idle')) this.watchForCp(dt);
    if (self.gang >= 0 && (cur === 'walk' || cur === 'idle')) this.turfWatch(dt);
    this.checkBroadcast();
    if ((cur === 'walk' || cur === 'idle' || cur === 'queue') && ctx.rng.chance(BARKS.ambientPerSec * dt)) streetBark(self, ctx);
    this.fsm.update(dt);
    this.mover.update(self, ctx, dt);
    if (!SELF_FACING.has(this.fsm.current) && this.glanceUntil <= ctx.law.now) faceMovement(self, ctx, dt);
  }

  /**
   * Втянуть в бунт: бегать вокруг center и кричать лозунги до until (для ВС — нарушение 'riot').
   * Занятых делом, задержанных и лоялистов не втягивает.
   */
  startRiot(self: Character, center: Vec2, until: number): boolean {
    const cur = this.fsm.current;
    if (this.job || self.law.phase !== 'none' || cur === 'panic' || cur === 'shelter' || cur === 'queue' || self.gang >= 0) return false;
    if (self.loyalty >= PARTISANS.riot.maxLoyalty) return false;
    this.riotAt = center;
    this.riotUntil = until;
    self.law.riotUntil = until;
    this.fsm.change('riot');
    return true;
  }

  /**
   * Боец банды: Gunner ищет врагов (бойцы чужой банды в стычке, ВС — если сам напал). Бой — стоять и
   * стрелять (далеко — подойти); кончился — ствол в карман, снова своими делами. true — сейчас в бою.
   */
  private gangFight(dt: number): boolean {
    const { self, ctx } = this;
    const g = (this.gunner ??= new Gunner(ctx.rng));
    const fighting = g.update(self, ctx, dt) && !!g.target;
    if (!fighting) {
      if (this.inFight) {
        this.inFight = false;
        ctx.combat.equip(self, null);
        this.idleLeft = ctx.rng.range(1, 3);
        // Ведомый после боя — снова за своим.
        if (this.fsm.current !== 'crew') this.fsm.change('idle');
      }
      return false;
    }
    if (!this.inFight) {
      this.inFight = true;
      this.mover.stop();
    }
    const t = g.target!;
    const w = ctx.combat.weaponOf(self);
    const d = Math.hypot(t.x - self.x, t.y - self.y);
    this.fightRepath -= dt;
    if (w && d > w.effectiveRange * 0.9 && this.fightRepath <= 0) {
      this.fightRepath = 1.2;
      const a = ctx.nav.nearestWalkable(t.x, t.y, 3);
      if (a >= 0) this.mover.goTo(self, ctx, a);
    } else if (!w || d <= w.effectiveRange * 0.9) this.mover.stop();
    this.mover.update(self, ctx, dt);
    if (!g.look(self, ctx, dt)) faceMovement(self, ctx, dt);
    return true;
  }

  /** Голоден и нечего съесть (поднадзорных кормит Протекторат; при красном коде — не до еды). */
  starving(): boolean {
    const { self, ctx } = this;
    return self.faction !== 'vort' && self.hunger < ECONOMY.meals.seekBelow && !ctx.economy.hasFood(self) && ctx.war.code !== 'red';
  }

  /** Житель, у которого есть уличная жизнь (не поднадзорный, не на работе). */
  get street(): boolean {
    const f = this.self.faction;
    return (f === 'citizen' || f === 'cwu' || f === 'rebel') && !this.job;
  }

  /** Обращение Коменданта: жители поблизости идут на площадь послушать. */
  private checkBroadcast(): void {
    const st = this.ctx.street;
    const cur = this.fsm.current;
    if (!st?.broadcasting || this.heardBroadcast === st.broadcast || (cur !== 'idle' && cur !== 'walk') || !this.street || this.self.gang >= 0) return;
    this.heardBroadcast = st.broadcast;
    const B = STREET.broadcast;
    const p = st.plaza!;
    if (this.self.faction === 'rebel' || Math.hypot(p.x - this.self.x, p.y - this.self.y) > B.radius || !this.ctx.rng.chance(B.joinChance)) return;
    this.fsm.change('listen');
  }

  /** Свободен ли житель для разговора. */
  private chattable(o: Character): boolean {
    const b = o.brain;
    if (o === this.self || !o.alive || o.isPlayer || !(b instanceof CitizenBrain) || !b.street || o.gang >= 0) return false;
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
    const hustler = this.self.profession === 'thief' || this.self.profession === 'bandit' || this.self.gang >= 0;
    // Распорядок: доля занятий и их веса — по времени суток (утром дела, вечером досуг).
    const R = ctx.routine;
    const act = R.activity(this.self);
    if (!this.street || hustler || ctx.war.code === 'red' || !ctx.street || !ctx.rng.chance(act >= 0 ? act : STREET.activityChance)) return null;
    const W = STREET.weights;
    const st = ctx.street;
    const m = (k: Parameters<typeof R.weight>[1]): number => R.weight(this.self, k);
    // Скамейки — только при зелёном коде; родня — если есть семья; карты — в общежитиях.
    const bench = ctx.war.code === 'green' && st.benches.length ? W.bench * m('bench') : 0;
    const family = this.self.family >= 0 ? W.family * m('family') : 0;
    // Рабочим ТС засиживаться за картами некогда.
    const cards = st.tables.length && this.self.faction !== 'cwu' ? W.cards * m('cards') : 0;
    const notice = st.boards.length ? W.notice * m('notice') : 0;
    // По лавкам проспекта — при зелёном коде и если лавка неподалёку.
    const shopping = ctx.war.code === 'green' && ctx.shops?.shopNear(this.self) ? ARBAT.visit.weight * m('shopping') : 0;
    const chat = W.chat * m('chat');
    const barrel = W.barrel * m('barrel');
    const homeW = W.home * m('home');
    const smoke = W.smoke * m('smoke');
    let r = ctx.rng.range(0, chat + barrel + homeW + bench + family + cards + smoke + notice + shopping);
    if ((r -= shopping) < 0) return 'shopping';
    if ((r -= chat) < 0) return this.startChat() ? 'chat' : null;
    if ((r -= barrel) < 0) return 'barrel';
    if ((r -= bench) < 0) return 'bench';
    if ((r -= family) < 0) return this.startFamilyChat() ? 'chat' : 'home';
    if ((r -= cards) < 0) return 'cards';
    if ((r -= smoke) < 0) return 'smoke';
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
    // Ссора: иногда разговор кончается дракой.
    if (pb && p && ctx.brawls && this.fsm.current === 'chat') {
      ctx.brawls.quarrel(this.self, p);
      if (ctx.brawls.fighting(this.self)) return;
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

  /**
   * Район банды опасен для чужих: боец на своём районе гонит чужака рядом (реплика), а ночью с шансом
   * GANGS.turf.nightRob сразу грабит (без случайности днём — не сдвигает общий поток rng).
   */
  private turfWatch(dt: number): void {
    this.turfTimer -= dt;
    if (this.turfTimer > 0) return;
    this.turfTimer = 1;
    const { self, ctx } = this;
    const now = ctx.law.now;
    const g = ctx.gangs?.of(self);
    if (!g || now < this.turfWarnAt || this.job || !ctx.gangs.inTurf(g, self.x, self.y)) return;
    const T = GANGS.turf;
    for (const o of ctx.entities.near(self.x, self.y, T.warn, near2)) {
      if (o === self || !o.alive || o.gang >= 0 || o.downed || o.law.phase !== 'none') continue;
      const f = apparentFaction(o);
      if (f !== 'citizen' && f !== 'cwu') continue;
      if (!lineOfSight(ctx.map, self.x, self.y, o.x, o.y)) continue;
      this.turfWarnAt = now + T.warnEvery;
      const L = GANGS.lines.turf;
      self.say(phrase(ctx.rng, self, L), now, 2);
      if (ctx.routine.night && o.money >= CRIME.npc.minMoney && ctx.crime.robOk(self, o) && !this.cpInSight(260) && ctx.rng.chance(T.nightRob)) {
        this.job = { kind: 'rob', victim: o, left: CRIME.rob.time, until: now + CRIME.npc.giveUp, repath: 0, threatened: false };
        this.fsm.change('work');
      }
      return;
    }
  }

  /** Повстанец: заметил ВС рядом — уходит в сторону (не бегом, чтобы не привлечь внимание). */
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
    // Боец банды один — уходит по своему району, если есть куда.
    const g = this.soloGang();
    for (let k = 0; k < 8; k++) {
      const a = randomAnchorAround(this.self, this.ctx, 12, 40, this.avoid);
      if (a < 0) continue;
      const d = Math.hypot(this.ctx.nav.worldX(a) - x, this.ctx.nav.worldY(a) - y) + (g && this.ctx.gangs.anchorInTurf(g, a) ? 1e5 : 0);
      if (d > bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  /** Драка на кулаках (Brawls): бросить занятие и драться. */
  startBrawl(): void {
    if (this.partner) this.endChat(false);
    this.fsm.change('brawl');
  }

  /** Драка кончилась: нокаут — постоять, оклематься; иначе — дальше по своим делам. */
  endBrawl(ko: boolean): void {
    if (this.fsm.current !== 'brawl') return;
    this.idleLeft = ko ? this.ctx.rng.range(4, 7) : this.ctx.rng.range(1, 3);
    this.fsm.change('idle');
  }

  /** Убежать от обидчика (не стал драться). */
  fleeFrom(a: Character): void {
    this.self.panicUntil = this.ctx.law.now + this.ctx.rng.range(3, 5);
    this.panicFrom = { x: a.x, y: a.y };
    this.fsm.change('panic');
  }

  /** Зевака: остановиться и поглазеть на драку. */
  watchFight(x: number, y: number): void {
    const cur = this.fsm.current;
    if ((cur !== 'walk' && cur !== 'idle') || this.glanceUntil > this.ctx.law.now || !this.street) return;
    const now = this.ctx.law.now;
    if (cur === 'walk') {
      this.glanceGoal = this.mover.goal;
      this.mover.stop();
    } else this.idleLeft = Math.max(this.idleLeft, BRAWL.watchTime[0]);
    this.glanceUntil = now + this.ctx.rng.range(BRAWL.watchTime[0], BRAWL.watchTime[1]);
    this.glanceDir = Math.atan2(y - this.self.y, x - this.self.x);
    this.self.facing = this.glanceDir;
    if (this.ctx.rng.chance(0.25)) this.self.say(this.ctx.rng.pick(BRAWL.lines.watch), now, 2);
  }

  /**
   * Распорядок: пора спать (горожане, ТС, поднадзорные без дома — нет; бандиты и воры — днём). Не в паре
   * банды по городу, не в розыске, не грузчик и не оружейник склада (склад работает круглые сутки).
   */
  bedtime(): boolean {
    const { ctx, self } = this;
    if (!ctx.routine.enabled || self.isPlayer || self.faction === 'rebel' || self.faction === 'vort') return false;
    if (this.inCrew || this.escort.length || self.law.wanted || ctx.war.code === 'red') return false;
    if (self.profession === 'loader' || self.profession === 'armorer' || self.profession === 'cook') return false;
    return ctx.routine.asleepTime(self);
  }

  /** Что делать после паузы: работа, очередь, магазин или прогулка. */
  decide(): string {
    const { ctx, self } = this;
    const eco = ctx.economy;
    // Распорядок: пора спать — домой, в кровать (до утра).
    if (this.bedtime()) {
      this.nightSleep = true;
      // Ужин перед сном — тем, что есть с собой.
      if (self.hunger < ECONOMY.hunger.supperBelow) {
        const food = self.inventory.slots.find((s) => ITEMS[s.id].food);
        if (food) eco.use(self, food.id);
      }
      if (ctx.rng.chance(0.35)) self.say(ctx.rng.pick(ROUTINE.lines.bed), ctx.law.now, 2);
      return 'home';
    }
    // Голод важнее дел: без еды и голоднее seekBelow — в очередь за пайком, в столовую за супом или в лавку.
    if (this.starving()) {
      if (eco.open && !eco.hasBeenServed(self) && self.faction !== 'rebel' && this.pairedFor(eco.window)) {
        this.consideredCycle = eco.cycle;
        return 'queue';
      }
      const hustler = self.profession === 'thief' || self.profession === 'bandit' || self.gang >= 0;
      if (self.faction === 'citizen' && !hustler && ctx.shops?.wantsMeal(self)) return 'canteen';
      if (eco.shopCounter && self.money >= (ITEMS.bread.price ?? 6) && this.pairedFor(eco.shopCounter)) return 'shop';
    }
    const job = this.pickJob();
    if (job) {
      this.job = job;
      return 'work';
    }
    // Пора заглянуть домой (свой дом — у каждого жителя).
    const home = ctx.housing?.of(self);
    if (home && ctx.law.now >= this.nextHome && Math.hypot(home.at.x - self.x, home.at.y - self.y) < HOUSING.visit.seek) return 'home';
    if (self.faction === 'vort') return 'walk';
    if (eco.open && eco.cycle !== this.consideredCycle && !eco.hasBeenServed(self) && self.faction !== 'rebel') {
      this.consideredCycle = eco.cycle;
      if (ctx.rng.chance(ECONOMY.rations.npcJoinChance) && this.pairedFor(eco.window)) return 'queue';
    }
    // Горожанин с едой проголодался — поесть за столом в общей столовой (не при красном коде; у ТС
    // своя столовая в штабе).
    const hustler = self.profession === 'thief' || self.profession === 'bandit' || self.gang >= 0;
    if (self.faction === 'citizen' && !hustler && ctx.war.code !== 'red' && ctx.shops?.wantsMeal(self) && ctx.rng.chance(ctx.shops.foodOf(self) ? ARBAT.meal.chance : ARBAT.meal.soupChance)) return 'canteen';
    if (eco.shopCounter && self.money >= 6 && self.hunger < 75 && ctx.rng.chance(ECONOMY.shop.npcVisitChance) && this.pairedFor(eco.shopCounter)) return 'shop';
    return this.streetActivity() ?? 'walk';
  }

  /**
   * Работа по профессии: повар — раздача и прилавок; фасовщик — завод; курьер — коробки с завода
   * к будке; уборщик — поломки и мусор; медик ТС — раненые рядом; поднадзорный — мусор;
   * отброс общества — порыться в мусоре.
   */
  private pickJob(): Job | null {
    const { ctx, self } = this;
    const eco = ctx.economy;
    const labor = ctx.labor;
    // Лоялист — бумажная работа для Коменданта в канцелярии Управы (за столом, за плату).
    const PW = LABOR.paperwork;
    // Идёт раздача, а паёк не получен — сначала очередь.
    const rationsFirst = eco.open && !eco.hasBeenServed(self);
    const awake = !ctx.routine.enabled || ctx.routine.phaseOf(self) !== 'night';
    if (self.faction === 'citizen' && self.profession === 'citizen' && self.loyalty >= PW.minLoyalty && !rationsFirst && !ctx.war.curfew && awake && labor.desks.length && ctx.rng.chance(PW.chance)) {
      const desk = labor.claimDesk(self);
      if (desk) return { kind: 'paper', desk, until: ctx.law.now + ctx.rng.range(PW.time[0], PW.time[1]), nextPay: ctx.law.now + PW.payEvery };
    }
    // Штаб ТС: гражданин идёт устраиваться (если есть места), рабочий — на перерыв.
    const hq = ctx.cwuHq;
    if (hq?.present && !ctx.war.curfew && !rationsFirst && awake) {
      const H = CWU_HQ;
      // Лоялисты работают с бумагами в канцелярии — в штаб идут остальные.
      if (self.faction === 'citizen' && self.profession === 'citizen' && self.loyalty < PW.minLoyalty && !self.isPlayer && self.law.phase === 'none' && ctx.rng.chance(H.hire.chance) && hq.vacancy() && hq.apply(self)) {
        return { kind: 'apply', until: ctx.law.now + H.hire.waitMax };
      }
      // Склад на окраине — его рабочие отдыхают там же, в штаб не ходят.
      // Склад и лавки — свои перерывы: у продавца и повара столовой — дом и столовая после смены.
      const depot = self.profession === 'loader' || self.profession === 'armorer' || self.profession === 'vendor' || self.profession === 'canteen_cook';
      if (self.faction === 'cwu' && self.profession !== 'cwu_head' && !depot && !self.carrying && hq.restSpots.length && ctx.rng.chance(H.rest.chance)) {
        return { kind: 'rest', spot: ctx.rng.pick(hq.restSpots), until: ctx.law.now + ctx.rng.range(H.rest.time[0], H.rest.time[1]), lines: H.lines.rest };
      }
    }
    // Распорядок: смена кончилась — работа ждёт до утра (склад и раздача — без смен).
    if (!ctx.routine.onShift(self)) {
      if (this.wasOnShift && ctx.rng.chance(0.5)) self.say(ctx.rng.pick(ROUTINE.lines.off), ctx.law.now, 2);
      this.wasOnShift = false;
      return null;
    }
    if (!this.wasOnShift && ctx.routine.enabled && ctx.rng.chance(0.4)) self.say(ctx.rng.pick(ROUTINE.lines.work), ctx.law.now, 2);
    this.wasOnShift = true;
    switch (self.profession) {
      case 'gang_boss': {
        // Авторитет — в общаге у общака; иногда прогулка по району (null — уличная жизнь по району).
        const g = ctx.gangs?.of(self);
        if (!g || ctx.rng.chance(0.25)) return null;
        return { kind: 'rest', spot: g.hq, until: ctx.law.now + ctx.rng.range(40, 80), lines: GANGS.lines.boss };
      }
      case 'cwu_head': {
        // Глава ТС: к стойке, если ждут соискатели; иначе кабинет или обход штаба.
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
        // Магазин ТС на проспекте — со своим продавцом: повар только на раздаче.
        if (eco.shopCounter && !ctx.shops?.staffed.length && ctx.rng.chance(0.5)) {
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
      case 'loader': {
        // Склад Протектората: маяк, ящики с крыльца — по местам, расходный стеллаж у окна, конвой на КПП.
        // Нечего — борт на подлёте: ждать на крыльце у двери; иначе — в бытовке за столом.
        const A = ctx.arsenal;
        if (!A?.present || ctx.war.code === 'red') return null;
        const task = A.loaderTask(self);
        if (task) return { kind: 'haul', task, carry: false, until: ctx.law.now + ARSENAL.work.giveUp };
        if (A.shipInbound && A.waitSpot) {
          if (ctx.rng.chance(0.5)) self.say(ctx.rng.pick(ARSENAL.lines.alarm), ctx.law.now, 2);
          return { kind: 'rest', spot: { x: A.waitSpot.x + ctx.rng.range(-24, 24), y: A.waitSpot.y + ctx.rng.range(-8, 8) }, until: ctx.law.now + 4, lines: ARSENAL.lines.loader };
        }
        return A.restSpots.length ? { kind: 'rest', spot: ctx.rng.pick(A.restSpots), until: ctx.law.now + ctx.rng.range(6, 12), lines: ARSENAL.lines.rest } : null;
      }
      case 'armorer': {
        // Оружейник: стволы из ящиков на ремонт — за верстак, потом на стойки зала; нет — проверка ящиков.
        const A = ctx.arsenal;
        if (!A?.present || ctx.war.code === 'red') return null;
        const task = A.armorerTask(self);
        if (task) return { kind: 'armory', task, stage: 'pick', until: ctx.law.now + ARSENAL.work.giveUp, t: 0 };
        return A.restSpots.length ? { kind: 'rest', spot: ctx.rng.pick(A.restSpots), until: ctx.law.now + ctx.rng.range(10, 20), lines: ARSENAL.lines.rest } : null;
      }
      case 'courier': {
        // Будка раздачи почти пуста — туда; иначе лавки, ларьки и столовая проспекта, где товара меньше
        // всего; им ничего не нужно — снова будка, пока есть место.
        const boothRoom = eco.rationStock + LABOR.factory.boxRations <= LABOR.booth.maxStock;
        const boothUrgent = eco.rationStock < LABOR.booth.maxStock * LABOR.booth.urgent;
        const haveBox = self.carrying || (!!labor.factoryStore && labor.boxes > 0);
        if (boothUrgent && haveBox) return { kind: 'deliver', carry: self.carrying };
        const t = ctx.war.code !== 'red' && haveBox ? ctx.shops?.supplyNeed() : null;
        if (t) {
          ctx.shops.claimSupply(self, t);
          return { kind: 'supply', target: t, carry: self.carrying };
        }
        if (self.carrying) return { kind: 'deliver', carry: true };
        return boothRoom && labor.factoryStore && labor.deliveryNeeded ? { kind: 'deliver', carry: false } : null;
      }
      case 'vendor': {
        // Смена за прилавком своей лавки, потом перерыв (дом, столовая, прогулка).
        if (ctx.war.curfew || ctx.law.now < this.offUntil) return null;
        const s = ctx.shops?.workplace(self);
        if (!s?.vendorSpot) return null;
        const S = ARBAT.staff;
        return { kind: 'vend', shop: s, until: ctx.law.now + ctx.rng.range(S.shift[0], S.shift[1]), nextLine: ctx.law.now + ctx.rng.range(S.lineEvery[0], S.lineEvery[1]) };
      }
      case 'canteen_cook': {
        if (ctx.war.curfew || ctx.law.now < this.offUntil || !ctx.shops?.claimKitchen(self)) return null;
        const S = ARBAT.staff;
        return { kind: 'cookpot', until: ctx.law.now + ctx.rng.range(S.shift[0], S.shift[1]), nextLine: ctx.law.now + ctx.rng.range(S.lineEvery[0], S.lineEvery[1]) };
      }
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
          if ((o.health >= o.maxHealth * M.below && o.bleed <= 0) || o.law.phase !== 'none') continue;
          if (!FACTIONS[o.faction].authority && o.money < M.fee) continue;
          if (!best || o.health < best.health) best = o;
        }
        return best && (self.inventory.has('bandage') || self.inventory.has('medkit')) ? { kind: 'heal', patient: best, repath: 0 } : null;
      }
      case 'thief': {
        // Ночью воры выходят чаще: прохожих меньше, ВС видно хуже.
        if (!ctx.rng.chance(CRIME.npc.chance * (ctx.routine.night ? ROUTINE.night.thiefMul : 1)) || this.cpInSight(250)) return null;
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
        // Тело ВС со стволом, не оцепленное и без ВС рядом, — обобрать (оружие Протектората дорогого стоит).
        // (Случайность — только если тело есть: иначе не сдвигать общий поток rng.)
        {
          let best: Corpse | null = null;
          let bestD: number = CRIME.loot.seek;
          for (const k of ctx.combat.corpses) {
            if (!FACTIONS[k.faction].authority || !CrimeScenes.armed(k) || ctx.war.scenes.sealed(k) || ctx.map.levelAt(k.x, k.y) !== 'city') continue;
            const d = Math.hypot(k.x - self.x, k.y - self.y);
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
          if (best && !this.cpInSight(260) && ctx.rng.chance(CRIME.loot.chance) && this.pairedFor(best)) return { kind: 'loot', corpse: best, left: CRIME.loot.time, until: ctx.law.now + CRIME.npc.giveUp };
        }
        // Нож в спину одинокому патрульному.
        // (Случайность — только если жертва есть: иначе не сдвигать общий поток rng.)
        if (self.inventory.has('knife') && ctx.war.code === 'green') {
          const v = this.loneCp();
          if (v && ctx.rng.chance(CRIME.shank.chance) && this.pairedFor(v)) return { kind: 'shank', victim: v, until: ctx.law.now + CRIME.shank.giveUp, repath: 0 };
        }
        // Гоп-стоп: жертва в подворотне, ВС рядом не видно.
        // Ночью и на своём районе гоп-стоп чаще: чужак на районе — законная добыча.
        const g = ctx.gangs?.of(self);
        const turfMul = g && ctx.gangs.inTurf(g, self.x, self.y) ? GANGS.turf.robMul : 1;
        if (!ctx.rng.chance(Math.min(1, CRIME.rob.npcChance * turfMul * (ctx.routine.night ? ROUTINE.night.robMul : 1))) || this.cpInSight(260)) return null;
        let victim: Character | null = null;
        let bestD = Infinity;
        for (const o of ctx.entities.near(self.x, self.y, CRIME.rob.seek, near)) {
          // Игрока грабят только на районе банды — там опасно.
          if (!ctx.crime.robOk(self, o) || o.money < CRIME.npc.minMoney || o.profession === 'bandit' || (o.isPlayer && !(g && ctx.gangs.inTurf(g, o.x, o.y)))) continue;
          const d = Math.hypot(o.x - self.x, o.y - self.y);
          if (d < bestD) {
            bestD = d;
            victim = o;
          }
        }
        return victim && this.pairedFor(victim) ? { kind: 'rob', victim, left: CRIME.rob.time, until: ctx.law.now + CRIME.npc.giveUp, repath: 0, threatened: false } : null;
      }
      case 'outcast': {
        const pile = labor.trash.filter((p) => !p.searched).sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y))[0];
        return pile && ctx.rng.chance(0.6) ? { kind: 'scavenge', pile, left: LABOR.trash.searchTime } : null;
      }
    }
    return null;
  }

  /** Патрульный ВС в городе без напарников рядом (для удара ножом в спину). */
  private loneCp(): Character | null {
    const { ctx, self } = this;
    const S = CRIME.shank;
    let best: Character | null = null;
    let bestD: number = S.seek;
    for (const o of ctx.entities.near(self.x, self.y, S.seek, near)) {
      if (!o.alive || o.isPlayer || o.faction !== 'cp' || o.law.phase !== 'none' || ctx.map.levelAt(o.x, o.y) !== 'city') continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d >= bestD) continue;
      let alone = true;
      for (const q of ctx.entities.near(o.x, o.y, S.lone, near2)) {
        if (q !== o && q.alive && FACTIONS[q.faction].authority) {
          alone = false;
          break;
        }
      }
      if (alone) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Видит ли сотрудника Протектората поблизости (вор не идёт на дело при свидетелях). */
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
    const { ctx } = this;
    const f = this.self.faction;
    this.mover.speed = this.walkSpeed;
    this.mover.avoidZones = this.avoid;
    // Боец банды: один — только по своему району, в город — с напарником.
    const gang = ctx.gangs?.of(this.self);
    if (gang) return this.gangGoal(gang);
    // Нарушения: в запретную зону или бегом.
    if (ctx.rng.chance(LAW.npc.trespassChance[f] ?? 0)) {
      const g = randomAnchorInZone(ctx, 'restricted');
      if (g >= 0) {
        this.mover.avoidZones = undefined;
        return g;
      }
    }
    if (ctx.rng.chance(LAW.npc.runChance[f] ?? 0)) this.mover.speed = CHARACTER.runSpeed * 0.9;
    return this.cityGoal();
  }

  /** Прогулка по городу: любимое место или точка вокруг. */
  private cityGoal(): number {
    const { ctx, profile } = this;
    // Распорядок: «по делам» — к осмысленной цели, а не в случайную точку.
    if (ctx.routine.enabled && ctx.rng.chance(ROUTINE.purpose)) {
      const g = this.errandGoal();
      if (g >= 0) return g;
    }
    if (ctx.rng.chance(profile.favouriteChance)) {
      const g = randomAnchorInZone(ctx, ctx.rng.pick(profile.favourite));
      if (g >= 0 && !this.avoid.has(ctx.nav.zone[g])) return g;
    }
    const C = AI.citizen;
    return randomAnchorAround(this.self, ctx, C.wanderDistance[0], C.wanderDistance[1], this.avoid);
  }
  /** Цель «по делам»: лавка или ларёк, доска объявлений, площадь, дом родни, свой дом. */
  private errandGoal(): number {
    const { ctx, self } = this;
    const pts: Vec2[] = [];
    const R = ROUTINE.reach;
    const add = (p: Vec2 | null | undefined): void => {
      if (p && Math.hypot(p.x - self.x, p.y - self.y) < R && Math.hypot(p.x - self.x, p.y - self.y) > 160) pts.push(p);
    };
    for (const sh of ctx.shops?.shops ?? []) add(sh.front);
    for (const b of ctx.street?.boards ?? []) add(b.stand);
    add(ctx.street?.plaza);
    for (const k of ctx.families?.kin(self) ?? []) add(ctx.housing?.of(k)?.at);
    add(ctx.housing?.of(self)?.at);
    if (!pts.length) return -1;
    const p = ctx.rng.pick(pts);
    const a = ctx.nav.nearestWalkable(p.x, p.y, 3);
    return a >= 0 && !this.avoid.has(ctx.nav.zone[a]) ? a : -1;
  }

  // ——— Банда: по одному — только на районе, в город — вместе ———

  /** Идёт ли в паре (ведёт или ведомый). */
  get inCrew(): boolean {
    return this.escort.length > 0 || !!this.crewLead;
  }

  /** Банда бойца, если он сейчас один (не ведёт и не ведомый). */
  private soloGang(): Gang | null {
    return this.inCrew ? null : this.ctx.gangs?.of(this.self) ?? null;
  }

  private onTurf(g: Gang): boolean {
    return this.ctx.gangs.inTurf(g, this.self.x, this.self.y);
  }

  /**
   * Цель прогулки бойца банды: ведёт своих по городу — ещё точка города или назад на район; один вне
   * района — назад на район; на районе — чаще по району, иначе в город, если найдётся напарник.
   */
  private gangGoal(g: Gang): number {
    const { ctx } = this;
    const G = ctx.gangs;
    if (this.escort.length) {
      if (this.crewLegs > 0) {
        this.crewLegs--;
        const a = this.cityGoal();
        if (a >= 0) return a;
      }
      if (!this.onTurf(g) && ctx.rng.chance(0.5)) this.self.say(ctx.rng.pick(GANGS.lines.home), ctx.law.now, 2);
      return G.turfReturn(g, this.self.x, this.self.y);
    }
    // Один — путь по своему району (чужие кварталы и улицы в A* дороже).
    this.mover.avoidZones = g.away;
    if (!this.onTurf(g)) return G.turfReturn(g, this.self.x, this.self.y);
    if (!ctx.rng.chance(GANGS.turfChance)) {
      const a = this.cityGoal();
      if (a >= 0 && !G.anchorInTurf(g, a) && this.recruit()) {
        this.mover.avoidZones = this.avoid;
        const L = GANGS.pairs.legs;
        this.crewLegs = ctx.rng.int(L[0], L[1]) - 1;
        return a;
      }
    }
    return G.turfAnchor(g);
  }

  /**
   * Можно ли идти к точке p: не боец банды, точка на районе, уже ведёт своих — да; иначе нужен
   * напарник (recruit).
   */
  private pairedFor(p: Vec2): boolean {
    const g = this.ctx.gangs?.of(this.self);
    if (!g || this.ctx.gangs.inTurf(g, p.x, p.y) || this.escort.length) return true;
    return this.recruit();
  }

  /** Позвать с собой ближайшего свободного бойца своей банды на районе. */
  private recruit(): boolean {
    const { self, ctx } = this;
    const g = ctx.gangs?.of(self);
    if (!g || this.crewLead || !this.onTurf(g)) return false;
    let best: Character | null = null;
    let bestD: number = GANGS.pairs.seek;
    for (const o of ctx.entities.list) {
      if (o === self || o.gang !== self.gang || o.isPlayer || !o.alive || !o.fit || o.profession === 'gang_boss' || o.law.phase !== 'none') continue;
      const b = o.brain;
      if (!(b instanceof CitizenBrain) || b.inCrew || b.inFight || (b.fsm.current !== 'idle' && b.fsm.current !== 'walk')) continue;
      if (!ctx.gangs.inTurf(g, o.x, o.y)) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < bestD) [best, bestD] = [o, d];
    }
    if (!best) return false;
    this.crewWait = 0;
    this.adopt(best);
    self.say(ctx.rng.pick(GANGS.lines.crew), ctx.law.now, 2.2);
    return true;
  }

  /** Взять бойца ведомым: идёт за мной колонной (физика друг друга не толкает). */
  adopt(o: Character): void {
    const b = o.brain;
    if (!(b instanceof CitizenBrain) || o === this.self) return;
    if (b.crewLead) b.leaveCrew();
    b.dropCrew();
    this.escort.push(o);
    b.crewLead = this.self;
    o.squadLead = this.self;
    b.fsm.change('crew');
  }

  /** Ведомый уходит из колонны. */
  leaveCrew(): void {
    const l = this.crewLead;
    if (!l) return;
    this.crewLead = null;
    if (this.self.squadLead === l) this.self.squadLead = null;
    const lb = l.brain;
    if (lb instanceof CitizenBrain) lb.escort = lb.escort.filter((o) => o !== this.self);
  }

  /** Ведущий отпускает своих (выход окончен). */
  dropCrew(): void {
    const list = this.escort;
    this.escort = [];
    this.waitGoal = -1;
    for (const o of list) {
      const b = o.brain;
      if (!(b instanceof CitizenBrain) || b.crewLead !== this.self) continue;
      b.crewLead = null;
      if (o.squadLead === this.self) o.squadLead = null;
      if (b.fsm.current === 'crew') {
        b.idleLeft = this.ctx.rng.range(1, 4);
        b.fsm.change('idle');
      }
    }
  }

  /** Ведёт своих назад на район (после дела банды). */
  headHome(): void {
    this.crewLegs = 0;
    this.crewWait = 0;
    this.mover.stop();
    this.fsm.change('walk');
  }

  /**
   * Каждый тик у бойца банды: ведомые ещё с ним? Вернулся на район и дальше не собирается — отпускает.
   * Остался один вне района — бросает дело и назад. Отстали ведомые — ждёт (true — стоит, ждёт).
   */
  private crewTick(dt: number): boolean {
    const { self, ctx } = this;
    const g = ctx.gangs?.of(self);
    if (this.escort.length) {
      const keep = this.escort.filter((o) => o.alive && o.fit && o.brain instanceof CitizenBrain && o.brain.crewLead === self && o.brain.fsm.current === 'crew');
      if (keep.length !== this.escort.length) {
        const gone = this.escort.filter((o) => !keep.includes(o));
        this.escort = keep;
        for (const o of gone) {
          if (o.brain instanceof CitizenBrain && o.brain.crewLead === self) o.brain.crewLead = null;
          if (o.squadLead === self) o.squadLead = null;
        }
      }
    }
    if (!g) return false;
    if (!this.escort.length) {
      this.waitGoal = -1;
      if (!this.crewLead && self.law.phase === 'none' && !this.onTurf(g)) this.aloneOutside(g);
      return false;
    }
    const cur = this.fsm.current;
    const goal = this.mover.goal >= 0 ? this.mover.goal : this.glanceGoal >= 0 ? this.glanceGoal : this.waitGoal;
    const out = cur === 'work' || cur === 'queue' || cur === 'shop' || (goal >= 0 && !ctx.gangs.anchorInTurf(g, goal));
    if (!out && this.onTurf(g)) {
      this.dropCrew();
      return false;
    }
    const P = GANGS.pairs;
    // Ведомого проверяет ВС — ждать его.
    const held = this.escort.find((o) => o.law.phase === 'ordered' || o.law.phase === 'checking');
    if (held && this.waitGoal < 0 && this.mover.goal >= 0) {
      this.waitGoal = this.mover.goal;
      this.mover.stop();
    }
    let nearest = Infinity;
    let who: Character | null = null;
    for (const o of this.escort) {
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < nearest) [nearest, who] = [d, o];
    }
    if (this.waitGoal >= 0) {
      this.crewWait += dt;
      if (!held && (nearest <= P.resume || this.crewWait > P.waitMax)) {
        this.mover.goTo(self, ctx, this.waitGoal);
        this.waitGoal = -1;
        return false;
      }
      if (who) faceTowards(self, who.x, who.y, dt);
      return true;
    }
    if (nearest > P.wait && this.crewWait < P.waitMax && this.mover.goal >= 0 && this.mover.status === 'moving') {
      this.waitGoal = this.mover.goal;
      this.mover.stop();
      return true;
    }
    return false;
  }

  /** Один вне района (напарник выбыл, отпустили из КПЗ): дело бросить, назад на район. */
  private aloneOutside(g: Gang): void {
    const { ctx } = this;
    const cur = this.fsm.current;
    const job = this.job;
    if (cur === 'work' && job && (job.kind === 'rob' || job.kind === 'loot' || job.kind === 'shank' || job.kind === 'pickpocket')) {
      if (job.kind === 'shank' && job.victim.lastAttacker === this.self) return;
      job.until = 0;
    } else if (cur === 'queue' || cur === 'shop') {
      this.idleLeft = 0.3;
      this.fsm.change('idle');
    } else if (cur === 'idle') this.idleLeft = Math.min(this.idleLeft, 0.3); else if (cur === 'walk' && this.glanceUntil <= ctx.law.now) {
      const goal = this.mover.goal;
      if (goal < 0 || !ctx.gangs.anchorInTurf(g, goal)) {
        const a = ctx.gangs.turfReturn(g, this.self.x, this.self.y);
        this.mover.avoidZones = g.away;
        if (a >= 0) this.mover.goTo(this.self, ctx, a);
      }
    }
  }
}

/** Ведомый бойца банды: колонной за ведущим, стоит — смотрит в свой сектор. */
const CREW: State<CitizenBrain> = {
  name: 'crew',
  enter(b) {
    b.column.repath = 0;
    b.mover.avoidZones = b.avoid;
    b.mover.stop();
  },
  update(b, dt) {
    const l = b.crewLead;
    const lb = l?.brain instanceof CitizenBrain ? l.brain : null;
    if (!l || !lb || !l.alive || !l.fit || !lb.escort.includes(b.self)) {
      b.leaveCrew();
      b.idleLeft = b.ctx.rng.range(0.5, 1.5);
      return 'idle';
    }
    const k = lb.escort.indexOf(b.self) + 1;
    if (followColumn(b.self, b.ctx, b.mover, l, k, dt, b.column, LAW.runSpeed * GANGS.pairs.walkMax)) faceMovement(b.self, b.ctx, dt);
    else watchSector(b.self, l, k, k === lb.escort.length, dt);
  },
  exit(b) {
    b.leaveCrew();
    b.mover.speed = b.walkSpeed;
  },
};

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

/** ВС приказал стоять или проверяет документы. */
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

/** Убегает от ВС. Когда LawSystem снимает погоню — назад в idle. */
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

/** Сходить в магазин ТС и купить еды. */
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
    // Магазин ТС на проспекте — лавка с продавцом и товаром из штаба.
    const street = b.ctx.shops?.shopAt(b.self, 40);
    if (street) {
      const why = b.ctx.shops.refusal(street);
      if (why) b.self.say(b.ctx.rng.pick(why === 'closed' ? ARBAT.lines.closed : ARBAT.lines.empty), b.ctx.law.now, 2);
      else b.ctx.shops.npcBuy(b.self, street, b.ctx.rng);
      b.idleLeft = b.ctx.rng.range(2, 5);
      return 'idle';
    }
    const affordable = ECONOMY.shop.stock.filter((id: ItemId) => ITEMS[id].kind === 'food' && (ITEMS[id].price ?? 1e9) <= b.self.money);
    if (affordable.length) {
      const id = b.ctx.rng.pick(affordable);
      if (!b.ctx.economy.buy(b.self, id)) b.self.say(`Мне ${ITEMS[id].name.toLowerCase()}, пожалуйста.`, b.ctx.law.now, 2);
    }
    b.idleLeft = b.ctx.rng.range(2, 5);
    return 'idle';
  },
};

/** Работа ТС. */
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
    } else if (job.kind === 'supply') {
      if (job.carry) b.mover.speed = b.walkSpeed * LABOR.booth.carrySpeedMul;
      const to = job.carry ? b.ctx.shops.dropOf(job.target) : labor.factoryStore;
      if (to) b.goToPoint(to);
    } else if (job.kind === 'vend') {
      if (job.shop.vendorSpot) b.goToPoint(job.shop.vendorSpot);
    } else if (job.kind === 'cookpot') {
      const s = b.ctx.shops.cookSpot;
      if (s) b.goToPoint(s);
    } else if (job.kind === 'clean' || job.kind === 'scavenge') b.goToPoint(job.pile);
    else if (job.kind === 'heal') b.goToPoint(job.patient);
    else if (job.kind === 'loot') b.goToPoint(job.corpse);
    else if (job.kind === 'pickpocket') {
      b.mover.speed = CHARACTER.walkSpeed * CRIME.npc.stalk;
      b.goToPoint(job.victim);
    } else if (job.kind === 'shank') {
      b.mover.speed = CHARACTER.walkSpeed * CRIME.shank.stalk;
      b.goToPoint(job.victim);
    }
    else if (job.kind === 'paper') {
      // В Управу жителю обычно не нужно (избегает), в канцелярию — можно.
      b.mover.avoidZones = undefined;
      b.goToPoint(job.desk);
    } else if (job.kind === 'haul' || job.kind === 'armory') {
      // На склад Протектората жителю нельзя — рабочему склада можно.
      b.mover.avoidZones = undefined;
      const to = job.kind === 'haul' ? haulTarget(b, job) : armoryTarget(b, job);
      if (to) b.goToPoint(to);
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
      if (job?.kind === 'haul' && !job.done) b.ctx.arsenal.abandon(b.self, job.task);
      if (job?.kind === 'armory' && !job.done) b.ctx.arsenal.abandonArmorer(b.self, job.task);
      if (job?.kind === 'supply') b.ctx.shops.releaseSupply(b.self);
      // Смена за прилавком или у котла окончена — перерыв.
      if (job?.kind === 'vend' || job?.kind === 'cookpot') {
        const S = ARBAT.staff;
        b.offUntil = b.ctx.law.now + b.ctx.rng.range(S.shift[0], S.shift[1]) * 0.3;
      }
      b.mover.avoidZones = b.avoid;
      b.mover.speed = b.walkSpeed;
      b.job = null;
      b.idleLeft = b.ctx.rng.range(1, 4);
      return 'idle';
    };
    if (!job) return done();
    const st = b.mover.status;
    // Склад: путь сорвался (затор, дверь) — пересчитать, а не бросать ящик посреди дороги.
    if (st === 'failed' && (job.kind === 'haul' || job.kind === 'armory')) {
      if ((job.fails = (job.fails ?? 0) + 1) > ARSENAL.work.retries) return done();
      const to = job.kind === 'haul' ? haulTarget(b, job) : armoryTarget(b, job);
      if (to) b.goToPoint(to);
      return;
    }
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
            if (b.ctx.rng.chance(0.4)) b.self.say(b.ctx.rng.pick(['Форма 7-Б… подпись…', 'Рапорт о лояльности квартала.', 'Отчёт для Коменданта готов.', 'Штамп. Следующий.']), now, 2.5);
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
        // Глава ТС: за столом в кабинете или у стойки найма напротив соискателя.
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
        // Соискатель: в очереди у стойки найма; приняли — он уже рабочий ТС.
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
      case 'supply': {
        // Коробка из штаба ТС: склад цеха → лавка (ларёк, столовая), где товара меньше всего.
        const shops = b.ctx.shops;
        const to = job.carry ? shops.dropOf(job.target) : labor.factoryStore;
        if (!to) return done();
        if (Math.hypot(to.x - b.self.x, to.y - b.self.y) < 26) {
          b.mover.stop();
          if (!job.carry) {
            if (!labor.takeBox(b.self)) return done();
            job.carry = true;
            b.mover.speed = b.walkSpeed * LABOR.booth.carrySpeedMul;
            const drop = shops.dropOf(job.target);
            if (drop) b.goToPoint(drop);
          } else {
            shops.deliver(b.self, job.target);
            if (b.ctx.rng.chance(0.4)) b.self.say(b.ctx.rng.pick(ARBAT.lines.deliver), b.ctx.law.now, 2);
            return done();
          }
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(to);
        return;
      }
      case 'vend':
      case 'cookpot': {
        // Продавец за прилавком (лицом к покупателю), повар — у котла лицом к раздаче.
        const shops = b.ctx.shops;
        const now = b.ctx.law.now;
        const spot = job.kind === 'vend' ? job.shop.vendorSpot : shops.cookSpot;
        const look = job.kind === 'vend' ? job.shop.front : shops.serveSpot;
        if (!spot || now > job.until || b.ctx.war.curfew) return done();
        if (job.kind === 'vend' && job.shop.vendor !== b.self) return done();
        if (Math.hypot(spot.x - b.self.x, spot.y - b.self.y) < ARBAT.staff.reach * 0.6) {
          b.mover.stop();
          if (look) faceTowards(b.self, look.x, look.y, dt);
          if (b.fsm.time % 10 < dt) b.ctx.economy.markWorked(b.self);
          if (now >= job.nextLine) {
            const S = ARBAT.staff;
            job.nextLine = now + b.ctx.rng.range(S.lineEvery[0], S.lineEvery[1]);
            const L = ARBAT.lines;
            const lines = job.kind === 'cookpot' ? L.cook : job.shop.stock.length && job.shop.goods <= 0 ? L.vendorEmpty : L.vendor;
            const busy = look && b.ctx.entities.near(look.x, look.y, 60).some((o) => o !== b.self && o.alive);
            if (busy || b.ctx.rng.chance(0.3)) b.self.say(b.ctx.rng.pick(lines), now, 2.4);
          }
        } else if (st === 'idle' || st === 'arrived') b.goToPoint(spot);
        return;
      }
      case 'haul': {
        const A = b.ctx.arsenal;
        const now = b.ctx.law.now;
        const t = job.task;
        if (now > job.until || b.ctx.war.code === 'red' || !A.taskValid(t)) return done();
        const to = haulTarget(b, job);
        if (!to) return done();
        if (Math.hypot(to.x - b.self.x, to.y - b.self.y) < ARSENAL.work.reach) {
          b.mover.stop();
          const look = t.type === 'beacon' ? to : haulLook(t, job.carry);
          faceTowards(b.self, look.x, look.y, dt);
          if (t.type === 'beacon') {
            if (A.repairBeacon(b.self, dt)) return done();
            return;
          }
          if (!job.carry) {
            if (!A.pickUp(b.self, t)) return done();
            job.carry = true;
            b.mover.speed = b.walkSpeed * ARSENAL.work.carrySpeedMul;
            if (b.ctx.rng.chance(0.25)) b.self.say(b.ctx.rng.pick(ARSENAL.lines.loader), now, 2);
            const next = haulTarget(b, job);
            if (next) b.goToPoint(next);
            return;
          }
          A.putDown(b.self, t);
          job.done = true;
          // Сдал — сразу следующий груз, если есть (без паузы на безделье).
          const more = A.loaderTask(b.self);
          if (!more) return done();
          b.job = { kind: 'haul', task: more, carry: false, until: now + ARSENAL.work.giveUp };
          b.mover.speed = b.walkSpeed;
          const next = haulTarget(b, b.job);
          if (next) b.goToPoint(next);
          return;
        }
        if (st === 'idle' || st === 'arrived') b.goToPoint(to);
        return;
      }
      case 'armory': {
        const A = b.ctx.arsenal;
        const now = b.ctx.law.now;
        const t = job.task;
        if (now > job.until || b.ctx.war.code === 'red') return done();
        const to = armoryTarget(b, job);
        if (!to) return done();
        if (Math.hypot(to.x - b.self.x, to.y - b.self.y) < ARSENAL.work.reach) {
          b.mover.stop();
          if (t.type === 'check') {
            faceTowards(b.self, t.slot.x, t.slot.y, dt);
            if (job.t === 0 && b.ctx.rng.chance(0.5)) b.self.say(b.ctx.rng.pick(ARSENAL.lines.check), now, 2);
            if (A.checkCrate(b.self, t, dt, job)) {
              job.done = true;
              return done();
            }
            return;
          }
          if (job.stage === 'pick') {
            faceTowards(b.self, t.from.x, t.from.y, dt);
            if (!A.takeGun(b.self, t)) return done();
            job.stage = 'bench';
            b.mover.speed = b.walkSpeed * 0.9;
            const next = armoryTarget(b, job);
            if (next) b.goToPoint(next);
            return;
          }
          if (job.stage === 'bench') {
            if (A.bench) faceTowards(b.self, A.bench.x, A.bench.y, dt);
            if ((job.t += dt) > 6 && b.ctx.rng.chance(dt * 0.08)) b.self.say(b.ctx.rng.pick(ARSENAL.lines.armorer), now, 2.5);
            if (!A.repairGun(b.self, dt)) return;
            job.stage = 'drop';
            const next = armoryTarget(b, job);
            if (next) b.goToPoint(next);
            return;
          }
          faceTowards(b.self, t.to.x, t.to.y, dt);
          A.rackGun(b.self, t);
          job.done = true;
          return done();
        }
        if (st === 'idle' || st === 'arrived') b.goToPoint(to);
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
        // За спиной — тянется к карману, не отставая от идущей жертвы.
        if (crime.behind(b.self, v)) {
          if ((job.left -= dt) <= 0) {
            crime.pickpocket(b.self, v);
            // Уходит быстрым шагом подальше.
            const away = b.goalAwayFrom(v.x, v.y);
            b.job = null;
            b.mover.speed = b.walkSpeed * 1.3;
            if (away >= 0) b.mover.goTo(b.self, b.ctx, away);
            return 'walk';
          }
        }
        // Заходит за спину (и держится там): точка позади жертвы.
        job.repath -= dt;
        if (job.repath <= 0 || st === 'idle' || st === 'arrived') {
          job.repath = 0.6;
          b.goToPoint({ x: v.x - Math.cos(v.facing) * 18, y: v.y - Math.sin(v.facing) * 18 });
        }
        return;
      }
      case 'shank': {
        // Нож в спину: зайти сзади и бить, пока жертва жива (начал — не отступает).
        const v = job.victim;
        const combat = b.ctx.combat;
        if (!v.alive || b.ctx.law.now > job.until || b.self.law.phase !== 'none') {
          if (b.self.weapon === 'knife') combat.equip(b.self, null);
          return done();
        }
        const d = Math.hypot(v.x - b.self.x, v.y - b.self.y);
        const struck = v.lastAttacker === b.self;
        if (d < v.radius + b.self.radius + WEAPONS.knife.range - 2 && (struck || b.ctx.crime.behind(b.self, v))) {
          if (b.self.weapon !== 'knife') combat.equip(b.self, 'knife');
          b.mover.stop();
          faceTowards(b.self, v.x, v.y, dt);
          if (!struck) b.self.say(b.ctx.rng.pick(CRIME.shank.lines), b.ctx.law.now, 1.5);
          combat.fire(b.self, v.x, v.y);
          return;
        }
        // Заходит за спину (после первого удара — прямо на жертву).
        job.repath -= dt;
        if (job.repath <= 0 || st === 'idle' || st === 'arrived') {
          job.repath = 0.4;
          if (struck) {
            b.mover.speed = CHARACTER.runSpeed;
            b.goToPoint(v);
          } else b.goToPoint({ x: v.x - Math.cos(v.facing) * 16, y: v.y - Math.sin(v.facing) * 16 });
        }
        return;
      }
      case 'loot': {
        // Обобрать тело ВС: оцепили, тело убрали, ВС рядом или долго — бросить.
        const k = job.corpse;
        if (!b.ctx.combat.corpses.includes(k) || b.ctx.war.scenes.sealed(k) || b.ctx.law.now > job.until || b.cpInSight(200)) return done();
        if (Math.hypot(k.x - b.self.x, k.y - b.self.y) > 22) {
          if (st === 'idle' || st === 'arrived') b.goToPoint(k);
          return;
        }
        b.mover.stop();
        faceTowards(b.self, k.x, k.y, dt);
        if ((job.left -= dt) <= 0) {
          if (b.ctx.combat.loot(b.self, k) > 0) {
            b.ctx.crime.stats.corpseLoots++;
            b.self.say(b.ctx.rng.pick(CRIME.loot.lines), b.ctx.law.now, 2);
          }
          return done();
        }
        return;
      }
      case 'heal': {
        const p = job.patient;
        if (!p.alive || (p.health >= p.maxHealth * LABOR.medic.below && p.bleed <= 0) || p.law.phase !== 'none') return done();
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
    // Ушёл с работы (тревога, приказ ВС, паника) — снять брони; коробку курьер держит при себе.
    const job = b.job;
    if (job?.kind === 'dispense') b.ctx.economy.releaseDispenser(b.self);
    if (job?.kind === 'repair' && job.spot.worker === b.self) job.spot.worker = null;
    if (job?.kind === 'clean' && job.pile.worker === b.self) job.pile.worker = null;
    if (job?.kind === 'pack') b.ctx.labor.stopPacking(b.self);
    // Склад: груз на землю (подберут и донесут), брони ячеек и места в конвое снимаются.
    if (job?.kind === 'haul' && !job.done) b.ctx.arsenal.abandon(b.self, job.task);
    if (job?.kind === 'armory' && !job.done) b.ctx.arsenal.abandonArmorer(b.self, job.task);
    if (job?.kind === 'supply') b.ctx.shops.releaseSupply(b.self);
    b.job = null;
    b.mover.speed = b.walkSpeed;
  },
};

/** Комендантский час: домой (или в ближайший подъезд/двор) и сидеть там до отбоя. */
const shelterGoal = (b: CitizenBrain): number => {
  const d = b.ctx.housing?.of(b.self);
  if (d && b.mover.status !== 'failed') {
    const p = b.ctx.rng.pick(d.spots);
    const a = b.ctx.nav.nearestWalkable(p.x, p.y, 1);
    if (a >= 0) return a;
  }
  return b.ctx.war.nearestShelter(b.self.x, b.self.y, b.self);
};
const SHELTER: State<CitizenBrain> = {
  name: 'shelter',
  enter(b) {
    b.mover.speed = CHARACTER.walkSpeed * 1.05;
    b.mover.avoidZones = b.avoid;
    const a = shelterGoal(b);
    if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
  },
  update(b) {
    const st = b.mover.status;
    if (st === 'arrived') b.mover.stop();
    else if (st === 'failed' || (st === 'idle' && b.ctx.war.outdoors(b.self))) {
      const a = st === 'failed' ? b.ctx.war.nearestShelter(b.self.x, b.self.y, b.self) : shelterGoal(b);
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
/** Драка на кулаках: к противнику, вплотную — бить (Brawls ведёт, кто с кем и до каких пор). */
const BRAWL_STATE: State<CitizenBrain> = {
  name: 'brawl',
  enter(b) {
    b.mover.stop();
    b.mover.speed = b.walkSpeed * 1.2;
    b.brawlRepath = 0;
    if (b.self.weapon) b.ctx.combat.equip(b.self, null);
  },
  update(b, dt) {
    const { self, ctx } = b;
    const o = ctx.brawls?.opponentOf(self);
    if (!o) {
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
    if (ctx.combat.knockedOut(self)) {
      b.mover.stop();
      return;
    }
    const gap = Math.hypot(o.x - self.x, o.y - self.y) - o.radius - self.radius;
    if (gap > FISTS.reach - self.radius) {
      b.brawlRepath -= dt;
      if (b.brawlRepath <= 0 || b.mover.status === 'idle' || b.mover.status === 'arrived') {
        b.brawlRepath = 0.5;
        const a = ctx.nav.nearestWalkable(o.x, o.y, 2);
        if (a >= 0) b.mover.goTo(self, ctx, a);
      }
      return;
    }
    b.mover.stop();
    faceTowards(self, o.x, o.y, dt);
    if (ctx.combat.punch(self, o.x, o.y) && ctx.rng.chance(0.12)) self.say(ctx.rng.pick(BRAWL.lines.hit), ctx.law.now, 1.5);
  },
  exit(b) {
    b.mover.speed = b.walkSpeed;
  },
};

const PANIC: State<CitizenBrain> = {
  name: 'panic',
  enter(b) {
    b.mover.speed = CHARACTER.runSpeed * 0.85;
    const p = b.panicFrom;
    const goal = p ? b.goalAwayFrom(p.x, p.y) : -1;
    if (goal >= 0) b.mover.goTo(b.self, b.ctx, goal);
    b.self.say(phrase(b.ctx.rng, b.self, LINES.panic), b.ctx.law.now, 1.5);
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
    // Ведущий ведёт беседу: тема за темой (Talk) — слухи, обстановка, родня, дела банды; без повторов.
    if (ctx.talk.busy(self)) b.nextLine = now + C.lineEvery[0];
    else if (now >= b.nextLine) {
      const kin = p.family >= 0 && p.family === self.family;
      const g = ctx.gangs?.of(self);
      ctx.talk.converse(self, p, kin ? 'family' : g && g === ctx.gangs.of(p) ? 'gang' : 'street');
      b.nextLine = now + ctx.rng.range(C.lineEvery[0], C.lineEvery[1]);
    }
    if (now >= b.chatUntil && ctx.talk.mayLeave(self, b.chatUntil)) b.endChat(ctx.rng.chance(C.strollChance));
  },
  exit(b) {
    // Прервали (проверка ВС, стрельба) — собеседник тоже расходится.
    b.ctx.talk.stop(b.self);
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
    // У бочки — разговор с соседом по кругу (слухи, обстановка) или реплика в огонь.
    if (!ctx.talk.busy(self) && ctx.rng.chance(dt / ((B.lineEvery[0] + B.lineEvery[1]) / 2)) && !(self.speech && self.speech.until > now)) {
      const mate = r.barrel.taken.find((o) => o && o !== self && o.alive && o.brain instanceof CitizenBrain && o.brain.fsm.current === 'barrel' && o.brain.stayUntil > 0 && !ctx.talk.busy(o));
      if (!(mate && ctx.rng.chance(0.55) && ctx.talk.converse(self, mate, 'barrel'))) self.say(ctx.talk.remark(self, 'barrel', STREET.barrelLines), now, 2.8);
    }
    if (now >= b.stayUntil && ctx.talk.mayLeave(self, b.stayUntil)) {
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
  },
  exit(b) {
    b.ctx.talk.stop(b.self);
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
        self.seated = 'sit';
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
      if (self.id < n.id) {
        if (ctx.talk.busy(self)) b.nextLine = now + B.lineEvery[0];
        else if (now >= b.nextLine) {
          if (ctx.talk.converse(self, n, n.family >= 0 && n.family === self.family ? 'family' : 'bench')) ctx.street.stats.benchTalks++;
          b.nextLine = now + ctx.rng.range(B.lineEvery[0], B.lineEvery[1]);
        }
      }
      // Досидеть вместе: собеседник не уходит раньше ведущего.
      if (self.id < n.id) nb.stayUntil = Math.max(nb.stayUntil, b.stayUntil);
    } else {
      faceTowards(self, seat.x + bench.nx * 60, seat.y + bench.ny * 60, dt);
      if (now >= b.nextLine) {
        b.nextLine = now + ctx.rng.range(B.soloLineEvery[0], B.soloLineEvery[1]);
        if (!(self.speech && self.speech.until > now)) self.say(ctx.talk.remark(self, 'bench', STREET.benchLines), now, 2.6);
      }
    }
    if (now >= b.stayUntil && ctx.talk.mayLeave(self, b.stayUntil)) {
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
  },
  exit(b) {
    b.ctx.talk.stop(b.self);
    b.ctx.street.releaseBenchSeat(b.self);
    b.bench = null;
    b.self.seated = '';
    b.stayUntil = 0;
  },
};

/**
 * Домой — в свою комнату (Housing: дом на проспекте, в общежитии, особняк, дом квартала): побыть,
 * иногда поспать на кровати, потом снова на улицу. Бездомный — в ближайший подъезд.
 */
const HOME: State<CitizenBrain> = {
  name: 'home',
  enter(b) {
    const { ctx, self } = b;
    b.stayUntil = 0;
    b.sleeping = false;
    b.nextHome = ctx.law.now + ctx.rng.range(HOUSING.visit.every[0], HOUSING.visit.every[1]);
    const d = ctx.housing?.of(self);
    if (d) {
      b.sleeping = !!d.bed && (b.nightSleep || ctx.rng.chance(HOUSING.sleepChance));
      ctx.street.stats.homes++;
      ctx.housing.stats.visits++;
      if (!b.goToPoint(ctx.housing.spot(d, b.sleeping))) b.idleLeft = 0.5;
      return;
    }
    const a = ctx.street.homeNear(self);
    if (a >= 0) b.mover.goTo(self, ctx, a);
    else b.idleLeft = 0.5;
  },
  update(b) {
    const { ctx, self } = b;
    const st = b.mover.status;
    const now = ctx.law.now;
    if (!b.stayUntil) {
      if (st === 'failed' || st === 'idle') return 'idle';
      if (st === 'arrived') {
        const H = HOUSING;
        const [lo, hi] = b.sleeping ? H.sleep : H.stay;
        // Ночью — до утра (свой час подъёма), а не на пару минут.
        const wake = b.nightSleep ? ctx.routine.untilWake(self) : 0;
        b.stayUntil = now + (wake > 0 ? wake + ctx.rng.range(0, 15) : ctx.rng.range(lo, hi));
        self.asleep = b.sleeping;
        if (b.sleeping) ctx.housing.stats.sleeps++;
        if (ctx.rng.chance(0.3)) self.say(phrase(ctx.rng, self, b.sleeping ? H.lines.sleep : H.lines.home), now, 2);
      }
      return;
    }
    if (b.sleeping && ctx.rng.chance(0.04 / 60)) self.say(phrase(ctx.rng, self, HOUSING.lines.sleep), now, 1.5);
    // Утро настало раньше расчёта (часы сдвинулись — загрузка, тест) — встаёт.
    if (b.nightSleep && !ctx.routine.asleepTime(self)) b.stayUntil = Math.min(b.stayUntil, now);
    if (now >= b.stayUntil) {
      if (b.nightSleep) {
        // Утро: встал — и сразу решает, куда (очередь, смена, дела).
        if (ctx.rng.chance(0.35)) self.say(ctx.rng.pick(ROUTINE.lines.wake), now, 2);
        b.idleLeft = ctx.rng.range(0.5, 3);
        return 'idle';
      }
      if (ctx.rng.chance(0.2)) self.say(ctx.rng.pick(HOUSING.lines.leave), now, 2);
      b.idleLeft = 0.5;
      return 'walk';
    }
  },
  exit(b) {
    b.sleeping = false;
    b.nightSleep = false;
    b.self.asleep = false;
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
        self.seated = 'cards';
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
      if (!(self.speech && self.speech.until > now)) self.say(ctx.talk.remark(self, 'cards', STREET.cardLines), now, 2.4);
    }
    if (now >= b.stayUntil) {
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
  },
  exit(b) {
    b.ctx.street.releaseTableSeat(b.self);
    b.table = null;
    b.self.seated = '';
    b.stayUntil = 0;
  },
};

/** Общая столовая: сесть за стол, поесть (паёк из инвентаря), перекинуться словом с соседями. */
const CANTEEN: State<CitizenBrain> = {
  name: 'canteen',
  enter(b) {
    const shops = b.ctx.shops;
    b.stayUntil = 0;
    b.meetUntil = b.ctx.law.now + 120;
    // Без пайка — сперва к раздаче за супом.
    b.soupFirst = !shops.foodOf(b.self) && !b.self.soupBowl && shops.soupReady && !!shops.serveSpot;
    b.seat = shops.takeSeat(b.self, b.ctx.rng);
    if (!b.seat || !b.goToPoint(b.soupFirst ? shops.serveSpot! : b.seat)) b.idleLeft = 0.5;
  },
  update(b, dt) {
    const M = ARBAT.meal;
    const { ctx, self } = b;
    const now = ctx.law.now;
    const seat = b.seat;
    if (!seat) return 'idle';
    const st = b.mover.status;
    if (b.soupFirst) {
      const sv = ctx.shops.serveSpot!;
      if (st === 'failed' || now > b.meetUntil) return 'idle';
      if (st === 'arrived' || Math.hypot(sv.x - self.x, sv.y - self.y) < 14) {
        b.mover.stop();
        // Суп кончился или повар ушёл — есть нечего.
        if (!ctx.shops.takeSoup(self)) {
          self.say(ctx.rng.pick(ARBAT.lines.empty), now, 2);
          return 'idle';
        }
        if (ctx.rng.chance(0.4)) self.say(ctx.rng.pick(ARBAT.lines.soup), now, 2);
        b.soupFirst = false;
        b.goToPoint(seat);
      } else if (st === 'idle') b.goToPoint(sv);
      return;
    }
    if (!b.stayUntil) {
      if (st === 'failed' || now > b.meetUntil) return 'idle';
      if (st === 'arrived' || Math.hypot(seat.x - self.x, seat.y - self.y) < 10) {
        b.mover.stop();
        b.stayUntil = now + ctx.rng.range(M.eat[0], M.eat[1]);
        self.seated = 'eat';
        b.nextLine = now + ctx.rng.range(1, 4);
      } else if (st === 'idle') b.goToPoint(seat);
      return;
    }
    b.mover.stop();
    faceTowards(self, seat.lookX, seat.lookY, dt);
    // За столом с соседями — разговор.
    const others = ctx.shops.seats.some((o) => o !== seat && o.table === seat.table && o.taken && o.taken.alive && o.taken.brain instanceof CitizenBrain && o.taken.brain.fsm.current === 'canteen' && o.taken.brain.stayUntil > 0);
    if (others && now >= b.nextLine && !ctx.talk.busy(self)) {
      b.nextLine = now + ctx.rng.range(M.lineEvery[0], M.lineEvery[1]);
      // Сосед по столу — беседа; иначе — про еду.
      const mate = ctx.shops.seats.find((o) => o !== seat && o.table === seat.table && o.taken && o.taken.alive && o.taken.brain instanceof CitizenBrain && o.taken.brain.fsm.current === 'canteen' && !ctx.talk.busy(o.taken))?.taken;
      if (!(mate && ctx.rng.chance(0.5) && ctx.talk.converse(self, mate, 'canteen')) && !(self.speech && self.speech.until > now)) self.say(ctx.talk.remark(self, 'canteen', ARBAT.lines.canteen), now, 2.4);
    }
    if (now >= b.stayUntil && ctx.talk.mayLeave(self, b.stayUntil)) {
      ctx.shops.eat(self);
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
  },
  exit(b) {
    b.ctx.talk.stop(b.self);
    b.ctx.shops.releaseSeat(b.self);
    b.seat = null;
    b.self.seated = '';
    b.stayUntil = 0;
    b.soupFirst = false;
    // Не доел (ВС, стрельба) — миска остаётся на столе.
    b.self.soupBowl = false;
  },
};

/** По лавкам проспекта: дойти до прилавка или окошка ларька, постоять, купить что по карману. */
const SHOPPING: State<CitizenBrain> = {
  name: 'shopping',
  enter(b) {
    b.stayUntil = 0;
    b.meetUntil = b.ctx.law.now + 90;
    b.shopGo = b.ctx.shops.pickShop(b.self, b.ctx.rng);
    if (!b.shopGo || !b.goToPoint(b.shopGo.front)) b.idleLeft = 0.5;
    else b.ctx.shops.stats.visits++;
  },
  update(b, dt) {
    const V = ARBAT.visit;
    const { ctx, self } = b;
    const now = ctx.law.now;
    const s = b.shopGo;
    if (!s) return 'idle';
    const st = b.mover.status;
    if (!b.stayUntil) {
      if (st === 'failed' || now > b.meetUntil) return 'idle';
      if (st === 'arrived' || Math.hypot(s.front.x - self.x, s.front.y - self.y) < 12) {
        b.mover.stop();
        b.stayUntil = now + ctx.rng.range(V.stay[0], V.stay[1]);
      } else if (st === 'idle') b.goToPoint(s.front);
      return;
    }
    b.mover.stop();
    faceTowards(self, s.look.x, s.look.y, dt);
    if (now >= b.stayUntil) {
      const L = ARBAT.lines;
      // Закрыто (продавца нет) или полки пусты (коробку из штаба ТС не донесли).
      const why = ctx.shops.refusal(s);
      if (why) {
        if (why === 'closed') ctx.shops.stats.closed++;
        else ctx.shops.stats.empty++;
        self.say(ctx.rng.pick(why === 'closed' ? L.closed : L.empty), now, 2);
        b.idleLeft = ctx.rng.range(1, 3);
        return 'idle';
      }
      const bought = s.stock.length && self.money >= V.minMoney ? ctx.shops.npcBuy(self, s, ctx.rng) : null;
      const line = bought ? L.buy : s.stock.length && self.money < V.minMoney ? L.broke : L.browse;
      if (ctx.rng.chance(0.5)) self.say(ctx.rng.pick(line), now, 2);
      b.idleLeft = ctx.rng.range(1, 3);
      return 'idle';
    }
  },
  exit(b) {
    b.shopGo = null;
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
      if (!(self.speech && self.speech.until > now)) self.say(ctx.talk.remark(self, 'smoke', STREET.smokeLines), now, 2.4);
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
      if (!(self.speech && self.speech.until > now)) self.say(ctx.talk.remark(self, 'notice', STREET.noticeLines), now, 2.6);
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

/** Слушать обращение Коменданта на площади. */
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
      if (ctx.rng.chance(dt * 0.015) && !(self.speech && self.speech.until > ctx.law.now)) self.say(ctx.talk.remark(self, 'listen'), ctx.law.now, 2);
    }
  },
};

/** Куда идти грузчику: за грузом (крыльцо, ячейка) или с грузом (ячейка, пункт КПП); к маяку. */
function haulTarget(b: CitizenBrain, job: Extract<Job, { kind: 'haul' }>): Vec2 | null {
  const A = b.ctx.arsenal;
  return job.carry ? A.dropTarget(job.task) : A.pickTarget(job.task);
}

/** Куда смотреть у места: на ячейку (стеллаж, стойку), на маяк или пункт КПП. */
function haulLook(t: HaulTask, carry: boolean): Vec2 {
  if (t.type === 'beacon') return { x: 0, y: 0 };
  if (t.type === 'store') return carry ? t.to : t.crate;
  return carry ? t.to : t.from;
}

/** Куда идти оружейнику: к ящику на ремонт, к верстаку, к стойке; к проверяемому ящику. */
function armoryTarget(b: CitizenBrain, job: Extract<Job, { kind: 'armory' }>): Vec2 | null {
  const A = b.ctx.arsenal;
  const t = job.task;
  if (t.type === 'check') return { x: t.slot.ax, y: t.slot.ay };
  if (job.stage === 'pick') return { x: t.from.ax, y: t.from.ay };
  if (job.stage === 'bench') return A.benchSpot;
  return { x: t.to.ax, y: t.to.ay };
}
