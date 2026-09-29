import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation, poiWorld, armySpec, armyKit } from '../src/systems/Population';
import type { Character } from '../src/entities/Character';
import { spawnRole } from '../src/systems/Roster';
import { randomAnchorAround } from '../src/ai/destinations';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import { OtaBrain } from '../src/ai/brains/OtaBrain';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { CP_UNIT, REBEL_UNIT, rebelUnitOf } from '../src/config/factions';
import { WAR } from '../src/config/war';
import { ROSTER } from '../src/config/roster';
import { T } from '../src/world/tiles';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, until?: () => boolean): number {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (until && i % 30 === 0 && until()) return i / 60;
  }
  return seconds;
}

function spotNear(sim: Sim, p: { x: number; y: number }, r0: number, r1: number) {
  const a = randomAnchorAround(p, sim.ctx, r0, r1, new Set());
  return { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
}

describe('коды тревоги', () => {
  test('жёлтый — только когда ГО увидел убитого патрульного в городе', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    // Стрельба и тревога сами по себе код не меняют.
    sim.war.raiseAlarm(plaza.x, plaza.y, 'стрельба');
    expect(sim.war.code).toBe('green');
    const at = spotNear(sim, plaza, 0, 4);
    const victim = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, at)!;
    sim.combat.damage(victim, 9999, null);
    run(sim, 2);
    // Тело никто не видел — код зелёный.
    expect(sim.war.code).toBe('green');
    // Патрульный рядом видит тело — код жёлтый.
    spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, spotNear(sim, at, 2, 4));
    run(sim, 1);
    expect(sim.war.code).toBe('yellow');
    expect(sim.log.some((l) => l.includes('убитый патрульный'))).toBe(true);
  });

  test('красный код: возрождения нет ни у кого, после отбоя — снова', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    const admin = sim.entities.list.find((c) => c.faction === 'admin')!;
    const cit = sim.entities.list.find((c) => c.faction === 'citizen' && !c.isPlayer && c.role)!;
    const name = cit.name;
    expect(sim.war.setCode('red', admin)).toBeNull();
    sim.combat.damage(cit, 9999, null);
    run(sim, ROSTER.respawn.citizen + 5);
    expect(sim.entities.list.some((c) => c.alive && c.name === name)).toBe(false);
    expect(sim.war.setCode('green', admin)).toBeNull();
    run(sim, 3);
    expect(sim.entities.list.some((c) => c.alive && c.name === name)).toBe(true);
  });

  test('Администратор погиб при красном коде — выборов нет до отбоя', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    const admin = sim.entities.list.find((c) => c.faction === 'admin')!;
    const ofc = sim.entities.list.find((c) => c.faction === 'cp' && c.rank === CP_UNIT.ofc)!;
    expect(sim.war.setCode('red', ofc)).toBeNull();
    sim.combat.damage(admin, 9999, null);
    run(sim, 2);
    expect(sim.ctx.elections.current).toBeNull();
    expect(sim.war.setCode('green', ofc)).toBeNull();
    run(sim, 1);
    expect(sim.ctx.elections.current).not.toBeNull();
  });
});

describe('КПП', () => {
  test('лонг свободен: в нём нет бетонных блоков', () => {
    const sim = makeSim(12345);
    for (const f of sim.war.fronts) {
      let blocks = 0;
      let tiles = 0;
      for (let y = 0; y < sim.map.height; y++) {
        for (let x = 0; x < sim.map.width; x++) {
          if (sim.map.zoneGrid[y * sim.map.width + x] !== f.longZone) continue;
          tiles++;
          if (sim.map.tileAt(x, y) === T.BARRIER) blocks++;
        }
      }
      expect(tiles).toBeGreaterThan(30);
      expect(blocks).toBe(0);
    }
  });

  test('внутренний двор взят — сильнейшие встают у углов выхода в город', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const f = sim.war.fronts[0];
    const spots = sim.war.gateSpots(f);
    expect(spots.length).toBeGreaterThanOrEqual(3);
    for (const p of spots) expect(Math.hypot(p.x - f.apron.x, p.y - f.apron.y)).toBeLessThanOrEqual(WAR.capture.gateHold.radius);
    // Внешний двор уже наш, штурмуют внутренний.
    f.held = 1;
    const men: Character[] = [];
    for (const [prof, n] of [['rebel_recruit', 3], ['veteran', 2], ['commando', 1], ['hydra_sergeant', 1], ['rebel_soldier', 3]] as const) {
      for (let k = 0; k < n; k++) {
        const a = f.points[1].floor[(men.length * 7) % f.points[1].floor.length];
        const r = spawnRole(sim.ctx, armySpec(prof, armyKit(prof), rebelUnitOf(prof)!.rank), { x: sim.nav.worldX(a), y: sim.nav.worldY(a) })!;
        (r.brain as RebelBrain).march('gather');
        f.squad.push(r);
        men.push(r);
      }
    }
    run(sim, 0.5);
    sim.war.startCapture(f);
    run(sim, 3, () => f.owner === 'rebels');
    expect(f.owner).toBe('rebels');
    const gate = men.filter((r) => {
      const p = (r.brain as RebelBrain).post;
      return p && spots.some((s) => s.x === p.x && s.y === p.y);
    });
    expect(gate.length).toBeGreaterThanOrEqual(3);
    expect(gate.length).toBeLessThanOrEqual(WAR.capture.gateHold.count);
    // У выхода — самые крепкие (коммандос, сержант, ветераны), а не новобранцы и рядовые.
    expect(gate.some((r) => r.profession === 'commando')).toBe(true);
    expect(gate.every((r) => r.maxHealth >= WAR.capture.gateHold.minHp)).toBe(true);
    expect(gate.some((r) => r.rank === REBEL_UNIT.recruit)).toBe(false);
  });

  test('OTA идут на КПП, где больше всего повстанцев', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    const busy = sim.war.fronts[1];
    for (let k = 0; k < WAR.ota.minRebels + 2; k++) {
      const a = busy.outlands[(k * 5) % busy.outlands.length];
      const r = spawnRole(sim.ctx, armySpec('rebel_soldier', 'rebel_soldier', 0), { x: sim.nav.worldX(a), y: sim.nav.worldY(a) })!;
      (r.brain as RebelBrain).march('gather');
    }
    run(sim, WAR.ota.every + 1);
    const posted = sim.war.ota.filter((o) => (o.brain as OtaBrain).mode === 'post');
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((o) => (o.brain as OtaBrain).front === busy.index)).toBe(true);
    expect(sim.war.stats.otaDeployed).toBeGreaterThan(0);
  });
});

describe('мобилизация красного кода', () => {
  test('ГО с постов — в Нексус, у склада остаётся пара часовых; отбой — назад', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const admin = sim.entities.list.find((c) => c.faction === 'admin')!;
    const cp = (pred: (b: CpBrain) => boolean) => sim.entities.list.filter((c) => c.alive && c.brain instanceof CpBrain && pred(c.brain));
    const kpp = cp((b) => b.front >= 0);
    const sentries = cp((b) => b.duty === 'sentry');
    expect(kpp.length).toBeGreaterThan(4);
    expect(sentries.length).toBeGreaterThan(WAR.mobilize.depotKeep);
    expect(sim.war.setCode('red', admin)).toBeNull();
    run(sim, 2);
    // Все с КПП мобилизованы, у склада — ровно depotKeep часовых на своих постах.
    expect(kpp.every((c) => (c.brain as CpBrain).rally)).toBe(true);
    const kept = sentries.filter((c) => !(c.brain as CpBrain).rally);
    expect(kept.length).toBe(WAR.mobilize.depotKeep);
    for (const c of kpp) expect(sim.map.zoneAtWorld((c.brain as CpBrain).rally!.x, (c.brain as CpBrain).rally!.y)?.kind).toBe('nexus');
    run(sim, 90);
    const inNexus = kpp.filter((c) => c.alive && sim.map.zoneAtWorld(c.x, c.y)?.kind === 'nexus');
    expect(inNexus.length).toBeGreaterThanOrEqual(Math.ceil(kpp.filter((c) => c.alive).length * 0.8));
    expect(kpp.some((c) => c.alive && sim.map.zoneAtWorld(c.x, c.y)?.kind === 'checkpoint')).toBe(false);
    // Отбой — назад по постам.
    expect(sim.war.setCode('green', admin)).toBeNull();
    run(sim, 2);
    expect(kpp.some((c) => (c.brain as CpBrain).rally)).toBe(false);
  });

  test('штурм отбит, а КПП у повстанцев — красный код сменяется жёлтым, КПП снова наши — зелёный', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    for (const f of sim.war.fronts) {
      f.held = f.points.length;
      f.owner = 'rebels';
    }
    (sim.war as unknown as { declareRed(where: string): void }).declareRed('тест');
    expect(sim.war.code).toBe('red');
    // Прорвавшихся в городе нет (штурмующие перебиты) — после redMinTime код снимается.
    run(sim, WAR.redMinTime + WAR.calmToGreen + 2, () => sim.war.code !== 'red');
    expect(sim.war.code).toBe('yellow');
    expect(sim.war.curfew).toBe(false);
  });

  test('повстанцы, державшие КПП, при красном коде уходят на штурм', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const men: Character[] = [];
    for (const f of sim.war.fronts) {
      f.held = f.points.length;
      f.owner = 'rebels';
      for (let k = 0; k < 4; k++) {
        const post = f.points[1].posts[k % f.points[1].posts.length];
        const r = spawnRole(sim.ctx, armySpec('rebel_soldier', armyKit('rebel_soldier'), REBEL_UNIT.soldier), post)!;
        (r.brain as RebelBrain).setFront(f.index);
        (r.brain as RebelBrain).orderHold(post);
        f.squad.push(r);
        men.push(r);
      }
    }
    run(sim, 1);
    // До красного кода на каждом КПП держат посты holdKeep.
    const holding = () => men.filter((r) => (r.brain as RebelBrain).mode === 'hold').length;
    expect(holding()).toBe(WAR.holdKeep * sim.war.fronts.length);
    (sim.war as unknown as { declareRed(where: string): void }).declareRed('тест');
    run(sim, 1);
    expect(holding()).toBe(WAR.mobilize.rebelKeep * sim.war.fronts.length);
  });
});

describe('место преступления', () => {
  test('тело ГО нашли — оцепление, следователь SU.01 и офицер, за ленту не пускают, тело не обыскать', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    sim.ctx.insurgency.paused = true;
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    const at = spotNear(sim, plaza, 0, 4);
    const victim = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, at)!;
    sim.combat.damage(victim, 9999, null);
    const corpse = sim.combat.corpses[sim.combat.corpses.length - 1];
    spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, spotNear(sim, at, 2, 4));
    run(sim, 1);
    const scene = sim.war.scenes.list[0];
    expect(scene).toBeTruthy();
    expect(scene.corpse).toBe(corpse);
    // Проходы перекрыты: линии от стены до стены, на площади — переносные барьеры.
    expect(scene.lines.length).toBeGreaterThan(0);
    expect(scene.lines.every((l) => l.pts.length >= 2)).toBe(true);
    expect(scene.outside.length).toBeGreaterThan(0);
    // Едут следователь SU.01, медик SU.02 и офицер (PCU.OFC или SU.INSP).
    expect(scene.medic?.rank).toBe(CP_UNIT.su2);
    expect(scene.investigator?.rank).toBe(CP_UNIT.su1);
    expect([CP_UNIT.ofc, CP_UNIT.insp]).toContain(scene.officer?.rank);
    // Тело не обыскать не-сотруднику; житель внутри ленты выталкивается.
    // Житель, которого сейчас никто не проверяет (задержанных и остановленных лента не касается).
    const cit = sim.entities.list.find((c) => c.faction === 'citizen' && !c.isPlayer && c.alive && c.law.phase === 'none')!;
    expect(sim.war.scenes.sealed(corpse, cit)).toBe(true);
    expect(sim.war.scenes.sealed(corpse, scene.officer)).toBe(false);
    cit.x = cit.prevX = corpse.x + 10;
    cit.y = cit.prevY = corpse.y;
    sim.step();
    expect(sim.war.scenes.inScene(scene, cit.x, cit.y)).toBe(false);
    // Следователь доходит и осматривает тело, офицер стоит у ленты.
    const t = run(sim, 120, () => sim.war.scenes.stats.investigated > 0);
    console.log(`осмотр тела через ${t.toFixed(0)} с`);
    expect(corpse.scanned).toBe(true);
    const o = scene.officer!;
    const near = () => Math.hypot(o.x - scene.x, o.y - scene.y) < scene.r + 30;
    run(sim, 25, near);
    expect(near()).toBe(true);
    // Через holdAfter оцепление снимают, офицер возвращается к службе.
    run(sim, 40, () => scene.closed);
    expect(scene.closed).toBe(true);
    expect((o.brain as CpBrain).scene).toBeNull();
  });

  test('убит гражданский — SU.01 и медик, медик пишет в блокнот и накрывает тело, потом крематор', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    sim.ctx.insurgency.paused = true;
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    const at = spotNear(sim, plaza, 0, 4);
    const victim = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, at)!;
    const killer = sim.entities.list.find((c) => c.faction === 'citizen' && c !== victim && c.alive && !c.isPlayer)!;
    sim.combat.damage(victim, 9999, killer, null, true);
    const corpse = sim.combat.corpses[sim.combat.corpses.length - 1];
    // Рядом патрульный — заметит тело.
    spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, spotNear(sim, at, 2, 4));
    (sim.labor as unknown as { crematorAt: number }).crematorAt = Infinity;
    run(sim, 2);
    const scene = sim.war.scenes.list.find((x) => x.corpse === corpse)!;
    expect(scene).toBeTruthy();
    expect(scene.kind).toBe('civil');
    expect(scene.investigator?.rank).toBe(CP_UNIT.su1);
    expect(scene.medic?.rank).toBe(CP_UNIT.su2);
    // Инспектора и офицера к гражданскому не шлют.
    expect(scene.officer).toBeNull();
    const medic = scene.medic!;
    let wrote = false;
    run(sim, 150, () => {
      wrote ||= medic.notepadUntil > sim.combat.now;
      return !!corpse.covered;
    });
    expect(wrote).toBe(true);
    expect(corpse.covered).toBe(true);
    // Накрытое тело не обыскать; убийца — в розыске после осмотра следователя.
    const cit = sim.entities.list.find((c) => c.faction === 'citizen' && c.alive && !c.isPlayer)!;
    expect(sim.war.scenes.sealed(corpse, cit)).toBe(true);
    run(sim, 150, () => scene.closed);
    expect(scene.closed).toBe(true);
    // Следователь осмотрел: убийца объявлен в розыск (его могли уже и задержать).
    expect(corpse.scanned).toBe(true);
    expect(killer.law.wanted || killer.law.phase !== 'none').toBe(true);
    // Оцепление снято — крематор забирает накрытое тело.
    (sim.labor as unknown as { crematorAt: number }).crematorAt = 0;
    run(sim, 240, () => !sim.combat.corpses.includes(corpse));
    expect(sim.combat.corpses.includes(corpse)).toBe(false);
  });

  test('узкий переулок — лента от стены до стены; широкая улица — барьеры', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const W = sim.map.width;
    // Узкое место: клетка пола, по бокам (по x) стены, вверх и вниз — пол.
    let alley: { x: number; y: number } | null = null;
    let wide: { x: number; y: number } | null = null;
    const ts = sim.map.tileSize;
    for (let i = 0; i < sim.map.tiles.length && !(alley && wide); i++) {
      const tx = i % W;
      const ty = (i - tx) / W;
      const kind = sim.map.zoneAtTile(tx, ty)?.kind;
      if (sim.map.levelAt(tx * ts, ty * ts) !== 'city' || sim.map.isSolid(tx, ty)) continue;
      if (!alley && kind === 'residential' && sim.map.isSolid(tx - 2, ty) && sim.map.isSolid(tx + 2, ty) && !sim.map.isSolid(tx - 1, ty) && !sim.map.isSolid(tx + 1, ty)) {
        let ok = true;
        for (let d = -6; d <= 6 && ok; d++) for (let e = -1; e <= 1; e++) if (sim.map.isSolid(tx + e, ty + d) || sim.map.tileAt(tx + e, ty + d) === T.DOOR) ok = false;
        for (let d = -6; d <= 6 && ok; d++) if (!sim.map.isSolid(tx - 2, ty + d) || !sim.map.isSolid(tx + 2, ty + d)) ok = false;
        if (ok) alley = { x: (tx + 0.5) * ts, y: (ty + 0.5) * ts };
      }
      if (!wide && kind === 'avenue') {
        let open = 0;
        for (let d = -6; d <= 6; d++) if (!sim.map.isSolid(tx + d, ty) && !sim.map.isSolid(tx, ty + d)) open++;
        if (open === 13) wide = { x: (tx + 0.5) * ts, y: (ty + 0.5) * ts };
      }
    }
    expect(alley).toBeTruthy();
    expect(wide).toBeTruthy();
    const body = (p: { x: number; y: number }) => ({ x: p.x, y: p.y, faction: 'citizen' as const, profession: null, killer: null, rank: 0, name: 'Тест', until: 1e9, loot: [] });
    const a = sim.war.scenes.open(body(alley!), 'civil')!;
    // Прямой переулок: две линии поперёк, каждая — короткая лента, концы у стен.
    expect(a.lines.length).toBe(2);
    for (const l of a.lines) {
      expect(l.barrier).toBe(false);
      const [p, q] = [l.pts[0], l.pts[l.pts.length - 1]];
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(ts * 2);
      for (const e of [p, q]) {
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => sim.map.isSolid(Math.floor((e.x + dx * 4) / ts), Math.floor((e.y + dy * 4) / ts)));
        expect(near).toBe(true);
      }
    }
    const w = sim.war.scenes.open(body(wide!), 'civil')!;
    expect(w.lines.some((l) => l.barrier)).toBe(true);
  });

  test('красный код — оцеплений нет', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    (sim.war as unknown as { declareRed(where: string): void }).declareRed('тест');
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    expect(sim.war.scenes.open({ x: plaza.x, y: plaza.y, faction: 'citizen', profession: null, killer: null, rank: 0, name: 'Тест', until: 1e9, loot: [] }, 'civil')).toBeNull();
  });

  test('бандит обирает неоцеплённое тело ГО — забирает оружие', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const plaza = poiWorld(sim.ctx, 'plaza_center')!;
    const at = spotNear(sim, plaza, 0, 4);
    const victim = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, at)!;
    sim.combat.damage(victim, 9999, null);
    // Несколько бандитов вокруг: каждый решает сам (с шансом CRIME.loot.chance), кто-то да обберёт.
    const bandits = [0, 1, 2].map(() => spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'bandit', division: null, rank: 0, kit: 'citizen' }, spotNear(sim, at, 6, 10))!);
    // Крематор из Нексуса (он у площади) не должен увезти тело раньше: проверяем бандитов.
    (sim.labor as unknown as { crematorAt: number }).crematorAt = Infinity;
    // Тело могут заметить ГО у площади — тогда лента; здесь проверяем неоцеплённое (ленту снимаем).
    for (let i = 0; i < 90 * 60 && sim.crime.stats.corpseLoots === 0; i++) {
      sim.war.scenes.closeAll();
      sim.step();
    }
    expect(sim.crime.stats.corpseLoots).toBeGreaterThan(0);
    expect(bandits.some((b) => b.inventory.has('usp'))).toBe(true);
  });
});

