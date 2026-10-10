import { hash2 } from '../core/rng';
import { RELATIONS, type Habit, type Trait } from '../config/relations';

export const TRAITS: readonly Trait[] = ['temper', 'social', 'kind', 'brave', 'grudge', 'trust'];
export const HABITS: readonly Habit[] = ['barrel', 'bench', 'cards', 'smoke', 'notice', 'shopping', 'home', 'chat'];

/**
 * Характер человека: шесть черт 0..1 (вспыльчивость, общительность, отзывчивость, храбрость, злопамятность,
 * доверчивость), заметные из них — словами («вспыльчивый, общительный»), привычки (какие занятия любит) и
 * увлечение. Целиком выводится из номера человека (pid) и его стороны — без случайности мира: тот же человек
 * (в том числе возрождённый) всегда тот же по характеру.
 */
export interface Persona {
  temper: number;
  social: number;
  kind: number;
  brave: number;
  grudge: number;
  trust: number;
  /** Самые яркие черты словами (не больше RELATIONS.persona.maxTags). */
  tags: string[];
  /** Множитель веса уличных занятий (RELATIONS.persona.habit). */
  habit: Record<Habit, number>;
  /** Заметное увлечение или ''. */
  hobby: string;
}

/** Бросок 0..1 для человека и номера (стабильный). */
export function unit(pid: number, k: number): number {
  return hash2(pid, k, RELATIONS.persona.salt) / 4294967296;
}

const clamp = (v: number): number => Math.max(0.02, Math.min(0.98, v));

/** Характер по номеру человека, стороне и профессии (сдвиги — RELATIONS.persona.bias). */
export function personaFor(pid: number, faction: string, profession: string | null): Persona {
  const P = RELATIONS.persona;
  const fb = P.bias.faction[faction];
  const pb = profession ? P.bias.profession[profession] : undefined;
  const v = {} as Record<Trait, number>;
  TRAITS.forEach((t, i) => {
    // Среднее двух бросков — черты чаще умеренные, крайности встречаются реже.
    const x = (unit(pid, i * 2 + 1) + unit(pid, i * 2 + 2)) / 2 + (fb?.[t] ?? 0) + (pb?.[t] ?? 0);
    v[t] = clamp(x);
  });
  const marks = TRAITS.filter((t) => v[t] >= P.high || v[t] <= P.low)
    .sort((a, b) => Math.abs(v[b] - 0.5) - Math.abs(v[a] - 0.5))
    .slice(0, P.maxTags)
    .map((t) => P.names[t][v[t] >= 0.5 ? 0 : 1]);
  const habit = {} as Record<Habit, number>;
  let best: Habit | null = null;
  HABITS.forEach((h, i) => {
    habit[h] = P.habit.lo + (P.habit.hi - P.habit.lo) * unit(pid, 20 + i);
    if (habit[h] >= P.habit.hobbyAt && (!best || habit[h] > habit[best])) best = h;
  });
  return { ...v, tags: marks, habit, hobby: best ? P.hobbies[best] : '' };
}

/** Характер словами: «вспыльчивый, общительный» (пусто — ничем не выделяется). */
export function personaText(p: Persona): string {
  return p.tags.join(', ');
}
