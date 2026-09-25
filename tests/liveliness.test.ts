import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { spawnPopulation } from '../src/systems/Population';
import type { Character } from '../src/entities/Character';
import { createCharacter } from '../src/entities/factory';
import { poiWorld } from '../src/systems/Population';
import { GRENADE } from '../src/config/combat';
import { lineOfSight } from '../src/world/visibility';
import { dodgeGrenades } from '../src/ai/Dodge';

describe('живой мир', () => {
  test('пробки в переулках рассасываются: никто не стоит, упёршись, дольше 20 с', { timeout: 120_000 }, () => {
    // Сид 12345: у магазина раньше собиралась «вечная» пробка (гражданин стоял 358 с).
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    const stuck = new Map<Character, number>();
    let worst = 0;
    for (let t = 0; t < 450 * 60; t++) {
      sim.step();
      if (t % 30) continue;
      for (const c of sim.entities.list) {
        if (!c.alive) continue;
        const s = Math.hypot(c.wantX, c.wantY) > 20 && c.moveSpeed < 5 ? (stuck.get(c) ?? 0) + 0.5 : 0;
        stuck.set(c, s);
        worst = Math.max(worst, s);
      }
    }
    console.log(`дольше всех упирался: ${worst} с`);
    expect(worst).toBeLessThan(20);
  });

  test('граната: летит, взрывается по запалу, ранит в радиусе, стена закрывает', () => {
    const sim = makeSim(12345);
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    const a = sim.nav.nearestWalkable(p.x, p.y, 4);
    const x = sim.nav.worldX(a);
    const y = sim.nav.worldY(a);
    const thrower = createCharacter(sim.entities, sim.ctx.rng, 'rebel', x, y);
    const victim = createCharacter(sim.entities, sim.ctx.rng, 'cp', x + 150, y);
    thrower.inventory.add('grenade', 1);
    // Взрыв там, куда упала граната: смотрим, видна ли точка жертве.
    const g = sim.combat.throwGrenade(thrower, victim.x, victim.y)!;
    expect(g).not.toBeNull();
    expect(thrower.inventory.has('grenade')).toBe(false);
    expect(sim.combat.throwGrenade(thrower, victim.x, victim.y)).toBeNull();
    const hp = victim.health;
    for (let t = 0; t < (GRENADE.fuse - 0.1) * 60; t++) sim.combat.update(1 / 60);
    expect(sim.combat.grenades.length).toBe(1);
    expect(victim.health).toBe(hp);
    for (let t = 0; t < 12; t++) sim.combat.update(1 / 60);
    expect(sim.combat.grenades.length).toBe(0);
    expect(sim.combat.blasts.length).toBe(1);
    expect(sim.combat.decals.some((d) => d.kind === 'scorch')).toBe(true);
    const near = Math.hypot(victim.x - g.x, victim.y - g.y) < GRENADE.radius && lineOfSight(sim.map, g.x, g.y, victim.x, victim.y);
    if (near) expect(victim.health).toBeLessThan(hp);
    // Стена закрывает: жертва по ту сторону стены цела.
    const wallVictim = createCharacter(sim.entities, sim.ctx.rng, 'cp', 0, 0);
    let placed = false;
    for (let dy = -80; dy <= 80 && !placed; dy += 8) {
      for (let dx = -80; dx <= 80 && !placed; dx += 8) {
        const b = sim.nav.nearestWalkable(g.x + dx, g.y + dy, 1);
        if (b < 0) continue;
        const bx = sim.nav.worldX(b);
        const by = sim.nav.worldY(b);
        if (Math.hypot(bx - g.x, by - g.y) < GRENADE.radius - 20 && !lineOfSight(sim.map, g.x, g.y, bx, by)) {
          wallVictim.x = bx;
          wallVictim.y = by;
          placed = true;
        }
      }
    }
    if (placed) {
      thrower.inventory.add('grenade', 1);
      thrower.nextGrenade = 0;
      const g2 = sim.combat.throwGrenade(thrower, g.x, g.y)!;
      g2.x = g2.x1 = g.x;
      g2.y = g2.y1 = g.y;
      g2.flight = 1;
      const hp2 = wallVictim.health;
      for (let t = 0; t < (GRENADE.fuse + 0.2) * 60; t++) sim.combat.update(1 / 60);
      expect(wallVictim.health).toBe(hp2);
    }
  });

  test('NPC замечает гранату рядом и убегает от неё', () => {
    const sim = makeSim(12345);
    const p = poiWorld(sim.ctx, 'plaza_center')!;
    const a = sim.nav.nearestWalkable(p.x, p.y, 4);
    const x = sim.nav.worldX(a);
    const y = sim.nav.worldY(a);
    const enemy = createCharacter(sim.entities, sim.ctx.rng, 'rebel', x + 120, y);
    const npc = createCharacter(sim.entities, sim.ctx.rng, 'cp', x, y);
    npc.facing = 0; // смотрит на врага
    enemy.inventory.add('grenade', 1);
    const g = sim.combat.throwGrenade(enemy, x + 10, y)!;
    g.flight = 1;
    g.x = g.x1 = x + 10;
    g.y = g.y1 = y;
    const d0 = Math.hypot(npc.x - g.x, npc.y - g.y);
    expect(dodgeGrenades(npc, sim.ctx)).toBe(true);
    for (let t = 0; t < 60; t++) {
      dodgeGrenades(npc, sim.ctx);
      sim.combat.update(1 / 60);
    }
    const moved = Math.hypot(npc.wantX, npc.wantY);
    expect(moved).toBeGreaterThan(100);
    expect(d0).toBeLessThan(GRENADE.radius);
  });

  test('на КПП летят гранаты: у повстанцев и ГО они есть и идут в дело', { timeout: 120_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 20);
    for (let t = 0; t < 180 * 60; t++) sim.step();
    console.log(`гранат брошено за 3 мин: ${sim.combat.grenadesThrown}`);
    expect(sim.combat.grenadesThrown).toBeGreaterThan(3);
    expect(sim.combat.grenadesThrown).toBeLessThan(120);
  });
});
