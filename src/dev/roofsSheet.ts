import { generateCity } from '../world/generator/CityGenerator';
import { MapRenderer } from '../world/MapRenderer';
import { furnishMap } from '../world/furnish';
import { drawFurnitureList } from '../world/FurnitureRenderer';
import { computeBuildings, type Building } from '../world/buildings';
import { RoofRenderer, paintDoor, paintRoof, paintWall, paintWindow, type RoofOptions, type RoofStyle, type RoofView, type WallStyle } from '../world/RoofRenderer';
import type { WindowLook, WindowStyle } from '../world/windows';
import { castRay } from '../world/visibility';
import { drawPawnFigure } from '../ui/pawnFigure';
import type { PawnDir, PawnLook } from '../entities/PawnRenderer';
import { CLOTHES } from '../config/clothes';
import { PAWN } from '../config/pawns';
import { CP_UNIT, colorsOf } from '../config/factions';
import { ROOFS } from '../config/roofs';
import { VISION } from '../config/vision';
import { hash2 } from '../core/rng';
import { T } from '../world/tiles';
import type { GameMap } from '../world/GameMap';
import type { View } from '../core/Camera';

/**
 * Лист вариантов «Крыши и фасады» (dev-страница sheets/roofs.html): настоящий город (сид SEED) тем же кодом, что игра,
 * в нескольких видах — как сейчас (план этажа), крыша сверху, ¾ с фасадом в контуре дома, ¾ с высотой; дом, где
 * игрок, — разрезом или «видно только то, что видит»; ночь; образцы материалов. Только отрисовка, в игру не входит.
 */
const SEED = 12345;
/** CSS px на пиксель мира и размер кадра в тайлах. */
const SCALE = 2;
const VW = 24;
const VH = 22;
const TS = 16;

type Mode = 'plan' | RoofView | 'cut' | 'cutTall' | 'los';
interface Pawn {
  x: number;
  y: number;
  look: PawnLook;
  dir: PawnDir;
  player?: boolean;
}
interface Frag {
  x: number;
  y: number;
  pawns: Pawn[];
  /** Дом, где игрок (для разреза). */
  home: Building | null;
}

let map: GameMap;
let mr: MapRenderer;
let roofs: RoofRenderer;
let furniture: ReturnType<typeof furnishMap>;

function canvas(wCss: number, hCss: number): [HTMLCanvasElement, CanvasRenderingContext2D, number] {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(wCss * dpr);
  c.height = Math.round(hCss * dpr);
  c.style.aspectRatio = `${wCss} / ${hCss}`;
  return [c, c.getContext('2d')!, dpr];
}

const citizenLook = (k: number): PawnLook => {
  const set = CLOTHES.sets[k % CLOTHES.sets.length];
  return { faction: 'citizen', rank: 0, color: '#6a6f75', seed: set.seed, clothes: set.look };
};
const cpLook = (seed: number): PawnLook => ({ faction: 'cp', rank: CP_UNIT.pcu3, color: colorsOf('cp', CP_UNIT.pcu3).color, seed });
const DIRS: PawnDir[] = ['S', 'E', 'W', 'N'];

/** Якорь 2×2 проходим (все четыре тайла). */
function walkable(ax: number, ay: number): boolean {
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (map.isSolid(ax + dx, ay + dy)) return false;
  return true;
}

/** Здание под пешкой (якорь — тайл с меньшими координатами), -1 — улица. */
function buildingAt(x: number, y: number): number {
  const tx = Math.floor((x - 1) / TS);
  const ty = Math.floor((y - 1) / TS);
  return roofs.buildings.of[ty * map.width + tx];
}

/** Окно VW×VH с наибольшей суммой очков (points — очки на тайл), шаг 2 тайла. */
function bestWindow(points: Float32Array): { x: number; y: number } {
  const w = map.width;
  const h = map.height;
  const P = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += points[y * w + x];
      P[(y + 1) * (w + 1) + x + 1] = P[y * (w + 1) + x + 1] + row;
    }
  }
  const sum = (x: number, y: number) => P[(y + VH) * (w + 1) + x + VW] - P[y * (w + 1) + x + VW] - P[(y + VH) * (w + 1) + x] + P[y * (w + 1) + x];
  let best = { x: 0, y: 0 };
  let bs = -1;
  const xMax = Math.min(w, map.underground ? map.underground.x : w) - VW;
  for (let y = 0; y + VH <= h; y += 2) for (let x = 0; x <= xMax; x += 2) {
    const s = sum(x, y);
    if (s > bs) {
      bs = s;
      best = { x, y };
    }
  }
  return best;
}

function fragment(points: Float32Array, salt: number): Frag {
  const { x, y } = bestWindow(points);
  const w = map.width;
  const inside = (tx: number, ty: number) => tx >= x && ty >= y && tx < x + VW && ty < y + VH;
  const list = roofs.buildings.list.filter((b) => b.x1 >= x && b.y1 >= y && b.x0 < x + VW && b.y0 < y + VH);
  const rooms = map.poisOf('room');
  const roomsIn = (b: Building) => rooms.filter((r) => r.x >= b.x0 && r.y >= b.y0 && r.x <= b.x1 && r.y <= b.y1).length;
  const whole = (b: Building) => b.x0 >= x && b.y0 >= y && b.x1 < x + VW && b.y1 < y + VH;
  // Дом игрока: жилой, дверь в кадре (лучше к югу — видна в ¾), целиком в кадре, с комнатами.
  const homes = list.filter((b) => (b.kind === 'house' || b.kind === 'villa') && b.doors.some((d) => inside(d.x, d.y)));
  const score = (b: Building) => Number(b.doors.some((d) => d.side === 2 && inside(d.x, d.y))) * 4 + Number(whole(b)) * 2 + Math.min(3, roomsIn(b));
  const home = homes.sort((a, b) => score(b) - score(a))[0] ?? null;
  const pawns: Pawn[] = [];
  const free = (px: number, py: number) => pawns.every((p) => Math.hypot(p.x - px, p.y - py) > 26);
  // Игрок — в своём доме, в паре шагов от двери: ближайшее к ней место внутри.
  if (home) {
    const d = home.doors.find((q) => q.side === 2 && inside(q.x, q.y)) ?? home.doors.find((q) => inside(q.x, q.y))!;
    let best = -1;
    let bd = Infinity;
    for (const i of home.tiles) {
      const ax = i % w;
      const ay = (i - ax) / w;
      if (map.tiles[i] !== T.INTERIOR || !walkable(ax, ay) || !inside(ax, ay)) continue;
      let own = true;
      for (const j of [i, i + 1, i + w, i + w + 1]) if (roofs.buildings.of[j] !== home.id) own = false;
      const dist = Math.hypot(ax + 1 - (d.x + 0.5), ay + 1 - (d.y + 0.5));
      if (own && dist >= 2 && dist < bd) {
        bd = dist;
        best = i;
      }
    }
    if (best >= 0) pawns.push({ x: ((best % w) + 1) * TS, y: (Math.floor(best / w) + 1) * TS, look: citizenLook(9), dir: DIRS[(d.side + 2) % 4], player: true });
  }
  // Жители дома: продавец за прилавком, кто-то в комнате.
  for (const b of list) {
    if (b === home && pawns.length) continue;
    if (b.kind !== 'house' && b.kind !== 'shop' && b.kind !== 'cafe') continue;
    const v = map.poisOf('vendor_spot').find((p) => p.x >= b.x0 && p.y >= b.y0 && p.x <= b.x1 && p.y <= b.y1);
    if (v) {
      pawns.push({ x: (v.x + 1) * TS, y: (v.y + 1) * TS, look: citizenLook(hash2(b.id, 3, salt)), dir: 'S' });
      continue;
    }
    if ((hash2(b.id, 1, salt) & 3) === 0) continue;
    const spots = b.tiles.filter((i) => map.tiles[i] === T.INTERIOR && walkable(i % w, Math.floor(i / w)) && roofs.buildings.of[i] === b.id);
    if (!spots.length) continue;
    const i = spots[hash2(b.id, 2, salt) % spots.length];
    const px = ((i % w) + 1) * TS;
    const py = (Math.floor(i / w) + 1) * TS;
    if (free(px, py)) pawns.push({ x: px, y: py, look: citizenLook(hash2(b.id, 4, salt)), dir: DIRS[hash2(b.id, 5, salt) & 3] });
  }
  // Улица: горожане и пара ВС.
  const street: number[] = [];
  for (let ay = y; ay < y + VH - 1; ay++) {
    for (let ax = x; ax < x + VW - 1; ax++) {
      const t = map.tileAt(ax, ay);
      if ((t === T.STREET || t === T.FLOOR || t === T.PLAZA) && walkable(ax, ay) && roofs.buildings.of[ay * w + ax] < 0) street.push(ay * w + ax);
    }
  }
  let made = 0;
  for (let k = 0; k < 400 && made < 9 && street.length; k++) {
    const i = street[hash2(k, salt, 77) % street.length];
    const px = ((i % w) + 1) * TS;
    const py = (Math.floor(i / w) + 1) * TS;
    if (!free(px, py)) continue;
    const cp = made === 3;
    pawns.push({ x: px, y: py, look: cp ? cpLook(k) : citizenLook(hash2(k, salt, 79)), dir: DIRS[hash2(k, salt, 81) & 3] });
    if (cp && walkable(i % w + 2, Math.floor(i / w)) && free(px + 2 * TS, py)) pawns.push({ x: px + 2 * TS, y: py, look: cpLook(k + 1), dir: 'W' });
    made++;
  }
  return { x, y, pawns, home };
}

/** Пешка и (у игрока) жёлтое кольцо под ногами. */
function drawPawn(ctx: CanvasRenderingContext2D, p: Pawn, v: View): void {
  const k = v.scale;
  const sx = (p.x - v.left) * k;
  const sy = (p.y - v.top) * k;
  const ps = k * PAWN.scale;
  const foot = sy + PAWN.walk.foot.y * ps;
  if (p.player) {
    ctx.save();
    ctx.strokeStyle = ROOFS.cut.outline;
    ctx.lineWidth = 2 * (k / SCALE);
    ctx.beginPath();
    ctx.ellipse(sx, foot, 9 * k / SCALE * 1.4, 4 * k / SCALE * 1.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  drawPawnFigure(ctx, p.look, null, sx, foot, ps, p.dir);
}

/** Область видимости игрока (лучи до стен, как туман войны) — в пикселях холста. */
function sightPath(p: Pawn, v: View): Path2D {
  const path = new Path2D();
  const n = 720;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const d = castRay(map, p.x, p.y, dx, dy, VISION.radius);
    const x = (p.x + dx * d - v.left) * v.scale;
    const y = (p.y + dy * d - v.top) * v.scale;
    if (k === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

/** Кадр куска города f в режиме mode; night — доля суток ночью (иначе день). */
function scene(f: Frag, mode: Mode, night: number | null = null): HTMLCanvasElement {
  const [c, ctx, dpr] = canvas(VW * TS * SCALE, VH * TS * SCALE);
  const v: View = { left: f.x * TS, top: f.y * TS, scale: SCALE * dpr, width: c.width, height: c.height };
  const k = v.scale;
  const world = (g: CanvasRenderingContext2D) => g.setTransform(k, 0, 0, k, -v.left * k, -v.top * k);
  mr.draw(ctx, v, night === null ? 0.42 : null);
  drawFurnitureList(ctx, v, furniture);
  const list = roofs.buildings.list.filter((b) => b.x1 >= f.x - 1 && b.y1 >= f.y - 1 && b.x0 <= f.x + VW && b.y0 <= f.y + VH + 4);
  const cut = (mode === 'cut' || mode === 'cutTall') && f.home ? f.home.id : -1;
  const view: RoofView = mode === 'top' ? 'top' : mode === 'tall' || mode === 'cutTall' ? 'tall' : 'facade';
  const o: RoofOptions = { view, cut, night };
  const player = f.pawns.find((p) => p.player);
  const visible = (p: Pawn) => {
    if (mode === 'plan') return true;
    const b = buildingAt(p.x, p.y);
    return b < 0 || b === cut;
  };
  const byY = (a: Pawn, b: Pawn) => a.y - b.y;
  if (mode === 'plan') {
    for (const p of [...f.pawns].sort(byY)) drawPawn(ctx, p, v);
  } else if (mode === 'tall' || mode === 'cutTall') {
    // Художник: здания по нижнему краю и пешки по ногам — кто южнее, тот поверх.
    const items: { y: number; draw: () => void }[] = [];
    for (const b of list) items.push({ y: (b.y1 + 1) * TS, draw: () => { world(ctx); roofs.drawBuilding(ctx, b, o); ctx.setTransform(1, 0, 0, 1, 0, 0); } });
    for (const p of f.pawns) if (visible(p)) items.push({ y: p.y + 6, draw: () => drawPawn(ctx, p, v) });
    for (const it of items.sort((a, b) => a.y - b.y)) it.draw();
  } else if (mode === 'los' && player) {
    // Крыши — отдельным слоем; где игрок видит (лучи до стен), крыша прозрачна.
    for (const p of f.pawns) if (buildingAt(p.x, p.y) >= 0) drawPawn(ctx, p, v);
    const [off, octx] = canvas(VW * TS * SCALE, VH * TS * SCALE);
    world(octx);
    for (const b of list) roofs.drawBuilding(octx, b, { view: 'facade', cut: -1, night });
    octx.setTransform(1, 0, 0, 1, 0, 0);
    const sight = sightPath(player, v);
    octx.globalCompositeOperation = 'destination-out';
    octx.fill(sight);
    ctx.drawImage(off, 0, 0);
    // Туман войны: вне видимости — темнее.
    ctx.save();
    const fog = new Path2D();
    fog.rect(0, 0, c.width, c.height);
    fog.addPath(sight);
    ctx.fillStyle = 'rgba(8,8,10,0.38)';
    ctx.fill(fog, 'evenodd');
    ctx.restore();
    for (const p of [...f.pawns].sort(byY)) if (buildingAt(p.x, p.y) < 0 || p.player) drawPawn(ctx, p, v);
  } else {
    world(ctx);
    for (const b of list) roofs.drawBuilding(ctx, b, o);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const p of [...f.pawns].sort(byY)) if (visible(p)) drawPawn(ctx, p, v);
  }
  if (night !== null) {
    ctx.fillStyle = ROOFS.night.shade;
    ctx.fillRect(0, 0, c.width, c.height);
    world(ctx);
    roofs.drawLit(ctx, list, o);
    // Дом игрока ночью — лампа внутри.
    if (cut >= 0 && f.home) {
      ctx.fillStyle = 'rgba(255,196,120,0.16)';
      for (const i of f.home.tiles) if (map.tiles[i] !== T.WALL) ctx.fillRect((i % map.width) * TS, Math.floor(i / map.width) * TS, TS, TS);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (cut >= 0) for (const p of f.pawns) if (buildingAt(p.x, p.y) === cut) drawPawn(ctx, p, v);
  }
  return c;
}

function card(code: string, title: string, note: string, c: HTMLCanvasElement, tone = ''): HTMLElement {
  const el = document.createElement('article');
  el.className = `card ${tone}`;
  el.innerHTML = `<header><span class="code">${code}</span><h3>${title}</h3></header>`;
  const fig = document.createElement('figure');
  fig.append(c);
  el.append(fig);
  const p = document.createElement('p');
  p.textContent = note;
  el.append(p);
  return el;
}

function section(eyebrow: string, title: string, lede: string, cards: HTMLElement[]): HTMLElement {
  const s = document.createElement('section');
  s.className = 'part';
  s.innerHTML = `<p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p class="lede">${lede}</p>`;
  const g = document.createElement('div');
  g.className = 'grid';
  g.append(...cards);
  s.append(g);
  return s;
}

/** Образцы: материал кровли — квадратом 6×4 тайла. */
function roofSwatch(style: RoofStyle, color: { h: number; s: number; l: number }): HTMLCanvasElement {
  const [c, ctx, dpr] = canvas(6 * TS * 2.5, 4 * TS * 2.5);
  const k = 2.5 * dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  paintRoof(ctx, 0, 0, 6 * TS, 4 * TS, style, color, true, 17);
  ctx.strokeStyle = ROOFS.eave;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 6 * TS - 2, 4 * TS - 2);
  return c;
}

/** Образцы: стена в ¾ на 6 тайлов — окна через тайл, дверь посередине; этажей storeys, ночью — свет. */
function wallSwatch(style: WallStyle, wnd: WindowStyle, color: { h: number; s: number; l: number }, storeys: number, lit: boolean, looks: WindowLook[], shop = false): HTMLCanvasElement {
  const H = ROOFS.facade.height[Math.min(storeys, ROOFS.facade.height.length - 1)];
  const [c, ctx, dpr] = canvas(6 * TS * 3, (H + 6) * 3);
  const k = 3 * dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = '#4c4741';
  ctx.fillRect(0, 0, 6 * TS, H + 6);
  paintWall(ctx, 0, 0, 6 * TS, H, style, color, 5);
  const S = { slum: [3.5, 12.5], old: [2.5, 13.5], upper: [2.5, 13.5], shop: [1, 15], civic: [2, 14] }[wnd];
  const rows = H >= ROOFS.facade.storeyMin * storeys ? storeys : 1;
  const band = (H - 4) / rows;
  for (let t = 0; t < 6; t++) {
    const door = t === 2 || t === 3;
    if (door) paintDoor(ctx, t * TS, H - Math.min(13, H - 3), (t + 1) * TS, H - 1, ROOFS.facade.door[style] ?? ROOFS.facade.door.old, t === 2 ? 1 : 2, shop, lit);
    for (let r = 0; r < rows; r++) {
      if (door && r === rows - 1) continue;
      if (!shop && (t & 1) && wnd !== 'upper') continue;
      const v0 = Math.round(3 + r * band + (shop ? 1 : band * 0.18));
      const v1 = Math.round(3 + (r + 1) * band - (shop ? 3 : band * 0.3));
      const pair = wnd === 'upper' ? ((t & 1) ? 2 : 1) : 0;
      const u0 = t * TS + (pair === 2 ? 0 : Math.round(S[0] + 1));
      const u1 = t * TS + (pair === 1 ? TS : Math.round(S[1] - 1));
      paintWindow(ctx, u0, v0, u1, v1, wnd, shop ? 'plain' : looks[(t + r) % looks.length], t * 7 + r * 3, lit && ((t + r) % 3 !== 1));
    }
  }
  ctx.fillStyle = ROOFS.facade.step;
  ctx.fillRect(2 * TS, H, 2 * TS, 2);
  return c;
}

/** Образцы: окна по стилю и виду — крупно. */
function windowGrid(): HTMLCanvasElement {
  const styles: WindowStyle[] = ['slum', 'old', 'upper', 'shop', 'civic'];
  const looks: WindowLook[] = ['plain', 'curtains', 'flowers', 'shutters', 'closed', 'boarded', 'broken'];
  const cw = 22;
  const ch = 20;
  const [c, ctx, dpr] = canvas(looks.length * cw * 3, styles.length * ch * 3);
  const k = 3 * dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  styles.forEach((st, r) => {
    const wall: WallStyle = st === 'shop' ? 'old' : st === 'civic' ? 'civic' : st;
    const color = wall === 'old' ? { h: 38, s: 40, l: 62 } : ROOFS.facade.wall[wall][0];
    looks.forEach((lk, q) => {
      paintWall(ctx, q * cw, r * ch, (q + 1) * cw, (r + 1) * ch, wall, color, q);
      paintWindow(ctx, q * cw + 6, r * ch + 5, q * cw + 16, r * ch + 14, st, lk, q * 5 + r, false);
    });
  });
  return c;
}

/** Образец здания: настоящий дом стиля style — сверху и в ¾. */
function sampleHouse(style: RoofStyle, view: RoofView): HTMLCanvasElement | null {
  const b = roofs.buildings.list.find((q) => roofs.styleOf(q).roof === style && q.doors.some((d) => d.side === 2) && q.x1 - q.x0 >= 4 && q.x1 - q.x0 <= 10 && q.y1 - q.y0 >= 3 && q.y1 - q.y0 <= 8 && (q.kind === 'house' || q.kind === 'shop' || q.kind === 'civic' || q.kind === 'cafe'));
  if (!b) return null;
  const wT = 12;
  const hT = 10;
  const [c, ctx, dpr] = canvas(wT * TS * 1.5, hT * TS * 1.5);
  const cx = Math.round((b.x0 + b.x1) / 2 - wT / 2 + 0.5);
  const cy = Math.round((b.y0 + b.y1) / 2 - hT / 2 + 1);
  const v: View = { left: cx * TS, top: cy * TS, scale: 1.5 * dpr, width: c.width, height: c.height };
  mr.draw(ctx, v, 0.42);
  drawFurnitureList(ctx, v, furniture);
  const k = v.scale;
  ctx.setTransform(k, 0, 0, k, -v.left * k, -v.top * k);
  const near = roofs.buildings.list.filter((q) => q.x1 >= cx && q.y1 >= cy && q.x0 <= cx + wT && q.y0 <= cy + hT + 4);
  if (view === 'tall') near.sort((a, q) => a.y1 - q.y1);
  for (const q of near) roofs.drawBuilding(ctx, q, { view, cut: -1, night: null });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

function figureRow(items: { c: HTMLCanvasElement | null; label: string }[], cls = 'row'): HTMLElement | null {
  if (!items.some((it) => it.c)) return null;
  const row = document.createElement('div');
  row.className = cls;
  for (const it of items) {
    if (!it.c) continue;
    const f = document.createElement('figure');
    f.append(it.c);
    const cap = document.createElement('figcaption');
    cap.textContent = it.label;
    f.append(cap);
    row.append(f);
  }
  return row;
}

/** Ряд образцов (пустой — ничего). */
function rowOf(items: { c: HTMLCanvasElement | null; label: string }[], cls = 'row'): HTMLElement[] {
  const r = figureRow(items, cls);
  return r ? [r] : [];
}

export function renderRoofsSheet(root: HTMLElement): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  root.innerHTML = `
    <header class="top">
      <p class="eyebrow">Лист вариантов · крыши и фасады</p>
      <h1>Крыши Верхнеречья</h1>
      <p class="lede">Сейчас у каждого дома виден план этажа: с улицы видно, кто где сидит. Здесь тот же город (сид ${SEED})
      тем же движком игры, но с крышами: с улицы — кровля и стена дома, внутрь видно только из самого дома. Выберите вид
      (А, Б или В) и как показывать дом, где вы находитесь (разрез целиком или только то, что видит персонаж).</p>
      <p class="loading" id="status">Генерация города…</p>
    </header>`;
  // Генерация занимает секунду-две — сначала покажем шапку.
  setTimeout(() => build(root), 30);
}

function build(root: HTMLElement): void {
  map = generateCity(SEED);
  mr = new MapRenderer(map);
  furniture = furnishMap(map);
  const buildings = computeBuildings(map, mr.heights);
  roofs = new RoofRenderer(map, buildings, mr.windows);
  root.querySelector('#status')?.remove();
  const w = map.width;
  // Куски города: проспект с лавками, переулок Слободы с коммуналками, квартал Верхнего города.
  // Очки — на мостовой перед лавкой (сторона фасада), и немного — любой улице: в кадре должна быть улица.
  const shops = new Float32Array(map.width * map.height);
  for (const p of map.poisOf('facade')) {
    if (p.use !== 'shop' && p.use !== 'cafe') continue;
    const fx = p.face === 'E' ? p.x + p.w! + 1 : p.face === 'W' ? p.x - 2 : p.x + (p.w! >> 1);
    const fy = p.face === 'S' ? p.y + p.h! + 1 : p.face === 'N' ? p.y - 2 : p.y + (p.h! >> 1);
    if (fx >= 0 && fy >= 0 && fx < w && fy < map.height) shops[fy * w + fx] += 10;
  }
  for (let i = 0; i < shops.length; i++) if (map.tiles[i] === T.STREET) shops[i] += 0.02;
  for (const p of map.poisOf('home')) if (!p.kind) shops[p.y * w + p.x] += 0.5;
  const slum = new Float32Array(map.width * map.height);
  const upper = new Float32Array(map.width * map.height);
  for (let i = 0; i < slum.length; i++) {
    const t = map.tiles[i];
    if (t === T.FLOOR || t === T.STREET) {
      slum[i] += 0.05;
      upper[i] += 0.05;
    }
  }
  for (const r of map.poisOf('room')) {
    const d = map.districtAt(r.x, r.y);
    if (d === 'slum' && (r.sub === 'room' || r.sub === 'corridor' || r.sub === 'kitchen')) slum[r.y * w + r.x] += 3;
    if (d === 'upper' && (r.sub === 'hall' || r.sub === 'living' || r.sub === 'bath' || r.sub === 'bedroom')) upper[r.y * w + r.x] += 3;
  }
  const F1 = fragment(shops, 1);
  const F2 = fragment(slum, 2);
  const F3 = fragment(upper, 3);
  const NIGHT = 0.92;

  const DN = { slum: 'Слобода', old: 'Старый город', upper: 'Верхний город' } as const;
  const where = DN[map.districtAt(F1.x + (VW >> 1), F1.y + (VH >> 1)) ?? 'old'];
  root.append(section(`Кусок 1 · проспект с лавками, ${where}`, 'Варианты вида с улицы',
    'Тот же момент, четыре способа нарисовать дома. Люди в домах и лавках есть во всех кадрах — на плане их видно, под крышей нет.', [
      card('0', 'Сейчас: план этажа', 'Комнаты, мебель и люди внутри видны с улицы — то, от чего уходим.', scene(F1, 'plan')),
      card('А', 'Крыша сверху', 'Строго сверху, как остальная карта: кровля во весь дом, над входом — козырёк с фонарём. Проще всего, ничего не перекрывает улицу.', scene(F1, 'top'), 'pick'),
      card('Б', '¾: фасад в контуре дома', 'Нижний ряд дома — стена к нам: окна, дверь, цоколь; выше — крыша. Дом остаётся в своих клетках, улицу не закрывает. Входы с другой стороны — козырёк.', scene(F1, 'facade'), 'pick'),
      card('В', '¾ с высотой', 'Крыша поднята на этажи, стена к югу во всю высоту — объёмнее всего, но дом закрывает кусок улицы за собой (там может стоять враг).', scene(F1, 'tall'), 'pick'),
    ]));
  root.append(section('Кусок 1 · игрок вошёл в свой дом', 'Как показать дом, где вы',
    'Персонаж (жёлтое кольцо) в двух шагах от двери. С остальных домов крыша не снимается.', [
      card('Б·1', 'Разрез: дом игрока целиком', 'Над своим домом крыши нет, контур — пунктиром; видны все комнаты и кто в них. Соседи под крышей.', scene(F1, 'cut'), 'pick'),
      card('Б·2', 'Видно только то, что видит игрок', 'Крыша «прозрачна» там, куда достают лучи обзора (как туман войны): комната перед глазами видна, за стеной — нет, в дверь видно улицу.', scene(F1, 'los'), 'pick'),
      card('В·1', '¾ с высотой, разрез своего дома', 'Тот же разрез при виде В: свой дом без крыши, остальные стоят во весь рост.', scene(F1, 'cutTall')),
    ]));
  root.append(section('Кусок 1 · ночь', 'Ночью',
    'Внутри по-прежнему не видно, но окна горят у кого не спят — свет из окна ложится на мостовую.', [
      card('Б·н', 'Вид Б ночью', 'Горящие окна на фасадах (у каждого свой час отбоя, как сейчас), пятна света на улице.', scene(F1, 'facade', NIGHT)),
      card('Б·1н', 'Ночью, игрок дома (разрез)', 'Свой дом изнутри освещён лампой, соседние — только окна.', scene(F1, 'cut', NIGHT)),
      card('А·н', 'Вид А ночью', 'Сверху стёкол не видно — только свет из окон на мостовой.', scene(F1, 'top', NIGHT)),
    ]));
  root.append(section('Кусок 2 · Слобода', 'Слобода: жесть и доски',
    'Переулок с коммуналками: кровля из волнистой жести с заплатами и ржавчиной, стены из досок, окна часто заколочены или в ставнях.', [
      card('0', 'Сейчас', 'План: коридоры коммуналок и комнаты.', scene(F2, 'plan')),
      card('А', 'Крыша сверху', 'Жесть волной, заплаты, жестяные трубы.', scene(F2, 'top')),
      card('Б', '¾ в контуре', 'Дощатые стены и окна Слободы.', scene(F2, 'facade')),
      card('В', '¾ с высотой', 'Низкие дома — подъём небольшой.', scene(F2, 'tall')),
    ]));
  root.append(section('Кусок 3 · Верхний город', 'Верхний город: плоские крыши',
    'Квартиры богатых: плоская кровля с парапетом, гравий, световые фонари, вентиляция и баки; стены облицованы камнем, окна парные.', [
      card('0', 'Сейчас', 'План: прихожие, кухни, спальни.', scene(F3, 'plan')),
      card('А', 'Крыша сверху', 'Парапет, фонари, вентиляция.', scene(F3, 'top')),
      card('Б', '¾ в контуре', 'Каменная облицовка, парные окна со шторами и цветами.', scene(F3, 'facade')),
      card('В', '¾ с высотой', 'Дома в 2–3 этажа — стена выше, окна в два ряда.', scene(F3, 'tall')),
    ]));

  // Ассеты.
  const assets = document.createElement('section');
  assets.className = 'part';
  assets.innerHTML = `<p class="eyebrow">Ассеты</p><h2>Материалы, стены, окна</h2>
    <p class="lede">Всё рисуется кодом из config/roofs.ts (цвета, размеры) — для правок не нужно художника: скажите, что
    темнее, светлее, другого цвета.</p>`;
  assets.append(document.createElement('h3'));
  assets.lastElementChild!.textContent = 'Кровля';
  assets.append(...rowOf([
    { c: roofSwatch('tin', ROOFS.slum.tin[1]), label: 'Слобода · ржавая жесть' },
    { c: roofSwatch('tin', ROOFS.slum.tin[0]), label: 'Слобода · серая жесть' },
    { c: roofSwatch('tile', ROOFS.old.tile[0]), label: 'Старый город · черепица' },
    { c: roofSwatch('slate', ROOFS.old.slate), label: 'Старый город · сланец' },
    { c: roofSwatch('flat', ROOFS.upper.flat[0]), label: 'Верхний город · плоская' },
    { c: roofSwatch('concrete', ROOFS.civic.flat), label: 'Казённые · бетон' },
  ]));
  assets.append(document.createElement('h3'));
  assets.lastElementChild!.textContent = 'Стена к улице (вид Б): 1, 2 и 3 этажа, день и ночь';
  const W = ROOFS.facade.wall;
  assets.append(...rowOf([
    { c: wallSwatch('slum', 'slum', W.slum[0], 1, false, ['plain', 'shutters', 'boarded', 'broken']), label: 'Слобода · доски, 1 этаж' },
    { c: wallSwatch('old', 'old', { h: 14, s: 32, l: 60 }, 2, false, ['curtains', 'flowers', 'plain']), label: 'Старый город · штукатурка, 2 этажа' },
    { c: wallSwatch('upper', 'upper', W.upper[0], 3, false, ['curtains', 'flowers']), label: 'Верхний город · камень, 3 этажа' },
    { c: wallSwatch('old', 'shop', { h: 205, s: 20, l: 60 }, 1, false, ['plain'], true), label: 'Лавка · витрины, стеклянная дверь' },
    { c: wallSwatch('civic', 'civic', W.civic[0], 2, false, ['plain']), label: 'Казённое · бетонные панели' },
    { c: wallSwatch('old', 'old', { h: 14, s: 32, l: 60 }, 2, true, ['curtains', 'flowers', 'plain']), label: 'Ночью: горят окна' },
  ], 'row three'));
  assets.append(document.createElement('h3'));
  assets.lastElementChild!.textContent = 'Окна: стиль × вид (просто, шторы, цветы, ставни, закрыто, заколочено, разбито)';
  assets.append(...rowOf([{ c: windowGrid(), label: 'Строки: Слобода, Старый город, Верхний город, лавка, казённое' }], 'row one'));
  assets.append(document.createElement('h3'));
  assets.lastElementChild!.textContent = 'Настоящие дома города: сверху (А), в контуре (Б), с высотой (В)';
  for (const st of ['tin', 'tile', 'slate', 'flat', 'concrete'] as RoofStyle[]) {
    const name = { tin: 'Жесть (Слобода)', tile: 'Черепица (Старый город)', slate: 'Сланец (Старый город)', flat: 'Плоская (Верхний город)', concrete: 'Бетон (казённые)' }[st];
    const row = figureRow([
      { c: sampleHouse(st, 'top'), label: `${name} · А` },
      { c: sampleHouse(st, 'facade'), label: `${name} · Б` },
      { c: sampleHouse(st, 'tall'), label: `${name} · В` },
    ], 'row three');
    if (row) assets.append(row);
  }
  root.append(assets);
}

const CSS = `
:root {
  /* Бумага инвентаря и удостоверения: хаки, толстые рамки, трафарет — как на листе одежды. */
  --paper: #d8d1bc; --card: #e6e0cd; --ink: #24231e; --muted: #5f5a4b; --rule: #2a2822; --chip: #cbc3aa; --pick: #7a2430;
  --f-display: "Oswald", "Arial Narrow", sans-serif; --f-body: "PT Sans Narrow", "Arial Narrow", sans-serif; --f-mono: "PT Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #1d1e1a; --card: #272822; --ink: #e8e3d2; --muted: #a49d88; --rule: #4a473d; --chip: #34352d; --pick: #d07080; color-scheme: dark } }
:root[data-theme="dark"] {
  --paper: #1d1e1a; --card: #272822; --ink: #e8e3d2; --muted: #a49d88; --rule: #4a473d; --chip: #34352d; --pick: #d07080; color-scheme: dark }
body { background: var(--paper); color: var(--ink); font: 16px/1.45 var(--f-body); }
#sheet { max-width: 1240px; margin: 0 auto; padding-block: 28px 56px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: flex; flex-direction: column; gap: 22px; }
.top { display: flex; flex-direction: column; gap: 6px; }
.eyebrow { font: 600 12px/1 var(--f-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 0; }
h1 { font: 600 clamp(30px, 5vw, 48px)/1.05 var(--f-display); text-transform: uppercase; letter-spacing: .02em; margin: 0; text-wrap: balance; }
h2 { font: 600 28px/1.1 var(--f-display); text-transform: uppercase; margin: 0; text-wrap: balance; }
h3 { font: 600 18px/1.2 var(--f-display); text-transform: uppercase; margin: 10px 0 0; }
.lede { max-width: 72ch; margin: 0; font-size: 17px; }
.loading { font: 14px/1 var(--f-mono); color: var(--muted); margin: 6px 0 0; }
.part { display: flex; flex-direction: column; gap: 10px; padding-top: 18px; border-top: 3px solid var(--rule); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr)); gap: 14px; }
.card { background: var(--card); border: 3px solid var(--rule); border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.card.pick { border-color: var(--pick); }
.card header { display: flex; align-items: baseline; gap: 10px; }
.code { font: 700 15px/1 var(--f-mono); padding: 4px 6px; border: 2px solid var(--rule); border-radius: 3px; white-space: nowrap; }
.pick .code { color: var(--pick); border-color: var(--pick); }
.card h3 { margin: 0; font-size: 20px; }
.card figure { margin: 0; border: 2px solid var(--rule); border-radius: 3px; overflow: hidden; background: #2a2622; }
canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.card p { margin: 0; font-size: 15px; }
.row { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 12px; }
.row.three { grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
.row.one { grid-template-columns: minmax(0, 760px); }
.row figure { margin: 0; border: 2px solid var(--rule); border-radius: 3px; overflow: hidden; background: #2a2622; display: flex; flex-direction: column; }
.row figcaption { font: 11px/1.3 var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding: 6px 8px; border-top: 2px solid var(--rule); background: var(--chip); margin-top: auto; }
`;

const root = document.getElementById('sheet');
if (root) renderRoofsSheet(root);
