import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { equipKit, poiWorld } from '../src/systems/Population';
import { ChatSystem } from '../src/systems/ChatSystem';
import { adjustLoyalty, loyaltyTier } from '../src/systems/Loyalty';
import { capturePlayer, parseSave, applyToPlayer, encodeBits, decodeBits } from '../src/systems/SaveGame';
import { CpBrain } from '../src/ai/brains/CpBrain';
import { LOYALTY } from '../src/config/loyalty';
import { ECONOMY } from '../src/config/economy';

type Sim = ReturnType<typeof makeSim>;

function plaza(sim: Sim) {
  return poiWorld(sim.ctx, 'plaza_center')!;
}

describe('лояльность', () => {
  test('уровни, пределы и эффекты: рацион с надбавкой, скидка, штраф и арест снижают', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y, true);
    c.loyalty = 0;
    expect(loyaltyTier(c).name).toBe('Гражданин');
    adjustLoyalty(c, 1000, 'тест');
    expect(c.loyalty).toBe(LOYALTY.max);
    expect(loyaltyTier(c).checkMul).toBeLessThan(1);
    // Скидка лоялисту в магазине ГСР.
    expect(sim.economy.shopPrice(c, 'medkit')!).toBeLessThan(28);
    c.loyalty = -50;
    expect(loyaltyTier(c).checkMul).toBeGreaterThan(1);
    // Штраф и арест — минус лояльность.
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', p.x + 30, p.y);
    c.loyalty = 50;
    sim.law.apply(cp, c, { kind: 'fine', reason: 'running', fine: 5 });
    expect(c.loyalty).toBe(50 + LOYALTY.points.fine);
    sim.law.arrest(cp, c, 'no_cid');
    expect(c.loyalty).toBe(50 + LOYALTY.points.fine + LOYALTY.points.arrest);
  });

  test('раздача: рацион поднимает лояльность, лоялисту — больше токенов', () => {
    const sim = makeSim(12345);
    const w = createCharacter(sim.entities, sim.ctx.rng, 'cwu', 0, 0);
    const c = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 0, 0);
    c.loyalty = 120;
    sim.economy.open = true;
    sim.economy.joinQueue(c);
    const slot = sim.economy.queueSlot(0);
    c.x = slot.x;
    c.y = slot.y;
    const money = c.money;
    expect(sim.economy.serveNext(w)).toBe(c);
    expect(c.money).toBe(money + ECONOMY.rations.tokens + loyaltyTier({ ...c, loyalty: 120 } as never).rationBonus);
    expect(c.loyalty).toBe(120 + LOYALTY.points.ration);
  });
});

describe('чат и команды', () => {
  test('речь, /me, /roll, /cid, неизвестная команда', () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const me = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y, true);
    const chat = new ChatSystem(sim.ctx);
    chat.submit(me, 'Всем доброго утра');
    expect(me.speech?.text).toBe('Всем доброго утра');
    expect(sim.log.at(-1)).toContain(`${me.name}: Всем доброго утра`);
    chat.submit(me, '/me поправляет воротник');
    expect(sim.log.at(-1)).toBe(`* ${me.name} поправляет воротник`);
    chat.submit(me, '/roll');
    expect(sim.log.at(-1)).toMatch(/бросает кости: \d+/);
    chat.submit(me, '/cid');
    expect(sim.log.at(-1)).toContain(`CID #${me.cid}`);
    chat.submit(me, '/абракадабра');
    expect(sim.log.at(-1)).toContain('Неизвестная команда');
  });

  test('оскорбление ГО, который видит, — требует документы, затем штраф; на приветствие отвечают', { timeout: 30_000 }, () => {
    const sim = makeSim(12345);
    const p = plaza(sim);
    const me = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y, true);
    const a = sim.nav.nearestWalkable(p.x + 60, p.y, 3);
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', sim.nav.worldX(a), sim.nav.worldY(a));
    equipKit(cp, 'cp', sim.ctx);
    cp.facing = Math.atan2(me.y - cp.y, me.x - cp.x);
    cp.brain = new CpBrain(cp, sim.ctx);
    sim.entities.rebuildHash();
    const chat = new ChatSystem(sim.ctx);
    chat.submit(me, 'Эй ты, свинья!');
    expect(me.law.phase).toBe('ordered');
    expect(me.law.reason).toBe('insult');
    expect(sim.law.judge(me).kind).toBe('fine');
    // Приветствие — ближайший прохожий отвечает.
    const b = sim.nav.nearestWalkable(p.x - 40, p.y, 3);
    const other = createCharacter(sim.entities, sim.ctx.rng, 'citizen', sim.nav.worldX(b), sim.nav.worldY(b));
    sim.entities.rebuildHash();
    chat.submit(me, 'Привет!');
    expect(other.speech).not.toBeNull();
  });

  test('донос: видимый повстанец — тревога и +лояльность; ложный — минус; ГО поощряет', () => {
    const sim = makeSim(12345);
    sim.war.command.paused = true;
    const p = plaza(sim);
    const me = createCharacter(sim.entities, sim.ctx.rng, 'citizen', p.x, p.y, true);
    me.loyalty = 0;
    const chat = new ChatSystem(sim.ctx);
    chat.submit(me, '/донос');
    expect(me.loyalty).toBe(LOYALTY.points.falseReport);
    const r = createCharacter(sim.entities, sim.ctx.rng, 'rebel', p.x + 50, p.y);
    equipKit(r, 'rebel_raider', sim.ctx);
    sim.entities.rebuildHash();
    for (let t = 0; t < LOYALTY.reportCooldown * 60 + 5; t++) sim.law.update(1 / 60, null);
    chat.submit(me, '/донос');
    expect(me.loyalty).toBe(LOYALTY.points.falseReport + LOYALTY.points.report);
    expect(sim.war.code).toBe('yellow');
    // Поощрение ГО.
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', p.x + 20, p.y, false);
    sim.entities.rebuildHash();
    const before = me.loyalty;
    chat.submit(cp, '/поощрить');
    expect(me.loyalty).toBe(before + LOYALTY.points.reward);
  });
});

describe('сохранение', () => {
  test('игрок → JSON → игрок: деньги, лояльность, вещи, оружие, статус', () => {
    const sim = makeSim(12345);
    const a = createCharacter(sim.entities, sim.ctx.rng, 'rebel', 100, 100, true);
    equipKit(a, 'rebel', sim.ctx);
    a.money = 77;
    a.loyalty = 0;
    a.hunger = 55;
    a.health = 64;
    a.mag = 17;
    const explored = new Uint8Array(1000);
    explored[3] = explored[999] = 1;
    const data = capturePlayer(a, 12345, { faction: 'rebel', rank: 2, division: null }, 'Иван', { explored, hatches: [1, 4] });
    const back = parseSave(JSON.stringify(data))!;
    expect(back).not.toBeNull();
    const b = createCharacter(sim.entities, sim.ctx.rng, 'rebel', 0, 0, true);
    applyToPlayer(b, back);
    expect(b.money).toBe(77);
    expect(b.hunger).toBe(55);
    expect(b.health).toBe(64);
    expect(b.weapon).toBe(a.weapon);
    expect(b.mag).toBe(17);
    expect(b.inventory.count('ammo_smg')).toBe(a.inventory.count('ammo_smg'));
    expect(b.name).toBe(a.name);
    const bits = decodeBits(back.explored, 1000);
    expect(bits[3]).toBe(1);
    expect(bits[999]).toBe(1);
    expect(bits.reduce((s, v) => s + v, 0)).toBe(2);
    expect(back.hatches).toEqual([1, 4]);
  });

  test('повреждённое или чужое сохранение не принимается; задержанный — в розыске', () => {
    expect(parseSave('{нет')).toBeNull();
    expect(parseSave(JSON.stringify({ format: 'x' }))).toBeNull();
    const sim = makeSim(12345);
    const a = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 100, 100, true);
    const d = capturePlayer(a, 1, { faction: 'citizen', rank: 0, division: null }, '', { explored: new Uint8Array(8), hatches: [] });
    expect(parseSave(JSON.stringify({ ...d, role: { faction: 'ota', rank: 0, division: null } }))).toBeNull();
    a.law.phase = 'cuffed';
    const caught = capturePlayer(a, 1, { faction: 'citizen', rank: 0, division: null }, '', { explored: new Uint8Array(8), hatches: [] });
    expect(caught.law.wanted).toBe(true);
    expect(caught.pos).toBeNull();
    expect(decodeBits(encodeBits(new Uint8Array([1, 0, 1, 1, 0, 0, 0, 0, 1])), 9)).toEqual(new Uint8Array([1, 0, 1, 1, 0, 0, 0, 0, 1]));
  });
});
