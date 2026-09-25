import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit, spawnPopulation, poiWorld } from '../src/systems/Population';
import { angleDiff, falloffMul } from '../src/systems/CombatSystem';
import { WEAPONS } from '../src/config/items';
import { COMBAT } from '../src/config/combat';
import { CpBrain } from '../src/ai/brains/CpBrain';

type Sim = ReturnType<typeof makeSim>;

/** Стрелок-игрок на площади (открытое место) с набором kit и оружием id в руках. */
function shooterOnPlaza(sim: Sim, kit: string, id: Parameters<Sim['combat']['equip']>[1]) {
  const p = poiWorld(sim.ctx, 'plaza_center')!;
  const c = createCharacter(sim.entities, sim.ctx.rng, 'cp', p.x, p.y, true);
  equipKit(c, kit, sim.ctx);
  sim.combat.equip(c, id);
  sim.combat.update(1);
  return c;
}

describe('оружие: конус разброса как в Foxhole', () => {
  test('прицеливание сужает конус, ходьба и бег расширяют, отдача копится и спадает', () => {
    const sim = makeSim(12345);
    const c = shooterOnPlaza(sim, 'cp', 'usp');
    const w = WEAPONS.usp;
    expect(sim.combat.spreadOf(c)).toBeCloseTo(w.spreadHip, 5);
    c.aiming = true;
    for (let k = 0; k < 60; k++) sim.combat.update(1 / 60);
    expect(c.aim).toBe(1);
    expect(sim.combat.spreadOf(c)).toBeCloseTo(w.spreadAim, 5);
    // Ходьба и бег.
    c.moveSpeed = 95;
    const walking = sim.combat.spreadOf(c);
    c.moveSpeed = 170;
    const running = sim.combat.spreadOf(c);
    expect(walking).toBeGreaterThan(w.spreadAim);
    expect(running).toBeGreaterThan(walking);
    // На бегу прицел теряется.
    for (let k = 0; k < 30; k++) sim.combat.update(1 / 60);
    expect(c.aim).toBeLessThan(0.5);
    c.moveSpeed = 0;
    // Отдача: три выстрела подряд расширяют конус, потом он возвращается.
    for (let k = 0; k < 60; k++) sim.combat.update(1 / 60);
    const steady = sim.combat.spreadOf(c);
    for (let k = 0; k < 3; k++) {
      sim.combat.fire(c, c.x + 100, c.y);
      c.nextShot = 0;
    }
    expect(sim.combat.spreadOf(c)).toBeCloseTo(steady + 3 * w.recoil, 5);
    for (let k = 0; k < 60; k++) sim.combat.update(1 / 60);
    expect(sim.combat.spreadOf(c)).toBeCloseTo(steady, 5);
  });

  test('каждая пуля летит внутри нарисованного конуса', () => {
    const sim = makeSim(12345);
    const c = shooterOnPlaza(sim, 'cp_grid', 'mp7');
    const aim = 0.7;
    const tx = c.x + Math.cos(aim) * 150;
    const ty = c.y + Math.sin(aim) * 150;
    let worst = 0;
    for (let k = 0; k < 300; k++) {
      c.nextShot = 0;
      c.mag = 45;
      c.recoil = (k % 10) * 0.6;
      const spread = (sim.combat.spreadOf(c) * Math.PI) / 180;
      sim.combat.tracers.length = 0;
      sim.combat.fire(c, tx, ty);
      const t = sim.combat.tracers[0];
      const d = Math.abs(angleDiff(Math.atan2(t.y1 - t.y0, t.x1 - t.x0), aim));
      worst = Math.max(worst, d / spread);
    }
    expect(worst).toBeLessThanOrEqual(1 + 1e-9);
    expect(worst).toBeGreaterThan(0.5);
  });

  test('дробовик: 8 дробин за выстрел, урон падает с дальностью; заряжается по патрону', () => {
    const sim = makeSim(12345);
    const c = shooterOnPlaza(sim, 'rebel_shotgunner', 'spas12');
    sim.combat.tracers.length = 0;
    sim.combat.fire(c, c.x + 100, c.y);
    expect(sim.combat.tracers.length).toBe(WEAPONS.spas12.pellets);
    expect(falloffMul(WEAPONS.spas12, 50)).toBe(1);
    expect(falloffMul(WEAPONS.spas12, WEAPONS.spas12.range)).toBeCloseTo(WEAPONS.spas12.falloff, 5);
    // По патрону: 5 в магазине → перезарядка добивает до 6 за одну «порцию».
    const reserve = sim.combat.reserveAmmo(c);
    expect(c.mag).toBe(5);
    expect(sim.combat.reload(c)).toBe(true);
    sim.combat.update(WEAPONS.spas12.reload + 0.01);
    expect(c.mag).toBe(6);
    expect(sim.combat.reserveAmmo(c)).toBe(reserve - 1);
    // Пустой магазин заряжается по одному; выстрел прерывает перезарядку.
    c.mag = 0;
    sim.combat.reload(c);
    for (let k = 0; k < 3; k++) sim.combat.update(WEAPONS.spas12.reload + 0.01);
    expect(c.mag).toBe(3);
    expect(sim.combat.reloading(c)).toBe(true);
    c.nextShot = 0;
    sim.combat.fire(c, c.x + 100, c.y);
    expect(c.mag).toBe(2);
    expect(sim.combat.reloading(c)).toBe(false);
  });

  test('смена оружия не теряет патроны в магазине', () => {
    const sim = makeSim(12345);
    const c = shooterOnPlaza(sim, 'cp', 'usp');
    for (let k = 0; k < 3; k++) {
      c.nextShot = 0;
      sim.combat.fire(c, c.x + 100, c.y);
    }
    expect(c.mag).toBe(15);
    const reserve = sim.combat.reserveAmmo(c);
    sim.combat.equip(c, 'stunstick');
    sim.combat.equip(c, 'usp');
    expect(c.mag).toBe(15);
    expect(sim.combat.reserveAmmo(c)).toBe(reserve);
    // Только что достал — выстрелить нельзя, пока не пройдёт draw.
    expect(sim.combat.canFire(c)).toBe(false);
    sim.combat.update(WEAPONS.usp.draw + 0.01);
    expect(sim.combat.canFire(c)).toBe(true);
  });

  test('дубинка бьёт вплотную и оглушает (замедляет)', () => {
    const sim = makeSim(12345);
    const c = shooterOnPlaza(sim, 'cp', 'stunstick');
    const v = createCharacter(sim.entities, sim.ctx.rng, 'citizen', c.x + 30, c.y);
    sim.entities.rebuildHash();
    expect(sim.combat.fire(c, v.x, v.y)).toBe(v);
    expect(v.health).toBeLessThan(v.maxHealth);
    sim.combat.update(0.1);
    expect(v.speedMul).toBe(COMBAT.stunSpeedMul);
    sim.combat.update(WEAPONS.stunstick.stun);
    expect(v.speedMul).toBe(1);
    // Далеко — мимо.
    v.x += 100;
    sim.entities.rebuildHash();
    sim.combat.update(1);
    expect(sim.combat.fire(c, v.x, v.y)).toBeNull();
  });
});

describe('ИИ и оружие', () => {
  test('ГО с дубинкой при виде вооружённого врага достаёт огнестрел; пустой ствол — на запасной', () => {
    const sim = makeSim(12345);
    const cp = shooterOnPlaza(sim, 'cp', 'stunstick');
    expect(sim.combat.bestWeapon(cp, 200)).toBe('usp');
    // Дробовик вблизи сильнее пистолета, вдали — нет.
    const r = shooterOnPlaza(sim, 'rebel_shotgunner', 'spas12');
    expect(sim.combat.bestWeapon(r, 40)).toBe('spas12');
    expect(sim.combat.bestWeapon(r, 350)).toBe('rebel_smg');
    r.mag = 0;
    r.inventory.remove('ammo_buckshot', r.inventory.count('ammo_buckshot'));
    expect(sim.combat.bestWeapon(r, 40)).toBe('rebel_smg');
  });
});

describe('граница', () => {
  test('перестрелка у обоих КПП почти не затихает', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 10);
    const active = sim.war.fronts.map(() => 0);
    const secs = 200;
    const warm = 20;
    for (let t = 0; t < secs * 60; t++) {
      sim.step();
      if (t % 60 === 0 && t >= warm * 60) sim.war.fronts.forEach((f, i) => sim.war.active(f) && active[i]++);
    }
    const share = active.map((a) => a / (secs - warm));
    console.log(`бой идёт: ${share.map((x) => `${Math.round(x * 100)}%`).join(' / ')} времени`);
    for (const x of share) expect(x).toBeGreaterThan(0.75);
  });
});

describe('глаз на спине нет', () => {
  test('ГО не видит стрелка за спиной, пока тот не выстрелит; после попадания поворачивается и отвечает', { timeout: 60_000 }, () => {
    const sim = makeSim(12345);
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', p.x, p.y);
    equipKit(cp, 'cp_grid', sim.ctx);
    cp.brain = new CpBrain(cp, sim.ctx, { post: { x: p.x, y: p.y }, facing: 0 });
    cp.facing = 0;
    // Повстанец с автоматом — строго за спиной (на западе), в прямой видимости.
    const a = sim.nav.nearestWalkable(p.x - 110, p.y, 3);
    const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', sim.nav.worldX(a), sim.nav.worldY(a));
    equipKit(r, 'rebel_raider', sim.ctx);
    sim.entities.rebuildHash();
    for (let t = 0; t < 90; t++) {
      sim.combat.update(1 / 60);
      (cp.brain as CpBrain).update(cp, sim.ctx, 1 / 60);
    }
    expect((cp.brain as CpBrain).gunner.target).toBeNull();
    // Выстрел в спину: ГО не знает сразу, где стрелок, — через реакцию поворачивается и находит цель.
    sim.combat.damage(cp, 10, r);
    let found = -1;
    for (let t = 0; t < 180 && found < 0; t++) {
      sim.combat.update(1 / 60);
      (cp.brain as CpBrain).update(cp, sim.ctx, 1 / 60);
      if ((cp.brain as CpBrain).gunner.target === r) found = t / 60;
    }
    console.log(`ГО нашёл стрелка через ${found.toFixed(2)} с`);
    expect(found).toBeGreaterThan(0.3);
    expect(found).toBeLessThan(3);
  });
});
