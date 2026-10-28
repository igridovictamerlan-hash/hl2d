import { CLOTHES } from '../config/clothes';
import { CP_UNIT, colorsOf, rebelUnitOf, type CpUnitId, type FactionId } from '../config/factions';
import type { WeaponId } from '../config/items';
import type { ProfessionId } from '../config/professions';
import { plainclothesOf } from '../config/clothes';
import type { PawnLook } from '../entities/PawnRenderer';

/**
 * Каталог внешностей для листа пиксельных пешек и тестов: комплекты ателье, юниты ВС, армия и «Гроза», Легион,
 * профессии ТС и горожан. Как в игре: внешность из стороны, ранга, профессии и зерна (форма — по умолчанию стороны).
 */
export interface LookEntry { group: string; title: string; look: PawnLook; weapon: WeaponId | null }

const look = (faction: FactionId, rank: number, seed: number, profession: ProfessionId | null = null, extra: Partial<PawnLook> = {}): PawnLook =>
  ({ faction, rank, color: colorsOf(faction, rank).color, seed, profession, ...extra });

const CP_NAMES: Record<CpUnitId, string> = {
  rct: 'Рекрут', pcu3: 'Патрульный', pcu2: 'Патрульный 2', pcu1: 'Сержант', ofc: 'Офицер', su3: 'Спецназ', su2: 'Медик ВС',
  su1: 'Следователь (в штатском)', guard: 'Охрана', insp: 'Инспектор', epu: 'Командир', qm: 'Кладовщик', cdt: 'Курсант', instr: 'Инструктор',
};
const CP_WEAPON: Partial<Record<CpUnitId, WeaponId>> = { rct: 'stunstick', pcu3: 'mp7', pcu2: 'usp', pcu1: 'mp7', ofc: 'usp', su3: 'spas12', su2: 'mp7', guard: 'ar2', epu: 'ar2', instr: 'usp' };

const REBELS: [ProfessionId, string, WeaponId][] = [
  ['rebel_recruit', 'Новобранец', 'rebel_pistol'], ['rebel_soldier', 'Солдат', 'ak74'], ['demolitionist', 'Подрывник', 'rpg'],
  ['pyro', 'Пиротехник', 'rebel_smg'], ['veteran', 'Ветеран', 'm4a4'], ['rebel_medic', 'Медик армии', 'rebel_smg'],
  ['hydra_rct', '«Гроза»', 'm4a4'], ['hydra_sergeant', 'Сержант «Грозы»', 'm4a4'], ['hydra_sniper', 'Снайпер «Грозы»', 'sniper'],
  ['commando', 'Коммандос', 'm4a4'], ['rebel_leader', 'Глава восстания', 'ak74'],
];

export function lookCatalog(): LookEntry[] {
  const out: LookEntry[] = [];
  for (const s of CLOTHES.sets) out.push({ group: 'Горожане (ателье)', title: `${s.code} ${s.name}`, look: { faction: 'citizen', rank: 0, color: '#6a6f75', seed: s.seed, clothes: s.look, clothesKey: s.code }, weapon: null });
  const civ: [FactionId, ProfessionId | null, string, WeaponId | null][] = [
    ['citizen', null, 'Гражданин', null], ['citizen', 'thief', 'Вор', 'knife'], ['citizen', 'outcast', 'Отброс', null],
    ['citizen', 'bandit', 'Бандит', 'revolver'], ['citizen', 'fugitive', 'Беглец', null], ['cwu', 'cook', 'Повар ТС', null],
    ['cwu', 'courier', 'Курьер ТС', null], ['cwu', 'janitor', 'Дворник ТС', null], ['cwu', 'packer', 'Докер ТС', null],
    ['cwu', 'armorer', 'Оружейник ТС', null], ['cwu', 'cwu_medic', 'Медик ТС', null], ['cwu', 'cwu_head', 'Глава ТС', null],
    ['admin', null, 'Комендант', 'usp'], ['vort', null, 'Поднадзорный', null], ['rebel', 'spec_agent', 'Спецагент', 'usp'],
  ];
  civ.forEach(([f, p, t, w], i) => out.push({ group: 'Стороны и профессии', title: t, look: look(f, 0, 900 + i * 37, p), weapon: w }));
  for (const u of Object.keys(CP_UNIT) as CpUnitId[]) {
    const rank = CP_UNIT[u];
    const op = u === 'su1' ? plainclothesOf(4242) : null;
    out.push({ group: 'Внутренняя стража', title: CP_NAMES[u], look: look('cp', rank, 1234 + rank * 77, null, op ? { clothes: op.clothes, kit: null, clothesKey: op.key } : {}), weapon: CP_WEAPON[u] ?? 'usp' });
  }
  REBELS.forEach(([p, t, w], i) => out.push({ group: 'Армия и «Гроза»', title: t, look: look('rebel', rebelUnitOf(p)?.rank ?? 0, 300 + i * 13, p), weapon: w }));
  out.push({ group: 'Легион', title: 'LGN.ALPHA', look: look('ota', 0, 77, 'ota_alpha'), weapon: 'ar2' });
  out.push({ group: 'Легион', title: 'LGN.PRAETOR', look: look('ota', 1, 78, 'ota_king'), weapon: 'ar2' });
  out.push({ group: 'Легион', title: 'Санитар', look: look('ota', 0, 79, 'cremator'), weapon: null });
  return out;
}
