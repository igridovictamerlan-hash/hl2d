import { generateCity } from '../world/generator/CityGenerator';
import { MapRenderer } from '../world/MapRenderer';
import { furnishMap } from '../world/furnish';
import { drawFurnitureList } from '../world/FurnitureRenderer';
import type { Building, BuildingKind } from '../world/buildings';
import { RoofLayer } from '../world/RoofLayer';
import { facadeHeight, facadeKit, type Family, type FacadeKit } from '../world/facadeStyle';
import { bayCenters, drawLit, emptyRecord, gable, litAt, paintFacade, paintRoof } from '../world/FacadeRenderer';
import { drawPawnFigure } from '../ui/pawnFigure';
import type { PawnDir, PawnLook } from '../entities/PawnRenderer';
import { CLOTHES } from '../config/clothes';
import { PAWN } from '../config/pawns';
import { CP_UNIT, colorsOf } from '../config/factions';
import { FACADES } from '../config/facades';
import { hash2 } from '../core/rng';
import { T } from '../world/tiles';
import type { District, GameMap } from '../world/GameMap';
import type { View } from '../core/Camera';

/**
 * Лист «Крыши и фасады» (dev-страница sheets/roofs.html): настоящий город (сид SEED) тем же слоем крыш, что игра
 * (world/RoofLayer.ts) — план этажа для сравнения, вид Б днём, дом игрока в разрезе, ночь со светом окон; галерея
 * семейств фасадов крупно (world/FacadeRenderer.ts).
 */
const SEED = 12345;
/** CSS px на пиксель мира и размер кадра в тайлах. */
const SCALE = 2;
const VW = 24;
const VH = 22;
const TS = 16;

type Mode = 'plan' | 'facade' | 'cut';
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
let roofs: RoofLayer;
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
  return roofs.of[ty * map.width + tx];
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
  const list = roofs.list.filter((b) => b.x1 >= x && b.y1 >= y && b.x0 < x + VW && b.y0 < y + VH);
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
      for (const j of [i, i + 1, i + w, i + w + 1]) if (roofs.of[j] !== home.id) own = false;
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
    const spots = b.tiles.filter((i) => map.tiles[i] === T.INTERIOR && walkable(i % w, Math.floor(i / w)) && roofs.of[i] === b.id);
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
      if ((t === T.STREET || t === T.FLOOR || t === T.PLAZA) && walkable(ax, ay) && roofs.of[ay * w + ax] < 0) street.push(ay * w + ax);
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
    ctx.strokeStyle = FACADES.cut.outline;
    ctx.lineWidth = 2 * (k / SCALE);
    ctx.beginPath();
    ctx.ellipse(sx, foot, 9 * k / SCALE * 1.4, 4 * k / SCALE * 1.4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  drawPawnFigure(ctx, p.look, null, sx, foot, ps, p.dir);
}

/** Кадр куска города f: план этажа, вид Б или дом игрока в разрезе; night — доля суток ночью (иначе день). */
function scene(f: Frag, mode: Mode, night: number | null = null): HTMLCanvasElement {
  const [c, ctx, dpr] = canvas(VW * TS * SCALE, VH * TS * SCALE);
  const v: View = { left: f.x * TS, top: f.y * TS, scale: SCALE * dpr, width: c.width, height: c.height };
  mr.draw(ctx, v, night === null ? 0.42 : null);
  drawFurnitureList(ctx, v, furniture);
  const byY = (a: Pawn, b: Pawn) => a.y - b.y;
  if (mode === 'plan') {
    for (const p of [...f.pawns].sort(byY)) drawPawn(ctx, p, v);
  } else {
    // Как в игре: крыши поверх тех, кто внутри; разрезанный дом — без крыши, с контуром; кто на улице — поверх крыш.
    const cut = mode === 'cut' && f.home ? f.home.id : -1;
    roofs.setCut(cut);
    roofs.update(10);
    roofs.prebuild((f.x + VW / 2) * TS, (f.y + VH / 2) * TS, (VW + VH) * TS);
    roofs.draw(ctx, v);
    if (cut >= 0) roofs.outline(ctx, v, cut);
    for (const p of [...f.pawns].sort(byY)) if (roofs.roofAlpha(p.x, p.y) < 1) drawPawn(ctx, p, v);
  }
  if (night !== null) {
    // Ночь: затемнение, свет окон на мостовую, горящие окна и фонари поверх.
    ctx.fillStyle = 'rgba(6,10,28,0.7)';
    ctx.fillRect(0, 0, c.width, c.height);
    if (mode !== 'plan') {
      const k = v.scale;
      const N = FACADES.night;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      roofs.forEachLight(v, night, (x, y, power) => {
        const g = ctx.createRadialGradient((x - v.left) * k, (y - v.top) * k, 0, (x - v.left) * k, (y - v.top) * k, N.spillR * k);
        g.addColorStop(0, `rgba(255,190,110,${(0.22 * power).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,190,110,0)');
        ctx.fillStyle = g;
        ctx.fillRect((x - v.left - N.spillR) * k, (y - v.top - N.spillR) * k, N.spillR * 2 * k, N.spillR * 2 * k);
      });
      ctx.restore();
      roofs.drawLit(ctx, v, night, 1);
      const home = mode === 'cut' ? f.home : null;
      if (home) {
        // Свой дом ночью — лампа внутри.
        ctx.setTransform(k, 0, 0, k, -v.left * k, -v.top * k);
        ctx.fillStyle = 'rgba(255,196,120,0.16)';
        for (const i of home.tiles) if (map.tiles[i] !== T.WALL) ctx.fillRect((i % map.width) * TS, Math.floor(i / map.width) * TS, TS, TS);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (const p of f.pawns) if (buildingAt(p.x, p.y) === home.id) drawPawn(ctx, p, v);
      }
    }
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

/** Набор деталей нужного семейства для образца: перебор зерна, пока facadeKit не выберет это семейство. */
function kitFor(family: Family, width: number, salt: number, storeys: number, over: Partial<FacadeKit> = {}): FacadeKit {
  const district: District = family === 'slum' ? 'slum' : family === 'london' || family === 'grand' ? 'upper' : 'old';
  const kind: BuildingKind = family === 'civic' ? 'civic' : family === 'grand' && salt % 2 ? 'villa' : 'house';
  let k = facadeKit(fakeBuilding(salt, kind, district, width, storeys), width);
  for (let id = salt + 1; k.family !== family && id < salt + 400; id++) k = facadeKit(fakeBuilding(id, kind, district, width, storeys), width);
  return { ...k, ...over };
}

function fakeBuilding(id: number, kind: BuildingKind, district: District, w: number, storeys: number): Building {
  return { id, kind, district, x0: id % 97, y0: (id * 7) % 89, x1: (id % 97) + w - 1, y1: (id * 7) % 89 + 6, tiles: [], storeys, doors: [], facade: null };
}

interface Sample {
  family: Family;
  w: number;
  storeys?: number;
  over?: Partial<FacadeKit>;
  sign?: string;
  /** Дверь: тайл от левого края (две клетки), -1 — без двери. */
  door?: number;
}

/** Улица из образцов: дома вплотную, крыша на 9 тайлов вглубь, мостовая перед фасадами; ночью — свет окон. */
function street(samples: Sample[], night: number | null = null, scale = 2.5): HTMLCanvasElement {
  const depth = 9 * TS;
  const pad = TS;
  const W = samples.reduce((a, q) => a + q.w, 0) * TS + pad * 2;
  const H = depth + 3 * TS + 8;
  const [c, ctx, dpr] = canvas(W * scale, H * scale);
  const k = scale * dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  // Небо над крышами и мостовая.
  ctx.fillStyle = '#2b2824';
  ctx.fillRect(0, 0, W, H);
  const bottom = depth + 6;
  ctx.fillStyle = '#56504a';
  ctx.fillRect(0, bottom, W, H - bottom);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = bottom + 3; y < H; y += 4) for (let x = (y >> 2) % 2 ? 0 : 3; x < W; x += 6) ctx.fillRect(x, y, 5, 1);
  const rec = emptyRecord();
  let x = pad;
  const kits: { kit: FacadeKit; X0: number; X1: number; q: Sample }[] = [];
  samples.forEach((q, n) => {
    const kit = kitFor(q.family, q.w, 1000 + n * 37 + q.w, q.storeys ?? 3, q.over);
    kits.push({ kit, X0: x, X1: x + q.w * TS, q });
    x += q.w * TS;
  });
  for (const { kit, X0, X1, q } of kits) {
    const storeys = q.storeys ?? kit.storeys;
    const eave = bottom - facadeHeight(kit, storeys);
    const gabled = kit.roof === 'ns' && (kit.top === 'step' || kit.top === 'neck' || kit.top === 'bell' || kit.top === 'spout');
    const dormers: number[] = [];
    if (kit.dormers && !gabled) {
      const xs = bayCenters(kit, X0, X1);
      xs.forEach((x, i) => {
        if (kit.roof === 'mansard' || xs.length <= 2 || i % 2 === 1) dormers.push(x);
      });
    }
    const chimneys = gabled ? [Math.round((X0 + X1) / 2)] : [X0 + 6, X1 - 7];
    ctx.save();
    ctx.beginPath();
    ctx.rect(X0, bottom - depth, X1 - X0, depth);
    ctx.clip();
    paintRoof(ctx, kit, X0, bottom - depth, X1, bottom, eave, { dormers, chimneys }, rec);
    ctx.restore();
    ctx.fillStyle = FACADES.seam;
    ctx.fillRect(X0, bottom - depth, 1, depth);
    const d = q.door ?? Math.max(0, Math.round(q.w / 2) - 1);
    const doors = d >= 0 ? [{ x0: X0 + d * TS, x1: X0 + (d + 2) * TS }] : [];
    paintFacade(ctx, kit, { X0, X1, bottom, storeys, doors, sign: q.sign ?? null, gable: gabled }, rec);
    if (gabled) gable(ctx, kit, X0, X1, bottom - facadeHeight(kit, storeys), rec, eave - (bottom - depth) - 3);
  }
  if (night !== null) {
    ctx.fillStyle = 'rgba(6,10,28,0.7)';
    ctx.fillRect(0, 0, W, H);
    // Свет окон на мостовую перед фасадом.
    const N = FACADES.night;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const spill = (x: number, y: number, power: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, N.spillR);
      g.addColorStop(0, `rgba(255,190,110,${(0.22 * power).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - N.spillR, y - N.spillR, N.spillR * 2, N.spillR * 2);
    };
    for (const w of rec.windows) if (w.storey <= 3 && litAt(night, w.seed, w.key, w.share)) spill(w.x + w.w / 2, w.street + N.spill, w.storey === 0 ? 1 : N.upper);
    for (const l of rec.lamps) spill(l.x, l.street + N.spill, N.lampPower);
    ctx.restore();
    drawLit(ctx, rec, night, 1);
  }
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
      <p class="eyebrow">Лист вариантов · вид Б · европейский город</p>
      <h1>Крыши Верхнеречья</h1>
      <p class="lede">Вид Б (¾, фасад в контуре дома), дом игрока — разрезом. Фасады — по образцу Амстердама, Мюнхена и
      Лондона: кирпич с перевязкой, штукатурка, руст, камень; окна с переплётами, наличниками и подоконниками; двери с
      фрамугой и пилястрами; щипцы, эркеры, балконы, витрины лавок. Крыши только скатные: черепица, шифер, медь;
      слуховые окна, трубы с горшками, вальмы и мансарды. Город — тот же (сид ${SEED}), тем же движком.</p>
      <p class="loading" id="status">Генерация города…</p>
    </header>`;
  // Генерация занимает секунду-две — сначала покажем шапку.
  setTimeout(() => build(root), 30);
}

function build(root: HTMLElement): void {
  map = generateCity(SEED);
  mr = new MapRenderer(map);
  furniture = furnishMap(map);
  roofs = new RoofLayer(map, mr.heights);
  const buildings = { list: roofs.list };
  root.querySelector('#status')?.remove();
  const w = map.width;
  const n = map.width * map.height;
  // Куски города: проспект с лавками в Старом городе, переулок Слободы, улица Верхнего города.
  const shops = new Float32Array(n);
  const slum = new Float32Array(n);
  const upper = new Float32Array(n);
  for (const p of map.poisOf('facade')) {
    if (p.use !== 'shop' && p.use !== 'cafe') continue;
    const fx = p.face === 'E' ? p.x + p.w! + 1 : p.face === 'W' ? p.x - 2 : p.x + (p.w! >> 1);
    const fy = p.face === 'S' ? p.y + p.h! + 1 : p.face === 'N' ? p.y - 2 : p.y + (p.h! >> 1);
    if (fx >= 0 && fy >= 0 && fx < w && fy < map.height) shops[fy * w + fx] += map.districtAt(fx, fy) === 'old' ? 10 : 2;
  }
  for (let i = 0; i < n; i++) {
    const t = map.tiles[i];
    if (t === T.STREET) shops[i] += 0.02;
    if (t === T.FLOOR || t === T.STREET) {
      slum[i] += 0.05;
      upper[i] += 0.05;
    }
  }
  // Фасады к югу над открытым местом — их и показываем.
  for (const b of buildings.list) {
    if (b.kind === 'mass') continue;
    for (const d of b.doors) {
      if (d.side !== 2) continue;
      const i = d.y * w + d.x;
      if (b.district === 'slum') slum[i] += 3;
      if (b.district === 'upper') upper[i] += 3;
      if (b.district === 'old') shops[i] += 1;
    }
  }
  const F1 = fragment(shops, 1);
  const F2 = fragment(slum, 2);
  const F3 = fragment(upper, 3);
  const NIGHT = 0.92;
  const DN = { slum: 'Слобода', old: 'Старый город', upper: 'Верхний город' } as const;
  const where = (f: Frag) => DN[map.districtAt(f.x + (VW >> 1), f.y + (VH >> 1)) ?? 'old'];

  root.append(section(`Кусок 1 · проспект с лавками, ${where(F1)}`, 'Вид Б днём и ночью',
    'С улицы — крыша и фасад, внутрь не видно. Игрок (жёлтое кольцо) вошёл в свой дом — с него крыша снята.', [
      card('0', 'Сейчас: план этажа', 'Для сравнения: комнаты и люди внутри видны с улицы.', scene(F1, 'plan')),
      card('Б', 'Вид Б днём', 'Скатные крыши и фасады по семействам; на первом этаже лавок — витрины с фризом и надписью.', scene(F1, 'facade'), 'pick'),
      card('Б·1', 'Игрок дома, разрез', 'Свой дом без крыши, контур пунктиром; соседи — под крышами.', scene(F1, 'cut'), 'pick'),
      card('Б·1н', 'Ночью, игрок дома', 'Горят окна у кого не спят, фонари у дверей; свой дом освещён лампой.', scene(F1, 'cut', NIGHT), 'pick'),
    ]));
  root.append(section(`Кусок 2 · ${where(F2)}`, 'Рабочий квартал',
    'Закопчённый кирпич и облезлая штукатурка, ставни, заколоченные и разбитые окна, плакаты, бельё; на черепице и шифере — жесть заплатами.', [
      card('Б', 'Днём', 'Узкие дома со свесом крыши, водостоки, трубы.', scene(F2, 'facade'), 'pick'),
      card('Б·1н', 'Ночью, игрок дома', 'Свет — в редких окнах.', scene(F2, 'cut', NIGHT), 'pick'),
    ]));
  root.append(section(`Кусок 3 · ${where(F3)}`, 'Богатые улицы',
    'Лондонские террасы и каменные доходные дома: руст первого этажа, балконы с решёткой, двери с фрамугой, мансарды с слуховыми окнами.', [
      card('Б', 'Днём', 'Шифер и медь, трубы с горшками на брандмауэрах.', scene(F3, 'facade'), 'pick'),
      card('Б·1', 'Игрок дома', 'Разрез своего дома.', scene(F3, 'cut'), 'pick'),
    ]));

  // Галерея: улицы из образцов — семейства фасадов крупно.
  const g = document.createElement('section');
  g.className = 'part';
  g.innerHTML = `<p class="eyebrow">Ассеты · фасады и крыши</p><h2>Семейства домов</h2>
    <p class="lede">Каждый дом города получает семейство по району и ширине, остальное — по своему хэшу: материал, цвет,
    окна, дверь, верх, крыша. Ниже — те же функции, что рисуют город, крупно. Цвета и размеры — config/facades.ts.</p>`;
  g.append(...rowOf([{ c: street([
    { family: 'amsterdam', w: 5, over: { top: 'step', roof: 'ns' } },
    { family: 'amsterdam', w: 4, over: { top: 'neck', roof: 'ns' } },
    { family: 'amsterdam', w: 5, over: { top: 'bell', roof: 'ns' }, sign: 'Табак' },
    { family: 'amsterdam', w: 6, over: { top: 'spout', roof: 'ns' } },
    { family: 'amsterdam', w: 4, over: { top: 'step', roof: 'ns' } },
    { family: 'amsterdam', w: 7, over: { top: 'cornice', roof: 'ew', dormers: true } },
  ]), label: 'Старый город · Амстердам: кирпич, белые наличники и замковые камни, щипцы ступенями, с шеей, колоколом; балка для подъёма грузов' }], 'row one'));
  g.append(...rowOf([{ c: street([
    { family: 'munich', w: 9, over: { top: 'eave', roof: 'ew', oriel: true, dormers: true } },
    { family: 'munich', w: 7, over: { top: 'eave', roof: 'ew', dormers: true } },
    { family: 'munich', w: 6, over: { top: 'step', roof: 'ns' } },
    { family: 'munich', w: 9, over: { top: 'eave', roof: 'ew', dormers: true }, sign: 'Пекарня' },
  ]), label: 'Старый город · Мюнхен: штукатурка в цвет, крашеные наличники, ставни, герань, эркер, черепица со слуховыми окнами' }], 'row one'));
  g.append(...rowOf([{ c: street([
    { family: 'london', w: 7, storeys: 4, over: { top: 'parapet', roof: 'mansard' } },
    { family: 'london', w: 7, storeys: 4, over: { top: 'parapet', roof: 'mansard' } },
    { family: 'london', w: 8, storeys: 3, over: { top: 'cornice', roof: 'ew', porch: 'portico' } },
    { family: 'grand', w: 10, storeys: 4, over: { roof: 'hip', roofMat: 'slate' } },
  ]), label: 'Верхний город · Лондон: руст первого этажа, кирпич или штукатурка, балкон с решёткой, мансарда; каменный доходный дом с вальмой' }], 'row one'));
  g.append(...rowOf([{ c: street([
    { family: 'slum', w: 6, storeys: 2, over: { top: 'eave', roof: 'ew', laundry: true } },
    { family: 'slum', w: 5, storeys: 2, over: { top: 'spout', roof: 'ns' } },
    { family: 'slum', w: 7, storeys: 3, over: { top: 'eave', roof: 'ew', posters: true } },
    { family: 'slum', w: 6, storeys: 2, over: { top: 'eave', roof: 'ew' }, sign: 'Лавка' },
  ]), label: 'Слобода: закопчённый кирпич, облезлая штукатурка, заколоченные окна, плакаты, бельё, жесть заплатами' }], 'row one'));
  g.append(...rowOf([{ c: street([
    { family: 'civic', w: 15, storeys: 3, over: { roof: 'hip', roofMat: 'copper', banners: true } },
    { family: 'civic', w: 11, storeys: 3, over: { roof: 'hip', roofMat: 'slate', wall: 'brick', wallColor: { h: 12, s: 28, l: 25 }, ground: 'brick', groundColor: { h: 12, s: 28, l: 25 }, banners: false, posters: true } },
  ]), label: 'Казённые: камень, портик, медная вальма, полотнища Протектората; общежитие — кирпич с плакатами' }], 'row one'));
  g.append(...rowOf([{ c: street([
    { family: 'amsterdam', w: 5, over: { top: 'step', roof: 'ns' } },
    { family: 'amsterdam', w: 5, over: { top: 'bell', roof: 'ns' }, sign: 'Табак' },
    { family: 'munich', w: 9, over: { top: 'eave', roof: 'ew', oriel: true, dormers: true } },
    { family: 'london', w: 7, storeys: 4, over: { top: 'parapet', roof: 'mansard' } },
  ], NIGHT), label: 'Ночью: горят окна у кого не спят, витрины, фонари у дверей' }], 'row one'));
  root.append(g);
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
