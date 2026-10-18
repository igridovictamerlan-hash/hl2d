/** Описание системы — docs/war.md. */
import type { AiContext } from '../ai/AiContext';
import type { Front } from './WarSystem';
import type { Vec2 } from '../core/math';
import { WAR } from '../config/war';
import { CROUCH } from '../config/tactics';
import { canSeeCircle, castRay } from '../world/visibility';
import { inTrench, trenchCover } from '../world/trench';
import { blockToward } from '../ai/Tactics';
import { AStar } from '../ai/AStar';
import { T } from '../world/tiles';
import { poiWorld } from './Population';

/** Чем прикрыта позиция от поста, на который смотрит. */
export type LineCover = 'trench' | 'block' | 'corner';

/**
 * Огневая позиция линии фронта (WAR.line): якорь на «своей» стороне линии соприкосновения, откуда виден пост
 * Протектората следующей точки и есть укрытие к нему.
 */
export interface LinePos {
  anchor: number;
  x: number;
  y: number;
  /** Сколько точек КПП держат повстанцы, когда позиция актуальна (0 — пустошь перед КПП, 1 — внешний двор). */
  held: number;
  cover: LineCover;
  /** Пост, на который смотрит позиция (ближайший видимый), и расстояние до него. */
  aim: Vec2;
  dist: number;
  /** Сколько px пути от лагеря простреливается с постов КПП (чем меньше, тем безопаснее подход). */
  exposure: number;
  score: number;
}

const COVER_SCORE: Readonly<Record<LineCover, number>> = { trench: 30, block: 20, corner: 10 };

/** Все четыре тайла под якорем 2×2 с центром (x, y) — траншея (боец не вылезет из неё, чуть сместившись). */
function inTrenchFull(ctx: AiContext, x: number, y: number): boolean {
  const ts = ctx.map.tileSize;
  const tx = Math.round(x / ts);
  const ty = Math.round(y / ts);
  for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) if (ctx.map.tileAt(tx + dx, ty + dy) !== T.TRENCH) return false;
  return inTrench(ctx.map, x, y);
}

/** Чем позиция (x, y) прикрыта от точки (tx, ty); null — открыта. */
function coverToward(ctx: AiContext, x: number, y: number, tx: number, ty: number, d: number): LineCover | null {
  const map = ctx.map;
  if (inTrenchFull(ctx, x, y) && trenchCover(map, x, y, tx, ty)) return 'trench';
  if (blockToward(ctx, x, y, tx, ty)) return 'block';
  // Угол: центр луча упирается в стену/скалу у самого стрелка, но пост виден краем (canSeeCircle).
  const hit = castRay(map, x, y, (tx - x) / d, (ty - y) / d, d);
  return hit < d - 1e-6 && hit <= CROUCH.coverReach ? 'corner' : null;
}

/**
 * Огневые позиции линии фронта f при held захваченных точках: якоря пустоши перед КПП (held 0) или пола внешней
 * точки (held 1), откуда виден хотя бы один пост следующей точки на дистанции WAR.line.minRange…maxRange и есть
 * укрытие к нему. Отсортированы по качеству (траншея, блок, угол; короче путь под прицелом постов и ближе к середине дальности), не ближе
 * WAR.line.spacing друг к другу, не больше WAR.line.max. Пусто — на таком КПП линии нет (например, классика).
 */
export function computeLinePositions(ctx: AiContext, f: Front, held: number): LinePos[] {
  const L = WAR.line;
  const { map, nav } = ctx;
  const point = f.points[held];
  if (!point) return [];
  const sources = held === 0 ? f.outlands : f.points[0].floor;
  const posts = point.posts.length ? point.posts : f.posts;
  const mid = (L.minRange + L.maxRange) / 2;
  const all: LinePos[] = [];
  const astar = new AStar(nav);
  const camp = poiWorld(ctx, 'rebel_camp');
  const campAnchor = camp ? nav.nearestWalkable(camp.x, camp.y, 6) : -1;
  const watchers = f.posts.length ? f.posts : posts;
  /** Сколько px пути от лагеря до якоря a простреливается с постов (подход под огнём). */
  const exposure = (a: number): number => {
    const path = campAnchor >= 0 ? astar.find(campAnchor, a) : null;
    if (!path) return 0;
    let n = 0;
    for (const b of path) {
      const bx = nav.worldX(b);
      const by = nav.worldY(b);
      if (watchers.some((p) => Math.hypot(p.x - bx, p.y - by) <= L.exposeRange && canSeeCircle(map, bx, by, p.x, p.y, L.sightRadius))) n++;
    }
    return n * map.tileSize;
  };
  for (const a of sources) {
    const x = nav.worldX(a);
    const y = nav.worldY(a);
    let aim: Vec2 | null = null;
    let aimD = Infinity;
    for (const p of posts) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < L.minRange || d > L.maxRange || d >= aimD) continue;
      if (!canSeeCircle(map, x, y, p.x, p.y, L.sightRadius)) continue;
      aim = p;
      aimD = d;
    }
    if (!aim) continue;
    const cover = coverToward(ctx, x, y, aim.x, aim.y, aimD);
    if (!cover) continue;
    // Безопаснее подход (меньше пути под прицелом постов) и дистанция ближе к середине — лучше.
    const exp = exposure(a);
    const score = COVER_SCORE[cover] - (exp / map.tileSize) * L.exposeWeight - Math.abs(aimD - mid) / 40;
    all.push({ anchor: a, x, y, held, cover, aim, dist: aimD, exposure: exp, score });
  }
  all.sort((p, q) => q.score - p.score || p.anchor - q.anchor);
  const out: LinePos[] = [];
  for (const p of all) {
    if (out.length >= L.max) break;
    if (out.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < L.spacing)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Цена прохода по якорю для A* бойцов линии, блиндажа и подносчиков (WAR.line.route): открытое место на виду у постов фронта f
 * (ближе exposeRange, прямая видимость) стоит дороже на route.exposed, траншея и тень — нет. Путь жмётся к ходу сообщения,
 * траншеям и укрытиям, а не идёт напрямик под огнём. Видимость считается лениво, по якорю один раз (кэш на фронт).
 */
export function makeCoverCost(ctx: AiContext, f: Front): (anchor: number) => number {
  const L = WAR.line;
  const { map, nav } = ctx;
  const watchers = f.posts;
  const cache = new Map<number, number>();
  return (a: number): number => {
    let v = cache.get(a);
    if (v === undefined) {
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      v = 0;
      if (watchers.some((p) => Math.hypot(p.x - x, p.y - y) <= L.exposeRange && canSeeCircle(map, x, y, p.x, p.y, L.sightRadius)) && !inTrench(map, x, y)) v = L.route.exposed;
      cache.set(a, v);
    }
    return v;
  };
}
