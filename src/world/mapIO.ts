import { GameMap, type Poi, type Zone, type ZoneKind } from './GameMap';
import { CHAR_TO_TILE, TILE_DEFS, tileChar } from './tiles';
import type { MapStats } from './mapStats';

/**
 * Формат карты в JSON (версия 1). Сетки хранятся строками по символу на тайл —
 * карту можно открыть в редакторе с моноширинным шрифтом и дорисовать руками.
 */
export interface MapFileV1 {
  format: 'hl2d-map';
  version: 1;
  name: string;
  seed: number;
  tileSize: number;
  width: number;
  height: number;
  /** Справка: символ → тип тайла (при загрузке не используется). */
  legend: Record<string, string>;
  tiles: string[];
  zones: Zone[];
  zoneGrid: string[];
  pois: Poi[];
  stats?: MapStats | null;
}

const ZONE_KINDS: ZoneKind[] = ['residential', 'avenue', 'plaza', 'nexus', 'cells', 'industrial', 'restricted', 'checkpoint', 'outlands'];

export function mapToFile(map: GameMap): MapFileV1 {
  const tiles: string[] = [];
  const zoneGrid: string[] = [];
  const zoneChar = map.zones.map((z) => z.char);
  for (let y = 0; y < map.height; y++) {
    let t = '';
    let z = '';
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      t += tileChar(map.tiles[i]);
      z += zoneChar[map.zoneGrid[i]] ?? '?';
    }
    tiles.push(t);
    zoneGrid.push(z);
  }
  const legend: Record<string, string> = {};
  for (const d of TILE_DEFS) legend[d.char] = d.name;
  return {
    format: 'hl2d-map',
    version: 1,
    name: map.name,
    seed: map.seed,
    tileSize: map.tileSize,
    width: map.width,
    height: map.height,
    legend,
    tiles,
    zones: map.zones,
    zoneGrid,
    pois: map.pois,
    stats: map.stats,
  };
}

export function serializeMap(map: GameMap): string {
  return JSON.stringify(mapToFile(map), null, 2);
}

/** Разбор и проверка JSON карты. Ошибки — с номером строки сетки, чтобы легко найти опечатку. */
export function parseMap(text: string): GameMap {
  let data: MapFileV1;
  try {
    data = JSON.parse(text) as MapFileV1;
  } catch (e) {
    throw new Error(`Не JSON: ${(e as Error).message}`);
  }
  if (data.format !== 'hl2d-map') throw new Error('Это не карта hl2d (нет format: "hl2d-map")');
  if (data.version !== 1) throw new Error(`Неизвестная версия карты: ${data.version}`);
  const { width, height } = data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) {
    throw new Error('Некорректные width/height');
  }
  if (!Array.isArray(data.tiles) || data.tiles.length !== height) throw new Error(`tiles: нужно ${height} строк`);
  if (!Array.isArray(data.zones) || data.zones.length === 0) throw new Error('zones: пустой список');

  const zones: Zone[] = data.zones.map((z, i) => {
    if (!ZONE_KINDS.includes(z.kind)) throw new Error(`zones[${i}]: неизвестный kind "${z.kind}"`);
    return { id: i, kind: z.kind, name: String(z.name), char: String(z.char) };
  });
  const zoneByChar = new Map(zones.map((z) => [z.char, z.id]));

  const tiles = new Uint8Array(width * height);
  const zoneGrid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = data.tiles[y];
    if (typeof row !== 'string' || row.length !== width) throw new Error(`tiles, строка ${y}: длина должна быть ${width}`);
    const zrow = data.zoneGrid?.[y] ?? '';
    for (let x = 0; x < width; x++) {
      const t = CHAR_TO_TILE.get(row[x]);
      if (t === undefined) throw new Error(`tiles, строка ${y}, столбец ${x}: неизвестный символ "${row[x]}"`);
      tiles[y * width + x] = t;
      zoneGrid[y * width + x] = zoneByChar.get(zrow[x]) ?? 0;
    }
  }
  const pois: Poi[] = Array.isArray(data.pois)
    ? data.pois.filter((p) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < width && p.y < height)
    : [];
  return new GameMap(width, height, data.tileSize || 16, tiles, zoneGrid, zones, pois, data.seed ?? 0, data.name ?? 'Карта', data.stats ?? null);
}

/** Скачивание карты файлом (браузер). */
export function downloadMap(map: GameMap): void {
  const blob = new Blob([serializeMap(map)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `city17-${map.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Диалог выбора файла карты (браузер). */
export function pickMapFile(): Promise<GameMap> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('Файл не выбран'));
      try {
        resolve(parseMap(await file.text()));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

export async function fetchMap(url: string): Promise<GameMap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить ${url}: ${res.status}`);
  return parseMap(await res.text());
}
