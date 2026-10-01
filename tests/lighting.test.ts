import { describe, expect, test } from 'vitest';
import { makeSim } from './simHarness';
import { dayFraction, dayState, clockText, staticLights } from '../src/world/Lighting';
import { LIGHTING } from '../src/config/lighting';

describe('освещение и время суток', () => {
  test('сутки идут по кругу, игра начинается с заката; ночью лампы горят, днём нет', () => {
    expect(dayFraction(0)).toBeCloseTo(LIGHTING.start, 6);
    expect(dayFraction(LIGHTING.dayLength)).toBeCloseTo(LIGHTING.start, 6);
    expect(dayState(dayFraction(0)).name).toBe('закат');
    const noon = dayState(0.5);
    expect(noon.lamps).toBe(0);
    expect(Math.min(...noon.ambient)).toBeGreaterThan(220);
    const night = dayState(0.95);
    expect(night.lamps).toBe(1);
    expect(Math.max(...night.ambient)).toBeLessThan(180);
    // Ночь синее, закат теплее.
    expect(night.ambient[2]).toBeGreaterThan(night.ambient[0]);
    const sunset = dayState(0.71);
    expect(sunset.ambient[0]).toBeGreaterThan(sunset.ambient[2] + 60);
    // Без скачков: соседние моменты суток почти одинаковы.
    let prev = dayState(0).ambient.slice();
    for (let f = 0.001; f <= 1; f += 0.001) {
      const a = dayState(f).ambient;
      for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - prev[k])).toBeLessThan(6);
      prev = a.slice();
    }
  });

  test('часы: полночь, полдень, вечер', () => {
    expect(clockText(0)).toBe('00:00');
    expect(clockText(0.5)).toBe('12:00');
    expect(clockText(0.79)).toBe('18:57');
  });

  test('источники света: фонари, бочки, узлы Протектората, комнаты, свет из люков в канализации', () => {
    const sim = makeSim(12345);
    const { map } = sim;
    const street = sim.ctx.street;
    const nodes = sim.ctx.economy.nodes;
    const lights = staticLights(map, street.lamps, street.barrels, nodes);
    expect(street.lamps.length).toBeGreaterThan(0);
    // Фонари — ночные и светятся сами; бочки горят всегда.
    const lamp = lights.filter((l) => l.color === LIGHTING.lamp.color);
    expect(lamp.length).toBe(street.lamps.length);
    expect(lamp.every((l) => l.night && l.bloom)).toBe(true);
    const barrels = lights.filter((l) => l.color === LIGHTING.barrel.color);
    expect(barrels.length).toBe(street.barrels.length);
    expect(barrels.every((l) => !l.night && l.flicker > 0)).toBe(true);
    // Узлы Протектората: сломан — не горит (ссылка на узел).
    expect(lights.filter((l) => l.off).length).toBe(nodes.length);
    // Жилые комнаты — тёплый ночной свет, по лампе на комнату.
    const homes = map.poisOf('home').length;
    expect(lights.filter((l) => l.color === LIGHTING.pois.home.color).length).toBe(homes);
    // Люк в канализации — свет сверху, в канализации.
    const sewer = lights.filter((l) => l.color === LIGHTING.hatch.color);
    expect(sewer.length).toBe(map.poisOf('sewer_hatch').length);
    for (const l of sewer) expect(map.levelAt(l.x, l.y)).toBe('sewer');
    // Всё внутри карты.
    const W = map.width * map.tileSize;
    const H = map.height * map.tileSize;
    for (const l of lights) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeGreaterThanOrEqual(0);
      expect(l.x).toBeLessThanOrEqual(W);
      expect(l.y).toBeLessThanOrEqual(H);
    }
  });
});
