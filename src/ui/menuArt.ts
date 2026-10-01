import type { PawnDir, PawnLook } from '../entities/PawnRenderer';
import { lookSeed } from '../entities/PawnRenderer';
import { drawPawnFigure } from './pawnFigure';
import { colorsOf, cpUnit, rebelUnitOf, type FactionId } from '../config/factions';
import { PROFESSIONS, type ProfessionId } from '../config/professions';
import { KITS, WEAPONS, type WeaponId } from '../config/items';

/** Внешность «образца» стороны для меню: фракция, ранг и профессия, лицо — по зерну. */
export function previewLook(faction: FactionId, rank: number, profession: ProfessionId | null, seed: number): PawnLook {
  const r = faction === 'rebel' ? rebelUnitOf(profession)?.rank ?? 0 : rank;
  return { faction, rank: r, color: colorsOf(faction, r).color, seed: lookSeed(seed), profession };
}

/** Классы оружия по «весу»: на образце — самый тяжёлый ствол набора. */
const CLASS_ORDER = ['launcher', 'pulse', 'sniper', 'rifle', 'shotgun', 'smg', 'magnum', 'pistol', 'blade', 'melee'];

/** Ствол образца: лучший из набора роли (ГО — по юниту), без ствола — null. */
export function previewWeapon(faction: FactionId, rank: number, profession: ProfessionId | null): WeaponId | null {
  const kit = faction === 'cp' ? cpUnit(rank).kit : (profession && PROFESSIONS[profession]?.kit) || faction;
  const items = KITS[kit] ?? [];
  let best: WeaponId | null = null;
  let bestK = Infinity;
  for (const [id] of items) {
    const w = WEAPONS[id as WeaponId];
    if (!w) continue;
    const k = CLASS_ORDER.indexOf(w.class);
    if (k >= 0 && k < bestK) {
      bestK = k;
      best = id as WeaponId;
    }
  }
  return best;
}

/**
 * Нарисовать пешку в холст портрета (чёткость под devicePixelRatio): ноги на доле ground высоты,
 * масштаб scale (единиц модели → px CSS).
 */
export function drawPortrait(canvas: HTMLCanvasElement, look: PawnLook | null, weapon: WeaponId | null, scale: number, ground: number, dir: PawnDir = 'S'): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!look) return;
  // Тень под ногами.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h * ground, scale * 5.5, scale * 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  drawPawnFigure(ctx, look, weapon, w / 2, h * ground, scale, dir);
}
