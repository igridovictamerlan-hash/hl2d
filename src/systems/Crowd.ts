/** Описание системы — docs/population.md. */
import type { AiContext } from '../ai/AiContext';
import { CROWD } from '../config/crowd';
import { T, SOLID } from '../world/tiles';

/**
 * Карта толпы (CROWD): город — клетки cell × cell тайлов, у каждой вместимость по проходимой площади; раз в every с
 * пересчёт, сколько в клетке живых. Жители не выбирают целью прогулки и досуга полную клетку (full) и обходят
 * людное место по соседним улицам (cost — добавка к цене шага A*). В безголовых тестах выключена (enabled = false).
 */
export class CrowdMap {
  readonly gw: number;
  readonly gh: number;
  /** Людей в клетке (последний пересчёт). */
  readonly count: Uint16Array;
  /** Вместимость клетки. */
  readonly cap: Float32Array;
  /** Якорь навигации → клетка. */
  private readonly anchorCell: Int32Array;
  private timer = 0;
  enabled = true;
  /** Цена шага A* в людном месте (для Mover.crowdCost): стрелка, чтобы отдавать без привязки. */
  readonly cost = (anchor: number): number => {
    const k = this.anchorCell[anchor];
    const P = CROWD.path;
    const over = this.count[k] / this.cap[k] - P.from;
    return over > 0 ? Math.min(P.max, over * P.mul) : 0;
  };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const C = CROWD.cell;
    this.gw = Math.ceil(map.width / C);
    this.gh = Math.ceil(map.height / C);
    this.count = new Uint16Array(this.gw * this.gh);
    this.cap = new Float32Array(this.gw * this.gh);
    const area = new Float32Array(this.gw * this.gh);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const t = map.tiles[y * map.width + x];
        if (SOLID[t]) continue;
        area[Math.floor(y / C) * this.gw + Math.floor(x / C)] += t === T.INTERIOR ? CROWD.indoor : 1;
      }
    }
    for (let k = 0; k < area.length; k++) this.cap[k] = Math.max(CROWD.min, area[k] / CROWD.tilesPerPerson);
    this.anchorCell = new Int32Array(nav.w * nav.h);
    for (let ay = 0; ay < nav.h; ay++) {
      for (let ax = 0; ax < nav.w; ax++) this.anchorCell[ay * nav.w + ax] = Math.floor((ay + 1) / C) * this.gw + Math.floor((ax + 1) / C);
    }
  }

  private cellAt(x: number, y: number): number {
    const ts = this.ctx.map.tileSize * CROWD.cell;
    const cx = Math.min(this.gw - 1, Math.max(0, Math.floor(x / ts)));
    const cy = Math.min(this.gh - 1, Math.max(0, Math.floor(y / ts)));
    return cy * this.gw + cx;
  }

  /** Загрузка клетки точки: людей / вместимость. */
  load(x: number, y: number): number {
    const k = this.cellAt(x, y);
    return this.count[k] / this.cap[k];
  }

  /** Клетка якоря полна — цель прогулки туда не берут (выключена — никогда). */
  fullAnchor(anchor: number): boolean {
    if (!this.enabled || anchor < 0) return false;
    const k = this.anchorCell[anchor];
    return this.count[k] >= this.cap[k] * CROWD.full;
  }

  /**
   * Замер (worldstats, тест толпы), считает заново — и при выключенной карте: жителей города (горожане, ТС,
   * поднадзорные), из них у площади (ближе CROWD.near тайлов к её центру) и в переполненных клетках (загрузка
   * выше 1), людей в самой полной клетке.
   */
  snapshot(): { people: number; nearPlaza: number; over: number; peak: number } {
    const { map } = this.ctx;
    const all = new Uint16Array(this.count.length);
    const res: number[] = [];
    const plaza = this.ctx.hoods?.plaza;
    const near = CROWD.near * map.tileSize;
    let nearPlaza = 0;
    for (const c of this.ctx.entities.list) {
      if (!c.alive || map.levelAt(c.x, c.y) !== 'city') continue;
      const k = this.cellAt(c.x, c.y);
      all[k]++;
      if (c.faction !== 'citizen' && c.faction !== 'cwu' && c.faction !== 'vort') continue;
      res.push(k);
      if (plaza && Math.hypot(c.x - plaza.x, c.y - plaza.y) < near) nearPlaza++;
    }
    let peak = 0;
    for (const n of all) peak = Math.max(peak, n);
    const over = res.filter((k) => all[k] > this.cap[k]).length;
    return { people: res.length, nearPlaza, over, peak };
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = CROWD.every;
    this.count.fill(0);
    const map = this.ctx.map;
    for (const c of this.ctx.entities.list) {
      if (!c.alive || map.levelAt(c.x, c.y) !== 'city') continue;
      this.count[this.cellAt(c.x, c.y)]++;
    }
  }
}
