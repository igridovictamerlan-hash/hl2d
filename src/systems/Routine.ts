import { ROUTINE, type DayPhase } from '../config/routine';
import { LIGHTING } from '../config/lighting';
import { dayFraction } from '../world/Lighting';
import type { Character } from '../entities/Character';

/** Профессии, живущие ночью: спят днём. */
const HUSTLERS = new Set(['thief', 'bandit', 'gang_boss']);
const SHIFTED = new Set<string>(ROUTINE.shifted);

/** Детерминированное число 0..1 по id (сдвиг распорядка, «сова»). */
function hash01(id: number, salt: number): number {
  let h = (id * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h % 10007) / 10007;
}

/** Попадает ли час h в полуинтервал [a, b) с переходом через полночь. */
function within(h: number, a: number, b: number): boolean {
  a = ((a % 24) + 24) % 24;
  b = ((b % 24) + 24) % 24;
  return a <= b ? h >= a && h < b : h >= a || h < b;
}

/**
 * Распорядок дня по игровым часам (те же сутки, что у освещения): фаза суток, сон и смены жителя.
 * Логика без DOM; `time` — источник игрового времени (AiContext.time).
 */
export class Routine {
  constructor(
    private readonly clock: { time: number },
    public enabled: boolean = ROUTINE.enabled,
  ) {}

  /** Час суток 0..24 (общий). */
  hour(): number {
    return dayFraction(this.clock.time) * 24;
  }

  /** Сдвиг распорядка жителя, ч. */
  offset(c: Character): number {
    return (hash01(c.id, 1) * 2 - 1) * ROUTINE.shift;
  }

  owl(c: Character): boolean {
    return hash01(c.id, 2) < ROUTINE.owls;
  }

  /** Фаза суток (для всех одна — HUD, раздача, проверки). */
  phase(): DayPhase {
    const h = this.hour();
    const H = ROUTINE.hours;
    if (within(h, H.night, H.morning)) return 'night';
    if (h < H.day) return 'morning';
    if (h < H.evening) return 'day';
    return 'evening';
  }

  /** Фаза для жителя — со сдвигом его распорядка. */
  phaseOf(c: Character): DayPhase {
    const h = (this.hour() - this.offset(c) + 24) % 24;
    const H = ROUTINE.hours;
    if (within(h, H.night, H.morning)) return 'night';
    if (h < H.day) return 'morning';
    if (h < H.evening) return 'day';
    return 'evening';
  }

  /** Часы сна жителя [ложится, встаёт) со сдвигом. */
  private sleepSpan(c: Character): [number, number] {
    const R = ROUTINE;
    const o = this.offset(c);
    if (c.profession && HUSTLERS.has(c.profession)) return [R.hustlerBed + o, R.hustlerWake + o];
    const late = this.owl(c) ? R.owlLate : 0;
    return [R.bed + o + late, R.wake + o + late];
  }

  /** Пора спать (распорядок включён). */
  asleepTime(c: Character): boolean {
    if (!this.enabled) return false;
    const [a, b] = this.sleepSpan(c);
    return within(this.hour(), a, b);
  }

  /** Сколько секунд игры до подъёма жителя (0 — уже не время сна). */
  untilWake(c: Character): number {
    if (!this.asleepTime(c)) return 0;
    const wake = ((this.sleepSpan(c)[1] % 24) + 24) % 24;
    const dh = (wake - this.hour() + 24) % 24;
    return (dh / 24) * LIGHTING.dayLength;
  }

  /** Смена у профессии идёт (профессии без смен — всегда). */
  onShift(c: Character): boolean {
    if (!this.enabled || !c.profession || !SHIFTED.has(c.profession)) return true;
    const S = ROUTINE.shift9to5;
    const o = this.offset(c);
    return within(this.hour(), S.from + o, S.to + o);
  }

  /** Раздача рационов разрешена (днём). */
  rationsHours(): boolean {
    if (!this.enabled) return true;
    return within(this.hour(), ROUTINE.rations[0], ROUTINE.rations[1]);
  }

  /** Ночь (для проверок ВС, воров и банд). */
  get night(): boolean {
    return this.enabled && this.phase() === 'night';
  }

  /** Множитель доли занятий и весов по фазе жителя. */
  activity(c: Character): number {
    return this.enabled ? ROUTINE.activity[this.phaseOf(c)] : -1;
  }

  weight(c: Character, kind: keyof (typeof ROUTINE.weights)['day']): number {
    if (!this.enabled) return 1;
    return ROUTINE.weights[this.phaseOf(c)][kind] ?? 1;
  }
}
