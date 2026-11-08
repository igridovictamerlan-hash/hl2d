import { afterEach, describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { equipKit } from '../src/systems/Population';
import { spawnRole } from '../src/systems/Roster';
import { CP_UNIT, cpUnit } from '../src/config/factions';
import { RESPONSE } from '../src/config/response';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { HoldoutBrain } from '../src/ai/brains/HoldoutBrain';
import { HiredGunBrain } from '../src/ai/brains/HiredGunBrain';
import { lineOfSight } from '../src/world/visibility';
import type { Character } from '../src/entities/Character';
import type { Exit } from '../src/systems/Response';

type Sim = ReturnType<typeof makeSim>;

function run(sim: Sim, seconds: number, until?: () => boolean, each?: () => void): boolean {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (each && i % 6 === 0) each();
    if (until && i % 10 === 0 && until()) return true;
  }
  return false;
}

/** Город с операциями ВС; война и подполье стоят. */
function city(): Sim {
  const sim = makeSim(12345);
  sim.ctx.response!.enabled = true;
  sim.law.escortHold = true;
  sim.war.reinforcements = false;
  sim.insurgency.paused = true;
  sim.war.command.paused = true;
  return sim;
}

const cp = (sim: Sim, unit: keyof typeof CP_UNIT, at: { x: number; y: number }, extra: Record<string, unknown> = {}) => {
  const rank = CP_UNIT[unit];
  return spawnRole(sim.ctx, { kind: 'squad', faction: 'cp', profession: null, division: cpUnit(rank).group, rank, kit: cpUnit(rank).kit, squad: 50, lead: false, ...extra }, at)!;
};

/** Группа реагирования 0 (5 бойцов) на дежурстве в Управе. */
function swat(sim: Sim): Character[] {
  const R = sim.ctx.response!;
  const out: Character[] = [];
  for (let k = 0; k < RESPONSE.swat.size; k++) {
    const r = R.restSpot(0, k)!;
    out.push(spawnRole(sim.ctx, { kind: 'swat', faction: 'cp', profession: null, division: 'su', rank: CP_UNIT.su3, kit: k === 1 ? 'cp_swat_breach' : 'cp_swat', squad: 0, lead: k === 0 }, { x: r.x, y: r.y })!);
  }
  return out;
}

/** Жилой дом у улицы: выход здания и точка на улице перед ним (на виду у выхода). */
function house(sim: Sim, from: { x: number; y: number }, pick = 0): { exit: Exit; street: { x: number; y: number }; id: number } {
  const R = sim.ctx.response!;
  const cands: { exit: Exit; street: { x: number; y: number }; id: number; d: number }[] = [];
  for (const g of sim.doors.groups) {
    const b = R.buildingAt(g.x + 4, g.y + 4) >= 0 ? R.buildingAt(g.x + 4, g.y + 4) : R.buildingAt(g.x - 4, g.y - 4);
    if (b < 0 || !R.holdable(b)) continue;
    const p = R.plan(b);
    const e = p?.exits.find((q) => q.door === g);
    if (!p || !e || p.rooms.length < 2 || p.rooms.length > 6) continue;
    const a = sim.nav.nearestWalkable(e.out.x + e.nx * 150, e.out.y + e.ny * 150, 3);
    if (a < 0) continue;
    const street = { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
    if (R.buildingAt(street.x, street.y) >= 0 || !lineOfSight(sim.map, street.x, street.y, e.out.x, e.out.y)) continue;
    cands.push({ exit: e, street, id: b, d: Math.hypot(e.door.x - from.x, e.door.y - from.y) });
  }
  // Не у самой Управы (дежурные группы у входов застрелят его раньше, чем он засядет): дом в 700–2500 px.
  cands.sort((a, b) => Math.abs(a.d - 1200) - Math.abs(b.d - 1200));
  expect(cands.length).toBeGreaterThan(pick);
  return cands[pick];
}

/** Вооружённый враг Протектората (житель со стволом, напал на ВС). */
function gunman(sim: Sim, at: { x: number; y: number }): Character {
  const c = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, at)!;
  equipKit(c, 'rebel_raider', sim.ctx);
  sim.combat.equip(c, 'rebel_smg');
  c.hostile = true;
  return c;
}

const saved = { base: { ...RESPONSE.talk.base } };
afterEach(() => Object.assign(RESPONSE.talk.base, saved.base));

describe('операции ВС', () => {
  test('группа реагирования дежурит в Управе: строй у главного входа, один в казарме; живой пост, не статуи', { timeout: 60_000 }, () => {
    const sim = city();
    const R = sim.ctx.response!;
    const team = swat(sim);
    run(sim, 15);
    const A = RESPONSE.swat.atMain;
    expect(R.mainSpots.length).toBeGreaterThanOrEqual(2 * A);
    for (const c of team) {
      const r = R.restSpotOf(c)!;
      expect(r).not.toBeNull();
      // На месте (с поправкой на шаг в сторону и проход вдоль строя).
      expect(Math.hypot(c.x - r.x, c.y - r.y)).toBeLessThan(RESPONSE.duty.pace + 30);
      expect((c.brain as CpBrain).fsm.current).toBe('duty');
    }
    // Первые atMain — у главного входа; последний — в казарме.
    for (const c of team.slice(0, A)) expect(R.mainSpots.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < RESPONSE.duty.pace + 30)).toBe(true);
    // Живой пост: за 30 с каждый у входа повернулся или сдвинулся, кто-то заговорил.
    const face0 = team.map((c) => c.facing);
    const pos0 = team.map((c) => ({ x: c.x, y: c.y }));
    const moved = new Set<number>();
    let talked = false;
    run(sim, 30, undefined, () => {
      team.forEach((c, i) => {
        if (Math.abs(c.facing - face0[i]) > 0.2 || Math.hypot(c.x - pos0[i].x, c.y - pos0[i].y) > 6) moved.add(i);
        if (c.speech && c.speech.until > sim.law.now) talked = true;
      });
    });
    for (let i = 0; i < A; i++) expect(moved.has(i)).toBe(true);
    expect(talked).toBe(true);
  });

  test('вооружённый засел в доме: патруль держит выходы снаружи, группа реагирования со следователем штурмует', { timeout: 600_000 }, () => {
    // Никто не сдаётся — нужен штурм.
    Object.assign(RESPONSE.talk.base, { gang: 0, hired: 0, citizen: 0, other: 0 });
    // Дома по очереди, пока не дойдёт до штурма (бывает, засевший сам выходит под огонь). Патрульные не входят ни в одном.
    let stormed = false;
    for (let pick = 0; pick < 4 && !stormed; pick++) {
      const sim = city();
      const R = sim.ctx.response!;
      swat(sim);
      // Опора выбора дома — вход Управы (дом в ~1200 px от него).
      const h = house(sim, { x: R.doorSpots[0].x, y: R.doorSpots[0].y }, pick);
      // Вооружённый — уже в доме (донос: «со стволом зашёл в дом»).
      const g = gunman(sim, h.exit.inside);
      R.spotted(g);
      const p1 = cp(sim, 'pcu2', h.street, { lead: true });
      const p2 = cp(sim, 'pcu3', { x: h.street.x + 20, y: h.street.y });
      const p3 = cp(sim, 'pcu3', { x: h.street.x - 20, y: h.street.y });
      const inv = cp(sim, 'su1', { x: h.street.x + 40, y: h.street.y + 10 });
      const patrol = [p1, p2, p3];
      // Посты не стреляют: проверяем ход штурма группы (засевшего, показавшегося в проёме, пост снял бы — и штурма нет).
      for (const c of patrol) (c.brain as CpBrain).gunner.holdFire = true;
      let entered = false;
      const watch = () => {
        for (const c of patrol) if (c.alive && R.buildingAt(c.x, c.y) === h.id && (c.brain as CpBrain).fsm.current !== 'escort') entered = true;
      };
      // Засел.
      expect(run(sim, 30, () => g.brain instanceof HoldoutBrain)).toBe(true);
      expect((g.brain as HoldoutBrain).plan.id).toBe(h.id);
      // Оцепление: посты у выходов.
      expect(run(sim, 40, () => !g.alive || patrol.filter((c) => (c.brain as CpBrain).opPost >= 0).length >= 1, watch)).toBe(true);
      // Группа вызвана, следователь при ней.
      if (run(sim, 60, () => !g.alive || R.teams[0].phase !== 'rest', watch) && g.alive) expect(R.teams[0].investigator).toBe(inv);
      // Штурм: светошумовая, комнаты; итог — убит или задержан.
      const done = run(sim, 240, () => !g.alive || g.law.phase === 'cuffed' || g.law.phase === 'jailed', watch);
      console.log(`штурм, дом ${pick}: ${JSON.stringify(R.stats)}; итог: ${g.alive ? g.law.phase : 'убит'}`);
      expect(done).toBe(true);
      expect(entered).toBe(false);
      stormed = R.stats.assaults >= 1 && R.stats.flashes >= 1 && R.stats.entries >= 1;
    }
    expect(stormed).toBe(true);
  });


  test('на уговоры засевший сдаётся: выходит с поднятыми руками, его задерживают', { timeout: 200_000 }, () => {
    const sim = city();
    const R = sim.ctx.response!;
    Object.assign(RESPONSE.talk.base, { gang: 0.6, hired: 0.6, citizen: 0.6, other: 0.6 });
    const h = house(sim, { x: 4000, y: 1500 });
    const g = gunman(sim, h.exit.inside);
    R.spotted(g);
    cp(sim, 'pcu2', h.street, { lead: true });
    cp(sim, 'pcu3', { x: h.street.x + 20, y: h.street.y });
    cp(sim, 'pcu3', { x: h.street.x - 20, y: h.street.y });
    expect(run(sim, 30, () => g.brain instanceof HoldoutBrain)).toBe(true);
    expect(run(sim, 120, () => R.stats.surrendered > 0)).toBe(true);
    expect(g.hostile).toBe(false);
    expect(run(sim, 90, () => g.law.phase === 'cuffed' || g.law.phase === 'jailed')).toBe(true);
  });

  /**
   * Трое наёмников со стволами на улице в ~1100 px от Управы против двух патрульных; группа реагирования 0 — по вызову.
   * house — прижатые уходят в дома (штурм), street — в дом им не уйти (holdout.door = 0): перестрелка на улице.
   */
  function streetFight(seed: number, mode: 'house' | 'street'): { phases: string[]; closest: number; standing: number } {
    const H = { ...RESPONSE.holdout };
    if (mode === 'street') Object.assign(RESPONSE.holdout, { door: 0, home: 0 });
    try {
      const sim = makeSim(seed);
      sim.ctx.response!.enabled = true;
      sim.law.escortHold = true;
      sim.war.reinforcements = false;
      sim.insurgency.paused = true;
      sim.war.command.paused = true;
      const R = sim.ctx.response!;
      const team = swat(sim);
      // Улица в ~1100 px от Управы и точка на виду у неё в 260 px (там патруль).
      let at: { x: number; y: number } | null = null;
      let far: { x: number; y: number } | null = null;
      for (let k = 0; k < 64 && !far; k++) {
        const ang = (k / 64) * Math.PI * 2;
        const a = sim.nav.nearestWalkable(team[0].x + Math.cos(ang) * 1100, team[0].y + Math.sin(ang) * 1100, 3);
        if (a < 0) continue;
        const p = { x: sim.nav.worldX(a), y: sim.nav.worldY(a) };
        if (R.buildingAt(p.x, p.y) >= 0 || sim.map.levelAt(p.x, p.y) !== 'city') continue;
        for (let j = 0; j < 16 && !far; j++) {
          const b = sim.nav.nearestWalkable(p.x + Math.cos((j / 16) * Math.PI * 2) * 260, p.y + Math.sin((j / 16) * Math.PI * 2) * 260, 3);
          if (b < 0) continue;
          const q = { x: sim.nav.worldX(b), y: sim.nav.worldY(b) };
          if (R.buildingAt(q.x, q.y) < 0 && lineOfSight(sim.map, p.x, p.y, q.x, q.y)) {
            at = p;
            far = q;
          }
        }
      }
      expect(far).not.toBeNull();
      const gs = [0, 1, 2].map((i) => {
        const g = gunman(sim, { x: at!.x + i * 14, y: at!.y + (i % 2) * 14 });
        g.brain = new HiredGunBrain(g, sim.ctx, g.brain);
        return g;
      });
      cp(sim, 'pcu2', far!, { lead: true });
      cp(sim, 'pcu3', { x: far!.x + 18, y: far!.y + 6 });
      for (const g of gs) R.spotted(g);
      const phases: string[] = [];
      let closest = Infinity;
      run(sim, 180, () => phases.length > 2 && R.teams[0].phase === 'rest', () => {
        const t = R.teams[0];
        if (phases[phases.length - 1] !== t.phase) phases.push(t.phase);
        // На подходе — как близко к стоящему на ногах бандиту подошёл боец группы.
        if (t.phase === 'move') for (const c of team) if (c.alive && !c.downed) for (const g of gs) if (g.alive && !g.downed) closest = Math.min(closest, Math.hypot(c.x - g.x, c.y - g.y));
      });
      return { phases, closest, standing: team.filter((c) => c.alive && !c.downed).length };
    } finally {
      Object.assign(RESPONSE.holdout, H);
    }
  }

  test('перестрелка на улице: группа не бежит колонной на стволы — точка сбора поодаль, цепь, бой из укрытий', { timeout: 300_000 }, () => {
    // Исход перестрелки — дело случая (бандитов может снять и патруль до прихода группы): смотрим на сидах, где дошло до цепи.
    let standing = 0;
    let swept = 0;
    let runs = 0;
    for (const seed of [7919, 6, 12345, 79190]) {
      const r = streetFight(seed, 'street');
      console.log(`улица, сид ${seed}: ${r.phases.join(' > ')}; ближе всего на подходе ${Math.round(r.closest)} px; на ногах ${r.standing}`);
      runs++;
      standing += r.standing;
      if (!r.phases.includes('sweep')) continue;
      swept++;
      expect(r.phases.indexOf('move')).toBeLessThan(r.phases.indexOf('sweep'));
      expect(r.closest).toBeGreaterThan(RESPONSE.swat.street.min * 0.6);
    }
    expect(swept).toBeGreaterThanOrEqual(2);
    // До правки на такой перестрелке группа теряла троих из пяти за 3 с.
    expect(standing).toBeGreaterThanOrEqual(runs * 4);
  });


  test('подход к зданию под огнём: группа отвечает из укрытий и не отходит с потерями', { timeout: 200_000 }, () => {
    // Сид 7919: до правки — двое выбыли на подходе колонной, отход и второй штурм.
    const r = streetFight(7919, 'house');
    console.log(`дома, сид 7919: ${r.phases.join(' > ')}; на ногах ${r.standing}`);
    expect(r.phases).toContain('clear');
    expect(r.phases).not.toContain('withdraw');
    expect(r.standing).toBeGreaterThanOrEqual(4);
  });
});

describe('конвой «за локоть»', () => {
  test('задержанный идёт впереди конвоира, конвоир держит его за руку', { timeout: 60_000 }, () => {
    const sim = city();
    const u = cp(sim, 'pcu2', { x: 4000, y: 1500 }, { lead: true });
    const a = sim.nav.nearestWalkable(u.x + 30, u.y, 3);
    const c = spawnRole(sim.ctx, { kind: 'citizen', faction: 'citizen', profession: null, division: null, rank: 0, kit: 'citizen' }, { x: sim.nav.worldX(a), y: sim.nav.worldY(a) })!;
    sim.law.arrest(u, c, 'resisting');
    const b = u.brain as CpBrain;
    b.target = c;
    b.fsm.change('escort');
    let ahead = 0;
    let samples = 0;
    let held = 0;
    run(sim, 20, undefined, () => {
      if (c.law.phase !== 'cuffed') return;
      const v = Math.hypot(u.vx, u.vy);
      if (v < 20) return;
      samples++;
      if (((c.x - u.x) * u.vx + (c.y - u.y) * u.vy) / v > 4) ahead++;
      if (u.leading === c) held++;
    });
    expect(samples).toBeGreaterThan(20);
    expect(ahead / samples).toBeGreaterThan(0.7);
    expect(held / samples).toBeGreaterThan(0.7);
  });
});

describe('бандиты в бою', () => {
  /** Наёмник со стволом против двух патрульных на улице: сколько прошёл в бою, сколько выстрелил, сколько ранил ВС. */
  function duel(on: boolean, seed: number): { moved: number; shots: number; cpDamage: number } {
    const sim = makeSim(seed);
    sim.ctx.response!.enabled = on;
    sim.war.reinforcements = false;
    sim.insurgency.paused = true;
    sim.war.command.paused = true;
    // Улица: точка у площади и вторая — на виду в 260 px.
    const pl = sim.map.poisOf('plaza_center')[0];
    const a = sim.nav.nearestWalkable((pl.x + 0.5) * 16, (pl.y + 0.5) * 16, 6);
    const x0 = sim.nav.worldX(a);
    const y0 = sim.nav.worldY(a);
    let far = { x: x0 + 260, y: y0 };
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const b = sim.nav.nearestWalkable(x0 + Math.cos(ang) * 260, y0 + Math.sin(ang) * 260, 3);
      if (b >= 0 && lineOfSight(sim.map, x0, y0, sim.nav.worldX(b), sim.nav.worldY(b))) {
        far = { x: sim.nav.worldX(b), y: sim.nav.worldY(b) };
        break;
      }
    }
    const g = gunman(sim, { x: x0, y: y0 });
    const saved = g.brain;
    g.brain = new HiredGunBrain(g, sim.ctx, saved);
    const u1 = cp(sim, 'pcu2', far, { lead: true });
    const u2 = cp(sim, 'pcu3', { x: far.x + 18, y: far.y + 6 });
    const hp0 = u1.health + u2.health;
    let moved = 0;
    let px = g.x;
    let py = g.y;
    let shots = 0;
    let last = g.lastFired;
    run(sim, 14, () => !g.alive || g.downed, () => {
      if (g.lastFired !== last) {
        shots++;
        last = g.lastFired;
      }
      moved += Math.hypot(g.x - px, g.y - py);
      px = g.x;
      py = g.y;
    });
    return { moved, shots, cpDamage: hp0 - (u1.alive ? u1.health : 0) - (u2.alive ? u2.health : 0) };
  }

  test('из укрытий и на ходу: в бою двигается, а не стоит столбом', { timeout: 120_000 }, () => {
    let movedOn = 0;
    let movedOff = 0;
    for (const seed of [12345, 7919]) {
      const on = duel(true, seed);
      const off = duel(false, seed);
      console.log(`бандит, сид ${seed}: вкл ${JSON.stringify(on)}, выкл ${JSON.stringify(off)}`);
      movedOn += on.moved;
      movedOff += off.moved;
    }
    expect(movedOn).toBeGreaterThan(movedOff * 1.5);
  });
});
