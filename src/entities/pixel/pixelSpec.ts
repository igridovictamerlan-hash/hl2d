/**
 * Внешность пиксельной пешки (PixelSpec) из той же PawnLook, что у фасолин: одежда из ателье, форма по частям,
 * одежда фракций и профессий, надетые шлем и бронежилет, повязка семьи или банды. Порядок разбора — как у
 * PawnRenderer.drawPawn, только итог — не рисунок, а список деталей и цветов для пиксельного рисовальщика.
 */
import { PAWN } from '../../config/pawns';
import { CLOTHES, type HatId, type NeckId, type OuterId, type PatternId, type TopId } from '../../config/clothes';
import type { KitLook } from '../../config/uniforms';
import { cpUnit } from '../../config/factions';
import { WEAPON_POSE } from '../../config/weaponSprites';
import { PIXEL } from '../../config/pixelPawns';
import { accessoriesOf } from '../pawnArmor';
import { shade as tone } from './grid';
import { tacticalFace } from '../pawnTactical';
import { hidesHair } from '../pawnClothes';
import { bootColor, handColor, hairStyleOf, kitLookOf, outfitOf, pick, type HairStyle, type Outfit, type PawnLook } from '../PawnRenderer';

export type HeadGear =
  | HatId
  | 'cap' | 'chef' | 'bandana'
  | 'flak' | 'recon' | 'peaked' | 'cadet' | 'marine' | 'mich' | 'fieldcap';
export type FaceGear = 'gas' | 's10' | 'balaclava' | 'scarf' | 'goggles';
export type OuterKind = OuterId | 'greatcoat' | 'labcoat' | 'robe' | 'suitcoat';
export type ArmorKind = 'vest' | 'flak' | 'recon' | 'marine' | 'plate' | 'chest';

export interface PixelSpec {
  key: string;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  stubble: boolean;
  /** Морщинки у глаз, веснушки — по зерну лица. */
  wrinkles: boolean;
  freckles: boolean;
  // ——— голова ———
  head: HeadGear | null;
  headColor: string;
  headTrim: string;
  /** Чехол шлема (камуфляж), очки на шлеме, крепление ПНВ. */
  headCamo: string[] | null;
  hgoggles: string | null;
  nvg: boolean;
  face: FaceGear | null;
  faceColor: string;
  lens: string;
  filter: string;
  filterRing: string;
  /** Силовой шлем и шлем спецотряда: визор, светящиеся глаза (цвет и число). */
  visor: string;
  eye: string;
  eyes: number;
  glasses: boolean;
  // ——— корпус ———
  top: string;
  topKind: TopId | 'jumpsuit' | 'uniform' | 'fatigues';
  pattern: PatternId | null;
  pattern2: string;
  collar: string | null;
  zip: boolean;
  outer: OuterKind | null;
  outerColor: string;
  outerTrim: string | null;
  skirt: string | null;
  frayed: boolean;
  armor: ArmorKind | null;
  armorColor: string;
  belt: string | null;
  rope: boolean;
  pads: string | null;
  bigPads: boolean;
  cape: string | null;
  pack: string | null;
  tank: string | null;
  bag: string | null;
  apron: string | null;
  hivis: string | null;
  cross: string | null;
  number: string | null;
  beacon: [string, string] | null;
  neck: NeckId | null;
  neckColor: string;
  tie: string | null;
  band: string | null;
  /** Нашивка на плече (армия — молния «Грозы»). */
  patch: string | null;
  acc: Set<string>;
  trim: string;
  bandolier: string | null;
  suspenders: string | null;
  watch: boolean;
  pocket: string | null;
  brooch: string | null;
  medals: boolean;
  patches: string[];
  holes: number;
  stains: number;
  camo: string[] | null;
  pants: string;
  boots: string;
  hand: string;
  sleeve: string;
  /** Светится в темноте (линзы, визор, маячок). */
  glow: string | null;
}

const G = PAWN.gear;

function blank(look: PawnLook): PixelSpec {
  const seed = look.seed;
  const kin = look.kin ?? seed;
  const faceSeed = look.kin !== undefined ? (seed ^ (look.kin * 7)) : seed;
  const style = hairStyleOf(seed);
  const short = style === 'bald' || style === 'short';
  return {
    key: '',
    skin: pick(PAWN.skins, kin, 3),
    hair: pick(PAWN.hairs, kin, 11),
    hairStyle: style,
    stubble: short && ((faceSeed >>> 7) % 1000) / 1000 < PAWN.face.stubble.share,
    wrinkles: ((faceSeed >>> 9) % 1000) / 1000 < PAWN.face.wrinkles,
    freckles: ((faceSeed >>> 5) % 1000) / 1000 < PAWN.face.freckles.share,
    head: null,
    headColor: G.helmet,
    headTrim: G.trim,
    headCamo: null,
    hgoggles: null,
    nvg: false,
    face: null,
    faceColor: G.mask,
    lens: G.lens,
    filter: G.filter,
    filterRing: G.filter,
    visor: G.reconVisor,
    eye: G.reconGlow,
    eyes: 1,
    glasses: false,
    top: look.color,
    topKind: 'jumpsuit',
    pattern: null,
    pattern2: look.color,
    collar: null,
    zip: false,
    outer: null,
    outerColor: look.color,
    outerTrim: null,
    skirt: null,
    frayed: false,
    armor: null,
    armorColor: G.flak,
    belt: null,
    rope: false,
    pads: null,
    bigPads: false,
    cape: null,
    pack: null,
    tank: null,
    bag: null,
    apron: null,
    hivis: null,
    cross: null,
    number: null,
    beacon: null,
    neck: null,
    neckColor: '#7a4a3a',
    tie: null,
    band: look.band ?? null,
    patch: null,
    acc: new Set(),
    trim: G.trim,
    bandolier: null,
    suspenders: null,
    watch: false,
    pocket: null,
    brooch: null,
    medals: false,
    patches: [],
    holes: 0,
    stains: 0,
    camo: null,
    pants: CLOTHES.pants.middle,
    boots: bootColor(look),
    hand: handColor(look),
    sleeve: look.color,
    glow: null,
  };
}

/** Одежда из ателье: низ, верх, юбка, убор, шея, мелочи, поношенность. */
function dress(p: PixelSpec, look: PawnLook): void {
  const C = look.clothes!;
  if (!C.bare) {
    p.top = C.topColor;
    p.topKind = C.top;
    p.pattern = C.pattern && C.pattern !== 'plain' ? C.pattern : null;
    p.pattern2 = C.pattern2 ?? p.top;
    p.outer = C.outer ?? null;
    p.outerColor = C.outerColor ?? p.top;
    p.outerTrim = C.trim ?? null;
    p.skirt = C.top === 'dress' ? C.skirt ?? C.topColor : C.skirt ?? null;
    p.pants = C.pants ?? CLOTHES.pants[C.tier];
    p.sleeve = p.outer ? p.outerColor : p.top;
    p.frayed = !!C.frayed;
    p.rope = !!C.rope;
    p.suspenders = C.suspenders ?? null;
    p.apron = C.apron ?? null;
    p.watch = !!C.watch;
    p.pocket = C.pocket ?? null;
    p.brooch = C.brooch ?? null;
    p.medals = !!C.medals;
    p.patches = C.patches ?? [];
    p.holes = C.holes ?? 0;
    p.stains = C.stains ?? 0;
    p.collar = null;
    p.zip = false;
  }
  if (C.boots) p.boots = C.boots;
  if (C.neck) {
    p.neck = C.neck;
    p.neckColor = C.neckColor ?? '#7a4a3a';
  }
  if (C.glasses) p.glasses = true;
  if (C.hat && !p.head) {
    p.head = C.hat;
    p.headColor = C.hatColor ?? '#4a4238';
    p.headTrim = C.hatTrim ?? tone(p.headColor, -0.3);
  }
  if (hidesHair(C)) p.hairStyle = 'bald';
}


/** Форма по частям (ВС, армия, «Гроза» и всякий, кто надел части формы). */
function kit(p: PixelSpec, look: PawnLook, K: KitLook, base: string): void {
  const C = look.clothes ?? null;
  const civil = !!C && !C.bare;
  const cp = look.faction === 'cp';
  const prof = look.faction === 'rebel' && look.profession ? PAWN.professionOutfits[look.profession] : undefined;
  const army = !!prof && (prof.style === 'tactical' || prof.style === 'marine') ? prof : undefined;
  p.trim = K.trim ?? (cp ? look.color : army ? ((army.armband as string | undefined) ?? PAWN.tactical.lambda) : G.trim);
  p.acc = cp ? accessoriesOf(PAWN.cpUnits[cpUnit(look.rank).unit], look.seed) : army ? accessoriesOf(army, look.seed) : new Set<string>();
  for (const a of ['coat', 'cape', 'pack']) p.acc.delete(a);
  if (civil) dress(p, look);
  else {
    p.top = K.fatigues ?? K.shirt ?? (cp ? (PAWN.outfits.cp.base as string) : base);
    p.topKind = K.fatigues ? 'fatigues' : 'uniform';
    p.camo = K.fatigues && K.camo ? K.camo.split(' ').filter(Boolean) : null;
    p.sleeve = p.top;
    p.pants = shade(p.top);
    if (C?.bare) dress(p, look);
  }
  p.boots = cp || army ? G.boot : p.boots;
  if (K.armor) {
    p.armor = K.armor;
    p.armorColor = K.armorColor ?? (K.armor === 'flak' ? G.flak : K.armor === 'recon' ? G.reconArmor : K.armor === 'marine' ? '#2b2e33' : '#4a5234');
  } else if (look.vest) {
    p.armor = 'vest';
    p.armorColor = look.vest;
  }
  p.belt = K.belt ?? (K.armor ? (PAWN.outfits.cp.belt as string) : p.belt);
  if (K.armor === 'marine') {
    p.pads = p.armorColor;
    p.bigPads = true;
  } else if (p.acc.has('bigPads')) p.pads = p.armorColor;
  if (K.coat === 'greatcoat') {
    p.outer = 'greatcoat';
    p.outerColor = K.coatColor ?? '#1f2328';
  }
  if (K.coat === 'cape') p.cape = K.coatColor ?? '#6e1414';
  if (K.pack && K.armor !== 'marine') p.pack = K.packColor ?? G.pack;
  if (p.acc.has('tank')) p.tank = G.tank;
  if (K.head) {
    p.head = K.head;
    p.headColor = K.headColor ?? (K.head === 'peaked' || K.head === 'cadet' ? G.cap : G.helmet);
    p.headTrim = p.trim;
    p.headCamo = K.headCamo ? K.headCamo.split(' ').filter(Boolean) : null;
    p.hgoggles = K.hgoggles ?? null;
    p.nvg = !!K.nvg;
    if (K.head === 'flak' || K.head === 'mich') p.hairStyle = 'bald';
    else if (K.head !== 'recon' && K.head !== 'marine') p.hairStyle = 'short';
  } else if (look.helmet) {
    p.head = 'mich';
    p.headColor = look.helmet;
    p.hairStyle = 'bald';
  }
  if (K.head === 'marine') {
    p.visor = K.visor ?? '#15191e';
    p.eye = K.eye ?? G.reconGlow;
    p.eyes = K.eyes ?? 1;
    p.glow = p.eye;
  } else if (K.head === 'recon') {
    p.visor = K.visor ?? G.reconVisor;
    p.eye = K.eye ?? G.reconGlow;
    p.glow = p.eye;
  }
  if (K.face) {
    p.face = K.face;
    p.faceColor = K.maskColor ?? (K.face === 'gas' ? G.mask : K.face === 's10' ? '#17181a' : '#3a3a30');
    p.lens = K.lens ?? (K.face === 'gas' ? G.lens : '#2c3a46');
    p.filter = K.filter ?? (K.face === 'gas' ? G.filter : '#232629');
    p.filterRing = K.filterRing ?? '#4d86b8';
    if (K.face === 'goggles') p.lens = K.goggles ?? '#ff8a3a';
    if (K.face === 'gas') p.glow = p.glow ?? '#4fe0f0';
  }
  p.hand = handColor(look);
  if (army) {
    if (army.armband) p.band = army.armband as string;
    if (army.lambda) p.patch = army.lambda as string;
    if (army.bandolier) p.bandolier = army.bandolier as string;
  }
  if (look.band && !p.band) p.band = look.band;
}

/** Силовая броня без формы по частям (Легион, глава восстания без экипировки) и рекон/фляк по старым юнитам. */
function armored(p: PixelSpec, look: PawnLook, O: Outfit, base: string): void {
  const trim = O.trim === 'rank' ? look.color : (O.trim as string);
  p.trim = trim;
  p.acc = accessoriesOf(O, look.seed);
  p.top = base;
  p.topKind = 'uniform';
  p.sleeve = base;
  p.pants = shade(base);
  p.boots = PAWN.boots[look.faction] ?? G.boot;
  p.armor = O.style === 'marine' ? 'marine' : O.style === 'flak' ? 'flak' : 'recon';
  p.armorColor = (O.armor as string) ?? G.reconArmor;
  p.belt = (O.belt as string) ?? null;
  if (O.style === 'marine') {
    p.pads = p.armorColor;
    p.bigPads = p.acc.has('bigPads') || look.faction === 'ota';
  }
  if (p.acc.has('pack')) p.pack = (O.pack as string) ?? G.pack;
  if (p.acc.has('tank')) p.tank = G.tank;
  if (p.acc.has('cape')) p.cape = (O.cape as string) ?? '#6e1414';
  if (O.head === 'helmet') {
    p.head = 'marine';
    p.headColor = (O.helmet as string) ?? '#d6d3c8';
    p.headTrim = trim;
    p.visor = (O.visor as string) ?? '#15191e';
    p.eye = (O.eye as string) ?? '#ff4a3a';
    p.eyes = (O.eyes as number) ?? 1;
    p.glow = p.eye;
  } else if (O.head === 'beret' || O.head === 'cadet') {
    p.head = O.head === 'beret' ? 'beret' : 'cadet';
    p.headColor = (O.head === 'beret' ? O.beret : O.cap) as string;
    p.hairStyle = 'short';
  } else if (O.head === 'recon') {
    p.head = 'recon';
    p.headColor = p.armorColor;
    p.headTrim = trim;
    p.glow = G.reconGlow;
  } else {
    p.face = 'gas';
    p.glow = '#4fe0f0';
    p.head = O.head === 'peaked' ? 'peaked' : 'flak';
    p.headColor = O.head === 'peaked' ? G.cap : G.helmet;
    p.headTrim = trim;
  }
  p.hand = WEAPON_POSE.gloves;
}

/** Военная экипировка армии без формы по частям (старые сохранения): форма, разгрузка, шлем, маска. */
function tactical(p: PixelSpec, look: PawnLook, O: Outfit): void {
  p.top = O.base as string;
  p.topKind = 'fatigues';
  p.sleeve = p.top;
  p.camo = O.camo ? String(O.camo).split(' ').filter(Boolean) : null;
  p.pants = shade(p.top);
  p.boots = G.boot;
  p.armor = O.rig === 'plate' ? 'plate' : O.rig === 'chest' ? 'chest' : null;
  p.armorColor = (O.rigColor as string) ?? '#4a5234';
  p.belt = PAWN.tactical.belt;
  p.acc = accessoriesOf(O, look.seed);
  if (O.head === 'helmet') {
    p.head = 'mich';
    p.headColor = O.helmet as string;
    p.nvg = !!O.nvg;
    p.hgoggles = (O.hgoggles as string) ?? null;
    p.hairStyle = 'bald';
  } else if (O.head === 'cap') {
    p.head = 'fieldcap';
    p.headColor = O.cap as string;
    p.hairStyle = 'short';
  }
  const f = tacticalFace(O, look.seed);
  if (f === 'gasmask') {
    p.face = 's10';
    p.faceColor = (O.mask as string) ?? '#17181a';
    p.lens = (O.lens as string) ?? '#2c3a46';
    p.filter = (O.filter as string) ?? '#232629';
    p.filterRing = (O.filterRing as string) ?? '#4d86b8';
  } else if (f === 'balaclava') {
    p.face = 'balaclava';
    p.faceColor = (O.mask as string) ?? '#3a3a30';
  } else if (O.goggles) {
    p.face = 'goggles';
    p.lens = O.goggles as string;
  }
  p.band = (O.armband as string) ?? p.band;
  p.patch = (O.lambda as string) || null;
  p.bandolier = (O.bandolier as string) ?? null;
  p.hand = handColor(look);
}

/** Одежда фракции и профессии без ателье и формы: комбинезон, роба, халат, костюм, кепка, колпак, капюшон. */
function outfit(p: PixelSpec, look: PawnLook, O: Outfit, base: string): void {
  p.top = base;
  p.sleeve = base;
  p.topKind = 'jumpsuit';
  p.pants = shade(base);
  p.collar = typeof O.collar === 'string' ? O.collar : null;
  p.zip = !!O.zip;
  const head = O.head as string;
  if (head === 'cap') { p.head = 'cap'; p.headColor = O.cap as string; p.hairStyle = p.hairStyle === 'long' || p.hairStyle === 'bun' ? 'short' : p.hairStyle; }
  if (head === 'chef') { p.head = 'chef'; p.headColor = O.chef as string; }
  if (head === 'hood') { p.head = 'hood'; p.headColor = O.hood as string; p.hairStyle = 'bald'; }
  if (head === 'bandana') { p.head = 'bandana'; p.headColor = O.cloth as string; }
  if (head === 'beret') { p.head = 'beret'; p.headColor = O.beret as string; }
  if (O.armband) p.band = O.armband as string;
  if (O.tie) { p.tie = O.tie as string; p.topKind = 'shirt'; p.outer = 'suitcoat'; p.outerColor = base; p.top = (O.collar as string) || '#e8e2d0'; p.sleeve = base; p.collar = null; }
  if (O.cross) { p.outer = 'labcoat'; p.outerColor = base; p.cross = O.cross as string; p.top = (O.collar as string) || '#cfccc4'; p.pants = '#5a5e66'; p.collar = null; }
  if (O.apron) p.apron = O.apron as string;
  if (O.hivis) p.hivis = O.hivis as string;
  if (O.bag) p.bag = O.bag as string;
  if (O.patch) p.patches = [O.patch as string, O.patch as string];
  if (O.facemask) { p.face = 'scarf'; p.faceColor = O.facemask as string; }
  if (O.convict) {
    p.outer = 'robe';
    p.outerColor = base;
    p.topKind = 'tee';
    p.number = (O.number as string) ?? '#ece6d2';
    p.beacon = [(O.band as string) ?? '#8d949c', (O.light as string) ?? '#58d0ff'];
    p.glow = p.beacon[1];
    p.hairStyle = 'bald';
    p.stubble = true;
  }
  // Повстанец с ранга — бронежилет и бандана; новобранец — без.
  const vestFrom = (O.vestFromRank as number | undefined) ?? 99;
  if (O.armor && O.vest !== false && look.rank >= vestFrom) {
    p.armor = 'vest';
    p.armorColor = O.armor === 'rank' ? look.color : (O.armor as string);
    p.belt = (O.belt as string) ?? null;
  } else if (head === 'bandana' && O.vest !== false && look.rank < vestFrom) p.head = null;
}

/** Санитар: плащ, маска на всё лицо, баллон за спиной, зелёный глаз. */
function cremator(p: PixelSpec, O: Outfit): void {
  p.outer = 'robe';
  p.outerColor = O.coat as string;
  p.top = O.coat as string;
  p.sleeve = O.coat as string;
  p.skin = (O.skin as string) ?? p.skin;
  p.face = 'gas';
  p.faceColor = O.mask as string;
  p.lens = O.eye as string;
  p.glow = O.eye as string;
  p.head = 'hood';
  p.headColor = O.coat as string;
  p.tank = O.tank as string;
  p.hairStyle = 'bald';
  p.boots = '#26272a';
  p.hand = '#3a3833';
}

/** Брюки под формой и комбинезоном — тоном темнее. */
const shade = (c: string): string => tone(c, -0.22);

const cache = new Map<string, PixelSpec>();

/** Ключ внешности — как у кэша фасолин (PawnCache). */
export function lookKey(look: PawnLook): string {
  return `${look.faction}|${look.rank}|${look.color}|${look.seed}|${look.profession ?? ''}|${look.kin ?? ''}|${look.band ?? ''}|${look.helmet ?? ''}|${look.vest ?? ''}|${look.clothesKey ?? (look.clothes ? 'c' : '')}`;
}

/** Внешность пиксельной пешки (кэш по ключу внешности). */
export function pixelSpecOf(look: PawnLook): PixelSpec {
  const key = lookKey(look);
  let p = cache.get(key);
  if (p) return p;
  p = resolve(look);
  p.key = key;
  if (cache.size >= PIXEL.cache.specs) cache.delete(cache.keys().next().value!);
  cache.set(key, p);
  return p;
}

/** Разбор без кэша (тесты, листы). */
export function resolve(look: PawnLook): PixelSpec {
  const p = blank(look);
  const O = outfitOf(look);
  const base = O.base === 'rank' ? look.color : ((O.base as string | undefined) ?? look.color);
  const K = kitLookOf(look, O);
  if (K) kit(p, look, K, base);
  else if (!look.clothes && (O.style === 'marine' || O.style === 'flak' || O.style === 'recon')) armored(p, look, O, base);
  else if (!look.clothes && O.style === 'tactical') tactical(p, look, O);
  else if (O.style === 'cremator') cremator(p, O);
  else if (look.clothes) {
    dress(p, look);
    if (look.vest) { p.armor = 'vest'; p.armorColor = look.vest; }
    if (look.helmet) { p.head = 'mich'; p.headColor = look.helmet; p.hairStyle = 'bald'; }
    if (O.facemask) { p.face = 'scarf'; p.faceColor = O.facemask as string; }
  } else {
    outfit(p, look, O, base);
    if (look.vest) { p.armor = 'vest'; p.armorColor = look.vest; }
    if (look.helmet) { p.head = 'mich'; p.headColor = look.helmet; p.hairStyle = 'bald'; }
  }
  if (p.neck === 'mask') { p.face = p.face ?? 'scarf'; p.faceColor = p.neckColor; p.neck = null; }
  if (p.head === 'hood' || p.head === 'kerchief' || p.head === 'ushanka' || p.head === 'beanie') {
    if (p.hairStyle === 'long' || p.hairStyle === 'bun') p.hairStyle = 'short';
  }
  return p;
}
