import { T } from '../world/tiles';

/** Мини-карта (угол экрана) и большая карта (M). Размеры — CSS px, окрестность — тайлы. */
export const MINIMAP = {
  size: 180,
  /** Сколько тайлов видно на мини-карте по стороне. */
  span: 72,
  /** Радиус «исследования» канализации вокруг игрока, тайлы. */
  exploreRadius: 16,
  /** Люк считается найденным, если игрок подходил ближе, px. */
  discoverHatch: 120,
  /** Цвета тайлов на схеме (r, g, b). */
  tiles: {
    [T.WALL]: [18, 20, 23],
    [T.METAL]: [36, 58, 86],
    [T.FLOOR]: [96, 92, 84],
    [T.STREET]: [70, 76, 84],
    [T.PLAZA]: [150, 134, 100],
    [T.INTERIOR]: [96, 76, 58],
    [T.ARCH]: [120, 94, 64],
    [T.DOOR]: [160, 110, 60],
    [T.GATE]: [200, 165, 60],
    [T.COURTYARD]: [82, 100, 70],
    [T.BUNKER]: [118, 124, 128],
    [T.WASTE]: [104, 88, 56],
    [T.BARRIER]: [58, 58, 58],
    [T.SEWER]: [66, 74, 58],
    [T.SEWER_WATER]: [38, 84, 66],
    [T.SEWER_WALL]: [12, 11, 10],
    [T.ROCK]: [44, 38, 30],
  } as Record<number, readonly [number, number, number]>,
  colors: {
    player: '#ffd36b',
    ally: '#8cc8ff',
    rebelAlly: '#ff9a4a',
    front: '#c8c4b8',
    fight: '#ff8c3c',
    capture: '#ff4a3a',
    nexus: '#6aa8ff',
    ration: '#ffd36b',
    shop: '#9fd7a0',
    hatch: '#b8b0a0',
    node: '#6ec2ff',
    nodeBroken: '#ff6a3a',
    alarm: 'rgba(240,180,40,0.9)',
    base: '#ff9a4a',
    market: '#d9a441',
    frame: 'rgba(255,211,107,0.35)',
    zoneLabel: 'rgba(230,226,214,0.8)',
  },
} as const;
