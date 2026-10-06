import type { AiContext } from '../ai/AiContext';
import type { Brain } from '../ai/Brain';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import { Mover } from '../ai/Mover';
import { Gunner } from '../ai/Gunner';
import { faceMovement } from '../ai/facing';
import { canSeeCircle } from '../world/visibility';
import { createCharacter } from '../entities/factory';
import { equipKit } from './Population';
import { roleHp } from './Roster';
import { ARENA, type ArenaSide, type ArenaUnit } from '../config/arena';
import { CHARACTER } from '../config/entities';
import { CP_UNIT, rebelUnitOf } from '../config/factions';
import { Tactician, followColumn, watchSector } from '../ai/Tactics';
import { resetMelee } from '../entities/meleeState';

/**
 * Боец арены: враг на виду или недавно видели — бой из укрытия (угол, блок; ai/Tactics), свой
 * тяжело ранен — оттащить и поднять; иначе отряд идёт колонной за ведущим (первый боеспособный
 * NPC), ведущий — перекатами к месту, где видели врага, или к его базе.
 */
class ArenaBrain implements Brain {
  readonly mover = new Mover(CHARACTER.walkSpeed);
  readonly gunner: Gunner;
  readonly tactics = new Tactician();
  private readonly column = { repath: 0 };
  private phase: 'advance' | 'hold' = 'advance';
  private phaseLeft = 0;
  private goal: Vec2 | null = null;

  constructor(private readonly arena: SquadArena, readonly side: ArenaSide, ctx: AiContext) {
    this.gunner = new Gunner(ctx.rng);
  }

  get stateName(): string {
    const tac = this.tactics.label;
    return this.gunner.target ? `арена · бой${tac ? ` · ${tac}` : ''}` : tac ? `арена · ${tac}` : `арена · ${this.phase === 'advance' ? 'вперёд' : 'держит'}`;
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    const fighting = this.gunner.update(self, ctx, dt);
    const t = this.gunner.target;
    if (t && !t.downed) this.arena.spotted(this.side, t);
    const lead = this.arena.pointman(this.side);
    let column = false;
    if (ctx.combat.bandaging(self)) this.mover.stop();
    else if (!(fighting && t) && this.tactics.rescue(self, ctx, this.gunner, this.mover, dt)) {
      // Поднимает своего.
    } else if (fighting && t) {
      // Бой из укрытия; укрытия нет — враг на виду: стоит и стреляет (прицел сужается стоя).
      if (!this.tactics.fight(self, ctx, this.gunner, this.mover, dt) && canSeeCircle(ctx.map, self.x, self.y, t.x, t.y, t.radius)) this.mover.stop();
    } else if (lead && lead !== self) {
      if (this.tactics.mode !== 'none') {
        this.tactics.reset(self);
        this.gunner.memory = 3;
      }
      column = true;
      followColumn(self, ctx, this.mover, lead, this.arena.columnIndex(this.side, self), dt, this.column);
    } else {
      if (this.tactics.mode !== 'none') {
        this.tactics.reset(self);
        this.gunner.memory = 3;
      }
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) {
        this.phase = this.phase === 'advance' ? 'hold' : 'advance';
        const [a, b] = this.phase === 'advance' ? ARENA.advance : ARENA.hold;
        this.phaseLeft = ctx.rng.range(a, b);
        if (this.phase === 'advance') this.goal = null;
      }
      if (this.phase === 'hold') this.mover.stop();
      else if (!this.goal || this.mover.status === 'idle' || this.mover.status === 'failed' || this.mover.status === 'arrived') {
        // К месту, где видели врага, или к его базе — с разбросом, чтобы не толпой.
        const to = this.arena.objective(this.side);
        const a = ctx.nav.nearestWalkable(to.x + ctx.rng.range(-ARENA.spread, ARENA.spread), to.y + ctx.rng.range(-ARENA.spread, ARENA.spread), 6);
        if (a >= 0) {
          this.goal = { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
          this.mover.goTo(self, ctx, a);
        }
      }
    }
    this.mover.update(self, ctx, dt);
    if (this.gunner.look(self, ctx, dt) || this.tactics.face(self, dt)) return;
    if (column && lead && self.moveSpeed < 8) {
      const k = this.arena.columnIndex(this.side, self);
      watchSector(self, lead, k, k >= this.arena.fitCount(this.side) - 1, dt);
    } else faceMovement(self, ctx, dt);
  }
}

/**
 * Экспериментальный режим «отряд на отряд» (config/arena.ts): два отряда на пограничном КПП,
 * раунды до гибели одной стороны (или по таймеру — у кого живых больше), счёт, пауза и заново.
 * Игрок — боец своего отряда. Город вокруг пуст (Game не запускает войну, подполье, жителей).
 */
export class SquadArena {
  readonly score: Record<ArenaSide, number> = { combine: 0, rebel: 0 };
  round = 0;
  /** Идёт раунд (false — пауза между раундами). */
  live = false;
  timer = 0;
  readonly members: Record<ArenaSide, Character[]> = { combine: [], rebel: [] };
  private readonly seen: Record<ArenaSide, { x: number; y: number; t: number } | null> = { combine: null, rebel: null };
  readonly bases: Record<ArenaSide, Vec2[]>;
  lastWinner: ArenaSide | 'draw' | null = null;

  constructor(private readonly ctx: AiContext, readonly playerSide: ArenaSide, private readonly player: Character | null) {
    const f = ctx.war.fronts[Math.min(ARENA.front, ctx.war.fronts.length - 1)];
    const nav = ctx.nav;
    const at = (a: number) => ({ x: nav.worldX(a), y: nav.worldY(a) });
    const inner = f.points[f.points.length - 1].floor;
    // Протекторат — в глубине внутреннего двора (дальше от входа), сопротивление — на пустоши.
    const deep = inner.slice(Math.floor(inner.length * 0.6));
    this.bases = {
      combine: (deep.length ? deep : inner).map(at),
      rebel: f.outlands.map(at),
    };
  }

  /** Отряд видел врага здесь. */
  spotted(side: ArenaSide, t: Character): void {
    this.seen[side] = { x: t.x, y: t.y, t: this.ctx.combat.now };
  }

  /** Куда идти отряду: где недавно видели врага, иначе к его базе. */
  objective(side: ArenaSide): Vec2 {
    const s = this.seen[side];
    if (s && this.ctx.combat.now - s.t < ARENA.memory) return s;
    const other = side === 'combine' ? 'rebel' : 'combine';
    const b = this.bases[other];
    return b[Math.floor(b.length / 2)] ?? { x: 0, y: 0 };
  }

  private spawnPoint(side: ArenaSide, k: number): Vec2 {
    const b = this.bases[side];
    return b[(k * 7 + this.round * 3) % b.length];
  }

  /** Новый раунд: убрать бойцов прошлого, тела и следы; поставить отряды на базы. */
  startRound(): void {
    const { ctx } = this;
    this.round++;
    for (const side of ['combine', 'rebel'] as const) {
      for (const c of this.members[side]) if (!c.isPlayer && ctx.entities.list.includes(c)) ctx.entities.remove(c);
      this.members[side] = [];
      this.seen[side] = null;
    }
    ctx.combat.corpses.length = 0;
    ctx.combat.bullets.length = 0;
    ctx.combat.grenades.length = 0;
    ctx.combat.mines.length = 0;
    ctx.combat.melee.clear();
    for (const side of ['combine', 'rebel'] as const) {
      const units = ARENA.teams[side] as readonly ArenaUnit[];
      units.forEach((u, k) => {
        const p = this.spawnPoint(side, k);
        const mine = side === this.playerSide && k === 0 && this.player;
        const c = mine ? this.player! : this.spawn(u, p, side);
        if (mine) this.dress(c, u, p);
        this.members[side].push(c);
      });
    }
    this.live = true;
    this.timer = ARENA.roundTime;
    this.lastWinner = null;
    ctx.bus.emit('log', { text: `Раунд ${this.round}: ${ARENA.sideNames.combine} ${this.score.combine} : ${this.score.rebel} ${ARENA.sideNames.rebel}. В бой!`, kind: 'system' });
  }

  private rankOf(u: ArenaUnit): number {
    if (u.cpUnit) return CP_UNIT[u.cpUnit];
    return rebelUnitOf(u.profession)?.rank ?? 0;
  }

  private spawn(u: ArenaUnit, p: Vec2, side: ArenaSide): Character {
    const c = createCharacter(this.ctx.entities, this.ctx.rng, u.faction, p.x, p.y, false, this.rankOf(u));
    this.dress(c, u, p);
    c.brain = new ArenaBrain(this, side, this.ctx);
    return c;
  }

  /** Снарядить бойца (и игрока) по юниту: фракция, ранг, здоровье, набор, место. */
  private dress(c: Character, u: ArenaUnit, p: Vec2): void {
    c.faction = u.faction;
    c.rank = this.rankOf(u);
    c.profession = u.profession;
    c.maxHealth = c.health = roleHp(u.faction, c.rank, u.profession) ?? CHARACTER.maxHealth;
    c.alive = true;
    c.bleed = 0;
    c.limpUntil = c.armUntil = c.bandageUntil = 0;
    c.burnUntil = 0;
    c.downedUntil = 0;
    c.suppress = 0;
    c.crouch = false;
    c.reviveUntil = 0;
    c.reviving = null;
    c.dragging = c.draggedBy = null;
    resetMelee(c.melee);
    c.hostile = u.faction === 'rebel';
    c.disguised = false;
    c.cover = null;
    c.x = c.prevX = p.x;
    c.y = c.prevY = p.y;
    c.vx = c.vy = c.wantX = c.wantY = 0;
    c.facing = u.faction === 'rebel' ? 0 : Math.PI;
    equipKit(c, u.kit, this.ctx);
  }

  /** Сколько бойцов стороны в строю (тяжелораненые — не в счёт: им уже не воевать). */
  alive(side: ArenaSide): number {
    return this.members[side].filter((c) => c.fit).length;
  }

  /** Сколько боеспособных NPC в отряде (колонна; игрок идёт сам по себе). */
  fitCount(side: ArenaSide): number {
    return this.members[side].filter((c) => c.fit && !c.isPlayer).length;
  }

  /** Ведущий колонны отряда: первый боеспособный NPC. */
  pointman(side: ArenaSide): Character | null {
    return this.members[side].find((c) => c.fit && !c.isPlayer) ?? null;
  }

  /** Место бойца в колонне за ведущим (1 — сразу за ним). */
  columnIndex(side: ArenaSide, c: Character): number {
    let k = 0;
    for (const m of this.members[side]) {
      if (!m.fit || m.isPlayer) continue;
      if (m === c) return Math.max(1, k);
      k++;
    }
    return 1;
  }

  update(dt: number): void {
    if (!this.live) {
      this.timer -= dt;
      if (this.timer <= 0) this.startRound();
      return;
    }
    this.timer -= dt;
    const a = this.alive('combine');
    const b = this.alive('rebel');
    if (a > 0 && b > 0 && this.timer > 0) return;
    const winner: ArenaSide | 'draw' = a === b ? 'draw' : a > b ? 'combine' : 'rebel';
    if (winner !== 'draw') this.score[winner]++;
    this.lastWinner = winner;
    this.live = false;
    this.timer = ARENA.breakTime;
    const text = winner === 'draw' ? `Раунд ${this.round}: ничья.` : `Раунд ${this.round}: победа — ${ARENA.sideNames[winner]}. Счёт ${this.score.combine} : ${this.score.rebel}.`;
    this.ctx.bus.emit('log', { text, kind: 'system' });
    this.ctx.bus.emit('announce', { text });
  }
}
