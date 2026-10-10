/** Палитра отрисовки мира. Тёмная, холодная гамма Верхнеречье. */
export const RENDER = {
  background: '#0b0806',
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
    /** Пол жилых комнат — доска (как в RimWorld), казённых помещений — серая плитка. */
    woodFloor: { h: 30, s: 34, l: 30, noise: 1 },
    woodFloorLine: 'rgba(40,22,8,0.45)',
    woodFloorKnot: 'rgba(40,22,8,0.35)',
    tileFloor: { h: 210, s: 4, l: 38, noise: 1.2 },
    tileFloorLine: 'rgba(0,0,0,0.28)',
    tileFloorCrack: 'rgba(0,0,0,0.22)',
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
    /** Сад особняка и живая изгородь. */
    garden: { h: 100, s: 22, l: 22, noise: 2.2 },
    gardenBlade: 'rgba(140,190,110,0.35)',
    hedge: { h: 115, s: 30, l: 17, noise: 2 },
    hedgeLeaf: 'rgba(120,170,90,0.4)',
    hedgeShade: 'rgba(0,0,0,0.35)',
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
    /**
     * Траншея (позиционные КПП): вырытый канал — тёмная земля с дощатым настилом; кромка с бруствером из
     * мешков там, где рядом не траншея. Пропасть — чёрная трещина с осыпающейся кромкой.
     */
    trench: { h: 30, s: 22, l: 14, noise: 2 },
    trenchPlank: 'rgba(120,90,55,0.35)',
    trenchBag: '#8a7a55',
    trenchBagDark: 'rgba(0,0,0,0.4)',
    trenchBagLight: 'rgba(255,240,200,0.25)',
    chasm: { h: 20, s: 10, l: 4, noise: 1 },
    chasmCrack: 'rgba(60,45,35,0.55)',
    chasmRim: 'rgba(150,130,100,0.45)',
    /** Руины (стены в зонах КПП вне бункеров): выщербленная кирпичная кладка без крыши. */
    ruinWall: { h: 18, s: 14, l: 21, noise: 3 },
    ruinBrick: 'rgba(0,0,0,0.3)',
    ruinEdge: 'rgba(200,170,130,0.22)',
    speckle: 'rgba(0,0,0,0.18)',
    /** Тень от зданий на пол (свет с северо-запада). */
    shadow: 'rgba(0,0,0,0.38)',
    shadowSize: 5,
  },
  /**
   * Улица старого города (дома вдоль проспектов, лавки, ларьки — POI facade/kiosk/planter). У дома —
   * свой цвет штукатурки из plaster (приглушённые пастели старой Европы), контур, окна по фасаду
   * (window, раз в windowEvery тайлов), у лавок — витрина во всю ширину тайла и маркиза над входом
   * (полосы awning, глубина awningDepth тайла над улицей) с вывеской; прилавки и столы — дерево.
   * Проспект вымощен брусчаткой (cobble: камни cobbleW × cobbleH px со швами).
   */
  facade: {
    plaster: [
      { h: 38, s: 40, l: 62 }, { h: 14, s: 32, l: 60 }, { h: 95, s: 16, l: 56 }, { h: 205, s: 20, l: 60 },
      { h: 48, s: 30, l: 72 }, { h: 22, s: 42, l: 50 }, { h: 350, s: 22, l: 58 }, { h: 170, s: 14, l: 54 },
    ] as readonly { h: number; s: number; l: number }[],
    noise: 1.5,
    line: 'rgba(40,28,20,0.6)',
    plinth: 'rgba(40,30,24,0.45)',
    window: '#2b3440',
    windowLit: '#6f5a3a',
    windowFrame: 'rgba(255,248,235,0.75)',
    windowEvery: 2,
    vitrine: '#34414d',
    vitrineGlint: 'rgba(210,230,255,0.35)',
    awning: [['#8a2f2a', '#e8dcc8'], ['#2f5d4a', '#e8dcc8'], ['#2c4a78', '#e8dcc8'], ['#7a5a26', '#efe2c4']] as readonly (readonly [string, string])[],
    awningDepth: 0.7,
    awningShade: 'rgba(0,0,0,0.25)',
    sign: '#f3ead6',
    signShadow: 'rgba(0,0,0,0.55)',
    signFont: 600,
    wood: '#7a5634',
    woodTop: '#9a7048',
    woodEdge: 'rgba(30,18,8,0.55)',
    kiosk: { body: '#3d6b52', roof: '#29493a', window: '#e9d9a8', sign: '#f3ead6' },
    planter: { rim: '#8c8378', soil: '#4a3a2a', leaf: '#4f7a3a', leafDark: '#355a28', flowers: ['#d8594a', '#e8c14a', '#d98ab8', '#f2efe6'] as readonly string[] },
    cobble: { h: 30, s: 9, l: 31, noise: 2.5, joint: 'rgba(0,0,0,0.28)', w: 8, h2: 6 },
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
    /**
     * Облачко реплики: длиннее maxWidth px — перенос, не больше maxLines строк (лишнее — «…»), строка lineH px,
     * поля pad px, хвостик tail px. Рация (radio — юнит говорит в рацию): тёмно-зелёное, рамка и значок
     * рации; Надзор из рации (dispatch): тёмно-синее, сверху бирка tag.
     */
    bubble: {
      maxWidth: 240, maxLines: 3, lineH: 13, pad: 4, tail: 4,
      radio: { bg: 'rgba(14,32,26,0.9)', text: '#c9f3d6', rim: '#5fbf8a', icon: '#8fe0b0' },
      dispatch: { bg: 'rgba(14,24,40,0.92)', text: '#c4dcff', rim: '#6aa0e8', icon: '#9cc4ff', tag: 'НАДЗОР', tagFont: '700 8px "Segoe UI", Roboto, Arial, sans-serif', tagBg: '#2c5ea8', tagText: '#e8f0ff' },
      /** Реплики рации важнее обычных: место в раскладке раньше (очки важности). */
      radioScore: 4000,
    },
    terminal: '#ffd36b',
    /** Терминал кодов тревоги в кабинете Коменданта: корпус, рамка, экран по коду. */
    codeTerminal: { case: '#1b2530', rim: '#4f5d6f', screen: { green: '#4fd08a', yellow: '#ffd36b', red: '#ff5b4a' } },
    stun: 'rgba(150,210,255,0.9)',
    /**
     * Подписи над пешками без каши в толпе: подпись, налезающая на уже поставленную (с зазором pad px
     * экрана), сокращается до имени или не рисуется; реплик на экране не больше maxBubbles. Масштаб
     * камеры меньше roleZoom — роли только у важных (игрок, под курсором, тяжелораненый), меньше
     * nameZoom — и имена. Под курсором (ближе hoverRadius px мира) — строка подробностей цвета detailColor.
     */
    labels: { pad: 2, maxBubbles: 7, roleZoom: 1.05, nameZoom: 0.75, hoverRadius: 16, detailColor: 'rgba(225,220,205,0.8)' },
    /**
     * Тяжелораненый: лужа крови под ним, кольцо — сколько осталось (радиус ring px мира), подпись
     * роли — «тяжело ранен · N с»; присевший ниже ростом (CROUCH.squash).
     */
    downed: { blood: 'rgba(120,14,14,0.55)', ring: 'rgba(255,90,70,0.9)', ringBack: 'rgba(0,0,0,0.45)', ringR: 15, label: '#ff8a70', wobble: 0.06 },
  },
  /**
   * Экран игрока: под огнём — тёмные края (alpha × подавление; inner — доля, где затемнение
   * начинается), тяжело ранен — красные края и надпись по центру.
   */
  suppressVignette: { inner: 0.18, color: '8,8,10', alpha: 0.85 },
  downedScreen: { inner: 0.1, color: '70,0,0', alpha: 0.75, font: '700 22px "Segoe UI", Roboto, Arial, sans-serif', hintFont: '500 13px "Segoe UI", Roboto, Arial, sans-serif', text: '#ffb3a6', hint: 'rgba(255,230,220,0.85)' },
  effects: {
    /** Люк в городе (крышка) и в канализации (лестница, свет сверху). */
    hatchCover: '#2b2e30',
    hatchRim: 'rgba(170,175,180,0.55)',
    hatchLadder: 'rgba(190,170,120,0.8)',
    hatchLight: 'rgba(255,240,190,0.10)',
    /** Узел Протектората (терминал): цел — голубой огонёк, саботирован — искры. */
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
    /** Деревья в садах особняков (обстановка комнат — config/furniture.ts). */
    furniture: { tree: ['#2f4a2a', '#3f6236'] as readonly string[], treeShade: 'rgba(0,0,0,0.3)' },
    /** Фонарь на проспекте: столб у стены, кронштейн, плафон и пятно света (спрайт). */
    lamp: { post: '#26292e', arm: '#3a3e45', head: '#f3ecc9', rim: '#15171a', glow: '255,232,170', glowRadius: 72, glowAlpha: 0.3 },
    /** Доска объявлений на стене и дымок курящего. */
    board: { frame: '#3b2f25', paper: '#d9d3c2' },
    /** Клетка для партизан в кабинете Коменданта: рама, прутья (шаг px мира), вскрытая — дверца настежь. */
    /** Оцепление места преступления: лента (жёлтая с чёрными полосами, толщина и шаг px мира), конусы. */
    /** Растяжка: граната (осколочная / зажигательная), проволока, мигающий огонёк взведённой. */
    mine: { frag: '#4a5238', fire: '#7a2a1c', rim: '#15171a', wire: 'rgba(210,210,200,0.7)', wireLen: 18, light: '#ff3b2e', r: 4.2 },
    /**
     * Оцепление места преступления: лента (цвет, полосы, толщина, шаг полос, контур, тень), провисание
     * (sag — доля длины, не больше sagMax px), конусы на концах в изометрии (coneW × coneH px, отступ от
     * стены coneInset, лента на высоте coneTape) и козлы для широких улиц (длина доски, шаг, толщина,
     * ширина полос, опоры, тень).
     */
    scene: {
      tape: '#f2cf2a', stripe: '#161616', width: 1.8, dash: 2.2, outline: '#1c1712', tapeShadow: 'rgba(0,0,0,0.28)',
      sag: 0.1, sagMax: 6,
      coneW: 8, coneH: 9, coneInset: 5, coneTape: 7.5, cone: '#ff7a1a', coneDark: '#c9540f', coneStripe: '#f4f4f4', coneBase: '#8a3a0a', coneShadow: 'rgba(0,0,0,0.3)',
      barrierLen: 20, barrierGap: 23, barrierWidth: 3.6, barrierStripe: 2.6, barrierWhite: '#f1efe8', barrierRed: '#d23a2a',
      barrierLeg: '#3a3a3c', barrierShadow: 'rgba(0,0,0,0.3)',
    },
    /** Мешок для тела (px мира): капсула, блик, молния, ручки, бирка, кровь, лужа, тень. */
    bag: {
      w: 34, h: 14, body: '#1d1f22', outline: '#0c0d0e', shine: 'rgba(255,255,255,0.09)', bump: 'rgba(255,255,255,0.05)',
      handle: '#3a3d42', zipTape: '#2c2f33', zip: '#8c8f94', pull: '#b8bdc2', tag: '#e8e2c8', tagInk: '#555048',
      blood: 'rgba(120,10,10,0.85)', bloodShine: 'rgba(255,120,120,0.35)', pool: 'rgba(90,6,6,0.75)', shadow: 'rgba(0,0,0,0.35)',
    },
    /** Планшет медика (px мира): доска, бумага, зажим, строки. */
    notepad: { w: 6, h: 8, board: '#8a6238', paper: '#f6f2e6', clip: '#b8bdc2', ink: 'rgba(40,50,90,0.8)', outline: '#1c1712' },
    /** Решётки камер тюрьмы: рама, прутья, тень проёма; шаг прутьев (px мира). */
    cage: { frame: '#2c2f33', bar: '#5b6068', floor: 'rgba(20,22,26,0.35)', step: 5 },
    smoke: { ember: ['#ff9a3a', '#c9542a'] as readonly string[], puff: 'rgba(200,200,200,0.5)' },
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
    grenadeSmoke: '#8d9296',
    grenadeFire: '#8a2a1e',
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
    /** Сканер Протектората: корпус, линза, пятно света на земле, вспышка «фото». */
    /** Пламя: внешнее, внутреннее, отсвет. */
    flameOuter: '#e8551c',
    flameInner: '#ffd24a',
    flameGlow: 'rgba(255,140,40,0.18)',
    scannerBody: '#5b6572',
    scannerRim: '#2c323a',
    scannerLens: '#9fe0ff',
    scannerLight: 'rgba(170,220,255,0.12)',
    /** Разметка точек D на полу тамбура КПП: у Протектората, у повстанцев, идёт капт. */
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
  /**
   * Пули в полёте: светящийся хвост длиной tail × скорость (px мира на px/с), толщина по классу,
   * цвет: обычная пуля — тёплый (у Протектората — холодный), AR2 — голубой импульс, болт — оранжевый,
   * ракета — корпус и пламя. Взмахи дубинки и ножа — сектор.
   */
  tracers: {
    tail: 0.018,
    width: { melee: 1, blade: 1, pistol: 1.1, magnum: 1.6, smg: 1, rifle: 1.3, pulse: 2, shotgun: 0.8, crossbow: 1.6, sniper: 1.8, launcher: 3 },
    core: '#fff6d8',
    rebel: 'rgba(255,196,110,0.9)',
    combine: 'rgba(170,215,255,0.9)',
    pulse: 'rgba(120,225,255,0.95)',
    pulseCore: '#eafcff',
    bolt: 'rgba(255,120,60,0.95)',
    rocket: '#4f5a44',
    rocketFlame: '#ffb347',
    slash: 'rgba(235,240,245,0.7)',
  },
  /**
   * Частицы (world/Particles.ts; не игровая логика — своя случайность): max на экране; цвета по
   * видам; вспышка у ствола (размер по классу оружия); кровь, искры, пыль от стены; взрыв — вспышка,
   * огненные клубы, дым, осколки, искры и ударная волна (кольцо), отсвет поверх тумана.
   * Тряска экрана: от своего выстрела × shot, от попадания в себя hurt (+ урон × hurtPerDamage);
   * затухает decay в секунду. Маркер попадания у прицела — markerTime с.
   */
  particles: {
    max: 1600,
    colors: {
      spark: '#ffd27a',
      blood: '#8e1212',
      bloodMist: '#a01818',
      smoke: '#707070',
      darkSmoke: '#3a3a3a',
      fire: '#ff8a2a',
      fireCore: '#ffe08a',
      debris: '#2a2622',
      flash: '#fff3c8',
      dust: '#a0978a',
      ember: '#ffcc55',
      energy: '#8fe8ff',
      muzzle: '#ffd98a',
      muzzleCombine: '#bfefff',
      ring: '#fff0d0',
      /** Линии удара в ближнем бою (веер чёрточек от точки попадания). */
      impact: '#fff6e4',
    },
    muzzleSize: { melee: 0, blade: 0, pistol: 5, magnum: 8, smg: 5, rifle: 7, pulse: 7, shotgun: 10, crossbow: 0, sniper: 11, launcher: 14 },
    light: '255,200,120',
    shot: 0.35,
    hurt: 3,
    hurtPerDamage: 0.06,
    decay: 7,
    maxShake: 9,
    markerTime: 0.28,
    marker: 'rgba(255,255,255,0.95)',
    markerKill: 'rgba(255,70,60,0.95)',
    hurtFlash: '200,20,20',
    /** Дымовая завеса: клубов на облако, их цвет. */
    smokePuffs: 16,
    smokeCloud: '185,188,190',
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
  /**
   * Кэш карты (world/MapRenderer): куски по chunk тайлов рисуются в холст на уровне масштаба —
   * ближайшем не меньшем из levels (пикселей холста на пиксель мира); в кэше не больше max кусков
   * (старые уходят), новых — не больше buildPerFrame за кадр.
   */
  mapCache: { chunk: 16, levels: [0.35, 0.5, 0.71, 1, 1.41, 2, 2.83, 4] as readonly number[], max: 160, buildPerFrame: 6 },
  crosshair: 'rgba(255,211,107,0.9)',
  /** Предел пикселей холста: на 4K/HiDPI рендерим в меньшем разрешении ради FPS. */
  maxCanvasPixels: 2560 * 1440,
  maxDpr: 2,
  vignette: 0.5,
} as const;
