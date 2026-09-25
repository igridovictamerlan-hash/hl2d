/**
 * Типы тайлов. Числовые id хранятся в Uint8Array карты, символы — в JSON (удобно править руками).
 * solid — непроходим, opaque — перекрывает обзор (туман войны, этап 2).
 */
export const T = {
  WALL: 0,
  FLOOR: 1,
  STREET: 2,
  PLAZA: 3,
  INTERIOR: 4,
  ARCH: 5,
  DOOR: 6,
  GATE: 7,
  COURTYARD: 8,
  METAL: 9,
  BUNKER: 10,
  WASTE: 11,
  BARRIER: 12,
  SEWER: 13,
  SEWER_WATER: 14,
  SEWER_WALL: 15,
} as const;

export type TileId = (typeof T)[keyof typeof T];

export interface TileDef {
  id: TileId;
  key: string;
  char: string;
  name: string;
  solid: boolean;
  opaque: boolean;
}

export const TILE_DEFS: readonly TileDef[] = [
  { id: T.WALL, key: 'wall', char: '#', name: 'Здание', solid: true, opaque: true },
  { id: T.FLOOR, key: 'floor', char: '.', name: 'Переулок (брусчатка)', solid: false, opaque: false },
  { id: T.STREET, key: 'street', char: '=', name: 'Магистраль (асфальт)', solid: false, opaque: false },
  { id: T.PLAZA, key: 'plaza', char: ':', name: 'Площадь / двор Нексуса', solid: false, opaque: false },
  { id: T.INTERIOR, key: 'interior', char: ',', name: 'Пол внутри здания', solid: false, opaque: false },
  { id: T.ARCH, key: 'arch', char: 'a', name: 'Арка сквозь здание', solid: false, opaque: false },
  { id: T.DOOR, key: 'door', char: 'd', name: 'Дверь', solid: false, opaque: false },
  { id: T.GATE, key: 'gate', char: 'g', name: 'Ворота / КПП', solid: false, opaque: false },
  { id: T.COURTYARD, key: 'courtyard', char: 'y', name: 'Двор-колодец', solid: false, opaque: false },
  { id: T.METAL, key: 'metal', char: 'M', name: 'Стена Альянса', solid: true, opaque: true },
  { id: T.BUNKER, key: 'bunker', char: 'k', name: 'Бетонный пол КПП', solid: false, opaque: false },
  { id: T.WASTE, key: 'waste', char: 'o', name: 'Пустошь за городом', solid: false, opaque: false },
  // Низкое укрытие: не пройти, но видно поверх (для перестрелок в коридоре КПП).
  { id: T.BARRIER, key: 'barrier', char: 'B', name: 'Бетонный блок (укрытие)', solid: true, opaque: false },
  // Канализация: отдельная область той же сетки, связанная с городом люками.
  { id: T.SEWER, key: 'sewer', char: 's', name: 'Пол канализации', solid: false, opaque: false },
  { id: T.SEWER_WATER, key: 'sewer_water', char: '~', name: 'Сток (вода по щиколотку)', solid: false, opaque: false },
  { id: T.SEWER_WALL, key: 'sewer_wall', char: 'w', name: 'Кладка канализации', solid: true, opaque: true },
];

/** Быстрые таблицы: SOLID[tileId] === 1 — непроходим. */
export const SOLID = new Uint8Array(256);
export const OPAQUE = new Uint8Array(256);
export const CHAR_TO_TILE = new Map<string, TileId>();
for (const d of TILE_DEFS) {
  SOLID[d.id] = d.solid ? 1 : 0;
  OPAQUE[d.id] = d.opaque ? 1 : 0;
  CHAR_TO_TILE.set(d.char, d.id);
}

export const tileChar = (id: number): string => TILE_DEFS[id]?.char ?? '#';

/** Открытые пространства, где длинный обзор допустим (не считаются «прямым участком переулка»). */
export const isOpenArea = (id: number): boolean => id === T.STREET || id === T.PLAZA;
