/** Состояние конечного автомата. update может вернуть имя следующего состояния. */
export interface State<C> {
  readonly name: string;
  enter?(ctx: C): void;
  update(ctx: C, dt: number): string | void;
  exit?(ctx: C): void;
}

/**
 * Простой конечный автомат. Каждая фракция описывает свои состояния
 * (idle, walk, work, patrol, chase, flee, fight, arrested — по мере этапов).
 */
export class StateMachine<C> {
  private readonly states = new Map<string, State<C>>();
  private cur: State<C>;
  /** Время в текущем состоянии, с. */
  time = 0;

  constructor(
    private readonly ctx: C,
    states: State<C>[],
    initial: string,
  ) {
    for (const s of states) this.states.set(s.name, s);
    this.cur = this.get(initial);
    this.cur.enter?.(ctx);
  }

  get current(): string {
    return this.cur.name;
  }

  private get(name: string): State<C> {
    const s = this.states.get(name);
    if (!s) throw new Error(`Нет состояния ${name}`);
    return s;
  }

  change(name: string): void {
    this.cur.exit?.(this.ctx);
    this.cur = this.get(name);
    this.time = 0;
    this.cur.enter?.(this.ctx);
  }

  update(dt: number): void {
    this.time += dt;
    const next = this.cur.update(this.ctx, dt);
    if (next && next !== this.cur.name) this.change(next);
  }
}
