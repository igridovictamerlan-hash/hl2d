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
/** Головной убор: ушанка, вязаная шапка, платок, восьмиклинка, берет, федора, котелок, шляпка-таблетка, цилиндр. */
export type HatId = 'ushanka' | 'beanie' | 'kerchief' | 'flatcap' | 'beret' | 'fedora' | 'bowler' | 'pillbox' | 'tophat';
/** На шее: шарф, галстук, бабочка, жемчуг, шаль на плечах. */
export type NeckId = 'scarf' | 'tie' | 'bow' | 'pearls' | 'shawl';

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
};
