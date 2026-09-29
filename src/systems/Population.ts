import { ARSENAL } from '../config/arsenal';
import { PRISON } from '../config/prison';
import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { FactionId } from '../config/factions';
import { FACTIONS } from '../config/factions';
import { AI } from '../config/ai';
import { randomAnchorAround, randomAnchorInZone, zoneIds } from '../ai/destinations';
import { dist } from '../core/math';
import { KITS, ITEMS, type WeaponId } from '../config/items';
import { cpUnit, CP_UNIT, rebelUnitOf, type CpUnitId } from '../config/factions';
import { PROFESSIONS, type ProfessionId } from '../config/professions';
import { ROSTER } from '../config/roster';
import { ECONOMY } from '../config/economy';
import { HOUSING } from '../config/housing';
import { spawnRole, type RoleKind, type RoleSpec } from './Roster';

/** Выдать набор предметов роли; первое оружие из набора — в руки, магазин заряжен. */
export function equipKit(c: Character, kit: string, ctx: Pick<AiContext, 'combat'>): void {
  c.gear = {};
  c.inventory.capacity = ECONOMY.inventorySlots;
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

/** Набор юнита ГО по рангу (config/factions.ts, CP_RANKS). */
export function cpKit(rank: number): string {
  return cpUnit(rank).kit;
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
    // Не в камере КПЗ и не в камере тюрьмы.
    if (ctx.law.inAnyCell(x, y, 12)) continue;
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
  const kind: RoleKind = profession === 'rebel_leader' ? 'leader' : profession.startsWith('hydra') || profession === 'commando' ? 'hydra' : 'army';
  return { kind, faction: 'rebel', profession, division: null, rank, kit };
}

/** Набор бойца армии по профессии. */
export function armyKit(profession: ProfessionId): string {
  return PROFESSIONS[profession].kit ?? 'rebel_soldier';
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
  const civAvoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands', 'wasteland', 'rebel_camp', 'arsenal', 'prison']);
  const plaza = poiWorld(ctx, 'plaza_center') ?? { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const anywhere = { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  // Силовой блок — постоянный состав: не нашлось места у точки — появляется там же, где при возрождении.
  const put = (spec: RoleSpec, at: { x: number; y: number } | null): Character | null =>
    at ? spawnRole(ctx, spec, at) : spec.faction === 'cp' ? spawnRole(ctx, spec) : null;

  const nearPlaza = Math.min(6, citizens);
  // Особые жители — в конце списка (не у площади).
  const special: ProfessionId[] = [];
  for (const [prof, share] of [['thief', P.thiefShare], ['outcast', P.outcastShare], ['bandit', P.banditShare], ['fugitive', P.fugitiveShare]] as [ProfessionId, number][]) {
    for (let k = 0; k < Math.round(citizens * share); k++) special.push(prof);
  }
  const residents: Character[] = [];
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
    // Часть обычных граждан — лоялисты (ходят в канцелярию Нексуса на бумажную работу).
    if (prof === 'citizen' && ctx.rng.chance(P.loyalistShare)) c.loyalty = Math.round(ctx.rng.range(P.loyalistLoyalty[0], P.loyalistLoyalty[1]));
    if (c.role) c.role.loyalty = c.loyalty;
    if (prof !== 'fugitive') residents.push(c);
  }
  const factory = ctx.labor?.factory;
  const none0 = new Set<number>();
  for (const prof of P.cwuProfessions) {
    const depot = (prof === 'loader' || prof === 'armorer') && ctx.arsenal?.waitSpot;
    const at = prof === 'packer' && factory ? freeSpot(ctx, factory, 0, 8, civAvoid) : depot ? freeSpot(ctx, depot, 0, 4, none0, 20) : freeSpot(ctx, plaza, 3, 30, civAvoid);
    put({ kind: 'cwu', faction: 'cwu', profession: prof, division: null, rank: 0, kit: PROFESSIONS[prof].kit ?? 'cwu' }, at);
  }
  // Глава ГСР — за столом в кабинете штаба.
  const hqDesk = ctx.cwuHq?.desk;
  if (hqDesk) put({ kind: 'cwu', faction: 'cwu', profession: 'cwu_head', division: null, rank: 0, kit: 'cwu_head' }, freeSpot(ctx, hqDesk, 0, 2, new Set(), 16) ?? hqDesk);
  // Лавки и кафе проспекта — продавец ГСР за каждым прилавком; в общей столовой — повар у котла.
  const shops = ctx.shops;
  if (shops) {
    for (const s of shops.staffed) {
      const c = put({ kind: 'cwu', faction: 'cwu', profession: 'vendor', division: null, rank: 0, kit: PROFESSIONS.vendor.kit ?? 'cwu' }, s.vendorSpot);
      if (c) s.vendor = c;
    }
    if (shops.cookSpot) {
      const c = put({ kind: 'cwu', faction: 'cwu', profession: 'canteen_cook', division: null, rank: 0, kit: PROFESSIONS.canteen_cook.kit ?? 'cwu' }, shops.cookSpot);
      if (c) shops.cook = c;
    }
  }
  // Жители — семьями: фамилия, цвет повязки, дом (Арбат, общежитие или особняк). Рабочие ГСР — на работе.
  ctx.families?.assign(residents);
  for (let k = 0; k < P.vorts; k++) {
    put({ kind: 'vort', faction: 'vort', profession: 'vort_slave', division: null, rank: 0, kit: 'vort' }, freeSpot(ctx, anywhere, 10, 110, civAvoid));
  }
  // Подпольщики в городе — без оружия на виду.
  for (let k = 0; k < P.rebels; k++) {
    put({ kind: 'citizen', faction: 'rebel', profession: 'rebel_soldier', division: null, rank: randomRank(ctx, 'rebel', 4), kit: 'citizen' }, freeSpot(ctx, anywhere, 40, 110, civAvoid));
  }
  const nexus = poiWorld(ctx, 'nexus_gate') ?? plaza;
  const none = new Set<number>();
  const C = ROSTER.cp;
  const cpSpec = (kind: RoleSpec['kind'], unit: CpUnitId, extra: Partial<RoleSpec> = {}): RoleSpec => {
    const rank = CP_UNIT[unit];
    return { kind, faction: 'cp', profession: null, division: cpUnit(rank).group, rank, kit: cpUnit(rank).kit, ...extra };
  };
  const cityAvoid = zoneIds(ctx, ['nexus', 'cells', 'checkpoint', 'outlands', 'wasteland', 'rebel_camp', 'restricted', 'arsenal', 'prison']);
  const patrolAvoid = zoneIds(ctx, ['checkpoint', 'outlands', 'wasteland', 'rebel_camp']);
  // RCT.PCU на постах: у ворот Нексуса (лицом наружу) и в людных местах — площадь и улицы.
  const inside = zoneIds(ctx, ['nexus', 'cells']);
  // Нет места у самой точки — чуть дальше, в крайнем случае у площади: состав постов всегда полный.
  const postSpot = (p: { x: number; y: number }, r0: number, r1: number, avoid: ReadonlySet<number>) =>
    freeSpot(ctx, p, r0, r1, avoid, 28) ?? freeSpot(ctx, p, r0, r1 * 3, avoid, 20) ?? freeSpot(ctx, plaza, 2, 30, cityAvoid, 16);
  for (let k = 0; k < C.nexusPosts; k++) {
    const at = postSpot(nexus, 2, 4, inside);
    if (at) put(cpSpec('post', 'rct', { post: at, facing: Math.atan2(at.y - nexus.y, at.x - nexus.x) }), at);
  }
  for (let k = 0; k < C.publicPosts; k++) {
    const onPlaza = k % 2 === 0;
    let at: { x: number; y: number } | null = null;
    if (onPlaza) at = postSpot(plaza, 4, 8, cityAvoid);
    else {
      const a = randomAnchorInZone(ctx, 'avenue');
      at = a >= 0 ? { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) } : postSpot(plaza, 6, 12, cityAvoid);
    }
    if (at) put(cpSpec('post', 'rct', { post: at, facing: ctx.rng.range(0, Math.PI * 2) }), at);
  }
  // Патрульные группы: ведущий PCU.02 или сержант PCU.01, за ним PCU.03; следователи SU.01 — в группах.
  const squadAt: ({ x: number; y: number } | null)[] = [];
  for (let s = 0; s < C.squads; s++) {
    const at = freeSpot(ctx, anywhere, 0, 110, patrolAvoid) ?? postSpot(plaza, 3, 12, cityAvoid);
    squadAt.push(at);
    if (!at) continue;
    put(cpSpec('squad', s % 2 === 0 ? 'pcu2' : 'pcu1', { squad: s, lead: true }), at);
    for (let k = 0; k < C.squadFollowers; k++) put(cpSpec('squad', 'pcu3', { squad: s, lead: false }), freeSpot(ctx, at, 0, 3, patrolAvoid, 24));
  }
  for (let k = 0; k < C.investigators; k++) {
    const s = k % Math.max(1, C.squads);
    // Следователь — сразу при своей группе.
    const at = squadAt[s];
    put(cpSpec('squad', 'su1', { squad: s, lead: false }), at ? freeSpot(ctx, at, 0, 4, patrolAvoid, 24) : freeSpot(ctx, anywhere, 0, 110, patrolAvoid));
  }
  for (let k = 0; k < C.technicians; k++) put(cpSpec('tech', 'su2'), freeSpot(ctx, anywhere, 0, 110, patrolAvoid));
  // Командование в Нексусе: офицеры на плацу, инспекторы у канцелярии, охрана и глава — у кабинета.
  const yard = poiWorld(ctx, 'nexus_yard') ?? nexus;
  const office = poiWorld(ctx, 'nexus_desk') ?? nexus;
  const desk = poiWorld(ctx, 'clerk_desk') ?? office;
  // Администратор — первым, за своим столом (охрана и глава встают рядом).
  if (P.admin > 0) {
    const desk = poiWorld(ctx, 'nexus_desk');
    if (desk) put({ kind: 'admin', faction: 'admin', profession: null, division: null, rank: 0, kit: 'admin' }, freeSpot(ctx, desk, 0, 0, none, 10));
  }
  for (let k = 0; k < C.officers; k++) put(cpSpec('officer', 'ofc'), freeSpot(ctx, yard, 0, 4, none, 30));
  for (let k = 0; k < C.inspectors; k++) put(cpSpec('inspector', 'insp'), freeSpot(ctx, desk, 0, 3, none, 24));
  for (let k = 0; k < C.guards; k++) put(cpSpec('bodyguard', 'guard'), freeSpot(ctx, office, 0, 4, none, 24));
  for (let k = 0; k < C.epu; k++) put(cpSpec('epu', 'epu'), freeSpot(ctx, office, 0, 2, none, 24));
  // Склад Альянса на окраине: кладовщик SU.QM за столом (лицом к окну выдачи), охрана SU.GUARD на постах.
  const ars = ctx.arsenal;
  if (ars?.present && ars.desk) {
    const face = ars.window ? Math.atan2(ars.window.y - ars.desk.y, ars.window.x - ars.desk.x) : 0;
    const seat = ars.deskSpot ?? ars.desk;
    put(cpSpec('qm', 'qm', { post: seat, facing: face }), seat);
    for (const p of ars.posts.slice(0, ARSENAL.guards)) {
      const post = { x: p.x, y: p.y };
      put(cpSpec('depot', 'guard', { post, facing: p.facing }), freeSpot(ctx, post, 0, 1, none, 16) ?? post);
    }
    // Экипаж конвоя — в караулке склада, у каждого своё место.
    const C = ARSENAL.convoy;
    for (let k = 0; k < C.crew && ars.crewSpots.length; k++) {
      const post = ars.crewSpots[k % ars.crewSpots.length];
      put(cpSpec('convoy', C.unit, { post, facing: ctx.rng.range(0, Math.PI * 2) }), post);
    }
  }
  // Тюрьма Альянса: охрана SU.GUARD на постах (двор и коридор), начальник — третий инспектор SU.INSP.
  const pr = ctx.prison;
  if (pr?.present) {
    for (const p of pr.posts.slice(0, PRISON.guards)) {
      const post = { x: p.x, y: p.y };
      put(cpSpec('jailer', PRISON.guardUnit, { post, facing: p.facing }), freeSpot(ctx, post, 0, 1, none, 16) ?? post);
    }
    const desk = pr.desk ?? pr.center;
    if (desk) put(cpSpec('warden', PRISON.wardenUnit), freeSpot(ctx, desk, 0, 2, none, 16) ?? desk);
  }
  // Гарнизоны КПП: спецназ SU.03 на всех постах обоих дворов лицом к пустоши, RCT.PCU в проходной,
  // медик SU.02 в бункере.
  for (const f of ctx.war.fronts) {
    f.posts.slice(0, P.cpPerCheckpoint).forEach((post) => {
      const facing = Math.atan2(f.exit.y - post.y, f.exit.x - post.x);
      put(cpSpec('guard', 'su3', { front: f.index, post, facing }), freeSpot(ctx, post, 0, 0, none, 20));
    });
    // Проходная со стороны города: RCT.PCU на постах лицом к КПП — проверяют входящих.
    for (const post of f.gatePosts) {
      const facing = Math.atan2(f.innerGate.y - post.y, f.innerGate.x - post.x);
      put(cpSpec('gate', 'rct', { front: f.index, post, facing }), freeSpot(ctx, post, 0, 0, none, 20));
    }
    if (f.bunker.length) {
      const a = ctx.rng.pick(f.bunker);
      const st = { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
      put(cpSpec('medic', 'su2', { front: f.index, station: st }), freeSpot(ctx, st, 0, 0, none, 20));
    }
  }
  // OTA: командир OTA.KING и бойцы OTA.ALPHA (часть — с дробовиками) — резерв Цитадели.
  for (const [prof, n] of ROSTER.ota) {
    for (let k = 0; k < n; k++) {
      const kit = prof === 'ota_king' ? 'ota_king' : ctx.rng.chance(ROSTER.otaShotgunChance) ? 'ota_shotgun' : 'ota_alpha';
      put({ kind: 'ota', faction: 'ota', profession: prof, division: null, rank: 0, kit }, freeSpot(ctx, nexus, 1, 5, none, 24));
    }
  }
  // Армия сопротивления — в лагере в пустоши.
  const camp = poiWorld(ctx, 'rebel_camp');
  if (camp) {
    const outsideCamp = new Set(ctx.map.zones.filter((z) => z.kind !== 'rebel_camp').map((z) => z.id));
    for (const [prof, n] of [...ROSTER.army, ...ROSTER.hydra]) {
      for (let k = 0; k < n; k++) {
        const spec = armySpec(prof, armyKit(prof), rebelUnitOf(prof)?.rank ?? 0);
        // Глава восстания — Патрик.
        if (prof === 'rebel_leader') spec.name = ROSTER.leaderName;
        put(spec, freeSpot(ctx, camp, 0, 9, outsideCamp, 20));
      }
    }
  }
  // Схрон партизан в канализации: партизаны и торговец чёрного рынка.
  ctx.insurgency?.populate();
  // Банды: авторитет у общака и бойцы по комнатам своей общаги.
  ctx.gangs?.populate();
  // Свой дом — каждому жителю (семьи уже заселены), явка — каждому подпольщику.
  settleAll(ctx);
  // Штаб ГСР: сколько граждан было (город не пустеет от найма — CWU_HQ.hire.minCitizenShare).
  if (ctx.cwuHq) ctx.cwuHq.citizensAtStart = ctx.entities.list.filter((c) => c.faction === 'citizen').length;
}

/** Место работы жителя (дом ищется поближе к нему) или null. */
export function workplaceOf(ctx: AiContext, c: Character): { x: number; y: number } | null {
  switch (c.profession) {
    case 'vendor':
      return ctx.shops?.shops.find((s) => s.vendor === c)?.front ?? null;
    case 'canteen_cook':
      return ctx.shops?.cookSpot ?? null;
    case 'loader':
    case 'armorer':
      return ctx.arsenal?.waitSpot ?? null;
    case 'packer':
    case 'courier':
    case 'cwu_head':
      return ctx.labor?.factory ?? ctx.cwuHq?.desk ?? null;
    case 'cook':
      return ctx.economy.window;
    default:
      return null;
  }
}

/** Жители (граждане, ГСР, вортигонты) и подпольщики — кто живёт в городе. */
export function needsHome(c: Character): boolean {
  if (c.isPlayer) return false;
  if (c.faction === 'citizen' || c.faction === 'cwu' || c.faction === 'vort') return true;
  return c.role?.kind === 'partisan' || c.role?.kind === 'agent';
}

/**
 * Заселить всех без дома (Housing.house: у места работы, подполье — явки) и часть горожан сразу
 * поставить у себя дома (HOUSING.startHome) — выходят на улицу из своих дверей.
 */
export function settleAll(ctx: AiContext): void {
  const H = ctx.housing;
  if (!H) return;
  for (const c of ctx.entities.list) if (needsHome(c) && c.home < 0) H.house(c, workplaceOf(ctx, c));
  for (const c of ctx.entities.list) {
    if (c.isPlayer || c.faction !== 'citizen' || c.profession !== 'citizen' || c.home < 0 || !ctx.rng.chance(HOUSING.startHome)) continue;
    const d = H.of(c)!;
    const p = ctx.rng.pick(d.spots);
    if (ctx.entities.list.some((o) => o !== c && Math.hypot(o.x - p.x, o.y - p.y) < 20)) continue;
    c.x = c.prevX = p.x;
    c.y = c.prevY = p.y;
  }
}

/** Где появляется игрок в выбранной роли. */
export function roleSpawn(ctx: AiContext, faction: FactionId, profession: ProfessionId | null = null): { x: number; y: number } {
  const plaza = poiWorld(ctx, 'plaza_center') ?? { x: ctx.map.worldWidth / 2, y: ctx.map.worldHeight / 2 };
  const none = new Set<number>();
  let spot: { x: number; y: number } | null = null;
  if (faction === 'cp') {
    const desk = poiWorld(ctx, 'nexus_desk');
    if (desk) spot = freeSpot(ctx, desk, 1, 4, none, 30);
  } else if (faction === 'rebel' && (profession === 'partisan' || profession === 'spec_agent') && ctx.insurgency?.base) {
    // Партизан начинает в схроне в канализации.
    spot = freeSpot(ctx, ctx.insurgency.base, 0, 6, none, 30);
  } else if (faction === 'rebel' && poiWorld(ctx, 'rebel_camp')) {
    // Армия сопротивления — в лагере в пустоши.
    spot = freeSpot(ctx, poiWorld(ctx, 'rebel_camp')!, 0, 6, none, 30);
  } else if (faction === 'rebel') {
    // Подальше от Нексуса, в жилых кварталах.
    const avoid = zoneIds(ctx, ['nexus', 'cells', 'restricted', 'checkpoint', 'outlands', 'plaza', 'avenue', 'wasteland', 'rebel_camp', 'arsenal', 'prison']);
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
