/**
 * Пространственный хэш для быстрых запросов «кто рядом». Перестраивается каждый тик. Ячейки — плоский массив по
 * прямоугольнику, где бывают объекты (растёт с запасом, когда объект выходит за него), а не Map: запрос с большим
 * радиусом (прицел стрелка — сотни ячеек) раньше делал по поиску в Map на ячейку. Порядок выдачи — ячейки по строкам
 * (y, затем x), в ячейке — в порядке вставки: от него зависят выборы ИИ (первый подходящий, равные расстояния).
 */
export class SpatialHash<T extends { x: number; y: number }> {
  private cells: T[][] = [];
  /** Левая верхняя ячейка прямоугольника и его размер в ячейках. */
  private cx0 = 0;
  private cy0 = 0;
  private cols = 0;
  private rows = 0;
  /** Непустые ячейки (что чистить). */
  private used: number[] = [];
  /** Объекты далеко за картой (прямоугольник не растёт без меры) — проверяются в каждом запросе. */
  private far: T[] = [];

  constructor(private readonly cellSize: number) {}

  clear(): void {
    for (const i of this.used) this.cells[i].length = 0;
    this.used.length = 0;
    this.far.length = 0;
  }

  insert(item: T): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    // Не число (ошибка где-то ещё) — в запросы не попадает, как и раньше.
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    if (cx < this.cx0 || cy < this.cy0 || cx >= this.cx0 + this.cols || cy >= this.cy0 + this.rows) {
      if (Math.abs(cx) > FAR || Math.abs(cy) > FAR) {
        this.far.push(item);
        return;
      }
      this.grow(cx, cy);
    }
    const i = (cy - this.cy0) * this.cols + (cx - this.cx0);
    const arr = this.cells[i];
    if (arr.length === 0) this.used.push(i);
    arr.push(item);
  }

  /** Расширить прямоугольник до ячейки (cx, cy) с запасом; содержимое ячеек переносится как есть. */
  private grow(cx: number, cy: number): void {
    const M = 16;
    const x0 = this.cols ? Math.min(this.cx0, cx - M) : cx - M;
    const y0 = this.rows ? Math.min(this.cy0, cy - M) : cy - M;
    const x1 = this.cols ? Math.max(this.cx0 + this.cols, cx + M + 1) : cx + M + 1;
    const y1 = this.rows ? Math.max(this.cy0 + this.rows, cy + M + 1) : cy + M + 1;
    const cols = x1 - x0;
    const rows = y1 - y0;
    const cells: T[][] = new Array(cols * rows);
    for (let i = 0; i < cells.length; i++) cells[i] = [];
    const used: number[] = [];
    for (const i of this.used) {
      const j = (Math.floor(i / this.cols) + this.cy0 - y0) * cols + ((i % this.cols) + this.cx0 - x0);
      cells[j] = this.cells[i];
      used.push(j);
    }
    this.cells = cells;
    this.used = used;
    this.cx0 = x0;
    this.cy0 = y0;
    this.cols = cols;
    this.rows = rows;
  }

  /** Все объекты в ячейках, задевающих круг (x, y, r). Точную дистанцию проверяет вызывающий. */
  query(x: number, y: number, r: number, out: T[] = []): T[] {
    out.length = 0;
    const s = this.cellSize;
    const x0 = Math.max(0, Math.floor((x - r) / s) - this.cx0);
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / s) - this.cx0);
    const y0 = Math.max(0, Math.floor((y - r) / s) - this.cy0);
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / s) - this.cy0);
    const cells = this.cells;
    for (let cy = y0; cy <= y1; cy++) {
      let i = cy * this.cols + x0;
      for (let cx = x0; cx <= x1; cx++, i++) {
        const arr = cells[i];
        for (let k = 0; k < arr.length; k++) out.push(arr[k]);
      }
    }
    for (const it of this.far) if (Math.abs(it.x - x) <= r + s && Math.abs(it.y - y) <= r + s) out.push(it);
    return out;
  }
}

/** Дальше стольких ячеек от начала координат — не в сетку (её размер ограничен). */
const FAR = 2048;
