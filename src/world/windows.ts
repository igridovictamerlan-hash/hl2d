/** Описание системы — docs/rendering.md («Окна и тени»). */
import type { GameMap, District, Poi } from './GameMap';
import { T } from './tiles';
import { hash2, hash01 } from '../core/rng';
import { RENDER } from '../config/render';
import { LIGHTING } from '../config/lighting';

/** Вид окна по зданию: полоса достатка дома, витрина лавки, казённое здание. */
export type WindowStyle = 'slum' | 'old' | 'upper' | 'shop' | 'civic';
/** Что видно в окне: просто стекло, шторы, ящик с цветами, ставни открыты / закрыты, заколочено, разбито. */
export type WindowLook = 'plain' | 'curtains' | 'flowers' | 'shutters' | 'closed' | 'boarded' | 'broken';

/**
 * Окно на тайле стены. out — сторона улицы (0 — север, 1 — восток, 2 — юг, 3 — запад); pair — окно на два тайла:
 * 1 — половина с меньшей координатой вдоль стены, 2 — с большей, 0 — окно в один тайл. tint — номер цвета
 * штор / ставен / цветов (общий у комнаты); lit — ночью горит свет; off — час отбоя, wake — час утреннего
 * света (доли суток, после полуночи — больше 1; wake < 0 — утром не зажигается), общие у половин парного окна;
 * room — комната (связный пол) за окном.
 */
export interface WindowSpot {
  x: number;
  y: number;
  out: 0 | 1 | 2 | 3;
  style: WindowStyle;
  look: WindowLook;
  pair: 0 | 1 | 2;
  tint: number;
  lit: boolean;
  off: number;
  wake: number;
  room: number;
}

/** Горит ли окно (lit) в долю суток f: до отбоя и с утреннего света (днём свет окон гасит само освещение). */
export function windowOn(o: { off: number; wake: number }, f: number): boolean {
  const g = f < 0.5 ? f + 1 : f;
  return g < o.off || (o.wake >= 0 && g >= o.wake);
}

/** Смещение на соседа по стороне (0 — север, 1 — восток, 2 — юг, 3 — запад). */
export const SIDE_DX = [0, 1, 0, -1] as const;
export const SIDE_DY = [-1, 0, 1, 0] as const;

/** Куда может смотреть окно: улица, переулок, двор, сад, площадь, пустырь, берег. */
const OUTDOOR = new Set<number>([T.FLOOR, T.STREET, T.PLAZA, T.COURTYARD, T.GARDEN, T.WASTE, T.SHORE]);

const LOOKS: readonly WindowLook[] = ['plain', 'curtains', 'flowers', 'shutters', 'closed', 'boarded', 'broken'];

/** Вид окна по весам looks стиля; r — 0..1. */
function pickLook(style: WindowStyle, r: number): WindowLook {
  const w = RENDER.windows.style[style].looks as Partial<Record<WindowLook, number>>;
  let sum = 0;
  for (const k of LOOKS) sum += w[k] ?? 0;
  let acc = 0;
  for (const k of LOOKS) {
    acc += (w[k] ?? 0) / sum;
    if (r < acc) return k;
  }
  return 'plain';
}

/**
 * Окна города: детерминированно по тайлам и seed (случайность мира не тратится), без DOM — одна расстановка для
 * отрисовки (MapRenderer) и ночного света (Lighting). Кандидат — тайл стены (WALL), у которого ровно один сосед —
 * пол комнаты (INTERIOR), напротив него — улица (OUTDOOR), а вдоль стены с обеих сторон — тоже стена (не угол, не
 * дверь: у двери и угла — простенок; витрина лавки — и у самой двери). Кандидаты идут отрезками вдоль стены; в отрезке окна — через every тайлов,
 * узор посередине отрезка. Комнате, которой иначе окна не досталось бы (тесный дом), — одно окно у самой двери.
 */
export function computeWindows(map: GameMap): WindowSpot[] {
  const { width: w, height: h, tiles } = map;
  const n = w * h;
  const seed = map.seed | 0;
  const W = RENDER.windows;
  // Комнаты — связные куски пола.
  const room = new Int32Array(n).fill(-1);
  let rooms = 0;
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (tiles[i] !== T.INTERIOR || room[i] >= 0) continue;
    room[i] = rooms;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j - x) / w;
      for (let s = 0; s < 4; s++) {
        const nx = x + SIDE_DX[s];
        const ny = y + SIDE_DY[s];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (tiles[k] === T.INTERIOR && room[k] < 0) {
          room[k] = rooms;
          stack.push(k);
        }
      }
    }
    rooms++;
  }
  // Дома вдоль улиц (POI facade): назначение и сторона фасада.
  const facadeOf = new Int32Array(n).fill(-1);
  const facades = map.poisOf('facade');
  facades.forEach((p, k) => {
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (x >= 0 && y >= 0 && x < w && y < h) facadeOf[y * w + x] = k;
  });
  const faceSide = (f: Poi['face']): number => (f === 'N' ? 0 : f === 'E' ? 1 : f === 'S' ? 2 : 3);
  const zones = new Set(W.zones);
  const styleOf = (x: number, y: number, inside: number, out: number, street: boolean): WindowStyle | null => {
    const fk = facadeOf[y * w + x];
    if (fk >= 0) {
      const p = facades[fk];
      if ((p.use === 'shop' || p.use === 'cafe') && out === faceSide(p.face)) return 'shop';
      if (p.use === 'canteen') return 'civic';
    } else {
      const kind = map.zones[map.zoneGrid[inside]]?.kind;
      if (!kind || !zones.has(kind)) return null;
      if (kind === 'cwu_hq' || kind === 'canteen') return 'civic';
      // Лавка не в ряду домов (stampShop): витрина — на улицу или площадь.
      if (kind === 'shop' && street) return 'shop';
    }
    const d: District | null = map.districtAt(x, y);
    return d ?? 'old';
  };
  // Кандидаты: сторона улицы и стиль на тайл; у самой двери — запасные (если у комнаты иначе не будет окна).
  const cand = new Int8Array(n).fill(-1);
  const candStyle: (WindowStyle | null)[] = new Array(n).fill(null);
  const byDoor: { i: number; out: number; st: WindowStyle }[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (tiles[i] !== T.WALL) continue;
      let inside = -1;
      let count = 0;
      for (let s = 0; s < 4; s++) {
        if (tiles[i + SIDE_DY[s] * w + SIDE_DX[s]] === T.INTERIOR) {
          inside = s;
          count++;
        }
      }
      if (count !== 1) continue;
      const out = (inside + 2) & 3;
      const outer = tiles[i + SIDE_DY[out] * w + SIDE_DX[out]];
      if (!OUTDOOR.has(outer)) continue;
      const st = styleOf(x, y, i + SIDE_DY[inside] * w + SIDE_DX[inside], out, outer === T.STREET || outer === T.PLAZA);
      if (!st) continue;
      // Вдоль стены (поперёк стороны улицы) — стена с обеих сторон; витрина может стоять и у самой двери.
      const ax = SIDE_DY[out] !== 0 ? 1 : 0;
      const ay = 1 - ax;
      const side = (t: number) => t === T.WALL || (st === 'shop' && t === T.DOOR);
      const a1 = tiles[i + ay * w + ax];
      const a2 = tiles[i - ay * w - ax];
      if (!side(a1) || !side(a2)) {
        if ((a1 === T.DOOR && a2 === T.WALL) || (a1 === T.WALL && a2 === T.DOOR)) byDoor.push({ i, out, st });
        continue;
      }
      cand[i] = out;
      candStyle[i] = st;
    }
  }
  // Окно на тайле j: вид — по тайлу; цвет штор и ставен, горит ли ночью — общие у комнаты; час отбоя — свой.
  const out: WindowSpot[] = [];
  const LW = LIGHTING.window;
  const add = (j: number, o: number, st: WindowStyle, rm: number, pair: 0 | 1 | 2, shared?: WindowSpot) => {
    const S = W.style[st];
    const key = rm >= 0 ? rm : j;
    const look = shared?.look ?? pickLook(st, hash01(j, 41, seed));
    const r1 = hash01(j, 43, seed);
    const r2 = hash01(j, 47, seed);
    const spot: WindowSpot = {
      x: j % w,
      y: Math.floor(j / w),
      out: o as 0 | 1 | 2 | 3,
      style: st,
      look,
      pair,
      tint: hash2(key, 31, seed),
      lit: hash01(key, 37, seed) < S.lit && look !== 'boarded' && look !== 'broken' && look !== 'closed',
      off: shared?.off ?? LW.off[0] + r1 * (LW.off[1] - LW.off[0]),
      wake: shared?.wake ?? (r2 < LW.wakeShare ? LW.wake[0] + (r2 / LW.wakeShare) * (LW.wake[1] - LW.wake[0]) : -1),
      room: rm,
    };
    out.push(spot);
    return spot;
  };
  // Отрезки вдоль стены: одна сторона улицы, один стиль, одна комната.
  const roomBehind = (i: number, o: number) => room[i - SIDE_DY[o] * w - SIDE_DX[o]];
  const done = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (cand[i] < 0 || done[i]) continue;
    const o = cand[i];
    const st = candStyle[i]!;
    const rm = roomBehind(i, o);
    const step = SIDE_DY[o] !== 0 ? 1 : w;
    // Начало отрезка — назад, пока тот же кандидат (тайлы обходятся по возрастанию, начало уже первое).
    const run: number[] = [];
    for (let j = i; j < n && cand[j] === o && candStyle[j] === st && roomBehind(j, o) === rm && !done[j]; j += step) {
      run.push(j);
      done[j] = 1;
      if (step === 1 && (j + 1) % w === 0) break;
    }
    const S = W.style[st];
    const len = run.length;
    const unit = S.pair && len >= 2 ? 2 : 1;
    const every = Math.max(S.every, unit);
    const count = Math.floor((len - unit) / every) + 1;
    const used = (count - 1) * every + unit;
    const off = Math.floor((len - used) / 2);
    for (let k = 0; k < count; k++) {
      const p = off + k * every;
      const first = add(run[p], o, st, rm, unit === 2 ? 1 : 0);
      if (unit === 2) add(run[p + 1], o, st, rm, 2, first);
    }
  }
  // Комната без единого окна (тесный дом: на улицу — только стена с дверью) — окно у самой двери.
  const withWindow = new Set(out.map((o) => o.room));
  const spare = new Map<number, { i: number; out: number; st: WindowStyle; r: number }>();
  for (const c of byDoor) {
    const rm = roomBehind(c.i, c.out);
    if (rm < 0 || withWindow.has(rm)) continue;
    const r = hash2(c.i, 53, seed);
    const best = spare.get(rm);
    if (!best || r < best.r) spare.set(rm, { ...c, r });
  }
  for (const [rm, c] of spare) add(c.i, c.out, c.st, rm, 0);
  return out;
}
