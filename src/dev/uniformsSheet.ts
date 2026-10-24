import { CP_KITS, kitFrom, type KitLook } from '../config/uniforms';
import { CP_UNIT, colorsOf, cpUnit, type CpUnitId } from '../config/factions';
import { CLOTH_ITEMS, type ClothesLook } from '../config/clothes';
import type { PawnDir, PawnLook } from '../entities/PawnRenderer';
import { drawPawnFigure } from '../ui/pawnFigure';

/**
 * Лист «Форма по частям» (dev-страница sheets/uniforms.html): форма каждого юнита ВС с трёх сторон и смешанные наряды —
 * части формы с вещами из ателье. Теми же функциями, что рисуют пешку в игре. В игру не входит.
 */
const cloth = (fashion: string, k = 0): Partial<ClothesLook> => CLOTH_ITEMS.filter((it) => it.fashion.id === fashion)[k].piece;
const civ = (...ps: Partial<ClothesLook>[]): ClothesLook => Object.assign({ tier: 'middle', top: 'tee', topColor: '#6e6a62' } as ClothesLook, ...ps);
const bare = (...ps: Partial<ClothesLook>[]): ClothesLook => ({ ...civ(...ps), bare: true });

interface Row { title: string; look: PawnLook }
const cp = (unit: CpUnitId, kit?: KitLook | null, clothes?: ClothesLook): PawnLook => {
  const rank = CP_UNIT[unit];
  return { faction: 'cp', rank, color: colorsOf('cp', rank).color, seed: 1234 + rank * 77, kit, clothes };
};
const rows: Row[] = [
  ...(Object.keys(CP_KITS) as CpUnitId[]).filter((u) => CP_KITS[u].length).map((u) => ({ title: `${cpUnit(CP_UNIT[u]).name}: ${CP_KITS[u].length} части`, look: cp(u) })),
  { title: 'Инспектор без шинели, с шарфом', look: cp('insp', kitFrom(CP_KITS.insp.filter((id) => id !== 'un_greatcoat')), bare(cloth('scarf', 2))) },
  { title: 'Офицер: шляпа вместо фуражки, без противогаза', look: cp('ofc', kitFrom(['un_cp_shirt', 'un_flak_vest_ofc']), bare(cloth('fedora'), cloth('tie'))) },
  { title: 'Спецназ без шлема', look: cp('su3', kitFrom(['un_cp_shirt', 'un_recon_armor', 'un_pack'])) },
  { title: 'Патрульный: жилет поверх куртки', look: cp('pcu3', kitFrom(['helmet_cp', 'un_flak_vest']), civ(cloth('turtleneck'), cloth('zip'))) },
  { title: 'Горожанин в каске ВС и противогазе', look: { faction: 'citizen', rank: 0, color: '#6a6f75', seed: 99, kit: kitFrom(['helmet_cp', 'un_gasmask']), clothes: civ(cloth('sweater'), cloth('quilted')) } },
  { title: 'Горожанин в шинели инспектора', look: { faction: 'citizen', rank: 0, color: '#6a6f75', seed: 41, kit: kitFrom(['un_greatcoat']), clothes: civ(cloth('shirt'), cloth('flatcap')) } },
];

const DIRS: PawnDir[] = ['S', 'E', 'N'];
const root = document.getElementById('sheet')!;
root.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;padding:12px;background:#2b2824;font:14px "PT Sans Narrow",sans-serif;color:#e8e2d4';
for (const r of rows) {
  const card = document.createElement('div');
  const c = document.createElement('canvas');
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  c.width = 300 * dpr;
  c.height = 150 * dpr;
  c.style.width = '300px';
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#56504a';
  ctx.fillRect(0, 0, 300, 150);
  DIRS.forEach((d, i) => drawPawnFigure(ctx, r.look, null, 55 + i * 95, 125, 3.2, d));
  card.append(c, Object.assign(document.createElement('div'), { textContent: r.title }));
  root.append(card);
}
