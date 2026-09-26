/** Палитра отрисовки мира. Тёмная, холодная гамма Сити-17. */
export const RENDER = {
  background: '#07090b',
  tiles: {
    /**
     * Крыши: hue/sat/light — у каждого дома оттенок в этих пределах. Гамма сдержанная — серый
     * шифер с лёгкой разницей между домами, без пёстрых «ячеек».
     */
    roof: { hues: [208, 214, 220, 30] as readonly number[], sat: [3, 8] as const, light: [21, 26] as const },
    /** Скаты крыши дома: светлый (к свету) и тёмный, конёк — светлее и с линией. */
    roofSlope: { light: 4, dark: -5, ridge: 7 },
    roofRidge: 'rgba(255,240,220,0.18)',
    /** Карниз у края крыши (тень под свесом) и швы между соседними домами. */
    roofEdge: 'rgba(0,0,0,0.35)',
    roofSeam: 'rgba(0,0,0,0.32)',
    /** Черепица/шифер — штрихи вдоль ската. */
    roofTile: 'rgba(0,0,0,0.12)',
    chimney: '#3a3431',
    chimneyTop: '#1d1917',
    /** Стены жилых домов (вокруг комнаты): штукатурка и контур. */
    houseWall: { h: 32, s: 12, l: 46, noise: 2 },
    houseWallLine: 'rgba(0,0,0,0.45)',
    metal: '#1a2735',
    metalLine: 'rgba(90,150,210,0.22)',
    floor: { h: 38, s: 6, l: 28, noise: 2.4 },
    street: { h: 210, s: 5, l: 23, noise: 1.2 },
    streetMark: 'rgba(200,190,140,0.18)',
    plaza: { h: 40, s: 8, l: 33, noise: 1.5 },
    plazaLine: 'rgba(0,0,0,0.22)',
    interior: { h: 28, s: 18, l: 25, noise: 1.5 },
    interiorLine: 'rgba(0,0,0,0.25)',
    courtyard: { h: 75, s: 12, l: 24, noise: 2.5 },
    arch: { h: 35, s: 6, l: 24, noise: 1.5 },
    archRoof: 'rgba(0,0,0,0.35)',
    door: '#5b3d20',
    doorFrame: '#2a1b0e',
    doorOpen: '#1c1a17',
    doorLocked: 'rgba(210,60,50,0.85)',
    gate: '#2c3a47',
    gateStripe: 'rgba(230,190,60,0.35)',
    bunker: { h: 200, s: 4, l: 30, noise: 1 },
    bunkerLine: 'rgba(0,0,0,0.28)',
    waste: { h: 45, s: 16, l: 22, noise: 3 },
    barrier: '#6d6f6c',
    barrierTop: 'rgba(255,255,255,0.18)',
    barrierEdge: 'rgba(0,0,0,0.55)',
    /** Канализация: мокрый бетон, сток, кирпичная кладка. */
    sewer: { h: 90, s: 7, l: 17, noise: 1.6 },
    sewerLine: 'rgba(0,0,0,0.3)',
    sewerWater: { h: 150, s: 28, l: 13, noise: 1.2 },
    sewerFlow: 'rgba(140,200,160,0.12)',
    sewerWall: { h: 20, s: 12, l: 9, noise: 1.5 },
    sewerBrick: 'rgba(0,0,0,0.35)',
    sewerWallEdge: 'rgba(160,150,120,0.16)',
    /** Скалы пустоши вокруг города. */
    rock: { h: 32, s: 14, l: 14, noise: 3 },
    rockCrack: 'rgba(0,0,0,0.35)',
    speckle: 'rgba(0,0,0,0.18)',
    /** Тень от зданий на пол (свет с северо-запада). */
    shadow: 'rgba(0,0,0,0.38)',
    shadowSize: 5,
  },
  entity: {
    nameFont: '600 11px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    roleFont: '500 9px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    nameColor: '#e8e8e2',
    playerNameColor: '#ffd36b',
    labelShadow: 'rgba(0,0,0,0.85)',
    playerRing: 'rgba(255,211,107,0.85)',
    speechFont: '500 11px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    speechBg: 'rgba(12,14,16,0.82)',
    speechText: '#f1eee4',
    terminal: '#ffd36b',
    /** Терминал кодов тревоги в кабинете Администратора: корпус, рамка, экран по коду. */
    codeTerminal: { case: '#1b2530', rim: '#4f5d6f', screen: { green: '#4fd08a', yellow: '#ffd36b', red: '#ff5b4a' } },
    stun: 'rgba(150,210,255,0.9)',
  },
  effects: {
    /** Люк в городе (крышка) и в канализации (лестница, свет сверху). */
    hatchCover: '#2b2e30',
    hatchRim: 'rgba(170,175,180,0.55)',
    hatchLadder: 'rgba(190,170,120,0.8)',
    hatchLight: 'rgba(255,240,190,0.10)',
    /** Узел Альянса (терминал): цел — голубой огонёк, саботирован — искры. */
    node: '#1c2733',
    nodeLight: 'rgba(110,190,255,0.95)',
    nodeDead: 'rgba(60,60,60,0.95)',
    nodeSpark: 'rgba(255,170,60,0.95)',
    cache: '#3d4a2c',
    queueMark: 'rgba(255,211,107,0.35)',
    fusebox: '#4a5058',
    brokenA: '#ff6a3a',
    brokenB: '#ffd36b',
    progress: '#8fd6b0',
    blood: 'rgba(110,10,10,0.55)',
    loot: '#ffd36b',
    tracerCombine: 'rgba(140,200,255,0.95)',
    tracerRebel: 'rgba(255,190,90,0.95)',
    flash: 'rgba(255,240,180,0.9)',
    bloodHit: 'rgba(190,20,20,0.95)',
    spark: 'rgba(255,230,160,0.9)',
    /** Мебель: кровать (рама, одеяло, подушка), стол со стульями, стол канцелярии, шкаф OTA. */
    furniture: {
      bedFrame: '#3e2a1c', blanket: ['#5b6b7a', '#6d5a48', '#4f6a55', '#7a5a5a'] as readonly string[], pillow: '#d8d2c4',
      table: '#5a3f28', tableTop: '#6e4e33', chair: '#3b2a1d',
      desk: '#4a4f57', deskTop: '#5d646e', paper: '#e9e5da', lamp: '#ffd36b',
      locker: '#2c3440', lockerLine: '#46566a', rifle: '#15191e', outline: 'rgba(0,0,0,0.55)',
    },
    /** Фонарь на проспекте: столб у стены, кронштейн, плафон и пятно света (спрайт). */
    lamp: { post: '#26292e', arm: '#3a3e45', head: '#f3ecc9', rim: '#15171a', glow: '255,232,170', glowRadius: 72, glowAlpha: 0.3 },
    /** Скамейка: доски, спинка у стены, ножки. */
    bench: { wood: '#7a5a3a', dark: '#4e3924', leg: '#2a2b2e', length: 46, depth: 9 },
    /** Бочка с огнём (уличная жизнь): корпус, обод, ржавчина, пламя, отсвет (radius px мира). */
    barrel: { body: '#3b3a36', rim: '#6d6a60', rust: '#6b3f22', fire: ['#ffd36b', '#ff8a2a', '#e04a1a'], glow: '255,140,50', glowRadius: 70, r: 7 },
    /** Следы на земле: гильза, лужица крови, копоть взрыва, выбоина у стены. */
    casing: 'rgba(214,176,90,0.9)',
    bloodDecalColor: 'rgb(110,12,12)',
    scorch: '20,18,16',
    chip: 'rgba(200,200,190,0.55)',
    /** Граната: корпус, мигающий огонёк (цвет стороны), тень в полёте; взрыв: вспышка и дым. */
    grenade: '#39402f',
    grenadeLightCombine: '#6fc3ff',
    grenadeLightRebel: '#ff5a3a',
    grenadeShadow: 'rgba(0,0,0,0.35)',
    blastCore: '255,245,200',
    blastFire: '255,140,40',
    blastSmoke: '80,80,80',
    /** Тряска экрана от близкого взрыва: амплитуда, px мира. */
    shake: 7,
    /** Мусор: пакеты и хлам; завод: конвейер и коробки; коробка у курьера; склад будки. */
    trash: ['#4a4a44', '#5d5647', '#3c4148', '#6b5d4a', '#2f3a33'],
    trashSearched: 'rgba(0,0,0,0.25)',
    conveyor: '#3a3f46',
    conveyorBelt: '#23262b',
    roller: '#6d747c',
    box: '#b08a52',
    boxTape: '#e0c07a',
    stockText: '#ffd36b',
    /** Сканер Альянса: корпус, линза, пятно света на земле, вспышка «фото». */
    /** Пламя: внешнее, внутреннее, отсвет. */
    flameOuter: '#e8551c',
    flameInner: '#ffd24a',
    flameGlow: 'rgba(255,140,40,0.18)',
    scannerBody: '#5b6572',
    scannerRim: '#2c323a',
    scannerLens: '#9fe0ff',
    scannerLight: 'rgba(170,220,255,0.12)',
    /** Разметка точек D на полу тамбура КПП: у Альянса, у повстанцев, идёт капт. */
    pointCombine: 'rgba(130,180,245,0.75)',
    pointRebel: 'rgba(250,155,60,0.85)',
    pointCapture: 'rgba(255,225,120,0.85)',
    scannerFlash: 'rgba(255,255,255,0.85)',
  },
  /**
   * Конус прицела (как в Foxhole): треугольник разброса с дугой на предельной дальности.
   * Цвета — «r,g,b» (прозрачность задаётся отдельно). Заливка обрезается стенами (лучи DDA).
   */
  aim: {
    player: '255,211,107',
    combine: '120,190,255',
    rebel: '255,150,70',
    neutral: '225,225,225',
    /** Прозрачность заливки: от бедра, прицельно, у NPC. */
    fillHip: 0.05,
    fillAim: 0.15,
    fillNpc: 0.07,
    edgeHip: 0.22,
    edgeAim: 0.55,
    edgeNpc: 0.22,
    arc: 0.9,
    arcNpc: 0.45,
    /** Шаг лучей обрезки по углу, градусы, и предел лучей на конус. */
    rayStepDeg: 1.2,
    maxRays: 48,
    /** Цвет дуги при полном прицеливании и при перезарядке. */
    steady: '255,255,255',
    reload: '160,160,160',
  },
  /** Оружие в руках рисуется по моделям — config/weaponSprites.ts. */
  /** Трассеры: толщина по классу оружия (px мира), особые цвета AR2 и арбалета. */
  tracers: {
    width: { melee: 1, pistol: 1.2, magnum: 2, smg: 1.1, rifle: 1.8, shotgun: 0.9, crossbow: 1.6 },
    pulse: 'rgba(150,235,255,0.95)',
    bolt: 'rgba(255,120,60,0.95)',
    swing: 'rgba(170,210,255,0.55)',
    swingHit: 'rgba(200,230,255,0.9)',
  },
  /** Указатели на пограничные КПП у края экрана: в бою — оранжевые, мигают. */
  frontMarker: {
    font: '600 11px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    calm: 'rgba(200,196,180,0.55)',
    fight: '255,140,60',
    inset: 30,
    /** Метров в тайле (для подписи расстояния). */
    metersPerTile: 1,
  },
  crosshair: 'rgba(255,211,107,0.9)',
  /** Предел пикселей холста: на 4K/HiDPI рендерим в меньшем разрешении ради FPS. */
  maxCanvasPixels: 2560 * 1440,
  maxDpr: 2,
  vignette: 0.5,
} as const;
