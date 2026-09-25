import { ITEMS, type ItemId } from '../config/items';

export interface Stack {
  id: ItemId;
  qty: number;
}

/** Инвентарь: ячейки со стопками предметов. */
export class Inventory {
  readonly slots: Stack[] = [];

  constructor(public capacity: number) {}

  count(id: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s.id === id) n += s.qty;
    return n;
  }

  has(id: ItemId, qty = 1): boolean {
    return this.count(id) >= qty;
  }

  /** Добавляет, сколько влезет. Возвращает добавленное количество. */
  add(id: ItemId, qty: number): number {
    const max = ITEMS[id].stack;
    let left = qty;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s.id !== id || s.qty >= max) continue;
      const k = Math.min(left, max - s.qty);
      s.qty += k;
      left -= k;
    }
    while (left > 0 && this.slots.length < this.capacity) {
      const k = Math.min(left, max);
      this.slots.push({ id, qty: k });
      left -= k;
    }
    return qty - left;
  }

  /** Убирает qty штук; false — столько нет (ничего не меняется). */
  remove(id: ItemId, qty = 1): boolean {
    if (!this.has(id, qty)) return false;
    let left = qty;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s.id !== id) continue;
      const k = Math.min(left, s.qty);
      s.qty -= k;
      left -= k;
      if (s.qty === 0) this.slots.splice(i, 1);
    }
    return true;
  }

  /** Забрать всё (лут с тела). */
  takeAll(): Stack[] {
    return this.slots.splice(0, this.slots.length);
  }

  clear(): void {
    this.slots.length = 0;
  }
}
