/**
 * Двоичная куча (id, приоритет) на типизированных массивах — для A* и Дейкстры.
 * Дубликаты допускаются (ленивое удаление): устаревшие записи отсеивает вызывающий код.
 */
export class MinHeap {
  private ids: Int32Array;
  private pri: Float64Array;
  private n = 0;
  /** Приоритет последнего извлечённого элемента. */
  lastPriority = 0;

  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.pri = new Float64Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  push(id: number, priority: number): void {
    if (this.n === this.ids.length) this.grow();
    let i = this.n++;
    const ids = this.ids;
    const pri = this.pri;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (pri[p] <= priority) break;
      ids[i] = ids[p];
      pri[i] = pri[p];
      i = p;
    }
    ids[i] = id;
    pri[i] = priority;
  }

  pop(): number {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0];
    this.lastPriority = pri[0];
    const n = --this.n;
    if (n > 0) {
      const id = ids[n];
      const p = pri[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= p) break;
        ids[i] = ids[c];
        pri[i] = pri[c];
        i = c;
      }
      ids[i] = id;
      pri[i] = p;
    }
    return top;
  }

  private grow(): void {
    const ids = new Int32Array(this.ids.length * 2);
    const pri = new Float64Array(this.pri.length * 2);
    ids.set(this.ids);
    pri.set(this.pri);
    this.ids = ids;
    this.pri = pri;
  }
}
