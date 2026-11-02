/**
 * Европейские фасады и скатные крыши в виде ¾ (world/facadeStyle.ts — что у дома, world/FacadeRenderer.ts — как
 * нарисовать; лист sheets/roofs.html). Слобода — закопчённый кирпич рабочих кварталов, Старый город — узкие
 * кирпичные дома со щипцами (Амстердам) и штукатурка с наличниками и ставнями (Мюнхен), Верхний город — лондонские
 * террасы (руст, кирпич, балконы с решёткой, мансарды) и каменные доходные дома, казённые здания — камень с
 * пилястрами, медь и шифер. Размеры — в пикселях мира (тайл 16), цвета — hsl-тройки (оттенок по дому) и строки.
 */
type Hsl = { h: number; s: number; l: number };

export const FACADES = {
  /**
   * Высоты: первый этаж, этаж выше, бельэтаж (второй этаж Лондона и доходного дома — выше), карниз / парапет / свес;
   * щипец — по ширине, не выше gableMax. Окно — на 4 px ниже своего этажа.
   */
  size: { ground: 18, upper: 14, piano: 16, cornice: 3, parapet: 5, eave: 2, gableMax: 22, gableMin: 10, minRoof: 6 },
  /** Шаг окон по семейству (желаемый: окон — сколько влезает с таким шагом, поровну по ширине). */
  bay: { slum: 20, amsterdam: 24, munich: 22, london: 18, grand: 22, civic: 22 } as Record<string, number>,
  /** Ширина окна по семейству. */
  window: { slum: 6, amsterdam: 7, munich: 7, london: 6, grand: 8, civic: 8 } as Record<string, number>,

  brick: {
    slum: [{ h: 12, s: 28, l: 25 }, { h: 20, s: 18, l: 23 }, { h: 6, s: 30, l: 27 }, { h: 28, s: 10, l: 26 }] as readonly Hsl[],
    amsterdam: [{ h: 8, s: 44, l: 29 }, { h: 14, s: 40, l: 26 }, { h: 4, s: 36, l: 24 }, { h: 18, s: 30, l: 31 }] as readonly Hsl[],
    london: [{ h: 38, s: 34, l: 52 }, { h: 32, s: 28, l: 47 }, { h: 10, s: 46, l: 36 }] as readonly Hsl[],
    mortar: 'rgba(214,204,186,0.34)',
    jitter: 4,
  },
  stucco: {
    munich: [
      { h: 42, s: 58, l: 66 }, { h: 16, s: 50, l: 70 }, { h: 96, s: 22, l: 66 }, { h: 46, s: 42, l: 80 },
      { h: 204, s: 22, l: 70 }, { h: 30, s: 48, l: 58 }, { h: 352, s: 30, l: 72 },
    ] as readonly Hsl[],
    london: [{ h: 40, s: 18, l: 86 }, { h: 44, s: 22, l: 82 }] as readonly Hsl[],
    slum: [{ h: 36, s: 12, l: 46 }, { h: 30, s: 10, l: 40 }] as readonly Hsl[],
    rustic: 'rgba(0,0,0,0.20)',
    noise: 'rgba(0,0,0,0.06)',
  },
  stone: [{ h: 40, s: 12, l: 70 }, { h: 34, s: 10, l: 64 }, { h: 210, s: 6, l: 60 }] as readonly Hsl[],
  joint: 'rgba(0,0,0,0.16)',

  /** Обрамление окон, карнизы, пояса: белая краска, светлый камень, тёмный камень Слободы. */
  trim: { white: '#ece6d8', cream: '#e2d6b8', stone: '#cfc6b2', dark: '#6e655a' },
  /** Тень: откос проёма, под карнизом, под подоконником. */
  shade: 'rgba(0,0,0,0.38)',
  light: 'rgba(255,248,232,0.30)',
  glass: { day: '#2e3d46', dayHi: '#58707c', shine: 'rgba(220,236,244,0.55)', night: '#efc56f', nightHi: '#ffe2a0', dark: '#15191c' },
  curtains: ['#9a3d3d', '#3e6e58', '#c4a55c', '#56598c', '#b06a88', '#dcd0b6', '#7a5235'] as readonly string[],
  shutters: ['#3f5f3a', '#2f4a5e', '#5a3f2a', '#6b2e24', '#58604a'] as readonly string[],
  flowers: ['#d8594a', '#e8c14a', '#d98ab8', '#f2efe6', '#e07a3a'] as readonly string[],
  leaf: '#4c7a36',
  iron: '#1a1c1e',
  doors: {
    london: ['#1c1c1e', '#1f3d2b', '#5a1a1a', '#1e2a44', '#2e2a26'],
    amsterdam: ['#1f3a2e', '#3a2a1c', '#202020', '#2a3a4a'],
    munich: ['#5a3a22', '#4a2e1c', '#3e2a1a'],
    slum: ['#4a4036', '#3c362e', '#4f4334'],
    civic: ['#26292c', '#33302a'],
  } as Record<string, readonly string[]>,
  /** Витрина лавки: вывеска (фриз) и надпись, переплёт, цоколь. */
  shop: {
    fascia: ['#1f3a2e', '#4a1c1c', '#1d2a3f', '#181818', '#3a2a18'] as readonly string[],
    letters: '#d8b860',
    frame: '#2a2420',
    riser: '#3a2e24',
    goods: ['#c9a227', '#a0522d', '#6b8e23', '#b03a2e', '#e8dcc8', '#4f6b8a'] as readonly string[],
  },
  /** Мелочи: водосток, фонарь у двери, плакаты Протектората, бельё на верёвке. */
  pipe: '#2a2a28',
  lantern: { body: '#22201c', glass: '#e8c878', glow: 'rgba(255,205,120,0.35)' },
  posters: ['#a83a30', '#c9b27a', '#3a4a5a', '#d8d0bc'] as readonly string[],
  laundry: ['#d8d0bc', '#8a9aa8', '#a85a4a', '#c9b27a', '#6b8a6a'] as readonly string[],
  banner: { cloth: '#5a1a1a', edge: '#2a0c0c', mark: '#d8c8a0' },
  /** Копоть сверху и потёки под окнами (доля яркости, 0..1 по семейству). */
  grime: { slum: 0.75, amsterdam: 0.25, munich: 0.15, london: 0.25, grand: 0.1, civic: 0.3 } as Record<string, number>,

  /** Кровля: черепица (Мюнхен), голландская волнистая (Амстердам), шифер (Лондон), медь (казённые купола и вальмы). */
  roof: {
    tile: [{ h: 10, s: 50, l: 36 }, { h: 14, s: 46, l: 33 }, { h: 6, s: 40, l: 30 }, { h: 18, s: 42, l: 38 }] as readonly Hsl[],
    pantile: [{ h: 18, s: 52, l: 36 }, { h: 14, s: 46, l: 32 }, { h: 24, s: 14, l: 20 }] as readonly Hsl[],
    slate: [{ h: 214, s: 12, l: 30 }, { h: 228, s: 9, l: 27 }, { h: 205, s: 10, l: 33 }] as readonly Hsl[],
    copper: [{ h: 164, s: 20, l: 40 }, { h: 158, s: 17, l: 37 }] as readonly Hsl[],
    /** Ряд черепицы (пиксели) на южном скате и на северном (уже в ¾). */
    row: { tile: 3, pantile: 3, slate: 2, copper: 3 } as Record<string, number>,
    jitter: 5,
    /** Конёк — доля высоты крыши от северного края; северный скат темнее. */
    ridge: 0.36,
    north: -9,
    south: 2,
    /** Вальма — на сколько темнее торцевой скат. */
    hip: -5,
    ridgeCap: 'rgba(0,0,0,0.30)',
    gutter: '#2a2622',
    moss: 'rgba(96,112,64,0.45)',
    tin: ['#5d6266', '#6b4a32', '#4a4f52'] as readonly string[],
    hole: '#1a1612',
    /** Заплаты Слободы: шаг сетки, редкость жести и дыр (1 из N клеток), ржавый потёк, обломки черепицы у дыры. */
    patch: { step: 10, tin: 9, hole: 17, rust: 'rgba(120,64,32,0.55)', broken: 'rgba(90,64,44,0.85)' },
  },
  chimney: { pot: '#a35a3a', potDark: '#6a3424', top: 'rgba(255,255,255,0.18)', soot: 'rgba(0,0,0,0.5)', shadow: 'rgba(0,0,0,0.28)' },
  dormer: { cheek: 'rgba(0,0,0,0.28)' },
} as const;
