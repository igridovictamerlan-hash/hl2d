import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Poi } from '../world/GameMap';
import { Inventory } from '../entities/Inventory';
import { furnishMap } from '../world/furnish';
import { ZONE_NAMES } from '../config/names';
import { HOUSING, type DwellingKind } from '../config/housing';

/** Жилище: комната дома, общежития или особняка. */
export interface Dwelling {
  id: number;
  kind: DwellingKind;
  /** Комната (тайлы). */
  room: { x: number; y: number; w: number; h: number };
  /** Куда идти «домой» (центр якоря в комнате), места внутри и место у кровати (поспать). */
  at: Vec2;
  spots: Vec2[];
  bed: Vec2 | null;
  /** Сколько семей/одиночек тут живёт (обычно одна). */
  households: number;
  /** Явка подполья: тайник с добычей (оружие, патроны, гранаты). */
  stash: Inventory | null;
  /** Здание (общежитие — его номер, иначе -1) и занято особым делом (общага банды, хата барыги). */
  building: number;
  reserved: boolean;
}

/**
 * Жильё города: у каждого жителя — свой дом (Character.home, в деле роли — role.home, после гибели
 * возрождается там же). Дома вдоль главного проспекта и площади (Арбат) заселяются первыми —
 * жители выходят из своих дверей прямо на улицу. Подпольщики и спецагенты — в явках с тайником:
 * туда несут краденое оружие и гранаты, оттуда берут стволы для бандитов и засад.
 */
export class Housing {
  readonly dwellings: Dwelling[] = [];
  readonly stats = { settled: 0, visits: 0, sleeps: 0, stashed: 0, taken: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const ts = map.tileSize;
    const facades = map.poisOf('facade').filter((f) => f.use === 'house');
    const inRect = (p: Poi, r: Poi) => p.x >= r.x && p.y >= r.y && p.x + (p.w ?? 1) <= r.x + (r.w ?? 1) && p.y + (p.h ?? 1) <= r.y + (r.h ?? 1);
    /** Дом на главном проспекте или площади: перед фасадом — их асфальт. */
    const onArbat = (f: Poi) => {
      const w = f.w ?? 1;
      const h = f.h ?? 1;
      const [x, y] = f.face === 'S' ? [f.x + (w >> 1), f.y + h] : f.face === 'N' ? [f.x + (w >> 1), f.y - 1] : f.face === 'W' ? [f.x - 1, f.y + (h >> 1)] : [f.x + w, f.y + (h >> 1)];
      for (let k = 0; k < 3; k++) {
        const dx = f.face === 'E' ? k : f.face === 'W' ? -k : 0;
        const dy = f.face === 'S' ? k : f.face === 'N' ? -k : 0;
        const z = map.zoneAtTile(x + dx, y + dy);
        if (z) return z.kind === 'plaza' || z.name === ZONE_NAMES.avenue[0];
      }
      return false;
    };
    const beds = furnishMap(map).filter((f) => f.kind === 'bed' || f.kind === 'bed_double');
    for (const p of map.poisOf('home')) {
      const room = { x: p.x, y: p.y, w: p.w ?? 1, h: p.h ?? 1 };
      // Места — якоря 2×2 целиком в комнате.
      const spots: Vec2[] = [];
      for (let ay = room.y; ay + 1 < room.y + room.h; ay++) {
        for (let ax = room.x; ax + 1 < room.x + room.w; ax++) {
          if (nav.isWalkable(ax, ay)) spots.push({ x: (ax + 1) * ts, y: (ay + 1) * ts });
        }
      }
      if (!spots.length) continue;
      const cx = (room.x + room.w / 2) * ts;
      const cy = (room.y + room.h / 2) * ts;
      const near = (x: number, y: number) => spots.reduce((a, b) => (Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a));
      const bed = beds.find((b) => b.x + b.w / 2 >= room.x * ts && b.y + b.h / 2 >= room.y * ts && b.x + b.w / 2 < (room.x + room.w) * ts && b.y + b.h / 2 < (room.y + room.h) * ts);
      const facade = !p.kind ? facades.find((f) => inRect(p, f)) : undefined;
      const kind: DwellingKind = p.kind === 'dorm' ? 'dorm' : p.kind === 'villa' ? 'villa' : facade ? (onArbat(facade) ? 'arbat' : 'street') : 'house';
      this.dwellings.push({
        id: this.dwellings.length,
        kind,
        room,
        at: near(cx, cy),
        spots,
        bed: bed ? near(bed.x + bed.w / 2, bed.y + bed.h / 2) : null,
        households: 0,
        stash: null,
        building: p.kind === 'dorm' ? p.id ?? -1 : -1,
        reserved: false,
      });
    }
  }

  of(c: Character): Dwelling | null {
    return c.home >= 0 ? this.dwellings[c.home] ?? null : null;
  }

  /** Внутри ли p своей (или любой) комнаты d. */
  inside(d: Dwelling, p: Vec2): boolean {
    const ts = this.ctx.map.tileSize;
    return p.x >= d.room.x * ts && p.y >= d.room.y * ts && p.x < (d.room.x + d.room.w) * ts && p.y < (d.room.y + d.room.h) * ts;
  }

  /** Сколько свободных жилищ вида kind. */
  free(kind: DwellingKind): number {
    return this.dwellings.filter((d) => d.kind === kind && !d.households && !d.reserved).length;
  }

  /**
   * Подобрать свободное жилище по списку видов (в своём виде — ближе к near, иначе случайное;
   * accept — доп. условие). Занятых нет — null.
   */
  pick(prefs: readonly DwellingKind[], near: Vec2 | null = null, accept?: (d: Dwelling) => boolean): Dwelling | null {
    const { rng } = this.ctx;
    for (const kind of prefs) {
      const list = this.dwellings.filter((d) => d.kind === kind && !d.households && !d.reserved && (!accept || accept(d)));
      if (!list.length) continue;
      if (!near) return rng.pick(list);
      return list.reduce((a, b) => (Math.hypot(b.at.x - near.x, b.at.y - near.y) < Math.hypot(a.at.x - near.x, a.at.y - near.y) ? b : a));
    }
    return null;
  }

  /** Поселить (одного или семью) в d: дом в деле роли — возрождаются здесь же. */
  settle(members: readonly Character[], d: Dwelling): void {
    d.households++;
    for (const c of members) {
      c.home = d.id;
      if (c.role) c.role.home = d.id;
      this.stats.settled++;
    }
  }

  /** Выселить c (дом освобождается, если больше никого из этого дела). */
  evict(c: Character): void {
    const d = this.of(c);
    c.home = -1;
    if (c.role) c.role.home = undefined;
    if (!d) return;
    const still = this.ctx.entities.list.some((o) => o !== c && o.alive && o.home === d.id);
    if (!still) d.households = Math.max(0, d.households - 1);
  }

  /** Вид жилья по жителю (кого куда селить). */
  prefsOf(c: Character): readonly DwellingKind[] {
    const P = HOUSING.prefs;
    if (c.faction === 'rebel') return P.underground;
    if (c.faction === 'vort') return P.vort;
    if (c.faction === 'cwu') return P.cwu;
    const p = c.profession;
    if (p === 'thief' || p === 'bandit' || p === 'outcast' || p === 'fugitive') return P.hustler;
    return P.single;
  }

  /** Явка подполья: не ближе safe.fromNexus к воротам Нексуса. */
  private safeOk = (d: Dwelling): boolean => {
    const ts = this.ctx.map.tileSize;
    const g = this.ctx.map.poisOf('nexus_gate')[0];
    return !g || Math.hypot(d.at.x - (g.x + 0.5) * ts, d.at.y - (g.y + 0.5) * ts) >= HOUSING.safe.fromNexus;
  };

  /**
   * Дом для одного жителя без дома (near — место работы: продавцу — лавка, ГСР — штаб). Подпольщику —
   * явка с тайником. Возвращает жилище или null (всё занято).
   */
  house(c: Character, near: Vec2 | null = null): Dwelling | null {
    if (c.home >= 0) return this.of(c);
    const underground = c.faction === 'rebel';
    const d = this.pick(this.prefsOf(c), near, underground ? this.safeOk : undefined) ?? (underground ? this.pick(this.prefsOf(c), near) : null);
    if (!d) return null;
    if (underground && !d.stash) d.stash = new Inventory(HOUSING.safe.stash);
    this.settle([c], d);
    return d;
  }

  /** Место в доме: у кровати (sleep) или любое. */
  spot(d: Dwelling, sleep: boolean): Vec2 {
    if (sleep && d.bed) return d.bed;
    return this.ctx.rng.pick(d.spots);
  }

  /** Якорь дома c (для A*) или -1. */
  anchorOf(c: Character): number {
    const d = this.of(c);
    return d ? this.ctx.nav.nearestWalkable(d.at.x, d.at.y, 1) : -1;
  }

  // ——— Тайники явок ———

  /** Тайник явки c (подпольщик) или null. */
  stashOf(c: Character): Inventory | null {
    return this.of(c)?.stash ?? null;
  }

  /** Сложить в тайник всё, что годится (оружие не в руках, патроны сверх магазина, гранаты). */
  stashLoot(c: Character, keep: (id: string) => boolean): number {
    const s = this.stashOf(c);
    if (!s) return 0;
    let n = 0;
    for (const slot of [...c.inventory.slots]) {
      if (keep(slot.id)) continue;
      const k = s.add(slot.id, slot.qty);
      if (k > 0) {
        c.inventory.remove(slot.id, k);
        n += k;
      }
    }
    this.stats.stashed += n;
    return n;
  }

  /** Всего предметов во всех тайниках (тесты, HUD повстанца). */
  get stashTotal(): number {
    let n = 0;
    for (const d of this.dwellings) if (d.stash) for (const s of d.stash.slots) n += s.qty;
    return n;
  }
}
