import type { Character } from '../entities/Character';

/** Настройки дисциплины огня (WAR.line.duel, WAR.line.garrison.duel). */
export interface DuelConfig {
  /** Сколько выстрелов подряд — и пора затаиться. */
  readonly shots: number;
  /** На сколько секунд затаиться. */
  readonly cool: number;
  /** Пауза между выстрелами не дольше этого — ещё одна и та же дуэль. */
  readonly quiet: number;
}

/**
 * Дисциплина огня позиционной перестрелки: из-за укрытия стреляют не до гибели одной из сторон, а очередями —
 * дал cfg.shots выстрелов подряд, затаился на cfg.cool с (не стреляет, сидит присев, за бруствером или блоком его
 * не видно), потом снова. Считает выстрелы по Character.lastFired.
 */
export class FireDiscipline {
  private shots = 0;
  private lastAt = -1e9;
  private lastFired = 0;
  private coolUntil = 0;

  constructor(private readonly cfg: DuelConfig) {}

  /** Учесть новые выстрелы бойца; true — сейчас пора молчать. */
  update(self: Character, now: number): boolean {
    if (self.lastFired !== this.lastFired) {
      this.lastFired = self.lastFired;
      if (now - this.lastAt > this.cfg.quiet) this.shots = 0;
      this.lastAt = now;
      if (++this.shots >= this.cfg.shots) {
        this.shots = 0;
        this.coolUntil = now + this.cfg.cool;
      }
    }
    return now < this.coolUntil;
  }

  cooling(now: number): boolean {
    return now < this.coolUntil;
  }

  /** Забыть счёт (боец ушёл с позиции). */
  reset(): void {
    this.shots = 0;
    this.coolUntil = 0;
  }
}
