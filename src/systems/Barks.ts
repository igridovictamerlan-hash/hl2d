import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import { BARKS, type BarkEvent, type BarkSide } from '../config/barks';

const nextBark = new WeakMap<Character, number>();

export function barkSide(c: Character): BarkSide {
  if (c.faction === 'cp' || c.faction === 'ota') return 'combine';
  return c.faction === 'rebel' ? 'rebel' : 'civil';
}

/**
 * Реплика по событию (контакт, перезарядка, ранен, убил, потеря своего, вперёд, улица).
 * С шансом из BARKS.chance, не чаще BARKS.cooldown у одного, не перебивая текущую речь.
 * Игрок не «лает» сам. true — сказал.
 */
export function bark(c: Character, event: BarkEvent, now: number, rng: Rng): boolean {
  if (c.isPlayer || !c.alive) return false;
  if ((nextBark.get(c) ?? 0) > now || (c.speech && c.speech.until > now)) return false;
  const lines = BARKS.lines[barkSide(c)][event];
  if (!lines.length || !rng.chance(BARKS.chance[event])) return false;
  c.say(rng.pick(lines), now, BARKS.duration);
  nextBark.set(c, now + BARKS.cooldown);
  return true;
}
