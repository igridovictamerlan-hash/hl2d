/** Описание — docs/ui.md («Меню организации ВС»). */
import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { StaffSlot } from './Staffing';
import { postName } from './Staffing';
import { CpBrain } from '../ai/brains/CpBrain';
import { RebelBrain } from '../ai/brains/RebelBrain';
import { FACTIONS, CP_UNIT, cpUnit, type CpUnitId } from '../config/factions';
import { STAFFING } from '../config/staffing';
import { ORG } from '../config/org';
import { chargeDef, wantedLevel } from './LawSystem';

/** Сводка для меню организации: обстановка в городе и штат. */
export interface OrgSummary {
  code: string;
  alarm: boolean;
  /** Активные вызовы по рации, места преступлений (тел в них), открытые дела (из них убийств). */
  calls: number;
  scenes: number;
  bodies: number;
  cases: number;
  murders: number;
  /** Разыскиваемых по степени: [★, ★★, ★★★]. */
  wanted: [number, number, number];
  /** В КПЗ и в тюрьме сейчас. */
  jailed: number;
  imprisoned: number;
  /** Должностей занято / всего, свободных, резерв академии, курсантов, погибших за службу. */
  staffed: number;
  slots: number;
  vacancies: number;
  reserve: number;
  cadets: number;
  lost: number;
}

/** Преступление в списке: оцепление, вызов по рации или уголовное дело. */
export interface OrgCrime {
  kind: 'scene' | 'call' | 'case';
  title: string;
  zone: string;
  /** Сколько секунд назад. */
  ago: number;
  detail: string;
  /** Срочность (вызов): чем больше, тем важнее. */
  prio: number;
}

/** Ориентировка: кто в розыске. */
export interface OrgWanted {
  name: string;
  charge: string;
  level: number;
  /** Где видели в последний раз (известное ВС место; не знают — «—»). */
  zone: string;
  /** До снятия, с (Infinity — бессрочно). */
  left: number;
  armed: boolean;
}

/** Сотрудник в списке штата. */
export interface OrgMember {
  id: number;
  name: string;
  unit: string;
  unitName: string;
  command: number;
  post: string;
  state: string;
  zone: string;
  /** Здоровье, доля. */
  health: number;
  score: number;
  isPlayer: boolean;
  /** Приказ возможен: повысить — до кого (short), понизить — до кого; null — нельзя. */
  promote: string | null;
  demote: string | null;
}

const zoneName = (ctx: AiContext, x: number, y: number): string => ctx.map.zoneAtWorld(x, y)?.name ?? '—';
const unitOf = (s: StaffSlot): CpUnitId => cpUnit(s.spec.rank).unit;

/** Сводка: код, тревога, вызовы, оцепления, дела, розыск, задержанные, штат. */
export function orgSummary(ctx: AiContext): OrgSummary {
  const scenes = ctx.war.scenes.list.filter((s) => !s.closed);
  const cases = ctx.suspects ? ctx.suspects.cases.filter((c) => c.known && !c.closed) : [];
  const wanted: [number, number, number] = [0, 0, 0];
  let cadets = 0;
  for (const c of ctx.entities.list) {
    if (!c.alive) continue;
    if (c.faction === 'cp' && c.cadet) cadets++;
    if (onWantedList(c)) wanted[wantedLevel(c) - 1]++;
  }
  const imprisoned = ctx.law.imprisoned().length;
  let jailed = 0;
  for (const cell of ctx.law.cells) if (!cell.prison) for (const s of cell.slots) if (s.occupant) jailed++;
  const S = ctx.staffing;
  return {
    code: ORG.codes[ctx.war.code] ?? ctx.war.code,
    alarm: ctx.war.alarmActive,
    calls: ctx.radio ? ctx.radio.incidents.filter((i) => !i.closed).length : 0,
    scenes: scenes.length,
    bodies: scenes.reduce((n, s) => n + s.bodies.length, 0),
    cases: cases.length,
    murders: cases.filter((c) => c.kind === 'murder').length,
    wanted,
    jailed,
    imprisoned,
    staffed: S.slots.filter((s) => s.holder).length,
    slots: S.slots.length,
    vacancies: S.vacancies().length,
    reserve: S.reserve.length,
    cadets,
    lost: S.stats.vacated,
  };
}

/** Преступления: открытые оцепления, активные вызовы по рации, известные ВС дела — свежие сверху. */
export function orgCrimes(ctx: AiContext): OrgCrime[] {
  const out: OrgCrime[] = [];
  const sc = ctx.war.scenes;
  for (const s of sc.list) {
    if (s.closed) continue;
    const first = s.corpse;
    const who = s.kind === 'cp' ? `убит сотрудник ${first.name}` : `убит ${first.name}`;
    const more = s.bodies.length > 1 ? ` и ещё ${s.bodies.length - 1}` : '';
    const inv = s.investigatedAt >= 0 ? 'осмотрено следователем' : s.investigator ? 'следователь на месте' : 'ждёт следователя';
    const med = s.examinedAt >= 0 ? 'тело осмотрено' : s.medic ? 'медик на месте' : 'ждёт медика';
    out.push({ kind: 'scene', title: `Место преступления: ${who}${more}`, zone: zoneName(ctx, s.x, s.y), ago: sc.now - s.since, detail: `${inv} · ${med}`, prio: s.kind === 'cp' ? 3 : 2 });
  }
  if (ctx.radio) {
    for (const i of ctx.radio.incidents) {
      if (i.closed) continue;
      const sent = i.responders.filter((r) => r.alive).length;
      const desc = i.desc ? ` · приметы: ${i.desc}${i.dirText ? `, ушёл ${i.dirText}` : ''}` : '';
      out.push({ kind: 'call', title: `Вызов: ${i.what}`, zone: i.zone || i.where, ago: ctx.law.now - i.opened, detail: `${sent ? `едут: ${sent}` : 'никого не послали'}${i.onScene ? ' · на месте' : ''}${desc}`, prio: i.prio });
    }
  }
  const sus = ctx.suspects;
  if (sus) {
    for (const c of sus.cases) {
      if (!c.known || c.closed) continue;
      const what = c.kind === 'murder' ? `убийство${c.kills > 1 ? ` (${c.kills})` : ''}` : `нападение${c.wounds > 1 ? ` (${c.wounds})` : ''}`;
      const who = c.named ? `установлен: ${c.actor.name}` : `приметы: ${sus.describe(c)}`;
      const zone = ctx.map.zones[c.zone]?.name ?? '—';
      out.push({ kind: 'case', title: `Дело №${c.id}: ${what}`, zone, ago: ctx.law.now - c.at, detail: `${who} · свидетелей ${c.witnesses.size}${c.victims.length ? ` · ${c.victims.slice(0, 2).join(', ')}` : ''}`, prio: c.kind === 'murder' ? 2 : 1 });
    }
  }
  return out.sort((a, b) => a.ago - b.ago);
}

/** В ориентировки: разыскиваемый в городе — не Протекторат и не армия сопротивления (войска за стеной — не розыск). */
function onWantedList(c: Character): boolean {
  return c.alive && c.law.wanted && !FACTIONS[c.faction].authority && !(c.brain instanceof RebelBrain);
}

/** Ориентировки: кто в розыске, тяжёлые статьи — сверху. */
export function orgWanted(ctx: AiContext): OrgWanted[] {
  const out: OrgWanted[] = [];
  for (const c of ctx.entities.list) {
    if (!onWantedList(c)) continue;
    const seen = ctx.war.lastKnown.get(c);
    out.push({
      name: c.name,
      charge: chargeDef(c).name,
      level: wantedLevel(c),
      zone: seen ? zoneName(ctx, seen.x, seen.y) : '—',
      left: ctx.law.wantedLeft(c) ?? 0,
      armed: !!c.weapon || c.hostile,
    });
  }
  return out.sort((a, b) => b.level - a.level || a.left - b.left);
}

/** Может ли viewer отдавать приказы о target: ВС от ORG.manageFrom, target — NPC ВС ниже его по командованию. */
export function canManage(viewer: Character, target: Character): boolean {
  if (viewer === target || viewer.faction !== 'cp' || target.faction !== 'cp' || target.isPlayer || target.cadet || !target.alive) return false;
  const v = cpUnit(viewer.rank).command;
  return v >= ORG.manageFrom && cpUnit(target.rank).command < v;
}

/** Куда можно повысить target приказом viewer: самая важная свободная должность выше (её уровень — ниже viewer). */
export function promoteSlot(ctx: AiContext, viewer: Character, target: Character): StaffSlot | null {
  if (!canManage(viewer, target)) return null;
  const unit = cpUnit(target.rank).unit;
  const cap = cpUnit(viewer.rank).command;
  const S = ctx.staffing;
  let best: StaffSlot | null = null;
  for (const s of S.vacancies()) {
    const u = unitOf(s);
    if (!STAFFING.from[u].includes(unit) || cpUnit(s.spec.rank).command >= cap) continue;
    if (!best || S.rankOf(s) > S.rankOf(best)) best = s;
  }
  return best;
}

/**
 * Понижение target приказом viewer: на свободную младшую должность (из юнитов, откуда повышают на его), иначе —
 * обмен с лучшим свободным из младших (тот займёт его должность). null — ниже некуда.
 */
export function demotePlan(ctx: AiContext, viewer: Character, target: Character): { slot: StaffSlot; swap: Character | null } | null {
  if (!canManage(viewer, target) || !ctx.staffing.slotOf(target)) return null;
  const lower = lowerUnits(cpUnit(target.rank).unit);
  if (!lower.length) return null;
  const S = ctx.staffing;
  for (const u of lower) {
    const v = S.bestVacancy(u);
    if (v) return { slot: v, swap: null };
  }
  // Обмен: на его должность встаёт тот, кого на неё вообще назначают (STAFFING.from), — не через ступень.
  const eligible = STAFFING.from[cpUnit(target.rank).unit];
  let best: { slot: StaffSlot; swap: Character | null } | null = null;
  let bestScore = -Infinity;
  for (const s of S.slots) {
    const h = s.holder;
    const u = unitOf(s);
    if (!h || h.isPlayer || !lower.includes(u) || !eligible.includes(u) || !S.free(h)) continue;
    const sc = S.score(h);
    if (sc > bestScore) [bestScore, best] = [sc, { slot: s, swap: h }];
  }
  return best;
}

/**
 * Куда понижают юнита: юниты, из которых повышают на его (STAFFING.from), — только ниже по уровню командования; нет
 * таких — на ступень дальше (SU.02 → SU.03 того же уровня → PCU.02/03). Ближние ступени — первыми.
 */
export function lowerUnits(unit: CpUnitId): CpUnitId[] {
  const cmd = cpUnit(CP_UNIT[unit]).command;
  const out: CpUnitId[] = [];
  const seen = new Set<CpUnitId>([unit]);
  let layer: CpUnitId[] = [unit];
  for (let depth = 0; depth < 3 && layer.length; depth++) {
    const next: CpUnitId[] = [];
    for (const u of layer) {
      for (const f of STAFFING.from[u]) {
        if (seen.has(f)) continue;
        seen.add(f);
        next.push(f);
        if (cpUnit(CP_UNIT[f]).command < cmd) out.push(f);
      }
    }
    if (out.length) return out;
    layer = next;
  }
  return out;
}

/** Чем занят юнит — по состоянию мозга (ORG.states). */
function stateOf(c: Character): string {
  if (c.downed) return 'тяжело ранен';
  if (c.law.phase !== 'none') return 'задержан';
  const b = c.brain;
  if (!(b instanceof CpBrain)) return c.isPlayer ? 'игрок' : 'на службе';
  if (b.gunner.target) return 'бой';
  return ORG.states[b.fsm.current] ?? 'на службе';
}

/** Штат: все ВС с должностью, в резерве и курсанты — по уровню командования, затем по юниту и позывному. */
export function orgStaff(ctx: AiContext, viewer: Character): OrgMember[] {
  const S = ctx.staffing;
  const out: OrgMember[] = [];
  for (const c of ctx.entities.list) {
    if (!c.alive || c.faction !== 'cp') continue;
    const u = cpUnit(c.rank);
    const slot = S.slotOf(c);
    const post = slot ? postName(slot.spec) : c.cadet ? 'академия' : S.reserve.includes(c) ? 'резерв академии' : 'без должности';
    const up = promoteSlot(ctx, viewer, c);
    const down = demotePlan(ctx, viewer, c);
    out.push({
      id: c.id,
      name: c.name,
      unit: u.short,
      unitName: u.name,
      command: u.command,
      post,
      state: stateOf(c),
      zone: zoneName(ctx, c.x, c.y),
      health: c.maxHealth > 0 ? c.health / c.maxHealth : 0,
      score: Math.floor(S.score(c)),
      isPlayer: c.isPlayer,
      promote: up ? cpUnit(up.spec.rank).short : null,
      demote: down ? cpUnit(down.slot.spec.rank).short : null,
    });
  }
  return out.sort((a, b) => b.command - a.command || a.unit.localeCompare(b.unit) || a.name.localeCompare(b.name));
}

/**
 * Приказ игрока-командира: повысить или понизить юнита (через штатное расписание: Staffing.assign — звание,
 * снаряжение, мозг по должности, приказ в журнал). Ответ для игрока.
 */
export function orgOrder(ctx: AiContext, viewer: Character, target: Character, kind: 'promote' | 'demote'): string {
  if (!canManage(viewer, target)) return cpUnit(viewer.rank).command < ORG.manageFrom ? `Приказы о составе — с ${cpUnit(CP_UNIT.ofc).short} и выше.` : 'Этим юнитом вы не командуете.';
  const S = ctx.staffing;
  if (!S.free(target)) return `${target.name} сейчас занят делом — приказ позже.`;
  if (kind === 'promote') {
    const slot = promoteSlot(ctx, viewer, target);
    if (!slot) return `Нет свободной должности выше ${cpUnit(target.rank).short}: сперва освободите её (понизьте кого-то).`;
    S.assign(target, slot, false, viewer);
    return `${target.name} повышен: ${cpUnit(slot.spec.rank).short} — ${postName(slot.spec)}.`;
  }
  const plan = demotePlan(ctx, viewer, target);
  if (!plan) {
    const low = lowerUnits(cpUnit(target.rank).unit);
    return low.length
      ? `${target.name}: нет свободной должности ${low.map((u) => cpUnit(CP_UNIT[u]).short).join('/')} и некого поставить на его место.`
      : `${target.name}: ниже ${cpUnit(target.rank).short} понижать некуда.`;
  }
  const own = S.slotOf(target);
  if (plan.swap && own) S.assign(plan.swap, own, false, viewer);
  S.assign(target, plan.slot, false, viewer);
  return `${target.name} понижен: ${cpUnit(plan.slot.spec.rank).short} — ${postName(plan.slot.spec)}${plan.swap ? `; его должность занял ${plan.swap.name}` : ''}.`;
}
