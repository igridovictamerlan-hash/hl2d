import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { Vec2 } from '../core/math';
import { INSURGENCY } from '../config/underground';
import { createCharacter } from '../entities/factory';
import { equipKit, poiWorld } from './Population';
import { UndergroundBrain } from '../ai/brains/UndergroundBrain';
import { PostBrain } from '../ai/brains/PostBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { randomAnchorInZone, randomAnchorAround, zoneIds } from '../ai/destinations';

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
  private nextOuting = 5;
  /** Сколько вылазок было (для тестов и отладки). */
  outings = 0;
  /** Без вылазок и операций (тесты и отладка). */
  paused = false;

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
    return this.garrison.filter((c) => c.alive && c.brain instanceof UndergroundBrain && c.brain.available && this.ctx.map.levelAt(c.x, c.y) === 'sewer');
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

  /** Одиночная или парная вылазка из убежища. */
  startOuting(kind?: 'tunnels' | 'market' | 'scout'): boolean {
    const { ctx } = this;
    const free = this.idle();
    if (free.length <= INSURGENCY.minAtBase || !ctx.map.hatches.length) return false;
    const K = INSURGENCY.outingKinds;
    const roll = ctx.rng.next();
    const type = kind ?? (roll < K.tunnels ? 'tunnels' : roll < K.tunnels + K.market ? 'market' : 'scout');
    const h = ctx.rng.pick(ctx.map.hatches);
    const n = type === 'scout' && free.length > INSURGENCY.minAtBase + 1 && ctx.rng.chance(0.5) ? 2 : 1;
    let to: { x: number; y: number } | null = null;
    let what = '';
    if (type === 'tunnels') {
      to = h.sewer;
      what = 'обход';
    } else if (type === 'market' && this.market) {
      to = this.market;
      what = 'рынок';
    } else {
      // Разведка: точка в городе недалеко от люка.
      const a = randomAnchorAround(h.city, ctx, INSURGENCY.scoutRadius[0], INSURGENCY.scoutRadius[1], zoneIds(ctx, INSURGENCY.ambushAvoidZones));
      to = a >= 0 ? { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) } : h.city;
      what = 'разведка';
    }
    if (!to) return false;
    for (const c of ctx.rng.shuffle([...free]).slice(0, n)) (c.brain as UndergroundBrain).startOuting(c, ctx, to, what);
    this.outings++;
    return true;
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
    if (this.paused) return;
    // Вылазки: убежище живёт — ходят по тоннелям, на рынок, наверх через люки.
    if (this.time >= this.nextOuting) {
      this.nextOuting = this.time + ctx.rng.range(INSURGENCY.outingEvery[0], INSURGENCY.outingEvery[1]);
      this.startOuting();
    }
    // Бойцы операции в городе — «нападавшие» для тревоги.
    for (const c of this.garrison) {
      const b = c.brain;
      if (!(b instanceof UndergroundBrain) || b.mode === 'base') continue;
      if (ctx.map.levelAt(c.x, c.y) === 'city' && ctx.war.code !== 'green') ctx.war.operatives.add(c);
    }
    // Операция закончилась: все вернулись или погибли.
    if (this.op) {
      // Задержанный (мозг PrisonerBrain) из операции выбыл.
      const active = this.op.team.filter((c) => c.alive && c.brain instanceof UndergroundBrain && c.brain.mode !== 'base');
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
