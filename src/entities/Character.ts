import type { FactionId } from '../config/factions';
import { CHARACTER } from '../config/entities';
import type { Brain } from '../ai/Brain';

export interface CharacterInit {
  id: number;
  faction: FactionId;
  name: string;
  cid: string;
  x: number;
  y: number;
  isPlayer?: boolean;
}

/**
 * Персонаж — цветной кружок. Одинаков для игрока и NPC: игроком управляет ввод,
 * NPC — мозг (brain). Оба лишь выставляют желаемую скорость wantX/wantY, двигает физика.
 */
export class Character {
  readonly id: number;
  faction: FactionId;
  name: string;
  /** Номер CID-карты. */
  cid: string;
  readonly isPlayer: boolean;

  x: number;
  y: number;
  /** Позиция на прошлом тике — для интерполяции при отрисовке. */
  prevX: number;
  prevY: number;
  vx = 0;
  vy = 0;
  /** Желаемая скорость, px/с. */
  wantX = 0;
  wantY = 0;
  /** Фактическая скорость за последний тик (после столкновений), px/с. */
  moveSpeed = 0;
  accel: number;
  readonly radius = CHARACTER.radius;
  mass: number;
  /** Направление взгляда, радианы. */
  facing = 0;

  health: number = CHARACTER.maxHealth;
  maxHealth: number = CHARACTER.maxHealth;
  /** Токены. */
  money: number = CHARACTER.startMoney;

  brain: Brain | null = null;
  alive = true;

  constructor(init: CharacterInit) {
    this.id = init.id;
    this.faction = init.faction;
    this.name = init.name;
    this.cid = init.cid;
    this.isPlayer = init.isPlayer ?? false;
    this.x = this.prevX = init.x;
    this.y = this.prevY = init.y;
    this.accel = this.isPlayer ? CHARACTER.accel : CHARACTER.npcAccel;
    this.mass = this.isPlayer ? CHARACTER.mass.player : CHARACTER.mass.npc;
  }
}
