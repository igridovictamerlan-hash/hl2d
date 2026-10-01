import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Dwelling } from './Housing';
import { Inventory } from '../entities/Inventory';
import { ECONOMY } from '../config/economy';
import { FENCE } from '../config/gangs';
import { ITEMS, WEAPONS, type ItemId, type WeaponId } from '../config/items';
import { GRENADE_KINDS } from './CombatSystem';
import { T } from '../world/tiles';

/** Товар, который у барыги только «с рук»: стволы и гранаты. */
export function handGoods(id: ItemId): boolean {
  return ITEMS[id].kind === 'weapon' || (GRENADE_KINDS as readonly string[]).includes(id);
}

/**
 * Барыга — и есть чёрный рынок: хата в доме у запретной зоны (config/gangs.ts, FENCE). Стволы и
 * гранаты у него — только принесённые (wares): партизаны сдают краденое со склада и с конвоев со
 * своих явок, игрок тоже может продать; банды и игрок покупают. Патроны, бинты, аптечки, отмычки и
 * поддельные CID — свои, без счёта. Заказ партизан (удар по ВС) барыга передаёт банде — вся связь
 * сопротивления с улицей идёт через него.
 */
export class Fence {
  readonly home: Dwelling | null;
  /** Где стоит барыга и куда подходят покупатели (у двери хаты). */
  readonly spot: Vec2 | null;
  readonly counter: Vec2 | null;
  readonly wares = new Inventory(FENCE.size);
  money = 0;
  trader: Character | null = null;
  /** Заказы на удар по ВС, ждущие банду (оплачены подпольем). */
  orders = 0;
  readonly stats = { boughtIn: 0, sold: 0, orders: 0, gangBuys: 0 };

  constructor(private readonly ctx: AiContext) {
    const H = ctx.housing;
    const gate = ctx.map.poisOf('restricted_gate')[0];
    const ts = ctx.map.tileSize;
    let home: Dwelling | null = null;
    if (H && gate) {
      const gx = (gate.x + 0.5) * ts;
      const gy = (gate.y + 0.5) * ts;
      let bestD = Infinity;
      for (const d of H.dwellings) {
        if (!(FENCE.kinds as readonly string[]).includes(d.kind) || d.spots.length < 3) continue;
        if (ctx.map.zoneAtWorld(d.at.x, d.at.y)?.kind === 'restricted') continue;
        const dist = Math.hypot(d.at.x - gx, d.at.y - gy);
        if (dist < bestD) {
          bestD = dist;
          home = d;
        }
      }
    }
    this.home = home;
    if (home) {
      home.reserved = true;
      // Барыга — в глубине комнаты, покупатель — у двери (место, ближайшее к улице).
      const door = this.doorSide(home);
      const byDoor = [...home.spots].sort((a, b) => Math.hypot(a.x - door.x, a.y - door.y) - Math.hypot(b.x - door.x, b.y - door.y));
      this.counter = byDoor[0];
      this.spot = byDoor.find((p) => Math.hypot(p.x - byDoor[0].x, p.y - byDoor[0].y) >= 30) ?? byDoor[byDoor.length - 1];
    } else {
      this.spot = this.counter = null;
    }
    for (const [id, n] of FENCE.start) this.wares.add(id, n);
  }

  /** Сторона двери комнаты: ближайший к комнате проходимый тайл снаружи (по периметру). */
  private doorSide(d: Dwelling): Vec2 {
    const { map } = this.ctx;
    const ts = map.tileSize;
    const r = d.room;
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      for (const y of [r.y - 1, r.y + r.h]) if (map.tileAt(x, y) === T.DOOR) return { x: (x + 0.5) * ts, y: (y + 0.5) * ts };
    }
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (const x of [r.x - 1, r.x + r.w]) if (map.tileAt(x, y) === T.DOOR) return { x: (x + 0.5) * ts, y: (y + 0.5) * ts };
    }
    return d.at;
  }

  get present(): boolean {
    return !!this.counter;
  }

  /** Барыга на месте (жив и у себя в хате). */
  get open(): boolean {
    const t = this.trader;
    return !!t && t.alive && !!this.spot && Math.hypot(t.x - this.spot.x, t.y - this.spot.y) < FENCE.reach;
  }

  /** Можно ли сейчас купить позицию каталога (стволы и гранаты — только из принесённого). */
  inStock(k: number): boolean {
    const s = ECONOMY.blackMarket.stock[k];
    return !!s && (!handGoods(s.id) || this.wares.has(s.id, s.qty));
  }

  /** Купить позицию k каталога ECONOMY.blackMarket.stock (игрок или бандит). */
  buy(c: Character, k: number): string | null {
    const s = ECONOMY.blackMarket.stock[k];
    if (!s) return 'Нет такого товара.';
    if (!this.open) return 'Барыги нет на месте.';
    if (!this.inStock(k)) return `${ITEMS[s.id].name}: сейчас нет — принесут, будет.`;
    if (c.money < s.price) return `Не хватает токенов: нужно ${s.price}.`;
    const got = c.inventory.add(s.id, s.qty);
    if (got < s.qty) {
      if (got > 0) c.inventory.remove(s.id, got);
      return 'Инвентарь полон.';
    }
    if (handGoods(s.id)) this.wares.remove(s.id, s.qty);
    c.money -= s.price;
    this.money += s.price;
    this.stats.sold++;
    return null;
  }

  /** Продать барыге одну штуку (игрок): стволы и гранаты — к нему в товар. */
  sell(c: Character, id: ItemId): string | null {
    const price = ECONOMY.blackMarket.sell[id];
    if (price === undefined) return 'Это здесь не берут.';
    if (!this.open) return 'Барыги нет на месте.';
    if (!c.inventory.remove(id, 1)) return 'Нечего продавать.';
    if (c.weapon === id && !c.inventory.has(id)) c.equip(null);
    c.money += price;
    if (handGoods(id)) this.wares.add(id, 1);
    this.stats.boughtIn++;
    return null;
  }

  /**
   * Партизан сдаёт краденое (стволы, гранаты, патроны из тайника явки и что при нём помечено как
   * добыча): товар — барыге, деньги — сопротивлению. Возвращает выручку.
   */
  takeIn(items: { id: ItemId; qty: number }[]): number {
    let pay = 0;
    for (const q of items) {
      const got = this.wares.add(q.id, q.qty);
      pay += Math.round((ECONOMY.blackMarket.sell[q.id] ?? 2) * FENCE.buyBack) * got;
      this.stats.boughtIn += got;
    }
    return pay;
  }

  /** Лучший ствол, который банда может купить на bank токенов (или null). */
  bestGunFor(bank: number, prefer: readonly WeaponId[]): { k: number; id: WeaponId; price: number } | null {
    const stock = ECONOMY.blackMarket.stock;
    for (const id of prefer) {
      const k = stock.findIndex((s) => s.id === id);
      if (k < 0 || !this.inStock(k) || stock[k].price > bank) continue;
      return { k, id, price: stock[k].price };
    }
    // Не из списка, но есть — любой ствол по карману.
    for (let k = 0; k < stock.length; k++) {
      const s = stock[k];
      if (WEAPONS[s.id as WeaponId] && this.inStock(k) && s.price <= bank && s.id !== 'knife') return { k, id: s.id as WeaponId, price: s.price };
    }
    return null;
  }

  /** Банда купила ствол (из товара) на деньги общака. */
  sellToGang(k: number): ItemId | null {
    const s = ECONOMY.blackMarket.stock[k];
    if (!s || !this.inStock(k)) return null;
    if (handGoods(s.id)) this.wares.remove(s.id, s.qty);
    this.money += s.price;
    this.stats.gangBuys++;
    return s.id;
  }

  /** Заказ подполья: удар по ВС руками банды. */
  placeOrder(): void {
    this.orders++;
    this.stats.orders++;
  }

  takeOrder(): boolean {
    if (this.orders <= 0) return false;
    this.orders--;
    return true;
  }
}
