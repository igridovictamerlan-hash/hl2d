import type { WeaponClass } from './items';

/**
 * HUD по выбранным ассетам: A3 — кольца здоровья и сытости вокруг портрета своей пешки, значки
 * состояний S1, текущее оружие; B1 — колесо оружия в духе GTA V; C1 — инвентарь в духе Innawoods.
 * Размеры — px экрана (CSS).
 */
export const HUD = {
  /** Портрет с кольцами (левый нижний угол). */
  ring: {
    size: 100,
    /** Радиусы колец (внешнее — здоровье, внутреннее — сытость) и толщина. */
    outer: 44,
    inner: 34,
    outerWidth: 7,
    innerWidth: 6,
    /** Дуга: начало (рад) и размах — разрыв снизу. */
    start: Math.PI * 0.75,
    sweep: Math.PI * 1.5,
    /** Портрет: круг радиуса portrait, пешка масштаба pawnScale, ноги на pawnY от центра. */
    portrait: 27,
    pawnScale: 2.6,
    pawnY: 30,
    /** Ниже доли low — красное кольцо и пульс; цифры видны showFor с после изменения или пока низко. */
    low: 0.25,
    showFor: 3,
    colors: {
      back: 'rgba(18, 14, 10, 0.72)',
      track: 'rgba(255, 255, 255, 0.1)',
      hp: '#e0564a',
      hpLow: '#ff2a1a',
      food: '#e0b55a',
      foodLow: '#ff8a2a',
      portrait: '#3a342a',
      hpText: '#ffd9d2',
      foodText: '#f6dfae',
      numOutline: 'rgba(0, 0, 0, 0.75)',
    },
  },
  /** Значки состояний: размер плашки и рисунка. */
  status: { size: 30, icon: 22 },
  /** Текущее оружие рядом с портретом: иконка длиной len, высотой до maxH. */
  weapon: { len: 92, maxH: 30, grenade: 22 },
  /**
   * Колесо оружия (B1): зажать Q дольше hold с — открыто, мир идёт в slow раз медленнее; мышь —
   * сектор (от центра экрана, ближе dead px — без выбора), колесо мыши — ствол в секторе; отпустить
   * Q — взять. Короткое нажатие — как раньше, следующее оружие.
   */
  wheel: {
    hold: 0.2,
    slow: 0.3,
    inner: 74,
    outer: 190,
    dead: 30,
    gap: 0.035,
    /** Длина и высота силуэта ствола в секторе. */
    gunLen: 86,
    gunMax: 40,
    colors: {
      dim: 'rgba(0, 0, 0, 0.42)',
      sector: 'rgba(10, 10, 10, 0.62)',
      selected: 'rgba(235, 235, 235, 0.26)',
      edge: '#f0f0f0',
      gun: '#f2f2f2',
      gunOutline: 'rgba(0, 0, 0, 0.6)',
      empty: 0.2,
      center: 'rgba(10, 10, 10, 0.6)',
      text: '#ffffff',
      sub: 'rgba(255, 255, 255, 0.62)',
    },
    /** Секторы по часовой, первый — сверху. null в classes — гранаты. */
    sectors: [
      { name: 'Винтовки', classes: ['rifle', 'pulse'] },
      { name: 'Снайперская', classes: ['sniper', 'crossbow'] },
      { name: 'Тяжёлое', classes: ['launcher'] },
      { name: 'Гранаты', classes: null },
      { name: 'Ближний бой', classes: ['melee', 'blade'] },
      { name: 'Пистолеты', classes: ['pistol', 'magnum'] },
      { name: 'ПП', classes: ['smg'] },
      { name: 'Дробовик', classes: ['shotgun'] },
    ] as readonly { name: string; classes: readonly WeaponClass[] | null }[],
    /** Какой ствол показывать силуэтом в пустом секторе. */
    ghost: ['ak74', 'sniper', 'rpg', null, 'knife', 'usp', 'mp7', 'spas12'] as const,
  },
  /** Инвентарь (C1): ячейка, бумага цвета хаки, рамки. */
  inventory: {
    cell: 74,
    gap: 6,
    /** Пешка в центре: масштаб и сторона по умолчанию (E — профиль, ствол в руках виден целиком). */
    pawnScale: 5.2,
    colors: {
      bg: '#6d6848',
      slot: '#8b8662',
      slotEmpty: '#77724f',
      doll: '#77724f',
      line: '#221f16',
      text: '#f3ead0',
      textDim: 'rgba(243, 234, 208, 0.7)',
      ink: '#221f16',
      selected: '#f0d060',
      equipped: '#b8413a',
      badge: 'rgba(20, 18, 12, 0.8)',
      grainLight: 'rgba(255, 250, 220, 0.05)',
      grainDark: 'rgba(0, 0, 0, 0.07)',
      stain: 'rgba(40, 30, 10, 0.16)',
      clear: 'rgba(40, 30, 10, 0)',
      shade: 'rgba(0, 0, 0, 0.18)',
      notch: 'rgba(30, 26, 18, 0.55)',
      label: 'rgba(30, 26, 18, 0.75)',
      shadow: 'rgba(0, 0, 0, 0.28)',
      ghost: 0.22,
    },
  },
} as const;
