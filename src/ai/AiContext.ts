import type { GameMap } from '../world/GameMap';
import type { NavGrid } from '../world/NavGrid';
import type { PathService } from './PathService';
import type { EntityManager } from '../entities/EntityManager';
import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import type { AnchorBfs } from './yieldSearch';

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
}
