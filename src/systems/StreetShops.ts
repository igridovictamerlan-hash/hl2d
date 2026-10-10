import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Rng } from '../core/rng';
import { ARBAT } from '../config/arbat';
import { ITEMS, type ItemId } from '../config/items';
import { ECONOMY } from '../config/economy';
import { LOYALTY } from '../config/loyalty';
import { ESCALATION } from '../config/escalation';
import { adjustLoyalty, hasLoyalty } from './Loyalty';

/** Лавка, кафе или ларёк на проспекте: где стоит покупатель, что продают, кто за прилавком. */
export interface StreetShop {
  /** id дома (POI facade) или -1 — ларёк. */
  id: number;
  sub: string;
  name: string;
  kind: 'shop' | 'cafe' | 'kiosk';
  /** Место покупателя перед прилавком (окошком) и куда смотреть. */
  front: Vec2;
  look: Vec2;
  /** Место продавца за прилавком (у ларька — внутри, продавец не нужен). */
  vendorSpot: Vec2 | null;
  stock: readonly ItemId[];
  /** Запас товара (единиц) и предел — привозят курьеры из штаба ТС. */
  goods: number;
  cap: number;
  /** Продавец этой лавки и курьер, который несёт сюда коробку. */
  vendor: Character | null;
  supplier: Character | null;
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

/** Куда курьер несёт коробку: лавка, ларёк или столовая. */
export type SupplyTarget = { shop: StreetShop } | { canteen: true };

/**
 * Улица старого города: лавки, кафе и ларьки главного проспекта (горожане заходят купить что-нибудь,
 * игрок — E у прилавка) и общая столовая, куда горожане с пайком идут поесть за столом, а без пайка
 * — за супом. Товар и суп привозят курьеры из штаба ТС (коробки цеха); за прилавком — продавец,
 * у котла — повар столовой; без них лавка закрыта, супа нет.
 */
export class StreetShops {
  readonly shops: StreetShop[] = [];
  readonly seats: CanteenSeat[] = [];
  /** Зал столовой (px) — для проверок «внутри». */
  readonly canteen: { x: number; y: number; w: number; h: number } | null;
  /** Котёл (место повара) и раздача супа (куда подходят с миской и куда несут коробки). */
  readonly cookSpot: Vec2 | null;
  readonly serveSpot: Vec2 | null;
  soup: number;
  readonly soupCap: number;
  cook: Character | null = null;
  soupSupplier: Character | null = null;
  readonly stats = { meals: 0, soups: 0, purchases: 0, visits: 0, closed: 0, empty: 0, delivered: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const ts = map.tileSize;
    const S = ARBAT.supply;
    const names = new Map<string, string>([...ARBAT.shops, ...ARBAT.cafes, ...ARBAT.kiosks].map((d) => [d.id, d.name]));
    const anchor = (x: number, y: number, r = 2): Vec2 | null => {
      const a = nav.nearestWalkable(x, y, r);
      return a >= 0 ? { x: nav.worldX(a), y: nav.worldY(a) } : null;
    };
    const start = Math.round(S.cap * S.start);
    for (const p of map.poisOf('shop_front')) {
      const f = anchor((p.x + 0.5) * ts, (p.y + 0.5) * ts);
      const v = map.poisOf('vendor_spot').find((q) => q.id === p.id);
      const facade = map.poisOf('facade').find((q) => q.id === p.id);
      if (!f || !facade) continue;
      const vs = v ? anchor((v.x + 0.5) * ts, (v.y + 0.5) * ts, 1) : null;
      this.shops.push({
        id: p.id ?? -1,
        sub: p.sub ?? '',
        name: names.get(p.sub ?? '') ?? 'Лавка',
        kind: facade.use === 'cafe' ? 'cafe' : 'shop',
        front: f,
        look: v ? { x: (v.x + 0.5) * ts, y: (v.y + 0.5) * ts } : f,
        vendorSpot: vs,
        stock: ARBAT.stock[p.sub ?? ''] ?? [],
        goods: start,
        cap: S.cap,
        vendor: null,
        supplier: null,
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
      this.shops.push({ id: -1, sub: k.sub ?? '', name: names.get(k.sub ?? '') ?? 'Ларёк', kind: 'kiosk', front: f, look: { x: cx, y: cy }, vendorSpot: null, stock: ARBAT.stock[k.sub ?? ''] ?? [], goods: start, cap: S.cap, vendor: null, supplier: null });
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
    const ck = map.poisOf('canteen_cook')[0];
    const sv = map.poisOf('canteen_serve')[0];
    this.cookSpot = ck ? anchor((ck.x + 0.5) * ts, (ck.y + 0.5) * ts, 1) : null;
    this.serveSpot = sv ? anchor((sv.x + 0.5) * ts, (sv.y + 0.5) * ts, 1) : null;
    this.soupCap = this.serveSpot ? S.canteenCap : 0;
    this.soup = Math.round(this.soupCap * S.start);
  }

  /**
   * Закрылась раньше времени: квартал опасен (Escalation.dread ≥ 2) и уже closeHour. Без распорядка дня — не в счёт.
   */
  closedEarly(s: StreetShop): boolean {
    const { ctx } = this;
    if (!ctx.escalation.enabled || !ctx.routine.enabled || ctx.escalation.dread(s.front.x, s.front.y) < 2) return false;
    return ctx.routine.hour() >= ESCALATION.shops.closeHour;
  }

  /** Лавка работает: у ларька — всегда, у лавки и кафе — пока продавец на месте (и не закрыта раньше времени). */
  open(s: StreetShop): boolean {
    if (this.closedEarly(s)) return false;
    if (!s.vendorSpot) return true;
    const v = s.vendor;
    return !!v && v.alive && v.fit && Math.hypot(v.x - s.vendorSpot.x, v.y - s.vendorSpot.y) < ARBAT.staff.reach;
  }

  /** Повар у котла — суп наливают. */
  get kitchenOpen(): boolean {
    const c = this.cook;
    return !!c && !!this.cookSpot && c.alive && c.fit && Math.hypot(c.x - this.cookSpot.x, c.y - this.cookSpot.y) < ARBAT.staff.reach;
  }

  // ——— Персонал ———

  /** Лавка продавца c: своя или та, где продавца нет (погибший возрождается и встаёт к свободной). */
  workplace(c: Character): StreetShop | null {
    const own = this.shops.find((s) => s.vendor === c);
    if (own) return own;
    let best: StreetShop | null = null;
    let bestD = Infinity;
    for (const s of this.shops) {
      if (!s.vendorSpot || (s.vendor && s.vendor.alive && s.vendor.profession === 'vendor')) continue;
      const d = Math.hypot(s.front.x - c.x, s.front.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) best.vendor = c;
    return best;
  }

  /** Повар столовой: занять котёл (если свободен). */
  claimKitchen(c: Character): boolean {
    if (!this.cookSpot) return false;
    if (this.cook && this.cook !== c && this.cook.alive && this.cook.profession === 'canteen_cook') return false;
    this.cook = c;
    return true;
  }

  /** Сколько мест под продавцов (лавки и кафе, не ларьки). */
  get staffed(): StreetShop[] {
    return this.shops.filter((s) => s.vendorSpot);
  }

  // ——— Снабжение из штаба ТС ———

  /** Куда нужнее всего коробка (запас ниже доли low, никто уже не несёт), или null. */
  supplyNeed(): SupplyTarget | null {
    const L = ARBAT.supply.low;
    let best: StreetShop | null = null;
    let bestF: number = L;
    for (const s of this.shops) {
      if (!s.stock.length || (s.supplier && this.busySupplier(s.supplier))) continue;
      const f = s.goods / s.cap;
      if (f < bestF) {
        bestF = f;
        best = s;
      }
    }
    const soupF = this.soupCap ? this.soup / this.soupCap : 1;
    const soupFree = !this.soupSupplier || !this.busySupplier(this.soupSupplier);
    if (soupFree && soupF < L && soupF <= bestF) return { canteen: true };
    return best ? { shop: best } : null;
  }

  /** Курьер ещё занят этой доставкой (жив и не бросил работу). */
  private busySupplier(c: Character): boolean {
    return c.alive && (c.isPlayer || c.profession === 'courier');
  }

  /** Забронировать доставку за курьером. */
  claimSupply(c: Character, t: SupplyTarget): void {
    if ('shop' in t) t.shop.supplier = c;
    else this.soupSupplier = c;
  }

  releaseSupply(c: Character): void {
    for (const s of this.shops) if (s.supplier === c) s.supplier = null;
    if (this.soupSupplier === c) this.soupSupplier = null;
  }

  /** Куда нести (место покупателя у прилавка или раздача столовой). */
  dropOf(t: SupplyTarget): Vec2 | null {
    return 'shop' in t ? t.shop.front : this.serveSpot;
  }

  /** Сдать коробку: товар на полки (или суп в котёл), курьеру — оплата. */
  deliver(c: Character, t: SupplyTarget): boolean {
    if (!c.carrying) return false;
    const S = ARBAT.supply;
    c.carrying = false;
    if ('shop' in t) t.shop.goods = Math.min(t.shop.cap, t.shop.goods + S.perBox);
    else this.soup = Math.min(this.soupCap, this.soup + S.perBox);
    this.releaseSupply(c);
    this.stats.delivered++;
    c.money += S.pay;
    this.ctx.economy.markWorked(c);
    adjustLoyalty(c, LOYALTY.points.cwuWork, 'работа ТС', this.ctx.bus);
    return true;
  }

  /** Ближайшая точка сдачи товара к p (игрок-курьер — E у прилавка или раздачи столовой). */
  dropAt(p: Vec2, reach: number): SupplyTarget | null {
    let best: SupplyTarget | null = null;
    let bestD = reach;
    for (const s of this.shops) {
      if (!s.stock.length || s.goods >= s.cap) continue;
      const d = Math.hypot(s.front.x - p.x, s.front.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { shop: s };
      }
    }
    if (this.serveSpot && this.soup < this.soupCap && Math.hypot(this.serveSpot.x - p.x, this.serveSpot.y - p.y) < bestD) best = { canteen: true };
    return best;
  }

  // ——— Покупатели ———

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

  /** Почему в лавке не купить: закрыто, пусто — или null. */
  refusal(s: StreetShop): 'closed' | 'empty' | null {
    if (!this.open(s)) return 'closed';
    if (s.stock.length && s.goods <= 0) return 'empty';
    return null;
  }

  /** Покупка у прилавка (игрок или NPC): лавка открыта, товар есть — единица запаса уходит. */
  buy(c: Character, s: StreetShop, id: ItemId): string | null {
    const why = this.refusal(s);
    if (why === 'closed') return this.closedEarly(s) ? `${s.name}: ${ESCALATION.lines.shopEarly}` : `${s.name}: закрыто — продавца нет на месте.`;
    if (why === 'empty' || s.goods <= 0) return `${s.name}: товар кончился — ждут коробку из штаба ТС.`;
    if (!s.stock.includes(id)) return 'Этого здесь не продают.';
    // Продавец помнит покупателя: своим — скидка, недругам — надбавка, врагу не продаст.
    const rel = this.ctx.relations;
    const v0 = s.vendor && s.vendor.alive && s.sub !== 'cwu' ? s.vendor : null;
    if (rel?.enabled && v0 && !rel.willServe(v0, c)) {
      rel.refuseService(v0, c);
      return `${s.name}: продавец не хочет вас обслуживать.`;
    }
    const mul = rel?.enabled && v0 ? rel.priceMul(v0, c) : 1;
    const err = this.ctx.economy.buy(c, id, mul);
    if (err) return err;
    if (rel?.enabled && v0) rel.traded(v0, c, mul);
    s.goods--;
    this.stats.purchases++;
    // Продавцу — за продажу (как у прилавка магазина ТС; там economy.buy уже заплатил тому, кто рядом).
    const v = s.vendor;
    if (v && v.alive && s.vendorSpot && s.sub !== 'cwu') {
      v.money += ECONOMY.cwuPay.sale;
      this.ctx.economy.markWorked(v);
    }
    return null;
  }

  /**
   * Покупка NPC у прилавка: голодный — еду, иначе что по карману. Возвращает купленное или null
   * (нечего/не на что/закрыто).
   */
  npcBuy(c: Character, s: StreetShop, rng: Rng): ItemId | null {
    if (this.refusal(s)) return null;
    const eco = this.ctx.economy;
    const hungry = c.hunger < ECONOMY.hunger.npcEatBelow + 30;
    const afford = s.stock.filter((id) => (eco.shopPrice(c, id) ?? Infinity) <= c.money);
    const want = hungry ? afford.filter((id) => ITEMS[id].food) : afford;
    const list = want.length ? want : afford;
    if (!list.length) return null;
    const id = rng.pick(list);
    return this.buy(c, s, id) === null ? id : null;
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

  // ——— Столовая ———

  /** Есть ли у c еда (сперва рацион). */
  foodOf(c: Character): ItemId | null {
    if (c.inventory.has('ration')) return 'ration';
    const slot = c.inventory.slots.find((s) => ITEMS[s.id].food && s.qty > 0);
    return slot ? slot.id : null;
  }

  /** Налить супа (повар на месте, суп есть). */
  get soupReady(): boolean {
    return this.soup > 0 && this.kitchenOpen;
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

  /** Получить миску супа у раздачи (без пайка): true — суп в руках (съест за столом). */
  takeSoup(c: Character): boolean {
    if (!this.soupReady) return false;
    this.soup--;
    c.soupBowl = true;
    return true;
  }

  /** Поесть за столом: суп из миски или лучшая еда из инвентаря, лояльным — чуть лояльности. */
  eat(c: Character): boolean {
    if (c.soupBowl) {
      c.soupBowl = false;
      c.hunger = Math.min(ECONOMY.hunger.max, c.hunger + ARBAT.soup.food);
      this.stats.soups++;
    } else {
      const id = this.foodOf(c);
      if (!id || !this.ctx.economy.use(c, id)) return false;
    }
    this.stats.meals++;
    if (hasLoyalty(c)) adjustLoyalty(c, ARBAT.meal.loyalty, 'обед в общей столовой', this.ctx.bus);
    return true;
  }

  /** Может ли c пойти поесть в столовую сейчас: проголодался и есть паёк — или суп. */
  wantsMeal(c: Character): boolean {
    return this.seats.length > 0 && c.hunger < ARBAT.meal.hungerBelow && (!!this.foodOf(c) || this.soupReady);
  }

  update(): void {
    for (const s of this.seats) if (s.taken && !s.taken.alive) s.taken = null;
    for (const s of this.shops) {
      if (s.supplier && !this.busySupplier(s.supplier)) s.supplier = null;
    }
    if (this.soupSupplier && !this.busySupplier(this.soupSupplier)) this.soupSupplier = null;
  }
}
