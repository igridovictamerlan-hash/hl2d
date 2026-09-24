import type { EventBus } from '../core/EventBus';
import type { Character } from '../entities/Character';
import type { GameMap, Zone } from '../world/GameMap';
import { GAME } from '../config/game';

/**
 * Следит, в какой зоне игрок. Название показывается, если игрок пробыл в новой зоне
 * zoneBannerDelay и эту зону не показывали последние zoneBannerCooldown секунд
 * (без мигания на границе переулка и проспекта).
 */
export class ZoneSystem {
  private current: Zone | null = null;
  private candidate: Zone | null = null;
  private candidateTime = 0;
  private lastShown = new Map<number, number>();
  private time = 0;

  constructor(private readonly bus: EventBus) {}

  reset(): void {
    this.current = this.candidate = null;
    this.candidateTime = 0;
    this.lastShown.clear();
  }

  get zone(): Zone | null {
    return this.current;
  }

  update(map: GameMap, player: Character, dt: number): void {
    this.time += dt;
    const z = map.zoneAtWorld(player.x, player.y);
    if (!z || z === this.current) {
      this.candidate = null;
      return;
    }
    if (z !== this.candidate) {
      this.candidate = z;
      this.candidateTime = 0;
    }
    this.candidateTime += dt;
    if (this.candidateTime < GAME.zoneBannerDelay && this.current) return;
    this.current = z;
    this.candidate = null;
    const last = this.lastShown.get(z.id);
    if (last !== undefined && this.time - last < GAME.zoneBannerCooldown) return;
    this.lastShown.set(z.id, this.time);
    this.bus.emit('zone:enter', { entityId: player.id, zone: z });
  }
}
