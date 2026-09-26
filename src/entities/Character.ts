import type { RoleSpec } from '../systems/Roster';
import type { FactionId, DivisionId } from '../config/factions';
import type { ProfessionId } from '../config/professions';
import type { ItemId, WeaponId } from '../config/items';
import { ECONOMY } from '../config/economy';
import { Inventory } from './Inventory';
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
  /** До этого времени — «только что украл»: увидевший ГО задерживает за кражу. */
  crimeUntil?: number;
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
  /** Отряд ГО (MPF, GRID, MEDIC, OBS, TECH). */
  division: DivisionId | null = null;
  /** Профессия (config/professions.ts): повар, курьер, вор, медик сопротивления… */
  profession: ProfessionId | null = null;
  /** Партизан в маскировке: выглядит и считается гражданином, пока не выдаст себя. */
  disguised = false;
  /** Горит (пиротехник): до этого времени, урон в секунду и кто поджёг. */
  burnUntil = 0;
  burnBy: Character | null = null;
  /** Несёт коробку рационов (курьер). */
  carrying = false;
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
  /** Лояльность к Альянсу (очки; уровни — config/loyalty.ts). */
  loyalty = 0;

  brain: Brain | null = null;
  alive = true;

  readonly inventory = new Inventory(ECONOMY.inventorySlots);
  /** Сытость 0..100. */
  hunger: number = ECONOMY.hunger.max;
  /** Оружие в руках (предмет из инвентаря) или null. */
  weapon: WeaponId | null = null;
  /** Патронов в магазине оружия в руках. */
  mag = 0;
  /** Патроны, оставшиеся в магазинах убранных стволов. */
  mags: Partial<Record<WeaponId, number>> = {};
  /** Время, когда закончится перезарядка / можно стрелять снова (игровое время). */
  reloadUntil = 0;
  nextShot = 0;
  /** Не раньше этого времени — следующий бросок гранаты. */
  nextGrenade = 0;
  /** Целится (игрок — зажата ПКМ; NPC — ведёт цель). */
  aiming = false;
  /** Насколько прицелился: 0 — от бедра, 1 — полностью (конус сужен до spreadAim). */
  aim = 0;
  /** Накопленная отдача, градусы разброса. */
  recoil = 0;
  /** Оглушён (дубинкой) до этого времени. */
  stunUntil = 0;
  /** Множитель желаемой скорости (оглушение). Ставит CombatSystem, применяет физика. */
  speedMul = 1;
  /** Сколько секунд ещё проходит сквозь других NPC (разбор затора, Mover); игрока не проходит. */
  ghost = 0;
  /** Когда последний раз ранили и кто. */
  lastHurt = -1e9;
  lastAttacker: Character | null = null;
  /** Напал на Альянс (стрелял по ГО/OTA) — ГО стреляет без предупреждения. */
  hostile = false;
  /** Для игрока: когда возродится (после гибели). */
  respawnAt = 0;
  /** Роль в постоянном составе (NPC): по ней появляется снова после гибели (systems/Roster.ts). */
  role: RoleSpec | null = null;
  /** До какого времени в панике (бег от стрельбы — не нарушение). */
  panicUntil = 0;

  /** Экипировать оружие, если оно есть в инвентаре; null — убрать. */
  equip(id: WeaponId | null): boolean {
    if (id && !this.inventory.has(id as ItemId)) return false;
    this.weapon = id;
    return true;
  }
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
