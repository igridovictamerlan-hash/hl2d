import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { FactionId } from '../config/factions';
import { FACTIONS } from '../config/factions';
import { AI } from '../config/ai';
import { createCharacter } from '../entities/factory';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { PostBrain } from '../ai/brains/PostBrain';
import { randomAnchorAround, zoneIds } from '../ai/destinations';
import { dist } from '../core/math';
import { KITS, ITEMS, type WeaponId } from '../config/items';
import type { DivisionId } from '../config/factions';

/** Выдать набор предметов роли; первое оружие из набора — в руки, магазин заряжен. */
export function equipKit(c: Character, kit: string, ctx: Pick<AiContext, 'combat'>): void {
  c.inventory.clear();
  c.weapon = null;
  c.mag = 0;
  c.mags = {};
  c.reloadUntil = 0;
  let weapon: WeaponId | null = null;
  for (const [id, qty] of KITS[kit] ?? []) {
    c.inventory.add(id, qty);
    if (!weapon && ITEMS[id].kind === 'weapon') weapon = id as WeaponId;
  }
  if (weapon) ctx.combat.equip(c, weapon);
}

/** Набор ГО по специализации. */
export function cpKit(division: DivisionId | null): string {
  return division === 'grid' ? 'cp_grid' : division === 'helix' ? 'cp_helix' : 'cp';
}

/** Точка в px мира для POI. */
export function poiWorld(ctx: Pick<AiContext, 'map'>, type: Parameters<AiContext['map']['poisOf']>[0], k = 0): { x: number; y: number } | null {
  const p = ctx.map.poisOf(type)[k];
  if (!p) return null;
  const ts = ctx.map.tileSize;
  return { x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts };
}

/** Свободный проходимый якорь у точки (не ближе minGap к другим персонажам). */
function freeSpot(ctx: AiContext, around: { x: number; y: number }, rMin: number, rMax: number, avoid: ReadonlySet<number>, minGap = 40): { x: number; y: number } | null {
  for (let tries = 0; tries < 200; tries++) {
    const a = rMax <= 0 ? ctx.nav.nearestWalkable(around.x, around.y, 4) : randomAnchorAround(around, ctx, rMin, rMax, avoid);
    if (a < 0 || avoid.has(ctx.nav.zone[a])) continue;
    const x = ctx.nav.worldX(a);
    const y = ctx.nav.worldY(a);
    if (ctx.entities.list.some((c) => dist(c.x, c.y, x, y) < minGap)) continue;
    return { x, y };
  }
  return null;
}

function randomRank(ctx: AiContext, faction: FactionId, maxRank: number): number {
  const n = FACTIONS[faction].ranks?.length ?? 1;
  // Младших рангов больше: берём минимум из двух бросков.
  return Math.min(ctx.rng.int(0, Math.min(maxRank, n - 1)), ctx.rng.int(0, Math.min(maxRank, n - 1)));
}

/**
 * Заселение города: граждане (часть у площади), рабочие ГСР, повстанцы, патрули ГО,
 * часовые пограничных КПП, Администратор в Нексусе.
 */
export function spawnPopulation(ctx: AiContext, citizens: number): void {
  const P = AI.population;
  const civAvoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands']);
  const plaza = poiWorld(ctx, 'plaza_center') ?? { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const anywhere = { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const add = (faction: FactionId, spot: { x: number; y: number } | null, kit: string, rank = 0): Character | null => {
    if (!spot) return null;
    const c = createCharacter(ctx.entities, ctx.rng, faction, spot.x, spot.y, false, rank);
    c.facing = ctx.rng.range(0, Math.PI * 2);
    // У жителей немного разная сытость — не все проголодаются одновременно.
    c.hunger = ctx.rng.range(40, 100);
    equipKit(c, kit, ctx);
    return c;
  };

  const nearPlaza = Math.min(6, citizens);
  for (let k = 0; k < citizens; k++) {
    const spot = k < nearPlaza ? freeSpot(ctx, plaza, 3, 22, civAvoid) : freeSpot(ctx, anywhere, 0, 110, civAvoid);
    const c = add('citizen', spot, 'citizen');
    if (c) c.brain = new CitizenBrain(c, ctx);
  }
  for (let k = 0; k < P.cwu; k++) {
    const c = add('cwu', freeSpot(ctx, plaza, 3, 30, civAvoid), 'cwu');
    if (c) c.brain = new CitizenBrain(c, ctx);
  }
  // Подпольщики в городе — без оружия на виду.
  for (let k = 0; k < P.rebels; k++) {
    const c = add('rebel', freeSpot(ctx, anywhere, 40, 110, civAvoid), 'citizen', randomRank(ctx, 'rebel', 4));
    if (c) c.brain = new CitizenBrain(c, ctx);
  }
  const nexus = poiWorld(ctx, 'nexus_gate') ?? plaza;
  const none = new Set<number>();
  const patrolDivisions: DivisionId[] = ['union', 'union', 'jury', 'helix', 'union', 'jury'];
  for (let k = 0; k < P.cpPatrol; k++) {
    const division = patrolDivisions[k % patrolDivisions.length];
    const c = add('cp', freeSpot(ctx, k < 2 ? nexus : anywhere, 2, k < 2 ? 12 : 100, none), cpKit(division), randomRank(ctx, 'cp', 6));
    if (c) {
      c.division = division;
      c.brain = new CpBrain(c, ctx);
    }
  }
  // Гарнизоны КПП: часовые GRID на постах лицом к пустошам + медик HELIX в бункере.
  for (const f of ctx.war.fronts) {
    f.posts.slice(0, P.cpPerCheckpoint).forEach((post) => {
      const facing = Math.atan2(f.exit.y - post.y, f.exit.x - post.x);
      const c = add('cp', freeSpot(ctx, post, 0, 0, none, 20), 'cp_grid', randomRank(ctx, 'cp', 5));
      if (c) {
        c.division = 'grid';
        c.facing = facing;
        c.brain = new CpBrain(c, ctx, { post, facing, front: f.index });
      }
    });
    if (f.bunker.length) {
      const a = ctx.rng.pick(f.bunker);
      const st = { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
      const c = add('cp', freeSpot(ctx, st, 0, 0, none, 20), 'cp_helix', randomRank(ctx, 'cp', 4));
      if (c) {
        c.division = 'helix';
        c.brain = new CpBrain(c, ctx, { front: f.index, medicStation: st });
      }
    }
  }
  // Убежище сопротивления в канализации: гарнизон и торговец чёрного рынка.
  ctx.insurgency?.populate();
  if (P.admin > 0) {
    const desk = poiWorld(ctx, 'nexus_desk');
    if (desk) {
      const c = add('admin', freeSpot(ctx, desk, 0, 0, none, 10), 'admin');
      if (c) c.brain = new PostBrain({ x: c.x, y: c.y }, ctx.rng.range(0, Math.PI * 2));
    }
  }
}

/** Где появляется игрок в выбранной роли. */
export function roleSpawn(ctx: AiContext, faction: FactionId): { x: number; y: number } {
  const plaza = poiWorld(ctx, 'plaza_center') ?? { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const none = new Set<number>();
  let spot: { x: number; y: number } | null = null;
  if (faction === 'cp') {
    const desk = poiWorld(ctx, 'nexus_desk');
    if (desk) spot = freeSpot(ctx, desk, 1, 4, none, 30);
  } else if (faction === 'rebel' && ctx.insurgency?.base) {
    // Повстанец начинает в убежище в канализации.
    spot = freeSpot(ctx, ctx.insurgency.base, 0, 6, none, 30);
  } else if (faction === 'rebel') {
    // Подальше от Нексуса, в жилых кварталах.
    const avoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands', 'plaza', 'avenue']);
    const nexus = poiWorld(ctx, 'nexus_gate') ?? plaza;
    for (let k = 0; k < 20 && !spot; k++) {
      const s = freeSpot(ctx, { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 }, 20, 110, avoid);
      if (s && dist(s.x, s.y, nexus.x, nexus.y) > 700) spot = s;
    }
  }
  if (!spot) spot = freeSpot(ctx, plaza, 0, 8, zoneIds(ctx, ['nexus', 'cells']), 30);
  if (!spot) {
    const a = ctx.nav.nearestWalkable(plaza.x, plaza.y, 10);
    spot = { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
  }
  return spot;
}
