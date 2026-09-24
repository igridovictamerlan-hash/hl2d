import { GAME } from '../config/game';

/**
 * Игровой цикл с фиксированным шагом логики (60 Гц) и отрисовкой на частоте монитора.
 * alpha — доля до следующего тика, для плавной интерполяции позиций.
 */
export class GameLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  readonly step = 1 / GAME.tickRate;
  /** Сглаженные кадры в секунду (для панели). */
  fps = 0;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const frameDt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (frameDt > 0) this.fps = this.fps * 0.93 + (1 / frameDt) * 0.07;
    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= this.step && steps < GAME.maxStepsPerFrame) {
      this.update(this.step);
      this.acc -= this.step;
      steps++;
    }
    if (steps === GAME.maxStepsPerFrame) this.acc = 0;
    this.render(this.acc / this.step);
    this.raf = requestAnimationFrame(this.frame);
  };
}
