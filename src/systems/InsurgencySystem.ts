import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { Vec2 } from '../core/math';
import type { Corpse } from './CombatSystem';
import { isUnderground, type Cell } from './LawSystem';
import { INSURGENCY, PARTISANS } from '../config/underground';
import { AMMO_ITEM, WEAPONS } from '../config/items';
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
import { randomAnchorAround, zoneIds } from '../ai/destinations';

/** Текущая операция подпольщиков в городе. */
export interface Operation {
  kind: 'sabotage' | 'arm' | 'jailbreak' | 'mine';
  team: Character[];
  where: string;
}

/** Рейд ГО на логово сопротивления (оба подпольщика в клетках). */
export interface Raid {
  until: number;
  force: Character[];
}

/**
 * Сопротивление под городом: схрон в канализации, торговец чёрного рынка, два подпольщика и
 * спецагент (config/underground.ts, PARTISANS). Подпольщики всегда в личине горожанина или рабочего
 * ГСР, огня не открывают: выходят через люк саботировать узлы Альянса и раздавать оружие бандитам —
 * те идут на ГО чужими руками (HiredGunBrain). Раскрытого партизана сажают в клетку в кабинете
 * Администратора: CMD.EPU допрашивает (боль, реплики) — расколовшийся выдаёт личину другого. Оба
 * подпольщика в клетках — гарнизоны КПП и резерв OTA идут штурмовать лагерь сопротивления.
 * Спецагент (AgentBrain) — переодевания, покушения, взлом КПЗ, бунты (startRiot).
 */
export class InsurgencySystem {
  readonly base: Vec2 | null;
  readonly cache: Vec2 | null;
  readonly market: Vec2 | null;
  readonly garrison: Character[] = [];
  agent: Character | null = null;
  trader: Character | null = null;
  /** Идущие операции (у каждого подпольщика — своя); op — последняя начатая. */
  readonly ops: Operation[] = [];
  /** Сколько операций начато (для тестов и отладки). */
  operations = 0;
  /** С какого времени подпольщику в схроне делают новые документы. */
  private readonly papers = new Map<Character, number>();
  op: Operation | null = null;
  raid: Raid | null = null;
  /** Рейд ещё не было за этот раз (оба подпольщика в клетках). */
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
  stats = { armed: 0, interrogations: 0, broke: 0, raids: 0, riots: 0, jailbreaks: 0 };
  /** Кому и когда отдали ствол (не вооружать одного и того же подряд). */
  private armedAt = new Map<Character, number>();
  /** Допрос: сколько секунд и когда следующая реплика; раскололся ли. */
  private questioning = new Map<Character, { t: number; next: number; broke: boolean }>();

  constructor(private readonly ctx: AiContext) {
    this.base = poiWorld(ctx, 'rebel_base');
    this.cache = poiWorld(ctx, 'rebel_cache');
    this.market = poiWorld(ctx, 'black_market');
    this.nextOp = ctx.rng.range(INSURGENCY.firstOp[0], INSURGENCY.firstOp[1]);
  }

  get now(): number {
    return this.time;
  }

  /** Подпольщик (из постоянного состава) — в гарнизон схрона, в личине горожанина или ГСР. */
  adopt(c: Character): void {
    this.garrison.push(c);
    // Под личиной — «чистые» поддельные документы: не в розыске.
    c.law.wanted = false;
    this.giveCover(c);
  }

  /** Новая личина (горожанин или рабочий ГСР): при появлении и после возвращения в схрон. */
  giveCover(c: Character): void {
    c.disguised = true;
    const cwu = this.ctx.rng.chance(PARTISANS.cwuCoverShare);
    this.ctx.combat.equip(c, null);
    c.cover = { faction: cwu ? 'cwu' : 'citizen', rank: 0, profession: cwu ? 'janitor' : 'citizen', name: null };
  }

  /** Спецагент (из постоянного состава): в схроне, под видом горожанина. */
  adoptAgent(c: Character): void {
    this.agent = c;
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
    const spot = poiWorld(ctx, 'trader');
    if (spot && this.market) {
      const t = spawnRole(ctx, { kind: 'trader', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, spot);
      if (t) {
        t.name = `Барыга ${t.name.split(' ')[0]}`;
        if (t.role) t.role.name = t.name;
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

  /** Партизан отдал бандиту ствол: тот идёт бить ГО (игроку-бандиту — просто ствол). */
  armBandit(from: Character, b: Character): boolean {
    const { ctx } = this;
    if (!b.alive || b.law.phase !== 'none') return false;
    const A = PARTISANS.arm;
    b.inventory.add(A.weapon, 1);
    const ammo = WEAPONS[A.weapon].ammo;
    if (ammo) b.inventory.add(AMMO_ITEM[ammo], A.ammo);
    this.armedAt.set(b, this.time);
    this.stats.armed++;
    from.say(ctx.rng.pick(PARTISANS.lines.arm), ctx.law.now, 2.5);
    b.say(ctx.rng.pick(PARTISANS.lines.armed), ctx.law.now + 1.5, 2.5);
    if (!b.isPlayer) b.brain = new HiredGunBrain(b, ctx, b.brain);
    this.say(`${from.isPlayer ? 'вы передали' : 'подпольщик передал'} ствол бандиту — ГО получит своё чужими руками.`);
    if (b.isPlayer) ctx.bus.emit('log', { text: 'Подпольщик сунул вам трофейный MP7: «Для ГО. Не для прохожих.»', kind: 'world' });
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
    // Сидящих нет — всё равно к общей камере: пока дойдёт, кого-нибудь приведут (подождёт jailWait с).
    const cell = this.occupiedCell() ?? ctx.law.cells.reduce<Cell | null>((a, c) => (!a || c.slots.length > a.slots.length ? c : a), null);
    const mineSpot = ctx.combat.mineKindOf(c) ? this.mineSpot() : null;
    let type = kind;
    // Свой в клетке — сперва вытащить его (с шансом PARTISANS.rescueChance).
    if (!type && cell && this.comradeCaged() && ctx.rng.chance(PARTISANS.rescueChance)) type = 'jailbreak';
    if (!type) {
      // Доли операций; невозможные (некого освобождать, нечем минировать) — не выбираются.
      const O = PARTISANS.ops;
      const opts: [Operation['kind'], number][] = [['arm', O.arm], ['sabotage', O.sabotage], ['jailbreak', cell ? O.jailbreak : 0], ['mine', mineSpot ? O.mine : 0]];
      let r = ctx.rng.next() * opts.reduce((n, [, w]) => n + w, 0);
      type = 'sabotage';
      for (const [k, w] of opts) {
        if ((r -= w) <= 0 && w > 0) {
          type = k;
          break;
        }
      }
    }
    if (type === 'jailbreak') {
      if (!cell) return null;
      brain.startJailbreak(c, ctx, cell);
      const where = cell.cage ? 'клетка у Администратора' : 'КПЗ Нексуса';
      this.op = { kind: 'jailbreak', team: [c], where };
      this.ops.push(this.op);
      this.say(`подпольщик идёт вскрывать камеру — ${where}.`);
    } else if (type === 'mine') {
      if (!mineSpot) return null;
      brain.startMine(c, ctx, mineSpot);
      const where = ctx.map.zoneAtWorld(mineSpot.x, mineSpot.y)?.name ?? 'город';
      this.op = { kind: 'mine', team: [c], where };
      this.ops.push(this.op);
      this.say(`подпольщик идёт ставить растяжку — ${where}.`);
    } else if (type === 'sabotage') {
      const nodes = ctx.economy.nodes.filter((n) => !n.broken);
      if (!nodes.length) return null;
      const node = ctx.rng.pick(nodes);
      const n = Math.min(free.length, ctx.rng.int(INSURGENCY.sabotageTeam[0], INSURGENCY.sabotageTeam[1]));
      const team = free.slice(0, n);
      for (const m of team) (m.brain as UndergroundBrain).startSabotage(m, ctx, node);
      const where = ctx.map.zoneAtWorld(node.x, node.y)?.name ?? 'город';
      this.op = { kind: 'sabotage', team, where };
      this.ops.push(this.op);
      this.say(`подпольщик вышел на саботаж узла Альянса — ${where}.`);
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

  /** Сидит ли в камере или клетке подпольщик или спецагент. */
  comradeCaged(): boolean {
    return this.ctx.law.cells.some((c) => c.slots.some((s) => s.occupant && (s.occupant.profession === 'partisan' || s.occupant.profession === 'spec_agent')));
  }

  /** Занятая камера или клетка (клетки со своими — первыми). */
  occupiedCell(): Cell | null {
    const cells = this.ctx.law.cells;
    const comrade = (c: Cell) => c.slots.some((s) => s.occupant && isUnderground(s.occupant));
    // Свои в клетке или камере — первыми; иначе больше всего сидящих (общая КПЗ).
    let best: Cell | null = null;
    let bestScore = 0;
    for (const c of cells) {
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
   * Куда поставить растяжку: свежее тело сотрудника Альянса в городе (не под оцеплением), у ворот
   * Нексуса, у выхода проходной КПП в город или там, где сейчас патрульный ГО.
   */
  mineSpot(): Vec2 | null {
    const { ctx } = this;
    const out: Vec2[] = [];
    for (const k of ctx.combat.corpses) {
      if (!FACTIONS[k.faction].authority || k.burning || ctx.war.scenes.sealed(k) || ctx.map.levelAt(k.x, k.y) !== 'city') continue;
      if (!ctx.combat.mines.some((m) => m.corpse === k)) out.push({ x: k.x, y: k.y });
    }
    const ring = (p: Vec2 | null) => {
      if (!p) return;
      const a = randomAnchorAround(p, ctx, PARTISANS.mineRing[0], PARTISANS.mineRing[1], new Set());
      if (a >= 0 && ctx.map.levelAt(ctx.nav.worldX(a), ctx.nav.worldY(a)) === 'city') out.push({ x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) });
    };
    ring(poiWorld(ctx, 'nexus_gate'));
    for (const f of ctx.war.fronts) ring(f.apron);
    const cps = ctx.entities.list.filter((o) => o.alive && o.faction === 'cp' && ctx.map.levelAt(o.x, o.y) === 'city' && ctx.map.zoneAtWorld(o.x, o.y)?.kind !== 'nexus');
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

  /** Переодеться в OTA (шкаф в казарме Нексуса). */
  dressAsOta(c: Character): void {
    c.disguised = true;
    c.cover = { faction: 'ota', rank: 0, profession: 'ota_alpha', name: `OTA-${c.cid.slice(-3)}` };
    this.ctx.combat.equip(c, null);
    this.say(`спецагент ${c.isPlayer ? '(вы) ' : ''}переоделся в OTA в казарме Нексуса.`);
  }

  /** Спецагент раскрыл себя (покушение): враг Альянса, в розыске. */
  revealAgent(c: Character, why: string): void {
    this.ctx.combat.reveal(c, why);
    c.hostile = true;
    c.law.wanted = true;
  }

  /** Взлом камеры КПЗ или клетки: все сидевшие сбегают, тревога. Возвращает, сколько сбежало. */
  jailbreak(by: Character, cell: Cell): number {
    const { ctx } = this;
    const n = ctx.law.breakCell(cell);
    if (n <= 0) return 0;
    this.stats.jailbreaks++;
    ctx.law.log(`Нексус: ${cell.cage ? 'клетка у Администратора вскрыта' : 'дверь камеры КПЗ выбита'} — сбежали ${n}!`, 'radio');
    ctx.war.raiseAlarm(cell.x, cell.y, 'побег из КПЗ Нексуса');
    this.say(`${by.isPlayer ? 'вы вскрыли' : by.profession === 'partisan' ? 'подпольщик вскрыл' : 'спецагент вскрыл'} камеру — наши на свободе (${n}).`);
    return n;
  }

  /** Бунт: горожане вокруг бегают и кричат лозунги (нарушение для ГО), тревога. Возвращает, сколько подняли. */
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

  /** Допрос пленных в клетках: CMD.EPU перед клеткой — боль и вопросы; раскололся — выдал своего. */
  private interrogate(dt: number): void {
    const { ctx } = this;
    const I = PARTISANS.interrogation;
    const now = ctx.law.now;
    for (const cell of ctx.law.cells) {
      if (!cell.cage) continue;
      for (const s of cell.slots) {
        const p = s.occupant;
        if (!p) continue;
        let epu: Character | null = null;
        for (const o of ctx.entities.near(cell.frontX, cell.frontY, I.reach, near)) {
          if (o.alive && o.faction === 'cp' && (o.brain as CpBrain | null)?.duty === 'epu') {
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
          ctx.law.log(`${epu.name} допрашивает пленного партизана в кабинете Администратора.`, 'radio');
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
          // Выдал личину другого подпольщика (или спецагента): теперь его узнают в лицо.
          const other = [...this.garrison, ...(this.agent ? [this.agent] : [])].find((o) => o !== p && o.alive && o.disguised && o.law.phase === 'none');
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

  /** Сколько подпольщиков сейчас в клетках. */
  cagedPartisans(): number {
    return this.ctx.law.caged().filter((c) => c.profession === 'partisan').length;
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
    ctx.law.log(`Допрос: оба подпольщика в клетках — логово найдено! Гарнизоны КПП и OTA (${force.length}) штурмуют лагерь сопротивления.`, 'radio');
    ctx.bus.emit('announce', { text: 'ГО штурмует лагерь сопротивления' });
    this.say('ГО и OTA идут на лагерь! Все к оружию!');
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
    this.ctx.law.log('Штурм лагеря окончен: силы Альянса возвращаются на посты.', 'radio');
  }

  update(dt: number): void {
    this.time += dt;
    const { ctx } = this;
    for (let i = this.garrison.length - 1; i >= 0; i--) if (!this.garrison[i].alive) this.garrison.splice(i, 1);
    if (this.agent && !this.agent.alive) this.agent = null;
    this.interrogate(dt);
    // Вернувшийся в схрон раскрытый подпольщик (не в розыске) — снова под личиной; тайник пополняет гранаты.
    for (const c of this.garrison) {
      if (c.brain instanceof UndergroundBrain && c.brain.mode === 'base' && ctx.map.levelAt(c.x, c.y) === 'sewer') {
        const need = PARTISANS.cacheGrenades - c.inventory.count('grenade');
        if (need > 0) c.inventory.add('grenade', need);
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
    const ag = this.agent;
    // Спецагент в схроне — новые документы: снова чист и под личиной.
    if (ag && !ag.isPlayer && (!ag.disguised || ag.law.wanted) && ag.law.phase === 'none' && ctx.map.levelAt(ag.x, ag.y) === 'sewer' && (ag.brain as AgentBrain | null)?.mode === 'base') {
      ag.law.wanted = false;
      ag.hostile = false;
      this.adoptAgent(ag);
    }
    // Оба подпольщика в клетках одновременно — рейд на логово; по времени — назад.
    // Один рейд на каждый раз, когда оба оказались в клетках.
    const allCaged = ROSTER.partisans > 0 && this.cagedPartisans() >= ROSTER.partisans;
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
    for (const c of [...this.garrison, ...(this.agent ? [this.agent] : [])]) {
      const b = c.brain;
      if (b instanceof UndergroundBrain && b.mode === 'base') continue;
      if (!c.disguised && ctx.map.levelAt(c.x, c.y) === 'city' && ctx.war.code !== 'green') ctx.war.operatives.add(c);
    }
    // Операции кончаются, когда все вернулись или погибли; новая — когда подошёл срок и есть свободный.
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      const active = op.team.filter((c) => c.alive && c.brain instanceof UndergroundBrain && c.brain.mode !== 'base');
      if (active.length > 0) continue;
      const alive = op.team.filter((c) => c.alive).length;
      this.say(`подпольщик вернулся (${alive} из ${op.team.length}).`);
      this.ops.splice(i, 1);
      if (this.op === op) this.op = null;
    }
    if (this.time >= this.nextOp) {
      this.nextOp = this.time + (this.startOperation() ? ctx.rng.range(INSURGENCY.opEvery[0], INSURGENCY.opEvery[1]) : 10);
    }
  }
}

const near: Character[] = [];
