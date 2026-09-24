import { Character } from './Character';
import type { EntityManager } from './EntityManager';
import type { FactionId } from '../config/factions';
import { FIRST_NAMES, LAST_NAMES, FEMALE_FIRST, genderedLastName } from '../config/names';
import type { Rng } from '../core/rng';

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

export function createCharacter(
  entities: EntityManager,
  rng: Rng,
  faction: FactionId,
  x: number,
  y: number,
  isPlayer = false,
): Character {
  return entities.add(
    new Character({ id: entities.allocId(), faction, name: randomName(rng), cid: newCid(rng), x, y, isPlayer }),
  );
}
