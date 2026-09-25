import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { Vec2 } from '../core/math';
import { INSURGENCY } from '../config/underground';
import { createCharacter } from '../entities/factory';
import { equipKit, poiWorld } from './Population';
import { UndergroundBrain } from '../ai/brains/UndergroundBrain';
import { PostBrain } from '../ai/brains/PostBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { randomAnchorInZone, zoneIds } from '../ai/destinations';

/** Текущая операция сопротивления в городе. */
export interface Operation {
  kind: 'sabotage' | 'ambush';
  team: Character[];
  where: string;
}

/**
 * Сопротивление под городом: убежище в канализации с гарнизоном (пополняется), торговец чёрного
 * рынка, операции в городе через люки — саботаж узлов Альянса и засады на патрули ГО. Бойцы
 * операции в городе — «нападавшие» для тревоги (WarSystem.operatives); ушли под землю — след потерян.
 */
export class InsurgencySystem {
  readonly base: Vec2 | null;
  readonly cache: Vec2 | null;
  readonly market: Vec2 | null;
  readonly garrison: Character[] = [];
  trader: Character | null = null;
  op: Operation | null = null;
  /** Сколько операций было (для тестов и отладки). */
  opsStarted = 0;
  private time = 0;
  private nextOp: number;
  private nextRecruit: number = INSURGENCY.recruitEvery;

  constructor(private readonly ctx: AiContext) {
    this.base = poiWorld(ctx, 'rebel_base');
    this.cache = poiWorld(ctx, 'rebel_cache');
    this.market = poiWorld(ctx, 'black_market');
    this.nextOp = ctx.rng.range(INSURGENCY.firstOp[0], INSURGENCY.firstOp[1]);
  }

  get now(): number {
    return this.time;
  }

  /** Заселить убежище: гарнизон и торговец. Без канализации на карте — ничего. */
  populate(): void {
    if (!this.base) return;
    for (let k = 0; k < INSURGENCY.garrison; k++) this.recruit();
    const spot = poiWorld(this.ctx, 'trader');
    const counter = this.market;
    if (spot && counter) {
      const a = this.ctx.nav.nearestWalkable(spot.x, spot.y, 3);
      if (a >= 0) {
        const t = createCharacter(this.ctx.entities, this.ctx.rng, 'citizen', this.ctx.nav.worldX(a), this.ctx.nav.worldY(a));
        t.name = `Барыга ${t.name.split(' ')[0]}`;
        t.brain = new PostBrain({ x: t.x, y: t.y }, Math.atan2(counter.y - t.y, counter.x - t.x));
        this.trader = t;
      }
    }
  }

  private recruit(): Character | null {
    const { ctx } = this;
    const a = randomAnchorInZone(ctx, 'rebel_base');
    if (a < 0) return null;
    const rank = Math.min(ctx.rng.int(0, 4), ctx.rng.int(0, 4));
    const c = createCharacter(ctx.entities, ctx.rng, 'rebel', ctx.nav.worldX(a), ctx.nav.worldY(a), false, rank);
    equipKit(c, rank >= 4 ? 'rebel_commander' : ctx.rng.chance(0.3) ? 'rebel_rifleman' : 'rebel_raider', ctx);
    c.brain = new UndergroundBrain(c, ctx);
    this.garrison.push(c);
    return c;
  }

  private say(text: string): void {
    // Связь сопротивления слышит только игрок-повстанец.
    if (this.ctx.player?.faction === 'rebel') this.ctx.bus.emit('log', { text: `Сопротивление: ${text}`, kind: 'world' });
  }

  private idle(): Character[] {
    return this.garrison.filter((c) => c.alive && (c.brain as UndergroundBrain | null)?.available && this.ctx.map.levelAt(c.x, c.y) === 'sewer');
  }

  /** Начать операцию (или принудительно — для тестов и отладки). */
  startOperation(kind?: Operation['kind']): Operation | null {
    const { ctx } = this;
    const free = this.idle();
    if (free.length < 1) return null;
    const type = kind ?? (ctx.rng.chance(INSURGENCY.sabotageChance) ? 'sabotage' : 'ambush');
    if (type === 'sabotage') {
      const nodes = ctx.economy.nodes.filter((n) => !n.broken);
      if (!nodes.length) return null;
      const node = ctx.rng.pick(nodes);
      const n = Math.min(free.length, ctx.rng.int(INSURGENCY.sabotageTeam[0], INSURGENCY.sabotageTeam[1]));
      const team = free.slice(0, n);
      for (const c of team) (c.brain as UndergroundBrain).startSabotage(c, ctx, node);
      const where = ctx.map.zoneAtWorld(node.x, node.y)?.name ?? 'город';
      this.op = { kind: 'sabotage', team, where };
      this.say(`группа (${n}) вышла на саботаж узла Альянса — ${where}.`);
    } else {
      const avoid = zoneIds(ctx, INSURGENCY.ambushAvoidZones);
      const prey = ctx.entities.list.filter(
        (c) =>
          c.alive && c.faction === 'cp' && c.brain instanceof CpBrain && !c.brain.guardPost && !c.brain.medicStation &&
          ctx.map.levelAt(c.x, c.y) === 'city' && !avoid.has(ctx.map.zoneGrid[Math.floor(c.y / ctx.map.tileSize) * ctx.map.width + Math.floor(c.x / ctx.map.tileSize)]),
      );
      if (!prey.length || free.length < 2) return null;
      const target = ctx.rng.pick(prey);
      const n = Math.min(free.length, ctx.rng.int(INSURGENCY.ambushTeam[0], INSURGENCY.ambushTeam[1]));
      const team = free.slice(0, n);
      for (const c of team) (c.brain as UndergroundBrain).startAmbush(c, ctx, target);
      const where = ctx.map.zoneAtWorld(target.x, target.y)?.name ?? 'город';
      this.op = { kind: 'ambush', team, where };
      this.say(`засада (${n}) на патруль ГО — ${where}.`);
    }
    this.opsStarted++;
    return this.op;
  }

  update(dt: number): void {
    this.time += dt;
    const { ctx } = this;
    for (let i = this.garrison.length - 1; i >= 0; i--) if (!this.garrison[i].alive) this.garrison.splice(i, 1);
    if (!this.base) return;
    // Пополнение гарнизона.
    if (this.garrison.length < INSURGENCY.garrison && this.time >= this.nextRecruit) {
      this.nextRecruit = this.time + INSURGENCY.recruitEvery;
      this.recruit();
    }
    // Бойцы операции в городе — «нападавшие» для тревоги.
    for (const c of this.garrison) {
      const b = c.brain as UndergroundBrain | null;
      if (!b || b.mode === 'base') continue;
      if (ctx.map.levelAt(c.x, c.y) === 'city' && ctx.war.code !== 'green') ctx.war.operatives.add(c);
    }
    // Операция закончилась: все вернулись или погибли.
    if (this.op) {
      const active = this.op.team.filter((c) => c.alive && (c.brain as UndergroundBrain | null)?.mode !== 'base');
      if (active.length === 0) {
        const alive = this.op.team.filter((c) => c.alive).length;
        this.say(`группа вернулась (${alive} из ${this.op.team.length}).`);
        this.op = null;
        this.nextOp = this.time + ctx.rng.range(INSURGENCY.opEvery[0], INSURGENCY.opEvery[1]);
      }
    } else if (this.time >= this.nextOp) {
      if (!this.startOperation()) this.nextOp = this.time + 10;
    }
  }
}
