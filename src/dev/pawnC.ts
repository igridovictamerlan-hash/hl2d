import { CLOTHES } from '../config/clothes';
import { CP_UNIT, REBEL_UNIT, colorsOf } from '../config/factions';
import type { WeaponId } from '../config/items';
import type { PawnDir, PawnLook } from '../entities/PawnRenderer';
import { Grid, line, part, shade, type Pattern } from './pixelArt';

/**
 * Эскиз варианта C («новый силуэт 3/4», sheets/styles.html): пешка пиксель-артом — голова в четверть роста, руки,
 * ноги, оружие в двух руках — и её поза на кадр (`Pose`): шаг и бег по фазе шага (как `Character.stride` в игре),
 * прицел под углом, отдача, вспышка, гильзы, перезарядка. Только эскиз, в игру не входит.
 */

type Head = 'ushanka' | 'kerchief' | 'cp' | 'ota' | 'mich' | 'shaved';
export type GunId = 'smg' | 'rifle' | 'ar2';
export interface Spec {
  name: string;
  /** Как в игре сейчас (варианты A и B) и оружие в руках. */
  look: PawnLook;
  weapon: WeaponId | null;
  gun?: GunId;
  skin: string;
  hair: string;
  head: Head;
  hat: string;
  trim: string;
  coat: string;
  pants: string;
  boots: string;
  glove?: string;
  mask?: string;
  vest?: string;
  pads?: string;
  long?: boolean;
  skirt?: string;
  quilt?: boolean;
  seam?: boolean;
  camo?: [string, string];
  number?: string;
  collar?: string;
  band?: string;
  belt?: string;
  pack?: string;
  /** Светится (линзы, визор, маячок) — в «нуаре» горит. */
  accent: string;
}

const cpRank = CP_UNIT.pcu3;
const otaColor = colorsOf('ota', 0).color;
export const SPECS: Spec[] = [
  {
    name: 'Горожанин (ватник)', look: { faction: 'citizen', rank: 0, color: '#6a6f75', seed: CLOTHES.sets[0].seed, clothes: CLOTHES.sets[0].look }, weapon: null,
    skin: '#d6a078', hair: '#4a382c', head: 'ushanka', hat: '#5e5246', trim: '#8e7a62', coat: '#4f5648', pants: '#3a3f46', boots: '#73777a',
    quilt: true, seam: true, accent: '#f2c84a',
  },
  {
    name: 'Горожанка (кофта, платок)', look: { faction: 'citizen', rank: 0, color: '#6a6f75', seed: CLOTHES.sets[3].seed, clothes: CLOTHES.sets[3].look }, weapon: null,
    skin: '#f1cba6', hair: '#6b5038', head: 'kerchief', hat: '#8c3a2c', trim: '#e3dfd2', coat: '#7a5c44', skirt: '#5f5a4c', pants: '#5f5a4c', boots: '#2e2420',
    seam: true, accent: '#f2c84a',
  },
  {
    name: 'Патрульный ВС', look: { faction: 'cp', rank: cpRank, color: colorsOf('cp', cpRank).color, seed: 1234 + cpRank * 77 }, weapon: 'mp7', gun: 'smg',
    skin: '#d6a078', hair: '#262a30', head: 'cp', hat: '#40597a', trim: '#9ab4cc', coat: '#262c36', pants: '#262a30', boots: '#15171b', glove: '#262a30',
    mask: '#3a3f46', vest: '#66717c', quilt: true, belt: '#1c2128', accent: '#4fe0f0',
  },
  {
    name: 'Легионер LGN.ALPHA', look: { faction: 'ota', rank: 0, color: otaColor, seed: 77 }, weapon: 'ar2', gun: 'ar2',
    skin: '#d6a078', hair: '#262a30', head: 'ota', hat: '#d6d3c8', trim: '#7c2a24', coat: '#5d6166', pants: '#4a4d52', boots: '#262a30', glove: '#3a3f46',
    vest: '#cfccc1', pads: '#c4c1b6', belt: '#4a4d52', accent: '#4fe0f0',
  },
  {
    name: 'Ветеран армии', look: { faction: 'rebel', rank: REBEL_UNIT.veteran, color: '#f2d34a', seed: 5, profession: 'veteran' }, weapon: 'ak74', gun: 'rifle',
    skin: '#a87050', hair: '#2e2420', head: 'mich', hat: '#565e44', trim: '#1e1e1e', coat: '#737a52', pants: '#6b6e4c', boots: '#2e2420', glove: '#3c4232',
    mask: '#262a30', vest: '#565e44', camo: ['#4a4a32', '#959a68'], band: '#f2c84a', pack: '#4a4a32', belt: '#3c4232', accent: '#d4b07a',
  },
  {
    name: 'Поднадзорный', look: { faction: 'vort', rank: 0, color: colorsOf('vort', 0).color, seed: 31 }, weapon: null,
    skin: '#d6a078', hair: '#4a382c', head: 'shaved', hat: '#4a382c', trim: '#4a382c', coat: '#7b7f84', pants: '#6b6f74', boots: '#3a3f46',
    long: true, number: '#ece6d2', collar: '#8d949c', accent: '#58d0ff',
  },
];
export const specOf = (name: string): Spec => SPECS.find((s) => s.name.startsWith(name))!;

const INK = '#15171b';
export const GLASS = '#101318';
const BRASS = '#d4b07a';

/** Пятна камуфляжа — по клетке сетки (одинаково со всех сторон). */
export function camoOf(s: Spec): Pattern | undefined {
  if (!s.camo) return undefined;
  const [a, b] = s.camo;
  return (x, y) => {
    const h = ((Math.floor(x / 2) * 73856093) ^ (Math.floor(y / 2) * 19349663)) >>> 0;
    const v = h % 7;
    return v === 0 ? a : v === 1 ? b : null;
  };
}

/**
 * Сетка силуэта: рисунок — в координатах 24×36 (центр x = 12, земля y = 34), сетка шире — поля под ствол и вспышку.
 * FW нечётная, чтобы зеркало (сторона W) не сдвигало центр.
 */
const OX = 8;
const OY = 6;
export const FW = 41;
export const FH = 42;
/** Земля (под подошвами) — в координатах сетки. */
export const FG = 34 + OY;

/** Поза на кадр. Без полей — стоит, оружие опущено. */
export interface Pose {
  /** Фаза шага 0..1 (как `Character.stride` в игре). */
  walk?: number;
  run?: boolean;
  /** Угол прицела, рад (0 — восток, π/2 — юг), в секторе своей стороны. */
  aim?: number;
  /** Отдача, px: ствол и руки назад. */
  kick?: number;
  /** Вспышка: 1 — малая, 2 — большая. */
  flash?: number;
  /** Гильзы в полёте — возраст в кадрах. */
  shells?: number[];
  /** Перезарядка 0..1 (только сбоку). */
  reload?: number;
}

/**
 * Оружие сбоку — пиксельная картинка: d тёмный металл, m светлый металл, w дерево, g магазин, l светлый композит,
 * c акцент (огни ИВЛ). grip / fore — где руки, port — окно выброса, mag — магазин (x, y, w, h), pivot — столбец у плеча.
 */
interface GunArt { art: string[]; grip: [number, number]; fore: [number, number]; port: [number, number]; mag: [number, number, number, number]; pivot: number }
const GUN_ART: Record<GunId, GunArt> = {
  rifle: {
    art: [
      '.....mdddwwwwdddddd',
      'wwwwdddddddwwwd....',
      'www...dd.gg........',
      '......d...gg.......',
      '...........g.......',
    ],
    grip: [6, 2], fore: [12, 1], port: [7, 0], mag: [9, 2, 3, 3], pivot: 3,
  },
  smg: {
    art: [
      '..mdddddddddk',
      'ddddddddddd..',
      'd...dd..d....',
      '....dd..d....',
      '....gg.......',
    ],
    grip: [4, 2], fore: [8, 2], port: [6, 0], mag: [4, 4, 2, 1], pivot: 1,
  },
  ar2: {
    art: [
      '....llllllllllllmm',
      'lllllcllllllcllll.',
      'lll..mm.ccc.......',
      '.....m............',
    ],
    grip: [5, 2], fore: [11, 1], port: [7, 0], mag: [8, 2, 3, 1], pivot: 2,
  },
};
function gunColor(ch: string, s: Spec): string {
  return ch === 'd' ? '#262a30' : ch === 'm' ? '#555a60' : ch === 'w' ? '#8e6a45' : ch === 'g' ? '#3a3f46'
    : ch === 'l' ? '#bdbcb2' : ch === 'c' ? s.accent : INK;
}
/** Вспышка: белое ядро, жёлтое, оранжевое; у ИВЛ — бирюзовая. */
function flashColors(s: Spec): [string, string, string] {
  return s.gun === 'ar2' ? ['#eaffff', s.accent, '#2c8fa0'] : ['#fff6d8', '#f2c84a', '#c25a3a'];
}
/** Вспышка вдоль ствола (сбоку): d — шаг от дула, side — поперёк. */
function flashAlong(u: Grid, s: Spec, mx: number, my: number, slope: number, size: number): void {
  const [W, Y, O] = flashColors(s);
  const at = (d: number, side: number, c: string) => u.set(mx + d, my + Math.round(d * slope) + side, c);
  if (size >= 2) {
    at(1, 0, W); at(2, 0, W); at(3, 0, Y); at(4, 0, O);
    at(1, -1, Y); at(1, 1, Y); at(2, -2, O); at(2, 2, O); at(3, -1, O); at(3, 1, O);
  } else {
    at(1, 0, W); at(2, 0, Y); at(1, -1, O); at(1, 1, O);
  }
}
/** Вспышка на нас или от нас — звезда вокруг точки. */
function flashStar(u: Grid, s: Spec, x: number, y: number, size: number): void {
  const [W, Y, O] = flashColors(s);
  u.set(x, y, W);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) u.set(x + dx, y + dy, size >= 2 ? W : Y);
  if (size >= 2) {
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) u.set(x + dx, y + dy, Y);
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [3, 0], [-3, 0], [0, 3], [0, -3]]) u.set(x + dx, y + dy, O);
  }
}
/** Полёт гильзы по кадрам — смещение от окна выброса (dir: 1 — вправо, -1 — влево). */
const SHELL = [[0, -1], [-1, -3], [-2, -4], [-3, -4], [-4, -3], [-5, -1], [-6, 1], [-7, 3]];
function shells(u: Grid, s: Spec, x: number, y: number, ages: number[] | undefined, dir: number): void {
  if (!ages || s.gun === 'ar2') return;
  for (const a of ages) {
    const o = SHELL[a];
    if (o) u.set(x + o[0] * dir, y + o[1], BRASS);
  }
}

/** Нога сбоку: от бедра, ступня смещена на off (наклон по строкам), поднята на lift. */
function legE(g: Grid, s: Spec, hip: number, off: number, lift: number, far: boolean, camo?: Pattern): void {
  const k = far ? -0.28 : 0;
  const rows = 9 - lift;
  for (let j = 0; j < rows; j++) {
    const sh = Math.round((off * j) / 8);
    for (let i = 0; i < 4; i++) {
      const base = camo?.(hip + sh + i, 22 + j) ?? s.pants;
      const e = i === 0 ? 0.12 : i === 3 ? -0.2 : 0;
      g.set(hip + sh + i, 22 + j, shade(base, k + e));
    }
  }
  part(g, hip + off, 31 - lift, 6, 3, k ? shade(s.boots, k) : s.boots, true);
}
/** Рука сбоку: от плеча, кисть смещена на hx. */
function armE(u: Grid, s: Spec, hx: number, len: number, far: boolean, camo?: Pattern): void {
  const k = far ? -0.3 : 0;
  for (let j = 0; j < len; j++) {
    const sh = Math.round((hx * j) / (len - 1));
    for (let i = 0; i < 3; i++) {
      const base = camo?.(11 + sh + i, 14 + j) ?? s.coat;
      const e = i === 0 ? 0.12 : i === 2 ? -0.2 : 0;
      u.set(11 + sh + i, 14 + j, shade(base, k + e));
    }
    if (s.band && !far && (j === 2 || j === 3)) u.rect(11 + sh, 14 + j, 3, 1, s.band);
  }
  part(u, 11 + hx, 14 + len, 3, 2, shade(s.glove ?? s.skin, k));
}

/** Пешка C в позе: стороны S, E, N (W — зеркало E). */
export function figure(s: Spec, d: PawnDir, pose: Pose = {}): Grid {
  const g = new Grid(FW, FH);
  g.ox = OX;
  g.oy = OY;
  const u = g.blank();
  const hand = s.glove ?? s.skin;
  const camo = camoOf(s);
  const coatD = shade(s.coat, -0.25);
  const armed = !!s.gun;
  const walking = pose.walk !== undefined;
  const sw = walking ? Math.sin(2 * Math.PI * pose.walk!) : 0;
  const cw = walking ? Math.cos(2 * Math.PI * pose.walk!) : 0;
  const run = !!pose.run;
  // Корпус выше, когда ноги проходят друг мимо друга; на бегу — выше и с наклоном вперёд.
  const bob = walking ? -Math.round((1 - Math.abs(sw)) * (run ? 2 : 1)) : 0;
  const kick = pose.kick ?? 0;

  if (d === 'E') {
    // ——— Профиль (смотрит вправо) ———
    const amp = run ? 4 : 2.5;
    const lift = run ? 2 : 1;
    const fo = Math.round(sw * amp);
    legE(g, s, 11, -fo, cw < 0 ? Math.round(-cw * lift) : 0, true, camo);
    legE(g, s, 10, fo, cw > 0 ? Math.round(cw * lift) : 0, false, camo);
    if (s.pack) part(u, 6, 14, 4, 8, s.pack, true);
    // Дальняя рука машет за корпусом.
    const swing = Math.round(sw * amp * (run ? 0.9 : 0.6));
    const armLen = run ? 6 : 9;
    if (!armed) armE(u, s, swing, armLen, true, camo);
    part(u, 9, 13, 7, 11, s.coat, true, camo);
    if (s.long) { part(u, 9, 13, 7, 16, s.coat, true); part(u, 8, 24, 9, 5, s.coat); }
    if (s.skirt) { part(u, 9, 23, 7, 3, s.skirt); part(u, 8, 26, 9, 3, s.skirt); }
    if (s.quilt) for (const y of [16, 19, 22]) u.rect(10, y, 5, 1, shade(s.vest ?? s.coat, -0.14));
    if (s.vest) {
      part(u, 10, 14, 6, 8, s.vest, true);
      if (s.quilt) for (const y of [16, 19]) u.rect(11, y, 4, 1, shade(s.vest, -0.14));
      else part(u, 15, 18, 2, 3, shade(s.vest, -0.12));
    }
    if (s.belt) u.rect(9, 23, 7, 1, s.belt);
    if (s.collar) { u.rect(10, 12, 5, 1, s.collar); u.set(14, 12, s.accent); }
    if (s.number) u.rect(13, 15, 2, 2, s.number);
    headE(u, s, camo);
    if (armed) gunE(u, g, s, pose, camo, coatD, hand, kick);
    else armE(u, s, -swing, armLen, false, camo);
    g.paste(u, run ? 1 : 0, bob);
    return g;
  }

  // ——— Спереди и сзади ———
  const back = d === 'N';
  const aiming = armed && pose.aim !== undefined;
  const liftAmp = run ? 3 : 2;
  const liftL = sw > 0 ? Math.round(sw * liftAmp) : 0;
  const liftR = sw < 0 ? Math.round(-sw * liftAmp) : 0;
  part(g, 8, 22, 4, 9 - liftL, s.pants, false, camo);
  part(g, 12, 22, 4, 9 - liftR, s.pants, false, camo);
  part(g, 7, 31 - liftL, 5, 3, s.boots, true);
  part(g, 12, 31 - liftR, 5, 3, s.boots, true);
  // Ствол от нас — перед корпусом, виден только выше плеча.
  const amx = aiming ? Math.round(Math.cos(pose.aim!) * 5) : 0;
  const gunC = s.gun === 'ar2' ? '#bdbcb2' : '#262a30';
  if (back && armed) {
    if (aiming) line(u, 16, 15, 15 + amx, 3 + kick, gunC, 2);
    else line(u, 6, 24, 18, 12, gunC, 2);
  }
  // Руки: опущены и машут в шаг, у оружия — согнуты.
  const a = Math.round(sw * (run ? 2 : 1));
  const base = run ? 7 : 9;
  const short = armed && (!back || aiming);
  part(u, 5, 14, 2, short ? 4 : base - a, s.coat, false, camo);
  part(u, 17, 14, 2, short ? 4 : base + a, s.coat, false, camo);
  if (s.band) u.rect(5, 16, 2, 2, s.band);
  if (!short) { part(u, 5, 14 + base - a, 2, 2, hand); part(u, 17, 14 + base + a, 2, 2, hand); }
  part(u, 7, 13, 10, 11, s.coat, true, camo);
  if (s.long) { part(u, 7, 13, 10, 16, s.coat, true); part(u, 6, 24, 12, 5, s.coat); }
  if (s.skirt) { part(u, 7, 23, 10, 3, s.skirt); part(u, 6, 26, 12, 3, s.skirt); }
  if (s.quilt) for (const y of [16, 19, 22]) u.rect(8, y, 8, 1, shade(s.coat, -0.14));
  if (s.seam && !back) u.rect(11, 14, 1, 9, coatD);
  if (back && s.pack) part(u, 8, 14, 8, 9, s.pack, true);
  else if (s.vest) {
    part(u, 8, 14, 8, 8, s.vest, true);
    if (s.quilt) for (const y of [16, 19]) u.rect(9, y, 6, 1, shade(s.vest, -0.14));
    else if (!back) for (const x of [8, 10, 12, 14]) part(u, x, 20, 2, 2, shade(s.vest, -0.12));
  }
  if (s.pads) { part(u, 4, 13, 4, 4, s.pads, true); part(u, 16, 13, 4, 4, s.pads, true); }
  if (s.belt) u.rect(7, 23, 10, 1, s.belt);
  if (s.number) { u.rect(9, back ? 16 : 15, back ? 6 : 3, 2, s.number); u.set(10, back ? 17 : 16, '#3a3f46'); }
  headSN(u, s, back, camo);
  if (armed && back && aiming) {
    // Локти в стороны, ствол у правого плеча, вспышка над ним.
    line(u, 6, 17, 8, 15, s.coat, 2);
    line(u, 17, 17, 15, 15, s.coat, 2);
    if (pose.flash) flashStar(u, s, 15 + amx, 1 + kick, pose.flash);
    shells(u, s, 18, 13, pose.shells, 1);
  }
  if (armed && !back && aiming) {
    // Ствол на нас: от правого плеча к дулу перед грудью, вспышка — ближе к нам (ниже).
    const mx = 12 + amx;
    const my = 19 - kick;
    line(u, 15, 15, mx, my, gunC, 2);
    if (s.gun === 'ar2') { u.set(14, 16, s.accent); }
    part(u, mx - 1, my, 3, 2, s.gun === 'ar2' ? '#73777a' : '#3a3f46');
    u.set(mx, my, INK);
    line(u, 17, 18, 15, 17, s.coat, 2);
    line(u, 6, 18, mx - 2, my, s.coat, 2);
    part(u, 14, 16, 2, 2, hand);
    part(u, mx - 2, my, 2, 2, hand);
    if (pose.flash) flashStar(u, s, mx, my + 3, pose.flash);
    shells(u, s, 17, 15, pose.shells, -1);
  } else if (armed && !back) {
    gunPort(u, s);
    line(u, 6, 18, 8, 20, s.coat, 2);
    line(u, 17, 18, 15, 17, s.coat, 2);
    part(u, 8, 19, 2, 2, hand);
    part(u, 14, 16, 2, 2, hand);
  }
  g.paste(u, 0, bob);
  return g;
}

/** Оружие на груди (спереди, не целится). */
function gunPort(g: Grid, s: Spec): void {
  if (s.gun === 'smg') {
    line(g, 7, 21, 17, 15, '#262a30', 2);
    g.rect(12, 19, 2, 3, '#262a30');
  } else if (s.gun === 'ar2') {
    line(g, 5, 22, 19, 14, '#bdbcb2', 2);
    line(g, 6, 22, 9, 20, '#73777a', 2);
    g.set(15, 16, s.accent);
    g.set(17, 15, s.accent);
  } else {
    line(g, 5, 23, 19, 14, '#262a30', 2);
    line(g, 5, 23, 8, 21, '#8e6a45', 2);
    g.rect(12, 19, 2, 3, '#3a3f46');
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

/**
 * Оружие сбоку: у плеча под углом прицела (или опущено, или в перезарядке), руки на рукояти и цевье, отдача,
 * вспышка, гильзы; при перезарядке старый магазин падает на землю (в слой ног — он не качается с корпусом).
 */
function gunE(u: Grid, g: Grid, s: Spec, pose: Pose, camo: Pattern | undefined, coatD: string, hand: string, kick: number): void {
  const G = GUN_ART[s.gun!];
  const r = pose.reload;
  let slope = 0.55;
  if (pose.aim !== undefined) slope = Math.max(-1, Math.min(1, Math.tan(pose.aim)));
  if (r !== undefined) slope = r < 0.15 ? lerp(0, 0.5, r / 0.15) : r < 0.85 ? 0.5 : lerp(0.5, 0, (r - 0.85) / 0.15);
  const T = (i: number, j: number): [number, number] => [12 + (i - G.pivot) - kick, 15 + (j - 1) + Math.round((i - G.pivot) * slope)];
  const [mx0, my0, mw, mh] = G.mag;
  const inMag = (i: number, j: number) => i >= mx0 && i < mx0 + mw && j >= my0 && j < my0 + mh;
  const magOn = r === undefined || r < 0.3 || r >= 0.65;
  const magC = T(mx0 + (mw >> 1), my0);
  // Левая (дальняя) рука: на цевье, а при перезарядке — к магазину, к подсумку и обратно, к затвору.
  let fore = T(...G.fore);
  let carry = false;
  if (r !== undefined) {
    const pouch: [number, number] = [12, 22];
    if (r >= 0.15 && r < 0.3) fore = magC;
    else if (r >= 0.3 && r < 0.45) { const t = (r - 0.3) / 0.15; fore = [Math.round(lerp(magC[0], pouch[0], t)), Math.round(lerp(magC[1], pouch[1], t))]; }
    else if (r >= 0.45 && r < 0.65) { const t = (r - 0.45) / 0.2; fore = [Math.round(lerp(pouch[0], magC[0], t)), Math.round(lerp(pouch[1], magC[1] + 1, t))]; carry = true; }
    else if (r >= 0.65 && r < 0.75) fore = magC;
    else if (r >= 0.75 && r < 0.85) { const p = T(...G.port); fore = [p[0] - (r >= 0.8 ? 2 : 0), p[1] - 1]; }
    // Старый магазин падает и лежит.
    if (r >= 0.3) {
      const f = (r - 0.3) * 24;
      const sx = magC[0] - Math.round(Math.min(f, 4) * 0.5);
      const y = magC[1] + 1 + Math.round(f * f * 0.5);
      if (y >= 32) g.rect(sx, 33, 3, 1, '#3a3f46');
      else g.rect(sx, y, 2, 3, '#3a3f46');
    }
  }
  line(u, 11, 15, fore[0], fore[1], shade(s.coat, -0.3), 2);
  G.art.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '.' || (!magOn && inMag(i, j))) continue;
      const [x, y] = T(i, j);
      u.set(x, y, gunColor(row[i], s));
    }
  });
  if (carry) u.rect(fore[0], fore[1] + 1, 2, 3, '#3a3f46');
  part(u, fore[0], fore[1], 2, 2, shade(hand, -0.2));
  // Правая (ближняя) рука: плечо, предплечье к рукояти.
  const grip = T(...G.grip);
  part(u, 11, 14, 3, 4, s.coat, true, camo);
  line(u, 12, 18, grip[0], grip[1], coatD, 2);
  if (s.band) u.rect(11, 15, 3, 2, s.band);
  part(u, grip[0], grip[1], 2, 2, hand);
  const muzzle = T(G.art[0].length - 1, 0);
  if (pose.flash) flashAlong(u, s, muzzle[0], muzzle[1], slope, pose.flash);
  const port = T(...G.port);
  shells(u, s, port[0], port[1], pose.shells, 1);
}

function headE(u: Grid, s: Spec, camo?: Pattern): void {
  part(u, 9, 5, 7, 7, s.skin, true);
  u.set(16, 8, s.skin);
  u.set(16, 9, shade(s.skin, -0.12));
  u.set(14, 8, INK);
  u.set(15, 10, shade(s.skin, -0.3));
  u.rect(10, 12, 3, 1, shade(s.skin, -0.2));
  if (s.head === 'shaved') { u.rect(10, 4, 5, 1, s.hair); u.rect(9, 5, 4, 2, shade(s.hair, 0.15)); }
  if (s.head === 'ushanka') {
    part(u, 8, 2, 9, 4, s.hat, true);
    part(u, 8, 5, 9, 2, s.trim);
    part(u, 10, 7, 3, 4, s.trim, true);
    part(u, 8, 7, 2, 4, s.trim);
  }
  if (s.head === 'kerchief') {
    part(u, 9, 3, 7, 4, s.hat, true);
    part(u, 9, 7, 4, 4, s.hat);
    part(u, 7, 10, 3, 3, s.hat);
    u.set(11, 4, s.trim); u.set(14, 5, s.trim); u.set(10, 8, s.trim);
  }
  if (s.head === 'cp') {
    part(u, 9, 7, 4, 5, '#262a30');
    part(u, 12, 7, 4, 5, s.mask!);
    u.rect(14, 8, 2, 2, GLASS); u.set(14, 8, s.accent);
    part(u, 16, 10, 2, 2, '#262a30');
    part(u, 8, 2, 9, 5, s.hat, true);
    part(u, 8, 6, 10, 2, shade(s.hat, -0.18));
    u.rect(9, 4, 7, 1, s.trim);
  }
  if (s.head === 'ota') {
    part(u, 8, 3, 9, 9, s.hat, true);
    u.rect(13, 7, 4, 1, GLASS); u.set(15, 7, s.accent);
    u.rect(15, 9, 2, 2, '#3a3f46');
    u.rect(9, 6, 3, 1, shade(s.hat, -0.12));
  }
  if (s.head === 'mich') {
    part(u, 9, 5, 7, 7, s.mask!, true);
    u.rect(13, 8, 3, 1, s.skin); u.set(14, 8, INK);
    part(u, 8, 2, 9, 5, s.hat, true, camo);
    u.rect(12, 5, 5, 1, s.trim); u.set(15, 5, s.accent);
  }
}

function headSN(u: Grid, s: Spec, back: boolean, camo?: Pattern): void {
  u.rect(10, 12, 4, 1, shade(s.skin, -0.2));
  part(u, 8, 5, 8, 7, s.skin, true);
  if (back) {
    if (s.head === 'shaved') { u.rect(9, 4, 6, 1, s.hair); part(u, 8, 5, 8, 3, shade(s.hair, 0.15), true); }
  } else {
    u.set(10, 8, INK); u.set(13, 8, INK);
    u.rect(11, 10, 2, 1, shade(s.skin, -0.3));
    if (s.head === 'shaved') { u.rect(9, 4, 6, 1, s.hair); u.rect(8, 5, 8, 1, shade(s.hair, 0.15)); u.set(8, 5, null); u.set(15, 5, null); }
  }
  if (s.collar) { u.rect(9, 12, 6, 1, s.collar); if (!back) u.set(11, 12, s.accent); }
  if (s.head === 'ushanka') {
    part(u, 7, 2, 10, 4, s.hat, true);
    if (back) part(u, 7, 5, 10, 6, s.trim, true);
    else { part(u, 7, 5, 10, 2, s.trim); part(u, 6, 6, 2, 5, s.trim, true); part(u, 16, 6, 2, 5, s.trim, true); }
  }
  if (s.head === 'kerchief') {
    part(u, 8, 3, 8, back ? 9 : 4, s.hat, true);
    if (back) part(u, 10, 12, 4, 2, s.hat);
    else { u.rect(8, 7, 1, 4, s.hat); u.rect(15, 7, 1, 4, shade(s.hat, -0.2)); part(u, 10, 12, 4, 1, s.hat); }
    u.set(10, 4, s.trim); u.set(13, 5, s.trim); u.set(9, 6, s.trim); u.set(14, 3, s.trim);
    if (back) { u.set(11, 8, s.trim); u.set(13, 10, s.trim); }
  }
  if (s.head === 'cp') {
    if (back) { part(u, 8, 7, 8, 5, '#262a30', true); u.rect(9, 9, 6, 1, s.mask!); }
    else {
      part(u, 9, 7, 6, 5, s.mask!, true);
      u.rect(9, 8, 2, 2, GLASS); u.rect(13, 8, 2, 2, GLASS);
      u.set(9, 8, s.accent); u.set(13, 8, s.accent);
      part(u, 11, 10, 2, 3, '#262a30');
    }
    part(u, 7, 2, 10, 5, s.hat, true);
    part(u, 6, 6, 12, 2, shade(s.hat, -0.18));
    u.rect(8, 4, 8, 1, s.trim);
  }
  if (s.head === 'ota') {
    part(u, 7, 3, 10, 9, s.hat, true);
    if (back) u.rect(11, 4, 2, 7, shade(s.hat, -0.12));
    else {
      u.rect(8, 7, 8, 1, GLASS); u.rect(11, 8, 2, 3, GLASS);
      u.set(9, 7, s.accent); u.set(14, 7, s.accent);
    }
  }
  if (s.head === 'mich') {
    part(u, 8, 5, 8, 7, s.mask!, true);
    if (!back) { u.rect(9, 8, 6, 1, s.skin); u.set(10, 8, INK); u.set(13, 8, INK); }
    part(u, 7, 2, 10, 5, s.hat, true, camo);
    u.rect(7, 5, 10, 1, s.trim);
    if (!back) { u.set(9, 5, s.accent); u.set(14, 5, s.accent); }
  }
}

/** Сторона и поза для прицела по кругу: E/S/N по сектору, W — зеркало E. */
export function aimAround(s: Spec, ang: number, extra: Pose = {}): Grid {
  const a = Math.atan2(Math.sin(ang), Math.cos(ang));
  if (Math.abs(a) <= Math.PI / 4) return figure(s, 'E', { ...extra, aim: a });
  if (Math.abs(a) >= (3 * Math.PI) / 4) return figure(s, 'E', { ...extra, aim: Math.atan2(Math.sin(Math.PI - a), Math.cos(Math.PI - a)) }).mirror();
  return figure(s, a > 0 ? 'S' : 'N', { ...extra, aim: a });
}
