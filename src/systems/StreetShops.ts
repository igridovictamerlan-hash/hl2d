import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Rng } from '../core/rng';
import { ARBAT } from '../config/arbat';
import { ITEMS, type ItemId } from '../config/items';
import { ECONOMY } from '../config/economy';
import { adjustLoyalty, hasLoyalty } from './Loyalty';

/** Лавка, кафе или ларёк на проспекте: где стоит покупатель, что продают. */
export interface StreetShop {
  /** id дома (POI facade) или -1 — ларёк. */
  id: number;
  sub: string;
  name: string;
  kind: 'shop' | 'cafe' | 'kiosk';
  /** Место покупателя перед прилавком (окошком) и куда смотреть. */
  front: Vec2;
  look: Vec2;
  stock: readonly ItemId[];
}

/** Место за столом общей столовой: где сидеть и куда смотреть (на стол). */
export interface CanteenSeat {
  x: number;
  y: number;
  lookX: number;
  lookY: number;
  table: number;
  taken: Character | null;
}

/**
 * Улица старого города: лавки, кафе и ларьки главного проспекта (горожане заходят купить что-нибудь,
 * игрок — E у прилавка) и общая столовая, куда горожане с пайком идут поесть за столом.
 */
export class StreetShops {
  readonly shops: StreetShop[] = [];
  readonly seats: CanteenSeat[] = [];
  /** Зал столовой (px) — для проверок «внутри». */
  readonly canteen: { x: number; y: number; w: number; h: number } | null;
  readonly stats = { meals: 0, purchases: 0, visits: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const ts = map.tileSize;
    const names = new Map<string, string>([...ARBAT.shops, ...ARBAT.cafes, ...ARBAT.kiosks].map((d) => [d.id, d.name]));
    const anchor = (x: number, y: number, r = 2): Vec2 | null => {
      const a = nav.nearestWalkable(x, y, r);
      return a >= 0 ? { x: nav.worldX(a), y: nav.worldY(a) } : null;
    };
    for (const p of map.poisOf('shop_front')) {
      const f = anchor((p.x + 0.5) * ts, (p.y + 0.5) * ts);
      const v = map.poisOf('vendor_spot').find((q) => q.id === p.id);
      const facade = map.poisOf('facade').find((q) => q.id === p.id);
      if (!f || !facade) continue;
      this.shops.push({
        id: p.id ?? -1,
        sub: p.sub ?? '',
        name: names.get(p.sub ?? '') ?? 'Лавка',
        kind: facade.use === 'cafe' ? 'cafe' : 'shop',
        front: f,
        look: v ? { x: (v.x + 0.5) * ts, y: (v.y + 0.5) * ts } : f,
        stock: ARBAT.stock[p.sub ?? ''] ?? [],
      });
    }
    for (const k of map.poisOf('kiosk')) {
      // Покупатель — перед окошком (сторона face), в полутора тайлах от ларька.
      const cx = (k.x + k.w! / 2) * ts;
      const cy = (k.y + k.h! / 2) * ts;
      const [dx, dy] = k.face === 'N' ? [0, -1] : k.face === 'S' ? [0, 1] : k.face === 'W' ? [-1, 0] : [1, 0];
      const reach = ((dx ? k.w! : k.h!) / 2 + 1.2) * ts;
      const f = anchor(cx + dx * reach, cy + dy * reach, 1);
      if (!f) continue;
      this.shops.push({ id: -1, sub: k.sub ?? '', name: names.get(k.sub ?? '') ?? 'Ларёк', kind: 'kiosk', front: f, look: { x: cx, y: cy }, stock: ARBAT.stock[k.sub ?? ''] ?? [] });
    }
    // Места за столами столовой: вдоль длинных сторон стола через тайл-якорь (2 тайла).
    const c = map.poisOf('canteen')[0];
    this.canteen = c ? { x: c.x * ts, y: c.y * ts, w: c.w! * ts, h: c.h! * ts } : null;
    map.poisOf('canteen_table').forEach((t, k) => {
      const horiz = t.w! >= t.h!;
      const len = horiz ? t.w! : t.h!;
      for (let s = 0; s + 1 < len; s += 2) {
        for (const side of [-1, 1]) {
          // Якорь 2×2 вплотную к столу: центр — на стыке тайлов в тайле от кромки стола.
          const ax = horiz ? t.x + s : side < 0 ? t.x - 2 : t.x + t.w!;
          const ay = horiz ? (side < 0 ? t.y - 2 : t.y + t.h!) : t.y + s;
          if (!nav.isWalkable(ax, ay)) continue;
          const x = (ax + 1) * ts;
          const y = (ay + 1) * ts;
          this.seats.push({ x, y, lookX: horiz ? x : (t.x + t.w! / 2) * ts, lookY: horiz ? (t.y + t.h! / 2) * ts : y, table: k, taken: null });
        }
      }
    });
  }

  /** Есть ли лавка или ларёк не дальше visit.seek. */
  shopNear(c: Character): boolean {
    const r = ARBAT.visit.seek;
    return this.shops.some((s) => Math.abs(s.front.x - c.x) < r && Math.abs(s.front.y - c.y) < r);
  }

  /** Лавка с товаром (или «для вида» — у кого нет токенов) неподалёку от c. */
  pickShop(c: Character, rng: Rng): StreetShop | null {
    const V = ARBAT.visit;
    const near = this.shops.filter((s) => Math.hypot(s.front.x - c.x, s.front.y - c.y) < V.seek && this.ctx.map.levelAt(s.front.x, s.front.y) === this.ctx.map.levelAt(c.x, c.y));
    return near.length ? rng.pick(near) : null;
  }

  /**
   * Покупка NPC у прилавка: голодный — еду, иначе что по карману. Возвращает купленное или null
   * (нечего/не на что).
   */
  npcBuy(c: Character, s: StreetShop, rng: Rng): ItemId | null {
    const eco = this.ctx.economy;
    const hungry = c.hunger < ECONOMY.hunger.npcEatBelow + 30;
    const afford = s.stock.filter((id) => (eco.shopPrice(c, id) ?? Infinity) <= c.money);
    const want = hungry ? afford.filter((id) => ITEMS[id].food) : afford;
    const list = want.length ? want : afford;
    if (!list.length) return null;
    const id = rng.pick(list);
    if (eco.buy(c, id) !== null) return null;
    this.stats.purchases++;
    return id;
  }

  /** Лавка, у прилавка которой стоит p (игрок), или null. */
  shopAt(p: Vec2, reach: number): StreetShop | null {
    let best: StreetShop | null = null;
    let bestD = reach;
    for (const s of this.shops) {
      const d = Math.hypot(s.front.x - p.x, s.front.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Есть ли у c еда (сперва рацион). */
  foodOf(c: Character): ItemId | null {
    if (c.inventory.has('ration')) return 'ration';
    const slot = c.inventory.slots.find((s) => ITEMS[s.id].food && s.qty > 0);
    return slot ? slot.id : null;
  }

  /** Свободное место за столом (где уже едят — привлекательнее), не дальше seek. */
  takeSeat(c: Character, rng: Rng): CanteenSeat | null {
    const own = this.seats.find((s) => s.taken === c);
    if (own) return own;
    const M = ARBAT.meal;
    const free = this.seats.filter((s) => !s.taken && Math.hypot(s.x - c.x, s.y - c.y) < M.seek);
    if (!free.length) return null;
    const busy = (s: CanteenSeat) => this.seats.some((o) => o.table === s.table && o.taken);
    const pref = free.filter(busy);
    const s = rng.pick(pref.length && rng.chance(0.7) ? pref : free);
    s.taken = c;
    return s;
  }

  releaseSeat(c: Character): void {
    for (const s of this.seats) if (s.taken === c) s.taken = null;
  }

  /** Поесть за столом: лучшая еда из инвентаря, лояльным — чуть лояльности. */
  eat(c: Character): boolean {
    const id = this.foodOf(c);
    if (!id || !this.ctx.economy.use(c, id)) return false;
    this.stats.meals++;
    if (hasLoyalty(c)) adjustLoyalty(c, ARBAT.meal.loyalty, 'обед в общей столовой', this.ctx.bus);
    return true;
  }

  /** Может ли c пойти поесть в столовую сейчас. */
  wantsMeal(c: Character): boolean {
    return this.seats.length > 0 && c.hunger < ARBAT.meal.hungerBelow && !!this.foodOf(c);
  }

  update(): void {
    for (const s of this.seats) if (s.taken && !s.taken.alive) s.taken = null;
  }
}
