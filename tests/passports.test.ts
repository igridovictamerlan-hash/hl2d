import { describe, expect, it } from 'vitest';
import { makeSim } from './simHarness';
import { createCharacter } from '../src/entities/factory';
import { spawnPopulation } from '../src/systems/Population';
import { PASSPORT } from '../src/config/law';
import { PARTISANS } from '../src/config/underground';
import { CP_UNIT } from '../src/config/factions';
import { foreignPassport, stampJob } from '../src/systems/Passports';
import { CLOTH_ITEMS } from '../src/config/clothes';

describe('паспорта вместо CID', () => {
  it('у горожан и рабочих ТС — свой паспорт с работой; у властей нет; у NPC-подпольщика — чужой, у игрока — никакого', () => {
    const sim = makeSim(5151);
    sim.war.command.paused = true;
    spawnPopulation(sim.ctx, 40);
    const live = sim.entities.list.filter((c) => c.alive);
    const cits = live.filter((c) => c.faction === 'citizen' && c.profession === 'citizen');
    expect(cits.length).toBeGreaterThan(10);
    for (const c of cits) {
      expect(c.passport?.owner).toBe(c.pid);
      expect(c.passport?.name).toBe(c.name);
      expect(c.passport?.no).toBe(c.cid);
      expect(c.passport?.job).toBe(PASSPORT.jobs.none);
    }
    const cwu = live.filter((c) => c.faction === 'cwu');
    expect(cwu.length).toBeGreaterThan(0);
    for (const c of cwu) expect(c.passport?.job).toContain(PASSPORT.jobs.cwu);
    for (const c of live.filter((o) => o.faction === 'cp' || o.faction === 'ota')) expect(c.passport).toBeNull();
    const under = live.filter((c) => c.faction === 'rebel' && (c.profession === 'partisan' || c.profession === 'spec_agent'));
    expect(under.length).toBeGreaterThan(0);
    for (const c of under) {
      expect(c.passport?.owner).toBe(-1);
      expect(foreignPassport(c)).toBe(true);
    }
    const me = createCharacter(sim.entities, sim.ctx.rng, 'rebel', 100, 100, true, 0);
    me.profession = 'partisan';
    sim.ctx.insurgency.giveCover(me);
    expect(me.passport).toBeNull();
    // Устроился в ТС — отметка о работе.
    const c = cits[0];
    c.faction = 'cwu';
    c.profession = 'janitor';
    stampJob(c);
    expect(c.passport?.job).toBe(`${PASSPORT.jobs.cwu} · Уборщик ТС`);
  });

  it('проверка документов: нет паспорта — арест; чужое фото — подлог, паспорт изъят; подпольщик без паспорта раскрыт', () => {
    const sim = makeSim(5152);
    const cp = createCharacter(sim.entities, sim.ctx.rng, 'cp', 100, 100, false, CP_UNIT.pcu3);
    const a = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 120, 100, false, 0);
    const b = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 140, 100, false, 0);
    for (const c of [a, b]) {
      c.law.hasCid = true;
      c.law.wanted = false;
    }
    void cp;
    expect(sim.law.judge(a).kind).toBe('ok');
    a.passport = null;
    expect(sim.law.judge(a)).toMatchObject({ kind: 'arrest', reason: 'no_cid' });
    // Паспорт соседа: фото не его (шанс опознать — 1 на время теста).
    a.passport = b.passport;
    const was = PASSPORT.photo;
    (PASSPORT as { photo: number }).photo = 1;
    try {
      expect(sim.law.judge(a)).toMatchObject({ kind: 'arrest', reason: 'forgery' });
      expect(a.passport).toBeNull();
    } finally {
      (PASSPORT as { photo: number }).photo = was;
    }
    // Партизан под личиной без паспорта — раскрыт; с чужим — проходит (опознать по фото не вышло).
    const p = createCharacter(sim.entities, sim.ctx.rng, 'rebel', 160, 100, true, 0);
    p.profession = 'partisan';
    sim.ctx.insurgency.giveCover(p);
    expect(sim.law.judge(p).reason).toBe('rebel');
    const reveal = PARTISANS.checkReveal;
    (PARTISANS as { checkReveal: number }).checkReveal = 0;
    try {
      p.passport = { ...b.passport!, owner: b.pid };
      sim.ctx.insurgency.giveCover(p);
      expect(p.cover?.name).toBe(b.name);
      expect(sim.law.judge(p).reason).not.toBe('rebel');
    } finally {
      (PARTISANS as { checkReveal: number }).checkReveal = reveal;
    }
  });

  it('забрать паспорт: у жертвы с поднятыми руками; с тела — вместе с одеждой, личина по паспорту', () => {
    const sim = makeSim(5153);
    const p = createCharacter(sim.entities, sim.ctx.rng, 'rebel', 100, 100, true, 0);
    p.profession = 'spec_agent';
    const v = createCharacter(sim.entities, sim.ctx.rng, 'citizen', 120, 100, false, 0);
    const own = v.passport!;
    expect(sim.ctx.insurgency.takePassport(p, v, v)).toContain(v.name);
    expect(p.passport).toBe(own);
    expect(v.passport).toBeNull();
    // Тело рабочего ТС в одежде: паспорт и одежда — на себя, для ВС он теперь тот рабочий.
    const w = createCharacter(sim.entities, sim.ctx.rng, 'cwu', 200, 100, false, 0);
    w.profession = 'janitor';
    w.passport = { ...w.passport!, faction: 'cwu', profession: 'janitor', job: 'Трудовой союз · Уборщик ТС' };
    const coat = CLOTH_ITEMS.find((it) => it.fashion.id === 'quilted')!;
    w.gear.outer = coat.id;
    sim.combat.kill(w, null);
    const body = sim.combat.corpses[sim.combat.corpses.length - 1];
    expect(body.passport?.name).toBe(w.name);
    const text = sim.ctx.insurgency.takeIdentity(p, body);
    expect(text).toContain(w.name);
    expect(p.passport?.name).toBe(w.name);
    expect(p.gear.outer).toBe(coat.id);
    expect(p.disguised).toBe(true);
    expect(p.cover).toMatchObject({ faction: 'cwu', profession: 'janitor', name: w.name });
    expect(body.stripped).toBe(true);
    // Прежний чужой паспорт остался на теле (обмен).
    expect(body.passport).toBe(own);
  });
});
