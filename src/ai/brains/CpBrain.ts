import { ARSENAL } from '../../config/arsenal';
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
import type { CrimeScene } from '../../systems/CrimeScenes';
import { CRIME } from '../../config/crime';
import { LAW } from '../../config/law';
import { VISION } from '../../config/vision';
import { dist, type Vec2 } from '../../core/math';
import { Gunner } from '../Gunner';
import { Tactician, followColumn, watchSector } from '../Tactics';
import { TACTICS } from '../../config/tactics';
import { COMBAT } from '../../config/combat';
import { ALARM } from '../../config/underground';
import { hasLoyalty, loyaltyTier } from '../../systems/Loyalty';
import { FACTIONS, cpHas, cpUnit } from '../../config/factions';
import { SECURITY } from '../../config/security';
import { CWU_HQ } from '../../config/cwuHq';

const near: Character[] = [];

export interface CpOptions {
  /** Пост часового (КПП), px мира. */
  post?: Vec2;
  facing?: number;
  /** Номер фронта (пограничного КПП), к которому приписан. */
  front?: number;
  /** Место медика SU.02 на КПП. */
  medicStation?: Vec2;
  /**
   * Служба: post — постовой RCT в городе; squad — в патрульной группе (lead — ведущий);
   * officer — офицер PCU.OFC (обход постов, построения); inspector — SU.INSP; bodyguard — SU.GUARD;
   * epu — глава силового блока; qm — кладовщик склада (стоит у стола выдачи, за нарушителями не ходит).
   */
  duty?: CpDuty;
  squad?: number;
  lead?: boolean;
}

export type CpDuty = 'post' | 'squad' | 'officer' | 'inspector' | 'bodyguard' | 'epu' | 'qm';

/** Место в строю построения (Security) — пока задано, юнит стоит в строю. */
export interface FormationSlot {
  x: number;
  y: number;
  facing: number;
}

/** Состояния, из которых можно сразу перейти в бой. */
const CAN_FIGHT = new Set(['patrol', 'patrol-again', 'post', 'guard', 'hunt', 'approach', 'chase', 'medic', 'heal', 'check', 'bodyguard', 'follow', 'duty', 'formation', 'scene', 'resupply']);

/** Из этих состояний юнит возвращается на место преступления, если ещё не закончил там. */
const SCENE_RESUME = new Set(['patrol', 'patrol-again', 'post', 'follow', 'duty', 'hunt']);

/** Состояния, в которых юнит осматривается (нарушения, тела, раненые). */
const WATCHING = new Set(['patrol', 'post', 'guard', 'hunt', 'medic', 'follow', 'duty', 'bodyguard']);

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
  /** Рейд на логово сопротивления: точка у лагеря вместо своего поста (InsurgencySystem.raid). */
  raidPost: Vec2 | null = null;
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
  /** Прочёсывание: своя точка поиска, вокруг какого места, сколько ещё осматриваться. */
  huntSpot = -1;
  private huntAround: Vec2 | null = null;
  private huntPause = 0;
  healCooldown = 0;
  retreatTo: Vec2 | null = null;
  /** Наблюдатель OBS: какое тело сканирует и сколько осталось. */
  corpse: Corpse | null = null;
  scanLeft = 0;
  /** Место преступления: осмотреть тело (следователь) или охранять оцепление (офицер). */
  scene: CrimeScene | null = null;
  sceneRole: 'investigate' | 'guard' = 'guard';
  sceneSpot: Vec2 | null = null;
  /** Кого сопровождает (охрана доверенного лоялиста) и до какого времени. */
  ward: Character | null = null;
  wardUntil = 0;
  private scan = 0;
  /** Куда патруль не ходит: пустошь за стеной и лагерь сопротивления (PCU — ещё и КПП). */
  readonly patrolAvoid: ReadonlySet<number>;
  readonly duty: CpDuty | null;
  readonly squad: number;
  readonly lead: boolean;
  /** Служба: точка, куда смотреть, до какого времени стоять, что сказать по прибытии. */
  dutySpot: Vec2 | null = null;
  dutyFacing = 0;
  dutyUntil = 0;
  dutyLine: string | null = null;
  dutyArrived = false;
  /** Место в строю (построение) — задаёт Security. */
  formation: FormationSlot | null = null;
  private leaderCache: Character | null = null;
  private leaderCheck = 0;
  /** Тактика боя (углы, укрытия, раненые), место начала боя, колонна за ведущим. */
  readonly tactics = new Tactician();
  fightHome: Vec2 | null = null;
  readonly column = { repath: 0 };
  private colIndex = 1;
  private colLast = true;
  private colCheck = 0;
  /** Пополнение на складе: когда проверить патроны снова, сколько ждёт у окна, когда бросить. */
  resupplyCheck = 0;
  resupplyWait = 0;
  resupplyUntil = 0;

  constructor(
    public self: Character,
    public ctx: AiContext,
    opts: CpOptions = {},
  ) {
    this.guardPost = opts.post ?? null;
    this.guardFacing = opts.facing ?? 0;
    this.front = opts.front ?? -1;
    this.medicStation = opts.medicStation ?? null;
    this.duty = opts.duty ?? null;
    this.squad = opts.squad ?? -1;
    this.lead = opts.lead ?? false;
    // Городская полиция PCU на бойню у КПП не ходит: КПП держат SU и OTA.
    const pcu = self.faction === 'cp' && cpUnit(self.rank).group === 'pcu' && this.front < 0;
    this.patrolAvoid = zoneIds(ctx, pcu ? ['outlands', 'wasteland', 'rebel_camp', 'checkpoint', 'arsenal'] : ['outlands', 'wasteland', 'rebel_camp', 'arsenal']);
    this.mover = new Mover(LAW.cpWalkSpeed);
    this.gunner = new Gunner(ctx.rng);
    this.fsm = new StateMachine<CpBrain>(
      this,
      [PATROL, PATROL_AGAIN, POST, GUARD, APPROACH, CHECK, CHASE, ESCORT, FIGHT, RETREAT, MEDIC, HEAL, HUNT, BODYGUARD, SCAN, FOLLOW, DUTY, FORMATION, SCENE, RESUPPLY],
      this.idleState,
    );
    this.scan = ctx.rng.range(0, LAW.scanInterval);
  }

  get stateName(): string {
    const t = this.target ? ` → #${this.target.cid}` : this.gunner.target ? ` → ${this.gunner.target.name}` : '';
    const div = this.self.faction === 'cp' ? `${cpUnit(this.self.rank).short} · ` : '';
    const tac = this.tactics.label;
    return `${div}${this.fsm.current}${tac ? ` · ${tac}` : ''}${t}`;
  }

  /**
   * Прочёсывать: красный код — все патрульные; жёлтый — патрульные в радиусе ALARM.respondRadius
   * от тревоги (или от известного нападавшего).
   */
  shouldHunt(): boolean {
    const war = this.ctx.war;
    // Прочёсывают при тревоге: коде жёлтом/красном или свежей точке тревоги (нападение, саботаж…).
    if (this.guardPost || this.medicStation || (war.code === 'green' && !war.alarmActive)) return false;
    // Командование и охрана при тревоге остаются при своих. Ведомые идут за ведущим, а когда он
    // поднят на прочёсывание — расходятся и прочёсывают вместе с ним, каждый в своей точке.
    if (this.duty === 'inspector' || this.duty === 'epu' || this.duty === 'bodyguard' || this.duty === 'officer') return false;
    const lead = this.duty === 'squad' && !this.lead ? this.leader() : null;
    if (lead) {
      if (!(lead.brain as CpBrain).shouldHunt()) return false;
    }
    if (war.code === 'red') return true;
    const p = war.nearestKnown(this.self.x, this.self.y);
    if (!p) return false;
    const d = Math.hypot(p.x - this.self.x, p.y - this.self.y);
    if (d < ALARM.respondRadius) return true;
    // Город большой: ведущие ALARM.minSquads ближайших групп идут на тревогу и издалека.
    if (this.duty !== 'squad' || !this.lead) return false;
    let closer = 0;
    for (const o of this.ctx.entities.list) {
      const b = o.brain;
      if (o === this.self || !o.alive || !(b instanceof CpBrain) || b.duty !== 'squad' || !b.lead) continue;
      if (Math.hypot(p.x - o.x, p.y - o.y) < d && ++closer >= ALARM.minSquads) return false;
    }
    return true;
  }

  /** Прочёсывание вокруг места p: своя точка, не у точек других; дошёл — осмотрелся — следующая. */
  sweep(p: Vec2, dt: number): void {
    const H = LAW.hunt;
    const { ctx, self } = this;
    const moved = !this.huntAround || Math.hypot(p.x - this.huntAround.x, p.y - this.huntAround.y) > H.moved;
    const st = this.mover.status;
    const at = this.huntSpot >= 0 && Math.hypot(ctx.nav.worldX(this.huntSpot) - self.x, ctx.nav.worldY(this.huntSpot) - self.y) < 14;
    if (at || st === 'arrived') {
      this.mover.stop();
      this.huntPause -= dt;
      if (ctx.rng.chance(dt * 0.8)) this.postFacing = ctx.rng.range(0, Math.PI * 2);
      turnTowards(self, this.postFacing, dt, 3);
    }
    const done = (at || st === 'arrived') && this.huntPause <= 0;
    if (!moved && !done && this.huntSpot >= 0 && st !== 'failed' && st !== 'idle') return;
    if (!moved && !done && this.huntSpot >= 0 && (at || st === 'arrived')) return;
    this.huntAround = { x: p.x, y: p.y };
    // Точки других прочёсывающих рядом — не брать их.
    const taken: Vec2[] = [];
    for (const o of ctx.entities.near(p.x, p.y, H.radius[1] * ctx.map.tileSize + H.spacing, near)) {
      const b = o.brain;
      if (o !== self && b instanceof CpBrain && b.huntSpot >= 0) taken.push({ x: ctx.nav.worldX(b.huntSpot), y: ctx.nav.worldY(b.huntSpot) });
    }
    let best = -1;
    for (let k = 0; k < 10; k++) {
      const a = randomAnchorAround(p, ctx, H.radius[0], H.radius[1], this.patrolAvoid);
      if (a < 0) continue;
      best = a;
      const x = ctx.nav.worldX(a);
      const y = ctx.nav.worldY(a);
      if (!taken.some((q) => Math.hypot(q.x - x, q.y - y) < H.spacing)) break;
    }
    if (best < 0) return;
    this.huntSpot = best;
    this.huntPause = ctx.rng.range(H.pause[0], H.pause[1]);
    this.mover.goTo(self, ctx, best);
  }

  /** Может ли быть охраной (свободный патрульный). */
  get canGuard(): boolean {
    const cur = this.fsm.current;
    return !this.guardPost && !this.medicStation && !this.target && (cur === 'patrol' || cur === 'post' || cur === 'patrol-again');
  }

  /** Сопровождать ward до времени until (охрана доверенного лоялиста). */
  assignGuard(ward: Character, until: number): void {
    this.ward = ward;
    this.self.guarding = ward;
    this.wardUntil = until;
    this.fsm.change('bodyguard');
  }

  /** Куда возвращаться после разбирательства. */
  get idleState(): string {
    if (this.medicStation) return 'medic';
    if (this.formation) return 'formation';
    if (this.guardPost) return 'guard';
    if (this.ward?.alive && this.ctx.law.now < this.wardUntil) return 'bodyguard';
    if (this.duty === 'squad' && !this.lead && this.leader() && !(this.ctx.war && this.shouldHunt())) return 'follow';
    if (this.duty === 'inspector' || this.duty === 'epu' || this.duty === 'bodyguard' || this.duty === 'officer') return 'duty';
    return this.ctx.war && this.shouldHunt() ? 'hunt' : 'patrol';
  }

  /** Место в колонне за ведущим (1 — сразу за ним) по номерам ведомых; кэш на секунду. */
  columnIndex(l: Character): number {
    const now = this.ctx.law.now;
    if (now >= this.colCheck) {
      this.colCheck = now + 1;
      let k = 1;
      let n = 0;
      for (const o of this.ctx.entities.list) {
        if (!o.alive || o === l || o.squadLead !== l) continue;
        n++;
        if (o.id < this.self.id) k++;
      }
      this.colIndex = k;
      this.colLast = k >= n;
    }
    return this.colIndex;
  }

  /** Ведущий своей патрульной группы (живой), кэш на секунду. */
  leader(): Character | null {
    if (this.duty !== 'squad' || this.lead) return null;
    const now = this.ctx.law.now;
    if (now < this.leaderCheck && this.leaderCache?.alive) return this.leaderCache;
    this.leaderCheck = now + 1;
    this.leaderCache = null;
    for (const o of this.ctx.entities.list) {
      const b = o.brain;
      if (o.alive && b instanceof CpBrain && b.duty === 'squad' && b.lead && b.squad === this.squad) {
        this.leaderCache = o;
        break;
      }
    }
    this.self.squadLead = this.leaderCache;
    return this.leaderCache;
  }

  /** Встать в строй (Security): юнит бросает дежурство и идёт на плац. */
  joinFormation(slot: FormationSlot): void {
    this.formation = slot;
    this.target = null;
    this.fsm.change('formation');
  }

  /** Разойтись после построения. */
  leaveFormation(): void {
    this.formation = null;
    if (this.fsm.current === 'formation') this.fsm.change(this.idleState);
  }

  /** Свободен для построения: юнит PCU на патруле или в группе (не пост, не в деле). */
  get canForm(): boolean {
    const cur = this.fsm.current;
    return !this.formation && !this.guardPost && !this.medicStation && !this.target && !this.ward &&
      (cur === 'patrol' || cur === 'patrol-again' || cur === 'post' || cur === 'follow');
  }

  /** Следующая точка службы (инспектор, офицер, охрана без подопечного, глава). */
  nextDuty(): void {
    const { ctx, self } = this;
    const D = SECURITY.duty;
    const now = ctx.law.now;
    const pick = (t: Parameters<typeof poiWorld>[1]) => {
      const n = ctx.map.poisOf(t).length;
      return n ? poiWorld(ctx, t, Math.floor(ctx.rng.next() * n)) : null;
    };
    this.dutyArrived = false;
    this.dutyLine = null;
    if (this.duty === 'inspector') {
      // Обход: повара на раздаче, канцелярия с лоялистами, завод ГСР, площадь, плац.
      const places: [Vec2 | null, readonly string[]][] = [
        [ctx.economy.dispenserSpot, SECURITY.lines.inspectCook],
        [pick('clerk_desk'), SECURITY.lines.inspectClerk],
        [pick('clerk_desk'), SECURITY.lines.inspectClerk],
        [ctx.labor.factory, SECURITY.lines.inspectCook],
        // Штаб ГСР: глава отчитывается инспектору (CwuHqSystem).
        [ctx.cwuHq?.desk ?? null, CWU_HQ.lines.inspect],
        [ctx.cwuHq?.desk ?? null, CWU_HQ.lines.inspect],
        [poiWorld(ctx, 'plaza_center'), SECURITY.lines.inspect],
        [poiWorld(ctx, 'nexus_yard'), SECURITY.lines.inspect],
        // Склад Альянса: сверка описи с запасами (ArsenalSystem).
        [ctx.arsenal?.ledgerSpot ?? null, ARSENAL.lines.inspect],
      ];
      const [p, lines] = ctx.rng.pick(places.filter(([q]) => q)) ?? [null, SECURITY.lines.inspect];
      // Встать рядом, а не на рабочее место повара или фасовщика (у описи склада — прямо у стола).
      const ledger = p !== null && p === ctx.arsenal?.ledgerSpot;
      const a = p && !ledger ? randomAnchorAround(p, ctx, 2, 4, this.patrolAvoid) : -1;
      this.dutySpot = a >= 0 ? { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) } : p;
      this.dutyLine = ctx.rng.pick(lines);
      this.dutyUntil = now + ctx.rng.range(D.inspector[0], D.inspector[1]);
    } else if (this.duty === 'officer') {
      // Обход: постовые и ведущие групп — «доложить обстановку».
      const units = ctx.entities.list.filter((o) => {
        const b = o.brain;
        return o !== self && o.alive && b instanceof CpBrain && (b.duty === 'post' || (b.duty === 'squad' && b.lead));
      });
      const u = units.length ? ctx.rng.pick(units) : null;
      this.dutySpot = u ? { x: u.x, y: u.y } : poiWorld(ctx, 'nexus_yard');
      this.dutyLine = ctx.rng.pick(SECURITY.lines.officer);
      this.dutyUntil = now + ctx.rng.range(D.officer[0], D.officer[1]);
    } else {
      // Глава и свободная охрана — у кабинета Администратора; глава на выходе — у цели выхода.
      const tour = this.duty === 'epu' ? ctx.security?.tourSpot : null;
      // Глава: в клетке у Администратора сидит партизан — допрос (InsurgencySystem).
      const cage = this.duty === 'epu' && !tour ? ctx.law.cells.find((c) => c.cage && c.slots.some((s) => s.occupant)) : null;
      const office = poiWorld(ctx, 'nexus_desk');
      this.dutySpot = tour ?? (cage ? { x: cage.frontX, y: cage.frontY } : office ? { x: office.x + ctx.rng.range(-24, 24), y: office.y + ctx.rng.range(18, 40) } : null);
      if (tour) this.dutyLine = ctx.rng.pick(SECURITY.lines.tour);
      this.dutyUntil = now + ctx.rng.range(D.office[0], D.office[1]);
    }
    this.dutyFacing = ctx.rng.range(0, Math.PI * 2);
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
    if (wounded && cur !== 'retreat' && cur !== 'escort') {
      // Отходит — кого остановил или проверял, отпускает (не стоять им до его возвращения).
      const t = this.target;
      if (t && t.law.handler === self && t.law.phase !== 'cuffed' && t.law.phase !== 'entering' && t.law.phase !== 'jailed') ctx.law.clear(t);
      this.target = null;
      this.fsm.change('retreat');
    }
    else if (engaged && this.gunner.target && CAN_FIGHT.has(cur) && cur !== 'check') {
      // Отпускаем проверяемого — не до него.
      if (this.target && this.target.law.handler === self && this.target.law.phase !== 'cuffed') ctx.law.clear(this.target);
      this.target = null;
      this.fsm.change('fight');
    }
    cur = this.fsm.current;
    // Свой тяжелораненый рядом — оттащить и поднять; лежащий враг в городе — задержать.
    const free = cur !== 'escort' && cur !== 'check' && cur !== 'approach' && cur !== 'formation' && cur !== 'retreat' && cur !== 'scene' && cur !== 'chase';
    if (free) {
      let busy = this.tactics.rescue(self, ctx, this.gunner, this.mover, dt);
      if (!busy && !this.guardPost && !(engaged && this.gunner.target)) {
        const r = this.tactics.detain(self, ctx, this.mover, dt);
        if (r.cuffed) {
          this.target = r.cuffed;
          this.fsm.change('escort');
        } else busy = r.busy;
      }
      if (busy) {
        this.mover.update(self, ctx, dt);
        if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
        return;
      }
    }
    cur = this.fsm.current;
    // Не закончил на месте преступления (отвлёкся на бой, проверку) — назад к оцеплению.
    if (this.scene && !this.scene.closed && SCENE_RESUME.has(cur)) this.fsm.change('scene');
    cur = this.fsm.current;
    // Красный код: патрульные — на прочёсывание.
    if ((cur === 'patrol' || cur === 'post' || cur === 'patrol-again') && !this.guardPost && !this.medicStation && this.shouldHunt()) {
      this.fsm.change('hunt');
    }
    cur = this.fsm.current;
    // Патроны на исходе — к окну выдачи склада (патрульный, не на посту и не в строю).
    if ((cur === 'patrol' || cur === 'post' || cur === 'patrol-again') && !this.guardPost && !this.medicStation && ctx.law.now >= this.resupplyCheck) {
      this.resupplyCheck = ctx.law.now + ARSENAL.issue.checkEvery;
      if (ctx.arsenal?.needsAmmo(self)) this.fsm.change('resupply');
    }
    cur = this.fsm.current;
    if (WATCHING.has(cur)) {
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
    if (this.tactics.face(self, dt)) return;
    // В колонне на месте — каждый смотрит в свой сектор.
    if (now === 'follow' && self.moveSpeed < 8 && this.leaderCache) {
      watchSector(self, this.leaderCache, this.colIndex, this.colLast, dt);
      return;
    }
    if (now !== 'check' && now !== 'post' && now !== 'guard' && now !== 'medic' && now !== 'formation' && !(now === 'duty' && this.dutyArrived) && !(now === 'scene' && self.moveSpeed < 8)) faceMovement(self, ctx, dt);
  }

  /** Отправить на место преступления: следователь — осмотр тела, офицер — охрана оцепления. */
  assignScene(s: CrimeScene, role: 'investigate' | 'guard'): void {
    this.scene = s;
    this.sceneRole = role;
    this.sceneSpot = null;
    if (this.target && this.target.law.handler === this.self && this.target.law.phase !== 'cuffed') this.ctx.law.clear(this.target);
    this.target = null;
    this.fsm.change('scene');
  }

  /** Оцепление снято (или своё дело сделано). */
  releaseScene(s: CrimeScene): void {
    if (this.scene !== s) return;
    this.scene = null;
    this.sceneSpot = null;
    if (this.fsm.current === 'scene') this.fsm.change(this.idleState);
  }

  /** Осмотреться: раненые свои (HELIX), нарушения, иногда — проверка «для порядка». */
  private lookAround(): void {
    const { self, ctx } = this;
    const law = ctx.law;
    const zone = ctx.map.zoneAtWorld(self.x, self.y);
    const atCheckpoint = zone?.kind === 'checkpoint';
    // Техник TECH: сканер в воздухе, пока есть заряд.
    if (cpHas(self, 'drone') && !this.medicStation && !ctx.scanners.of(self) && ctx.map.levelAt(self.x, self.y) === 'city') {
      if (!ctx.scanners.deploy(self)) self.say('Сканер пошёл.', ctx.law.now, 2);
    }
    // Наблюдатель OBS: неотсканированное тело в городе поблизости — идёт сканировать.
    if (cpHas(self, 'investigate') && !this.guardPost) {
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
    if (cpHas(self, 'medic')) {
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
      // Часовой не уходит с поста ради беготни по городу; постовой RCT — только рядом с постом.
      if (this.guardPost && !atCheckpoint && !(this.duty === 'post' && dist(this.guardPost.x, this.guardPost.y, o.x, o.y) < SECURITY.postReach)) continue;
      // Командование, охрана и кладовщик за нарушителями не бегают — это работа PCU.
      if (this.duty === 'inspector' || this.duty === 'epu' || this.duty === 'bodyguard' || this.duty === 'qm') continue;
      this.engage(o, v);
      return;
    }
    if (ctx.war.code === 'red' || this.medicStation) return;
    // Плановые проверки CID — работа PCU (и следователей), не командования и не охраны.
    if (this.duty === 'inspector' || this.duty === 'epu' || this.duty === 'bodyguard' || this.duty === 'qm' || this.formation) return;
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
      if (o === this.self || !FACTIONS[o.faction].authority || (o.health >= o.maxHealth * 0.75 && o.bleed <= 0)) continue;
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

/**
 * Пополнение боекомплекта на складе Альянса: к окну выдачи, постоять issue.every с — кладовщик
 * выдаёт (или отказывает: пусто, закрыто, кладовщика нет). Не дошёл за issue.giveUp с — бросает.
 */
const RESUPPLY: State<CpBrain> = {
  name: 'resupply',
  enter(b) {
    b.mover.speed = LAW.cpWalkSpeed;
    b.resupplyWait = 0;
    b.resupplyUntil = b.ctx.law.now + ARSENAL.issue.giveUp;
    const w = b.ctx.arsenal.window;
    const a = w ? b.ctx.nav.nearestWalkable(w.x, w.y, 3) : -1;
    if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
  },
  update(b, dt) {
    const A = b.ctx.arsenal;
    const w = A.window;
    if (!w || b.ctx.law.now > b.resupplyUntil) return b.idleState;
    if (dist(b.self.x, b.self.y, w.x, w.y) < ARSENAL.issue.reach) {
      b.mover.stop();
      if (A.desk) turnTowards(b.self, Math.atan2(A.desk.y - b.self.y, A.desk.x - b.self.x), dt, 3);
      b.resupplyWait += dt;
      if (b.resupplyWait < ARSENAL.issue.every) return;
      const why = A.issue(b.self);
      if (why) b.self.say(b.ctx.rng.pick(ARSENAL.lines.refused), b.ctx.law.now, 2);
      return b.idleState;
    }
    if (b.mover.status === 'failed' || b.mover.status === 'idle') {
      const a = b.ctx.nav.nearestWalkable(w.x, w.y, 3);
      if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
    }
  },
};

/** Пост далеко (подкрепление из Цитадели) — к нему бегом. */
/** Где стоять часовому: на рейде — у лагеря, иначе — на своём посту. */
function postOf(b: CpBrain): Vec2 {
  return b.raidPost ?? b.guardPost!;
}

function guardSpeed(b: CpBrain): number {
  const p = postOf(b);
  return dist(b.self.x, b.self.y, p.x, p.y) > LAW.cpRunToPost ? LAW.cpRunSpeed : LAW.cpWalkSpeed;
}

const GUARD: State<CpBrain> = {
  name: 'guard',
  enter(b) {
    b.mover.speed = guardSpeed(b);
    const p = postOf(b);
    const a = b.ctx.nav.nearestWalkable(p.x, p.y, 3);
    if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
  },
  update(b, dt) {
    const p = postOf(b);
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
    if (b.fsm.time < LAW.checkTime * (cpHas(b.self, 'investigate') ? LAW.juryCheckMul : 1)) return;
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
    const cell = law.freeCell(b.self.x, b.self.y, t);
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
      b.ctx.law.unreserve(cell, t);
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
    // Задержанный отстал (затор, толпа) — ждём его, не уходя через полгорода вперёд.
    if (!atFront && dist(b.self.x, b.self.y, t.x, t.y) > LAW.escortWait) {
      if (st === 'moving' || st === 'pending') b.mover.stop();
      faceTowards(b.self, t.x, t.y, dt);
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

/**
 * Бой: из укрытия (ai/Tactics — за углом выглядывает на очередь, за блоком сидит), не отходя
 * далеко от поста или места, где начался бой; укрытия нет — стоит (часовой — на посту) и стреляет.
 */
const FIGHT: State<CpBrain> = {
  name: 'fight',
  enter(b) {
    b.mover.stop();
    b.fightHome = { x: b.self.x, y: b.self.y };
  },
  update(b, dt) {
    if (!b.gunner.target) return b.idleState;
    const gp = b.guardPost ? postOf(b) : null;
    if (b.tactics.fight(b.self, b.ctx, b.gunner, b.mover, dt, gp ?? b.fightHome, gp ? TACTICS.postLeash : TACTICS.leash)) return;
    // Отошёл от поста — вернуться на пост (там укрытие).
    if (gp && dist(b.self.x, b.self.y, gp.x, gp.y) > 24) {
      if (b.mover.status !== 'moving' && b.mover.status !== 'pending') {
        const a = b.ctx.nav.nearestWalkable(gp.x, gp.y, 3);
        if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
      }
    } else b.mover.stop();
  },
  exit(b) {
    b.tactics.reset(b.self);
    b.gunner.memory = 3;
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
    if (!p || !p.alive || (p.health >= p.maxHealth * 0.95 && p.bleed <= 0)) {
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
      return b.idleState;
    }
    const p = b.ctx.war.nearestKnown(b.self.x, b.self.y);
    if (!p) {
      b.huntSpot = -1;
      if (b.mover.status !== 'moving' && b.mover.status !== 'pending') {
        const a = randomAnchorAround(b.self, b.ctx, 10, 40, b.patrolAvoid);
        if (a >= 0) b.mover.goTo(b.self, b.ctx, a);
      }
      return;
    }
    b.sweep(p, dt);
  },
  exit(b) {
    b.huntSpot = -1;
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
      b.self.guarding = null;
      return b.idleState;
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

/**
 * Место преступления (CrimeScenes): следователь идёт к телу, осматривает CP_UNITS.obs.scanTime с
 * (убийца — в розыск) и уходит; офицер встаёт у ленты со стороны, откуда пришёл, лицом наружу, и
 * стоит, пока оцепление не снимут.
 */
const SCENE: State<CpBrain> = {
  name: 'scene',
  enter(b) {
    b.repath = 0;
    b.scanLeft = CP_UNITS.obs.scanTime;
    b.mover.speed = LAW.cpWalkSpeed * CRIME.scene.speed;
  },
  update(b, dt) {
    const s = b.scene;
    if (!s || s.closed) {
      b.scene = null;
      return b.idleState;
    }
    const { self, ctx } = b;
    if (b.sceneRole === 'investigate') {
      const c = s.corpse;
      if (dist(self.x, self.y, c.x, c.y) > CP_UNITS.obs.reach - 8) {
        b.goToPoint(c, dt, 2);
        return;
      }
      b.mover.stop();
      faceTowards(self, c.x, c.y, dt);
      if (b.scanLeft === CP_UNITS.obs.scanTime) self.say(ctx.rng.pick(CRIME.scene.lines.investigate), ctx.law.now, 2.5);
      if ((b.scanLeft -= dt) <= 0) {
        if (!c.scanned) ctx.crime.investigate(c, self);
        ctx.war.scenes.investigated(s);
        b.scene = null;
        return b.idleState;
      }
      return;
    }
    // Офицер: место у ленты со своей стороны.
    if (!b.sceneSpot) {
      const dx = self.x - s.x;
      const dy = self.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const a = ctx.nav.nearestWalkable(s.x + (dx / d) * (s.r - 8), s.y + (dy / d) * (s.r - 8), 4);
      b.sceneSpot = a >= 0 ? { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) } : { x: s.x, y: s.y };
    }
    const p = b.sceneSpot;
    if (dist(self.x, self.y, p.x, p.y) > 18) {
      b.goToPoint(p, dt, 2);
      return;
    }
    b.mover.stop();
    if (!b.dutyArrived) {
      b.dutyArrived = true;
      self.say(ctx.rng.pick(CRIME.scene.lines.guard), ctx.law.now, 3);
    }
    turnTowards(self, Math.atan2(self.y - s.y, self.x - s.x), dt, 2);
  },
  exit(b) {
    b.mover.speed = LAW.cpWalkSpeed;
    b.dutyArrived = false;
  },
};

/** Ведомый патрульной группы: держится за ведущим, вместе с ним осматривается и вмешивается. */
const FOLLOW: State<CpBrain> = {
  name: 'follow',
  enter(b) {
    b.repath = 0;
    b.mover.speed = LAW.cpWalkSpeed;
  },
  update(b, dt) {
    const l = b.leader();
    if (!l) return 'patrol';
    if (b.ctx.war && b.shouldHunt()) return 'hunt';
    // Колонной: след в след за ведущим, каждый на своём месте.
    followColumn(b.self, b.ctx, b.mover, l, b.columnIndex(l), dt, b.column);
  },
};

/** Служба: дойти до точки (обход инспектора, офицера; кабинет), постоять, сказать реплику, дальше. */
const DUTY: State<CpBrain> = {
  name: 'duty',
  enter(b) {
    b.mover.speed = LAW.cpWalkSpeed;
    b.repath = 0;
    if (!b.dutySpot || b.ctx.law.now >= b.dutyUntil) b.nextDuty();
  },
  update(b, dt) {
    const now = b.ctx.law.now;
    const p = b.dutySpot;
    if (!p) {
      b.nextDuty();
      return;
    }
    if (dist(b.self.x, b.self.y, p.x, p.y) < 26) {
      b.mover.stop();
      if (!b.dutyArrived) {
        b.dutyArrived = true;
        if (b.dutyLine) b.self.say(b.dutyLine, now, 3);
      }
      turnTowards(b.self, b.dutyFacing, dt, 2);
      if (b.ctx.rng.chance(dt * 0.3)) b.dutyFacing = b.ctx.rng.range(0, Math.PI * 2);
    } else b.goToPoint(p, dt, 2);
    if (now >= b.dutyUntil) b.nextDuty();
  },
};

/** Построение на плацу: дойти до своего места в строю и стоять, пока Security не распустит. */
const FORMATION: State<CpBrain> = {
  name: 'formation',
  enter(b) {
    b.mover.speed = CHARACTER.runSpeed * 0.8;
    b.repath = 0;
  },
  update(b, dt) {
    const f = b.formation;
    if (!f) return b.idleState;
    if (dist(b.self.x, b.self.y, f.x, f.y) < 12) {
      b.mover.stop();
      turnTowards(b.self, f.facing, dt, 4);
    } else b.goToPoint(f, dt, 1.5);
  },
  exit(b) {
    b.mover.speed = LAW.cpWalkSpeed;
  },
};
