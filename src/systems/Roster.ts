import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { DivisionId, FactionId } from '../config/factions';
import type { ProfessionId } from '../config/professions';
import { ROSTER } from '../config/roster';
import { createCharacter } from '../entities/factory';
import { equipKit, poiWorld } from './Population';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { OtaBrain } from '../ai/brains/OtaBrain';
import { RebelBrain } from '../ai/brains/RebelBrain';
import { UndergroundBrain } from '../ai/brains/UndergroundBrain';
import { PostBrain } from '../ai/brains/PostBrain';
import { randomAnchorAround, randomAnchorInZone } from '../ai/destinations';

/** Вид роли — от него зависят спавн, мозг и время возрождения. */
export type RoleKind =
  | 'citizen' | 'cwu' | 'vort'
  | 'patrol' | 'guard' | 'medic' | 'ota'
  | 'army' | 'leader' | 'hydra' | 'partisan'
  | 'trader' | 'admin';

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
  /** Часовой / медик КПП: фронт, пост и взгляд, место медика. */
  front?: number;
  post?: Vec2;
  facing?: number;
  station?: Vec2;
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

/** Где появляется роль после гибели: ГО и OTA — Цитадель, армия — лагерь, партизаны — схрон… */
export function respawnPoint(ctx: AiContext, spec: RoleSpec): Vec2 | null {
  switch (spec.kind) {
    case 'patrol':
    case 'guard':
    case 'medic':
    case 'ota': {
      const gate = poiWorld(ctx, 'nexus_gate');
      return gate ? spotNear(ctx, gate, 3) : null;
    }
    case 'army':
    case 'leader':
    case 'hydra':
      return inZone(ctx, 'rebel_camp') ?? poiWorld(ctx, 'rebel_camp');
    case 'partisan':
      return inZone(ctx, 'rebel_base');
    case 'trader': {
      const t = poiWorld(ctx, 'trader');
      return t ? spotNear(ctx, t, 0) : null;
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
  c.facing = spec.facing ?? ctx.rng.range(0, Math.PI * 2);
  c.hunger = ctx.rng.range(40, 100);
  equipKit(c, spec.kit, ctx);
  // Жители оружие на виду не носят (бандит достаёт ствол только для грабежа).
  if (spec.kind === 'citizen' || spec.kind === 'cwu' || spec.kind === 'vort' || spec.kind === 'trader') ctx.combat.equip(c, null);
  const hp = spec.profession ? ROSTER.hp[spec.profession] : undefined;
  if (hp) c.maxHealth = c.health = hp;
  c.role = { ...spec, name: c.name };
  switch (spec.kind) {
    case 'patrol':
      c.brain = new CpBrain(c, ctx);
      break;
    case 'guard':
      c.brain = new CpBrain(c, ctx, { front: spec.front, post: spec.post, facing: spec.facing });
      break;
    case 'medic':
      c.brain = new CpBrain(c, ctx, { front: spec.front, medicStation: spec.station });
      break;
    case 'ota':
      c.brain = new OtaBrain(c, ctx);
      ctx.war.ota.push(c);
      break;
    case 'army':
    case 'leader':
    case 'hydra':
      c.brain = new RebelBrain(c, ctx, ctx.war.command.target, Infinity);
      (c.brain as RebelBrain).toCamp();
      ctx.war.command.join(c);
      break;
    case 'partisan':
      c.brain = new UndergroundBrain(c, ctx);
      ctx.insurgency.adopt(c);
      break;
    case 'trader': {
      const counter = ctx.insurgency.market;
      c.brain = new PostBrain({ x: c.x, y: c.y }, counter ? Math.atan2(counter.y - c.y, counter.x - c.x) : 0);
      ctx.insurgency.trader = c;
      break;
    }
    case 'admin': {
      c.brain = new PostBrain({ x: c.x, y: c.y }, c.facing);
      break;
    }
    default:
      c.brain = new CitizenBrain(c, ctx);
  }
  return c;
}

/** Время возрождения роли, с. */
function respawnDelay(spec: RoleSpec): number {
  const R = ROSTER.respawn;
  return spec.kind === 'admin' ? Infinity : R[spec.kind] ?? R.citizen;
}

/**
 * Постоянный состав: погибший NPC (с ролью) появляется снова через ROSTER.respawn секунд на спавне
 * своей стороны. Администратор не возрождается — его место занимает победитель выборов. Часовые КПП,
 * где идёт капт, ждут в Цитадели его конца (во время капта подкреплений нет).
 */
export class RosterSystem {
  private readonly queue: { spec: RoleSpec; at: number }[] = [];
  private time = 0;
  /** Сколько возрождений было (для тестов и отладки). */
  respawned = 0;
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
    if (c.isPlayer || !c.role) return;
    const spec: RoleSpec = { ...c.role, name: c.name, loyalty: c.loyalty };
    const delay = respawnDelay(spec);
    if (Number.isFinite(delay)) this.queue.push({ spec, at: this.time + delay });
  }

  update(dt: number): void {
    this.time += dt;
    if (this.paused) return;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (this.time < q.at) continue;
      // Во время капта часовые и медики этого КПП ждут в Цитадели.
      const f = q.spec.front !== undefined ? this.ctx.war.fronts[q.spec.front] : null;
      if (f?.capture && (q.spec.kind === 'guard' || q.spec.kind === 'medic')) {
        q.at = this.time + 2;
        continue;
      }
      this.queue.splice(i, 1);
      const c = spawnRole(this.ctx, q.spec);
      if (c) this.respawned++;
      else this.queue.push({ spec: q.spec, at: this.time + 5 });
    }
  }
}
