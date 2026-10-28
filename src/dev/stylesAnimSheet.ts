import type { PawnDir } from '../entities/PawnRenderer';
import { FG, FW, aimAround, figure, specOf, type Pose, type Spec } from './pawnC';
import { canvas, cobble, draw, outline, shadow, type Ctx } from './pixelArt';
import type { Grid } from './pixelArt';

/**
 * Лист «Стиль C в движении» (dev-страница sheets/styles-anim.html): шаг, бег, стрельба, огонь на ходу, прицел по
 * кругу и перезарядка пешек варианта C. Цикл — 24 кадра по 80 мс; шаг и бег — от фазы шага, как походка в игре.
 * window.__frame(f) рисует кадр f (для записи GIF). Только эскиз, в игру не входит.
 */
const N = 24;
const FRAME_MS = 80;
const K = 4;
const CELL_W = 150;
const CELL_H = 196;
const LABEL_W = 118;
const STRIP_H = 104;

type Anim = (f: number) => Grid;
interface Cell { title: string; anim: Anim }
interface Board { id: string; title: string; note: string; rows: { title: string; cells: Cell[] }[]; strip: Anim[] }

const civ = specOf('Горожанин');
const woman = specOf('Горожанка');
const cp = specOf('Патрульный');
const ota = specOf('Легионер');
const vet = specOf('Ветеран');
const vort = specOf('Поднадзорный');

const walk = (f: number) => (f % 8) / 8;
const runPh = (f: number) => (f % 6) / 6;

/** Когда стреляет: очередь, одиночные, импульсная очередь ИВЛ. */
const FIRE: Record<string, number[]> = {
  smg: [0, 2, 4, 6, 12, 14, 16, 18],
  rifle: [0, 8, 16],
  ar2: [0, 3, 6, 9],
};
/** Отдача, вспышка и гильзы на кадр f по расписанию выстрелов (с хвостом прошлого цикла). */
function fire(s: Spec, f: number, shots = FIRE[s.gun!]): Pose {
  const all = [...shots, ...shots.map((t) => t - N)];
  const now = shots.includes(f);
  const after = !now && shots.includes(f - 1) && s.gun === 'rifle';
  return {
    kick: now ? 1 : 0,
    flash: now ? 2 : after ? 1 : 0,
    shells: all.map((t) => f - t).filter((a) => a >= 0 && a < 8),
  };
}
const pose = (s: Spec, d: PawnDir, p: (f: number) => Pose): Anim => (f) => figure(s, d, p(f));

const MOVE: Board = {
  id: 'move',
  title: 'C в движении: шаг и бег',
  note: 'Ноги переставляются, корпус подпрыгивает на проходе ноги, руки машут в противоход; на бегу — шаг шире, ступни выше, руки согнуты, корпус наклонён вперёд. Фаза — от пройденного пути (как Character.stride сейчас): шаг 8 кадров, бег 6.',
  rows: [
    {
      title: 'Шаг, сбоку',
      cells: [
        { title: 'горожанин', anim: pose(civ, 'E', (f) => ({ walk: walk(f) })) },
        { title: 'горожанка', anim: pose(woman, 'E', (f) => ({ walk: walk(f) })) },
        { title: 'поднадзорный', anim: pose(vort, 'E', (f) => ({ walk: walk(f) })) },
        { title: 'патрульный', anim: pose(cp, 'E', (f) => ({ walk: walk(f) })) },
        { title: 'ветеран', anim: pose(vet, 'E', (f) => ({ walk: walk(f) })) },
      ],
    },
    {
      title: 'Шаг, к нам и от нас',
      cells: [
        { title: 'горожанин', anim: pose(civ, 'S', (f) => ({ walk: walk(f) })) },
        { title: 'горожанка', anim: pose(woman, 'N', (f) => ({ walk: walk(f) })) },
        { title: 'патрульный', anim: pose(cp, 'S', (f) => ({ walk: walk(f) })) },
        { title: 'легионер', anim: pose(ota, 'S', (f) => ({ walk: walk(f) })) },
        { title: 'ветеран', anim: pose(vet, 'N', (f) => ({ walk: walk(f) })) },
      ],
    },
    {
      title: 'Бег',
      cells: [
        { title: 'горожанин', anim: pose(civ, 'E', (f) => ({ walk: runPh(f), run: true })) },
        { title: 'патрульный', anim: pose(cp, 'E', (f) => ({ walk: runPh(f), run: true })) },
        { title: 'ветеран', anim: pose(vet, 'E', (f) => ({ walk: runPh(f), run: true })) },
        { title: 'легионер', anim: pose(ota, 'E', (f) => ({ walk: runPh(f), run: true })) },
        { title: 'горожанка', anim: pose(woman, 'S', (f) => ({ walk: runPh(f), run: true })) },
      ],
    },
  ],
  strip: [
    pose(civ, 'E', (f) => ({ walk: walk(f) })),
    pose(woman, 'E', (f) => ({ walk: walk(f) })),
    pose(cp, 'E', (f) => ({ walk: walk(f) })),
    pose(ota, 'S', (f) => ({ walk: walk(f) })),
    pose(vet, 'E', (f) => ({ walk: runPh(f), run: true })),
    pose(vort, 'E', (f) => ({ walk: walk(f) })),
  ],
};

const around = (s: Spec, every: number): Anim => (f) => {
  const shots = Array.from({ length: N / every }, (_, k) => k * every);
  return aimAround(s, (f / N) * Math.PI * 2, fire(s, f, shots));
};

const SHOOT: Board = {
  id: 'shoot',
  title: 'C в бою: огонь, на ходу, по кругу, перезарядка',
  note: 'Оружие в двух руках у плеча. Выстрел: отдача на пиксель, вспышка (2 кадра у одиночного, у ИВЛ бирюзовая), гильза летит из окна выброса. Прицел под любым углом: в секторе стороны ствол наклоняется, за его краем пешка поворачивается (запад — зеркало востока). Перезарядка: ствол вниз, магазин падает и остаётся на земле, новый из подсумка, затвор.',
  rows: [
    {
      title: 'Огонь',
      cells: [
        { title: 'патрульный, очередь', anim: pose(cp, 'E', (f) => ({ aim: 0, ...fire(cp, f) })) },
        { title: 'ветеран, одиночные', anim: pose(vet, 'E', (f) => ({ aim: 0, ...fire(vet, f) })) },
        { title: 'легионер, ИВЛ', anim: pose(ota, 'E', (f) => ({ aim: 0, ...fire(ota, f) })) },
        { title: 'ветеран, на нас', anim: pose(vet, 'S', (f) => ({ aim: Math.PI / 2, ...fire(vet, f) })) },
        { title: 'патрульный, от нас', anim: pose(cp, 'N', (f) => ({ aim: -Math.PI / 2, ...fire(cp, f) })) },
      ],
    },
    {
      title: 'На ходу и по кругу',
      cells: [
        { title: 'ветеран, шаг и огонь', anim: pose(vet, 'E', (f) => ({ walk: walk(f), aim: 0, ...fire(vet, f, [0, 6, 12, 18]) })) },
        { title: 'патрульный, шаг и огонь', anim: pose(cp, 'S', (f) => ({ walk: walk(f), aim: Math.PI / 2 - 0.3, ...fire(cp, f) })) },
        { title: 'легионер, по кругу', anim: around(ota, 3) },
        { title: 'ветеран, по кругу', anim: around(vet, 4) },
        { title: 'патрульный, вниз-вправо', anim: pose(cp, 'E', (f) => ({ aim: 0.6, ...fire(cp, f) })) },
      ],
    },
    {
      title: 'Перезарядка',
      cells: [
        { title: 'ветеран', anim: pose(vet, 'E', (f) => ({ reload: f / N })) },
        { title: 'патрульный', anim: pose(cp, 'E', (f) => ({ reload: f / N })) },
        { title: 'легионер', anim: pose(ota, 'E', (f) => ({ reload: f / N })) },
      ],
    },
  ],
  strip: [
    pose(cp, 'E', (f) => ({ aim: 0, ...fire(cp, f) })),
    pose(vet, 'E', (f) => ({ walk: walk(f), aim: 0, ...fire(vet, f, [0, 6, 12, 18]) })),
    pose(ota, 'E', (f) => ({ aim: -0.3, ...fire(ota, f) })),
    pose(vet, 'S', (f) => ({ aim: Math.PI / 2, ...fire(vet, f) })),
    around(ota, 3),
    pose(cp, 'E', (f) => ({ reload: f / N })),
  ],
};

const BOARDS = [MOVE, SHOOT];

/** Пешка: (x, ground) — точка у ног, k — пикселей экрана на пиксель силуэта. */
function put(ctx: Ctx, g: Grid, x: number, ground: number, k: number): void {
  shadow(ctx, x, ground - k * 0.5, 7.5 * k, 2 * k);
  draw(ctx, outline(g), Math.round(x - (FW / 2) * k), Math.round(ground - FG * k), k);
}

function boardSize(b: Board): [number, number] {
  const cols = Math.max(...b.rows.map((r) => r.cells.length));
  return [LABEL_W + cols * CELL_W, b.rows.length * CELL_H + STRIP_H];
}

function render(ctx: Ctx, b: Board, f: number): void {
  const [w, h] = boardSize(b);
  cobble(ctx, w, h, 64);
  ctx.textBaseline = 'top';
  b.rows.forEach((row, ri) => {
    const y0 = ri * CELL_H;
    ctx.fillStyle = 'rgba(20,18,16,0.82)';
    ctx.fillRect(0, y0, LABEL_W, CELL_H);
    ctx.fillStyle = '#d4b07a';
    ctx.font = '600 16px Oswald, sans-serif';
    wrap(ctx, row.title, 10, y0 + 12, LABEL_W - 16, 20);
    row.cells.forEach((cell, ci) => {
      const x0 = LABEL_W + ci * CELL_W;
      ctx.fillStyle = 'rgba(20,18,16,0.55)';
      ctx.fillRect(x0, y0, CELL_W, 20);
      ctx.fillStyle = '#e3dfd2';
      ctx.font = '13px "PT Sans Narrow", sans-serif';
      ctx.fillText(cell.title, x0 + 6, y0 + 3);
      put(ctx, cell.anim(f), x0 + CELL_W / 2 - 14, y0 + CELL_H - 10, K);
    });
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, y0 + CELL_H - 1, w, 1);
  });
  // В масштабе игры: камера ≈ 2 экранных px на px мира.
  const ys = b.rows.length * CELL_H;
  ctx.fillStyle = 'rgba(20,18,16,0.82)';
  ctx.fillRect(0, ys, LABEL_W, STRIP_H);
  ctx.fillStyle = '#d4b07a';
  ctx.font = '600 16px Oswald, sans-serif';
  wrap(ctx, 'В масштабе игры (×2)', 10, ys + 12, LABEL_W - 16, 20);
  b.strip.forEach((anim, i) => put(ctx, anim(f), LABEL_W + 50 + i * 100, ys + STRIP_H - 14, 2));
}

function wrap(ctx: Ctx, text: string, x: number, y: number, w: number, lh: number): void {
  let lineText = '';
  for (const word of text.split(' ')) {
    const t = lineText ? `${lineText} ${word}` : word;
    if (ctx.measureText(t).width > w && lineText) { ctx.fillText(lineText, x, y); y += lh; lineText = word; }
    else lineText = t;
  }
  ctx.fillText(lineText, x, y);
}

const root = document.getElementById('sheet')!;
const views: { b: Board; ctx: Ctx }[] = [];
for (const b of BOARDS) {
  const sec = document.createElement('section');
  sec.innerHTML = `<h2>${b.title}</h2><p class="note">${b.note}</p>`;
  const [w, h] = boardSize(b);
  const [c, ctx] = canvas(w, h);
  c.id = `anim-${b.id}`;
  sec.append(c);
  root.append(sec);
  views.push({ b, ctx });
}

let frame = 0;
const paint = (f: number) => views.forEach(({ b, ctx }) => render(ctx, b, f));
(window as unknown as { __frame: (f: number) => void; __frames: number; __ms: number }).__frame = (f) => { frame = f; paint(f); };
Object.assign(window, { __frames: N, __ms: FRAME_MS, __stop: () => clearInterval(timer) });
void document.fonts.ready.then(() => paint(frame));
const timer = setInterval(() => { frame = (frame + 1) % N; paint(frame); }, FRAME_MS);
