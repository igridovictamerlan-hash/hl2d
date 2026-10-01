import type { WeaponClass } from './items';

/**
 * Голос оружия (синтез): crack — щелчок-хлопок (высокочастотный шум, ~10 мс, громкость); body —
 * «тело» выстрела: шум через фильтр (частота среза, длительность); thump — низкий удар (Гц, 0 — нет);
 * zap — «зуд» импульса AR2 (Гц свипа, 0 — нет); gain — общая громкость; wet — доля в эхо.
 */
export interface Voice {
  crack: number;
  body: number;
  bodyDur: number;
  thump: number;
  zap: number;
  gain: number;
  wet: number;
}

/**
 * Звук боя (синтез WebAudio, без файлов). Громкость падает с расстоянием мягко (ref / (ref + d)),
 * далёкое глуше (фильтр) и приходит позже (скорость звука: soundSpeed px/с — город большой, эхо
 * улиц слышно); общий ревербератор (свёртка со сгенерированным откликом reverb.time с) даёт эхо, у
 * далёких выстрелов его доля больше — стрельбу на КПП слышно из города, тихо и гулко.
 */
export const AUDIO = {
  /** Общая громкость 0..1. */
  volume: 0.5,
  /** Дальше этого выстрел не слышен, px. */
  maxDistance: 5200,
  /** Громкость = ref / (ref + d). */
  ref: 420,
  /** Скорость звука, px/с (задержка далёких выстрелов). */
  soundSpeed: 5500,
  /** Не больше стольких звуков в секунду (в плотном бою — самые близкие). */
  maxPerSecond: 26,
  /** Частота среза: вплотную и на пределе слышимости, Гц. */
  cutoffNear: 11000,
  cutoffFar: 380,
  /** Эхо: длина отклика, затухание (степень), громкость; к далёким — ещё farWet. */
  reverb: { time: 2.4, decay: 3.2, gain: 0.55, farWet: 0.55 },
  /** Короткое эхо от стен (задержки, с) и его громкость. */
  slap: { delays: [0.11, 0.23] as readonly number[], gain: 0.22, feedback: 0.25 },
  voices: {
    melee: { crack: 0, body: 1800, bodyDur: 0.06, thump: 0, zap: 0, gain: 0.3, wet: 0.1 },
    blade: { crack: 0, body: 2600, bodyDur: 0.08, thump: 0, zap: 0, gain: 0.25, wet: 0.05 },
    pistol: { crack: 0.9, body: 2600, bodyDur: 0.12, thump: 150, zap: 0, gain: 0.85, wet: 0.35 },
    magnum: { crack: 1.2, body: 1500, bodyDur: 0.28, thump: 90, zap: 0, gain: 1.15, wet: 0.45 },
    smg: { crack: 0.8, body: 3200, bodyDur: 0.09, thump: 170, zap: 0, gain: 0.7, wet: 0.3 },
    rifle: { crack: 1.3, body: 2200, bodyDur: 0.16, thump: 110, zap: 0, gain: 1, wet: 0.45 },
    pulse: { crack: 0.6, body: 2600, bodyDur: 0.14, thump: 120, zap: 1500, gain: 0.85, wet: 0.4 },
    shotgun: { crack: 1.1, body: 900, bodyDur: 0.34, thump: 70, zap: 0, gain: 1.25, wet: 0.5 },
    crossbow: { crack: 0.2, body: 4200, bodyDur: 0.07, thump: 0, zap: 0, gain: 0.35, wet: 0.1 },
    sniper: { crack: 1.6, body: 1400, bodyDur: 0.3, thump: 70, zap: 0, gain: 1.35, wet: 0.6 },
    launcher: { crack: 0.5, body: 600, bodyDur: 0.5, thump: 60, zap: 0, gain: 1.2, wet: 0.5 },
  } satisfies Record<WeaponClass, Voice>,
  /** Взрыв: глухой длинный «бум» с треском и долгим эхом. */
  explosion: { crack: 1, body: 320, bodyDur: 1.4, thump: 48, zap: 0, gain: 1.9, wet: 0.7 } satisfies Voice,
  /** Хлопок дымовой гранаты. */
  pop: { crack: 0.3, body: 1200, bodyDur: 0.6, thump: 90, zap: 0, gain: 0.45, wet: 0.3 } satisfies Voice,
  /** Попадания рядом с игроком (слышно в hitRange px): глухой шлепок, звон рикошета. */
  hitRange: 520,
  flesh: { freq: 180, dur: 0.09, gain: 0.55 },
  ricochet: { freq: 3200, dur: 0.12, gain: 0.12, chance: 0.35 },
  /**
   * Пуля пролетела рядом с игроком: сверхзвуковой щелчок (crack, высокие частоты, crackDur с) и
   * короткий свист (whistle Гц, падает за dur с); громче, чем ближе прошла (power — 0..1).
   */
  whiz: { crack: 0.9, crackDur: 0.012, whistle: 2600, dur: 0.16, gain: 0.38 },
  /**
   * Фон улицы: ветер — шум через фильтр (cutoff Гц), громкость gain (ночью × nightMul, в
   * канализации × sewerMul), порывы — медленная волна (gust — глубина, gustRate — рад/с); треск огня
   * у бочек и костров ближе range px — щелчки rate в секунду вплотную, громкость gain.
   */
  ambient: {
    wind: { cutoff: 420, gain: 0.05, nightMul: 1.5, sewerMul: 0.35, gust: 0.45, gustRate: 0.13 },
    crackle: { range: 240, rate: 9, gain: 0.22, freq: [1400, 4200] as const, dur: [0.006, 0.022] as const },
    /** Корабль Протектората над складом: низкий гул (шум + пила) — слышно до range px. */
    ship: { range: 1400, gain: 0.16, cutoff: 260, hum: 46, humGain: 0.35 },
  },
} as const;
