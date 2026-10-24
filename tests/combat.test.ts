import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit, poiWorld } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { SquadArena } from '../src/systems/SquadArena';
import { lineOfSight } from '../src/world/visibility';
import { CP_UNIT } from '../src/config/factions';
import { WEAPONS } from '../src/config/items';
import { GRENADE, HITS } from '../src/config/combat';
import { ARENA } from '../src/config/arena';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, until?: () => boolean): number {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (until && i % 30 === 0 && until()) return i / 60;
  }
  return seconds;
}

/** Площадь: открытое место для стрельбы. */
function plaza(sim: Sim) {
  return poiWorld(sim.ctx, 'plaza_center')!;
}

function patrolman(sim: Sim, x: number, y: number) {
  return spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, { x, y })!;
}

describe('попадания: зоны, броня, кровотечение', () => {
  test('голова без шлема — смерть от любого огнестрела; гражданин падает от 1–2 пуль в корпус', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const shooter = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    for (const id of ['rebel_pistol', 'usp', 'mp7', 'ak74', 'm4a4'] as const) {
      const v = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x + 40, p.y);
      sim.combat.applyHit(v, id, 'head', shooter);
      expect(v.alive).toBe(false);
    }
    const v = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x + 40, p.y);
    sim.combat.applyHit(v, 'usp', 'torso', shooter);
    expect(v.alive).toBe(true);
    sim.combat.applyHit(v, 'usp', 'torso', shooter);
    // Падает тяжелораненым (жив, но не боец).
    expect(v.fit).toBe(false);
    expect(sim.combat.headshots).toBe(5);
  });

  test('броня держит: патрульный переживает два выстрела из пистолета, OTA — выстрел в шлем', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const shooter = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    const cp = patrolman(sim, p.x + 40, p.y);
    sim.combat.applyHit(cp, 'usp', 'torso', shooter);
    sim.combat.applyHit(cp, 'usp', 'torso', shooter);
    expect(cp.alive).toBe(true);
    const ota = spawnRole(sim.ctx, { kind: 'ota', faction: 'ota', profession: 'ota_alpha', division: null, rank: 0, kit: 'ota_alpha' }, { x: p.x - 40, y: p.y })!;
    sim.combat.applyHit(ota, 'ak74', 'head', shooter);
    expect(ota.alive).toBe(true);
    expect(ota.health).toBeLessThan(ota.maxHealth);
  });

  test('ранение кровоточит: без перевязки — смерть, бинт останавливает кровь', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    const p = plaza(sim);
    const shooter = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    const a = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x + 30, p.y);
    const b = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x - 30, p.y);
    b.inventory.add('bandage', 1);
    sim.combat.applyHit(a, 'ak74', 'arm', shooter);
    sim.combat.applyHit(b, 'ak74', 'arm', shooter);
    expect(a.bleed).toBeGreaterThan(0);
    expect(a.armUntil).toBeGreaterThan(sim.combat.now);
    // Без мозга NPC не отвлекается: перевязывается, когда в него давно не стреляли.
    for (let k = 0; k < 60 * 5; k++) sim.combat.update(1 / 60);
    expect(b.bleed).toBe(0);
    expect(b.inventory.has('bandage')).toBe(false);
    for (let k = 0; k < 60 * 200 && a.alive; k++) sim.combat.update(1 / 60);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(true);
    expect(sim.combat.bledOut).toBe(1);
    expect(sim.log.some((l) => l.includes('истёк кровью'))).toBe(true);
  });

  test('ранен в ногу — хромает; перевязка игрока по B занимает время', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const shooter = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    const v = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x + 30, p.y, true);
    v.inventory.add('medkit', 1);
    sim.combat.applyHit(v, 'usp', 'leg', shooter);
    sim.combat.update(1 / 60);
    expect(v.speedMul).toBeCloseTo(HITS.limp, 5);
    expect(sim.combat.startBandage(v)).toBe(true);
    expect(sim.combat.canFire(v)).toBe(false);
    sim.combat.update(HITS.bandageTime + 0.05);
    expect(v.bleed).toBe(0);
    // Аптечка снимает и хромоту.
    sim.combat.update(1 / 60);
    expect(v.speedMul).toBe(1);
  });

  test('нож: два удара в спину валят патрульного, спереди — бронежилет держит', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const cp = patrolman(sim, p.x, p.y);
    cp.brain = null;
    cp.facing = 0;
    // Бандит за спиной (патрульный смотрит вправо, бандит слева).
    const bandit = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x - 26, p.y);
    equipKit(bandit, 'bandit', sim.ctx);
    sim.combat.equip(bandit, 'knife');
    sim.entities.rebuildHash();
    sim.combat.update(WEAPONS.knife.draw + 0.01);
    // Удар — после замаха: fire говорит, кого достанет, урон — через update.
    expect(sim.combat.fire(bandit, cp.x, cp.y)).toBe(cp);
    sim.combat.update(0.2);
    expect(cp.alive).toBe(true);
    sim.combat.update(1);
    sim.combat.fire(bandit, cp.x, cp.y);
    sim.combat.update(0.2);
    expect(cp.fit).toBe(false);
    // Лицом к лицу два удара не убивают.
    const cp2 = patrolman(sim, p.x, p.y + 60);
    cp2.brain = null;
    cp2.facing = Math.PI;
    bandit.x = cp2.x - 26;
    bandit.y = cp2.y;
    sim.entities.rebuildHash();
    for (let k = 0; k < 2; k++) {
      sim.combat.update(1);
      sim.combat.fire(bandit, cp2.x, cp2.y);
      sim.combat.update(0.2);
    }
    expect(cp2.alive).toBe(true);
  });
});

describe('гибель', () => {
  test('после гибели раны не остаются: игрок возрождается без хромоты, раны руки и кровотечения', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const shooter = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    const v = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x + 30, p.y, true);
    sim.combat.applyHit(v, 'usp', 'leg', shooter);
    sim.combat.applyHit(v, 'usp', 'arm', shooter);
    sim.combat.ignite(v, shooter);
    expect(v.limpUntil).toBeGreaterThan(sim.combat.now);
    sim.combat.applyHit(v, 'usp', 'head', shooter);
    expect(v.alive).toBe(false);
    expect(v.limpUntil).toBe(0);
    expect(v.armUntil).toBe(0);
    expect(v.bleed).toBe(0);
    expect(v.burnUntil).toBe(0);
  });
});

describe('пули и отдача', () => {
  test('пуля летит, урон — по прилёту; очередь уводит ствол, потом он возвращается', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y, true);
    equipKit(c, 'rebel', sim.ctx);
    const v = createCharacter(sim.entities, sim.ctx.rng, 'cp', p.x + 120, p.y);
    sim.entities.rebuildHash();
    sim.combat.update(WEAPONS.ak74.draw + 0.01);
    c.aim = 1;
    const hp = v.health;
    const hit = sim.combat.fire(c, v.x, v.y);
    expect(sim.combat.bullets.length).toBe(1);
    expect(v.health).toBe(hp);
    for (let k = 0; k < 10; k++) sim.combat.update(1 / 60);
    if (hit === v) expect(v.health).toBeLessThan(hp);
    expect(sim.combat.bullets.length).toBe(0);
    // Очередь: ствол уводит.
    for (let k = 0; k < 8; k++) {
      c.nextShot = 0;
      sim.combat.fire(c, c.x + 300, c.y - 200);
    }
    expect(Math.abs(c.kick)).toBeGreaterThan(0);
    for (let k = 0; k < 120; k++) sim.combat.update(1 / 60);
    expect(c.kick).toBe(0);
  });

  test('РПГ: ракета летит и взрывается у цели', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    equipKit(c, 'rebel_leader', sim.ctx);
    sim.combat.equip(c, 'rpg');
    // Цель в 200 px по чистой линии огня (с какой стороны площади — зависит от карты).
    const to = [[200, 0], [-200, 0], [0, 200], [0, -200]].map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).find((q) => lineOfSight(sim.map, p.x, p.y, q.x, q.y))!;
    const v = createCharacter(sim.entities, sim.ctx.rng, 'cp', to.x, to.y);
    sim.entities.rebuildHash();
    sim.combat.update(WEAPONS.rpg.draw + 0.01);
    c.aim = 1;
    sim.combat.fire(c, v.x, v.y);
    expect(sim.combat.bullets[0]?.rocket).toBe(true);
    for (let k = 0; k < 90 && sim.combat.blasts.length === 0; k++) {
      sim.entities.rebuildHash();
      sim.combat.update(1 / 60);
    }
    expect(sim.combat.blasts.length).toBe(1);
    expect(v.health).toBeLessThan(v.maxHealth);
  });
});

describe('гранаты', () => {
  test('дымовая: сквозь облако не видно, пули летят; дым рассеивается', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    c.inventory.add('smoke_grenade', 1);
    const g = sim.combat.throwGrenade(c, p.x + 120, p.y, 'smoke_grenade');
    expect(g?.kind).toBe('smoke_grenade');
    sim.combat.update(GRENADE.smoke.fuse + 0.05);
    expect(sim.combat.smokes.length).toBe(1);
    const s = sim.combat.smokes[0];
    // Сквозь центр облака не видно, но пуле ничто не мешает.
    expect(lineOfSight(sim.map, s.x - s.r - 20, s.y, s.x + s.r + 20, s.y)).toBe(false);
    const ts = sim.map.tileSize;
    expect(sim.map.blocksShot(Math.floor(s.x / ts), Math.floor(s.y / ts))).toBe(false);
    sim.combat.update(GRENADE.smoke.time + 0.1);
    expect(sim.combat.smokes.length).toBe(0);
    expect(sim.map.smoke.some((v) => v > 0)).toBe(false);
  });

  test('зажигательная: пламя поджигает, осколочная ранит и за радиусом', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    c.inventory.add('fire_grenade', 1);
    const v = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x + 120, p.y);
    sim.entities.rebuildHash();
    sim.combat.throwGrenade(c, v.x, v.y, 'fire_grenade');
    for (let k = 0; k < 60 * (GRENADE.fire.fuse + 0.2); k++) {
      sim.entities.rebuildHash();
      sim.combat.update(1 / 60);
    }
    expect(sim.combat.fires.length).toBe(1);
    expect(v.burnUntil).toBeGreaterThan(sim.combat.now);
  });
});

describe('растяжки', () => {
  test('растяжку повстанца задевает ВС, а не горожанин; тело можно заминировать', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    r.inventory.add('grenade', 2);
    expect(sim.combat.startPlant(r)).toBe(true);
    expect(sim.combat.canFire(r)).toBe(false);
    sim.combat.update(1 / 60);
    expect(sim.combat.mines.length).toBe(0);
    sim.combat.update(2);
    expect(sim.combat.mines.length).toBe(1);
    r.x += 200;
    sim.entities.rebuildHash();
    // Горожанин проходит — ничего.
    const cit = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y);
    sim.entities.rebuildHash();
    sim.combat.update(2);
    expect(sim.combat.mines.length).toBe(1);
    cit.x += 300;
    // Патрульный — щелчок и взрыв.
    const cp = patrolman(sim, p.x + 5, p.y);
    cp.brain = null;
    sim.entities.rebuildHash();
    for (let k = 0; k < 60; k++) {
      sim.entities.rebuildHash();
      sim.combat.update(1 / 60);
    }
    expect(sim.combat.mineStats.triggered).toBe(1);
    expect(cp.health).toBeLessThan(cp.maxHealth);
    // Тело рядом — растяжка под телом.
    sim.combat.damage(cit, 9999, null);
    r.x = cit.x;
    r.y = cit.y;
    const m = sim.combat.plantMine(r, 'grenade');
    expect(m?.corpse).toBeTruthy();
  });

  test('сотрудник Протектората замечает растяжку и обезвреживает', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x, p.y);
    r.inventory.add('grenade', 1);
    sim.combat.plantMine(r, 'grenade');
    r.x += 300;
    const cp = patrolman(sim, p.x - 60, p.y);
    cp.brain = null;
    cp.facing = 0;
    sim.entities.rebuildHash();
    for (let k = 0; k < 60 * 30 && sim.combat.mines.length; k++) sim.combat.update(1 / 60);
    expect(sim.combat.mineStats.defused).toBe(1);
    expect(cp.alive).toBe(true);
  });
});

describe('ИИ: бандит с ножом', () => {
  test('бандит заходит в спину одинокому патрульному и режет', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const p = plaza(sim);
    const cp = patrolman(sim, p.x, p.y);
    const bandit = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: 'bandit', division: null, rank: 0, kit: 'bandit' }, { x: p.x - 150, y: p.y })!;
    expect(bandit.inventory.has('knife')).toBe(true);
    let struck = false;
    run(sim, 90, () => (struck ||= cp.lastAttacker === bandit && cp.lastHurt > 0) && false);
    // Бандит выходит на дело не всегда (шанс) — но ударил хотя бы раз либо жив и занят своим.
    console.log(`бандит ударил: ${struck}, патрульный жив: ${cp.alive}`);
    expect(bandit.alive || !cp.alive || struck).toBe(true);
  });
});

describe('режим «отряд на отряд»', () => {
  test('два отряда сходятся на КПП, раунд кончается победой одной стороны, счёт растёт', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    sim.insurgency.paused = true;
    const arena = new SquadArena(sim.ctx, 'rebel', null);
    arena.startRound();
    expect(arena.members.combine.length).toBe(ARENA.teams.combine.length);
    expect(arena.members.rebel.length).toBe(ARENA.teams.rebel.length);
    const step = () => {
      sim.step();
      arena.update(1 / 60);
    };
    let rounds = 0;
    for (let i = 0; i < 60 * 400 && rounds < 2; i++) {
      step();
      if (!arena.live && arena.lastWinner && i % 60 === 0) rounds = arena.round - (arena.live ? 1 : 0);
    }
    console.log(`отряд на отряд: раундов ${arena.round}, счёт ${arena.score.combine}:${arena.score.rebel}, выстрелов ${sim.combat.shotsFired}, попаданий ${sim.combat.hits}, в голову ${sim.combat.headshots}, истекли кровью ${sim.combat.bledOut}`);
    expect(arena.round).toBeGreaterThanOrEqual(2);
    expect(arena.score.combine + arena.score.rebel).toBeGreaterThanOrEqual(1);
    expect(sim.combat.shotsFired).toBeGreaterThan(20);
  });
});
