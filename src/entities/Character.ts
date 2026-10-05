import type { RoleSpec } from '../systems/Roster';
import type { FactionId, DivisionId } from '../config/factions';
import type { ProfessionId } from '../config/professions';
import type { ItemId, WeaponId, GrenadeId, GearId, GearSlot } from '../config/items';
import { ECONOMY } from '../config/economy';
import { Inventory } from './Inventory';
import { CHARACTER } from '../config/entities';
import type { Brain } from '../ai/Brain';
import type { Violation } from '../config/law';
import type { CadetRecord } from '../config/academy';
import type { AccessSite } from '../config/access';

/**
 * Этапы разбирательства с законом:
 * ordered — ВС приказал стоять; checking — идёт проверка CID; fleeing — убегает;
 * cuffed — в наручниках, идёт за конвоиром; entering — заводят в камеру; jailed — сидит;
 * releasing — выходит из Управы после отсидки.
 */
/** Вид реплики (облачко): вслух, в рацию, Надзор из рации. */
export type SpeechKind = 'say' | 'radio' | 'dispatch';

export type LawPhase = 'none' | 'ordered' | 'checking' | 'fleeing' | 'cuffed' | 'entering' | 'jailed' | 'releasing';

export interface LawState {
  /** Есть действующая CID-карта. */
  hasCid: boolean;
  /** В розыске. */
  wanted: boolean;
  phase: LawPhase;
  /** Кто разбирается (сотрудник ВС или игрок-ВС). */
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
  /** До этого времени — «только что украл»: увидевший ВС задерживает за кражу. */
  crimeUntil?: number;
  /** До этого времени — участник бунта: увидевший ВС задерживает (нарушение 'riot'). */
  riotUntil?: number;
}

/**
 * Личина в маскировке (Character.cover): под кого одет — фракция, ранг, профессия, имя на подписи.
 * Партизан — гражданин или рабочий ТС; спецагент — убитый (с его тела) или OTA (шкаф казармы).
 */
export interface Cover {
  faction: FactionId;
  rank: number;
  profession: ProfessionId | null;
  name: string | null;
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
  /** Ранг во фракции (у ВС и повстанцев от него зависит цвет). */
  rank = 0;
  /** Отряд ВС (MPF, GRID, MEDIC, OBS, TECH). */
  division: DivisionId | null = null;
  /** Профессия (config/professions.ts): повар, курьер, вор, медик сопротивления… */
  profession: ProfessionId | null = null;
  /** Партизан в маскировке: выглядит и считается гражданином, пока не убьёт кого-то (или не раскроют проверкой, арестом, допросом). */
  disguised = false;
  /** Под кого одет в маскировке (null — просто гражданин). */
  cover: Cover | null = null;
  /** Горит (пиротехник): до этого времени, урон в секунду и кто поджёг. */
  burnUntil = 0;
  burnBy: Character | null = null;
  /** Несёт коробку рационов (курьер) или ящик склада (грузчик). */
  carrying = false;
  /** Миска супа из общей столовой (съест за столом). */
  soupBowl = false;
  /** Свой дом (Housing.dwellings), -1 — нет. */
  home = -1;
  /** Патроны из порченого ящика склада (диверсия партизан): осечки до чистого пополнения. */
  badAmmo = false;
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
  /**
   * Походка — только для отрисовки (entities/gait.ts): пройденный путь (фаза шага), сглаженная
   * скорость и сторона пешки (идёт — по ходу, боком — профилем; целится или стоит — куда смотрит).
   */
  stride = 0;
  gaitVx = 0;
  gaitVy = 0;
  bodyDir: 'S' | 'N' | 'E' | 'W' = 'S';

  health: number = CHARACTER.maxHealth;
  maxHealth: number = CHARACTER.maxHealth;
  /** Токены. */
  money: number = CHARACTER.startMoney;
  /** Лояльность к Протекторату (очки; уровни — config/loyalty.ts). */
  loyalty = 0;
  /** Семья (номер в FamilySystem) или -1. */
  family = -1;
  /** Банда (Gangs) или -1. */
  gang = -1;
  /** Кого охраняет (охрана и подопечный друг друга не толкают — physics). */
  guarding: Character | null = null;
  /** Ведомый патрульной группы ВС — его ведущий (друг другу не помеха). */
  squadLead: Character | null = null;
  /** Курит (уличная жизнь) — огонёк и дымок у пешки. */
  smoking = false;
  /** Пишет в блокноте (медик на месте преступления) до этого времени закона — сидит, блокнот в руках. */
  notepadUntil = 0;

  brain: Brain | null = null;
  alive = true;

  readonly inventory = new Inventory(ECONOMY.inventorySlots);
  /** Сытость 0..100. */
  hunger: number = ECONOMY.hunger.max;
  /** Спит (в кровати): сытость тает медленнее (ECONOMY.hunger.sleepMul). */
  asleep = false;
  /** Оружие в руках (предмет из инвентаря) или null. */
  weapon: WeaponId | null = null;
  /** Надетое снаряжение (шлем, бронежилет, рюкзак) — не в ячейках инвентаря (systems/Gear). */
  gear: Partial<Record<GearSlot, GearId>> = {};
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
  /** Увод ствола отдачей, радианы (со знаком: куда уводит), и сторона увода (±1). */
  kick = 0;
  kickDir = 1;
  /** Какую гранату бросает (T; Y — сменить). */
  grenadeKind: GrenadeId = 'grenade';
  /** Кровотечение, HP/с: не проходит само — перевязка (бинт, аптечка, медик). */
  bleed = 0;
  /** Ранен в ногу (хромает) / в руку (конус шире) — до этого времени. */
  limpUntil = 0;
  armUntil = 0;
  /** Перевязывается до этого времени (0 — нет): стоит, не стреляет. */
  bandageUntil = 0;
  /** Ставит растяжку до этого времени (0 — нет) и из какой гранаты. */
  plantUntil = 0;
  plantKind: GrenadeId = 'grenade';
  /** Подавление огнём 0..1 (config/tactics SUPPRESS) и когда последний раз прибавилось. */
  suppress = 0;
  suppressAt = -1e9;
  /** Присел (C у игрока; NPC — сам, когда в бою стоит на месте). */
  crouch = false;
  /** Когда последний раз стрелял (присевшего за блоком снова видно). */
  lastFired = -1e9;
  /** NPC ведёт бой до этого времени (Gunner): стоит — садится. */
  engagedUntil = -1e9;
  /** Тяжело ранен: лежит до этого времени (0 — нет), потом смерть (config/tactics DOWNED). */
  downedUntil = 0;
  /** Когда упал (пули, выпущенные раньше, уходят поверх падающего). */
  downedAt = -1e9;
  /** Поднимает (или стабилизирует для ареста — reviveArrest) лежащего до этого времени (0 — нет). */
  reviveUntil = 0;
  reviving: Character | null = null;
  reviveArrest = false;
  /** Тащит лежащего / кто тащит его. */
  dragging: Character | null = null;
  draggedBy: Character | null = null;
  /** Последнее ранение: зона и время (для HUD игрока). */
  lastZone: 'head' | 'torso' | 'arm' | 'leg' | 'blast' | null = null;
  /** Оглушён (дубинкой) до этого времени. */
  stunUntil = 0;
  /** Множитель желаемой скорости (оглушение). Ставит CombatSystem, применяет физика. */
  speedMul = 1;
  /** Сколько секунд ещё проходит сквозь других NPC (разбор затора, Mover); игрока не проходит. */
  ghost = 0;
  /** Когда последний раз ранили и кто. */
  lastHurt = -1e9;
  lastAttacker: Character | null = null;
  /** Напал на Протекторат (стрелял по ВС/OTA) — ВС стреляет без предупреждения. */
  hostile = false;
  /** Для игрока: когда возродится (после гибели). */
  respawnAt = 0;
  /** Роль в постоянном составе (NPC): по ней появляется снова после гибели (systems/Roster.ts). */
  role: RoleSpec | null = null;
  /** До какого времени в панике (бег от стрельбы — не нарушение). */
  panicUntil = 0;
  /**
   * Служба ВС (systems/Staffing.ts): заслуги (баллы за задержания, штрафы, бой…) и с какого времени
   * служит (с игры) — по ним повышают на свободную должность.
   */
  merit = 0;
  serviceSince = 0;
  /** Курсант академии: баллы по предметам и точность в тире (systems/Academy.ts). */
  cadet: CadetRecord | null = null;
  /** Пропуска на режимные объекты (systems/Access.ts); forged — поддельные. */
  passes: AccessSite[] = [];
  forged: AccessSite[] = [];
  /** Где был в прошлый тик (режимный объект или null) — Access пропускает внутрь только по пропуску. */
  accessAt: AccessSite | null | undefined = undefined;

  /** Лежит тяжело раненый (жив, но не боец). */
  get downed(): boolean {
    return this.downedUntil > 0;
  }

  /** Боеспособен: жив и на ногах. */
  get fit(): boolean {
    return this.alive && this.downedUntil === 0;
  }

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

  /** Реплика над головой: say — вслух, radio — в рацию, dispatch — голос Надзора из рации. */
  speech: { text: string; until: number; kind: SpeechKind } | null = null;

  say(text: string, now: number, duration = 3, kind: SpeechKind = 'say'): void {
    this.speech = { text, until: now + duration, kind };
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
