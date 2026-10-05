import type { SecuritySystem } from '../systems/Security';
import type { CwuHqSystem } from '../systems/CwuHq';
import type { ArsenalSystem } from '../systems/Arsenal';
import type { PrisonSystem } from '../systems/Prison';
import type { StreetShops } from '../systems/StreetShops';
import type { FamilySystem } from '../systems/Families';
import type { Housing } from '../systems/Housing';
import type { Fence } from '../systems/Fence';
import type { GangSystem } from '../systems/Gangs';
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
import type { StreetLifeSystem } from '../systems/StreetLife';
import type { Routine } from '../systems/Routine';
import type { Errands } from '../systems/Errands';
import type { Brawls } from '../systems/Brawls';
import type { AcademySystem } from '../systems/Academy';
import type { Staffing } from '../systems/Staffing';
import type { Access } from '../systems/Access';
import type { Radio } from '../systems/Radio';
import type { Talk } from '../systems/Talk';

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
  /** Сканеры техников ВС. */
  scanners: ScannerSystem;
  /** Постоянный состав: возрождение погибших. */
  roster: RosterSystem;
  /** Выборы Коменданта после его гибели. */
  elections: ElectionSystem;
  /** Уличная жизнь: бочки с огнём, дома, обращения Коменданта. */
  street: StreetLifeSystem;
  /** Семьи горожан: фамилия, повязка, дом. */
  families: FamilySystem;
  /** Штаб силового блока: построения, охрана, выходы главы. */
  security: SecuritySystem;
  /** Штаб ТС: приёмная и наём, перерывы, инспекция главы. */
  cwuHq: CwuHqSystem;
  /** Склад Протектората: запасы, поставки кораблём, выдача ВС, работа ТС, диверсии. */
  arsenal: ArsenalSystem;
  /** Тюрьма Протектората: посты охраны, начальник, выручка своих армией. */
  prison: PrisonSystem;
  /** Улица старого города: лавки, кафе и ларьки проспекта, общая столовая. */
  shops: StreetShops;
  /** Жильё: свой дом у каждого жителя, явки подполья с тайниками. */
  housing: Housing;
  /** Барыга — чёрный рынок в хате у запретной зоны. */
  fence: Fence;
  /** Банды: общаги, районы, общак, стычки, дела. */
  gangs: GangSystem;
  /** Распорядок дня: фаза суток, сон и смены жителей. */
  routine: Routine;
  /** Поручения у досок объявлений (игра за гражданского). */
  errands: Errands;
  /** Уличные драки на кулаках и «братва» банд. */
  brawls: Brawls;
  /** Академия ВС: курсанты, занятия, набор лоялистов, присяга. */
  academy: AcademySystem;
  /** Штатное расписание силового блока: должности, вакансии, повышения. */
  staffing: Staffing;
  /** Пропускной режим режимных объектов (вахтёры). */
  access: Access;
  /** Рация силового блока: происшествия, вызовы Надзора, доклады. */
  radio: Radio;
  /** Разговоры жителей: слухи о происшествиях, темы по обстановке, без повторов. */
  talk: Talk;
}
