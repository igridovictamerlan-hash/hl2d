/** Пространственный хэш для быстрых запросов «кто рядом». Перестраивается каждый тик. */
export class SpatialHash<T extends { x: number; y: number }> {
  private cells = new Map<number, T[]>();
  private pool: T[][] = [];

  constructor(private readonly cellSize: number) {}

  private key(cx: number, cy: number): number {
    return (cy + 1024) * 4096 + (cx + 1024);
  }

  clear(): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.cells.clear();
  }

  insert(item: T): void {
    const k = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.y / this.cellSize));
    let arr = this.cells.get(k);
    if (!arr) {
      arr = this.pool.pop() ?? [];
      this.cells.set(k, arr);
    }
    arr.push(item);
  }

  /** Все объекты в ячейках, задевающих круг (x, y, r). Точную дистанцию проверяет вызывающий. */
  query(x: number, y: number, r: number, out: T[] = []): T[] {
    out.length = 0;
    const x0 = Math.floor((x - r) / this.cellSize);
    const x1 = Math.floor((x + r) / this.cellSize);
    const y0 = Math.floor((y - r) / this.cellSize);
    const y1 = Math.floor((y + r) / this.cellSize);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (arr) for (const it of arr) out.push(it);
      }
    }
    return out;
  }
}
