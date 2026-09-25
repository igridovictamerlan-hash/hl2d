import type { WeaponClass } from './items';

/**
 * Звук выстрелов (синтез WebAudio, без файлов). Громкость и приглушённость — по расстоянию до
 * игрока: перестрелку на КПП слышно из города издалека, глухо.
 */
export const AUDIO = {
  /** Общая громкость 0..1. */
  volume: 0.45,
  /** Дальше этого выстрел не слышен, px. */
  maxDistance: 2200,
  /** Не больше стольких звуков в секунду (в плотном бою — самые близкие). */
  maxPerSecond: 22,
  /** Частота среза фильтра: вплотную и на пределе слышимости, Гц. */
  cutoffNear: 9000,
  cutoffFar: 500,
  /**
   * Голос оружия: полоса шума (центр, добротность), длительность, громкость, «удар» низкой
   * частоты (Гц, 0 — нет) и «зуд» импульса AR2 (частота свипа, 0 — нет).
   */
  voices: {
    melee: { freq: 1800, q: 1, dur: 0.05, gain: 0.25, thump: 0, zap: 0 },
    pistol: { freq: 2400, q: 0.8, dur: 0.12, gain: 0.8, thump: 140, zap: 0 },
    magnum: { freq: 1400, q: 0.7, dur: 0.28, gain: 1.1, thump: 90, zap: 0 },
    smg: { freq: 3000, q: 0.9, dur: 0.08, gain: 0.6, thump: 160, zap: 0 },
    rifle: { freq: 2600, q: 1.2, dur: 0.14, gain: 0.8, thump: 110, zap: 1400 },
    shotgun: { freq: 900, q: 0.6, dur: 0.32, gain: 1.2, thump: 70, zap: 0 },
    crossbow: { freq: 4200, q: 2, dur: 0.07, gain: 0.35, thump: 0, zap: 0 },
  } satisfies Record<WeaponClass, { freq: number; q: number; dur: number; gain: number; thump: number; zap: number }>,
  /** Взрыв гранаты: глухой длинный «бум». */
  explosion: { freq: 380, q: 0.5, dur: 0.9, gain: 1.6, thump: 55, zap: 0 },
} as const;
