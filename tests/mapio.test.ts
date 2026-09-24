import { describe, expect, test } from 'vitest';
import { generateCity } from '../src/world/generator/CityGenerator';
import { parseMap, serializeMap } from '../src/world/mapIO';

describe('сохранение карты в JSON', () => {
  const map = generateCity(4242);

  test('туда и обратно без потерь', () => {
    const back = parseMap(serializeMap(map));
    expect(back.width).toBe(map.width);
    expect(Buffer.from(back.tiles).equals(Buffer.from(map.tiles))).toBe(true);
    expect(Buffer.from(back.zoneGrid).equals(Buffer.from(map.zoneGrid))).toBe(true);
    expect(back.zones).toEqual(map.zones);
    expect(back.pois).toEqual(map.pois);
  });

  test('сетки читаемы: строка на ряд тайлов', () => {
    const json = JSON.parse(serializeMap(map));
    expect(json.tiles).toHaveLength(map.height);
    expect(json.tiles[0]).toHaveLength(map.width);
  });

  test('понятная ошибка при опечатке в сетке', () => {
    const json = JSON.parse(serializeMap(map));
    json.tiles[10] = json.tiles[10].slice(0, 5) + 'Z' + json.tiles[10].slice(6);
    expect(() => parseMap(JSON.stringify(json))).toThrow(/строка 10, столбец 5/);
  });
});
