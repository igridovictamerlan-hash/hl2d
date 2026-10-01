import type { Character } from './Character';
import type { FactionId } from '../config/factions';
import { FACTIONS } from '../config/factions';

/** Как персонаж выглядит со стороны: в маскировке — по личине (без неё — гражданин). */
export function apparentFaction(c: Character): FactionId {
  return c.disguised ? c.cover?.faction ?? 'citizen' : c.faction;
}

/** В маскировке под сотрудника Протектората (ВС, OTA): свои его не проверяют и не трогают. */
export function coverAuthority(c: Character): boolean {
  return c.disguised && !!c.cover && FACTIONS[c.cover.faction].authority;
}

/** Имя на подписи: у переодетого — имя личины (убитого), если есть. */
export function displayName(c: Character): string {
  return c.disguised && c.cover?.name ? c.cover.name : c.name;
}
