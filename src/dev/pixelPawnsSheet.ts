import type { Character } from '../entities/Character';
import type { PawnDir } from '../entities/PawnRenderer';
import { drawPixelFrame, gunHold, newFrame } from '../entities/pixel/pixelPawn';
import { PIXEL } from '../config/pixelPawns';
import { lookCatalog } from './pixelLooks';

/**
 * Лист пиксельных пешек (dev-страница sheets/pixel-pawns.html): все стороны и профессии теми же функциями, что в
 * игре — стоя с четырёх сторон, с оружием (вправо, вниз, вверх, влево вниз) и шаг сбоку. В игру не входит.
 */
const K = 4;
const s = K / PIXEL.unit;
const HOLD: [PawnDir, number][] = [['E', 0], ['S', Math.PI / 2 - 0.3], ['N', -Math.PI / 2], ['W', Math.PI * 0.85]];
const root = document.getElementById('sheet')!;
const groups = new Map<string, HTMLElement>();
for (const e of lookCatalog()) {
  let grid = groups.get(e.group);
  if (!grid) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h2>${e.group}</h2>`;
    grid = document.createElement('div');
    grid.className = 'grid';
    sec.append(grid);
    root.append(sec);
    groups.set(e.group, grid);
  }
  const cells = 4 + (e.weapon ? 4 : 0) + 2;
  const cw = 92;
  const c = document.createElement('canvas');
  c.width = cells * cw;
  c.height = 190;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4f4a44';
  ctx.fillRect(0, 0, c.width, c.height);
  const ground = 168;
  const cy = ground - PIXEL.footY * s;
  let i = 0;
  const shadow = (x: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, ground - 2, 30, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const d of ['S', 'E', 'N', 'W'] as PawnDir[]) {
    const f = newFrame();
    f.dir = d;
    const x = cw * i++ + cw / 2;
    shadow(x);
    drawPixelFrame(ctx, e.look, f, x, cy, s);
  }
  if (e.weapon) {
    for (const [d, a] of HOLD) {
      const f = newFrame();
      f.dir = d;
      const dummy = { x: 0, y: 0, weapon: e.weapon, recoil: 0, kick: 0, facing: a } as unknown as Character;
      f.gun = gunHold(dummy, false, a);
      const x = cw * i++ + cw / 2;
      shadow(x);
      drawPixelFrame(ctx, e.look, f, x, cy, s);
    }
  }
  for (const [legs, fr] of [['walk', 2], ['run', 1]] as const) {
    const f = newFrame();
    f.dir = 'E';
    f.legs = legs;
    f.frame = fr;
    const x = cw * i++ + cw / 2;
    shadow(x);
    drawPixelFrame(ctx, e.look, f, x, cy, s);
  }
  const card = document.createElement('div');
  card.className = 'card';
  card.append(c, Object.assign(document.createElement('div'), { textContent: e.title }));
  grid.append(card);
}
