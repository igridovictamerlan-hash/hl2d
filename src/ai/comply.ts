import type { Character } from '../entities/Character';
import type { Mover } from './Mover';
import { faceTowards } from './facing';

/**
 * Подпольщик под личиной не спорит с ГО: приказали стоять или проверяют документы — стоит лицом
 * к проверяющему (бег от ГО выдал бы его). true — в этот тик мозгу больше делать нечего.
 */
export function complyWithCp(self: Character, mover: Mover, dt: number): boolean {
  const ph = self.law.phase;
  if (ph !== 'ordered' && ph !== 'checking') return false;
  mover.stop();
  self.wantX = self.wantY = 0;
  const h = self.law.handler;
  if (h) faceTowards(self, h.x, h.y, dt);
  return true;
}
