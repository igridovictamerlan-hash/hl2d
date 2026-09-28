import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit, poiWorld, spawnPopulation } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { CP_UNIT } from '../src/config/factions';
import { SUPPRESS, CROUCH, DOWNED } from '../src/config/tactics';
import { T } from '../src/world/tiles';
import { lineOfSight } from '../src/world/visibility';
import { findCover, columnSpot } from '../src/ai/Tactics';
import { Gunner } from '../src/ai/Gunner';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { RebelBrain } from '../src/ai/brains/RebelBrain';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, until?: () => boolean): number {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (until && i % 10 === 0 && until()) return i / 60;
  }
  return seconds;
}

function plaza(sim: Sim) {
  return poiWorld(sim.ctx, 'plaza_center')!;
}

/** Бойцы без мозга: стоят, где поставили, стреляем за них вручную. */
function dummy(sim: Sim, faction: 'rebel' | 'cp' | 'citizen', x: number, y: number, kit: string | null = null): Character {
  const c = createCharacter(sim.entities, sim.ctx.rng, faction, x, y);
  c.brain = null;
  if (kit) equipKit(c, kit, sim.ctx);
  return c;
}

describe('подавление огнём', () => {
  test('пули рядом прижимают врага (своего — нет), конус шире, со временем спадает', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const shooter = dummy(sim, 'rebel', p.x - 150, p.y, 'rebel_soldier');
    sim.combat.equip(shooter, 'ak74');
    // Враг чуть в стороне от линии огня, свой — с другой стороны.
    const enemy = dummy(sim, 'cp', p.x + 60, p.y + 26, 'cp');
    const friend = dummy(sim, 'rebel', p.x + 60, p.y - 26);
    sim.entities.rebuildHash();
    sim.combat.update(1);
    const spread0 = sim.combat.spreadOf(enemy, null) || 0;
    void spread0;
    enemy.inventory.add('usp', 1);
    sim.combat.equip(enemy, 'usp');
    const before = sim.combat.spreadOf(enemy);
    for (let k = 0; k < 6; k++) {
      shooter.aim = 1;
      sim.combat.fire(shooter, p.x + 200, p.y);
      for (let i = 0; i < 12; i++) sim.combat.update(1 / 60);
      sim.entities.rebuildHash();
    }
    expect(enemy.suppress).toBeGreaterThan(0.3);
    expect(friend.suppress).toBe(0);
    expect(sim.combat.spreadOf(enemy)).toBeGreaterThan(before + SUPPRESS.spread * 0.2);
    // Тишина — подавление спадает.
    for (let i = 0; i < 60 * 6; i++) sim.combat.update(1 / 60);
    expect(enemy.suppress).toBe(0);
  });

  test('взрыв рядом прижимает; игроку пуля над ухом даёт щелчок пролёта', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const thrower = dummy(sim, 'rebel', p.x - 200, p.y);
    const cp = dummy(sim, 'cp', p.x + 150, p.y);
    sim.entities.rebuildHash();
    sim.combat.explode(p.x, p.y, thrower, 'frag', 1);
    expect(cp.suppress).toBeGreaterThan(0.1);
    // Игрок у линии огня.
    const player = createCharacter(sim.entities, sim.ctx.rng, 'cp', p.x + 40, p.y + 20, true);
    const shooter = dummy(sim, 'rebel', p.x - 150, p.y + 20, 'rebel_soldier');
    sim.combat.equip(shooter, 'ak74');
    sim.entities.rebuildHash();
    sim.combat.update(1);
    const seq = sim.combat.fxSeq;
    for (let k = 0; k < 4; k++) {
      sim.combat.fire(shooter, p.x + 200, p.y + 20 + 34);
      for (let i = 0; i < 10; i++) sim.combat.update(1 / 60);
    }
    const whiz = sim.combat.fx.filter((f) => f.seq > seq && f.kind === 'whiz' && f.target === player);
    expect(whiz.length).toBeGreaterThan(0);
  });
});

describe('присед и низкое укрытие', () => {
  test('присевший за бетонным блоком почти неуязвим и не виден, пока не выстрелит', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const ts = sim.map.tileSize;
    // Стенка из бетонных блоков поперёк линии огня у самой цели.
    const tx = Math.floor((p.x + 100) / ts);
    const ty = Math.floor(p.y / ts);
    for (let dy = -2; dy <= 2; dy++) sim.map.tiles[(ty + dy) * sim.map.width + tx] = T.BARRIER;
    const shooter = dummy(sim, 'cp', p.x - 150, p.y, 'cp_su');
    sim.combat.equip(shooter, 'm4a4');
    const target = dummy(sim, 'rebel', (tx + 1) * ts + 14, p.y, 'rebel_soldier');
    sim.entities.rebuildHash();
    sim.combat.update(1);
    const hitsWhen = (crouch: boolean) => {
      target.crouch = crouch;
      let hits = 0;
      for (let k = 0; k < 60; k++) {
        shooter.aim = 1;
        shooter.recoil = 0;
        shooter.kick = 0;
        shooter.nextShot = 0;
        target.health = target.maxHealth;
        if (sim.combat.fire(shooter, target.x, target.y) === target) hits++;
      }
      sim.combat.bullets.length = 0;
      return hits;
    };
    const standing = hitsWhen(false);
    const crouched = hitsWhen(true);
    console.log(`попаданий из 60: стоя ${standing}, присев ${crouched}`);
    expect(crouched).toBeLessThan(standing * 0.5);
    // Присевший за блоком не виден, пока не стреляет; выстрелил — виден.
    target.crouch = true;
    target.lastFired = -1e9;
    expect(sim.combat.concealed(target, shooter.x, shooter.y)).toBe(true);
    shooter.facing = 0;
    const g = new Gunner(sim.ctx.rng);
    expect(g.acquire(shooter, sim.ctx)).toBeNull();
    target.lastFired = sim.combat.now;
    expect(sim.combat.concealed(target, shooter.x, shooter.y)).toBe(false);
    expect(g.acquire(shooter, sim.ctx)).toBe(target);
    // Вплотную (ближе hideMinDist) присевший виден.
    target.lastFired = -1e9;
    expect(sim.combat.concealed(target, target.x + CROUCH.hideMinDist * 0.5, target.y)).toBe(false);
  });

  test('присед: медленнее, конус уже; NPC в бою на месте садится, пошёл — встал', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const c = dummy(sim, 'rebel', p.x, p.y, 'rebel_soldier');
    sim.combat.equip(c, 'ak74');
    sim.combat.update(1);
    const stand = sim.combat.spreadOf(c);
    c.crouch = true;
    sim.combat.update(1 / 60);
    expect(sim.combat.spreadOf(c)).toBeCloseTo(stand * CROUCH.spreadMul, 5);
    expect(c.speedMul).toBeCloseTo(CROUCH.speedMul, 5);
    // NPC-патрульный видит вооружённого повстанца: стоит и стреляет — присел.
    // С той стороны, откуда повстанца видно (зависит от карты).
    const from = [[-180, 0], [180, 0], [0, -180], [0, 180]].map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).find((q) => lineOfSight(sim.map, q.x, q.y, p.x, p.y) && !sim.map.isSolid(Math.floor(q.x / 16), Math.floor(q.y / 16)))!;
    const cp = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.su3, kit: 'cp_su' }, from)!;
    cp.facing = Math.atan2(p.y - from.y, p.x - from.x);
    let crouched = false;
    run(sim, 6, () => (crouched ||= cp.crouch && cp.moveSpeed < 5) && false);
    expect(crouched).toBe(true);
  });
});

describe('тяжёлое ранение', () => {
  test('смертельный урон — падает на DOWNED.time с; не дождался помощи — смерть; голова без шлема — сразу', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const shooter = dummy(sim, 'cp', p.x - 80, p.y, 'cp');
    const v = dummy(sim, 'rebel', p.x, p.y, 'rebel_soldier');
    sim.entities.rebuildHash();
    sim.combat.damage(v, v.health + 5, shooter, 'torso');
    expect(v.alive).toBe(true);
    expect(v.downed).toBe(true);
    expect(v.fit).toBe(false);
    // Лежащий — не угроза, не стреляет.
    expect(sim.combat.threat(shooter, v)).toBe(false);
    expect(sim.combat.canFire(v)).toBe(false);
    for (let i = 0; i < 60 * (DOWNED.time - 1); i++) sim.combat.update(1 / 60);
    expect(v.alive).toBe(true);
    for (let i = 0; i < 60 * 2; i++) sim.combat.update(1 / 60);
    expect(v.alive).toBe(false);
    expect(sim.combat.bledOut).toBe(1);
    // Голова без шлема — насмерть сразу.
    const w = dummy(sim, 'citizen', p.x, p.y + 60);
    sim.combat.applyHit(w, 'usp', 'head', shooter);
    expect(w.alive).toBe(false);
    // Урон «с запасом» (больше overkill × здоровья за раз) — тоже насмерть.
    const z = dummy(sim, 'citizen', p.x, p.y + 90);
    sim.combat.damage(z, z.health + z.maxHealth * (DOWNED.overkill + 0.1), shooter, 'torso');
    expect(z.alive).toBe(false);
  });

  test('лежащего добивает любой урон; пуля, выпущенная до падения, уходит поверх; в своего лежащего не попадают', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const shooter = dummy(sim, 'cp', p.x - 100, p.y, 'cp_su');
    sim.combat.equip(shooter, 'm4a4');
    const v = dummy(sim, 'rebel', p.x, p.y, 'rebel_soldier');
    sim.entities.rebuildHash();
    sim.combat.update(1);
    shooter.aim = 1;
    // Пуля в полёте, цель падает от другой — пуля уходит поверх.
    expect(sim.combat.fire(shooter, v.x, v.y)).toBe(v);
    sim.combat.damage(v, v.health + 5, null, 'torso');
    expect(v.downed).toBe(true);
    for (let i = 0; i < 30; i++) sim.combat.update(1 / 60);
    expect(v.alive).toBe(true);
    // Лежащий рядом со своей целью (свой для стрелка) не ловит пуль.
    const ally = dummy(sim, 'cp', p.x + 60, p.y);
    const enemy = dummy(sim, 'rebel', p.x + 80, p.y, 'rebel_soldier');
    sim.combat.damage(ally, ally.health + 5, enemy, 'torso');
    sim.entities.rebuildHash();
    for (let k = 0; k < 10; k++) {
      shooter.nextShot = 0;
      shooter.aim = 1;
      const hit = sim.combat.fire(shooter, ally.x + 2, ally.y);
      expect(hit).not.toBe(ally);
      expect(hit).not.toBe(v);
    }
    // Добить: любой урон по лежащему.
    sim.combat.damage(v, 1, shooter, 'torso');
    expect(v.alive).toBe(false);
    expect(sim.combat.finished).toBe(1);
  });

  test('свой с бинтом поднимает; тащит лежащего за собой; медик поднимает быстрее и крепче', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const v = dummy(sim, 'rebel', p.x, p.y, 'rebel_soldier');
    const h = dummy(sim, 'rebel', p.x + 24, p.y, 'rebel_recruit');
    sim.entities.rebuildHash();
    sim.combat.damage(v, v.health + 5, null, 'torso');
    expect(sim.combat.canRevive(h, v)).toBe(true);
    // Враг поднимать не станет, ГО — задерживает (стабилизирует), а не лечит.
    const cp = dummy(sim, 'cp', p.x - 20, p.y, 'cp');
    expect(sim.combat.canRevive(cp, v)).toBe(false);
    expect(sim.combat.canRevive(cp, v, true)).toBe(true);
    // Тащит: лежащий следует на верёвке.
    expect(sim.combat.startDrag(h, v)).toBe(true);
    for (let i = 0; i < 10; i++) {
      h.x += 8;
      sim.combat.update(1 / 60);
    }
    expect(Math.hypot(v.x - h.x, v.y - h.y)).toBeLessThanOrEqual(DOWNED.dragDist + 1);
    expect(v.x).toBeGreaterThan(p.x + 40);
    sim.combat.stopDrag(h);
    h.x = v.x + 24;
    h.y = v.y;
    const bandages = h.inventory.count('bandage');
    expect(sim.combat.startRevive(h, v)).toBe(true);
    for (let i = 0; i < 60 * (DOWNED.reviveTime + 0.2); i++) sim.combat.update(1 / 60);
    expect(v.downed).toBe(false);
    expect(v.fit).toBe(true);
    expect(h.inventory.count('bandage')).toBe(bandages - 1);
    expect(v.health).toBeCloseTo(v.maxHealth * DOWNED.reviveHp, 0);
    // Медик — вдвое быстрее и крепче.
    const m = dummy(sim, 'rebel', v.x + 24, v.y, 'rebel_medic');
    m.profession = 'rebel_medic';
    sim.combat.damage(v, v.health + 5, null, 'torso');
    expect(sim.combat.startRevive(m, v)).toBe(true);
    for (let i = 0; i < 60 * (DOWNED.reviveTime * DOWNED.medicMul + 0.2); i++) sim.combat.update(1 / 60);
    expect(v.fit).toBe(true);
    expect(v.health).toBeGreaterThan(v.maxHealth * DOWNED.reviveHp * 1.2);
  });

  test('NPC сам бежит к своему тяжелораненому и поднимает его', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    const camp = poiWorld(sim.ctx, 'rebel_camp')!;
    const spec = { kind: 'army' as const, faction: 'rebel' as const, profession: 'rebel_soldier' as const, division: null, rank: 0, kit: 'rebel_soldier' };
    const v = spawnRole(sim.ctx, spec, { x: camp.x, y: camp.y })!;
    const h = spawnRole(sim.ctx, spec, { x: camp.x + 90, y: camp.y })!;
    expect(v.brain).toBeInstanceOf(RebelBrain);
    expect(h.inventory.has('bandage')).toBe(true);
    sim.combat.damage(v, v.health + 5, null, 'torso');
    expect(v.downed).toBe(true);
    const t = run(sim, DOWNED.time - 2, () => v.fit);
    console.log(`подняли через ${t.toFixed(1)} с`);
    expect(v.fit).toBe(true);
    expect(sim.combat.revives).toBeGreaterThan(0);
  });

  test('ГО в городе задерживает лежащего раненого повстанца и ведёт в КПЗ', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    sim.war.reinforcements = false;
    sim.insurgency.paused = true;
    const p = plaza(sim);
    const cp = spawnRole(sim.ctx, { kind: 'patrol', faction: 'cp', profession: null, division: null, rank: CP_UNIT.pcu3, kit: 'cp' }, { x: p.x - 60, y: p.y })!;
    const a = sim.nav.nearestWalkable(p.x + 40, p.y, 4);
    const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(a), sim.nav.worldY(a));
    r.brain = null;
    r.hostile = true;
    sim.entities.rebuildHash();
    sim.combat.damage(r, r.health + 5, cp, 'torso');
    expect(r.downed).toBe(true);
    run(sim, 15, () => r.law.phase === 'cuffed');
    expect(r.law.phase).toBe('cuffed');
    expect(r.law.handler).toBe(cp);
    expect(r.fit).toBe(true);
    expect(r.weapon).toBeNull();
    expect((cp.brain as CpBrain).fsm.current).toBe('escort');
    // Задержанного не обстреливают.
    expect(sim.combat.threat(cp, r)).toBe(false);
  });
});

describe('тактика ИИ', () => {
  test('укрытие: из-за угла врага не видно, а с шага в сторону — видно', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    let found = 0;
    for (let k = 0; k < 40; k++) {
      const a = sim.nav.nearestWalkable(p.x + sim.ctx.rng.range(-400, 400), p.y + sim.ctx.rng.range(-400, 400), 6);
      if (a < 0) continue;
      const self = dummy(sim, 'cp', sim.nav.worldX(a), sim.nav.worldY(a));
      const threat = { x: self.x + 160, y: self.y + sim.ctx.rng.range(-60, 60) };
      const spot = findCover(self, sim.ctx, threat, null, 170, 400);
      if (!spot) continue;
      found++;
      const hx = sim.nav.worldX(spot.hide);
      const hy = sim.nav.worldY(spot.hide);
      if (spot.kind === 'corner') {
        expect(lineOfSight(sim.map, hx, hy, threat.x, threat.y)).toBe(false);
        expect(lineOfSight(sim.map, sim.nav.worldX(spot.peek), sim.nav.worldY(spot.peek), threat.x, threat.y)).toBe(true);
      }
    }
    expect(found).toBeGreaterThan(5);
  });

  test('колонна: место k-го — на k × gap по следу ведущего', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const lead = dummy(sim, 'cp', p.x, p.y);
    const f = dummy(sim, 'cp', p.x - 100, p.y);
    // Ведущий прошёл по прямой вправо.
    for (let i = 0; i < 20; i++) {
      lead.x += 8;
      columnSpot(lead, 1, f);
    }
    const s1 = { ...columnSpot(lead, 1, f) };
    const s2 = { ...columnSpot(lead, 2, f) };
    expect(Math.abs(lead.x - s1.x - 26)).toBeLessThan(3);
    expect(Math.abs(lead.x - s2.x - 52)).toBeLessThan(3);
    expect(Math.abs(s1.y - p.y)).toBeLessThan(1);
  });

  test('живой город: в перестрелках — укрытия, колонны звеньев, раненых поднимают', { timeout: 180_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    const seen = new Set<string>();
    for (let t = 0; t < 240 * 60; t++) {
      sim.step();
      if (t % 30 !== 0) continue;
      for (const c of sim.entities.list) {
        const s = c.brain?.stateName ?? '';
        for (const k of ['за углом', 'выглядывает', 'за блоком', 'колонна', 'помощь раненому']) if (s.includes(k)) seen.add(k);
        if (c.crouch) seen.add('присел');
      }
    }
    const C = sim.combat;
    console.log(`тактика: ${[...seen].join(', ')}; ранены тяжело ${C.downs}, подняты ${C.revives}, добиты ${C.finished}, истекли ${C.bledOut}`);
    expect(C.downs).toBeGreaterThan(0);
    expect(C.revives).toBeGreaterThan(0);
    expect(seen.has('присел')).toBe(true);
    expect(seen.has('за углом') || seen.has('за блоком')).toBe(true);
    expect(seen.has('колонна')).toBe(true);
  });
});
