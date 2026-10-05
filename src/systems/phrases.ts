import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import { TALK } from '../config/talk';
import { isFemaleName } from '../config/names';
import { displayName } from '../entities/cover';

/**
 * Фразы без повторов (общая память для Talk, закона, боя): у каждого свои недавние фразы (TALK.memory.own),
 * плюс общие недавние (TALK.memory.global) — чтобы двое рядом не говорили одно и то же. Род: {м|ж} — по
 * говорящему, [м|ж] — по собеседнику.
 */
let own = new WeakMap<Character, string[]>();
const recent: string[] = [];

/** Забыть сказанное (новый город, начало теста): иначе выбор фраз зависел бы от прошлого мира. */
export function resetPhrases(): void {
  own = new WeakMap();
  recent.length = 0;
}

/** Недавние фразы персонажа (шаблоны). */
export function saidBy(c: Character): readonly string[] {
  return own.get(c) ?? [];
}

/** Общие недавние фразы. */
export function recentPhrases(): readonly string[] {
  return recent;
}

/** Запомнить сказанное (шаблон — чтобы не повторять ту же мысль с другим именем). */
export function remember(c: Character | null, tpl: string): void {
  if (c) {
    let mine = own.get(c);
    if (!mine) own.set(c, (mine = []));
    mine.push(tpl);
    if (mine.length > TALK.memory.own) mine.shift();
  }
  recent.push(tpl);
  if (recent.length > TALK.memory.global) recent.shift();
}

/**
 * Шаблон без повторов: не из своих и общих недавних; все звучали — тот, что звучал давнее всех.
 * Всегда ровно один бросок rng — память фраз не сдвигает остальную случайность мира.
 */
export function freshTemplate(rng: Rng, c: Character | null, list: readonly string[]): string {
  const r = rng.next();
  const mine = c ? own.get(c) ?? [] : [];
  const ok = list.filter((t) => !mine.includes(t) && !recent.includes(t));
  if (ok.length) return ok[Math.floor(r * ok.length)];
  const notMine = list.filter((t) => !mine.includes(t));
  if (notMine.length) return notMine[Math.floor(r * notMine.length)];
  // Все уже звучали — та, что звучала давнее всех (по последнему разу).
  let best = list[0];
  let bi = Infinity;
  for (const t of list) {
    const i = mine.lastIndexOf(t);
    if (i < bi) {
      bi = i;
      best = t;
    }
  }
  return best;
}

/** Женщина ли (по имени; силовики с позывным и Легион — нет). */
export function female(c: Character | null): boolean {
  return !!c && c.faction !== 'cp' && c.faction !== 'ota' && isFemaleName(displayName(c));
}

/** Род в шаблоне: {м|ж} — по говорящему, [м|ж] — по собеседнику. */
export function gendered(tpl: string, speaker: Character | null, to: Character | null): string {
  const fs = female(speaker);
  const ft = female(to);
  return tpl
    .replace(/\{([^{}|]+)\|([^{}|]+)\}/g, (_m, a: string, b: string) => (fs ? b : a))
    .replace(/\[([^[\]|]+)\|([^[\]|]+)\]/g, (_m, a: string, b: string) => (ft ? b : a));
}

/** Фраза без повторов с родом: выбрать, запомнить, подставить. */
export function phrase(rng: Rng, c: Character | null, list: readonly string[], to: Character | null = null): string {
  const tpl = freshTemplate(rng, c, list);
  remember(c, tpl);
  return gendered(tpl, c, to);
}
