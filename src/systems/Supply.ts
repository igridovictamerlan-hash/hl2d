import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Rng } from '../core/rng';
import type { Barge } from './Port';
import { SUPPLY } from '../config/port';
import { ITEMS, type ItemId } from '../config/items';
import { LOYALTY } from '../config/loyalty';
import { adjustLoyalty } from './Loyalty';

/** Ящик товара: что и сколько штук. */
export interface Crate {
  item: ItemId;
  qty: number;
}

/** Причал: ящики, снятые краном на набережную у корня пирса, и докер, который их сейчас грузит. */
export interface Dock {
  barge: Barge | null;
  /** Центр штабеля (px) и где встаёт докер. */
  pile: Vec2;
  spot: Vec2;
  crates: Crate[];
  /** Ещё на барже (кран снимает по ящику). */
  hold: Crate[];
  docker: Character | null;
}

/**
 * Живая экономика: баржа у причала (systems/Port: onArrive) → кран ставит ящики на набережную → докеры ТС
 * (профессия packer) везут тележкой на склад штаба ТС (cwu_store) — там товар поштучно (stock) → курьеры берут
 * коробки под нужды лавок, столовой и будки раздачи (take). Красный код, прорыв КПП, закрытый шлюз — река перекрыта
 * (Port.blocked), баржи не возвращаются, склад тает. Без порта на карте (старые JSON-карты) груз раз в cargo.every с
 * ложится прямо на склад. Своя случайность.
 */
export class SupplySystem {
  readonly docks: Dock[] = [];
  /** Где докеры сдают ящики и курьеры берут коробки (склад цеха штаба ТС), где докеры ждут баржу. */
  readonly store: Vec2 | null;
  readonly waitSpot: Vec2 | null;
  /** Стеллажи склада штаба ТС (бывшие конвейеры цеха, POI ration_line) — там видны ящики (px). */
  readonly racks: Vec2[] = [];
  /** Место у первого стеллажа (со стороны цеха) — отсюда докеры выходят на первую смену. */
  readonly shift: Vec2 | null = null;
  /** Склад штаба ТС: товар → штук. */
  readonly stock = new Map<ItemId, number>();
  /** Множитель населения (Population): ящиков за рейс больше. */
  scale = 1;
  /** Почему река перекрыта (красный код, прорыв, шлюз) — или null. */
  blockade: string | null = null;
  private haltUntil = -1;
  private time = 0;
  private directAt: number = SUPPLY.cargo.every;
  private noticeAt = -1e9;
  /** Своя случайность (докеры тоже берут её — общая случайность мира не сдвигается). */
  readonly rng: Rng;
  readonly stats = { barges: 0, crates: 0, unloaded: 0, taken: 0, halts: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    this.rng = ctx.rng.fork(0x5a991e);
    const ts = map.tileSize;
    const anchor = (x: number, y: number, r = 3): Vec2 | null => {
      const a = nav.nearestWalkable(x, y, r);
      return a >= 0 ? { x: nav.worldX(a), y: nav.worldY(a) } : null;
    };
    const piers = map.poisOf('port_pier');
    const port = ctx.port;
    for (const b of port?.barges ?? []) {
      // Штабель — на набережной у корня ближайшего пирса (со стороны берега).
      const bc = { x: (b.berth.x + b.berth.w! / 2) * ts, y: (b.berth.y + b.berth.h! / 2) * ts };
      let pier = piers[0];
      let bd = Infinity;
      for (const p of piers) {
        const d = Math.hypot((p.x + p.w! / 2) * ts - bc.x, (p.y + p.h! / 2) * ts - bc.y);
        if (d < bd) {
          bd = d;
          pier = p;
        }
      }
      if (!pier) continue;
      const root = anchor((pier.x - 1.5) * ts, (pier.y + pier.h! / 2) * ts, 4);
      if (!root) continue;
      const spot = anchor(root.x - ts * 2, root.y, 3) ?? root;
      const startPile = Array.from({ length: SUPPLY.cargo.startPile }, () => this.crate());
      this.docks.push({ barge: b, pile: root, spot, crates: startPile, hold: [], docker: null });
    }
    if (port) {
      port.onArrive = (b) => this.arrive(b);
      port.onDepart = (b) => this.depart(b);
    }
    for (const l of map.poisOf('ration_line')) this.racks.push({ x: (l.x + 0.5) * ts, y: (l.y + 0.5) * ts });
    const room = map.poisOf('cwu_production')[0];
    const r0 = this.racks[0];
    if (r0) {
      // Шаг от стеллажа к середине цеха — по оси, поперёк стены.
      const dx = room ? (room.x + room.w! / 2) * ts - r0.x : 0;
      const dy = room ? (room.y + room.h! / 2) * ts - r0.y : 1;
      const [sx, sy] = Math.abs(dx) > Math.abs(dy) * 1.2 ? [Math.sign(dx), 0] : [0, Math.sign(dy) || 1];
      this.shift = anchor(r0.x + sx * SUPPLY.rackStand, r0.y + sy * SUPPLY.rackStand, 2);
    }
    const st = map.poisOf('cwu_store')[0];
    this.store = st ? anchor((st.x + 0.5) * ts, (st.y + 0.5) * ts) : null;
    const q = map.poisOf('port_quay')[0];
    this.waitSpot = this.docks[0] ? this.docks[Math.min(1, this.docks.length - 1)].spot : q ? anchor((q.x + q.w! / 2) * ts, (q.y + q.h! / 2) * ts, 4) : null;
    const W = SUPPLY.warehouse;
    for (const [id] of SUPPLY.manifest) this.stock.set(id, (SUPPLY.crate[id] ?? 1) * (id === 'ration' ? W.startRations : W.start));
  }

  get now(): number {
    return this.time;
  }

  /** Есть ли порт с причалами (иначе груз идёт прямо на склад). */
  get present(): boolean {
    return this.docks.length > 0;
  }

  /** Сколько штук товара на складе. */
  count(id: ItemId): number {
    return this.stock.get(id) ?? 0;
  }

  /** Предел склада по товару (штук). */
  cap(id: ItemId): number {
    return (SUPPLY.crate[id] ?? 1) * SUPPLY.warehouse.crates;
  }

  /** Ящиков товара на складе (вверх) — для отрисовки штабелей. */
  crateCount(id: ItemId): number {
    return Math.ceil(this.count(id) / (SUPPLY.crate[id] ?? 1));
  }

  /** Положить на склад (предел мягкий: докеры не грузят товар, которого на складе под завязку, — привезённое кладут). */
  private put(id: ItemId, qty: number): void {
    this.stock.set(id, this.count(id) + qty);
  }

  /** Вернуть на склад нераспроданное из коробки (не списывая сверх предела). */
  giveBack(id: ItemId, qty: number): void {
    this.stock.set(id, this.count(id) + qty);
  }

  // ——— Курьеры: коробки со склада ———

  /** Взять со склада коробку: что из списка есть (не больше, чем лежит). Ничего — false. */
  take(c: Character, want: readonly Crate[]): boolean {
    if (c.carrying) return false;
    const got: Crate[] = [];
    for (const w of want) {
      const n = Math.min(w.qty, this.count(w.item));
      if (n <= 0) continue;
      this.stock.set(w.item, this.count(w.item) - n);
      got.push({ item: w.item, qty: n });
    }
    if (!got.length) return false;
    c.load = got;
    c.carrying = true;
    this.stats.taken++;
    return true;
  }

  // ——— Докеры: штабель у пирса → тележка → склад ———

  /** Причал, где докер c может грузить (свой или свободный, с ящиками, которым есть место на складе). */
  claim(c: Character): Dock | null {
    const own = this.docks.find((k) => k.docker === c);
    if (own && this.loadable(own)) return own;
    if (own) own.docker = null;
    let best: Dock | null = null;
    let bestD = Infinity;
    for (const k of this.docks) {
      if ((k.docker && k.docker !== c) || !this.loadable(k)) continue;
      const d = Math.hypot(k.spot.x - c.x, k.spot.y - c.y) - k.crates.length * 40;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best) best.docker = c;
    return best;
  }

  release(c: Character): void {
    for (const k of this.docks) if (k.docker === c) k.docker = null;
  }

  private loadable(k: Dock): boolean {
    return k.crates.some((cr) => this.count(cr.item) < this.cap(cr.item));
  }

  /** Погрузить на тележку до cart.crates ящиков (тех, которым есть место на складе). */
  loadCart(c: Character, k: Dock): boolean {
    if (c.load.length) return true;
    const got: Crate[] = [];
    for (let i = 0; i < k.crates.length && got.length < SUPPLY.cart.crates; ) {
      const cr = k.crates[i];
      if (this.count(cr.item) >= this.cap(cr.item)) {
        i++;
        continue;
      }
      got.push(cr);
      k.crates.splice(i, 1);
    }
    if (!got.length) return false;
    c.load = got;
    c.cart = true;
    if (k.docker === c) k.docker = null;
    return true;
  }

  /** Сдать тележку на складе штаба ТС: товар на склад, докеру — за ящик. */
  unloadCart(c: Character): number {
    if (!c.cart || !c.load.length) return 0;
    const n = c.load.length;
    for (const cr of c.load) this.put(cr.item, cr.qty);
    c.load = [];
    c.cart = false;
    this.stats.unloaded += n;
    c.money += SUPPLY.cart.pay * n;
    this.ctx.economy.markWorked(c);
    adjustLoyalty(c, LOYALTY.points.cwuWork, 'работа ТС', this.ctx.bus);
    if (c.isPlayer) this.log(`Склад ТС: сдано ${n} ящ. +${SUPPLY.cart.pay * n} токенов`);
    return n;
  }

  /** Причал со штабелем рядом с p (игрок-докер). */
  dockAt(p: Vec2, reach: number): Dock | null {
    return this.docks.find((k) => k.crates.length && Math.hypot(k.pile.x - p.x, k.pile.y - p.y) < reach + 24) ?? null;
  }

  // ——— Баржи ———

  private crate(): Crate {
    const total = SUPPLY.manifest.reduce((s, [, w]) => s + w, 0);
    let r = this.rng.next() * total;
    let id = SUPPLY.manifest[0][0];
    for (const [m, w] of SUPPLY.manifest) {
      r -= w;
      if (r <= 0) {
        id = m;
        break;
      }
    }
    return { item: id, qty: SUPPLY.crate[id] ?? 1 };
  }

  private cargo(): Crate[] {
    const n = Math.max(1, Math.round(SUPPLY.cargo.crates * this.scale));
    return Array.from({ length: n }, () => this.crate());
  }

  private arrive(b: Barge): void {
    const k = this.docks.find((d) => d.barge === b);
    if (!k) return;
    k.hold = this.cargo();
    this.stats.barges++;
    this.stats.crates += k.hold.length;
    this.craneT.set(k, 0);
    if (this.rng.chance(SUPPLY.halt.chance) && this.time >= this.haltUntil) {
      const t = this.rng.range(SUPPLY.halt.time[0], SUPPLY.halt.time[1]);
      this.haltUntil = this.time + t;
      this.stats.halts++;
      this.log(SUPPLY.lines.halt.replace('{n}', String(Math.round(t / 60))));
    }
  }

  private depart(b: Barge): void {
    const k = this.docks.find((d) => d.barge === b);
    if (k) k.hold = [];
  }

  private readonly craneT = new Map<Dock, number>();

  /** Почему река перекрыта: красный код, прорыв КПП, шлюз — или null. */
  private blockedWhy(): string | null {
    const war = this.ctx.war;
    if (war.code === 'red') return 'красный код';
    if (war.fronts.some((f) => f.owner === 'rebels')) return 'КПП прорван';
    if (this.time < this.haltUntil) return 'шлюз ГЭС закрыт';
    return null;
  }

  private log(text: string): void {
    this.ctx.bus.emit('log', { text, kind: 'world' });
  }

  update(dt: number): void {
    this.time += dt;
    const why = this.blockedWhy();
    if (why !== this.blockade) {
      if (why && why !== 'шлюз ГЭС закрыт') this.log(SUPPLY.lines.blockade.replace('{why}', why));
      else if (!why) this.log(SUPPLY.lines.resume);
      this.blockade = why;
    }
    if (this.ctx.port) this.ctx.port.blocked = !!why;
    // Кран: с баржи у причала — по ящику на набережную.
    for (const k of this.docks) {
      if (k.docker && (!k.docker.alive || (!k.docker.isPlayer && k.docker.profession !== 'packer'))) k.docker = null;
      if (!k.hold.length) continue;
      const t = (this.craneT.get(k) ?? 0) + dt;
      if (t < SUPPLY.cargo.crane) {
        this.craneT.set(k, t);
        continue;
      }
      this.craneT.set(k, 0);
      if (k.crates.length < SUPPLY.cargo.pile) k.crates.push(k.hold.shift()!);
      else k.hold = [];
    }
    // Без порта — груз прямо на склад.
    if (!this.present && this.time >= this.directAt) {
      this.directAt = this.time + SUPPLY.cargo.every;
      if (!why) for (const cr of this.cargo()) this.put(cr.item, cr.qty);
    }
    // Склад пустеет — сообщение в журнал.
    if (this.time - this.noticeAt > SUPPLY.notice) {
      const out = (['ration', 'bread', 'provisions'] as ItemId[]).filter((id) => this.count(id) <= 0);
      if (out.length) {
        this.noticeAt = this.time;
        this.log(SUPPLY.lines.low.replace('{what}', out.map((id) => ITEMS[id].name.toLowerCase()).join(', ')));
      }
    }
  }

  /** Строка для HUD рабочего ТС и замера: запас склада и что с баржами. */
  summary(): string {
    const top = (['ration', 'provisions', 'bread', 'water'] as ItemId[]).map((id) => `${ITEMS[id].name.toLowerCase()} ${this.count(id)}`).join(', ');
    const piles = this.docks.reduce((n, k) => n + k.crates.length, 0);
    return `Склад ТС: ${top} · у пирсов ${piles} ящ. · ${this.blockade ? `баржи стоят (${this.blockade})` : 'баржи ходят'}`;
  }

  /** Закрыть шлюз на t с (тесты, будущие диверсии). */
  halt(t: number): void {
    this.haltUntil = Math.max(this.haltUntil, this.time + t);
  }
}
