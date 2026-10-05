import { test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { AI } from '../src/config/ai';
import type { Character } from '../src/entities/Character';
import { cpUnit } from '../src/config/factions';

/**
 * Аудит живого мира (npm run worldstats; MINUTES — сколько игровых минут, SEED — карта): город целиком,
 * с распорядком дня и уличными драками, как в игре, без игрока. Печатает сводку: кто от чего гибнет,
 * сколько денег и еды у сторон, чем заняты жители, кто стоит на месте и не может дойти, преступность,
 * война. Обычный `npm test` это не запускает.
 */
const RUN = !!process.env.WORLDSTATS;

/** Группа персонажа для сводки. */
function group(c: { faction: string; profession: string | null; gang?: number }): string {
  if (c.gang !== undefined && c.gang >= 0) return 'банда';
  if (c.profession === 'cremator') return 'санитар';
  if (c.faction === 'citizen') return c.profession === 'thief' ? 'вор' : 'горожанин';
  if (c.faction === 'rebel') return c.profession === 'partisan' || c.profession === 'spec_agent' ? 'подполье' : 'армия';
  if (c.faction === 'cp' && (c as { cadet?: unknown }).cadet) return 'курсант';
  return c.faction;
}

const inc = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const top = (m: Map<string, number>, n = 12) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ');

test.skipIf(!RUN)('аудит живого мира', { timeout: 3_600_000 }, () => {
  const minutes = Number(process.env.MINUTES ?? 30);
  const sim = makeSim(Number(process.env.SEED ?? 12345));
  sim.ctx.routine.enabled = true;
  sim.ctx.brawls.enabled = true;
  sim.academy.recruiting = true;
  spawnPopulation(sim.ctx, AI.citizens);
  const out: string[] = [];
  const start = new Map<string, number>();
  for (const c of sim.entities.list) inc(start, group(c));
  out.push(`Население при старте: ${top(start, 20)} (всего ${sim.entities.list.length})`);

  // Смерти: кто кого и как.
  const deaths = new Map<string, number>();
  const killers = new Map<string, number>();
  const pairs = new Map<string, number>();
  const victimsByMinute: number[] = [];
  sim.ctx.combat.deathListeners.push((c, killer) => {
    const v = group(c);
    inc(deaths, v);
    const k = killer ? (killer === c ? 'сам' : group(killer)) : 'нет (голод/огонь/кровь)';
    inc(killers, k);
    inc(pairs, `${k}→${v}`);
    const m = Math.floor(sim.ctx.time / 60);
    victimsByMinute[m] = (victimsByMinute[m] ?? 0) + 1;
  });
  const causes = new Map<string, number>();
  const law = new Map<string, number>();
  sim.bus.on('log', ({ text }) => {
    if (/ задержал /.test(text)) inc(law, `арест ${/\(([^()]*)\)\s*$/.exec(text)?.[1] ?? ''}`);
    if (/ оштрафовал /.test(text)) inc(law, `штраф ${/\(([^()]*)\)\s*$/.exec(text)?.[1] ?? ''}`);
    if (/отбыл срок/.test(text)) inc(law, 'отбыл срок');
    if (!text.startsWith('Убит:')) return;
    const m = /\(([^()]*)\)\s*$/.exec(text);
    inc(causes, m && !/Гражданин|ТС|ВС|Легион|Бандит|Вор/.test(m[1]) ? m[1] : 'в бою');
  });

  const states = new Map<string, number>();
  const still = new Map<string, number>();
  const stuck = new Map<string, number>();
  const prev = new Map<Character, { x: number; y: number }>();
  let samples = 0;
  const codeTime = new Map<string, number>();
  let maxCorpses = 0;
  const step = 1 / 60;
  const total = minutes * 60 * 60;
  for (let t = 1; t <= total; t++) {
    sim.step(step);
    if (t % 60 === 0) inc(codeTime, sim.war.code);
    if (t % 600 === 0) {
      maxCorpses = Math.max(maxCorpses, sim.combat.corpses.length);
      // Чем заняты (раз в 10 с): горожане и ТС по состоянию мозга.
      for (const c of sim.entities.list) {
        if (!c.alive || c.isPlayer) continue;
        const g = group(c);
        const st = (c.brain as unknown as { fsm?: { current: string } })?.fsm?.current ?? c.brain?.constructor.name ?? '—';
        if (g === 'горожанин' || g === 'cwu' || g === 'вор' || g === 'банда') inc(states, `${g}:${st}`);
      }
      samples++;
    }
    // Раз в 30 с: кто не сдвинулся дальше 12 px, и кто «идёт», но стоит.
    if (t % 1800 === 0) {
      for (const c of sim.entities.list) {
        if (!c.alive || c.isPlayer) continue;
        const p = prev.get(c);
        prev.set(c, { x: c.x, y: c.y });
        if (!p) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d > 12) continue;
        const st = (c.brain as unknown as { fsm?: { current: string } })?.fsm?.current ?? c.brain?.constructor.name ?? '—';
        inc(still, `${group(c)}:${st}`);
        if (c.brain?.mover.status === 'moving' || c.brain?.mover.status === 'pending') inc(stuck, `${group(c)}:${st}`);
      }
    }
    if (t % (60 * 60 * 5) === 0) {
      const alive = new Map<string, number>();
      const money = new Map<string, number>();
      const hunger = new Map<string, number[]>();
      for (const c of sim.entities.list) {
        if (!c.alive) continue;
        const g = group(c);
        inc(alive, g);
        inc(money, g, c.money);
        const h = hunger.get(g) ?? [];
        h.push(c.hunger);
        hunger.set(g, h);
      }
      const hung = [...hunger].map(([g, h]) => `${g} ${Math.round(h.reduce((a, b) => a + b, 0) / h.length)}`).join(', ');
      const starving = sim.entities.list.filter((c) => c.alive && c.hunger <= 0).length;
      out.push(
        `— ${t / 3600} мин · ${sim.ctx.routine.phase()} ${Math.floor(sim.ctx.routine.hour())}ч · код ${sim.war.code} · живых ${[...alive].reduce((a, [, n]) => a + n, 0)} · тел ${sim.combat.corpses.length} · в КПЗ/тюрьме ${sim.entities.list.filter((c) => c.law.phase === 'jailed').length}`,
        `   деньги: ${top(money, 20)}`,
        `   сытость (ср.): ${hung}; голодают (0): ${starving}; паёк на раздаче ${sim.economy.rationStock}`,
        `   барыга: ${sim.ctx.fence.wares.slots.length} позиций, ${sim.ctx.fence.money} ток.; общак: ${sim.ctx.gangs.gangs.map((g) => g.bank).join('/')}`,
        `   штат ВС: ${Math.round(sim.staffing.staffed * 100)}% (${sim.staffing.slots.filter((x) => x.holder).length}/${sim.staffing.slots.length}), вакансий RCT ${sim.staffing.vacancies('rct').length}, резерв ${sim.staffing.reserve.length}; курсантов ${sim.academy.cadets.length}, заявителей ${sim.academy.applicants.size}; граждан ${sim.entities.list.filter((c) => c.alive && c.faction === 'citizen').length}`,
      );
    }
  }
  out.push('', `ИТОГ за ${minutes} мин игрового времени (сутки = ${Math.round(18)} мин):`);
  out.push(`Погибли (${[...deaths.values()].reduce((a, b) => a + b, 0)}): ${top(deaths, 20)}`);
  out.push(`Убийцы: ${top(killers, 20)}`);
  out.push(`Кто кого: ${top(pairs, 25)}`);
  out.push(`Как: ${top(causes, 10)}`);
  out.push(`Смертей по минутам: ${victimsByMinute.map((n) => n ?? 0).join(' ')}`);
  out.push(`Коды (мин): ${top(codeTime)}; тел на земле максимум ${maxCorpses}; возрождений ${sim.roster.respawned}`);
  out.push(`Занятия (доля замеров): ${[...states].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${k} ${((v / samples)).toFixed(1)}`).join(', ')}`);
  out.push(`Стоят на месте 30 с (замеров): ${top(still, 25)}`);
  out.push(`«Идут», но стоят 30 с: ${top(stuck, 20)}`);
  out.push(`Закон: ${top(law, 25)}`);
  out.push(`Преступность: ${JSON.stringify((sim.crime as unknown as { stats?: object }).stats ?? {})}`);
  out.push(`Банды: ${JSON.stringify((sim.ctx.gangs as unknown as { stats?: object }).stats ?? {})}; драки: ${JSON.stringify(sim.ctx.brawls.stats)}`);
  out.push(`Подполье: ${JSON.stringify((sim.insurgency as unknown as { stats?: object }).stats ?? {})}`);
  out.push(`Война: ${JSON.stringify(sim.war.stats)}; места преступлений: ${JSON.stringify(sim.war.scenes.stats)}`);
  out.push(`Труд: ${JSON.stringify(sim.labor.stats)}; склад: ${JSON.stringify(sim.arsenal.stats)}`);
  out.push(`Барыга: ${JSON.stringify(sim.ctx.fence.stats)}`);
  const vac: Record<string, number> = {};
  for (const s of sim.staffing.vacancies()) vac[cpUnit(s.spec.rank).short] = (vac[cpUnit(s.spec.rank).short] ?? 0) + 1;
  out.push(`Вакансии ВС по юнитам: ${JSON.stringify(vac)}`);
  out.push(`Штат ВС: ${JSON.stringify(sim.staffing.stats)}; академия: ${JSON.stringify(sim.academy.stats)}; пропуска: ${JSON.stringify(sim.access.stats)}; приехало жителей ${sim.roster.arrived}`);
  console.log(out.join('\n'));
});
