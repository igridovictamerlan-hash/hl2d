import type { GameMap } from '../world/GameMap';
import type { NavGrid } from '../world/NavGrid';
import type { PathService } from './PathService';
import type { EntityManager } from '../entities/EntityManager';
import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import type { AnchorBfs } from './yieldSearch';
import type { LawSystem } from '../systems/LawSystem';
import type { DoorSystem } from '../systems/DoorSystem';
import type { EconomySystem } from '../systems/EconomySystem';
import type { CombatSystem } from '../systems/CombatSystem';
import type { WarSystem } from '../systems/WarSystem';
import type { EventBus } from '../core/EventBus';
import type { UndergroundSystem } from '../systems/UndergroundSystem';
import type { InsurgencySystem } from '../systems/InsurgencySystem';
import type { LaborSystem } from '../systems/LaborSystem';
import type { CrimeSystem } from '../systems/CrimeSystem';
import type { ScannerSystem } from '../systems/ScannerSystem';
import type { RosterSystem } from '../systems/Roster';
import type { ElectionSystem } from '../systems/ElectionSystem';

/** Всё, что видят мозги NPC. Создаётся при загрузке карты. */
export interface AiContext {
  map: GameMap;
  nav: NavGrid;
  paths: PathService;
  /** Общий BFS для поиска «карманов» при уступании дороги. */
  bfs: AnchorBfs;
  entities: EntityManager;
  rng: Rng;
  player: Character | null;
  /** Время игры, с. */
  time: number;
  law: LawSystem;
  doors: DoorSystem;
  bus: EventBus;
  economy: EconomySystem;
  combat: CombatSystem;
  /** Канализация и люки. */
  underground: UndergroundSystem;
  /** Создаются после контекста (им нужен контекст для спавна). */
  war: WarSystem;
  insurgency: InsurgencySystem;
  /** Работы профессий: завод, доставка, мусор, лечение. */
  labor: LaborSystem;
  /** Кражи (вор, отброс общества). */
  crime: CrimeSystem;
  /** Сканеры техников ГО. */
  scanners: ScannerSystem;
  /** Постоянный состав: возрождение погибших. */
  roster: RosterSystem;
  /** Выборы Администратора после его гибели. */
  elections: ElectionSystem;
}
