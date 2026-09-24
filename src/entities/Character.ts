import type { FactionId } from '../config/factions';
import { CHARACTER } from '../config/entities';
import type { Brain } from '../ai/Brain';
import type { Violation } from '../config/law';

/**
 * Этапы разбирательства с законом:
 * ordered — ГО приказал стоять; checking — идёт проверка CID; fleeing — убегает;
 * cuffed — в наручниках, идёт за конвоиром; entering — заводят в камеру; jailed — сидит;
 * releasing — выходит из Нексуса после отсидки.
 */
export type LawPhase = 'none' | 'ordered' | 'checking' | 'fleeing' | 'cuffed' | 'entering' | 'jailed' | 'releasing';

export interface LawState {
  /** Есть действующая CID-карта. */
  hasCid: boolean;
  /** В розыске. */
  wanted: boolean;
  phase: LawPhase;
  /** Кто разбирается (сотрудник ГО или игрок-ГО). */
  handler: Character | null;
  /** Причина: что заметили. */
  reason: Violation | null;
  /** Где приказали стоять. */
  orderX: number;
  orderY: number;
  /** Время приказа / последней проверки (игровое время). */
  since: number;
  lastCheck: number;
  /** Индекс камеры и время выхода. */
  cell: number;
  jailUntil: number;
  /** Мозг, который был до ареста (у игрока — null). */
  savedBrain: Brain | null;
}

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
  /** Ранг во фракции (у ГО и повстанцев от него зависит цвет). */
  rank = 0;
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
  /** Виден ли игроку в этот тик (туман войны). */
  visible = true;

  law: LawState = {
    hasCid: true, wanted: false, phase: 'none', handler: null, reason: null,
    orderX: 0, orderY: 0, since: 0, lastCheck: -1e9, cell: -1, jailUntil: 0, savedBrain: null,
  };

  /** Реплика над головой. */
  speech: { text: string; until: number } | null = null;

  say(text: string, now: number, duration = 3): void {
    this.speech = { text, until: now + duration };
  }

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
