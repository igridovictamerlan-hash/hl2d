import { ECONOMY } from '../config/economy';
import type { Character } from '../entities/Character';
import type { Dwelling } from './Housing';
import type { AiContext } from '../ai/AiContext';
import type { Vec2 } from '../core/math';
import type { Corpse } from './CombatSystem';
import { isUnderground, type Cell } from './LawSystem';
import { INSURGENCY, PARTISANS } from '../config/underground';
import { FENCE } from '../config/gangs';
import { AMMO_ITEM, WEAPONS, type ItemId, type WeaponId } from '../config/items';
import { poiWorld } from './Population';
import { spawnRole } from './Roster';
import { ROSTER } from '../config/roster';
import { REBEL_UNIT, FACTIONS } from '../config/factions';
import { UndergroundBrain } from '../ai/brains/UndergroundBrain';
import { AgentBrain } from '../ai/brains/AgentBrain';
import { HiredGunBrain } from '../ai/brains/HiredGunBrain';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { OtaBrain } from '../ai/brains/OtaBrain';
import { RebelBrain } from '../ai/brains/RebelBrain';
import { PRISON } from '../config/prison';
import { isArmy } from './Prison';
import { wear } from './Gear';
import { randomAnchorAround, zoneIds } from '../ai/destinations';
import type { Convoy } from './Arsenal';

/** Текущая операция подпольщиков в городе. */
export interface Operation {
  kind: 'sabotage' | 'arm' | 'fence' | 'jailbreak' | 'mine' | 'depot' | 'ambush' | 'prison';
  team: Character[];
  where: string;
  /** Группа (ячейка), если на дело вышли вдвоём-втроём. */
  group?: UndergroundGroup;
}

/** Роль в группе: ведущий делает дело, прикрытие стоит рядом, дозорный следит за ВС. */
export type GroupRole = 'lead' | 'cover' | 'lookout';

/**
 * Группа подполья (ячейка) на одном деле: засада на конвой, саботаж с дозорным, взлом с прикрытием.
 * Сигналы общие: attack — ведущий (или любой в засаде) открыл огонь; alarm — дозорный заметил ВС,
 * все уходят. allies — союзники со стороны (задел под банды и мафию: пока — бандиты со стволом от
 * подполья, в будущем — бойцы группировок).
 */
export interface UndergroundGroup {
  id: number;
  task: 'ambush' | 'sabotage' | 'jailbreak' | 'prison';
  lead: Character;
  members: Character[];
  roles: Map<Character, GroupRole>;
  /** Место дела (засада, узел, камера). */
  spot: Vec2;
  /** Засада: какой конвой ждут. */
  convoy: Convoy | null;
  attack: boolean;
  alarm: boolean;
  /** Когда начали (и когда открыли огонь). */
  since: number;
  firedAt: number;
  allies: Character[];
  /** Штурм тюрьмы: какую камеру вскрывает каждый (не все в одну). */
  cells?: Map<Character, Cell>;
}

/** Рейд ВС на логово сопротивления (двое подпольщиков в тюрьме). */
export interface Raid {
  until: number;
  force: Character[];
}

/**
 * Сопротивление под городом: схрон в канализации, торговец чёрного рынка, два подпольщика и
 * спецагент (config/underground.ts, PARTISANS). Подпольщики всегда в личине горожанина или рабочего
 * ТС, огня не открывают: выходят через люк саботировать узлы Протектората и раздавать оружие бандитам —
 * те идут на ВС чужими руками (HiredGunBrain). Раскрытого партизана ведут в тюрьму Протектората: начальник
 * тюрьмы (третий SU.INSP) допрашивает у камеры (боль, реплики) — расколовшийся выдаёт личину другого.
 * Двое подпольщиков в тюрьме — гарнизоны КПП и резерв OTA идут штурмовать лагерь сопротивления.
 * Штурм тюрьмы (операция prison): все свободные подпольщики и спецагенты вместе выбивают двери камер.
 * Спецагент (AgentBrain) — переодевания, покушения, взлом КПЗ, бунты (startRiot).
 */
export class InsurgencySystem {
  readonly base: Vec2 | null;
  readonly cache: Vec2 | null;
  /** Прилавок в канализации (старый чёрный рынок; теперь торгует барыга в своей хате). */
  readonly sewerMarket: Vec2 | null;
  readonly garrison: Character[] = [];
  /** Спецагенты (ROSTER.agents). */
  readonly agents: Character[] = [];
  trader: Character | null = null;
  /** Группы подполья на деле. */
  readonly groups: UndergroundGroup[] = [];
  private nextGroup = 1;
  /** Идущие операции (у каждого подпольщика — своя); op — последняя начатая. */
  readonly ops: Operation[] = [];
  /** Сколько операций начато (для тестов и отладки). */
  operations = 0;
  /** С какого времени подпольщику в схроне делают новые документы. */
  private readonly papers = new Map<Character, number>();
  op: Operation | null = null;
  raid: Raid | null = null;
  /** Рейда ещё не было за этот раз (двое подпольщиков в тюрьме). */
  private raidArmed = true;
  /** Сколько операций было (для тестов и отладки). */
  opsStarted = 0;
  private time = 0;
  private nextOp: number;
  private nextOuting = 5;
  /** Сколько вылазок было (для тестов и отладки). */
  outings = 0;
  /** Без вылазок и операций (тесты и отладка). */
  paused = false;
  /** Когда начат последний взлом КПЗ. */
  private jailbreakAt = -1e9;
  stats = { armed: 0, interrogations: 0, broke: 0, raids: 0, riots: 0, jailbreaks: 0, groups: 0, ambushes: 0, looted: 0, alarms: 0, stashed: 0, fromStash: 0, fenced: 0 };
  /** Деньги подполья (выручка у барыги) — на заказы бандам. */
  funds = 0;
  /** Добыча, которую подпольщик несёт на явку. */
  private hauls = new Map<Character, { id: ItemId; qty: number }[]>();
  /** Кому и когда отдали ствол (не вооружать одного и того же подряд). */
  private armedAt = new Map<Character, number>();
  /** Допрос: сколько секунд и когда следующая реплика; раскололся ли. */
  private questioning = new Map<Character, { t: number; next: number; broke: boolean }>();

  constructor(private readonly ctx: AiContext) {
    this.base = poiWorld(ctx, 'rebel_base');
    this.cache = poiWorld(ctx, 'rebel_cache');
    this.sewerMarket = poiWorld(ctx, 'black_market');
    this.nextOp = ctx.rng.range(INSURGENCY.firstOp[0], INSURGENCY.firstOp[1]);
    ctx.law.onReleased = (c) => this.released(c);
    ctx.law.onFreed = (c) => this.freed(c);
  }

  /**
   * Своего вызволили из тюрьмы: сперва вооружиться — в оружейную тюрьмы за стволом и патронами, своё
   * изъятое — из комнаты улик (PrisonSystem.startArming); потом afterFreed.
   */
  private freed(c: Character): void {
    const { ctx } = this;
    c.hostile = true;
    if (isUnderground(c)) {
      c.disguised = false;
      c.cover = null;
    }
    if (c.isPlayer) {
      ctx.bus.emit('log', { text: 'Дверь камеры выбита — вы свободны! Стволы — в оружейной тюрьмы (из шлюза), своё — в комнате изъятого (E).', kind: 'world' });
      return;
    }
    c.say(ctx.rng.pick(PRISON.lines.freed), ctx.law.now, 2.5);
    if (!ctx.prison?.startArming(c, () => this.afterFreed(c))) this.afterFreed(c);
  }

  /**
   * Беглый вооружился (или брать нечего): подпольщик — в схрон (личины нет, в розыске — документы
   * сделают там); боец армии при выходе в город — снова в штурм (цель — тюрьма или Управа, WarSystem),
   * иначе — тропой в лагерь.
   */
  private afterFreed(c: Character): void {
    const { ctx } = this;
    if (!c.alive || c.law.phase !== 'none') return;
    const best = ctx.combat.bestWeapon(c, 200);
    if (best) ctx.combat.equip(c, best);
    const b = c.brain;
    if (b instanceof UndergroundBrain || b instanceof AgentBrain) {
      b.retreat(c, ctx);
      return;
    }
    if (b instanceof RebelBrain) {
      if (ctx.war.cityPush) {
        ctx.war.infiltrators.add(c);
        b.storm();
      } else b.withdraw();
    }
  }

  /** Раскололся ли подпольщик на допросе (его больше не допрашивают). */
  brokeUnder(c: Character): boolean {
    return this.questioning.get(c)?.broke ?? false;
  }

  /**
   * Подпольщика или спецагента выпустили из КПЗ (отсидел): документы ему вернули — снова под
   * гражданской личиной и не в розыске (иначе ВС у ворот тут же узнал бы его снова); прерванное дело
   * брошено — сразу в схрон.
   */
  private released(c: Character): void {
    if (!isUnderground(c) || c.isPlayer) return;
    c.law.wanted = false;
    c.hostile = false;
    if (this.agents.includes(c)) this.adoptAgent(c);
    else this.giveCover(c);
    const b = c.brain;
    if (b instanceof UndergroundBrain || b instanceof AgentBrain) b.retreat(c, this.ctx);
  }

  get now(): number {
    return this.time;
  }

  /** Где торгует чёрный рынок: у барыги в хате (иначе — старый прилавок в канализации). */
  get market(): Vec2 | null {
    return this.ctx.fence?.counter ?? this.sewerMarket;
  }

  /** Подпольщик (из постоянного состава) — в гарнизон схрона, в личине горожанина или ТС. */
  adopt(c: Character): void {
    this.garrison.push(c);
    // Под личиной — «чистые» поддельные документы: не в розыске.
    c.law.wanted = false;
    this.giveCover(c);
  }

  /** Новая личина (горожанин или рабочий ТС): при появлении и после возвращения в схрон. */
  giveCover(c: Character): void {
    c.disguised = true;
    const cwu = this.ctx.rng.chance(PARTISANS.cwuCoverShare);
    this.ctx.combat.equip(c, null);
    c.cover = { faction: cwu ? 'cwu' : 'citizen', rank: 0, profession: cwu ? 'janitor' : 'citizen', name: null };
  }

  /** Первый спецагент (совместимость). */
  get agent(): Character | null {
    return this.agents[0] ?? null;
  }

  /** Группа, в которой боец (null — на деле один или в схроне). */
  groupOf(c: Character): UndergroundGroup | null {
    for (const g of this.groups) if (g.members.includes(c)) return g;
    return null;
  }

  /** Собрать группу: первый — ведущий, остальные — с ролью role. */
  private formGroup(task: UndergroundGroup['task'], team: Character[], spot: Vec2, role: GroupRole, convoy: Convoy | null = null): UndergroundGroup {
    const g: UndergroundGroup = {
      id: this.nextGroup++, task, lead: team[0], members: [...team], roles: new Map(), spot, convoy,
      attack: false, alarm: false, since: this.time, firedAt: 0, allies: [],
    };
    team.forEach((c, k) => g.roles.set(c, k === 0 ? 'lead' : role));
    this.groups.push(g);
    this.stats.groups++;
    return g;
  }

  /** Место для второго/третьего в группе: кольцо ring якорей вокруг p, в городе. */
  groupSpot(p: Vec2, ring: readonly [number, number]): Vec2 {
    const { ctx } = this;
    for (let k = 0; k < 8; k++) {
      const a = randomAnchorAround(p, ctx, ring[0], ring[1], zoneIds(ctx, INSURGENCY.ambushAvoidZones));
      if (a >= 0 && ctx.map.levelAt(ctx.nav.worldX(a), ctx.nav.worldY(a)) === 'city') return { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
    }
    return p;
  }

  /** Дозорный заметил ВС — вся группа уходит. */
  groupAlarm(g: UndergroundGroup, by: Character): void {
    if (g.alarm) return;
    g.alarm = true;
    this.stats.alarms++;
    by.say(this.ctx.rng.pick(PARTISANS.lines.lookout), this.ctx.law.now, 2.5);
    this.say('дозорный заметил ВС — группа сворачивается.');
  }

  /** Засада: огонь по конвою. */
  groupAttack(g: UndergroundGroup, by: Character): void {
    if (g.attack) return;
    const { ctx } = this;
    g.attack = true;
    g.firedAt = this.time;
    this.stats.ambushes++;
    by.say(ctx.rng.pick(PARTISANS.lines.ambush), ctx.law.now, 2.5);
    // Открыли огонь средь бела дня — личины больше нет: враги Протектората, в розыске.
    for (const m of g.members) {
      ctx.combat.reveal(m, 'напали на конвой ВС');
      m.hostile = true;
      m.law.wanted = true;
    }
    ctx.law.log(`Склад Протектората: нападение на конвой (${g.convoy?.point.name ?? 'пункт боепитания'})!`, 'radio');
    ctx.war.raiseAlarm(by.x, by.y, 'нападение на конвой ВС', false);
    this.say(`засада — огонь по конвою ВС (${g.convoy?.point.name ?? 'склад'})!`);
  }

  // ——— Добыча и явки ———

  /**
   * Добыча (ящик со склада или с конвоя): в руки, и помечено — это нести на явку (Housing: тайник в
   * своей комнате в городе), а не оставлять себе. ammo — патроны к MP7 на mags магазинов.
   */
  haul(by: Character, kind: 'ammo' | 'grenades' | 'weapons', n: number, gun: WeaponId = 'mp7'): void {
    const W = WEAPONS.mp7;
    const [id, qty]: [ItemId, number] = kind === 'ammo' ? [AMMO_ITEM[W.ammo!], W.magazine * n] : kind === 'grenades' ? ['grenade', n] : [gun, n];
    const got = by.inventory.add(id, qty);
    if (got <= 0) return;
    const list = this.hauls.get(by) ?? [];
    const s = list.find((q) => q.id === id);
    if (s) s.qty += got;
    else list.push({ id, qty: got });
    this.hauls.set(by, list);
  }

  /** Несёт ли c добычу на явку. */
  carryingLoot(c: Character): boolean {
    return (this.hauls.get(c)?.length ?? 0) > 0 && !!this.ctx.housing?.stashOf(c);
  }

  /** Сложить добычу в тайник своей явки. Возвращает, сколько предметов спрятано. */
  stashLoot(c: Character): number {
    const st = this.ctx.housing?.stashOf(c);
    const list = this.hauls.get(c);
    this.hauls.delete(c);
    if (!st || !list) return 0;
    let n = 0;
    for (const q of list) {
      const k = Math.min(q.qty, c.inventory.count(q.id));
      if (k <= 0) continue;
      const put = st.add(q.id, k);
      if (put > 0) c.inventory.remove(q.id, put);
      n += put;
    }
    this.ctx.housing.stats.stashed += n;
    this.stats.stashed += n;
    if (n) this.say(`добыча спрятана на явке (${n} шт.) — пригодится.`);
    return n;
  }

  /**
   * Забрать с явки всё краденое для барыги (стволы, гранаты, патроны); вместе с добычей в руках.
   * Возвращает список (из тайника и инвентаря уже убрано).
   */
  bagForFence(c: Character, from: Dwelling | null = null): { id: ItemId; qty: number }[] {
    const bag: { id: ItemId; qty: number }[] = [];
    const st = from?.stash ?? this.ctx.housing?.stashOf(c);
    if (st) for (const s of st.takeAll()) bag.push({ id: s.id, qty: s.qty });
    const list = this.hauls.get(c);
    this.hauls.delete(c);
    for (const q of list ?? []) {
      const k = Math.min(q.qty, c.inventory.count(q.id));
      if (k > 0 && c.inventory.remove(q.id, k)) bag.push({ id: q.id, qty: k });
    }
    return bag;
  }

  /** Сделка у барыги: товар ему, выручка — подполью; с шансом — заказ банде удара по ВС. */
  dealWithFence(c: Character, bag: { id: ItemId; qty: number }[]): number {
    const { ctx } = this;
    const F = ctx.fence;
    if (!F) return 0;
    c.say(ctx.rng.pick(FENCE.lines.bring), ctx.law.now, 2.2);
    const pay = F.takeIn(bag);
    this.funds += pay;
    const D = FENCE.deal;
    if (this.funds >= D.order && ctx.rng.chance(D.orderChance)) {
      this.funds -= D.order;
      F.placeOrder();
      if (F.trader) F.trader.say(ctx.rng.pick(FENCE.lines.order), ctx.law.now + 1, 2.5);
      this.say('барыга передаст заказ банде — удар по ВС.');
    } else if (F.trader) F.trader.say(ctx.rng.pick(FENCE.lines.deal), ctx.law.now + 1, 2.5);
    this.stats.fenced += bag.reduce((n, q) => n + q.qty, 0);
    if (bag.length) this.say(`барыге сдано краденое (${bag.map((q) => q.qty).reduce((a, b) => a + b, 0)} шт.), выручка ${pay} ток.`);
    return pay;
  }

  /** Явка подполья, где в тайнике лежит краденое (для барыги), или null. */
  goodsStash(): Dwelling | null {
    const H = this.ctx.housing;
    if (!H) return null;
    for (const c of [...this.garrison, ...this.agents]) {
      const d = H.of(c);
      if (d?.stash?.slots.length) return d;
    }
    return null;
  }

  /** Взять из тайника своей явки (или любой явки подполья) предмет; true — взят. */
  fromStash(c: Character, id: ItemId, qty = 1): boolean {
    const H = this.ctx.housing;
    if (!H) return false;
    const own = H.stashOf(c);
    const st = own?.has(id, qty) ? own : H.dwellings.find((d) => d.stash?.has(id, qty))?.stash ?? null;
    if (!st) return false;
    st.remove(id, qty);
    H.stats.taken += qty;
    return true;
  }

  /** Забрать ящик, брошенный конвоем: патроны или гранаты — на явку. */
  lootCrate(by: Character, r = 34): boolean {
    const kind = this.ctx.arsenal?.lootConvoy(by, r);
    if (!kind) return false;
    const A = PARTISANS.ambush;
    if (kind === 'ammo') this.haul(by, 'ammo', A.mags);
    else if (kind === 'grenades') this.haul(by, 'grenades', A.grenades);
    else this.haul(by, 'weapons', 1);
    this.stats.looted++;
    by.say(this.ctx.rng.pick(PARTISANS.lines.loot), this.ctx.law.now, 2);
    this.say(`ящик с конвоя ВС у нас (${kind === 'ammo' ? 'патроны' : kind === 'grenades' ? 'гранаты' : 'стволы'}).`);
    return true;
  }

  /**
   * Место засады на пути конвоя: доля along от ведущего до пункта по прямой, ближайшее проходимое место в
   * городе вне Управы, КПП, запретной зоны и склада.
   */
  ambushSpot(v: Convoy): Vec2 | null {
    const { ctx } = this;
    const A = PARTISANS.ambush;
    const avoid = zoneIds(ctx, [...INSURGENCY.ambushAvoidZones, 'arsenal']);
    const from = v.lead;
    for (let k = 0; k < 10; k++) {
      const f = ctx.rng.range(A.along[0], A.along[1]);
      const x = from.x + (v.point.x - from.x) * f;
      const y = from.y + (v.point.y - from.y) * f;
      const a = randomAnchorAround({ x, y }, ctx, 0, 6, avoid);
      if (a < 0 || avoid.has(ctx.nav.zone[a])) continue;
      const q = { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
      if (ctx.map.levelAt(q.x, q.y) === 'city') return q;
    }
    return null;
  }

  /** Спецагент (из постоянного состава): в схроне, под видом горожанина. */
  adoptAgent(c: Character): void {
    if (!this.agents.includes(c)) this.agents.push(c);
    c.law.wanted = false;
    c.disguised = true;
    c.cover = null;
    this.ctx.combat.equip(c, null);
  }

  /** Заселить схрон: подпольщики, спецагент и торговец. Без канализации на карте — ничего. */
  populate(): void {
    if (!this.base) return;
    const { ctx } = this;
    for (let k = 0; k < ROSTER.partisans; k++) {
      spawnRole(ctx, { kind: 'partisan', faction: 'rebel', profession: 'partisan', division: null, rank: REBEL_UNIT.partisan, kit: 'rebel_partisan' });
    }
    for (let k = 0; k < ROSTER.agents; k++) {
      spawnRole(ctx, { kind: 'agent', faction: 'rebel', profession: 'spec_agent', division: null, rank: REBEL_UNIT.agent, kit: 'spec_agent' });
    }
    // Барыга — в своей хате у запретной зоны (нет её — у прилавка в канализации).
    const spot = ctx.fence?.spot ?? poiWorld(ctx, 'trader');
    if (spot && this.market) {
      const t = spawnRole(ctx, { kind: 'trader', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, spot);
      if (t) {
        t.name = `Барыга ${t.name.split(' ')[0]}`;
        if (t.role) t.role.name = t.name;
        // Живёт там же, где торгует.
        const home = ctx.fence?.home;
        if (home) {
          t.home = home.id;
          if (t.role) t.role.home = home.id;
        }
      }
    }
  }

  /** Связь сопротивления (слышит только игрок-повстанец). */
  radio(text: string): void {
    this.say(text);
  }

  private say(text: string): void {
    // Связь сопротивления слышит только игрок-повстанец.
    if (this.ctx.player?.faction === 'rebel') this.ctx.bus.emit('log', { text: `Сопротивление: ${text}`, kind: 'world' });
  }

  private idle(): Character[] {
    return this.garrison.filter((c) => c.alive && c.brain instanceof UndergroundBrain && c.brain.available && this.ctx.map.levelAt(c.x, c.y) === 'sewer');
  }

  // ——— Оружие бандитам ———

  /** Можно ли вооружить: бандит в городе, на свободе, не вооружён недавно и не на деле. */
  armable(b: Character): boolean {
    const last = this.armedAt.get(b) ?? -1e9;
    return (
      b.alive && b.faction === 'citizen' && b.profession === 'bandit' && b.law.phase === 'none' && !b.isPlayer &&
      !(b.brain instanceof HiredGunBrain) && this.time - last > PARTISANS.hired.time[1] && this.ctx.map.levelAt(b.x, b.y) === 'city'
    );
  }

  /** Партизан отдал бандиту ствол: тот идёт бить ВС (игроку-бандиту — просто ствол). */
  armBandit(from: Character, b: Character): boolean {
    const { ctx } = this;
    if (!b.alive || b.law.phase !== 'none') return false;
    const A = PARTISANS.arm;
    // Ствол — краденый MP7 Протектората с явки, если там есть; иначе трофейный из схрона.
    const stolen = this.fromStash(from, 'mp7');
    const gun = stolen ? 'mp7' : A.weapon;
    if (stolen) this.stats.fromStash++;
    b.inventory.add(gun, 1);
    const ammo = WEAPONS[gun].ammo;
    if (ammo) b.inventory.add(AMMO_ITEM[ammo], A.ammo);
    this.armedAt.set(b, this.time);
    this.stats.armed++;
    from.say(ctx.rng.pick(PARTISANS.lines.arm), ctx.law.now, 2.5);
    b.say(ctx.rng.pick(PARTISANS.lines.armed), ctx.law.now + 1.5, 2.5);
    if (!b.isPlayer) b.brain = new HiredGunBrain(b, ctx, b.brain);
    this.say(`${from.isPlayer ? 'вы передали' : 'подпольщик передал'} ствол бандиту — ВС получит своё чужими руками.`);
    if (b.isPlayer) ctx.bus.emit('log', { text: 'Подпольщик сунул вам трофейный MP7: «Для ВС. Не для прохожих.»', kind: 'world' });
    return true;
  }

  /** Начать операцию (или принудительно — для тестов и отладки). */
  startOperation(kind?: Operation['kind']): Operation | null {
    const { ctx } = this;
    // На дело — только под личиной и не в розыске (раскрытый ждёт в схроне новых документов).
    const free = this.idle().filter((c) => c.disguised && !c.law.wanted);
    if (free.length < 1) return null;
    const c = free[0];
    const brain = c.brain as UndergroundBrain;
    // Взлом — только если в КПЗ кто-то сидит (идти «на авось» к пустым камерам — верный арест).
    const cell = kind === 'jailbreak' ? this.occupiedCell() ?? ctx.law.cells.filter((q) => !q.prison).reduce<Cell | null>((a, c) => (!a || c.slots.length > a.slots.length ? c : a), null) : this.occupiedCell();
    // Краденое на явках — к барыге; нечего нести — за добычей на склад.
    const goods = this.goodsStash();
    const mineSpot = ctx.combat.mineKindOf(c) ? this.mineSpot() : null;
    let type = kind;
    // Свои в тюрьме Протектората — штурм тюрьмы всем подпольем (важнее прочих дел).
    if (type === 'prison' || (!type && this.prisonReady() && ctx.rng.chance(PRISON.assault.chance))) return this.startPrisonAssault();
    // Свой в КПЗ — сперва вытащить его (с шансом PARTISANS.rescueChance).
    if (!type && cell && this.jailbreakReady && this.comradeCaged() && ctx.rng.chance(PARTISANS.rescueChance)) type = 'jailbreak';
    // Конвой ВС на марше или на погрузке — засада (нужны двое).
    const convoy = ctx.arsenal?.present ? ctx.arsenal.convoys.find((v) => v.phase !== 'unload' && !this.groups.some((g) => g.convoy === v)) ?? null : null;
    if (!type) {
      // Доли операций; невозможные (некого освобождать, нечем минировать) — не выбираются.
      const O = PARTISANS.ops;
      const S = PARTISANS.supply;
      const depot = ctx.arsenal?.present ? O.depot * (goods ? 1 : S.depotMul) : 0;
      const ambush = convoy && free.length >= PARTISANS.ambush.size[0] ? O.ambush : 0;
      const opts: [Operation['kind'], number][] = [['arm', O.arm], ['fence', ctx.fence?.present && goods ? O.fence * S.fenceMul : 0], ['sabotage', O.sabotage], ['jailbreak', cell && this.jailbreakReady ? O.jailbreak : 0], ['mine', mineSpot ? O.mine : 0], ['depot', depot], ['ambush', ambush]];
      let r = ctx.rng.next() * opts.reduce((n, [, w]) => n + w, 0);
      type = 'sabotage';
      for (const [k, w] of opts) {
        if ((r -= w) <= 0 && w > 0) {
          type = k;
          break;
        }
      }
    }
    if (type === 'ambush') {
      const v = convoy ?? (ctx.arsenal?.present ? ctx.arsenal.convoys[0] ?? null : null);
      return v ? this.startAmbush(v) : null;
    } else if (type === 'jailbreak') {
      if (!cell) return null;
      this.jailbreakAt = this.time;
      brain.startJailbreak(c, ctx, cell);
      const where = 'КПЗ Управы';
      // Второй — прикрытие у камер (стоит рядом под личиной, отвечает, если стреляют).
      const team = free.length >= 2 ? [c, free[1]] : [c];
      const g = team.length > 1 ? this.formGroup('jailbreak', team, { x: cell.frontX, y: cell.frontY }, 'cover') : undefined;
      if (g) (team[1].brain as UndergroundBrain).startCover(team[1], ctx, g, this.groupSpot({ x: cell.frontX, y: cell.frontY }, PARTISANS.group.coverRing));
      this.op = { kind: 'jailbreak', team, where, group: g };
      this.ops.push(this.op);
      this.say(`${team.length > 1 ? 'двое идут' : 'подпольщик идёт'} вскрывать камеру — ${where}.`);
    } else if (type === 'mine') {
      if (!mineSpot) return null;
      brain.startMine(c, ctx, mineSpot);
      const where = ctx.map.zoneAtWorld(mineSpot.x, mineSpot.y)?.name ?? 'город';
      this.op = { kind: 'mine', team: [c], where };
      this.ops.push(this.op);
      this.say(`подпольщик идёт ставить растяжку — ${where}.`);
    } else if (type === 'depot') {
      // Склад Протектората на окраине: в робе грузчика ТС — кража, брак в патроны, заряд, маяк.
      const job = ctx.arsenal?.pickSabotage(c, !goods);
      if (!job) return null;
      c.cover = { faction: 'cwu', rank: 0, profession: 'loader', name: c.cover?.name ?? null };
      brain.startDepot(c, ctx, job.act, job.spot);
      const what = { steal: 'унести ящик', taint: 'подмешать брак в патроны', bomb: 'заложить заряд у зала', beacon: 'испортить маяк площадки' }[job.act];
      this.op = { kind: 'depot', team: [c], where: 'склад Протектората' };
      this.ops.push(this.op);
      this.say(`подпольщик в робе грузчика идёт на склад Протектората — ${what}.`);
    } else if (type === 'sabotage') {
      const nodes = ctx.economy.nodes.filter((n) => !n.broken);
      if (!nodes.length) return null;
      const node = ctx.rng.pick(nodes);
      const n = Math.min(free.length, ctx.rng.int(INSURGENCY.sabotageTeam[0], INSURGENCY.sabotageTeam[1]));
      const team = free.slice(0, n);
      // Первый ломает узел, остальные — дозор вокруг: заметили ВС — «шухер», все уходят.
      const g = team.length > 1 ? this.formGroup('sabotage', team, { x: node.x, y: node.y }, 'lookout') : undefined;
      (team[0].brain as UndergroundBrain).startSabotage(team[0], ctx, node);
      if (g) for (const m of team.slice(1)) (m.brain as UndergroundBrain).startCover(m, ctx, g, this.groupSpot({ x: node.x, y: node.y }, PARTISANS.group.lookoutRing));
      const where = ctx.map.zoneAtWorld(node.x, node.y)?.name ?? 'город';
      this.op = { kind: 'sabotage', team, where, group: g };
      this.ops.push(this.op);
      this.say(`${team.length > 1 ? `группа (${team.length}) вышла` : 'подпольщик вышел'} на саботаж узла Протектората — ${where}.`);
    } else if (type === 'fence') {
      // Вся связь с улицей — через барыгу: краденое с явки ему, а он передаст заказ банде.
      if (!ctx.fence?.present) return null;
      brain.startFence(c, ctx, goods);
      this.op = { kind: 'fence', team: [c], where: 'хата барыги' };
      this.ops.push(this.op);
      this.say('подпольщик несёт краденое барыге.');
    } else {
      const bandits = ctx.entities.list.filter((b) => this.armable(b));
      if (!bandits.length) return null;
      bandits.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
      const target = bandits[0];
      brain.startArm(c, ctx, target);
      const where = ctx.map.zoneAtWorld(target.x, target.y)?.name ?? 'город';
      this.op = { kind: 'arm', team: [c], where };
      this.ops.push(this.op);
      this.say(`подпольщик несёт ствол бандиту — ${where}.`);
    }
    this.operations++;
    return this.op;
  }

  /**
   * Засада на конвой v: свободные подпольщики (от size[0] до size[1]) берут в схроне автоматы и идут
   * к месту на пути колонны (spot — или выбрать самим). Операция или null.
   */
  startAmbush(v: Convoy, at: Vec2 | null = null): Operation | null {
    const { ctx } = this;
    const A = PARTISANS.ambush;
    const free = this.idle().filter((c) => c.disguised && !c.law.wanted);
    const spot = at ?? this.ambushSpot(v);
    if (!spot || free.length < A.size[0]) return null;
    // На конвой из четырёх ВС — всеми, кто свободен (не больше size[1]).
    const team = free.slice(0, Math.min(free.length, A.size[1]));
    const g = this.formGroup('ambush', team, spot, 'cover', v);
    for (const m of team) {
      // Из схрона на засаду — автомат (патроны к нему — там же).
      if (!m.inventory.has(A.weapon)) m.inventory.add(A.weapon, 1);
      const ammo = WEAPONS[A.weapon].ammo;
      if (ammo && m.inventory.count(AMMO_ITEM[ammo]) < A.ammo) m.inventory.add(AMMO_ITEM[ammo], A.ammo - m.inventory.count(AMMO_ITEM[ammo]));
      if (m.inventory.count('grenade') < A.volley) m.inventory.add('grenade', A.volley - m.inventory.count('grenade'));
      (m.brain as UndergroundBrain).startAmbush(m, ctx, m === team[0] ? spot : this.groupSpot(spot, PARTISANS.group.coverRing));
    }
    const where = ctx.map.zoneAtWorld(spot.x, spot.y)?.name ?? 'город';
    this.op = { kind: 'ambush', team, where, group: g };
    this.ops.push(this.op);
    this.operations++;
    this.say(`группа (${team.length}) идёт в засаду на конвой ВС — ${where}.`);
    return this.op;
  }

  /** Одиночная вылазка из убежища. */
  startOuting(kind?: 'tunnels' | 'market' | 'scout'): boolean {
    const { ctx } = this;
    const free = this.idle();
    if (free.length <= INSURGENCY.minAtBase || !ctx.map.hatches.length) return false;
    const K = INSURGENCY.outingKinds;
    const roll = ctx.rng.next();
    const type = kind ?? (roll < K.tunnels ? 'tunnels' : roll < K.tunnels + K.market ? 'market' : 'scout');
    const h = ctx.rng.pick(ctx.map.hatches);
    let to: { x: number; y: number } | null = null;
    let what = '';
    if (type === 'tunnels') {
      to = h.sewer;
      what = 'обход';
    } else if (type === 'market' && this.sewerMarket) {
      to = this.sewerMarket;
      what = 'рынок';
    } else {
      // Разведка: точка в городе недалеко от люка.
      const a = randomAnchorAround(h.city, ctx, INSURGENCY.scoutRadius[0], INSURGENCY.scoutRadius[1], zoneIds(ctx, INSURGENCY.ambushAvoidZones));
      to = a >= 0 ? { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) } : h.city;
      what = 'разведка';
    }
    if (!to) return false;
    const c = ctx.rng.pick(free);
    (c.brain as UndergroundBrain).startOuting(c, ctx, to, what);
    this.outings++;
    return true;
  }

  // ——— Спецагент ———

  /** Можно ли спецагенту выходить на миссии. */
  canRunAgent(): boolean {
    return !this.paused;
  }

  /** Взлом КПЗ (партизаны и агенты) — не чаще раза в PARTISANS.jailCooldown с. */
  get jailbreakReady(): boolean {
    return this.time - this.jailbreakAt >= PARTISANS.jailCooldown;
  }

  /** Отметить начатый взлом (агент). */
  markJailbreak(): void {
    this.jailbreakAt = this.time;
  }

  /** Сидит ли в КПЗ Управы подпольщик или спецагент (тюрьму берут штурмом — prisonReady). */
  comradeCaged(): boolean {
    return this.ctx.law.cells.some((c) => !c.prison && c.slots.some((s) => s.occupant && isUnderground(s.occupant)));
  }

  /**
   * Пора штурмовать тюрьму: тюрьма есть, в ней свой подпольщик (или не меньше PRISON.assault.minArmy
   * бойцов армии), взлома давно не было и свободных подпольщиков и спецагентов хватает на группу.
   */
  prisonReady(): boolean {
    const { ctx } = this;
    if (!ctx.prison?.present || !this.jailbreakReady) return false;
    const jailed = ctx.law.imprisoned();
    if (!jailed.some(isUnderground) && jailed.filter(isArmy).length < PRISON.assault.minArmy) return false;
    return this.prisonTeam().length >= PRISON.assault.team[0];
  }

  /** Кто пойдёт на тюрьму: свободные подпольщики под личиной и спецагенты в схроне. */
  private prisonTeam(): Character[] {
    const free = this.idle().filter((c) => c.disguised && !c.law.wanted);
    const agents = this.agents.filter((a) => a.alive && !a.isPlayer && a.brain instanceof AgentBrain && a.brain.mode === 'base' && a.law.phase === 'none' && !a.law.wanted);
    return [...free, ...agents].slice(0, PRISON.assault.team[1]);
  }

  /**
   * Штурм тюрьмы Протектората: вся группа через люки к месту сбора у ворот тюрьмы (под личиной), по сигналу
   * ведущего — огонь, двери камер выбиваются одна за другой (UndergroundBrain / AgentBrain + PrisonAssault).
   */
  startPrisonAssault(): Operation | null {
    const { ctx } = this;
    const gate = ctx.law.prisonGate;
    if (!ctx.prison?.present || !gate) return null;
    const team = this.prisonTeam();
    if (team.length < PRISON.assault.team[0]) return null;
    const P = PRISON.assault;
    const avoid = zoneIds(ctx, INSURGENCY.ambushAvoidZones);
    let center: Vec2 = gate;
    for (let k = 0; k < 10; k++) {
      const a = randomAnchorAround(gate, ctx, P.gather[0], P.gather[1], avoid);
      if (a >= 0 && ctx.map.levelAt(ctx.nav.worldX(a), ctx.nav.worldY(a)) === 'city') {
        center = { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
        break;
      }
    }
    this.jailbreakAt = this.time;
    const g = this.formGroup('prison', team, center, 'cover');
    team.forEach((c, k) => {
      const spot = k === 0 ? center : this.groupSpot(center, [1, 3]);
      // Из схрона — автомат с патронами, гранаты, бронежилет под куртку и шлем.
      const A = PARTISANS.ambush;
      if (!c.inventory.has(A.weapon)) {
        c.inventory.add(A.weapon, 1);
        const ammo = WEAPONS[A.weapon].ammo;
        if (ammo) c.inventory.add(AMMO_ITEM[ammo], A.ammo);
      }
      const need = P.grenades - c.inventory.count('grenade');
      if (need > 0) c.inventory.add('grenade', need);
      if (!c.gear.torso && c.inventory.add(P.vest, 1) > 0) wear(c, P.vest);
      if (!c.gear.head && c.inventory.add(P.helmet, 1) > 0) wear(c, P.helmet);
      const b = c.brain;
      if (b instanceof UndergroundBrain) b.startPrison(c, ctx, spot);
      else if (b instanceof AgentBrain) b.joinPrison(c, ctx, spot);
    });
    const op: Operation = { kind: 'prison', team, where: 'тюрьма Протектората', group: g };
    this.op = op;
    this.ops.push(op);
    this.operations++;
    ctx.prison.stats.assaults++;
    this.say(`все свободные (${team.length}) идут на тюрьму Протектората — вызволять наших!`);
    return op;
  }

  /** Сигнал штурма тюрьмы: личины долой, враги Протектората, тревога. */
  prisonAttack(g: UndergroundGroup, by: Character): void {
    if (g.attack) return;
    const { ctx } = this;
    g.attack = true;
    g.firedAt = this.time;
    by.say(ctx.rng.pick(PRISON.lines.assault), ctx.law.now, 2.5);
    for (const m of g.members) {
      ctx.combat.reveal(m, 'штурм тюрьмы');
      m.hostile = true;
      m.law.wanted = true;
      const w = ctx.combat.bestWeapon(m, 200);
      if (w) ctx.combat.equip(m, w);
    }
    ctx.law.log('Тюрьма Протектората: вооружённое нападение! Охрана — к бою!', 'radio');
    ctx.war.raiseAlarm(by.x, by.y, 'нападение на тюрьму', false);
    this.say('штурм тюрьмы — выбиваем двери камер!');
  }

  /** Занятая камера КПЗ Управы (со своими — первыми); тюрьму берут только штурмом. */
  occupiedCell(): Cell | null {
    const cells = this.ctx.law.cells;
    const comrade = (c: Cell) => c.slots.some((s) => s.occupant && isUnderground(s.occupant));
    // Свои в камере — первыми; иначе больше всего сидящих (общая КПЗ).
    let best: Cell | null = null;
    let bestScore = 0;
    for (const c of cells) {
      if (c.prison) continue;
      const n = c.slots.filter((s) => s.occupant).length;
      if (!n) continue;
      const score = n + (comrade(c) ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /**
   * Куда поставить растяжку: свежее тело сотрудника Протектората в городе (не под оцеплением), у ворот
   * Управы, у выхода проходной КПП в город или там, где сейчас патрульный ВС.
   */
  mineSpot(): Vec2 | null {
    const { ctx } = this;
    const out: Vec2[] = [];
    for (const k of ctx.combat.corpses) {
      if (!FACTIONS[k.faction].authority || k.burning || ctx.war.scenes.sealed(k) || ctx.map.levelAt(k.x, k.y) !== 'city') continue;
      if (!ctx.combat.mines.some((m) => m.corpse === k)) out.push({ x: k.x, y: k.y });
    }
    // Не в зоны, куда горожанину нельзя (склад, тюрьма, запретная зона…): там задержат у входа.
    const avoid = new Set<string>(PARTISANS.mineAvoid);
    const allowed = (x: number, y: number) => ctx.map.levelAt(x, y) === 'city' && !avoid.has(ctx.map.zoneAtWorld(x, y)?.kind ?? '');
    const ring = (p: Vec2 | null) => {
      if (!p) return;
      const a = randomAnchorAround(p, ctx, PARTISANS.mineRing[0], PARTISANS.mineRing[1], new Set());
      if (a >= 0 && allowed(ctx.nav.worldX(a), ctx.nav.worldY(a))) out.push({ x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) });
    };
    ring(poiWorld(ctx, 'nexus_gate'));
    for (const f of ctx.war.fronts) ring(f.apron);
    const cps = ctx.entities.list.filter((o) => o.alive && o.faction === 'cp' && allowed(o.x, o.y));
    if (cps.length) ring(ctx.rng.pick(cps));
    if (!out.length) return null;
    // Идти через полгорода под личиной — много проверок: из двух случайных мест — ближнее к люку.
    const hatch = (p: Vec2) => Math.min(...ctx.map.hatches.map((h) => Math.hypot(h.city.x - p.x, h.city.y - p.y)));
    const a = ctx.rng.pick(out);
    const b = ctx.rng.pick(out);
    return ctx.map.hatches.length && hatch(b) < hatch(a) ? b : a;
  }

  /** Переодеться в убитого (форма с тела). */
  dressAs(c: Character, corpse: Corpse): void {
    corpse.stripped = true;
    c.disguised = true;
    c.cover = { faction: corpse.faction, rank: corpse.rank, profession: corpse.profession, name: corpse.name };
    this.ctx.combat.equip(c, null);
    c.say(this.ctx.rng.pick(PARTISANS.lines.agent), this.ctx.law.now, 2);
    this.say(`спецагент ${c.isPlayer ? '(вы) ' : ''}переоделся в форму убитого: ${corpse.name}.`);
  }

  /** Спецагент раскрыл себя (покушение): враг Протектората, в розыске. */
  revealAgent(c: Character, why: string): void {
    this.ctx.combat.reveal(c, why);
    c.hostile = true;
    c.law.wanted = true;
  }

  /** Взлом камеры КПЗ или тюрьмы: все сидевшие сбегают, тревога. Возвращает, сколько сбежало. */
  jailbreak(by: Character, cell: Cell): number {
    const { ctx } = this;
    const n = ctx.law.breakCell(cell);
    if (n <= 0) return 0;
    this.stats.jailbreaks++;
    if (cell.prison && ctx.prison) {
      if (isArmy(by)) ctx.prison.stats.freedByArmy += n;
      else ctx.prison.stats.freedByUnderground += n;
    }
    ctx.law.log(`${cell.prison ? 'Тюрьма Протектората: дверь камеры выбита' : 'Управа: дверь камеры КПЗ выбита'} — сбежали ${n}!`, 'radio');
    ctx.war.raiseAlarm(cell.x, cell.y, cell.prison ? 'побег из тюрьмы' : 'побег из КПЗ Управы');
    this.say(`${by.isPlayer ? 'вы вскрыли' : by.profession === 'partisan' ? 'подпольщик вскрыл' : 'спецагент вскрыл'} камеру — наши на свободе (${n}).`);
    return n;
  }

  /** Бунт: горожане вокруг бегают и кричат лозунги (нарушение для ВС), тревога. Возвращает, сколько подняли. */
  startRiot(by: Character, x: number, y: number): number {
    const { ctx } = this;
    const R = PARTISANS.riot;
    const until = ctx.law.now + R.time;
    let n = 0;
    for (const c of ctx.entities.near(x, y, R.radius, near)) {
      if (n >= R.count) break;
      if (!c.alive || c.isPlayer || c.faction !== 'citizen' || c.law.phase !== 'none' || !(c.brain instanceof CitizenBrain)) continue;
      if (c.brain.startRiot(c, { x, y }, until)) n++;
    }
    if (n <= 0) return 0;
    this.stats.riots++;
    by.say(ctx.rng.pick(PARTISANS.lines.riot), ctx.law.now, 2.5);
    ctx.law.log(`Беспорядки: ${n} горожан бунтуют — ${ctx.map.zoneAtWorld(x, y)?.name ?? 'город'}!`, 'radio');
    ctx.war.raiseAlarm(x, y, 'беспорядки в городе');
    return n;
  }

  // ——— Допрос и рейд ———

  /**
   * Допрос подпольщиков в тюрьме: начальник тюрьмы (SU.INSP, служба warden) у двери камеры — боль и
   * вопросы; раскололся — выдал своего.
   */
  private interrogate(dt: number): void {
    const { ctx } = this;
    const I = PARTISANS.interrogation;
    const now = ctx.law.now;
    for (const cell of ctx.law.cells) {
      if (!cell.prison) continue;
      for (const s of cell.slots) {
        const p = s.occupant;
        if (!p || !isUnderground(p)) continue;
        let epu: Character | null = null;
        for (const o of ctx.entities.near(cell.frontX, cell.frontY, I.reach, near)) {
          if (o.fit && o.faction === 'cp' && (o.brain as CpBrain | null)?.duty === 'warden') {
            epu = o;
            break;
          }
        }
        if (!epu) continue;
        let q = this.questioning.get(p);
        if (!q) {
          q = { t: 0, next: 0, broke: false };
          this.questioning.set(p, q);
          this.stats.interrogations++;
          ctx.law.log(`${epu.name} допрашивает пленного подпольщика в тюрьме Протектората.`, 'radio');
        }
        q.t += dt;
        if (q.t >= q.next) {
          q.next = q.t + I.every;
          epu.say(ctx.rng.pick(PARTISANS.lines.epu), now, 3);
          p.say(ctx.rng.pick(PARTISANS.lines.prisoner), now + 1.2, 2.5);
          p.health = Math.max(p.maxHealth * I.minHealth, p.health - I.damage);
        }
        if (!q.broke && q.t >= I.time) {
          q.broke = true;
          this.stats.broke++;
          p.say(ctx.rng.pick(PARTISANS.lines.broke), now, 3);
          // Выдал личину другого подпольщика (или спецагента) — того, кто сейчас в схроне (кто на деле, того
          // пленный не знает, где искать): в следующий раз его узнают в лицо.
          const other = [...this.garrison, ...this.agents].find((o) => o !== p && o.alive && o.disguised && o.law.phase === 'none' && !onJob(o));
          if (other) {
            other.disguised = false;
            other.cover = null;
            other.law.wanted = true;
            ctx.law.log(`Допрос: пленный выдал подпольщика — ${other.name} объявлен(а) в розыск.`, 'radio');
          }
        }
      }
    }
    for (const p of [...this.questioning.keys()]) if (!p.alive || p.law.phase === 'none') this.questioning.delete(p);
  }

  /** Сколько подпольщиков сейчас в тюрьме. */
  cagedPartisans(): number {
    return this.ctx.law.imprisoned().filter((c) => c.profession === 'partisan').length;
  }

  /** Рейд: гарнизоны КПП (SU) и резерв OTA выходят за стену на лагерь сопротивления. */
  startRaid(): boolean {
    const { ctx } = this;
    const camp = poiWorld(ctx, 'rebel_camp');
    if (!camp || this.raid) return false;
    const R = PARTISANS.raid;
    const force: Character[] = [];
    const spot = (): Vec2 => {
      const a = randomAnchorAround(camp, ctx, R.ring[0], R.ring[1], new Set());
      return a >= 0 ? { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) } : camp;
    };
    for (const c of ctx.entities.list) {
      if (!c.alive || c.law.phase !== 'none') continue;
      const b = c.brain;
      if (b instanceof CpBrain && c.role?.kind === 'guard') {
        b.raidPost = spot();
        force.push(c);
      } else if (b instanceof OtaBrain && b.available) {
        const p = spot();
        b.assignPost(-1, p, Math.atan2(camp.y - p.y, camp.x - p.x));
        force.push(c);
      }
    }
    if (!force.length) return false;
    this.raid = { until: this.time + R.duration, force };
    this.stats.raids++;
    const lead = force.find((c) => c.faction === 'cp') ?? force[0];
    lead.say(PARTISANS.lines.raid[0], ctx.law.now, 3);
    ctx.law.log(`Допрос: подпольщики в тюрьме раскололись — логово найдено! Гарнизоны КПП и легионеры (${force.length}) штурмуют лагерь сопротивления.`, 'radio');
    ctx.bus.emit('announce', { text: 'ВС штурмует лагерь сопротивления' });
    this.say('Стража и Легион идут на лагерь! Все к оружию!');
    return true;
  }

  private endRaid(): void {
    const r = this.raid;
    if (!r) return;
    for (const c of r.force) {
      const b = c.brain;
      if (b instanceof CpBrain) b.raidPost = null;
      else if (b instanceof OtaBrain && b.front === -1) b.goHome();
    }
    this.raid = null;
    this.ctx.law.log('Штурм лагеря окончен: силы Протектората возвращаются на посты.', 'radio');
  }

  /** Сухпаёк с собой из схрона — до PARTISANS.cacheFood пайков. */
  private packFood(c: Character): void {
    const need = PARTISANS.cacheFood - c.inventory.count('ration');
    if (need > 0) c.inventory.add('ration', need);
  }

  update(dt: number): void {
    this.time += dt;
    const { ctx } = this;
    for (let i = this.garrison.length - 1; i >= 0; i--) if (!this.garrison[i].alive) this.garrison.splice(i, 1);
    for (let i = this.agents.length - 1; i >= 0; i--) if (!this.agents[i].alive) this.agents.splice(i, 1);
    this.interrogate(dt);
    // Вернувшийся в схрон раскрытый подпольщик (не в розыске) — снова под личиной; тайник пополняет гранаты.
    for (const c of this.garrison) {
      if (c.brain instanceof UndergroundBrain && c.brain.mode === 'base' && ctx.map.levelAt(c.x, c.y) === 'sewer') {
        const need = PARTISANS.cacheGrenades - c.inventory.count('grenade');
        if (need > 0) c.inventory.add('grenade', need);
        ctx.economy.feed(c, ECONOMY.meals.cache, dt);
        this.packFood(c);
      }
      // Раскрытый или в розыске — в схроне новые документы и личина (иначе в город его не выпустить).
      // Документы делают не сразу: PARTISANS.newPapers с в схроне.
      if ((!c.disguised || c.law.wanted) && c.law.phase === 'none' && c.brain instanceof UndergroundBrain && c.brain.mode === 'base' && ctx.map.levelAt(c.x, c.y) === 'sewer') {
        const since = this.papers.get(c) ?? this.time;
        this.papers.set(c, since);
        if (this.time - since >= PARTISANS.newPapers) {
          this.papers.delete(c);
          c.law.wanted = false;
          c.hostile = false;
          this.giveCover(c);
        }
      } else this.papers.delete(c);
    }
    // Спецагент в схроне — новые документы: снова чист и под личиной; там же и поесть.
    for (const ag of this.agents) {
      if (ctx.map.levelAt(ag.x, ag.y) === 'sewer' && (ag.brain as AgentBrain | null)?.mode === 'base') {
        ctx.economy.feed(ag, ECONOMY.meals.cache, dt);
        this.packFood(ag);
      }
      if (!ag.isPlayer && (!ag.disguised || ag.law.wanted) && ag.law.phase === 'none' && ctx.map.levelAt(ag.x, ag.y) === 'sewer' && (ag.brain as AgentBrain | null)?.mode === 'base') {
        ag.law.wanted = false;
        ag.hostile = false;
        this.adoptAgent(ag);
      }
    }
    // Группы: погибших и вернувшихся — из группы; никого на деле — группа распущена.
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i];
      g.members = g.members.filter((c) => c.alive && onJob(c));
      if (!g.members.length) this.groups.splice(i, 1);
      else if (!g.members.includes(g.lead)) g.lead = g.members[0];
    }
    // Подпольщиков в тюрьме не меньше raid.caged (двое из трёх) — рейд на логово; по времени — назад.
    // Один рейд на каждый такой раз.
    const allCaged = ROSTER.partisans > 0 && this.cagedPartisans() >= Math.min(ROSTER.partisans, PARTISANS.raid.caged);
    if (!allCaged) this.raidArmed = true;
    else if (!this.raid && this.raidArmed && this.startRaid()) this.raidArmed = false;
    if (this.raid && this.time >= this.raid.until) this.endRaid();
    if (!this.base) return;
    if (this.paused) return;
    // Вылазки: убежище живёт — ходят по тоннелям, на рынок, наверх через люки.
    if (this.time >= this.nextOuting) {
      this.nextOuting = this.time + ctx.rng.range(INSURGENCY.outingEvery[0], INSURGENCY.outingEvery[1]);
      this.startOuting();
    }
    // Подпольщики и спецагент в городе при тревоге — «нападавшие» (раскрытые).
    for (const c of [...this.garrison, ...this.agents]) {
      const b = c.brain;
      if (b instanceof UndergroundBrain && b.mode === 'base') continue;
      if (!c.disguised && ctx.map.levelAt(c.x, c.y) === 'city' && ctx.war.code !== 'green') ctx.war.operatives.add(c);
    }
    // Операции кончаются, когда все вернулись или погибли; новая — когда подошёл срок и есть свободный.
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      const active = op.team.filter((c) => c.alive && onJob(c));
      if (active.length > 0) continue;
      const alive = op.team.filter((c) => c.alive).length;
      this.say(op.team.length > 1 ? `группа вернулась (${alive} из ${op.team.length}).` : `подпольщик вернулся (${alive} из ${op.team.length}).`);
      if (op.group) {
        const gi = this.groups.indexOf(op.group);
        if (gi >= 0) this.groups.splice(gi, 1);
      }
      this.ops.splice(i, 1);
      if (this.op === op) this.op = null;
    }
    if (this.time >= this.nextOp) {
      this.nextOp = this.time + (this.startOperation() ? ctx.rng.range(INSURGENCY.opEvery[0], INSURGENCY.opEvery[1]) : 10);
    }
  }
}

const near: Character[] = [];

/** Подпольщик или спецагент на деле (не в схроне). */
function onJob(c: Character): boolean {
  const b = c.brain;
  return (b instanceof UndergroundBrain || b instanceof AgentBrain) && b.mode !== 'base';
}
