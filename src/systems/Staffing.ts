import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import { CpBrain } from '../ai/brains/CpBrain';
import { STAFFING } from '../config/staffing';
import { cpUnit, CP_UNIT, type CpUnitId } from '../config/factions';
import { KITS, ITEMS, type ItemId } from '../config/items';
import { brainFor, type RoleSpec } from './Roster';

/** Должность в штатном расписании силового блока: роль (пост, группа, КПП…) и кто её занимает. */
export interface StaffSlot {
  id: number;
  spec: RoleSpec;
  holder: Character | null;
  /** С какого времени свободна (−1 — занята). */
  vacantSince: number;
}

/** Описание должности для журнала: «пост у Управы», «ведущий группы 2»… */
export function postName(spec: RoleSpec): string {
  switch (spec.kind) {
    case 'post': return spec.access === 'nexus' ? 'вахта Управы' : spec.access === 'academy' ? 'вахта академии' : 'пост в городе';
    case 'gate': return `проходная КПП ${spec.front === 0 ? '«Запад»' : '«Восток»'}`;
    case 'guard': return `пост на КПП ${spec.front === 0 ? '«Запад»' : '«Восток»'}`;
    case 'medic': return 'медпункт КПП';
    case 'squad': return spec.lead ? `ведущий группы ${(spec.squad ?? 0) + 1}` : `группа ${(spec.squad ?? 0) + 1}`;
    case 'officer': return 'офицер PCU';
    case 'tech': return 'техник со сканером';
    case 'inspector': return 'инспекция';
    case 'bodyguard': return 'охрана';
    case 'epu': return 'глава силового блока';
    case 'qm': return 'кладовщик склада';
    case 'depot': return 'охрана склада';
    case 'convoy': return 'конвой склада';
    case 'jailer': return 'охрана тюрьмы';
    case 'warden': return 'начальник тюрьмы';
    case 'instructor': return 'инструктор академии';
    default: return 'служба';
  }
}

/**
 * Штатное расписание силового блока: ВС не возрождаются. У каждого юнита — должность (StaffSlot); погиб —
 * должность свободна, через STAFFING.wait с её занимает лучший из младших (STAFFING.from) по баллам —
 * заслуги + выслуга. Его прежняя должность освобождается — и так вниз до RCT, которых пополняют выпускники
 * академии (reserve). Никто не набрал minScore за actingAfter с — назначают лучшего «врио». Игрока повышают
 * только по баллам (событие promoted).
 */
export class Staffing {
  readonly slots: StaffSlot[] = [];
  /** Выпускники академии без должности (RCT в резерве — дневальные академии). */
  readonly reserve: Character[] = [];
  readonly stats = { promotions: 0, acting: 0, vacated: 0, graduates: 0, playerPromotions: 0 };
  /** Выключено — должности не разбираются (тесты). */
  enabled = true;
  private next = 0;

  constructor(private readonly ctx: AiContext) {
    ctx.combat.deathListeners.push((c) => this.onDeath(c));
  }

  private get now(): number {
    return this.ctx.law.now;
  }

  /** Новый юнит (по роли) — должность в расписание; заслуги прошлых лет — у начального состава. */
  adopt(c: Character): void {
    const kind = c.role?.kind;
    if (!c.role || c.faction !== 'cp' || kind === 'cadet' || kind === 'reserve' || this.slotOf(c)) return;
    this.slots.push({ id: this.slots.length, spec: { ...c.role }, holder: c, vacantSince: -1 });
    const [lo, hi] = STAFFING.startMerit[cpUnit(c.rank).unit];
    if (c.merit === 0) c.merit = Math.round(this.ctx.rng.range(lo, hi));
    c.serviceSince = this.now;
  }

  slotOf(c: Character): StaffSlot | null {
    for (const s of this.slots) if (s.holder === c) return s;
    return null;
  }

  /** Баллы для повышения: заслуги + выслуга. */
  score(c: Character): number {
    return c.merit + ((this.now - c.serviceSince) / 60) * STAFFING.perMinute;
  }

  /** Заслуги (+) или проступок (−) юнита ВС. */
  merit(c: Character | null | undefined, pts: number): void {
    if (!c || c.faction !== 'cp' || c.cadet) return;
    c.merit = Math.max(0, c.merit + pts);
  }

  /** Сколько должностей занято (доля). */
  get staffed(): number {
    return this.slots.length ? this.slots.filter((s) => s.holder).length / this.slots.length : 1;
  }

  /** Свободные должности (всего или юнита). */
  vacancies(unit?: CpUnitId): StaffSlot[] {
    return this.slots.filter((s) => !s.holder && (!unit || cpUnit(s.spec.rank).unit === unit));
  }

  /** Самая важная свободная должность юнита (или null). */
  bestVacancy(unit: CpUnitId): StaffSlot | null {
    let best: StaffSlot | null = null;
    for (const s of this.vacancies(unit)) if (!best || this.priority(s) > this.priority(best)) best = s;
    return best;
  }

  private onDeath(c: Character): void {
    // Заслуги стрелявшего ВС: враг — плюс, мирный (не в розыске, без оружия) — минус.
    const k = c.lastAttacker;
    if (k && k.faction === 'cp' && k !== c) {
      if (c.hostile || c.faction === 'rebel') this.merit(k, STAFFING.merit.killHostile);
      else if ((c.faction === 'citizen' || c.faction === 'cwu' || c.faction === 'vort') && !c.law.wanted && !c.weapon) this.merit(k, STAFFING.merit.killInnocent);
    }
    if (c.faction !== 'cp') return;
    this.vacate(c);
  }

  /** Освободить должность (погиб, разжалован, игрок сменил роль). */
  vacate(c: Character): void {
    const i = this.reserve.indexOf(c);
    if (i >= 0) this.reserve.splice(i, 1);
    const s = this.slotOf(c);
    if (!s) return;
    s.holder = null;
    s.vacantSince = this.now;
    this.stats.vacated++;
  }

  /** Выпускник академии без должности — в резерв (займёт первую вакансию RCT). */
  toReserve(c: Character): void {
    if (!this.reserve.includes(c)) this.reserve.push(c);
    c.serviceSince = this.now;
  }

  update(): void {
    if (!this.enabled || this.now < this.next) return;
    this.next = this.now + STAFFING.every;
    // Резерв: погибшие выпускники — вон.
    for (let i = this.reserve.length - 1; i >= 0; i--) if (!this.reserve[i].alive || this.reserve[i].faction !== 'cp') this.reserve.splice(i, 1);
    const ready = this.slots.filter((s) => !s.holder && this.now - s.vacantSince >= STAFFING.wait);
    if (!ready.length) return;
    ready.sort((a, b) => this.priority(b) - this.priority(a));
    // За раз — одно назначение (приказы идут по очереди, не вся вертикаль сразу).
    for (const s of ready) if (this.fill(s)) return;
  }

  /** Важность должности: уровень командования, потом вид роли. */
  private priority(s: StaffSlot): number {
    const k = STAFFING.kindOrder.indexOf(s.spec.kind);
    return cpUnit(s.spec.rank).command * 100 + (k >= 0 ? STAFFING.kindOrder.length - k : 0);
  }

  /** Свободен для перевода: живой NPC ВС на дежурстве, не в деле. */
  private free(c: Character): boolean {
    const b = c.brain;
    if (!(b instanceof CpBrain)) return false;
    if (b.target || b.scene || b.formation || b.ward || b.rally || b.raidPost || b.gunner.target) return false;
    if (this.ctx.arsenal?.convoyOf(c)) return false;
    return STAFFING.freeStates.includes(b.fsm.current);
  }

  /** Занять должность: выпускник из резерва (RCT) или лучший из младших. */
  fill(s: StaffSlot): boolean {
    const unit = cpUnit(s.spec.rank).unit;
    if (unit === 'rct') {
      const g = this.reserve.find((c) => c.alive && c.fit && (c.isPlayer || this.free(c)));
      if (!g) return false;
      this.assign(g, s, false);
      this.stats.graduates++;
      return true;
    }
    const from = STAFFING.from[unit];
    let best: Character | null = null;
    let bestKey = -Infinity;
    for (const c of this.ctx.entities.list) {
      if (!c.alive || c.downed || c.faction !== 'cp' || c.cadet || c.law.phase !== 'none') continue;
      const pri = from.indexOf(cpUnit(c.rank).unit);
      if (pri < 0) continue;
      if (!c.isPlayer && (!this.free(c) || (!this.slotOf(c) && !this.reserve.includes(c)))) continue;
      // Игрока — только по заслугам (без «врио»).
      if (c.isPlayer && this.score(c) < STAFFING.minScore[unit]) continue;
      const key = this.score(c) - pri * 5;
      if (key > bestKey) {
        bestKey = key;
        best = c;
      }
    }
    if (!best) return false;
    const enough = this.score(best) >= STAFFING.minScore[unit];
    if (!enough && this.now - s.vacantSince < STAFFING.actingAfter) return false;
    this.assign(best, s, !enough);
    return true;
  }

  /** Перевести юнит на должность s (повышение): звание, здоровье, снаряжение, служба. */
  assign(c: Character, s: StaffSlot, acting: boolean): void {
    const old = this.slotOf(c);
    if (old) {
      old.holder = null;
      old.vacantSince = this.now;
    }
    const i = this.reserve.indexOf(c);
    if (i >= 0) this.reserve.splice(i, 1);
    s.holder = c;
    s.vacantSince = -1;
    const before = cpUnit(c.rank);
    applyPost(this.ctx, c, s.spec);
    const after = cpUnit(c.rank);
    this.stats.promotions++;
    if (acting) this.stats.acting++;
    const what = before.unit === after.unit ? `назначен: ${postName(s.spec)}` : `повышен до ${after.short}${acting ? ' (временно исполняющий)' : ''} — ${postName(s.spec)}`;
    this.ctx.law.log(`Приказ по силовому блоку: ${before.short} ${c.name} ${what}.`, 'radio');
    if (c.isPlayer) {
      this.stats.playerPromotions++;
      this.ctx.bus.emit('promoted', { rank: c.rank, post: postName(s.spec) });
    }
  }
}

/**
 * Применить должность к юниту: звание (здоровье — в той же доле), недостающее снаряжение нового набора
 * (стволы — если нет, патроны и расходники — до нормы), роль и мозг по роли.
 */
export function applyPost(ctx: AiContext, c: Character, spec: RoleSpec): void {
  const frac = c.maxHealth > 0 ? c.health / c.maxHealth : 1;
  c.rank = spec.rank;
  const u = cpUnit(c.rank);
  c.division = u.group;
  c.maxHealth = u.hp;
  c.health = Math.max(1, Math.round(u.hp * frac));
  for (const [id, qty] of KITS[u.kit] ?? []) {
    const have = c.inventory.count(id as ItemId);
    const need = ITEMS[id].kind === 'weapon' ? 1 : qty;
    if (have < need) c.inventory.add(id as ItemId, need - have);
  }
  c.role = { ...spec, name: c.name };
  if (c.isPlayer) return;
  c.guarding = null;
  c.squadLead = null;
  c.brain = brainFor(ctx, c, c.role);
}

/** Номер юнита RCT (для академии и тестов). */
export const RCT_RANK = CP_UNIT.rct;

/** Строка HUD игрока-ВС: баллы службы и до какого юнита хватает. */
export function serviceHint(c: Character, S: Staffing): string {
  const unit = cpUnit(c.rank).unit;
  const next = (Object.keys(STAFFING.from) as CpUnitId[]).filter((u) => STAFFING.from[u].includes(unit));
  const score = Math.floor(S.score(c));
  if (!next.length) return `Служба: баллы ${score} (заслуги ${Math.floor(c.merit)} + выслуга)`;
  const need = Math.min(...next.map((u) => STAFFING.minScore[u]));
  const names = next.map((u) => cpUnit(CP_UNIT[u]).short).join(', ');
  return `Служба: баллы ${score}/${need} — повышение до ${names} на свободную должность`;
}
