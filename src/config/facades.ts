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
   * Масштаб — по пешке (рост ≈ 28 px мира): первый этаж 36 (дверь ≈ 31 — пешка проходит в рост), этаж выше 28,
   * бельэтаж Лондона и доходного дома 32; карниз / парапет / свес; щипец — по ширине, от gableMin до gableMax.
   * Над фасадом остаётся крыша не меньше minRoof (иначе этажей меньше — их ограничивает глубина дома).
   */
  size: { ground: 36, upper: 28, piano: 32, cornice: 6, parapet: 10, eave: 4, gableMax: 46, gableMin: 22, minRoof: 10 },
  /** Окно: высота на первом этаже, выше, на бельэтаже (французское), в верхнем этаже Амстердама; отступ от верха этажа. */
  winH: { ground: 19, upper: 17, piano: 22, attic: 12, top: 5 },
  /** Дверь: высота портала, ширина (с портиком шире), фрамуга; у лавки дверь начинается под фризом (shopTop). */
  door: { h: 31, w: 24, portico: 30, fan: 5, shopTop: 10 },
  /** Витрина лавки: фриз с надписью, шаг переплёта, цоколь. */
  shopfront: { fascia: 8, mullion: 8, riser: 5, font: 5.4 },
  /** Шаг окон по семейству (желаемый: окон — сколько влезает с таким шагом, поровну по ширине). */
  bay: { slum: 30, amsterdam: 30, munich: 32, london: 27, grand: 32, civic: 32 } as Record<string, number>,
  /** Ширина окна по семейству. */
  window: { slum: 11, amsterdam: 12, munich: 12, london: 11, grand: 13, civic: 13 } as Record<string, number>,

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
  /**
   * Ночь: горящее окно поверх темноты — стекло, ореол (доля размера окна) и свет на мостовую перед фасадом (источник
   * в карте света: на spill px от фасада, радиус spillR, сила; окна выше первого этажа светят слабее — upper).
   * Фонарь у двери — ореол lampR.
   */
  night: { halo: 'rgba(255,190,105,0.34)', haloR: 1.8, spill: 14, spillR: 46, spillPower: 1.25, upper: 0.55, lampHalo: 'rgba(255,205,120,0.6)', lampR: 14, lampSpill: 30, lampPower: 1.1 },
  /**
   * Слой крыш в игре (world/RoofLayer.ts): каждый дом рисуется один раз в свой холст (кэш до maxPixels пикселей,
   * давно не видные — вон); за кадр строится не дольше budget мс (дом без холста — заглушка цветом крыши), на margin
   * px вокруг экрана — заранее; при входе крыша снимается за fade с; при старте — дома в prebuild px от игрока.
   */
  layer: { budget: 4, maxPixels: 16_000_000, margin: 192, fade: 0.3, prebuild: 640, pad: 6 },
  /** Контур своего дома в разрезе; шов между крышами соседей и карниз над открытым местом; козырёк входа сбоку и сзади. */
  cut: { outline: 'rgba(240,192,64,0.9)', dash: [3, 2] as number[], width: 1.2 },
  seam: 'rgba(0,0,0,0.45)',
  eaveLine: 'rgba(16,12,10,0.7)',
  canopy: { color: '#3a3430', edge: 'rgba(0,0,0,0.35)', depth: 5, lamp: '#e8c878' },
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
    /** Ряд черепицы (пиксели) на южном скате и на северном (уже в ¾); ширина плитки. */
    row: { tile: 4, pantile: 4, slate: 3, copper: 5 } as Record<string, number>,
    tileW: { tile: 6, pantile: 6, slate: 5, copper: 5 } as Record<string, number>,
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
  chimney: { w: 8, h: 12, pot: '#a35a3a', potDark: '#6a3424', top: 'rgba(255,255,255,0.18)', soot: 'rgba(0,0,0,0.5)', shadow: 'rgba(0,0,0,0.28)' },
  dormer: { w: 12, h: 11, cheek: 'rgba(0,0,0,0.28)' },
} as const;
