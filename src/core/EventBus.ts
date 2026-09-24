import type { MapStats } from '../world/mapStats';
import type { Zone } from '../world/GameMap';

/** Все события игры и их данные. Новые события добавлять сюда. */
export interface GameEvents {
  'map:loaded': { seed: number; stats: MapStats | null; source: 'generated' | 'file' };
  'zone:enter': { entityId: number; zone: Zone };
  log: { text: string; kind: 'system' | 'world' };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) (h as Handler<GameEvents[K]>)(payload);
  }
}
