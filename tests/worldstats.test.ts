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

/** Фронт: счётчики одного КПП отдельно вне наступлений армии и в них (выстрелы, потери, время). */
interface FrontCell { shotsR: number; shotsC: number; deadC: number; deadA: number; downC: number; downA: number; secs: number }
const frontCell = (): FrontCell => ({ shotsR: 0, shotsC: 0, deadC: 0, deadA: 0, downC: 0, downA: 0, secs: 0 });

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
  // Как в игре: типы КПП по сиду и позиционная линия армии (CP=classic — прежняя карта аудитов, LINE=0 — без линии).
  const sim = makeSim(Number(process.env.SEED ?? 12345), { checkpoints: process.env.CP === 'classic' ? ['classic'] : null, line: process.env.LINE !== '0' });
  sim.ctx.routine.enabled = true;
  sim.ctx.brawls.enabled = true;
  sim.academy.recruiting = true;
  // RELATIONS=0 — без живых людей (для сравнения: драки, смерти, занятия).
  sim.ctx.relations.enabled = process.env.RELATIONS !== '0';
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
  // Фронт: выстрелы и потери у КПП (зоны КПП и пустоши) по сторонам, вне наступлений и в наступлениях; бойцы линии; рация.
  const fronts = [[frontCell(), frontCell()], [frontCell(), frontCell()]]; // [запад/восток][вне/в наступлении]
  const cpTypes = [0, 1].map((i) => sim.map.pois.find((p) => p.type === 'checkpoint_type' && (p.face === 'E') === (i === 1))?.kind ?? '?');
  const midX = (sim.map.width * 16) / 2;
  const atFront = (x: number, y: number) => {
    const k = sim.map.zoneAtWorld(x, y)?.kind;
    return k === 'checkpoint' || k === 'outlands';
  };
  // «В наступлении» — само наступление, прорыв/штурм и 90 с после него (отход, добивание).
  let lastOffensive = -1e9;
  const inOffensive = () => {
    const on = !!sim.war.command.offensive || sim.war.cityPush || sim.war.code === 'red';
    if (on) lastOffensive = sim.combat.now;
    return on || sim.combat.now - lastOffensive < 90 ? 1 : 0;
  };
  const frontSide = (c: Character) => (c.faction === 'cp' || c.faction === 'ota' ? 'C' : c.faction === 'rebel' && group(c) === 'армия' ? 'A' : '');
  const frontLoss = (c: Character, down: boolean) => {
    const side = frontSide(c);
    if (!side || !atFront(c.x, c.y)) return;
    const cell = fronts[c.x < midX ? 0 : 1][inOffensive()];
    if (down) cell[side === 'C' ? 'downC' : 'downA']++;
    else cell[side === 'C' ? 'deadC' : 'deadA']++;
  };
  sim.combat.deathListeners.push((c) => frontLoss(c, false));
  const downOrig = sim.combat.down.bind(sim.combat);
  sim.combat.down = (c, by) => {
    frontLoss(c, true);
    return downOrig(c, by);
  };
  let radioSeq = 0;
  let radioFront = 0;
  let holders = 0;
  let holderSamples = 0;
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
    // Выстрелы у КПП: список выстрелов короткий (2 с) — читаем каждый тик, только новые.
    for (let j = sim.combat.shots.length - 1; j >= 0 && sim.combat.shots[j].t >= sim.combat.now - step - 1e-6; j--) {
      const sh = sim.combat.shots[j];
      if (sh.weapon === 'blast' || sh.weapon === 'smoke' || !atFront(sh.x, sh.y)) continue;
      const cell = fronts[sh.x < midX ? 0 : 1][inOffensive()];
      if (sh.shooter?.faction === 'rebel') cell.shotsR++;
      else cell.shotsC++;
    }
    if (t % 60 === 0) {
      const o = inOffensive();
      fronts[0][o].secs++;
      fronts[1][o].secs++;
      for (const m of sim.ctx.radio.feed) {
        if (m.seq <= radioSeq) continue;
        radioSeq = m.seq;
        if (atFront(m.x, m.y)) radioFront++;
      }
      for (const f of sim.war.fronts) holders += sim.war.command.lineOf(f).length;
      holderSamples++;
    }
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
  for (let i = 0; i < 2; i++) {
    const part = [0, 1].map((o) => {
      const c = fronts[i][o];
      const m = Math.max(c.secs / 60, 0.01);
      return `${o ? 'в наступлениях' : 'вне наступлений'} (${m.toFixed(1)} мин): огонь/мин повстанцы ${(c.shotsR / m).toFixed(0)}, Протекторат ${(c.shotsC / m).toFixed(0)}; погибло ВС/Легион ${c.deadC}, армия ${c.deadA}; тяжело ранено ${c.downC}/${c.downA}`;
    });
    out.push(`Фронт ${i ? 'восток' : 'запад'} «${cpTypes[i]}»: ${part.join(' | ')}`);
  }
  out.push(`Фронт: на линии в среднем ${(holders / Math.max(holderSamples, 1)).toFixed(1)} бойцов (оба КПП); передач рации у КПП ${(radioFront / minutes).toFixed(1)}/мин; смен на линии ${sim.war.command.stats.lineShifts}, пауз после потерь ${sim.war.command.stats.linePauses}`);
  out.push(`Война: ${JSON.stringify(sim.war.stats)}; места преступлений: ${JSON.stringify(sim.war.scenes.stats)}`);
  out.push(`Труд: ${JSON.stringify(sim.labor.stats)}; склад: ${JSON.stringify(sim.arsenal.stats)}`);
  out.push(`Барыга: ${JSON.stringify(sim.ctx.fence.stats)}`);
  out.push(`Рация: ${JSON.stringify(sim.ctx.radio.stats)}`);
  const T = sim.ctx.talk.stats;
  out.push(`Разговоры: бесед ${T.convos} (договорили ${T.done}, разошлись ${T.cut}, прервали ${T.stopped}), реплик ${T.lines}, слухов ${T.news}, пересказано ${T.told}; темы: ${top(new Map(Object.entries(T.topics)), 25)}`);
  // Живые люди: связи по уровням знакомства, настроение города, события отношений.
  const R = sim.ctx.relations;
  const tiers = new Map<string, number>();
  const moods = new Map<string, number>();
  for (const c of sim.entities.list) {
    if (!c.alive || c.isPlayer) continue;
    for (const [, bd] of (R['bonds'].get(c.pid) ?? new Map())) inc(tiers, R.tierOf(bd));
    const m = R.mood(c);
    inc(moods, m <= -28 ? 'подавлены' : m <= -9 ? 'хмурые' : m <= 34 ? 'спокойные' : 'в духе');
  }
  out.push(`Живые люди: связи ${top(tiers)}; настроение ${top(moods)}; события ${JSON.stringify(R.stats)}`);
  const vac: Record<string, number> = {};
  for (const s of sim.staffing.vacancies()) vac[cpUnit(s.spec.rank).short] = (vac[cpUnit(s.spec.rank).short] ?? 0) + 1;
  out.push(`Вакансии ВС по юнитам: ${JSON.stringify(vac)}`);
  out.push(`Штат ВС: ${JSON.stringify(sim.staffing.stats)}; академия: ${JSON.stringify(sim.academy.stats)}; пропуска: ${JSON.stringify(sim.access.stats)}; приехало жителей ${sim.roster.arrived}`);
  console.log(out.join('\n'));
});
