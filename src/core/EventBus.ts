import type { MapStats } from '../world/mapStats';
import type { Zone } from '../world/GameMap';
import type { Character } from '../entities/Character';
import type { Verdict } from '../systems/LawSystem';

/** Вид строки журнала: system — подсказки, world — события, radio — рация Альянса, law — закон, chat — речь. */
export type LogKind = 'system' | 'world' | 'radio' | 'law' | 'chat';

/** Все события игры и их данные. Новые события добавлять сюда. */
export interface GameEvents {
  'map:loaded': { seed: number; stats: MapStats | null; source: 'generated' | 'file' };
  'zone:enter': { entityId: number; zone: Zone };
  log: { text: string; kind: LogKind };
  /** Крупное объявление по центру экрана. */
  announce: { text: string };
  /** Смена кода тревоги. */
  alert: { code: 'green' | 'yellow' | 'red' };
  /** Игрок-ГО закончил проверку документов — показать решение. */
  'law:checkResult': { target: Character; verdict: Verdict };
  /** Панель проверки закрыта (решение принято или задержанный ушёл). */
  'law:checkClosed': { target: Character };
  /** Персонаж (игрок) перешёл к повстанцам у прорванного КПП. */
  defected: { who: Character };
  /** Игрок избран Администратором города. */
  elected: { who: Character };
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
