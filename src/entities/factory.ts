import { Character } from './Character';
import type { EntityManager } from './EntityManager';
import type { FactionId } from '../config/factions';
import { FIRST_NAMES, LAST_NAMES, FEMALE_FIRST, genderedLastName } from '../config/names';
import type { Rng } from '../core/rng';
import { CHARACTER } from '../config/entities';
import { LAW } from '../config/law';
import { LOYALTY } from '../config/loyalty';
import { DEFAULT_PROFESSION } from '../config/professions';

/** Вортигонты — прозвища (у рабов Альянса номеров нет). */
const VORT_NAMES = ['Ваал', 'Зин-Гал', 'Ксоро', 'Ур-Ган', 'Лоррек', 'Тахаб', 'Галун', 'Ирвек', 'Соллог', 'Наар'];

const usedCids = new Set<string>();

export function resetCids(): void {
  usedCids.clear();
}

/** Уникальный 5-значный номер CID. */
export function newCid(rng: Rng): string {
  for (;;) {
    const cid = String(rng.int(10000, 99999));
    if (!usedCids.has(cid)) {
      usedCids.add(cid);
      return cid;
    }
  }
}

export function randomName(rng: Rng): string {
  const first = rng.pick(FIRST_NAMES);
  const last = genderedLastName(rng.pick(LAST_NAMES), FEMALE_FIRST.has(first));
  return `${first} ${last}`;
}

/** Имя по фракции: у ГО и OTA — позывной с номером юнита. */
export function nameFor(rng: Rng, faction: FactionId): string {
  if (faction === 'cp') return `ГО-${rng.int(1000, 9999)}`;
  if (faction === 'ota') return `OTA-${rng.int(100, 999)}`;
  if (faction === 'admin') return `Администратор ${rng.pick(LAST_NAMES)}`;
  if (faction === 'vort') return `Вортигонт ${rng.pick(VORT_NAMES)}`;
  return randomName(rng);
}

export function createCharacter(
  entities: EntityManager,
  rng: Rng,
  faction: FactionId,
  x: number,
  y: number,
  isPlayer = false,
  rank = 0,
): Character {
  const c = new Character({ id: entities.allocId(), faction, name: nameFor(rng, faction), cid: newCid(rng), x, y, isPlayer });
  c.rank = rank;
  c.profession = DEFAULT_PROFESSION[faction] ?? null;
  c.money = CHARACTER.roleMoney[faction] ?? CHARACTER.startMoney;
  if (!isPlayer) {
    // Часть жителей без действующей CID или в розыске; повстанцы — всегда в розыске.
    c.law.hasCid = !rng.chance(LAW.npc.noCidChance);
    c.law.wanted = faction === 'rebel' || rng.chance(LAW.npc.wantedChance);
    const L = faction === 'cwu' ? LOYALTY.start.cwu : LOYALTY.start.citizen;
    c.loyalty = Math.round(rng.range(L[0], L[1]));
  }
  return entities.add(c);
}
