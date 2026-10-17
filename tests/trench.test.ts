import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit, poiWorld } from '../src/systems/Population';
import { TRENCH, CROUCH } from '../src/config/tactics';
import { WEAPONS } from '../src/config/items';
import { GRENADE } from '../src/config/combat';
import { T } from '../src/world/tiles';
import { inTrench, parapetDist, trenchCover } from '../src/world/trench';
import { findCover } from '../src/ai/Tactics';
import type { Character } from '../src/entities/Character';

type Sim = ReturnType<typeof makeSim>;

const TS = 16;
/** Пустое поле 60×25 тайлов и траншея шириной 2 тайла вдоль оси Y (21 тайл); центр траншеи — (tcx, yc). */
interface Arena {
  tcx: number;
  yc: number;
}

function arena(sim: Sim): Arena {
  const p = poiWorld(sim.ctx, 'plaza_center')!;
  const tx0 = Math.floor(p.x / TS) - 30;
  const ty0 = Math.floor(p.y / TS) - 12;
  const m = sim.map;
  // Полигон на месте площади: всё — плиты (и двери фасадов, что попали в прямоугольник, — не закрытые).
  for (let y = ty0; y < ty0 + 25; y++) {
    for (let x = tx0; x < tx0 + 60; x++) {
      m.tiles[y * m.width + x] = T.PLAZA;
      m.doorClosed[y * m.width + x] = 0;
      m.doorLocked[y * m.width + x] = 0;
    }
  }
  const tc = tx0 + 24;
  for (let y = ty0 + 2; y <= ty0 + 22; y++) {
    m.tiles[y * m.width + tc] = T.TRENCH;
    m.tiles[y * m.width + tc + 1] = T.TRENCH;
  }
  sim.nav.refresh(tx0, ty0, tx0 + 60, ty0 + 25);
  return { tcx: (tc + 1) * TS, yc: (ty0 + 12) * TS };
}

function dummy(sim: Sim, faction: 'rebel' | 'cp', x: number, y: number, kit: string | null = null): Character {
  const c = createCharacter(sim.entities, sim.ctx.rng, faction, x, y);
  c.brain = null;
  if (kit) equipKit(c, kit, sim.ctx);
  return c;
}

/** Выдать ствол и взять в руки (набор может его не содержать). */
function arm(sim: Sim, c: Character, gun: 'mp7' | 'm4a4'): void {
  c.inventory.add(gun, 1);
  sim.combat.equip(c, gun);
  expect(c.weapon).toBe(gun);
}

/** n выстрелов shooter → target: сколько пуль попало в цель и сколько остановил бруствер. */
function volley(sim: Sim, shooter: Character, target: Character, n: number): { hits: number; stopped: number } {
  const st = sim.combat.stats;
  const h0 = st.hit;
  const b0 = st.barrier;
  for (let k = 0; k < n; k++) {
    shooter.aim = 1;
    shooter.recoil = 0;
    shooter.kick = 0;
    shooter.nextShot = 0;
    shooter.mag = 99;
    shooter.reloadUntil = 0;
    sim.combat.fire(shooter, target.x, target.y);
  }
  sim.combat.bullets.length = 0;
  return { hits: st.hit - h0, stopped: st.barrier - b0 };
}

/** Доля остановленных бруствером среди пуль, которые попали бы в цель. */
function stopShare(r: { hits: number; stopped: number }): number {
  return r.stopped / Math.max(1, r.hits + r.stopped);
}

/** Мир и поле строятся один раз на файл (генерация города — секунды); каждый тест начинает с чистых бойцов. */
let shared: { sim: Sim; a: Arena } | null = null;

function setup(gun: 'mp7' | 'm4a4' = 'mp7') {
  if (!shared) {
    const sim = makeSim(12345);
    shared = { sim, a: arena(sim) };
  }
  const { sim, a } = shared;
  sim.entities.clear();
  sim.combat.bullets.length = 0;
  const shooter = dummy(sim, 'cp', a.tcx - 300, a.yc, 'cp_su');
  arm(sim, shooter, gun);
  const target = dummy(sim, 'rebel', a.tcx, a.yc, 'rebel_soldier');
  sim.entities.rebuildHash();
  sim.combat.update(1);
  return { sim, a, shooter, target };
}

describe('траншея как укрытие', () => {
  test('помощники: тайл под центром, бруствер поперёк, вдоль траншеи — нет', () => {
    const { sim, a } = setup();
    expect(inTrench(sim.map, a.tcx, a.yc)).toBe(true);
    expect(inTrench(sim.map, a.tcx - 40, a.yc)).toBe(false);
    // Поперёк: бруствер в 16 px (край траншеи); вдоль оси — весь отрезок траншея.
    expect(parapetDist(sim.map, a.tcx, a.yc, -1, 0)).toBeGreaterThan(0);
    expect(parapetDist(sim.map, a.tcx, a.yc, -1, 0)).toBeLessThanOrEqual(TRENCH.parapetReach);
    expect(parapetDist(sim.map, a.tcx, a.yc, 0, -1)).toBe(-1);
    // Не в траншее — укрытия нет.
    expect(parapetDist(sim.map, a.tcx - 60, a.yc, 1, 0)).toBe(-1);
    expect(trenchCover(sim.map, a.tcx, a.yc, a.tcx - 300, a.yc)).toBe(true);
    expect(trenchCover(sim.map, a.tcx, a.yc, a.tcx, a.yc - 150)).toBe(false);
    expect(trenchCover(sim.map, a.tcx, a.yc, a.tcx - TRENCH.exposedWithin + 6, a.yc)).toBe(false);
  });

  test('присевший в траншее, огонь поперёк с 300 px: останавливается не меньше 80% пуль', () => {
    const { sim, shooter, target } = setup();
    target.crouch = true;
    const r = volley(sim, shooter, target, 120);
    const share = stopShare(r);
    console.log(`поперёк, присев: попало ${r.hits}, остановил бруствер ${r.stopped} (${(share * 100).toFixed(0)}%)`);
    expect(r.hits + r.stopped).toBeGreaterThan(40);
    expect(WEAPONS.mp7.penetration).toBe(0);
    expect(share).toBeGreaterThanOrEqual(0.8);
  });

  test('стоящий в траншее: примерно половина пуль; бронебойный ствол — меньше', () => {
    const { sim, shooter, target } = setup();
    target.crouch = false;
    const r = volley(sim, shooter, target, 160);
    const share = stopShare(r);
    console.log(`поперёк, стоя: попало ${r.hits}, остановил бруствер ${r.stopped} (${(share * 100).toFixed(0)}%)`);
    expect(share).toBeGreaterThan(TRENCH.standStop - 0.15);
    expect(share).toBeLessThan(TRENCH.standStop + 0.15);
    // Винтовка пробивает лучше пистолета-пулемёта: доля остановленных не выше.
    const rifle = setup('m4a4');
    rifle.target.crouch = false;
    expect(stopShare(volley(rifle.sim, rifle.shooter, rifle.target, 160))).toBeLessThan(share + 0.1);
  });

  test('огонь вдоль траншеи (анфилада): защиты нет — попаданий как на открытом месте', () => {
    const { sim, a, target } = setup();
    target.crouch = true;
    // Стрелок в той же траншее, в 150 px севернее.
    const along = dummy(sim, 'cp', a.tcx, a.yc - 150, 'cp_su');
    arm(sim, along, 'mp7');
    // Для сравнения — тот же отрезок на открытом месте в стороне от траншеи.
    const ox = a.tcx + 240;
    const t2 = dummy(sim, 'rebel', ox, a.yc, 'rebel_soldier');
    t2.crouch = true;
    const s2 = dummy(sim, 'cp', ox, a.yc - 150, 'cp_su');
    arm(sim, s2, 'mp7');
    sim.entities.rebuildHash();
    const r = volley(sim, along, target, 80);
    const open = volley(sim, s2, t2, 80);
    console.log(`вдоль траншеи: попало ${r.hits}, остановлено ${r.stopped}; на открытом: ${open.hits}`);
    expect(r.stopped).toBe(0);
    expect(r.hits).toBeGreaterThan(open.hits * 0.8);
  });

  test('стрелок вплотную (ближе exposedWithin) бьёт сверху — траншея не защищает', () => {
    const { sim, a, target } = setup();
    target.crouch = true;
    const close = dummy(sim, 'cp', a.tcx - (TRENCH.exposedWithin - 18), a.yc, 'cp_su');
    arm(sim, close, 'mp7');
    sim.entities.rebuildHash();
    const r = volley(sim, close, target, 60);
    expect(r.stopped).toBe(0);
    expect(r.hits).toBeGreaterThan(30);
  });

  test('ноги ниже бруствера: из траншеи в ноги попадают реже', () => {
    const { sim, shooter, target } = setup();
    const legs = () => {
      let n = 0;
      let all = 0;
      for (let k = 0; k < 200; k++) {
        shooter.aim = 1;
        shooter.recoil = 0;
        shooter.kick = 0;
        shooter.nextShot = 0;
        shooter.mag = 99;
        sim.combat.bullets.length = 0;
        if (sim.combat.fire(shooter, target.x, target.y) === target) {
          all++;
          if (sim.combat.bullets[sim.combat.bullets.length - 1]?.zone === 'leg') n++;
        }
      }
      sim.combat.bullets.length = 0;
      return all ? n / all : 0;
    };
    // Та же цель вне траншеи (сместили на открытое место, стрелок следом).
    const inside = legs();
    target.x += 200;
    shooter.x += 200;
    sim.entities.rebuildHash();
    const outside = legs();
    console.log(`доля попаданий в ноги: в траншее ${inside.toFixed(2)}, снаружи ${outside.toFixed(2)}`);
    expect(inside).toBeLessThan(outside);
  });

  test('concealed: присевший в траншее скрыт поперёк, виден вдоль, вплотную и после выстрела', () => {
    const { sim, a, shooter, target } = setup();
    target.crouch = true;
    target.lastFired = -1e9;
    expect(sim.combat.concealed(target, shooter.x, shooter.y)).toBe(true);
    // Вдоль траншеи — виден.
    expect(sim.combat.concealed(target, a.tcx, a.yc - 200)).toBe(false);
    // Вплотную (ближе hideMinDist) — виден.
    expect(sim.combat.concealed(target, a.tcx - CROUCH.hideMinDist * 0.5, a.yc)).toBe(false);
    // Стоящий не скрыт.
    target.crouch = false;
    expect(sim.combat.concealed(target, shooter.x, shooter.y)).toBe(false);
    // Выстрелил — виден.
    target.crouch = true;
    target.lastFired = sim.combat.now;
    expect(sim.combat.concealed(target, shooter.x, shooter.y)).toBe(false);
    // Присевший вне траншеи и без блока — виден.
    target.lastFired = -1e9;
    target.x = a.tcx + 200;
    expect(sim.combat.concealed(target, a.tcx + 500, a.yc)).toBe(false);
  });

  test('взрыв снаружи слабее в траншее; в самой траншее и вплотную — полный', () => {
    const { sim, a, shooter } = setup();
    const R = GRENADE.radius;
    const open = a.tcx + 240;
    const mk = (x: number, y: number) => {
      const c = dummy(sim, 'rebel', x, y, 'rebel_soldier');
      c.maxHealth = c.health = 5000;
      return c;
    };
    const lost = (c: Character) => c.maxHealth - c.health;
    const gap = R * 0.55;
    // Гасит бруствер: центр взрыва вне траншеи, цель в траншее.
    const inT = mk(a.tcx, a.yc);
    const outT = mk(open, a.yc);
    sim.entities.rebuildHash();
    sim.combat.explode(a.tcx - gap, a.yc, shooter, 'frag', 1);
    sim.combat.explode(open - gap, a.yc, shooter, 'frag', 1);
    const dIn = lost(inT);
    const dOut = lost(outT);
    console.log(`взрыв снаружи: в траншее −${dIn.toFixed(0)}, на открытом −${dOut.toFixed(0)}`);
    expect(dOut).toBeGreaterThan(0);
    expect(dIn).toBeCloseTo(dOut * TRENCH.blastMul, 0);
    // Центр взрыва в самой траншее — урон полный.
    const inT2 = mk(a.tcx, a.yc - 100);
    const outT2 = mk(open, a.yc - 100);
    sim.entities.rebuildHash();
    sim.combat.explode(a.tcx, a.yc - 100 + gap, shooter, 'frag', 1);
    sim.combat.explode(open, a.yc - 100 + gap, shooter, 'frag', 1);
    expect(lost(inT2)).toBeCloseTo(lost(outT2), 0);
  });

  test('findCover: бойцу на открытом месте траншея поперёк угрозы — укрытие «блок»; вдоль — нет', () => {
    const { sim, a } = setup();
    const self = dummy(sim, 'rebel', a.tcx - 70, a.yc, 'rebel_soldier');
    const threat = { x: a.tcx - 330, y: a.yc };
    let spot = null;
    for (let k = 0; k < 6 && !spot; k++) spot = findCover(self, sim.ctx, threat, null, 170, 400);
    expect(spot).not.toBeNull();
    expect(spot!.kind).toBe('block');
    expect(inTrench(sim.map, sim.nav.worldX(spot!.hide), sim.nav.worldY(spot!.hide))).toBe(true);
    // Угроза вдоль траншеи (на севере, в самой траншее): бруствера нет — траншея укрытием не считается.
    const inside = dummy(sim, 'rebel', a.tcx, a.yc + 40, 'rebel_soldier');
    const along = { x: a.tcx, y: a.yc - 200 };
    for (let k = 0; k < 6; k++) expect(findCover(inside, sim.ctx, along, null, 170, 400)).toBeNull();
  });
});
