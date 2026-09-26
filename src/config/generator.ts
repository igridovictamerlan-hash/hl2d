/**
 * Параметры генератора переулочной карты. Все размеры — в тайлах (1 тайл = 16 px).
 * Ширины: узкий проход 2 тайла = 32 px, основной переулок 3 = 48 px, магистраль 7–8 = 112–128 px.
 */
export const GENERATOR = {
  /** Толщина городской стены по краю карты. */
  border: 2,

  /** Канализация: люки, сеть тоннелей (решётка + петли), убежище и чёрный рынок. */
  /**
   * Пустошь вокруг города (за стеной): полосы скал по бокам (side) и снизу (bottom), в них — тропа
   * шириной trail от выхода в пустошь каждого КПП вниз и по низу карты к лагерю сопротивления
   * посередине. Проход в пустошь КПП — opening рядов. Лагерь — camp (внутренние размеры).
   */
  wastes: {
    side: 8,
    bottom: 26,
    trail: 5,
    opening: 8,
    camp: { w: 40, h: 15 },
    /** Камни на обочине тропы (доля тайлов края). */
    rubble: 0.12,
  },

  sewers: {
    /**
     * Люков в городе (и столько же в канализации) — только в запретной зоне у края карты (не дальше
     * hatchEdge тайлов от края города), не ближе hatchSpacing друг к другу. Ими ходят только партизаны.
     */
    hatches: 2,
    hatchSpacing: 16,
    hatchEdge: 14,
    /** Отступ сети от края области, шаг решётки узлов тоннелей, доля лишних рёбер (петли). */
    margin: 4,
    spacing: 10,
    loopChance: 0.25,
    /** Убежище и чёрный рынок (внутренние размеры). */
    base: { w: 20, h: 13 },
    market: { w: 11, h: 8 },
    /** Ящиков-укрытий в убежище. */
    crates: 6,
  },

  /** Решётка узлов, по рёбрам которой «вырезаются» переулки. */
  lattice: {
    /** Отступ первой линии решётки от границы. */
    margin: 4,
    spacingMin: 13,
    spacingMax: 16,
    /** Смещение узла поперёк линии: даёт изломы переулков под 90°. */
    jitter: 3,
    /** Минимальная разница смещений соседних узлов (≥ ширины переулка — излом перекрывает обзор). */
    minJog: 3,
    /** Где на ребре может быть излом (доля длины ребра). */
    kinkMin: 0.3,
    kinkMax: 0.7,
  },

  alley: {
    narrowWidth: 2,
    mainWidth: 3,
    /** Максимальная длина прямого участка переулка (400 px). */
    maxStraight: 25,
  },

  /** Лабиринт «растущее дерево»: 1 = случайное блуждание с возвратом, 0 = алгоритм Прима. */
  maze: { newestBias: 0.55 },

  districts: {
    residential: { narrowChance: 0.42, loopChance: 0.18 },
    industrial: { narrowChance: 0.12, loopChance: 0.14 },
    restricted: { narrowChance: 0.2, loopChance: 0.16 },
  },

  avenue: {
    /** Вторая (вертикальная) магистраль появляется с этой вероятностью. */
    secondChance: 0.5,
    width: [7, 8] as const,
    segmentLength: [18, 28] as const,
    jog: [2, 4] as const,
    maxDrift: 5,
    /** Длина прямого участка магистрали около площади (под площадь). */
    plazaSegment: 24,
  },

  plaza: { size: [16, 18] as const },

  restricted: {
    size: [38, 44] as const,
    wallThickness: 2,
    gates: [1, 2] as const,
    gateWidth: 4,
  },

  industrial: {
    size: [54, 62] as const,
    yards: [2, 3] as const,
    yardSize: [7, 11] as const,
  },

  residential: { quarters: 4 },

  courtyards: { count: 16, size: [5, 8] as const, margin: 2, maxLink: 8, secondLinkChance: 0.35 },
  passages: { count: 26, archChance: 0.45, maxLength: 9, minDetour: 45 },
  deadEnds: { count: 22, length: [4, 9] as const },
  /** Выходы из штампов (Нексус, КПП) прокапываются наружу не дальше этого. */
  connectorMax: 16,

  connectivity: {
    /** Фрагменты меньше этого (в якорях 2×2) засыпаются, крупнее — соединяются тоннелем. */
    minFragment: 10,
    maxIterations: 80,
  },

  validation: {
    buildingRatio: [0.64, 0.78] as const,
    attempts: 32,
  },
} as const;
