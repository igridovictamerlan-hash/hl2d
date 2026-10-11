import { afterAll, describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { WAR } from '../src/config/war';
import { ROSTER } from '../src/config/roster';
import { inTrench } from '../src/world/trench';
import { canSeeCircle } from '../src/world/visibility';
import { smoothPath } from '../src/ai/smoothing';
import { poiWorld } from '../src/systems/Population';
import type { CheckpointType } from '../src/config/generator';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

const SEED = 12345;
const LINE0 = JSON.parse(JSON.stringify(WAR.line)) as typeof WAR.line;
const ARMY0 = ROSTER.army.map(([prof, n]) => [prof, n] as typeof ROSTER.army[number]);
const restoreArmy = () => ROSTER.army.forEach((e, i) => (e[1] = ARMY0[i][1]));
afterAll(() => {
  Object.assign(WAR.line, JSON.parse(JSON.stringify(LINE0)));
  restoreArmy();
});

/** Город с КПП «Ничейная полоса» и армией; наступлений нет (проверяем время между ними), подполье молчит. */
function front(type: CheckpointType = 'trenches') {
  // Пауза линии после потерь (WAR.line.losses) — предмет отдельного теста; в остальных линия не снимается.
  Object.assign(WAR.line.losses, { count: 999 });
  // Дорога к позициям простреливается постами через ворота: на разных сидах и картах первые две минуты уносят из девяти
  // годных в линию (солдаты и ветераны) от одного до восьми, а замены без паузы идут туда же. Запас вдвое больше — тесты
  // механики (смена, переход точки, пауза) не зависят от того, сколько бойцов успело погибнуть на подходе.
  restoreArmy();
  for (const e of ROSTER.army) if (e[0] === 'rebel_soldier' || e[0] === 'veteran') e[1] *= 2;
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

/** Крутить мир, пока cond не станет истиной (не дольше secs); сколько секунд ушло, -1 — не дождались. */
const until = (sim: Sim, cond: () => boolean, secs: number): number => {
  for (let i = 0; i < secs * 60; i++) {
    sim.step();
    if (cond()) return (i + 1) / 60;
  }
  return -1;
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

describe('путь под огнём: цена открытых мест (WAR.line.route)', () => {
  test('якорь на виду у постов вне траншеи стоит route.exposed, траншея и невидимое место — нет; мозг службы ищет путь с этой ценой', { timeout: 60_000 }, () => {
    const sim = front();
    const L = WAR.line;
    const f = sim.war.fronts[0];
    const cost = sim.war.coverCost(0)!;
    expect(cost).toBeTypeOf('function');
    let open = 0;
    let trench = 0;
    let hidden = 0;
    for (const a of f.outlands) {
      const x = sim.nav.worldX(a);
      const y = sim.nav.worldY(a);
      const seen = f.posts.some((p) => Math.hypot(p.x - x, p.y - y) <= L.exposeRange && canSeeCircle(sim.map, x, y, p.x, p.y, L.sightRadius));
      if (inTrench(sim.map, x, y)) {
        expect(cost(a)).toBe(0);
        trench++;
      } else if (seen) {
        expect(cost(a)).toBe(L.route.exposed);
        open++;
      } else {
        expect(cost(a)).toBe(0);
        hidden++;
      }
    }
    expect(open).toBeGreaterThan(0);
    expect(trench).toBeGreaterThan(0);
    void hidden;
    // Далеко от постов (площадь) — дешёво.
    const plazaAt = poiWorld(sim.ctx, 'plaza_center')!;
    expect(cost(sim.nav.nearestWalkable(plazaAt.x, plazaAt.y, 2))).toBe(0);
    expect(sim.war.coverCost(99)).toBeUndefined();
    // Бойцу линии, блиндажа, подносчику и отходящему путь строят с ценой; бойцу в лагере — обычный.
    run(sim, 20);
    const line = lineOf(sim, 0)[0];
    expect(line).toBeTruthy();
    expect(brain(line).mover.extraCost).toBeTypeOf('function');
    const camper = sim.war.command.army.find((c) => c.alive && brain(c).mode === 'camp' && !brain(c).onService)!;
    expect(camper).toBeTruthy();
    expect(brain(camper).mover.extraCost).toBeUndefined();
  });

  test('сглаживание пути не срезает через границу классов местности (укрытие — открытое место)', () => {
    const sim = front();
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    const pts = [-64, 0, 64].map((dx) => ({ x: p.x + dx, y: p.y }));
    // Без классов открытая прямая — два конца.
    expect(smoothPath(sim.map, pts, 12)).toHaveLength(2);
    // Из укрытия (класс 0) в открытое (1): промежуточная точка остаётся — путь не спрямляется напрямик.
    expect(smoothPath(sim.map, pts, 12, 2, [0, 0, 1])).toHaveLength(3);
    // Один класс на всём пути — спрямляется как обычно.
    expect(smoothPath(sim.map, pts, 12, 2, [1, 1, 1])).toHaveLength(2);
  });
});

describe('позиционная перестрелка у КПП', () => {
  test('армия между наступлениями держит линию: бойцы в траншее, обмен огнём, потери малы', { timeout: 120_000 }, () => {
    const sim = front();
    const cmd = sim.war.command;
    const { w, tick } = watch(sim);
    // Линия выходит из лагеря на позиции за полминуты-минуту (дорога под прицелом постов — часть идущих гибнет, на их
    // место выходят следующие): ждём, пока на каждом фронте кто-то сел на позицию, а не ровно 100 с — к фиксированному
    // моменту на карте с ходом сообщения вдоль ворот первая смена могла уже поредеть, а замена ещё идти.
    let formed = false;
    for (let i = 0; i < 100 * 60 && !formed; i++) {
      tick();
      if (i % 30 === 0) formed = sim.war.fronts.every((f) => lineOf(sim, f.index).some((c) => brain(c).lineHere));
    }
    expect(formed, 'на каждом фронте есть боец на позиции').toBe(true);
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

  test('смена: отстоял shift — уходит с линии (в блиндаж или в лагерь), на его место приходит свежий', { timeout: 120_000 }, () => {
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
      // Все, кто побывал на линии: подход под огнём стоит жизни части первой смены — уйти с линии живым может и бывший из
      // подкрепления, смена у всех одна.
      const seen = new Set<number>(first);
      for (let t = 0; t < 85; t++) {
        run(sim, 1);
        for (const c of lineOf(sim, 0)) seen.add(c.id);
        if (lineOf(sim, 0).some((c) => !first.includes(c.id))) fresh = true;
        // Сменённый ушёл с линии отдыхать — в блиндаж (WAR.dugout) или в лагерь (отход или уже там).
        const gone = sim.entities.list.filter((c) => seen.has(c.id) && c.alive && (c.brain as RebelBrain).mode !== 'line');
        if (gone.length) {
          left = true;
          expect(gone.every((c) => ['retreat', 'camp', 'line', 'bunker'].includes((c.brain as RebelBrain).mode))).toBe(true);
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
      // Пауза кончилась (40 с) — линия снова набирается. Ждём по условию: вернувшиеся на позиции под огнём тоже гибнут, а
      // при count 1 каждая гибель — снова пауза, так что «ровно через минуту пауза снята» — случайность, а не правило.
      expect(until(sim, () => !cmd.linePaused(f), 60), 'пауза снята').toBeGreaterThan(0);
      expect(until(sim, () => lineOf(sim, 0).length >= 1, 60), 'линия набрана снова').toBeGreaterThan(0);
    } finally {
      Object.assign(WAR.line, JSON.parse(JSON.stringify(LINE0)));
    }
  });

  test('засвеченная позиция (WAR.line.hot): где погиб боец, замену не садят, пока есть другая позиция', { timeout: 120_000 }, () => {
    const sim = front();
    const cmd = sim.war.command;
    const f = sim.war.fronts[0];
    expect(until(sim, () => lineOf(sim, 0).length >= 2 && lineOf(sim, 0).every((c) => brain(c).linePos), 90), 'линия набрана').toBeGreaterThan(0);
    const line = lineOf(sim, 0);
    const victim = line[0];
    const hot = brain(victim).linePos!;
    const left = line.slice(1).map((c) => c.id);
    sim.combat.kill(victim, null, 'тест');
    expect(cmd['hotness'](f.index, hot)).toBe(1);
    for (const q of sim.war.linePositions(f, f.held)) if (q !== hot) expect(cmd['hotness'](f.index, q)).toBe(0);
    // На место погибшего выходит свежий — на другую позицию, а не на ту же.
    expect(until(sim, () => lineOf(sim, 0).some((c) => !left.includes(c.id)), 60), 'замена вышла').toBeGreaterThan(0);
    for (const c of lineOf(sim, 0)) expect(brain(c).linePos?.anchor).not.toBe(hot.anchor);
    // Окно WAR.line.hot.window: потом позиция снова годна.
    cmd['time'] += WAR.line.hot.window + 1;
    expect(cmd['hotness'](f.index, hot)).toBe(0);
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
    for (const c of line.filter((c) => c.alive)) expect(['line', 'retreat', 'camp', 'bunker']).toContain(brain(c).mode);
    for (const f of sim.war.fronts) for (const c of f.squad) expect(brain(c).onService).toBe(false);
  });
});
