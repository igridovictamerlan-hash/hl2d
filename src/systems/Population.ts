import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { FactionId } from '../config/factions';
import { FACTIONS } from '../config/factions';
import { AI } from '../config/ai';
import { randomAnchorAround, zoneIds } from '../ai/destinations';
import { dist } from '../core/math';
import { KITS, ITEMS, type WeaponId } from '../config/items';
import type { DivisionId } from '../config/factions';
import { PROFESSIONS, type ProfessionId } from '../config/professions';
import { ROSTER } from '../config/roster';
import { spawnRole, type RoleKind, type RoleSpec } from './Roster';

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

/** Роль бойца армии сопротивления по профессии (глава, HYDRA — свои виды). */
export function armySpec(profession: ProfessionId, kit: string, rank: number): RoleSpec {
  const kind: RoleKind = profession === 'rebel_leader' ? 'leader' : profession.startsWith('hydra') ? 'hydra' : 'army';
  return { kind, faction: 'rebel', profession, division: null, rank, kit };
}

/** Набор бойца армии по профессии. */
function armyKit(profession: ProfessionId, ctx: AiContext): string {
  if (profession === 'rebel_soldier') return ctx.rng.chance(0.3) ? 'rebel_rifleman' : ctx.rng.chance(0.2) ? 'rebel_shotgunner' : 'rebel_raider';
  return PROFESSIONS[profession].kit ?? 'rebel_raider';
}

/**
 * Заселение — постоянный состав мира, как игроки на сервере (config/roster.ts, AI.population):
 * граждане (часть у площади; воры, отбросы, бандиты, беглецы), ГСР по профессиям, вортигонты,
 * подпольщики, патрули ГО, часовые на всех постах КПП и медики, резерв OTA в Цитадели,
 * Администратор, армия сопротивления в лагере (глава, ветераны, солдаты, пиро, подрывник, HYDRA),
 * партизаны и торговец в схроне. У каждого — роль (RoleSpec): погибнув, он появляется снова.
 */
export function spawnPopulation(ctx: AiContext, citizens: number): void {
  const P = AI.population;
  const civAvoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands', 'wasteland', 'rebel_camp']);
  const plaza = poiWorld(ctx, 'plaza_center') ?? { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const anywhere = { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const put = (spec: RoleSpec, at: { x: number; y: number } | null): Character | null => (at ? spawnRole(ctx, spec, at) : null);

  const nearPlaza = Math.min(6, citizens);
  // Особые жители — в конце списка (не у площади).
  const special: ProfessionId[] = [];
  for (const [prof, share] of [['thief', P.thiefShare], ['outcast', P.outcastShare], ['bandit', P.banditShare], ['fugitive', P.fugitiveShare]] as [ProfessionId, number][]) {
    for (let k = 0; k < Math.round(citizens * share); k++) special.push(prof);
  }
  for (let k = 0; k < citizens; k++) {
    const spot = k < nearPlaza ? freeSpot(ctx, plaza, 3, 22, civAvoid) : freeSpot(ctx, anywhere, 0, 110, civAvoid);
    const j = k - (citizens - special.length);
    const prof: ProfessionId = j >= 0 ? special[j] : 'citizen';
    const c = put({ kind: 'citizen', faction: 'citizen', profession: prof, division: null, rank: 0, kit: PROFESSIONS[prof].kit ?? 'citizen' }, spot);
    if (!c) continue;
    // Отбросы общества — без лояльности к Альянсу; беглец — без CID и в розыске.
    if (prof === 'outcast' || prof === 'bandit') c.loyalty = Math.min(c.loyalty, -10);
    if (prof === 'fugitive') {
      c.loyalty = Math.min(c.loyalty, -20);
      c.law.hasCid = false;
      c.law.wanted = true;
    }
    if (c.role) c.role.loyalty = c.loyalty;
  }
  const factory = ctx.labor?.factory;
  for (const prof of P.cwuProfessions) {
    const at = prof === 'packer' && factory ? freeSpot(ctx, factory, 0, 8, civAvoid) : freeSpot(ctx, plaza, 3, 30, civAvoid);
    put({ kind: 'cwu', faction: 'cwu', profession: prof, division: null, rank: 0, kit: PROFESSIONS[prof].kit ?? 'cwu' }, at);
  }
  for (let k = 0; k < P.vorts; k++) {
    put({ kind: 'vort', faction: 'vort', profession: 'vort_slave', division: null, rank: 0, kit: 'vort' }, freeSpot(ctx, anywhere, 10, 110, civAvoid));
  }
  // Подпольщики в городе — без оружия на виду.
  for (let k = 0; k < P.rebels; k++) {
    put({ kind: 'citizen', faction: 'rebel', profession: 'rebel_soldier', division: null, rank: randomRank(ctx, 'rebel', 4), kit: 'citizen' }, freeSpot(ctx, anywhere, 40, 110, civAvoid));
  }
  const nexus = poiWorld(ctx, 'nexus_gate') ?? plaza;
  const none = new Set<number>();
  const patrolAvoid = zoneIds(ctx, ['checkpoint', 'outlands', 'wasteland', 'rebel_camp']);
  const patrolDivisions: DivisionId[] = ['union', 'union', 'jury', 'union', 'helix', 'tech', 'union', 'jury'];
  for (let k = 0; k < P.cpPatrol; k++) {
    const division = patrolDivisions[k % patrolDivisions.length];
    // Патрули — в городе: КПП и пустошь заняты гарнизонами (иначе патрульный займёт место часового).
    const at = freeSpot(ctx, k < 2 ? nexus : anywhere, 2, k < 2 ? 12 : 100, patrolAvoid);
    put({ kind: 'patrol', faction: 'cp', profession: null, division, rank: randomRank(ctx, 'cp', 6), kit: cpKit(division) }, at);
  }
  // Гарнизоны КПП: часовые GRID на всех постах обоих дворов лицом к пустоши + медик HELIX в бункере.
  for (const f of ctx.war.fronts) {
    f.posts.slice(0, P.cpPerCheckpoint).forEach((post) => {
      const facing = Math.atan2(f.exit.y - post.y, f.exit.x - post.x);
      put({ kind: 'guard', faction: 'cp', profession: null, division: 'grid', rank: randomRank(ctx, 'cp', 5), kit: 'cp_grid', front: f.index, post, facing }, freeSpot(ctx, post, 0, 0, none, 20));
    });
    if (f.bunker.length) {
      const a = ctx.rng.pick(f.bunker);
      const st = { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
      put({ kind: 'medic', faction: 'cp', profession: null, division: 'helix', rank: randomRank(ctx, 'cp', 4), kit: 'cp_helix', front: f.index, station: st }, freeSpot(ctx, st, 0, 0, none, 20));
    }
  }
  // Резерв OTA в Цитадели: элита и солдаты (часть — с дробовиками).
  for (const [prof, n] of ROSTER.ota) {
    for (let k = 0; k < n; k++) {
      const kit = prof === 'ota_elite' ? 'ota_elite' : ctx.rng.chance(ROSTER.otaShotgunChance) ? 'ota_shotgun' : 'ota';
      put({ kind: 'ota', faction: 'ota', profession: prof, division: null, rank: 0, kit }, freeSpot(ctx, nexus, 1, 5, none, 24));
    }
  }
  if (P.admin > 0) {
    const desk = poiWorld(ctx, 'nexus_desk');
    if (desk) put({ kind: 'admin', faction: 'admin', profession: null, division: null, rank: 0, kit: 'admin' }, freeSpot(ctx, desk, 0, 0, none, 10));
  }
  // Армия сопротивления — в лагере в пустоши.
  const camp = poiWorld(ctx, 'rebel_camp');
  if (camp) {
    const outsideCamp = new Set(ctx.map.zones.filter((z) => z.kind !== 'rebel_camp').map((z) => z.id));
    for (const [prof, n] of [...ROSTER.army, ...ROSTER.hydra]) {
      for (let k = 0; k < n; k++) {
        put(armySpec(prof, armyKit(prof, ctx), ROSTER.rank[prof] ?? randomRank(ctx, 'rebel', 2)), freeSpot(ctx, camp, 0, 9, outsideCamp, 20));
      }
    }
  }
  // Схрон партизан в канализации: партизаны и торговец чёрного рынка.
  ctx.insurgency?.populate();
}

/** Где появляется игрок в выбранной роли. */
export function roleSpawn(ctx: AiContext, faction: FactionId, profession: ProfessionId | null = null): { x: number; y: number } {
  const plaza = poiWorld(ctx, 'plaza_center') ?? { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const none = new Set<number>();
  let spot: { x: number; y: number } | null = null;
  if (faction === 'cp') {
    const desk = poiWorld(ctx, 'nexus_desk');
    if (desk) spot = freeSpot(ctx, desk, 1, 4, none, 30);
  } else if (faction === 'rebel' && profession === 'partisan' && ctx.insurgency?.base) {
    // Партизан начинает в схроне в канализации.
    spot = freeSpot(ctx, ctx.insurgency.base, 0, 6, none, 30);
  } else if (faction === 'rebel' && poiWorld(ctx, 'rebel_camp')) {
    // Армия сопротивления — в лагере в пустоши.
    spot = freeSpot(ctx, poiWorld(ctx, 'rebel_camp')!, 0, 6, none, 30);
  } else if (faction === 'rebel') {
    // Подальше от Нексуса, в жилых кварталах.
    const avoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands', 'plaza', 'avenue', 'wasteland', 'rebel_camp']);
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
