import { Character } from './Character';
import { SpatialHash } from '../world/SpatialHash';

/** Список персонажей + пространственный хэш для запросов «кто рядом». */
export class EntityManager {
  readonly list: Character[] = [];
  private readonly byIdMap = new Map<number, Character>();
  private readonly hash = new SpatialHash<Character>(64);
  private nextId = 1;

  allocId(): number {
    return this.nextId++;
  }

  add(c: Character): Character {
    this.list.push(c);
    this.byIdMap.set(c.id, c);
    // Сразу в хэш: иначе появившегося (подкрепление, новый отряд) до следующего шага физики не видно.
    if (c.alive) this.hash.insert(c);
    return c;
  }

  remove(c: Character): void {
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
    this.byIdMap.delete(c.id);
  }

  clear(): void {
    this.list.length = 0;
    this.byIdMap.clear();
    this.hash.clear();
  }

  byId(id: number): Character | undefined {
    return this.byIdMap.get(id);
  }

  rebuildHash(): void {
    this.hash.clear();
    for (const c of this.list) if (c.alive) this.hash.insert(c);
  }

  /** Персонажи в радиусе r от точки (точная проверка расстояния до центра). */
  near(x: number, y: number, r: number, out: Character[] = []): Character[] {
    this.hash.query(x, y, r, out);
    let k = 0;
    const r2 = r * r;
    for (const c of out) {
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy <= r2) out[k++] = c;
    }
    out.length = k;
    return out;
  }
}
