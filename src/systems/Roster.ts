import type { AiContext } from '../ai/AiContext';
import type { Brain } from '../ai/Brain';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { DivisionId, FactionId } from '../config/factions';
import type { ProfessionId } from '../config/professions';
import { ROSTER } from '../config/roster';
import { AI } from '../config/ai';
import { WAR } from '../config/war';
import { createCharacter } from '../entities/factory';
import { equipKit, poiWorld } from './Population';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { OtaBrain } from '../ai/brains/OtaBrain';
import { cpUnit, rebelUnitOf, type FactionId as Fid } from '../config/factions';
import { RebelBrain } from '../ai/brains/RebelBrain';
import { UndergroundBrain } from '../ai/brains/UndergroundBrain';
import { PostBrain } from '../ai/brains/PostBrain';
import { AgentBrain } from '../ai/brains/AgentBrain';
import { randomAnchorAround, randomAnchorInZone } from '../ai/destinations';
import type { AccessSite } from '../config/access';
import { CadetBrain } from '../ai/brains/CadetBrain';

/** Вид роли — от него зависят спавн, мозг и время возрождения. */
export type RoleKind =
  | 'citizen' | 'cwu' | 'vort'
  | 'patrol' | 'guard' | 'gate' | 'medic' | 'ota'
  | 'post' | 'squad' | 'tech' | 'officer' | 'inspector' | 'bodyguard' | 'epu'
  | 'army' | 'leader' | 'hydra' | 'partisan' | 'agent'
  | 'trader' | 'admin'
  /** Склад Протектората: кладовщик SU.QM у стола выдачи и охрана SU.GUARD на постах. */
  | 'qm' | 'depot'
  /** Экипаж конвоя склада (ВС): носит ящики на пункты боепитания КПП и Управы. */
  | 'convoy'
  /** Тюрьма Протектората: охрана SU.GUARD на постах и начальник — третий инспектор SU.INSP. */
  | 'jailer' | 'warden'
  /** Боец или авторитет банды (живут в общаге банды). */
  | 'gang'
  /** Академия ВС: курсант, инструктор, выпускник в резерве (дневальный академии). */
  | 'cadet' | 'instructor' | 'reserve';

/**
 * Роль персонажа в постоянном составе (как игрок на сервере): кто он, с каким набором, и — у
 * часовых КПП — какой пост держит. По ней персонаж появляется снова после гибели.
 */
export interface RoleSpec {
  kind: RoleKind;
  faction: FactionId;
  profession: ProfessionId | null;
  division: DivisionId | null;
  rank: number;
  kit: string;
  name?: string;
  loyalty?: number;
  /** Семья жителя (возрождается в ней же). */
  family?: number;
  /** Свой дом (Housing) — возрождается там же. */
  home?: number;
  /** Банда (Gangs). */
  gang?: number;
  /** Номер человека (Character.pid): возрождённый — тот же, по нему помнят знакомства и характер. */
  pid?: number;
  /** Часовой / RCT проходной / медик КПП: фронт, пост и взгляд, место медика. */
  front?: number;
  post?: Vec2;
  facing?: number;
  station?: Vec2;
  /** Патрульная группа ВС: номер и ведущий ли. */
  squad?: number;
  lead?: boolean;
  /** Вахтёр режимного объекта (Access): какой объект охраняет. */
  access?: AccessSite;
}

/** Здоровье роли: ВС — по юниту, сопротивление — по юниту из профессии, остальные — ROSTER.hp. */
export function roleHp(faction: Fid, rank: number, profession: ProfessionId | null | undefined): number | undefined {
  if (faction === 'cp') return cpUnit(rank).hp;
  if (faction === 'rebel') return rebelUnitOf(profession)?.def.hp;
  return profession ? ROSTER.hp[profession] : undefined;
}

/** Точка рядом с p (радиус в якорях), проходимая, на уровне p. */
function spotNear(ctx: AiContext, p: Vec2, rMax: number): Vec2 | null {
  const a = randomAnchorAround(p, ctx, 0, rMax, new Set());
  const b = a >= 0 ? a : ctx.nav.nearestWalkable(p.x, p.y, 8);
  return b >= 0 ? { x: ctx.nav.worldX(b), y: ctx.nav.worldY(b) } : null;
}

function inZone(ctx: AiContext, kind: Parameters<typeof randomAnchorInZone>[1]): Vec2 | null {
  const a = randomAnchorInZone(ctx, kind);
  return a >= 0 ? { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) } : null;
}

/** Где появляется роль после гибели: ВС и OTA — ГЭС, армия — лагерь, партизаны — схрон… */
export function respawnPoint(ctx: AiContext, spec: RoleSpec): Vec2 | null {
  // Жители — у себя дома (подполье — в схроне, явка только для добычи).
  const home = spec.home !== undefined && (spec.kind === 'citizen' || spec.kind === 'cwu' || spec.kind === 'vort' || spec.kind === 'gang') ? ctx.housing?.dwellings[spec.home] : undefined;
  if (home) return ctx.rng.pick(home.spots);
  switch (spec.kind) {
    case 'patrol':
    case 'guard':
    case 'gate':
    case 'medic':
    case 'post':
    case 'squad':
    case 'tech':
    case 'officer':
    case 'inspector':
    case 'bodyguard':
    case 'qm':
    case 'depot':
    case 'convoy':
    case 'jailer':
    case 'warden':
    case 'instructor':
    case 'reserve':
    case 'epu': {
      // ВС — из казармы Управы (нары), нет казармы — у ворот.
      const n = ctx.map.poisOf('bunk').length;
      const p = n ? poiWorld(ctx, 'bunk', Math.floor(ctx.rng.next() * n)) : poiWorld(ctx, 'nexus_gate');
      return p ? spotNear(ctx, p, 2) : null;
    }
    case 'ota': {
      const n = ctx.map.poisOf('ota_spot').length;
      const p = n ? poiWorld(ctx, 'ota_spot', Math.floor(ctx.rng.next() * n)) : poiWorld(ctx, 'nexus_gate');
      return p ? spotNear(ctx, p, 2) : null;
    }
    case 'army':
    case 'leader':
    case 'hydra':
      return inZone(ctx, 'rebel_camp') ?? poiWorld(ctx, 'rebel_camp');
    case 'partisan':
    case 'agent':
      return inZone(ctx, 'rebel_base');
    case 'trader': {
      const t = ctx.fence?.spot ?? poiWorld(ctx, 'trader');
      return t ? spotNear(ctx, t, 0) : null;
    }
    case 'cadet': {
      const k = ctx.academy?.barracks;
      return k ? spotNear(ctx, k, 3) : inZone(ctx, 'academy');
    }
    case 'cwu': {
      const plaza = poiWorld(ctx, 'plaza_center');
      return plaza ? spotNear(ctx, plaza, 20) : inZone(ctx, 'residential');
    }
    default:
      return inZone(ctx, 'residential');
  }
}

/** Создать персонажа по роли в точке at (по умолчанию — точка возрождения роли). */
export function spawnRole(ctx: AiContext, spec: RoleSpec, at: Vec2 | null = null): Character | null {
  const p = at ?? respawnPoint(ctx, spec);
  if (!p) return null;
  const c = createCharacter(ctx.entities, ctx.rng, spec.faction, p.x, p.y, false, spec.rank);
  if (spec.name) c.name = spec.name;
  c.profession = spec.profession;
  c.division = spec.division;
  if (spec.loyalty !== undefined) c.loyalty = spec.loyalty;
  if (spec.family !== undefined) c.family = spec.family;
  if (spec.home !== undefined) c.home = spec.home;
  if (spec.gang !== undefined) c.gang = spec.gang;
  c.facing = spec.facing ?? ctx.rng.range(0, Math.PI * 2);
  c.hunger = ctx.rng.range(40, 100);
  equipKit(c, spec.kit, ctx);
  // Жители оружие на виду не носят (бандит достаёт ствол только для грабежа).
  if (spec.kind === 'citizen' || spec.kind === 'cwu' || spec.kind === 'vort' || spec.kind === 'trader' || spec.kind === 'gang') ctx.combat.equip(c, null);
  // ВС — здоровье по юниту (RCT.PCU 75 … CMD.EPU 200), остальные — по профессии.
  const hp = roleHp(spec.faction, spec.rank, spec.profession);
  if (hp) c.maxHealth = c.health = hp;
  if (spec.faction === 'cp') c.division = cpUnit(spec.rank).group;
  // Грузчики и оружейник склада Протектората — с допуском: документы всегда в порядке.
  if (spec.profession === 'loader' || spec.profession === 'armorer') c.law.hasCid = true;
  // Тот же человек после возрождения: номер прежний (знакомства, мнение, характер), воспоминания о смерти забыты.
  if (spec.pid !== undefined) c.pid = spec.pid;
  c.role = { ...spec, name: c.name, pid: c.pid };
  ctx.relations?.register(c, spec.pid !== undefined);
  c.brain = brainFor(ctx, c, spec);
  // Силовой блок — в штатное расписание (должность; погиб — вакансия, её займёт младший по званию).
  if (spec.faction === 'cp') ctx.staffing?.adopt(c);
  return c;
}

/**
 * Мозг по роли (и побочные дела: OTA — в резерв войны, армия — в командование, подполье — в схрон).
 * Вызывается при появлении и при назначении на новую должность (Staffing).
 */
export function brainFor(ctx: AiContext, c: Character, spec: RoleSpec): Brain {
  let brain: Brain;
  switch (spec.kind) {
    case 'patrol':
    case 'tech':
      brain = new CpBrain(c, ctx);
      break;
    case 'post':
      brain = new CpBrain(c, ctx, { post: spec.post, facing: spec.facing, duty: 'post' });
      break;
    case 'depot':
      brain = new CpBrain(c, ctx, { post: spec.post, facing: spec.facing, duty: 'sentry' });
      break;
    case 'convoy':
      brain = new CpBrain(c, ctx, { post: spec.post, facing: spec.facing, duty: 'convoy' });
      break;
    case 'jailer':
      brain = new CpBrain(c, ctx, { post: spec.post, facing: spec.facing, duty: 'jailer' });
      break;
    case 'warden':
      brain = new CpBrain(c, ctx, { duty: 'warden' });
      break;
    case 'qm':
      brain = new CpBrain(c, ctx, { post: spec.post, facing: spec.facing, duty: 'qm' });
      break;
    case 'squad':
      brain = new CpBrain(c, ctx, { duty: 'squad', squad: spec.squad, lead: spec.lead });
      break;
    case 'officer':
    case 'inspector':
    case 'bodyguard':
    case 'epu':
    case 'instructor':
      brain = new CpBrain(c, ctx, { duty: spec.kind });
      break;
    case 'reserve':
      brain = new CpBrain(c, ctx, { post: spec.post, facing: spec.facing, duty: 'post' });
      break;
    case 'cadet':
      brain = new CadetBrain(c, ctx);
      break;
    case 'guard':
    case 'gate':
      brain = new CpBrain(c, ctx, { front: spec.front, post: spec.post, facing: spec.facing });
      break;
    case 'medic':
      brain = new CpBrain(c, ctx, { front: spec.front, medicStation: spec.station });
      break;
    case 'ota':
      brain = c.brain = new OtaBrain(c, ctx);
      if (!ctx.war.ota.includes(c)) ctx.war.ota.push(c);
      break;
    case 'army':
    case 'leader':
    case 'hydra':
      brain = c.brain = new RebelBrain(c, ctx, ctx.war.command.target, Infinity);
      (brain as RebelBrain).toCamp();
      ctx.war.command.join(c);
      break;
    case 'partisan':
      brain = c.brain = new UndergroundBrain(c, ctx);
      ctx.insurgency.adopt(c);
      break;
    case 'agent':
      brain = c.brain = new AgentBrain(c, ctx);
      ctx.insurgency.adoptAgent(c);
      break;
    case 'trader': {
      const counter = ctx.insurgency.market;
      brain = new PostBrain({ x: c.x, y: c.y }, counter ? Math.atan2(counter.y - c.y, counter.x - c.x) : 0);
      ctx.insurgency.trader = c;
      if (ctx.fence) ctx.fence.trader = c;
      break;
    }
    case 'admin': {
      brain = new PostBrain({ x: c.x, y: c.y }, c.facing);
      break;
    }
    default:
      brain = new CitizenBrain(c, ctx);
  }
  return brain;
}

/** Новый житель города (приток): гражданин в жилом квартале, со своим домом. */
export function newcomer(ctx: AiContext): Character | null {
  const P = AI.population;
  const loyal = ctx.rng.chance(P.loyalistShare);
  const loyalty = Math.round(loyal ? ctx.rng.range(P.loyalistLoyalty[0], P.loyalistLoyalty[1]) : ctx.rng.range(0, 30));
  const spec: RoleSpec = { kind: 'citizen', faction: 'citizen', profession: 'citizen', division: null, rank: 0, kit: 'citizen', loyalty };
  const c = spawnRole(ctx, spec);
  if (!c) return null;
  c.loyalty = loyalty;
  const d = ctx.housing?.house(c, null);
  if (d && c.role) c.role.home = c.home;
  return c;
}

/** Время возрождения роли, с. */
function respawnDelay(spec: RoleSpec): number {
  const R = ROSTER.respawn;
  return spec.kind === 'admin' ? Infinity : (R as Record<string, number>)[spec.kind] ?? R.citizen;
}

/**
 * Постоянный состав: погибший NPC (с ролью) появляется снова через ROSTER.respawn секунд на спавне
 * своей стороны. Комендант не возрождается — его место занимает победитель выборов. Силовой блок (ВС,
 * курсанты) не возрождается — должности занимают по штатному расписанию (Staffing), RCT — выпускники
 * академии. Город пополняется новыми жителями (inflow), когда граждан меньше, чем было в начале.
 */
export class RosterSystem {
  private readonly queue: { spec: RoleSpec; at: number }[] = [];
  private time = 0;
  /** Сколько возрождений было (для тестов и отладки). */
  respawned = 0;
  /** Сколько граждан было при заселении (приток держит их число) и сколько приехало новых. */
  baseline = 0;
  arrived = 0;
  private nextInflow: number = ROSTER.inflow.every;
  /** Без возрождений (тесты). */
  paused = false;

  constructor(private readonly ctx: AiContext) {
    ctx.combat.deathListeners.push((c) => this.onDeath(c));
  }

  get now(): number {
    return this.time;
  }

  /** Сколько ждут возрождения (всего или по виду роли). */
  pending(kind?: RoleKind): number {
    return kind ? this.queue.filter((q) => q.spec.kind === kind).length : this.queue.length;
  }

  private onDeath(c: Character): void {
    // Силовой блок не возрождается: должность пустеет, её занимают по штатному расписанию (Staffing).
    if (c.isPlayer || !c.role || c.faction === 'cp') return;
    const spec: RoleSpec = { ...c.role, name: c.name, loyalty: c.loyalty };
    const delay = respawnDelay(spec);
    if (Number.isFinite(delay)) this.queue.push({ spec, at: this.time + delay });
  }

  /** Граждан меньше, чем было, — приезжает новый житель. */
  private inflow(): void {
    if (this.baseline <= 0) return;
    const now = this.ctx.entities.list.filter((c) => c.alive && !c.isPlayer && c.faction === 'citizen' && c.role?.kind === 'citizen').length + this.pending('citizen');
    if (now >= this.baseline) return;
    const c = newcomer(this.ctx);
    if (!c) return;
    this.arrived++;
    this.ctx.law.log(`В город по распределению прибыл новый житель: ${c.name}.`, 'world');
  }

  update(dt: number): void {
    this.time += dt;
    if (this.paused) return;
    // Красный код (штурм Управы): никто не возрождается — ни ВС, ни OTA, ни повстанцы, ни жители.
    if (this.ctx.war.code === 'red') return;
    if (this.time >= this.nextInflow) {
      this.nextInflow = this.time + ROSTER.inflow.every;
      this.inflow();
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (this.time < q.at) continue;
      // Штурм Управы (идёт волна повстанцев) — ВС и OTA с ГЭС не выходят, как в капте; Управа
      // пал — выходят снова, отбивать его.
      const combine = q.spec.faction === 'cp' || q.spec.faction === 'ota';
      const nexus = this.ctx.war.nexus;
      if (combine && nexus.wave && !nexus.fallen) {
        q.at = this.time + 2;
        continue;
      }
      // Во время капта часовые и медики этого КПП ждут на ГЭС (если подкрепления в капте запрещены).
      const f = q.spec.front !== undefined ? this.ctx.war.fronts[q.spec.front] : null;
      if (f?.capture && !WAR.capture.reinforce && (q.spec.kind === 'guard' || q.spec.kind === 'medic')) {
        q.at = this.time + 2;
        continue;
      }
      this.queue.splice(i, 1);
      const c = spawnRole(this.ctx, q.spec);
      // ВС и OTA с ГЭС — с набором со склада (пусто — патронов по минимуму).
      if (c && (c.faction === 'cp' || c.faction === 'ota')) this.ctx.arsenal?.kitOnRespawn(c);
      if (c) this.respawned++;
      else this.queue.push({ spec: q.spec, at: this.time + 5 });
    }
  }
}
