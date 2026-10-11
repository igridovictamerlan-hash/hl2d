import { afterAll, describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { WAR } from '../src/config/war';
import { inTrench } from '../src/world/trench';
import { canSeeCircle } from '../src/world/visibility';
import type { CheckpointType } from '../src/config/generator';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

const SEED = 12345;
const LINE0 = JSON.parse(JSON.stringify(WAR.line)) as typeof WAR.line;
afterAll(() => Object.assign(WAR.line, JSON.parse(JSON.stringify(LINE0))));

/** Город с КПП «Ничейная полоса» и армией; наступлений нет (проверяем время между ними), подполье молчит. */
function front(type: CheckpointType = 'trenches') {
  // Пауза линии после потерь (WAR.line.losses) — предмет отдельного теста; в остальных линия не снимается.
  Object.assign(WAR.line.losses, { count: 999 });
  const sim = makeSim(SEED, { checkpoints: [type], line: true });
  spawnPopulation(sim.ctx, 10);
  sim.insurgency.paused = true;
  sim.war.command.nextOffensive = Infinity;
  return sim;
}

/** Выстрелы у КПП (в зонах КПП и пустоши) по сторонам: считаются каждый тик — список выстрелов обрезается. */
function watch(sim: Sim) {
  const w = { rebel: 0, cp: 0, cpDead: 0, rebelDead: 0 };
  const atFront = (x: number, y: number) => {
    const k = sim.map.zoneAtWorld(x, y)?.kind;
    return k === 'checkpoint' || k === 'outlands';
  };
  sim.combat.deathListeners.push((c) => {
    if (!atFront(c.x, c.y)) return;
    if (c.faction === 'rebel') w.rebelDead++;
    else if (c.faction === 'cp' || c.faction === 'ota') w.cpDead++;
  });
  const tick = () => {
    sim.step();
    const sh = sim.combat.shots;
    for (let j = sh.length - 1; j >= 0 && sh[j].t >= sim.combat.now - 1 / 60 - 1e-6; j--) {
      if (!atFront(sh[j].x, sh[j].y)) continue;
      if (sh[j].shooter?.faction === 'rebel') w.rebel++;
      else w.cp++;
    }
  };
  return { w, tick };
}

const run = (sim: Sim, secs: number, tick: () => void = () => sim.step()) => {
  for (let i = 0; i < secs * 60; i++) tick();
};

const lineOf = (sim: Sim, front: number): Character[] => sim.war.command.lineOf(sim.war.fronts[front]);
const brain = (c: Character) => c.brain as RebelBrain;

describe('огневые позиции линии (FrontLine)', () => {
  test('«Ничейная полоса»: позиции в траншее с обзором на пост, на дистанции и вразброс', { timeout: 60_000 }, () => {
    const sim = front();
    const L = WAR.line;
    for (const f of sim.war.fronts) {
      for (const held of [0, 1]) {
        const ps = sim.war.linePositions(f, held);
        // Много позиций, лучшие — траншея.
        expect(ps.length).toBeGreaterThanOrEqual(8);
        expect(ps.filter((p) => p.cover === 'trench').length).toBeGreaterThanOrEqual(4);
        for (const p of ps) {
          expect(p.held).toBe(held);
          expect(p.dist).toBeGreaterThanOrEqual(L.minRange);
          expect(p.dist).toBeLessThanOrEqual(L.maxRange);
          expect(canSeeCircle(sim.map, p.x, p.y, p.aim.x, p.aim.y, 6)).toBe(true);
          if (p.cover === 'trench') expect(inTrench(sim.map, p.x, p.y)).toBe(true);
          // Свой берег: held 0 — пустошь, held 1 — внешний двор.
          const kind = sim.map.zoneAtWorld(p.x, p.y)?.kind;
          expect(kind).toBe(held === 0 ? 'outlands' : 'checkpoint');
          if (held === 1) expect(sim.map.zoneAtWorld(p.x, p.y)?.id).toBe(f.points[0].zone);
        }
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y)).toBeGreaterThanOrEqual(L.spacing);
        // Отсортированы по качеству.
        for (let i = 1; i < ps.length; i++) expect(ps[i].score).toBeLessThanOrEqual(ps[i - 1].score);
      }
    }
  });

  test('на других типах КПП позиций меньше или нет — линия там малочисленна, но не ломается', { timeout: 120_000 }, () => {
    const counts: string[] = [];
    for (const type of ['classic', 'suburb', 'pass'] as const) {
      const sim = front(type);
      const f = sim.war.fronts[0];
      counts.push(`${type}: h0=${sim.war.linePositions(f, 0).length} h1=${sim.war.linePositions(f, 1).length}`);
      for (const held of [0, 1]) for (const p of sim.war.linePositions(f, held)) expect(['trench', 'block', 'corner']).toContain(p.cover);
      // Второе обращение — из кэша.
      expect(sim.war.linePositions(f, 0)).toBe(sim.war.linePositions(f, 0));
    }
    console.log(`позиций линии: ${counts.join('; ')}`);
  });
});

describe('позиционная перестрелка у КПП', () => {
  test('армия между наступлениями держит линию: бойцы в траншее, обмен огнём, потери малы', { timeout: 120_000 }, () => {
    const sim = front();
    const cmd = sim.war.command;
    const { w, tick } = watch(sim);
    run(sim, 100, tick);
    const before = { ...w };
    for (const f of sim.war.fronts) {
      const line = lineOf(sim, f.index);
      expect(line.length).toBeGreaterThanOrEqual(1);
      expect(line.length).toBeLessThanOrEqual(WAR.line.holders);
      // Боец линии — не штурмующий: в отряде фронта его нет, на каптах и в тревогу OTA он не считается.
      for (const c of line) expect(f.squad).not.toContain(c);
      const seated = line.filter((c) => brain(c).lineHere);
      expect(seated.length).toBeGreaterThanOrEqual(1);
      for (const c of seated) {
        // На позиции: в траншее (или за блоком), присев, смотрит на пост.
        const pos = brain(c).linePos!;
        expect(Math.hypot(c.x - pos.x, c.y - pos.y)).toBeLessThanOrEqual(WAR.line.leave);
        if (pos.cover === 'trench') expect(inTrench(sim.map, c.x, c.y)).toBe(true);
      }
    }
    // Остальная армия — в лагере, наступления нет.
    expect(cmd.offensive).toBeNull();
    // Минута боя: стреляют обе стороны, гарнизон почти цел.
    run(sim, 60, tick);
    const shotsR = w.rebel - before.rebel;
    const shotsC = w.cp - before.cp;
    console.log(`минута линии: выстрелов повстанцы/гарнизон ${shotsR}/${shotsC}, потери гарнизона ${w.cpDead - before.cpDead}, повстанцев ${w.rebelDead - before.rebelDead}`);
    expect(shotsR).toBeGreaterThan(0);
    expect(shotsC).toBeGreaterThan(0);
    expect(w.cpDead - before.cpDead).toBeLessThanOrEqual(3);
    // Часовые у линии сидят присев, пока идёт перестрелка.
    const sitting = sim.entities.list.filter((c) => c.alive && c.brain instanceof CpBrain && c.brain.front >= 0 && c.brain.sits);
    expect(sitting.length).toBeGreaterThanOrEqual(1);
    expect(sitting.some((c) => c.crouch)).toBe(true);
  });

  test('смена: отстоял shift — уходит в лагерь, на его место приходит свежий', { timeout: 120_000 }, () => {
    Object.assign(WAR.line, { shift: 50, relief: 15 });
    try {
      const sim = front();
      const cmd = sim.war.command;
      // Первая смена — до того, как за relief с до конца вызовут замену (50 − 15 = 35 с).
      run(sim, 30);
      const first = lineOf(sim, 0).map((c) => c.id);
      expect(first.length).toBeGreaterThanOrEqual(1);
      // Смена коротка, бойцов в запасе мало — прежние могут вернуться; смотрим всё время, а не только в конце.
      let fresh = false;
      let left = false;
      for (let t = 0; t < 85; t++) {
        run(sim, 1);
        if (lineOf(sim, 0).some((c) => !first.includes(c.id))) fresh = true;
        if (sim.entities.list.some((c) => first.includes(c.id) && c.alive && (c.brain as RebelBrain).mode !== 'line')) {
          left = true;
          // Сменённый ушёл с линии в лагерь (отход или уже там).
          const gone = sim.entities.list.filter((c) => first.includes(c.id) && c.alive && (c.brain as RebelBrain).mode !== 'line');
          expect(gone.every((c) => ['retreat', 'camp', 'line'].includes((c.brain as RebelBrain).mode))).toBe(true);
        }
      }
      expect(cmd.stats.lineShifts).toBeGreaterThanOrEqual(1);
      expect(lineOf(sim, 0).length).toBeGreaterThanOrEqual(1);
      // На линии побывал боец, которого не было в первой смене, а кто-то из первой — ушёл.
      expect(fresh).toBe(true);
      expect(left).toBe(true);
    } finally {
      Object.assign(WAR.line, JSON.parse(JSON.stringify(LINE0)));
    }
  });

  test('потери: погиб боец линии — штаб снимает линию на паузу (бойцы отходят), потом набирает снова', { timeout: 120_000 }, () => {
    try {
      const sim = front();
      const cmd = sim.war.command;
      const f = sim.war.fronts[0];
      run(sim, 70);
      const line = lineOf(sim, 0);
      expect(line.length).toBeGreaterThanOrEqual(1);
      // Теперь любая гибель бойца линии — пауза на 40 с.
      Object.assign(WAR.line.losses, { count: 1, window: 240, pause: 40 });
      sim.combat.kill(line[0], null, 'тест');
      expect(cmd.linePaused(f)).toBe(true);
      expect(cmd.stats.linePauses).toBeGreaterThanOrEqual(1);
      // Остальные отходят, замену не шлют — пока пауза.
      run(sim, 15);
      expect(lineOf(sim, 0).length).toBe(0);
      // Пауза кончилась — линия снова набирается.
      run(sim, 60);
      expect(cmd.linePaused(f)).toBe(false);
      expect(lineOf(sim, 0).length).toBeGreaterThanOrEqual(1);
    } finally {
      Object.assign(WAR.line, JSON.parse(JSON.stringify(LINE0)));
    }
  });

  test('захватили внешнюю точку (held 1) — линия переходит вперёд, КПП прорван — линия снята', { timeout: 120_000 }, () => {
    const sim = front();
    sim.war.reinforcements = false;
    const f = sim.war.fronts[0];
    const other = sim.war.fronts[1];
    run(sim, 70);
    const line0 = lineOf(sim, 0);
    expect(line0.length).toBeGreaterThanOrEqual(1);
    const xs0 = line0.map((c) => brain(c).linePos!.x);
    expect(line0.every((c) => brain(c).linePos!.held === 0)).toBe(true);
    // Внешняя точка у повстанцев: позиции — на полу внешнего двора, против постов внутренней.
    f.held = 1;
    f.heldSince = sim.war.now;
    run(sim, 40);
    const line1 = lineOf(sim, 0);
    expect(line1.length).toBeGreaterThanOrEqual(1);
    for (const c of line1) {
      const pos = brain(c).linePos!;
      expect(pos.held).toBe(1);
      expect(f.points[1].posts.some((p) => p.x === pos.aim.x && p.y === pos.aim.y)).toBe(true);
      expect(sim.map.zoneAtWorld(pos.x, pos.y)?.id).toBe(f.points[0].zone);
    }
    // Позиции ушли вперёд, к городу (на западном КПП — восточнее; на восточном — западнее).
    const forward = f.exit.x < f.innerGate.x ? 1 : -1;
    expect(line1.map((c) => brain(c).linePos!.x * forward).reduce((a, b) => a + b, 0) / line1.length).toBeGreaterThan(xs0.map((x) => x * forward).reduce((a, b) => a + b, 0) / xs0.length);
    // Второй КПП не затронут.
    expect(lineOf(sim, 1).length).toBeGreaterThanOrEqual(1);
    expect(lineOf(sim, other.index).every((c) => brain(c).linePos!.held === 0)).toBe(true);
    // КПП прорван — линия этого фронта снимается, бойцы идут к обычной логике отряда.
    const members = lineOf(sim, 0);
    f.held = f.points.length;
    f.owner = 'rebels';
    run(sim, 5);
    expect(lineOf(sim, 0)).toHaveLength(0);
    for (const c of members) expect(['gather', 'assault', 'capture', 'hold', 'retreat', 'raid']).toContain(brain(c).mode);
    expect(lineOf(sim, 1).length).toBeGreaterThanOrEqual(1);
  });

  test('линия не ломает наступление: бойцы линии остаются на местах и не идут на капт', { timeout: 120_000 }, () => {
    const sim = front();
    const cmd = sim.war.command;
    run(sim, 60);
    const line = [...lineOf(sim, 0), ...lineOf(sim, 1)];
    expect(line.length).toBeGreaterThanOrEqual(2);
    cmd.launchOffensive(0);
    run(sim, 20);
    const o = cmd.offensive!;
    expect(o).not.toBeNull();
    // В наступление ушли из лагеря, а не с линии.
    for (const c of line) expect(o.committed.has(c)).toBe(false);
    expect(o.committed.size).toBeGreaterThanOrEqual(WAR.offensive.minReady / 2);
    for (const c of line.filter((c) => c.alive)) expect(['line', 'retreat', 'camp']).toContain(brain(c).mode);
    for (const f of sim.war.fronts) for (const c of f.squad) expect(brain(c).mode).not.toBe('line');
  });
});
