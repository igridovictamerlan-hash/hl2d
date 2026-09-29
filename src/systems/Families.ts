import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Poi } from '../world/GameMap';
import { FAMILIES } from '../config/families';
import { HOUSING } from '../config/housing';
import { FEMALE_FIRST, LAST_NAMES, genderedLastName } from '../config/names';

export interface Family {
  id: number;
  /** Фамилия (мужская форма). */
  surname: string;
  /** Цвет повязки на рукаве. */
  color: string;
  /** Зерно внешности семьи (кожа, волосы). */
  seed: number;
  rich: boolean;
  /** Дом семьи: комната общежития, спальня особняка или отдельный дом. */
  home: Poi | null;
  /** Якорь в доме (куда идти «домой»), -1 — нет. */
  homeAnchor: number;
}

/** «семья Зайцевых» / «семья Новак». */
export function familyTitle(surname: string): string {
  return /(ов|ев|ин)$/.test(surname) ? `семья ${surname}ых` : `семья ${surname}`;
}

/**
 * Семьи горожан. Распределение — после заселения (assign): жители делятся на семьи, получают
 * общую фамилию (и в деле роли — возрождаются с ней же) и дом. Семья — в Character.family.
 */
export class FamilySystem {
  readonly families: Family[] = [];

  constructor(private readonly ctx: AiContext) {}

  of(c: Character): Family | null {
    return c.family >= 0 ? this.families[c.family] ?? null : null;
  }

  /** Родственники поблизости (живые, кроме самого). */
  kin(c: Character): Character[] {
    if (c.family < 0) return [];
    return this.ctx.entities.list.filter((o) => o !== c && o.alive && o.family === c.family);
  }

  assign(people: Character[]): void {
    const { ctx } = this;
    const { rng, nav } = ctx;
    const F = FAMILIES;
    const H = ctx.housing;
    const surnames = rng.shuffle([...LAST_NAMES]);
    // Лоялисты — первыми: из них богатые семьи в особняках.
    const pool = rng.shuffle(people.filter((c) => c.alive && !c.isPlayer));
    pool.sort((a, b) => Number(b.loyalty >= F.richLoyalty) - Number(a.loyalty >= F.richLoyalty));
    let left = Math.round(pool.length * F.share);
    let k = 0;
    while (left >= F.size[0] && k < pool.length) {
      const n = Math.min(left, rng.int(F.size[0], F.size[1]));
      const members = pool.slice(k, k + n);
      k += n;
      left -= n;
      const id = this.families.length;
      // Дом семьи (Housing): богатые — особняк, остальные — половина на Арбат, половина в общежития.
      const rich = members[0].loyalty >= F.richLoyalty && !!H?.free('villa');
      const P = HOUSING.prefs;
      const dwelling = H ? H.pick(rich ? ['villa'] : rng.chance(HOUSING.familyArbat) ? P.family : P.familyDorm) : null;
      if (dwelling) H.settle(members, dwelling);
      const home = dwelling ? { type: 'home' as const, ...dwelling.room, kind: dwelling.kind === 'villa' || dwelling.kind === 'dorm' ? dwelling.kind : undefined } : null;
      const surname = surnames[id % surnames.length];
      const fam: Family = {
        id,
        surname,
        color: F.colors[id % F.colors.length],
        seed: rng.int(1, 0x7fffffff),
        rich,
        home,
        homeAnchor: dwelling ? nav.nearestWalkable(dwelling.at.x, dwelling.at.y, 1) : -1,
      };
      this.families.push(fam);
      for (const c of members) {
        const first = c.name.split(' ')[0];
        c.name = `${first} ${genderedLastName(surname, FEMALE_FIRST.has(first))}`;
        c.family = id;
        // Богатая семья — вся лоялисты (особняк, форма лоялиста).
        if (rich) c.loyalty = Math.max(c.loyalty, F.richLoyalty);
        if (c.role) {
          c.role.name = c.name;
          c.role.family = id;
          c.role.loyalty = c.loyalty;
        }
      }
    }
  }
}
