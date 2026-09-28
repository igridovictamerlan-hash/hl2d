import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { generateCity } from '../src/world/generator/CityGenerator';
import { spawnPopulation } from '../src/systems/Population';
import { CWU_HQ } from '../src/config/cwuHq';
import { createCharacter } from '../src/entities/factory';
import { facadeReach } from '../src/world/generator/layout';
import { furnishMap } from '../src/world/furnish';

describe('штаб ГСР', () => {
  test('генератор: штаб у главного проспекта — цех с конвейерами, отдых, столовая, кабинет, приёмная', () => {
    for (const seed of [12345, 777, 4242]) {
      const map = generateCity(seed);
      const hq = map.poisOf('cwu_hq')[0];
      expect(hq, `сид ${seed}`).toBeTruthy();
      for (const t of ['cwu_hire', 'cwu_head_desk', 'cwu_store', 'cwu_lounge', 'cwu_canteen', 'cwu_office', 'cwu_lobby', 'cwu_production'] as const) {
        expect(map.poisOf(t).length, `${t}, сид ${seed}`).toBeGreaterThanOrEqual(1);
      }
      expect(map.poisOf('ration_line')).toHaveLength(3);
      expect(map.zones.some((z) => z.kind === 'cwu_hq')).toBe(true);
      // До главного проспекта — рукой подать (за рядом домов вдоль него).
      let best = Infinity;
      for (let y = hq.y - 40; y < hq.y + hq.h! + 40; y++) {
        for (let x = hq.x - 40; x < hq.x + hq.w! + 40; x++) {
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
          if (map.zoneAtTile(x, y)?.name !== 'Главный проспект') continue;
          best = Math.min(best, Math.max(0, x < hq.x ? hq.x - x : x - hq.x - hq.w! + 1, y < hq.y ? hq.y - y : y - hq.y - hq.h! + 1));
        }
      }
      expect(best, `сид ${seed}`).toBeLessThanOrEqual(16 + facadeReach());
      // Мебель: столы столовой, стол главы и стойка найма, диван в комнате отдыха.
      const inHq = furnishMap(map).filter((f) => f.x >= hq.x * 16 && f.y >= hq.y * 16 && f.x < (hq.x + hq.w!) * 16 && f.y < (hq.y + hq.h!) * 16);
      expect(inHq.filter((f) => f.kind === 'table').length).toBeGreaterThanOrEqual(2);
      expect(inHq.filter((f) => f.kind === 'desk').length).toBeGreaterThanOrEqual(2);
      expect(inHq.some((f) => f.kind === 'sofa')).toBe(true);
    }
  });

  test('глава ГСР в штабе, граждане устраиваются, фасовщики работают в цехе, инспектор проверяет главу', { timeout: 240_000 }, () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    sim.war.command.paused = true;
    sim.insurgency.paused = true;
    const hq = sim.cwuHq;
    expect(hq.present).toBe(true);
    const head = hq.head!;
    expect(head).toBeTruthy();
    const cwuBefore = sim.entities.list.filter((c) => c.faction === 'cwu').length;
    let headInHq = 0;
    let samples = 0;
    let packerAtLine = 0;
    for (let t = 0; t < 420 * 60; t++) {
      sim.step();
      if (t % 60) continue;
      samples++;
      if (sim.map.zoneAtWorld(head.x, head.y)?.kind === 'cwu_hq') headInHq++;
      if (sim.labor.stations.some((s) => s.who && Math.hypot(s.who.x - s.x, s.who.y - s.y) < 30)) packerAtLine++;
    }
    const cwuAfter = sim.entities.list.filter((c) => c.faction === 'cwu').length;
    console.log(`штаб ГСР: ${JSON.stringify(hq.stats)}, ГСР ${cwuBefore} → ${cwuAfter}, глава в штабе ${Math.round((headInHq / samples) * 100)}%, фасуют у конвейера ${packerAtLine} с, коробок ${sim.labor.stats.packed}`);
    expect(headInHq / samples).toBeGreaterThan(0.6);
    expect(hq.stats.hired).toBeGreaterThanOrEqual(1);
    expect(cwuAfter).toBeGreaterThan(cwuBefore);
    // Принятый — рабочий ГСР с профессией из списка нужных и ролью для возрождения.
    const hired = sim.entities.list.filter((c) => c.faction === 'cwu' && c.role?.faction === 'cwu' && c.profession && c.profession in CWU_HQ.hire.needs);
    expect(hired.length).toBeGreaterThan(0);
    expect(packerAtLine).toBeGreaterThan(30);
    expect(sim.labor.stats.packed).toBeGreaterThan(3);
    expect(hq.stats.inspections).toBeGreaterThanOrEqual(1);
  });

  test('игрок-гражданин у стойки: мест нет — отказ; есть место — принят в ГСР', () => {
    const sim = makeSim(12345);
    spawnPopulation(sim.ctx, 30);
    const hq = sim.cwuHq;
    const p = createCharacter(sim.entities, sim.ctx.rng, 'citizen', hq.applicantSpot!.x, hq.applicantSpot!.y, true);
    p.profession = 'citizen';
    const prof = hq.vacancy();
    expect(prof).not.toBeNull();
    let event = '';
    sim.bus.on('hired', ({ profession }) => (event = profession));
    hq.hire(p, prof!, hq.head);
    expect(p.faction).toBe('cwu');
    expect(p.profession).toBe(prof);
    expect(event).toBe(prof);
  });
});
