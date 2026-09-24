import type { AiContext } from './AiContext';
import type { Vec2 } from '../core/math';
import type { ZoneKind } from '../world/GameMap';

/** id зон указанных типов — для avoidZones в поиске пути. */
export function zoneIds(ctx: Pick<AiContext, 'map'>, kinds: readonly ZoneKind[]): Set<number> {
  return new Set(ctx.map.zones.filter((z) => kinds.includes(z.kind)).map((z) => z.id));
}

/** Случайный проходимый якорь в зоне данного типа, -1 — нет. */
export function randomAnchorInZone(ctx: AiContext, kind: ZoneKind): number {
  const ids = ctx.map.zones.filter((z) => z.kind === kind).map((z) => z.id);
  const lists = ids.map((id) => ctx.nav.anchorsByZone.get(id) ?? []).filter((l) => l.length > 0);
  if (lists.length === 0) return -1;
  return ctx.rng.pick(ctx.rng.pick(lists));
}

/**
 * Цель прогулки: случайная точка на расстоянии [min, max] якорей, не в избегаемых зонах.
 */
export function randomAnchorAround(
  from: Vec2,
  ctx: Pick<AiContext, 'nav' | 'rng'>,
  minDist: number,
  maxDist: number,
  avoid: ReadonlySet<number>,
): number {
  const nav = ctx.nav;
  const cx = Math.round(from.x / nav.ts) - 1;
  const cy = Math.round(from.y / nav.ts) - 1;
  for (let tries = 0; tries < 60; tries++) {
    const ang = ctx.rng.range(0, Math.PI * 2);
    const r = ctx.rng.range(minDist, maxDist);
    const ax = Math.round(cx + Math.cos(ang) * r);
    const ay = Math.round(cy + Math.sin(ang) * r);
    if (!nav.isWalkable(ax, ay)) continue;
    const i = ay * nav.w + ax;
    if (avoid.has(nav.zone[i])) continue;
    return i;
  }
  return -1;
}
