import type { FactionId } from './factions';
import type { ProfessionId } from './professions';

/** Боец отряда: фракция, юнит (номер ранга: у ГО — CP_RANKS, у армии — по профессии), профессия, набор. */
export interface ArenaUnit {
  faction: FactionId;
  /** Юнит силового блока (CP_UNIT) — у ГО; у остальных 0. */
  cpUnit?: 'su3' | 'su2' | 'su1' | 'guard' | 'pcu1';
  profession: ProfessionId | null;
  kit: string;
}

/**
 * Экспериментальный режим «отряд на отряд» (systems/SquadArena.ts): на пограничном КПП front
 * Альянс (во внутреннем дворе) против отряда сопротивления (на пустоши) — как в CS: раунд до
 * гибели одной стороны или roundTime с (тогда побеждает тот, у кого живых больше), пауза breakTime с,
 * отряды заново. Город вокруг пуст: ни жителей, ни войны, ни подполья. Игрок — в своём отряде
 * (вместо первого бойца), ?mode=squad&side=rebel|combine или кнопка в главном меню.
 * ИИ бойца: видит врага — стоит и стреляет (перезарядка, гранаты, дым, перевязка — как везде), иначе
 * идёт к последнему месту, где его отряд видел врага, или к базе противника; перекатами:
 * advance с — вперёд, hold с — держит позицию. Разброс целей вокруг точки — spread px.
 */
export const ARENA = {
  front: 0,
  roundTime: 150,
  breakTime: 6,
  advance: [4, 7] as const,
  hold: [1.5, 3.5] as const,
  spread: 70,
  /** Сколько секунд помнят, где видели врага. */
  memory: 12,
  teams: {
    combine: [
      { faction: 'cp', cpUnit: 'su3', profession: null, kit: 'cp_su' },
      { faction: 'cp', cpUnit: 'su3', profession: null, kit: 'cp_su' },
      { faction: 'cp', cpUnit: 'su3', profession: null, kit: 'cp_su' },
      { faction: 'cp', cpUnit: 'su2', profession: null, kit: 'cp_su_medic' },
      { faction: 'ota', profession: 'ota_alpha', kit: 'ota_alpha' },
    ],
    rebel: [
      { faction: 'rebel', profession: 'veteran', kit: 'rebel_veteran' },
      { faction: 'rebel', profession: 'veteran', kit: 'rebel_veteran' },
      { faction: 'rebel', profession: 'rebel_soldier', kit: 'rebel_soldier' },
      { faction: 'rebel', profession: 'rebel_soldier', kit: 'rebel_soldier' },
      { faction: 'rebel', profession: 'hydra_rct', kit: 'hydra_rct' },
    ],
  } satisfies Record<ArenaSide, ArenaUnit[]>,
  sideNames: { combine: 'Альянс', rebel: 'Сопротивление' } as Record<ArenaSide, string>,
} as const;

export type ArenaSide = 'combine' | 'rebel';
