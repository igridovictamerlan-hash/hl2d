/** Размеры мира. Радиус персонажа — в entities.ts. */
export const WORLD = {
  /** Размер тайла в пикселях мира. */
  tileSize: 16,
  /** Размер карты в тайлах: 188 × 16 = 3008 px. */
  widthTiles: 188,
  heightTiles: 188,
} as const;
