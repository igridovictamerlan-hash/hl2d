/**
 * Гражданская одежда по достатку (лист ассетов «Одежда»: нищие, средние, богатые). Только отрисовка —
 * пешка в комплекте (`PawnLook.clothes`) рисуется слоями: низ (майка, рубаха, свитер, платье) → верх
 * (ватник, пиджак, плащ, шуба…) → юбка и длинный подол поверх туловища → шарф, воротник → голова →
 * головной убор и очки. Рисунок — entities/pawnClothes.ts. Цвета — #rrggbb (tint их осветляет и темнит).
 */
export type ClothTier = 'poor' | 'middle' | 'rich';

/** Нижний слой: майка, тельняшка, футболка, рубаха (клетка), свитер (вязка, ромбы), водолазка, блузка, платье. */
export type TopId = 'undershirt' | 'tee' | 'shirt' | 'sweater' | 'turtleneck' | 'blouse' | 'dress';
export type PatternId = 'plain' | 'stripes' | 'plaid' | 'knit' | 'argyle';
/**
 * Верхний слой: ватник (стёганый), рваное пальто, накидка из мешковины, кофта (кардиган), куртка на
 * молнии, пиджак, плащ-тренч, бушлат, тройка (пиджак с жилетом), пальто с меховым воротником, шуба,
 * френч, смокинг.
 */
export type OuterId = 'quilted' | 'ragcoat' | 'sack' | 'cardigan' | 'zip' | 'blazer' | 'trench' | 'peacoat' | 'suit' | 'camel' | 'fur' | 'french' | 'tux';
/** Головной убор: ушанка, вязаная шапка, платок, восьмиклинка, берет, федора, котелок, шляпка-таблетка, цилиндр, капюшон. */
export type HatId = 'ushanka' | 'beanie' | 'kerchief' | 'flatcap' | 'beret' | 'fedora' | 'bowler' | 'pillbox' | 'tophat' | 'hood';
/** На шее: шарф, галстук, бабочка, жемчуг, шаль на плечах, платок, натянутый на лицо (mask — рисуется поверх лица). */
export type NeckId = 'scarf' | 'tie' | 'bow' | 'pearls' | 'shawl' | 'mask';

export interface ClothesLook {
  tier: ClothTier;
  top: TopId;
  topColor: string;
  pattern?: PatternId;
  /** Второй цвет узора (полоски, клетка, ромбы, вязка). */
  pattern2?: string;
  outer?: OuterId;
  outerColor?: string;
  /** Отделка верха: мех воротника, атлас лацканов, пуговицы, жилет тройки. */
  trim?: string;
  /** Брюки (низ туловища ниже ремня); нет — по достатку (CLOTHES.pants). */
  pants?: string;
  /** Юбка (у платья — его цвет, иначе отдельная юбка под верхом). */
  skirt?: string;
  hat?: HatId;
  hatColor?: string;
  /** Отделка убора: лента, помпон, перо, горох платка. */
  hatTrim?: string;
  neck?: NeckId;
  neckColor?: string;
  /** Обувь (ступни): валенки, ботинки, лакированные туфли. */
  boots?: string;
  /** Поношенность: заплаты (их цвета), дыры, пятна, рваный подол. */
  patches?: string[];
  holes?: number;
  stains?: number;
  frayed?: boolean;
  /** Мелочи: верёвка вместо ремня, подтяжки, фартук, часы на цепочке, платок в кармане, брошь, очки, медали. */
  rope?: boolean;
  suspenders?: string;
  apron?: string;
  watch?: boolean;
  pocket?: string;
  brooch?: string;
  glasses?: boolean;
  medals?: boolean;
}

/** Комплект листа: код (Н1, С1, Б1…), название, описание, зерно внешности (кожа, волосы; причёска — по seed >>> 13). */
export interface ClothesSet {
  code: string;
  name: string;
  desc: string;
  seed: number;
  look: ClothesLook;
}

export const CLOTHES = {
  /** Цвета мелочей: нитки заплат, дыры, пятна, золото часов и пуговиц, стекло очков, жемчуг. */
  detail: {
    thread: '#a89a7c',
    hole: '#1e1a17',
    holeRim: 'rgba(0,0,0,0.35)',
    stain: 'rgba(58,44,30,0.28)',
    gold: '#d9b24a',
    silver: '#c3c8cf',
    lens: 'rgba(200,225,240,0.35)',
    frame: '#2a2622',
    pearl: '#efeae0',
    rope: '#a08a5c',
    fur: 'rgba(255,255,255,0.22)',
    furDark: 'rgba(0,0,0,0.22)',
    satin: 'rgba(255,255,255,0.28)',
    veil: 'rgba(20,20,24,0.55)',
    medal: ['#b8322a', '#2c5aa0', '#d9b24a'],
  },
  /** Брюки по умолчанию по достатку. */
  pants: { poor: '#4a4440', middle: '#3a3d44', rich: '#1e1f24' } as Record<ClothTier, string>,
  /** Палитры по достатку — из них собраны комплекты; пригодятся ателье и раздаче одежды NPC. */
  palettes: {
    poor: ['#5f5a4c', '#6b5d48', '#4f544a', '#706a5e', '#57493b', '#7a7468', '#4a4440', '#8a7b60'],
    middle: ['#3e4f66', '#5b6b4a', '#8a6a3e', '#7c3f34', '#4a5a5e', '#9a8a68', '#2f3c4c', '#6b4f6a'],
    rich: ['#2a2b30', '#6e1f2a', '#c2a37a', '#1f3a34', '#e8e2d4', '#3a2a48', '#7a5a2a', '#141518'],
  } as Record<ClothTier, string[]>,
  tierNames: { poor: 'Нищие', middle: 'Средние', rich: 'Богатые' } as Record<ClothTier, string>,
  tierNotes: {
    poor: 'Выцветшее, бурое и серое; заплаты, дыры, пятна, рваные подолы, верёвка вместо ремня, валенки.',
    middle: 'Приглушённые, но чистые цвета; рабочая и конторская одежда, вязаное, кепки и береты.',
    rich: 'Глубокие цвета, мех, атлас, золото; длинные пальто, тройки, шляпы, жемчуг и броши.',
  } as Record<ClothTier, string>,
  sets: [
    // ——— Нищие ———
    { code: 'Н1', name: 'Ватник', seed: 1884811, desc: 'Стёганая телогрейка, ушанка, валенки; заплата на груди.',
      look: { tier: 'poor', top: 'sweater', topColor: '#5a5650', outer: 'quilted', outerColor: '#4f5648', hat: 'ushanka', hatColor: '#5e5246', hatTrim: '#7a6a58', boots: '#6a6662', patches: ['#6b5d48'], stains: 1 } },
    { code: 'Н2', name: 'Рваное пальто', seed: 3850932, desc: 'Длинное бурое пальто с рваным подолом, верёвка вместо ремня, шапка с дырой, шарф-обмотка.',
      look: { tier: 'poor', top: 'sweater', topColor: '#4a4440', outer: 'ragcoat', outerColor: '#6b5a44', hat: 'beanie', hatColor: '#5a5d52', boots: '#3a322c', neck: 'scarf', neckColor: '#7a4a3a', rope: true, frayed: true, holes: 2, stains: 2, patches: ['#4f544a'] } },
    { code: 'Н3', name: 'Обноски', seed: 3850938, desc: 'Растянутый свитер в дырах и пятнах, заплаты, линялая кепка.',
      look: { tier: 'poor', top: 'sweater', topColor: '#706a5e', pattern: 'knit', pattern2: '#5f594e', hat: 'flatcap', hatColor: '#57493b', boots: '#3b3029', holes: 3, stains: 2, patches: ['#8a7b60', '#4f544a'] } },
    { code: 'Н4', name: 'Платок', seed: 5735104, desc: 'Платок в горох, вязаная кофта поверх платья, заштопанный фартук.',
      look: { tier: 'poor', top: 'dress', topColor: '#5f5a4c', skirt: '#5f5a4c', outer: 'cardigan', outerColor: '#6e5a4a', hat: 'kerchief', hatColor: '#7a3e36', hatTrim: '#d8cfb8', apron: '#8a8272', boots: '#3b3029', patches: ['#57493b'], stains: 1, frayed: true } },
    { code: 'Н5', name: 'Мешковина', seed: 3850950, desc: 'Накидка из мешковины поверх тельняшки, обмотки, голова не покрыта.',
      look: { tier: 'poor', top: 'undershirt', topColor: '#d8d2c2', pattern: 'stripes', pattern2: '#3e4a5c', outer: 'sack', outerColor: '#8a7b5a', boots: '#6b5d48', rope: true, frayed: true, holes: 1, stains: 2 } },
    { code: 'Н6', name: 'Тельняшка', seed: 1884939, desc: 'Майка-тельняшка с прорехой, подтяжки, вязаная шапка; ботинки на верёвках.',
      look: { tier: 'poor', top: 'undershirt', topColor: '#e2ddd0', pattern: 'stripes', pattern2: '#2f3c52', suspenders: '#4a3a2c', hat: 'beanie', hatColor: '#4a4440', boots: '#3a322c', holes: 2, stains: 1 } },
    // ——— Средние ———
    { code: 'С1', name: 'Рабочий', seed: 1884818, desc: 'Куртка на молнии, водолазка, восьмиклинка.',
      look: { tier: 'middle', top: 'turtleneck', topColor: '#2f3c4c', outer: 'zip', outerColor: '#5b6b4a', hat: 'flatcap', hatColor: '#4a4238', boots: '#4a3a2c' } },
    { code: 'С2', name: 'Служащий', seed: 1884852, desc: 'Серый пиджак, рубашка, галстук, очки.',
      look: { tier: 'middle', top: 'shirt', topColor: '#e4e2da', outer: 'blazer', outerColor: '#5a6068', neck: 'tie', neckColor: '#7c3f34', glasses: true, boots: '#2c2622' } },
    { code: 'С3', name: 'Кардиган', seed: 7373498, desc: 'Кардиган на пуговицах, блузка с воротничком, юбка, берет.',
      look: { tier: 'middle', top: 'blouse', topColor: '#ece6d6', outer: 'cardigan', outerColor: '#8a6a3e', skirt: '#3e4f66', hat: 'beret', hatColor: '#7c3f34', boots: '#3a2e26' } },
    { code: 'С4', name: 'Плащ', seed: 1884850, desc: 'Бежевый плащ-тренч с поясом, клетчатый шарф, шляпа.',
      look: { tier: 'middle', top: 'shirt', topColor: '#d8d6cc', outer: 'trench', outerColor: '#9a8a68', trim: '#6b5a3e', neck: 'scarf', neckColor: '#7c3f34', hat: 'fedora', hatColor: '#4a4238', hatTrim: '#2a2622', boots: '#3a2e26' } },
    { code: 'С5', name: 'Свитер с узором', seed: 3850936, desc: 'Свитер с ромбами, шапка с помпоном, рубашка под горло.',
      look: { tier: 'middle', top: 'sweater', topColor: '#4a5a5e', pattern: 'argyle', pattern2: '#c9a86a', hat: 'beanie', hatColor: '#7c3f34', hatTrim: '#ece6d6', boots: '#3b3029' } },
    { code: 'С6', name: 'Бушлат', seed: 1884869, desc: 'Двубортный тёмно-синий бушлат, вязаная шапка, шарф.',
      look: { tier: 'middle', top: 'turtleneck', topColor: '#3a3a3e', outer: 'peacoat', outerColor: '#2f3c4c', trim: '#b9b0a0', hat: 'beanie', hatColor: '#3a3a3e', neck: 'scarf', neckColor: '#5b6b4a', boots: '#24211e' } },
    // ——— Богатые ———
    { code: 'Б1', name: 'Тройка', seed: 1884825, desc: 'Угольная тройка: жилет, часы на цепочке, платок в кармане, федора с лентой.',
      look: { tier: 'rich', top: 'shirt', topColor: '#f2efe6', outer: 'suit', outerColor: '#2a2b30', trim: '#3a3b42', neck: 'tie', neckColor: '#6e1f2a', pocket: '#e8e2d4', watch: true, hat: 'fedora', hatColor: '#2a2420', hatTrim: '#6e1f2a', boots: '#111214' } },
    { code: 'Б2', name: 'Пальто с мехом', seed: 1884971, desc: 'Длинное верблюжье пальто с меховым воротником, шарф, котелок.',
      look: { tier: 'rich', top: 'turtleneck', topColor: '#2a2b30', outer: 'camel', outerColor: '#c2a37a', trim: '#5a4434', neck: 'scarf', neckColor: '#1f3a34', hat: 'bowler', hatColor: '#1c1c20', hatTrim: '#3a3a3e', boots: '#111214' } },
    { code: 'Б3', name: 'Шуба', seed: 7373477, desc: 'Пушистая шуба, шляпка-таблетка с пером и вуалью, жемчуг.',
      look: { tier: 'rich', top: 'dress', topColor: '#3a2a48', skirt: '#3a2a48', outer: 'fur', outerColor: '#7a5a3e', hat: 'pillbox', hatColor: '#3a2a48', hatTrim: '#e8e2d4', neck: 'pearls', boots: '#141518' } },
    { code: 'Б4', name: 'Платье', seed: 5735118, desc: 'Бордовое платье с поясом, шаль на плечах, брошь.',
      look: { tier: 'rich', top: 'dress', topColor: '#6e1f2a', skirt: '#6e1f2a', neck: 'shawl', neckColor: '#c9b48a', brooch: '#d9b24a', boots: '#141518' } },
    { code: 'Б5', name: 'Френч лоялиста', seed: 1884856, desc: 'Тёмно-зелёный френч со стойкой, золотые пуговицы, планки наград.',
      look: { tier: 'rich', top: 'shirt', topColor: '#e8e2d4', outer: 'french', outerColor: '#1f3a34', trim: '#d9b24a', medals: true, hat: 'beret', hatColor: '#1c2a26', boots: '#111214', glasses: true } },
    { code: 'Б6', name: 'Вечерний', seed: 1885011, desc: 'Смокинг с атласными лацканами, бабочка, цилиндр.',
      look: { tier: 'rich', top: 'shirt', topColor: '#f6f4ee', outer: 'tux', outerColor: '#141518', trim: '#2c2d33', neck: 'bow', neckColor: '#141518', hat: 'tophat', hatColor: '#141518', hatTrim: '#3a2a48', pocket: '#f6f4ee', boots: '#0d0e10' } },
  ] as ClothesSet[],
  /**
   * Каталог вещей (Gear: слоты одежды, предметы `cl_<фасон>_<цвет>`): фасон — слот, название (им. падеж), «в чём» для
   * ориентировки (предложный: «в ватнике»), достаток, цена в токенах, кто носит (f — женское, m — мужское), что фасон
   * даёт комплекту (`piece`), какие поля красит цвет (`paint`) и цвета `[слаг, название, #rrggbb]` (слаг — в id предмета,
   * не менять: на нём держатся сохранения). Вещь надевается в свой слот, комплект пешки собирается из надетого
   * (systems/Gear.clothesOf).
   */
  fashions: [
    // ——— Головные уборы ———
    { id: 'ushanka', slot: 'hat', name: 'Ушанка', worn: 'ушанке', tier: 'poor', price: 9, piece: { hat: 'ushanka' }, paint: ['hatColor'],
      colors: [['bur', 'бурый мех', '#5e5246'], ['seryj', 'серый мех', '#6a6660'], ['chern', 'чёрный мех', '#2e2a28']] },
    { id: 'beanie', slot: 'hat', name: 'Вязаная шапка', worn: 'вязаной шапке', tier: 'poor', price: 4, piece: { hat: 'beanie' }, paint: ['hatColor'],
      colors: [['sazha', 'сажа', '#3a3a3e'], ['moh', 'мох', '#5a5d52'], ['glina', 'глина', '#7a5a46'], ['pepel', 'пепел', '#6e6a62']] },
    { id: 'pompom', slot: 'hat', name: 'Шапка с помпоном', worn: 'шапке с помпоном', tier: 'middle', price: 11, piece: { hat: 'beanie', hatTrim: '#ece6d6' }, paint: ['hatColor'],
      colors: [['kirpich', 'кирпич', '#7c3f34'], ['indigo', 'индиго', '#2f3c58'], ['gorch', 'горчица', '#a8873a'], ['izumr', 'изумруд', '#2f5a4a']] },
    { id: 'kerchief', slot: 'hat', name: 'Платок', worn: 'платке', tier: 'poor', price: 5, who: 'f', piece: { hat: 'kerchief', hatTrim: '#d8cfb8' }, paint: ['hatColor'],
      colors: [['vishnya', 'вишня', '#7a3e36'], ['vasilek', 'василёк', '#3e5a86'], ['len', 'лён', '#a89c80'], ['olive', 'олива', '#5b6b4a']] },
    { id: 'flatcap', slot: 'hat', name: 'Восьмиклинка', worn: 'кепке', tier: 'middle', price: 12, who: 'm', piece: { hat: 'flatcap' }, paint: ['hatColor'],
      colors: [['tvid', 'твид', '#57493b'], ['grafit', 'графит', '#3b4048'], ['pesok', 'песок', '#8a7b60'], ['moh', 'мох', '#4f5648']] },
    { id: 'beret', slot: 'hat', name: 'Берет', worn: 'берете', tier: 'middle', price: 15, piece: { hat: 'beret' }, paint: ['hatColor'],
      colors: [['bordo', 'бордо', '#7c3f34'], ['sazha', 'сажа', '#24262a'], ['butyl', 'бутылка', '#1c2a26'], ['slyva', 'слива', '#4a3348']] },
    { id: 'fedora', slot: 'hat', name: 'Федора', worn: 'шляпе', tier: 'rich', price: 55, who: 'm', piece: { hat: 'fedora' }, paint: ['hatColor'],
      colors: [['mokko', 'мокко', '#4a3a2e'], ['antr', 'антрацит', '#2a2420'], ['pesok', 'песок', '#8a7b60'], ['grafit', 'графит', '#3a3d44']] },
    { id: 'bowler', slot: 'hat', name: 'Котелок', worn: 'котелке', tier: 'rich', price: 50, who: 'm', piece: { hat: 'bowler' }, paint: ['hatColor'],
      colors: [['sazha', 'сажа', '#1c1c20'], ['shokolad', 'шоколад', '#3a2a22'], ['grafit', 'графит', '#33363c']] },
    { id: 'pillbox', slot: 'hat', name: 'Шляпка с вуалью', worn: 'шляпке с вуалью', tier: 'rich', price: 65, who: 'f', piece: { hat: 'pillbox', hatTrim: '#e8e2d4' }, paint: ['hatColor'],
      colors: [['slyva', 'слива', '#3a2a48'], ['bordo', 'бордо', '#6e1f2a'], ['sazha', 'сажа', '#1c1c20'], ['izumr', 'изумруд', '#1f3a34']] },
    { id: 'tophat', slot: 'hat', name: 'Цилиндр', worn: 'цилиндре', tier: 'rich', price: 90, who: 'm', piece: { hat: 'tophat', hatTrim: '#3a2a48' }, paint: ['hatColor'],
      colors: [['sazha', 'сажа', '#141518'], ['grafit', 'графит', '#2c2e34']] },
    // ——— Верхняя одежда ———
    { id: 'quilted', slot: 'outer', name: 'Ватник', worn: 'ватнике', tier: 'poor', price: 12, piece: { outer: 'quilted', patches: ['#6b5d48'] }, paint: ['outerColor'],
      colors: [['olive', 'олива', '#4f5648'], ['sazha', 'сажа', '#3a3a3a'], ['haki', 'хаки', '#5f5a44'], ['sin', 'синька', '#3e4652']] },
    { id: 'ragcoat', slot: 'outer', name: 'Рваное пальто', worn: 'рваном пальто', tier: 'poor', price: 7, piece: { outer: 'ragcoat', frayed: true, holes: 2, stains: 1, patches: ['#4f544a'] }, paint: ['outerColor'],
      colors: [['bur', 'бурый', '#6b5a44'], ['pepel', 'пепел', '#5f5a50'], ['glina', 'глина', '#6e5040']] },
    { id: 'sack', slot: 'outer', name: 'Накидка из мешковины', worn: 'накидке из мешковины', tier: 'poor', price: 3, piece: { outer: 'sack', frayed: true, rope: true, stains: 1 }, paint: ['outerColor'],
      colors: [['meshok', 'мешок', '#8a7b5a'], ['lyon', 'лён', '#9a8e6e']] },
    { id: 'cardigan', slot: 'outer', name: 'Кофта', worn: 'кофте', tier: 'middle', price: 16, piece: { outer: 'cardigan' }, paint: ['outerColor'],
      colors: [['ohra', 'охра', '#8a6a3e'], ['seraya', 'пепел', '#6e5a4a'], ['vishnya', 'вишня', '#6a3438'], ['olive', 'олива', '#5b6b4a']] },
    { id: 'zip', slot: 'outer', name: 'Куртка на молнии', worn: 'куртке', tier: 'middle', price: 22, piece: { outer: 'zip' }, paint: ['outerColor'],
      colors: [['olive', 'олива', '#5b6b4a'], ['indigo', 'индиго', '#33405a'], ['kirpich', 'кирпич', '#7c3f34'], ['grafit', 'графит', '#3e4148']] },
    { id: 'peacoat', slot: 'outer', name: 'Бушлат', worn: 'бушлате', tier: 'middle', price: 30, piece: { outer: 'peacoat', trim: '#b9b0a0' }, paint: ['outerColor'],
      colors: [['flot', 'флот', '#2f3c4c'], ['sazha', 'сажа', '#2a2b30'], ['butyl', 'бутылка', '#24382f']] },
    { id: 'trench', slot: 'outer', name: 'Плащ-тренч', worn: 'плаще', tier: 'middle', price: 32, piece: { outer: 'trench' }, paint: ['outerColor'],
      colors: [['bezh', 'беж', '#9a8a68'], ['olive', 'олива', '#6b6a48'], ['grafit', 'графит', '#4a4c50'], ['mokko', 'мокко', '#6a5a46']] },
    { id: 'blazer', slot: 'outer', name: 'Пиджак', worn: 'пиджаке', tier: 'middle', price: 28, piece: { outer: 'blazer' }, paint: ['outerColor'],
      colors: [['stal', 'сталь', '#5a6068'], ['tvid', 'твид', '#6a5a46'], ['indigo', 'индиго', '#2f3c58'], ['mokko', 'мокко', '#4a3a2e']] },
    { id: 'suit', slot: 'outer', name: 'Костюм-тройка', worn: 'костюме-тройке', tier: 'rich', price: 85, who: 'm', piece: { outer: 'suit', watch: true }, paint: ['outerColor'],
      colors: [['ugol', 'уголь', '#2a2b30'], ['flot', 'флот', '#232a3a'], ['mokko', 'мокко', '#3a2e26'], ['stal', 'сталь', '#4a4e56']] },
    { id: 'camel', slot: 'outer', name: 'Пальто с мехом', worn: 'пальто с мехом', tier: 'rich', price: 95, piece: { outer: 'camel', trim: '#5a4434' }, paint: ['outerColor'],
      colors: [['kemel', 'кэмел', '#c2a37a'], ['ugol', 'уголь', '#3a3b42'], ['bordo', 'бордо', '#5e2228'], ['olive', 'олива', '#5e6248']] },
    { id: 'fur', slot: 'outer', name: 'Шуба', worn: 'шубе', tier: 'rich', price: 140, who: 'f', piece: { outer: 'fur' }, paint: ['outerColor'],
      colors: [['norka', 'норка', '#7a5a3e'], ['sobol', 'соболь', '#4a3a30'], ['pesec', 'песец', '#cfc8ba']] },
    { id: 'french', slot: 'outer', name: 'Френч', worn: 'френче', tier: 'rich', price: 80, who: 'm', piece: { outer: 'french', trim: '#d9b24a' }, paint: ['outerColor'],
      colors: [['butyl', 'бутылка', '#1f3a34'], ['ugol', 'уголь', '#24262a'], ['haki', 'хаки', '#4e5236']] },
    { id: 'tux', slot: 'outer', name: 'Смокинг', worn: 'смокинге', tier: 'rich', price: 110, who: 'm', piece: { outer: 'tux', trim: '#2c2d33' }, paint: ['outerColor'],
      colors: [['sazha', 'сажа', '#141518'], ['polnoch', 'полночь', '#161b2c']] },
    // ——— Низ: рубахи, свитера, платья ———
    { id: 'undershirt', slot: 'top', name: 'Майка', worn: 'майке', tier: 'poor', price: 3, who: 'm', piece: { top: 'undershirt' }, paint: ['topColor'],
      colors: [['moloko', 'молоко', '#ddd8ca'], ['pepel', 'пепел', '#9a958a']] },
    { id: 'telnyashka', slot: 'top', name: 'Тельняшка', worn: 'тельняшке', tier: 'poor', price: 6, who: 'm', piece: { top: 'undershirt', topColor: '#e2ddd0', pattern: 'stripes' }, paint: ['pattern2'],
      colors: [['sinyaya', 'синяя полоса', '#2f3c52'], ['chernaya', 'чёрная полоса', '#2a2a2e']] },
    { id: 'tee', slot: 'top', name: 'Футболка', worn: 'футболке', tier: 'poor', price: 5, piece: { top: 'tee' }, paint: ['topColor'],
      colors: [['pepel', 'пепел', '#7a7468'], ['olive', 'олива', '#5b6248'], ['moloko', 'молоко', '#cfcabc'], ['sin', 'синька', '#4a5666']] },
    { id: 'sweater', slot: 'top', name: 'Свитер грубой вязки', worn: 'свитере', tier: 'poor', price: 9, piece: { top: 'sweater', pattern: 'knit' }, paint: ['topColor'],
      colors: [['pepel', 'пепел', '#706a5e'], ['bur', 'бурый', '#5f5246'], ['moh', 'мох', '#565c4c'], ['sazha', 'сажа', '#3e3e42']] },
    { id: 'chintz', slot: 'top', name: 'Ситцевое платье', worn: 'ситцевом платье', tier: 'poor', price: 9, who: 'f', piece: { top: 'dress', apron: '#8a8272' }, paint: ['topColor', 'skirt'],
      colors: [['vasilek', 'василёк', '#4e5a72'], ['pepel', 'пепел', '#5f5a4c'], ['vishnya', 'вишня', '#6a3e3a']] },
    { id: 'shirt', slot: 'top', name: 'Рубашка', worn: 'рубашке', tier: 'middle', price: 12, piece: { top: 'shirt' }, paint: ['topColor'],
      colors: [['moloko', 'молоко', '#e4e2da'], ['nebo', 'небо', '#b8c6d6'], ['len', 'лён', '#d8ccb0'], ['grafit', 'графит', '#4a4e56']] },
    { id: 'plaid', slot: 'top', name: 'Рубашка в клетку', worn: 'клетчатой рубашке', tier: 'middle', price: 14, piece: { top: 'shirt', pattern: 'plaid', pattern2: '#2a2622' }, paint: ['topColor'],
      colors: [['kirpich', 'кирпич', '#8a4a3a'], ['olive', 'олива', '#5e6a48'], ['indigo', 'индиго', '#3e4a6a']] },
    { id: 'argyle', slot: 'top', name: 'Свитер с ромбами', worn: 'свитере с ромбами', tier: 'middle', price: 20, piece: { top: 'sweater', pattern: 'argyle', pattern2: '#c9a86a' }, paint: ['topColor'],
      colors: [['volna', 'волна', '#4a5a5e'], ['bordo', 'бордо', '#5e2a2e'], ['olive', 'олива', '#56603f']] },
    { id: 'turtleneck', slot: 'top', name: 'Водолазка', worn: 'водолазке', tier: 'middle', price: 15, piece: { top: 'turtleneck' }, paint: ['topColor'],
      colors: [['sazha', 'сажа', '#2f3034'], ['flot', 'флот', '#2f3c4c'], ['slivki', 'сливки', '#d8d0bc'], ['bordo', 'бордо', '#5a2a30']] },
    { id: 'blouse', slot: 'top', name: 'Блузка', worn: 'блузке', tier: 'middle', price: 14, who: 'f', piece: { top: 'blouse' }, paint: ['topColor'],
      colors: [['slivki', 'сливки', '#ece6d6'], ['nebo', 'небо', '#c4d0dc'], ['roza', 'пудра', '#dcc0c0']] },
    { id: 'dress', slot: 'top', name: 'Платье', worn: 'платье', tier: 'middle', price: 26, who: 'f', piece: { top: 'dress' }, paint: ['topColor', 'skirt'],
      colors: [['indigo', 'индиго', '#3e4f66'], ['vishnya', 'вишня', '#6e3038'], ['olive', 'олива', '#5b6b4a'], ['gorch', 'горчица', '#9a7a3a']] },
    { id: 'gown', slot: 'top', name: 'Вечернее платье', worn: 'вечернем платье', tier: 'rich', price: 95, who: 'f', piece: { top: 'dress', brooch: '#d9b24a' }, paint: ['topColor', 'skirt'],
      colors: [['bordo', 'бордо', '#6e1f2a'], ['slyva', 'слива', '#3a2a48'], ['izumr', 'изумруд', '#1f4a3a'], ['sazha', 'сажа', '#18181c']] },
    // ——— Блатное (crook: горожанам Гардероб не выдаёт, NPC-горожане не покупают; продаётся в ателье) ———
    { id: 'hood', slot: 'hat', name: 'Капюшон', worn: 'капюшоне', tier: 'poor', price: 6, crook: true, piece: { hat: 'hood' }, paint: ['hatColor'],
      colors: [['grafit', 'графит', '#2e3137'], ['sazha', 'сажа', '#1f2024'], ['moh', 'мох', '#3e4436'], ['bur', 'бурый', '#4a3c30']] },
    { id: 'facemask', slot: 'neck', name: 'Платок на лицо', worn: 'платке на лице', tier: 'poor', price: 3, crook: true, piece: { neck: 'mask' }, paint: ['neckColor'],
      colors: [['chern', 'чёрный', '#1d1d1f'], ['kras', 'красный', '#7a2222'], ['sin', 'синий', '#2a3550'], ['pesok', 'песок', '#8a7a5a'], ['zel', 'зелёный', '#2f4a32']] },
    // ——— На шее ———
    { id: 'scarf', slot: 'neck', name: 'Шарф', worn: 'шарфе', tier: 'poor', price: 5, piece: { neck: 'scarf' }, paint: ['neckColor'],
      colors: [['kirpich', 'кирпич', '#7a4a3a'], ['moh', 'мох', '#5b6b4a'], ['pepel', 'пепел', '#6e6a62'], ['indigo', 'индиго', '#3a4a6a']] },
    { id: 'tie', slot: 'neck', name: 'Галстук', worn: 'галстуке', tier: 'middle', price: 9, who: 'm', piece: { neck: 'tie' }, paint: ['neckColor'],
      colors: [['bordo', 'бордо', '#6e1f2a'], ['flot', 'флот', '#2a3550'], ['gorch', 'горчица', '#a8873a']] },
    { id: 'shawl', slot: 'neck', name: 'Шаль', worn: 'шали', tier: 'middle', price: 18, who: 'f', piece: { neck: 'shawl' }, paint: ['neckColor'],
      colors: [['zoloto', 'старое золото', '#c9b48a'], ['vishnya', 'вишня', '#7a3e46'], ['grafit', 'графит', '#4a4c52']] },
    { id: 'bow', slot: 'neck', name: 'Бабочка', worn: 'бабочке', tier: 'rich', price: 25, who: 'm', piece: { neck: 'bow' }, paint: ['neckColor'],
      colors: [['sazha', 'сажа', '#141518'], ['bordo', 'бордо', '#6e1f2a']] },
    { id: 'pearls', slot: 'neck', name: 'Жемчужное ожерелье', worn: 'жемчуге', tier: 'rich', price: 75, who: 'f', piece: { neck: 'pearls' }, paint: [],
      colors: [['zhemchug', 'жемчуг', '#efeae0']] },
    // ——— Обувь ———
    { id: 'valenki', slot: 'feet', name: 'Валенки', worn: 'валенках', tier: 'poor', price: 6, piece: {}, paint: ['boots'],
      colors: [['seryj', 'серые', '#6a6662'], ['chern', 'чёрные', '#3a3634']] },
    { id: 'boots', slot: 'feet', name: 'Ботинки', worn: 'ботинках', tier: 'middle', price: 12, piece: {}, paint: ['boots'],
      colors: [['bur', 'бурые', '#4a3a2c'], ['chern', 'чёрные', '#24211e']] },
    { id: 'shoes', slot: 'feet', name: 'Лакированные туфли', worn: 'лакированных туфлях', tier: 'rich', price: 40, piece: {}, paint: ['boots'],
      colors: [['chern', 'чёрные', '#111214'], ['vishnya', 'вишнёвые', '#3a1418']] },
  ] as readonly ClothFashion[],
  /** Достаток → слово для подсказок («для бедных», …). */
  tierWord: { poor: 'дёшево', middle: 'добротно', rich: 'дорого' } as Record<ClothTier, string>,
  /** Нет низа под верхом — футболка такого цвета; брюки — CLOTHES.pants. */
  defaultTop: '#8a8478',
  /**
   * Ателье (лавки проспекта, ARBAT.stock): какие фасоны (по достатку) и сколько первых цветов каждого. «Ателье» — в
   * Старом городе у площади: бедное и среднее; «Салон Верхнего города» — среднее и богатое. На полке — perItem штук вещи.
   */
  shops: {
    tailor: { poor: 2, middle: 2 },
    tailor_up: { middle: 1, rich: 3 },
  } as Record<string, Partial<Record<ClothTier, number>>>,
  perItem: 2,
  /**
   * Подвоз: ящик «одежда» в грузе барж (вес weight среди SUPPLY.manifest) — crate вещей одного фасона и цвета из
   * ассортимента ателье; на складе ТС — до crate × SUPPLY.warehouse.crates каждой, при старте — start штук каждой.
   */
  supply: { weight: 3, crate: 3, start: 2 },
  /**
   * Горожане одеты по достатку дома (Слобода — poor, Старый город — middle, Верхний город и особняки — rich): верх с
   * шансом outer (зимнего нет — у бедных чаще), убор — hat, шарф/галстук — neck; лоялисты на ступень богаче с шансом
   * loyalUp. В ателье NPC покупает вещь своего достатка или дешевле, если после покупки останется reserve токенов, и
   * сразу надевает (старая выброшена). Лоялиста узнают по фиолетовой повязке (LOYALTY.uniform.color). Одеты горожане
   * профессий professions (без профессии — тоже); у отбросов и беглецов — своя одежда.
   * Бандиты, авторитеты и воры (crooks) — тоже в одежде каталога, каждый по-своему: достаток — из tiers наугад (не по
   * дому: общага у банды одна), с шансом hood — капюшон вместо убора, mask — платок на лице; повязка банды на рукаве.
   */
  npc: { professions: ['citizen', 'bandit', 'gang_boss', 'thief'] as readonly string[],
    crooks: {
      bandit: { tiers: ['poor', 'poor', 'middle'], hood: 0.25, mask: 0.4 },
      gang_boss: { tiers: ['middle', 'rich', 'rich'], hood: 0, mask: 0 },
      thief: { tiers: ['poor', 'middle'], hood: 0.6, mask: 0.15 },
    } as Record<string, { tiers: readonly ClothTier[]; hood: number; mask: number }>, outer: { poor: 0.75, middle: 0.6, rich: 0.85 }, hat: { poor: 0.7, middle: 0.45, rich: 0.6 }, neck: { poor: 0.25, middle: 0.4, rich: 0.6 }, loyalUp: 0.5, reserve: 15 },
};

/** Слот одежды (Gear): головной убор, верх, низ, шея, обувь. */
export type ClothSlot = 'hat' | 'outer' | 'top' | 'neck' | 'feet';
export const CLOTH_SLOTS: readonly ClothSlot[] = ['hat', 'outer', 'top', 'neck', 'feet'];

/** Фасон каталога (см. CLOTHES.fashions). */
export interface ClothFashion {
  id: string;
  slot: ClothSlot;
  name: string;
  worn: string;
  tier: ClothTier;
  price: number;
  who?: 'f' | 'm';
  /** Блатная вещь (капюшон, платок на лицо): горожанам не выдаётся. */
  crook?: boolean;
  piece: Partial<ClothesLook>;
  paint: readonly (keyof ClothesLook)[];
  colors: readonly (readonly [string, string, string])[];
}

/** Вещь каталога: фасон и цвет; id предмета — `cl_<фасон>_<слаг цвета>`. */
export interface ClothItem {
  id: `cl_${string}`;
  fashion: ClothFashion;
  color: readonly [string, string, string];
  /** Что вещь даёт комплекту: части фасона + цвет в полях paint. */
  piece: Partial<ClothesLook>;
}

/** Все вещи каталога (фасон × цвет) по порядку. */
export const CLOTH_ITEMS: readonly ClothItem[] = CLOTHES.fashions.flatMap((f) =>
  f.colors.map((col) => {
    const piece: Partial<ClothesLook> = { ...f.piece };
    for (const k of f.paint) (piece as Record<string, unknown>)[k] = col[2];
    return { id: `cl_${f.id}_${col[0]}` as const, fashion: f, color: col, piece };
  }),
);

/** Ассортимент ателье: фасоны его достатков, у каждого — первые n цветов (по порядку каталога). */
export function atelierStock(sub: string): `cl_${string}`[] {
  const want = CLOTHES.shops[sub];
  if (!want) return [];
  return CLOTH_ITEMS.filter((it) => it.fashion.colors.indexOf(it.color) < (want[it.fashion.tier] ?? 0)).map((it) => it.id);
}


/**
 * Оперативник в штатском (SU.01, следователь): не броня спецназа, а гражданское — кожанка, плащ или пиджак, рубашка
 * с галстуком или водолазка, кепка или шляпа. Комплект — по внешности (seed), ключ кэша спрайтов — `op<номер>`.
 */
export const PLAINCLOTHES: readonly ClothesLook[] = [
  { tier: 'middle', top: 'shirt', topColor: '#6f7a86', outer: 'zip', outerColor: '#3a2a20', neck: 'tie', neckColor: '#2a2c33', hat: 'flatcap', hatColor: '#24262b', pants: '#2c2e33', boots: '#1e1a17' },
  { tier: 'middle', top: 'shirt', topColor: '#d8d4c8', outer: 'trench', outerColor: '#8a7a5e', neck: 'tie', neckColor: '#4a2a2a', hat: 'fedora', hatColor: '#3a3b40', hatTrim: '#1e1f22', pants: '#3a3a3e', boots: '#221d19' },
  { tier: 'middle', top: 'turtleneck', topColor: '#1f2024', outer: 'blazer', outerColor: '#4a4d52', pants: '#2f3136', boots: '#1c1a18' },
  { tier: 'middle', top: 'sweater', topColor: '#5a5248', pattern: 'knit', pattern2: '#4a4339', outer: 'peacoat', outerColor: '#262b36', hat: 'beanie', hatColor: '#2a2d33', pants: '#2b2d31', boots: '#1d1a17' },
];

/** Гражданское оперативника по внешности. */
export function plainclothesOf(seed: number): { clothes: ClothesLook; key: string } {
  const i = Math.abs(seed | 0) % PLAINCLOTHES.length;
  return { clothes: PLAINCLOTHES[i], key: `op${i}` };
}
