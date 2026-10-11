import type { Character } from '../entities/Character';
import type { AiContext } from './AiContext';
import type { Mover } from './Mover';

/** «Мозг» NPC: решает, что делать; движением занимается Mover. */
export interface Brain {
  readonly mover: Mover;
  /** Имя текущего состояния (для отладки). */
  readonly stateName: string;
  /** Сидит в укрытии на позиции (присев, даже пока не стреляет): боец линии фронта между очередями. */
  readonly sits?: boolean;
  update(self: Character, ctx: AiContext, dt: number): void;
}
