import type { PawnDir } from '../entities/PawnRenderer';
import { drawPawnFigure } from '../ui/pawnFigure';
import { FG, FW, GLASS, SPECS, camoOf, figure, type Spec } from './pawnC';
import {
  Grid, PALETTE, canvas, cobble, draw, ellipse, gridFromCanvas, line, lum, mix, nearest, outline, rgb, rimLight, shade, shadow, type Ctx,
} from './pixelArt';

/**
 * Лист «Стили пешек» (dev-страница sheets/styles.html): одни и те же шесть жителей в нескольких вариантах стиля,
 * чтобы выбрать свой вид вместо RimWorld. Только эскизы для сравнения, в игру не входит:
 * A — как сейчас; B — тот же рисунок пиксель-артом в палитре города; C — новый силуэт 3/4 (руки, ноги, пропорции);
 * D — вид строго сверху с поворотом за прицелом; E — силуэт C ночью («нуар»).
 */

// ——— D: строго сверху, смотрит на восток; поворот — целиком ———
const TW = 30;
function topDown(s: Spec): Grid {
  const g = new Grid(TW, TW);
  const hand = s.glove ?? s.skin;
  const armed = !!s.gun;
  const camo = camoOf(s);
  const tc = (c: string, x: number, y: number) => camo?.(x, y) ?? c;
  if (s.long) ellipse(g, 12, 15, 5.5, 7.6, shade(s.coat, -0.08));
  if (s.skirt) ellipse(g, 12, 15, 5.5, 7.3, s.skirt);
  if (s.pack) { g.rect(8, 11, 4, 8, s.pack); g.rect(8, 11, 1, 8, shade(s.pack, -0.2)); }
  ellipse(g, 14, 15, 4.4, 7.4, s.coat);
  for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) if (g.get(x, y) === s.coat) g.set(x, y, tc(s.coat, x, y));
  if (s.quilt) for (const x of [12, 15]) for (let y = 9; y <= 21; y++) if (g.get(x, y)) g.set(x, y, shade(s.coat, -0.14));
  if (s.vest) ellipse(g, 14.5, 15, 3.4, 5.6, s.vest);
  if (s.number) g.rect(10, 14, 2, 3, s.number);
  if (s.pads) { ellipse(g, 14, 8.6, 3, 2.4, s.pads); ellipse(g, 14, 21.4, 3, 2.4, s.pads); }
  if (armed) {
    const gun = s.gun === 'ar2' ? '#bdbcb2' : '#262a30';
    const len = s.gun === 'smg' ? 24 : 28;
    g.rect(16, 15, len - 16, 2, gun);
    if (s.gun === 'rifle') g.rect(14, 15, 4, 2, '#8e6a45');
    if (s.gun === 'ar2') { g.set(21, 15, s.accent); g.set(24, 16, s.accent); }
    line(g, 14, 9, 20, 14, s.coat, 2);
    line(g, 14, 20, 17, 17, s.coat, 2);
    if (s.band) g.rect(14, 9, 2, 2, s.band);
    ellipse(g, 21, 15.5, 1.5, 1.5, hand);
    ellipse(g, 17.5, 16.5, 1.5, 1.5, hand);
  } else {
    ellipse(g, 15, 7.6, 2.6, 1.9, s.coat);
    ellipse(g, 15, 22.4, 2.6, 1.9, s.coat);
    if (s.band) g.rect(14, 7, 2, 2, s.band);
    ellipse(g, 17.6, 7.6, 1.4, 1.4, hand);
    ellipse(g, 17.6, 22.4, 1.4, 1.4, hand);
  }
  if (s.collar) { ellipse(g, 14.5, 15, 4.3, 4.3, s.collar); g.set(18, 15, s.accent); }
  // Голова — макушка, лба чуть-чуть.
  const hx = 14.5;
  const hy = 15;
  if (s.head === 'shaved' || s.head === 'kerchief') { ellipse(g, hx + 1.4, hy, 2.6, 2.4, s.skin); }
  if (s.head === 'shaved') ellipse(g, hx - 0.4, hy, 3.3, 3.4, shade(s.hair, 0.2));
  if (s.head === 'kerchief') {
    ellipse(g, hx - 0.3, hy, 3.6, 3.7, s.hat);
    g.rect(9, 14, 2, 2, s.hat);
    g.set(13, 13, s.trim); g.set(15, 16, s.trim); g.set(12, 16, s.trim);
  }
  if (s.head === 'ushanka') {
    ellipse(g, hx, hy, 4.6, 4.6, s.trim);
    ellipse(g, hx - 0.4, hy, 3.3, 3.3, s.hat);
  }
  if (s.head === 'cp') {
    ellipse(g, hx, hy, 4.5, 4.5, shade(s.hat, -0.18));
    ellipse(g, hx - 0.2, hy, 3.6, 3.6, s.hat);
    g.rect(12, 15, 5, 1, s.trim);
    g.rect(19, 14, 2, 3, '#262a30');
  }
  if (s.head === 'ota') {
    ellipse(g, hx, hy, 4.3, 4.3, s.hat);
    for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) {
      const a = Math.atan2(y + 0.5 - hy, x + 0.5 - hx);
      const r = Math.hypot(y + 0.5 - hy, x + 0.5 - hx);
      if (Math.abs(a) < 0.9 && r > 3 && r <= 4.3) g.set(x, y, GLASS);
    }
    g.set(18, 13, s.accent); g.set(18, 16, s.accent);
  }
  if (s.head === 'mich') {
    ellipse(g, hx, hy, 4.2, 4.2, s.hat);
    for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) if (g.get(x, y) === s.hat) g.set(x, y, tc(s.hat, x, y));
    g.rect(17, 13, 1, 5, s.trim);
    g.set(17, 14, s.accent); g.set(17, 16, s.accent);
  }
  return g;
}
/** Поворот спрайта на угол (по ближайшему пикселю), потом свет на кромке и контур — в мировой системе. */
function rotated(s: Spec, ang: number): Grid {
  const src = document.createElement('canvas');
  src.width = src.height = TW;
  draw(src.getContext('2d')!, topDown(s), 0, 0, 1);
  const dst = document.createElement('canvas');
  dst.width = dst.height = TW;
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(TW / 2, TW / 2);
  ctx.rotate(ang);
  ctx.drawImage(src, -TW / 2, -TW / 2);
  return outline(rimLight(gridFromCanvas(dst).map(nearest)));
}

// ——— B: тот же рисунок игры, мелко, в палитре и с цветным контуром ———
const BW = 44;
const BH = 50;
const BG = 45;
function pixelOld(s: Spec, d: PawnDir): Grid {
  const cv = document.createElement('canvas');
  cv.width = BW;
  cv.height = BH;
  drawPawnFigure(cv.getContext('2d')!, s.look, s.weapon, BW / 2, BG, 0.82, d);
  const g = gridFromCanvas(cv).map(nearest);
  // Чёрный контур → тёмный тон соседнего цвета.
  return g.map((c, x, y) => {
    if (lum(c) > 0.13) return c;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const n = g.px(x + dx, y + dy);
      if (n && lum(n) > 0.13) return nearest(shade(n, -0.55));
    }
    return c;
  });
}

// ——— E: «нуар» — ночь, холодная тень, тёплая кромка от фонаря слева ———
const LAMP = '#ffb760';
const NIGHT = '#1b2433';
function noir(s: Spec, d: PawnDir): Grid {
  const g = figure(s, d);
  const lit = g.map((c, x, y) => {
    if (c === s.accent) return c;
    const base = mix(shade(c, -0.5), NIGHT, 0.35);
    if (!g.px(x - 1, y) || !g.px(x - 1, y - 1)) return mix(c, LAMP, 0.4);
    if (!g.px(x - 2, y)) return mix(shade(c, -0.15), LAMP, 0.18);
    return base;
  });
  return outline(lit, 0, '#0a0c11');
}

// ——— Страница ———
type Variant = { code: string; title: string; note: string; dirs: (PawnDir | number)[]; big: (ctx: Ctx, s: Spec, dir: PawnDir | number, x: number, y: number) => void; small: (ctx: Ctx, s: Spec, x: number, y: number) => void; cellW: number; cellH: number };

const K = 5;
const DIRS: PawnDir[] = ['S', 'E', 'N'];
const fig = (ctx: Ctx, g: Grid, x: number, ground: number, k: number, gy: number, w: number) => draw(ctx, g, Math.round(x - (w / 2) * k), Math.round(ground - gy * k), k);
const VARIANTS: Variant[] = [
  {
    code: 'A', title: 'Сейчас — как RimWorld',
    note: 'Тело-«фасолина», голова в половину роста, руки-кружки и оружие «в воздухе», толстый чёрный контур, плоская заливка в 2–3 тона.',
    dirs: DIRS, cellW: 130, cellH: 200,
    big: (ctx, s, d, x, y) => { shadow(ctx, x, y - 4, 40, 14); drawPawnFigure(ctx, s.look, s.weapon, x, y, K * 0.9, d as PawnDir); },
    small: (ctx, s, x, y) => drawPawnFigure(ctx, s.look, s.weapon, x, y, 2 * 1.05, 'S'),
  },
  {
    code: 'B', title: 'Пиксель-арт из того же рисунка',
    note: 'Тот же PawnRenderer, но пешка рисуется в мелкий холст 1:1 и увеличивается без сглаживания; цвета — к палитре Верхнеречья (36 цветов), контур не чёрный, а тёмный тон соседнего цвета. Самый дешёвый путь: форма по частям и одежда работают как есть. Силуэт остаётся римворлдовским.',
    dirs: DIRS, cellW: 130, cellH: 200,
    big: (ctx, s, d, x, y) => { shadow(ctx, x, y - 4, 40, 14); fig(ctx, pixelOld(s, d as PawnDir), x, y, K, BG, BW); },
    small: (ctx, s, x, y) => fig(ctx, pixelOld(s, 'S'), x, y, 2, BG, BW),
  },
  {
    code: 'C', title: 'Новый силуэт 3/4 (пиксель-арт)',
    note: 'Голова в четверть роста, широкие плечи, видны руки и ноги, оружие держат две руки. Объём — свет слева сверху, контур цветной. Палитра та же. Самый узнаваемый «свой» вид, но рисовальщик пешек и все вещи (одежда, форма по частям) — заново.',
    dirs: DIRS, cellW: 130, cellH: 200,
    big: (ctx, s, d, x, y) => { shadow(ctx, x, y - 2, 34, 9); fig(ctx, outline(figure(s, d as PawnDir)), x, y, K, FG, FW); },
    small: (ctx, s, x, y) => { shadow(ctx, x, y - 1, 14, 4); fig(ctx, outline(figure(s, 'S')), x, y, 2, FG, FW); },
  },
  {
    code: 'D', title: 'Строго сверху (как Hotline Miami / Door Kickers)',
    note: 'Макушка, плечи, руки с оружием; спрайт целиком поворачивается за прицелом на любой угол — без четырёх сторон. Свет на кромке — от мира (слева сверху) при любом повороте. Лица не видно: узнавание по головному убору, плечам и цвету. Самое большое изменение.',
    dirs: [0, -Math.PI / 4, Math.PI * 0.75, Math.PI / 2], cellW: 160, cellH: 160,
    big: (ctx, s, a, x, y) => { const g = rotated(s, a as number); draw(ctx, g, Math.round(x - (TW / 2) * K), Math.round(y + 12 - 80 - (TW / 2) * K), K); },
    small: (ctx, s, x, y) => { const g = rotated(s, -Math.PI / 2); draw(ctx, g, Math.round(x - TW), Math.round(y - 2 * TW), 2); },
  },
];

const root = document.getElementById('sheet')!;
for (const v of VARIANTS) {
  const sec = document.createElement('section');
  sec.id = `style-${v.code}`;
  sec.innerHTML = `<h2><b>${v.code}</b>${v.title}</h2><p class="note">${v.note}</p>`;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const s of SPECS) {
    const card = document.createElement('div');
    card.className = 'card';
    const [c, ctx] = canvas(v.cellW * v.dirs.length, v.cellH);
    cobble(ctx, c.width, c.height, 16 * (v.code === 'D' ? 4 : 5));
    v.dirs.forEach((d, i) => v.big(ctx, s, d, v.cellW * i + v.cellW / 2, v.cellH - 12));
    card.append(c, Object.assign(document.createElement('div'), { textContent: s.name }));
    grid.append(card);
  }
  sec.append(grid);
  // В масштабе игры: камера ≈ 2 экранных px на px мира.
  const [st, sctx] = canvas(SPECS.length * 70 + 40, 100);
  st.className = 'strip';
  cobble(sctx, st.width, st.height, 32);
  SPECS.forEach((s, i) => v.small(sctx, s, 50 + i * 70, 86));
  const lab = Object.assign(document.createElement('div'), { textContent: 'в масштабе игры (≈ ×2)' });
  lab.style.cssText = 'font:13px "PT Mono",monospace;color:#8f877a;margin-top:4px';
  sec.append(st, lab);
  root.append(sec);
}

// E — ночная улица: фонарь слева, холодная тень, тёплая кромка, светятся линзы и маячки, длинные тени.
{
  const sec = document.createElement('section');
  sec.id = 'style-E';
  sec.innerHTML = '<h2><b>E</b>«Нуар» — силуэт C ночью</h2><p class="note">Свет мира делает стиль: тени холодные синие, кромка тёплая со стороны фонаря, светятся только линзы противогазов, визоры Легиона и маячки ошейников. Длинные тени от фонаря. Работает поверх B, C или D — это слой света, не рисунок пешки.</p>';
  const W = 1000;
  const H = 300;
  const [c, ctx] = canvas(W, H);
  cobble(ctx, W, H, 64, true);
  const lx = 40;
  const ground = H - 30;
  const glow = ctx.createRadialGradient(lx + 40, ground - 40, 10, lx + 40, ground - 40, 520);
  glow.addColorStop(0, 'rgba(255,183,96,0.42)');
  glow.addColorStop(0.5, 'rgba(255,150,70,0.12)');
  glow.addColorStop(1, 'rgba(255,150,70,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0c0e12';
  ctx.fillRect(lx + 30, 30, 8, ground - 30);
  ctx.fillRect(lx + 30, 30, 34, 6);
  ctx.fillStyle = '#ffd9a0';
  ctx.fillRect(lx + 54, 36, 12, 6);
  const k = 5;
  SPECS.forEach((s, i) => {
    const x = 190 + i * 140;
    const g = noir(s, i % 2 ? 'E' : 'S');
    // Тень от фонаря — вытянута вправо по земле.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(x, ground);
    ctx.transform(1, 0, -1.6 - i * 0.12, 0.28, 0, 0);
    for (let j = 0; j < g.h; j++) for (let ii = 0; ii < g.w; ii++) {
      if (!g.px(ii, j)) continue;
      ctx.fillStyle = '#000';
      ctx.fillRect((ii - FW / 2) * k, (j - FG) * k, k, k);
    }
    ctx.restore();
    fig(ctx, g, x, ground, k, FG, FW);
    // Свечение акцентов.
    ctx.globalCompositeOperation = 'lighter';
    const gx = Math.round(x - (FW / 2) * k);
    const gy = Math.round(ground - FG * k);
    for (let j = 0; j < g.h; j++) for (let ii = 0; ii < g.w; ii++) {
      if (g.px(ii, j) !== s.accent) continue;
      const cx = gx + ii * k + k / 2;
      const cy = gy + j * k + k / 2;
      const r = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
      const [cr, cg, cb] = rgb(s.accent);
      r.addColorStop(0, `rgba(${cr},${cg},${cb},0.55)`);
      r.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = r;
      ctx.fillRect(cx - 22, cy - 22, 44, 44);
    }
    ctx.globalCompositeOperation = 'source-over';
  });
  sec.append(c);
  root.append(sec);
}

// Палитра.
{
  const sec = document.createElement('section');
  sec.innerHTML = '<h2><b>◼</b>Палитра Верхнеречья</h2><p class="note">Бетон и грязный снег, ржавчина и охра, хаки, выцветший синий Протектората, кожа — и три акцента: бирюза визоров и маячков, красный глаз, жёлтая нашивка армии. Вся картинка (B–E) приводится к ней.</p>';
  const [c, ctx] = canvas(PALETTE.length * 30, 40);
  PALETTE.forEach((p, i) => { ctx.fillStyle = p; ctx.fillRect(i * 30, 0, 30, 40); });
  sec.append(c);
  root.append(sec);
}
