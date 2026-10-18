import { CLOTHES, type ClothesLook, type ClothesSet, type ClothTier } from '../config/clothes';
import { PAWN } from '../config/pawns';
import type { PawnDir, PawnLook } from '../entities/PawnRenderer';
import { drawPawnFigure } from '../ui/pawnFigure';

/**
 * Лист ассетов «Одежда» (dev-страница sheets/clothes.html; ей же собирается страница для выбора): комплекты
 * CLOTHES.sets теми же функциями, что рисуют пешку в игре, — крупно с трёх сторон и все вместе в масштабе
 * игры на брусчатке. Только отрисовка, в игру не входит.
 */
const NAMES: Record<string, string> = {
  undershirt: 'майка', tee: 'футболка', shirt: 'рубашка', sweater: 'свитер', turtleneck: 'водолазка', blouse: 'блузка', dress: 'платье',
  quilted: 'ватник', ragcoat: 'рваное пальто', sack: 'накидка из мешковины', cardigan: 'кофта', zip: 'куртка на молнии', blazer: 'пиджак',
  trench: 'плащ-тренч', peacoat: 'бушлат', suit: 'тройка', camel: 'пальто с мехом', fur: 'шуба', french: 'френч', tux: 'смокинг',
  ushanka: 'ушанка', beanie: 'вязаная шапка', kerchief: 'платок', flatcap: 'восьмиклинка', beret: 'берет', fedora: 'федора', bowler: 'котелок',
  pillbox: 'шляпка с вуалью', tophat: 'цилиндр', scarf: 'шарф', tie: 'галстук', bow: 'бабочка', pearls: 'жемчуг', shawl: 'шаль',
};

function pieces(C: ClothesLook): string[] {
  const out = [NAMES[C.top]];
  if (C.outer) out.push(NAMES[C.outer]);
  if (C.skirt && C.top !== 'dress') out.push('юбка');
  if (C.hat) out.push(NAMES[C.hat]);
  if (C.neck) out.push(NAMES[C.neck]);
  if (C.apron) out.push('фартук');
  if (C.suspenders) out.push('подтяжки');
  if (C.rope) out.push('верёвка');
  if (C.watch) out.push('часы');
  if (C.brooch) out.push('брошь');
  if (C.glasses) out.push('очки');
  if (C.medals) out.push('награды');
  if (C.patches?.length) out.push('заплаты');
  if (C.holes) out.push('дыры');
  return out;
}

function lookOf(set: ClothesSet): PawnLook {
  return { faction: 'citizen', rank: 0, color: '#6a6f75', seed: set.seed, clothes: set.look };
}

/** Холст под плотность экрана: размер в CSS px, рисуем в CSS px. */
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.aspectRatio = `${w} / ${h}`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return [c, ctx];
}

/** Земля как в игре: брусчатка проспекта (RENDER.tiles.cobble) с сеткой тайлов 16 px мира. */
function ground(ctx: CanvasRenderingContext2D, w: number, h: number, ps: number): void {
  ctx.fillStyle = '#56504a';
  ctx.fillRect(0, 0, w, h);
  const tile = 16 * (ps / PAWN.scale);
  const sw = tile / 2;
  const sh = tile * 0.375;
  let seed = 7;
  for (let y = 0, row = 0; y < h; y += sh, row++) {
    for (let x = (row % 2) * -sw / 2; x < w; x += sw) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const l = 28 + ((seed >>> 16) % 7);
      ctx.fillStyle = `hsl(30 9% ${l}%)`;
      ctx.fillRect(x + 0.5, y + 0.5, sw - 1, sh - 1);
    }
  }
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, ps: number): void {
  const S = PAWN.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y - (PAWN.walk.foot.y - S.y) * ps, S.rx * ps, S.ry * ps, 0, 0, Math.PI * 2);
  ctx.fillStyle = S.color;
  ctx.fill();
}

const DIRS: readonly [PawnDir, string][] = [['S', 'спереди'], ['E', 'сбоку'], ['N', 'сзади']];

function card(set: ClothesSet): HTMLElement {
  const el = document.createElement('article');
  el.className = 'card';
  el.id = `set-${set.code}`;
  const ps = 3.4;
  const cw = 112;
  const [c, ctx] = canvas(cw * 3, 170);
  ground(ctx, cw * 3, 170, ps);
  DIRS.forEach(([dir], i) => {
    const x = cw * i + cw / 2;
    shadow(ctx, x, 146, ps);
    drawPawnFigure(ctx, lookOf(set), null, x, 146, ps, dir);
  });
  const fig = document.createElement('figure');
  fig.append(c);
  const cap = document.createElement('figcaption');
  cap.innerHTML = DIRS.map(([, t]) => `<span>${t}</span>`).join('');
  fig.append(cap);
  const head = document.createElement('header');
  head.innerHTML = `<b class="code">${set.code}</b><h3>${set.name}</h3>`;
  const desc = document.createElement('p');
  desc.textContent = set.desc;
  const tags = document.createElement('ul');
  tags.className = 'tags';
  tags.innerHTML = pieces(set.look).map((p) => `<li>${p}</li>`).join('');
  el.append(head, fig, desc, tags);
  return el;
}

function section(tier: ClothTier): HTMLElement {
  const sec = document.createElement('section');
  sec.className = `tier tier-${tier}`;
  sec.id = tier;
  const sets = CLOTHES.sets.filter((s) => s.look.tier === tier);
  const swatches = CLOTHES.palettes[tier].map((c) => `<i style="background:${c}" title="${c}"></i>`).join('');
  sec.innerHTML = `<div class="tier-head"><h2>${CLOTHES.tierNames[tier]}</h2><p>${CLOTHES.tierNotes[tier]}</p><div class="swatches" aria-label="Палитра">${swatches}</div></div>`;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const s of sets) grid.append(card(s));
  sec.append(grid);
  return sec;
}

/** Все комплекты рядом на улице — в масштабе игры (камера ~820 px мира на экран). */
function street(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'street';
  const ps = 1.9;
  const step = 60;
  const w = step * CLOTHES.sets.length + 24;
  const h = 96;
  const [c, ctx] = canvas(w, h);
  c.style.width = `${w}px`;
  ground(ctx, w, h, ps);
  CLOTHES.sets.forEach((s, i) => {
    const x = 12 + step * i + step / 2;
    const y = i % 2 ? 66 : 80;
    shadow(ctx, x, y, ps);
    drawPawnFigure(ctx, lookOf(s), null, x, y, ps, i % 3 === 1 ? 'E' : 'S');
    ctx.font = '600 9px "PT Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(240,236,224,0.92)';
    ctx.fillText(s.code, x, y + 13);
  });
  wrap.append(c);
  return wrap;
}

export function renderClothesSheet(root: HTMLElement): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  root.innerHTML = `
    <header class="top">
      <p class="eyebrow">Лист ассетов · одежда горожан</p>
      <h1>Гардероб Верхнеречья</h1>
      <p class="lede">Восемнадцать комплектов по достатку, нарисованы движком игры. Выберите коды, которые берём в игру
      (например: Н1, Н4, С2, Б3), и напишите, что поправить: цвет, фасон, убор.</p>
    </header>
    <h2 class="label">В масштабе игры</h2>`;
  root.append(street());
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = 'Так комплекты выглядят на проспекте при обычном масштабе камеры: читаться должны силуэт и цвет, мелочи видны только вблизи.';
  root.append(note);
  for (const t of ['poor', 'middle', 'rich'] as ClothTier[]) root.append(section(t));
}

const CSS = `
:root {
  /* Бумага инвентаря (Innawoods) и удостоверения: хаки, толстые рамки, трафарет. */
  --paper: #d8d1bc; --card: #e6e0cd; --ink: #24231e; --muted: #5f5a4b; --rule: #2a2822; --chip: #cbc3aa;
  --poor: #7a6a50; --middle: #3e5a6e; --rich: #7a2430;
  --f-display: "Oswald", "Arial Narrow", sans-serif; --f-body: "PT Sans Narrow", "Arial Narrow", sans-serif; --f-mono: "PT Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #1d1e1a; --card: #272822; --ink: #e8e3d2; --muted: #a49d88; --rule: #4a473d; --chip: #34352d;
  --poor: #b39a72; --middle: #7ea4c0; --rich: #d07080; color-scheme: dark } }
:root[data-theme="dark"] {
  --paper: #1d1e1a; --card: #272822; --ink: #e8e3d2; --muted: #a49d88; --rule: #4a473d; --chip: #34352d;
  --poor: #b39a72; --middle: #7ea4c0; --rich: #d07080; color-scheme: dark }
body { background: var(--paper); color: var(--ink); font: 16px/1.45 var(--f-body); }
#sheet { max-width: 1180px; margin: 0 auto; padding-block: 28px 56px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: flex; flex-direction: column; gap: 18px; }
.top { display: flex; flex-direction: column; gap: 6px; border-bottom: 3px solid var(--rule); padding-bottom: 16px; }
.eyebrow, .label { font: 600 12px/1 var(--f-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 0; }
h1 { font: 600 clamp(30px, 5vw, 48px)/1.05 var(--f-display); text-transform: uppercase; letter-spacing: .02em; margin: 0; text-wrap: balance; }
.lede { max-width: 64ch; margin: 0; font-size: 17px; }
.street { overflow-x: auto; border: 3px solid var(--rule); border-radius: 4px; background: #4a4540; display: flex; justify-content: center; }
.street canvas { display: block; }
.note { margin: -8px 0 0; color: var(--muted); font-size: 14px; max-width: 70ch; }
.tier { display: flex; flex-direction: column; gap: 14px; padding-top: 18px; border-top: 3px solid var(--rule); }
.tier-head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px 18px; }
.tier-head h2 { font: 600 28px/1 var(--f-display); text-transform: uppercase; margin: 0; padding: 4px 10px; color: var(--paper); }
.tier-poor h2 { background: var(--poor); } .tier-middle h2 { background: var(--middle); } .tier-rich h2 { background: var(--rich); }
.tier-head p { margin: 0; color: var(--muted); min-width: 0; }
.swatches { display: flex; gap: 3px; }
.swatches i { width: 16px; height: 16px; border: 2px solid var(--rule); border-radius: 2px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.card { background: var(--card); border: 3px solid var(--rule); border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.card header { display: flex; align-items: baseline; gap: 10px; }
.code { font: 700 15px/1 var(--f-mono); padding: 4px 6px; border: 2px solid var(--rule); border-radius: 3px; }
.tier-poor .code { color: var(--poor); } .tier-middle .code { color: var(--middle); } .tier-rich .code { color: var(--rich); }
.card h3 { font: 600 20px/1.1 var(--f-display); text-transform: uppercase; margin: 0; }
.card figure { margin: 0; border: 2px solid var(--rule); border-radius: 3px; overflow: hidden; }
.card canvas { display: block; width: 100%; height: auto; }
.card figcaption { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; font: 11px/1 var(--f-mono); letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted); padding: 5px 0; border-top: 2px solid var(--rule); background: var(--chip); }
.card p { margin: 0; font-size: 15px; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; margin: 0; padding: 0; }
.tags li { font: 12px/1 var(--f-mono); padding: 4px 6px; background: var(--chip); border-radius: 2px; }
@media (max-width: 640px) { .tier-head { grid-template-columns: 1fr; } .tier-head h2 { justify-self: start; } }
`;

const root = document.getElementById('sheet');
if (root) renderClothesSheet(root);
