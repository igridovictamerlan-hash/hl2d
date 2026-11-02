/**
 * Сетка прямоугольников (px мира) по ячейкам cell px: какие из них задевают окно кадра — без перебора всех (мебель,
 * трубы на крышах). Выдача — номера по возрастанию (порядок отрисовки списка сохраняется), без повторов.
 */
export class BoxGrid {
  private readonly cells: number[][] = [];
  private readonly cols: number;
  private readonly rows: number;
  private readonly seen: Uint32Array;
  private gen = 0;

  /** box(i) → [x0, y0, x1, y1] i-го прямоугольника (px мира). */
  constructor(
    private readonly cell: number,
    width: number,
    height: number,
    count: number,
    box: (i: number) => readonly [number, number, number, number],
  ) {
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    for (let i = 0; i < this.cols * this.rows; i++) this.cells.push([]);
    for (let i = 0; i < count; i++) {
      const [x0, y0, x1, y1] = box(i);
      for (let gy = this.row(y0), ey = this.row(y1); gy <= ey; gy++)
        for (let gx = this.col(x0), ex = this.col(x1); gx <= ex; gx++) this.cells[gy * this.cols + gx].push(i);
    }
    this.seen = new Uint32Array(count);
  }

  private col(x: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cell)));
  }

  private row(y: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cell)));
  }

  /** Номера прямоугольников из ячеек, задевающих окно (x0, y0)–(x1, y1); точную проверку делает вызывающий. */
  query(x0: number, y0: number, x1: number, y1: number, out: number[] = []): number[] {
    out.length = 0;
    const gen = ++this.gen;
    for (let gy = this.row(y0), ey = this.row(y1); gy <= ey; gy++) {
      for (let gx = this.col(x0), ex = this.col(x1); gx <= ex; gx++) {
        for (const i of this.cells[gy * this.cols + gx]) {
          if (this.seen[i] === gen) continue;
          this.seen[i] = gen;
          out.push(i);
        }
      }
    }
    return out.sort((a, b) => a - b);
  }
}
