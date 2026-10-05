import { PLACES } from '../config/places';
import type { Zone } from './GameMap';

/** Прилагательное мужского рода в предложный падеж: «Главный» → «Главном», «Рабочий» → «Рабочем». */
function adjM(a: string): string {
  if (/(ый|ой)$/.test(a)) return a.slice(0, -2) + 'ом';
  if (/[кгх]ий$/.test(a)) return a.slice(0, -2) + 'ом';
  if (/ий$/.test(a)) return a.slice(0, -2) + 'ем';
  return a;
}

/** Женского рода: «Заводская» → «Заводской», «Верхняя» → «Верхней». */
function adjF(a: string): string {
  if (/ая$/.test(a)) return a.slice(0, -2) + 'ой';
  if (/яя$/.test(a)) return a.slice(0, -2) + 'ей';
  return a;
}

const RULES: readonly [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Пограничный КПП («[^»]+»)(?: · (.+))?$/, (m) => {
    const part = m[2];
    if (!part) return `на КПП ${m[1]}`;
    if (part === 'шорт') return `на КПП ${m[1]}, в шорте`;
    if (part === 'лонг') return `на КПП ${m[1]}, в лонге`;
    if (part === 'проходная') return `у проходной КПП ${m[1]}`;
    return `на КПП ${m[1]}, ${part}`;
  }],
  [/^Общежитие (.+)$/, (m) => `в общежитии ${m[1]}`],
  [/^улица (.+)$/, (m) => `на улице ${m[1]}`],
  [/^(\S+[ая]я) улица$/, (m) => `на ${adjF(m[1])} улице`],
  [/^Проезд (.+)$/, (m) => `на проезде ${m[1]}`],
  [/^(\S+) проезд$/, (m) => `на ${adjM(m[1])} проезде`],
  [/^Проспект (.+)$/, (m) => `на проспекте ${m[1]}`],
  [/^(\S+) проспект$/, (m) => `на ${adjM(m[1])} проспекте`],
  [/^Квартал (.+)$/, (m) => `в квартале ${m[1]}`],
  [/^(\S+) квартал$/, (m) => `в ${adjM(m[1])} квартале`],
  [/^Кафе (.+)$/, (m) => `у кафе ${m[1]}`],
  [/^Кофейня (.+)$/, (m) => `у кофейни ${m[1]}`],
  [/^Общая столовая/, () => 'у общей столовой'],
];

/**
 * Где это — для реплик и рации: «на Заводской улице», «в Старом квартале», «у склада Протектората»,
 * «на КПП «Запад», в шорте». Имена — из PLACES и правил по форме имени.
 */
export function whereOf(zone: Pick<Zone, 'name' | 'kind'> | null | undefined): string {
  if (!zone) return PLACES.nowhere;
  const fixed = PLACES.fixed[zone.name];
  if (fixed) return fixed;
  for (const [re, f] of RULES) {
    const m = zone.name.match(re);
    if (m) return f(m);
  }
  const byKind = PLACES.byKind[zone.kind];
  return (byKind ?? PLACES.fallback).replace('{name}', zone.name);
}
