import type { MeleeStyle, StrikeDef } from '../config/melee';
import type { WeaponId } from '../config/items';
import type { Character } from './Character';

/** Удар в работе (systems/Melee.ts): замах с start до at, урон в at, отход до end. */
export interface MeleeAttack {
  style: MeleeStyle;
  /** Что было в руках при замахе (сменил — удар сорван). */
  weapon: WeaponId | null;
  strike: StrikeDef;
  /** Номер удара в серии (0…). */
  step: number;
  /** На кого замахнулся (null — ни на кого): NPC бьёт только его (ушёл — мимо), игрок — его, а ушёл — кто подвернулся. */
  aim: Character | null;
  start: number;
  at: number;
  end: number;
  /** Удар нанесён (или сорван); попал ли; сбили замах — анимация обрывается. */
  done: boolean;
  hit: boolean;
  broken: boolean;
}

/** Ближний бой персонажа: удар, серия, блок, сбит, нокаут — для логики и отрисовки (игровое время). */
export interface MeleeState {
  attack: MeleeAttack | null;
  /** Следующий удар серии и до какого времени она продолжается. */
  combo: number;
  comboUntil: number;
  /** Блок поднят и с какого времени (парирование); пробит — не закрыться до guardBreak. */
  block: boolean;
  blockSince: number;
  guardBreak: number;
  /** Сбит ударом: не бьёт, замах сорван — до. */
  stagger: number;
  /** Нокаут: лежит до. */
  ko: number;
  /** Стойка (кулаки видны, пешка лицом к противнику) до; engaged — стойка сейчас (ставит бой каждый тик). */
  stance: number;
  engaged: boolean;
  /** Последний полученный удар: когда, направление удара (рад), сила 0..1 — вздрагивание и вспышка. */
  struckAt: number;
  struckAng: number;
  struckPow: number;
  /** Выпад или отброс: до этого времени скорость не считается бегом. */
  impulse: number;
  /** Нажал удар раньше времени — выйдет сам до этого времени. */
  queued: number;
}

export function newMeleeState(): MeleeState {
  return {
    attack: null, combo: 0, comboUntil: 0, block: false, blockSince: -1e9, guardBreak: 0, stagger: 0, ko: 0,
    stance: 0, engaged: false, struckAt: -1e9, struckAng: 0, struckPow: 0, impulse: 0, queued: 0,
  };
}

/** Сбросить (гибель, возрождение). */
export function resetMelee(m: MeleeState): void {
  Object.assign(m, newMeleeState());
}
