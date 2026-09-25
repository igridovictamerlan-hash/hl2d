import type { Character } from '../entities/Character';
import type { EntityManager } from '../entities/EntityManager';
import type { GameMap } from '../world/GameMap';
import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/rng';
import { ECONOMY } from '../config/economy';
import { ITEMS, WEAPONS, AMMO_ITEM, type ItemId, type WeaponId } from '../config/items';
import { T } from '../world/tiles';
import type { Vec2 } from '../core/math';

/**
 * Точка поломки — чинит ГСР. fuse — щиток в переулке (ломается сам), node — узел Альянса
 * на проспекте или площади (выходит из строя только от саботажа, ремонт дороже).
 */
export interface RepairSpot {
  index: number;
  kind: 'fuse' | 'node';
  x: number;
  y: number;
  broken: boolean;
  /** Кто сейчас чинит. */
  worker: Character | null;
  progress: number;
}

/**
 * Экономика Сити-17:
 *  - раздача рационов по таймеру: окно у будки на площади, живая очередь, выдаёт работник ГСР;
 *    рацион = паёк в инвентарь + токены, один раз за раздачу на CID;
 *  - сытость у всех падает, голодающий теряет здоровье; NPC сами едят, если есть еда;
 *  - зарплаты ГО, ГСР (если работал), Администратору;
 *  - поломки по городу, которые чинит ГСР (оплата за ремонт);
 *  - магазин ГСР: покупка за токены.
 */
export class EconomySystem {
  /** Окно раздачи открыто. */
  open = false;
  /** До следующего открытия / закрытия, с. */
  timer: number = ECONOMY.rations.firstDelay;
  /** Номер раздачи (1, 2, …). */
  cycle = 0;
  readonly queue: Character[] = [];
  /** Кто стоит на выдаче. */
  dispenser: Character | null = null;
  readonly repairs: RepairSpot[] = [];
  private served = new Set<number>();
  private serveProgress = 0;
  private salaryTimer: number = ECONOMY.salary.interval;
  private breakTimer: number;
  /** Кто работал в этот период зарплаты (ГСР). */
  private worked = new Set<number>();
  private time = 0;

  /** Окно раздачи, куда смотрит очередь (px), и направление очереди от окна. */
  readonly window: Vec2;
  readonly queueDir: Vec2;
  readonly dispenserSpot: Vec2;
  readonly shopCounter: Vec2 | null;

  constructor(
    private readonly map: GameMap,
    private readonly entities: EntityManager,
    private readonly bus: EventBus,
    private readonly rng: Rng,
  ) {
    const ts = map.tileSize;
    const w = map.poisOf('ration_window')[0];
    this.window = w ? { x: (w.x + 0.5) * ts, y: (w.y + 0.5) * ts } : { x: map.worldWidth / 2, y: map.worldHeight / 2 };
    // Будка — непроходимый тайл рядом с окном; очередь уходит в противоположную сторону.
    let dir = { x: 0, y: 1 };
    if (w) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (map.tileAt(w.x + dx, w.y + dy) === T.METAL) dir = { x: -dx, y: -dy };
      }
    }
    this.queueDir = dir;
    this.dispenserSpot = { x: this.window.x, y: this.window.y };
    const s = map.poisOf('shop_counter')[0];
    this.shopCounter = s ? { x: (s.x + 0.5) * ts, y: (s.y + 0.5) * ts } : null;
    this.breakTimer = rng.range(ECONOMY.repairs.breakEvery[0], ECONOMY.repairs.breakEvery[1]);
    this.buildRepairSpots();
  }

  get now(): number {
    return this.time;
  }

  /** Задаёт Game/WarSystem: при комендантском часе раздача не открывается. */
  paused: () => boolean = () => false;

  /** Места поломок: пол переулка у стены, разнесённые друг от друга. */
  private buildRepairSpots(): void {
    const map = this.map;
    const ts = map.tileSize;
    const kinds = new Set(['residential', 'industrial', 'avenue']);
    for (let tries = 0; tries < 4000 && this.repairs.length < ECONOMY.repairs.spots; tries++) {
      const x = this.rng.int(3, map.width - 4);
      const y = this.rng.int(3, map.height - 4);
      if (map.tileAt(x, y) !== T.FLOOR || !kinds.has(map.zoneAtTile(x, y)?.kind ?? '')) continue;
      const nextToWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.tileAt(x + dx, y + dy) === T.WALL);
      if (!nextToWall) continue;
      const wx = (x + 0.5) * ts;
      const wy = (y + 0.5) * ts;
      if (this.repairs.some((r) => Math.hypot(r.x - wx, r.y - wy) < 14 * ts)) continue;
      this.repairs.push({ index: this.repairs.length, kind: 'fuse', x: wx, y: wy, broken: false, worker: null, progress: 0 });
    }
    // Узлы Альянса: у стены на проспекте или площади, разнесённые по городу.
    const N = ECONOMY.nodes;
    let nodes = 0;
    for (let tries = 0; tries < 6000 && nodes < N.count; tries++) {
      const x = this.rng.int(3, map.width - 4);
      const y = this.rng.int(3, map.height - 4);
      const t = map.tileAt(x, y);
      if (t !== T.STREET && t !== T.PLAZA) continue;
      const kind = map.zoneAtTile(x, y)?.kind;
      if (kind !== 'avenue' && kind !== 'plaza') continue;
      const wall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.isOpaque(x + dx, y + dy));
      if (!wall) continue;
      const wx = (x + 0.5) * ts;
      const wy = (y + 0.5) * ts;
      if (this.repairs.some((r) => r.kind === 'node' && Math.hypot(r.x - wx, r.y - wy) < N.spacing * ts)) continue;
      this.repairs.push({ index: this.repairs.length, kind: 'node', x: wx, y: wy, broken: false, worker: null, progress: 0 });
      nodes++;
    }
  }

  get nodes(): RepairSpot[] {
    return this.repairs.filter((r) => r.kind === 'node');
  }

  /** Задаёт WarSystem: саботаж — тревога Администратора. */
  onSabotage: (spot: RepairSpot, by: Character) => void = () => {};

  /** Саботаж узла Альянса. */
  sabotage(spot: RepairSpot, by: Character): void {
    if (spot.kind !== 'node' || spot.broken) return;
    spot.broken = true;
    spot.progress = 0;
    const zone = this.map.zoneAtWorld(spot.x, spot.y)?.name ?? 'город';
    this.bus.emit('log', { text: `Надзор: узел Альянса выведен из строя — ${zone}. Саботаж!`, kind: 'radio' });
    this.onSabotage(spot, by);
  }

  /** Позиция места в очереди (0 — у окна). */
  queueSlot(i: number): Vec2 {
    const R = ECONOMY.rations;
    const d = 36 + i * R.queueSpacing;
    return { x: this.window.x + this.queueDir.x * d, y: this.window.y + this.queueDir.y * d };
  }

  hasBeenServed(c: Character): boolean {
    return this.served.has(c.id);
  }

  /** Закрыть раздачу досрочно (тревога): следующая — через обычный перерыв. */
  forceClose(): void {
    if (!this.open) return;
    this.open = false;
    this.queue.length = 0;
    this.timer = ECONOMY.rations.interval - ECONOMY.rations.duration;
    this.bus.emit('log', { text: 'Раздача рационов прервана.', kind: 'world' });
  }

  /** Встать в очередь. Возвращает номер (0 — первый) или -1. */
  joinQueue(c: Character): number {
    if (!this.open || this.served.has(c.id)) return -1;
    const i = this.queue.indexOf(c);
    if (i >= 0) return i;
    if (this.queue.length >= ECONOMY.rations.queueSlots) return -1;
    this.queue.push(c);
    return this.queue.length - 1;
  }

  leaveQueue(c: Character): void {
    const i = this.queue.indexOf(c);
    if (i >= 0) this.queue.splice(i, 1);
  }

  /** Работник ГСР встаёт на выдачу (если место свободно). */
  claimDispenser(c: Character): boolean {
    if (this.dispenser && this.dispenser !== c && this.dispenser.alive && this.dispenserBusy(this.dispenser)) return false;
    this.dispenser = c;
    return true;
  }

  releaseDispenser(c: Character): void {
    if (this.dispenser === c) this.dispenser = null;
  }

  /** Работник на месте выдачи. */
  dispenserBusy(c: Character): boolean {
    return Math.hypot(c.x - this.dispenserSpot.x, c.y - this.dispenserSpot.y) < 40;
  }

  markWorked(c: Character): void {
    this.worked.add(c.id);
  }

  /** Выдать рацион первому в очереди (вызывает работник ГСР). */
  serveNext(worker: Character): Character | null {
    const c = this.queue[0];
    if (!c || !this.open) return null;
    const slot = this.queueSlot(0);
    if (Math.hypot(c.x - slot.x, c.y - slot.y) > 30) return null;
    this.queue.shift();
    this.served.add(c.id);
    const R = ECONOMY.rations;
    c.inventory.add(R.item, 1);
    c.money += R.tokens;
    worker.money += ECONOMY.cwuPay.rationServed;
    this.markWorked(worker);
    if (c.isPlayer) this.bus.emit('log', { text: `Вы получили рацион и ${R.tokens} токенов.`, kind: 'world' });
    return c;
  }

  /** Съесть/использовать предмет. */
  use(c: Character, id: ItemId): boolean {
    const def = ITEMS[id];
    // Поддельная CID: «чистая» карта, розыск снят.
    if (id === 'fake_cid') {
      if (!c.inventory.remove(id, 1)) return false;
      c.law.hasCid = true;
      c.law.wanted = false;
      return true;
    }
    if (!def.food && !def.heal) return false;
    if (!c.inventory.remove(id, 1)) return false;
    if (def.food) c.hunger = Math.min(ECONOMY.hunger.max, c.hunger + def.food);
    if (def.heal) c.health = Math.min(c.maxHealth, c.health + def.heal);
    return true;
  }

  /** Купить в магазине. */
  buy(c: Character, id: ItemId): string | null {
    const price = ITEMS[id].price;
    if (price === undefined) return 'Этого в магазине нет.';
    if (c.money < price) return `Не хватает токенов: нужно ${price}.`;
    if (c.inventory.add(id, 1) === 0) return 'Инвентарь полон.';
    c.money -= price;
    // Продавец ГСР у прилавка получает процент.
    if (this.shopCounter) {
      for (const o of this.entities.near(this.shopCounter.x, this.shopCounter.y, 48)) {
        if (o.faction === 'cwu' && o !== c) {
          o.money += ECONOMY.cwuPay.sale;
          this.markWorked(o);
          break;
        }
      }
    }
    return null;
  }

  /** Чёрный рынок: купить позицию k из ECONOMY.blackMarket.stock. */
  buyBlack(c: Character, k: number): string | null {
    const s = ECONOMY.blackMarket.stock[k];
    if (!s) return 'Нет такого товара.';
    if (c.money < s.price) return `Не хватает токенов: нужно ${s.price}.`;
    const got = c.inventory.add(s.id, s.qty);
    if (got < s.qty) {
      if (got > 0) c.inventory.remove(s.id, got);
      return 'Инвентарь полон.';
    }
    c.money -= s.price;
    return null;
  }

  /** Чёрный рынок: продать одну штуку. */
  sellBlack(c: Character, id: ItemId): string | null {
    const price = ECONOMY.blackMarket.sell[id];
    if (price === undefined) return 'Это здесь не берут.';
    if (!c.inventory.remove(id, 1)) return 'Нечего продавать.';
    if (c.weapon === id && !c.inventory.has(id)) c.equip(null);
    c.money += price;
    return null;
  }

  /**
   * Пополнить боекомплект: для каждого ствола в инвентаре — запас до mags магазинов
   * (тайник повстанцев, стойка дежурного в Нексусе). Остальные вещи не трогает.
   */
  refillAmmo(c: Character, mags: number): number {
    let added = 0;
    for (const s of [...c.inventory.slots]) {
      const w = WEAPONS[s.id as WeaponId];
      if (!w?.ammo) continue;
      const item = AMMO_ITEM[w.ammo];
      const need = w.magazine * mags - c.inventory.count(item);
      if (need > 0) added += c.inventory.add(item, need);
    }
    return added;
  }

  /** Ремонт: вызывать каждый тик, пока работник у поломки. true — закончил. */
  repairStep(worker: Character, spot: RepairSpot, dt: number): boolean {
    if (!spot.broken) return true;
    spot.worker = worker;
    spot.progress += dt;
    this.markWorked(worker);
    if (spot.progress < ECONOMY.repairs.time) return false;
    spot.broken = false;
    spot.worker = null;
    spot.progress = 0;
    const pay = spot.kind === 'node' ? ECONOMY.cwuPay.node : ECONOMY.cwuPay.repair;
    worker.money += pay;
    const what = spot.kind === 'node' ? 'узел Альянса' : 'неисправность';
    this.bus.emit('log', { text: `${worker.isPlayer ? 'Вы починили' : `${worker.name} (ГСР) починил`} ${what}. +${pay} токенов`, kind: 'world' });
    return true;
  }

  brokenSpots(): RepairSpot[] {
    return this.repairs.filter((r) => r.broken);
  }

  update(dt: number): void {
    this.time += dt;
    const R = ECONOMY.rations;
    // Раздача по таймеру.
    this.timer -= dt;
    if (this.timer <= 0 && this.paused()) this.timer = 5;
    if (this.timer <= 0) {
      this.open = !this.open;
      if (this.open) {
        this.cycle++;
        this.served.clear();
        this.timer = R.duration;
        this.bus.emit('announce', { text: 'Раздача рационов открыта' });
        this.bus.emit('log', { text: 'Администрация: граждане, пройдите к пункту раздачи рационов на площади.', kind: 'world' });
      } else {
        this.timer = R.interval - R.duration;
        this.queue.length = 0;
        this.bus.emit('log', { text: 'Раздача рационов окончена.', kind: 'world' });
      }
    }
    // Очередь: выбывшие — вон.
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const c = this.queue[i];
      const gone = !c.alive || c.law.phase !== 'none' || (c.isPlayer && Math.hypot(c.x - this.window.x, c.y - this.window.y) > 320);
      if (gone) this.queue.splice(i, 1);
    }
    // NPC-работник выдаёт сам.
    const d = this.dispenser;
    if (d && (!d.alive || d.law.phase !== 'none')) this.dispenser = null;
    if (this.open && d && !d.isPlayer && this.dispenserBusy(d) && this.queue.length > 0) {
      this.serveProgress += dt;
      if (this.serveProgress >= R.serveTime) {
        this.serveProgress = 0;
        this.serveNext(d);
      }
    } else this.serveProgress = 0;

    // Сытость и голод.
    const H = ECONOMY.hunger;
    for (const c of this.entities.list) {
      if (!c.alive) continue;
      c.hunger = Math.max(0, c.hunger - H.decayPerSec * dt);
      if (c.hunger <= 0) c.health = Math.max(1, c.health - H.starveDamage * dt);
      // NPC сам перевязывается, если есть чем.
      if (!c.isPlayer && c.health < c.maxHealth * 0.45) {
        const med = c.inventory.slots.find((s) => ITEMS[s.id].heal);
        if (med) this.use(c, med.id);
      }
      if (!c.isPlayer && c.hunger < H.npcEatBelow) {
        for (const s of c.inventory.slots) {
          if (ITEMS[s.id].food) {
            this.use(c, s.id);
            break;
          }
        }
      }
    }

    // Зарплаты.
    this.salaryTimer -= dt;
    if (this.salaryTimer <= 0) {
      this.salaryTimer = ECONOMY.salary.interval;
      const S = ECONOMY.salary;
      for (const c of this.entities.list) {
        if (!c.alive) continue;
        let pay = 0;
        if (c.faction === 'cp') pay = S.cp + S.cpPerRank * c.rank;
        else if (c.faction === 'admin') pay = S.admin;
        else if (c.faction === 'cwu' && this.worked.has(c.id)) pay = S.cwu;
        if (pay <= 0) continue;
        c.money += pay;
        if (c.isPlayer) this.bus.emit('log', { text: `Зарплата: +${pay} токенов.`, kind: 'world' });
      }
      this.worked.clear();
    }

    // Поломки.
    this.breakTimer -= dt;
    if (this.breakTimer <= 0) {
      this.breakTimer = this.rng.range(ECONOMY.repairs.breakEvery[0], ECONOMY.repairs.breakEvery[1]);
      const intact = this.repairs.filter((r) => !r.broken && r.kind === 'fuse');
      if (intact.length > 0 && this.brokenSpots().filter((r) => r.kind === 'fuse').length < ECONOMY.repairs.maxBroken) {
        const r = this.rng.pick(intact);
        r.broken = true;
        r.progress = 0;
        const zone = this.map.zoneAtWorld(r.x, r.y)?.name ?? 'город';
        this.bus.emit('log', { text: `ГСР: неисправность — ${zone}. Требуется ремонт.`, kind: 'world' });
      }
    }
    for (const r of this.repairs) if (r.worker && (!r.worker.alive || Math.hypot(r.worker.x - r.x, r.worker.y - r.y) > 40)) r.worker = null;
  }
}
