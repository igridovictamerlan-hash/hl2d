/** Описание системы — docs/city-life.md («Двери и ключи»). */
import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { DoorGroup } from './DoorSystem';
import type { StreetShop } from './StreetShops';
import { computeBuildings, openAt } from '../world/buildings';
import { T } from '../world/tiles';
import { FACTIONS } from '../config/factions';
import { LOCKS } from '../config/locks';

export type LockKind = 'home' | 'room' | 'shop';

/** Замок: двери, кто держит ключ, заперт ли сейчас. */
export interface Lock {
  id: number;
  kind: LockKind;
  doors: DoorGroup[];
  /** Жилища (Housing) — у их жильцов ключ (дом — все квартиры и комнаты, комната — одна). */
  homes: number[];
  /** Лавка: ключ у продавца и у курьера, который несёт коробку. */
  shop: StreetShop | null;
  /** Хозяин оставил незапертым (игрок у своей двери). */
  open: boolean;
  /** Дверь выбита — не держит до этого времени мира (жильцы чинят). */
  brokenUntil: number;
}

/** Под стражей (приказ, проверка, в наручниках, заводят, отпускают): дверь открывает ВС — идёт с ним. */
const escorted = (c: Character): boolean => c.law.phase !== 'none' && c.law.phase !== 'fleeing' && c.law.phase !== 'jailed';

/** Пропуск в чужой дом: позвали в гости, открыли на стук, вскрыл отмычкой. */
interface Pass {
  lock: number;
  until: number;
}

/**
 * Двери и ключи: входная дверь жилого дома и комната коммуналки — на защёлке (заперто всегда, жилец открывает своим
 * ключом — ключи от дома и комнаты по Character.home, сверх того — Character.keys); лавка и кафе — заперты, пока
 * продавца нет за прилавком (ключ у продавца и курьера). ВС, легион, комендант открывают любую служебной связкой.
 * Изнутри выйти может каждый. Запертая дверь — непроходима для чужого (DoorSystem: закрыта и заперта — стена для
 * столкновений), путь A* в чужой дом не строится (blockerFor — как вахта Access). Гость, открывший на стук, взломщик —
 * с пропуском на время; выбитая дверь стоит открытой до ремонта.
 */
export class Locks {
  readonly list: Lock[] = [];
  /** Якорь навигации → замок дома (лавки) и замок комнаты, где он (-1 — нет). */
  private readonly homeAt: Int32Array;
  private readonly roomAt: Int32Array;
  /** Жилище → его замки (дом и комната). */
  private readonly ofHome = new Map<number, number[]>();
  private readonly engagedNow: Uint8Array;
  private readonly passes = new Map<Character, Pass[]>();
  private acc = 0;
  enabled = true;
  /** Открыто ключом (дверь была заперта), отказы на стук, вскрыто, выбито, стуков, гостей. */
  readonly stats = { opened: 0, refused: 0, picked: 0, kicked: 0, knocks: 0, guests: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav, doors, housing } = ctx;
    const w = map.width;
    const B = computeBuildings(map);
    const tileOf = (x: number, y: number) => Math.floor(y / map.tileSize) * w + Math.floor(x / map.tileSize);
    const inRoom = (k: number, tx: number, ty: number) => {
      const r = housing.dwellings[k].room;
      return tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h;
    };
    // Жилища по зданиям (общежития — без замков: там общаги банд и коридорная система).
    const homesIn = new Map<number, number[]>();
    housing.dwellings.forEach((d, k) => {
      if (d.kind === 'dorm') return;
      const b = B.of[(d.room.y + (d.room.h >> 1)) * w + d.room.x + (d.room.w >> 1)];
      if (b < 0) return;
      const kind = B.list[b].kind;
      if (kind !== 'house' && kind !== 'villa') return;
      if (!homesIn.has(b)) homesIn.set(b, []);
      homesIn.get(b)!.push(k);
    });
    const shopIn = new Map<number, StreetShop>();
    for (const s of ctx.shops?.shops ?? []) {
      if (s.kind === 'kiosk' || !s.vendorSpot) continue;
      const b = B.of[tileOf(s.vendorSpot.x, s.vendorSpot.y)];
      if (b >= 0) shopIn.set(b, s);
    }
    const ofBuilding = new Map<number, number>();
    const ofRoom = new Map<number, number>();
    const make = (kind: LockKind, homes: number[], shop: StreetShop | null): Lock => {
      const L: Lock = { id: this.list.length, kind, doors: [], homes, shop, open: false, brokenUntil: -1 };
      this.list.push(L);
      return L;
    };
    const indoor = (x: number, y: number) => map.tileAt(x, y) === T.INTERIOR;
    for (const g of doors.groups) {
      const { x0, y0, x1, y1 } = g.bounds;
      // Поперёк двери: горизонтальная (ряд тайлов) — север и юг, вертикальная — запад и восток.
      const across = (dx: number, dy: number, xa: number, ya: number, xb: number, yb: number) => {
        let a = 0;
        let o = 0;
        let n = 0;
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
          n++;
          if (indoor(x + dx, y + dy)) a++;
          else if (openAt(map, x + dx, y + dy)) o++;
        }
        return a * 2 > n ? 'in' : o * 2 > n ? 'out' : null;
      };
      const horiz = x1 > x0 || (y1 === y0 && !map.isSolid(x0, y0 - 1) && !map.isSolid(x0, y0 + 1));
      const [sa, sb] = horiz ? [across(0, -1, x0, y0, x1, y0), across(0, 1, x0, y1, x1, y1)] : [across(-1, 0, x0, y0, x0, y1), across(1, 0, x1, y0, x1, y1)];
      if (!sa || !sb) continue;
      const b = B.of[y0 * w + x0];
      if (b < 0) continue;
      // Куда «внутрь» от центра двери (единичный вектор): в помещение у входной, в комнату у межкомнатной.
      let dir: { x: number; y: number } | null = null;
      let lock: Lock | null = null;
      if (sa !== sb) {
        dir = horiz ? { x: 0, y: sa === 'in' ? -1 : 1 } : { x: sa === 'in' ? -1 : 1, y: 0 };
        const homes = homesIn.get(b);
        const shop = shopIn.get(b);
        if (homes) {
          const id = ofBuilding.get(b);
          lock = id !== undefined ? this.list[id] : make('home', homes, null);
          ofBuilding.set(b, lock.id);
        } else if (shop) {
          const id = ofBuilding.get(b);
          lock = id !== undefined ? this.list[id] : make('shop', [], shop);
          ofBuilding.set(b, lock.id);
        }
      } else if (sa === 'in') {
        // Межкомнатная: в коммуналке (две и больше комнат-жилищ в доме) — дверь комнаты на замке её жильца.
        const homes = homesIn.get(b);
        if (!homes || homes.length < 2) continue;
        const [ax, ay, bx, by] = horiz ? [x0, y0 - 1, x0, y1 + 1] : [x0 - 1, y0, x1 + 1, y0];
        const da = homes.find((k) => inRoom(k, ax, ay));
        const db = homes.find((k) => inRoom(k, bx, by));
        if (da === db || (da !== undefined && db !== undefined)) continue;
        const k = (da ?? db)!;
        dir = horiz ? { x: 0, y: da !== undefined ? -1 : 1 } : { x: da !== undefined ? -1 : 1, y: 0 };
        const id = ofRoom.get(k);
        lock = id !== undefined ? this.list[id] : make('room', [k], null);
        ofRoom.set(k, lock.id);
      }
      if (!lock || !dir) continue;
      lock.doors.push(g);
      g.lock = lock.id;
      g.inside = dir;
    }
    // Ключи жильцов: от дома и от своей комнаты.
    for (const [b, homes] of homesIn) {
      const id = ofBuilding.get(b);
      for (const k of homes) {
        const own: number[] = [];
        if (id !== undefined) own.push(id);
        const r = ofRoom.get(k);
        if (r !== undefined) own.push(r);
        this.ofHome.set(k, own);
      }
    }
    // Якоря: в каком доме (лавке) и в какой комнате под замком.
    this.homeAt = new Int32Array(nav.w * nav.h).fill(-1);
    this.roomAt = new Int32Array(nav.w * nav.h).fill(-1);
    for (let ay = 0; ay < nav.h; ay++) {
      for (let ax = 0; ax < nav.w; ax++) {
        const tx = ax + 1;
        const ty = ay + 1;
        if (tx >= w || ty >= map.height) continue;
        const b = B.of[ty * w + tx];
        if (b < 0) continue;
        const id = ofBuilding.get(b);
        if (id !== undefined) this.homeAt[ay * nav.w + ax] = id;
        const homes = homesIn.get(b);
        if (!homes) continue;
        for (const k of homes) {
          const r = ofRoom.get(k);
          if (r !== undefined && inRoom(k, tx, ty)) this.roomAt[ay * nav.w + ax] = r;
        }
      }
    }
    // Заперто всё, пока первый пересчёт не откроет лавки с продавцом (системы города ещё создаются).
    this.engagedNow = new Uint8Array(this.list.length).fill(1);
    this.acc = LOCKS.interval;
  }

  /** Замки жилища (дом, комната) — ключи его жильцов. */
  keysOfHome(home: number): readonly number[] {
    return this.ofHome.get(home) ?? [];
  }

  /** Заперт ли замок сейчас (пересчёт — раз в LOCKS.interval). */
  engaged(id: number): boolean {
    return this.enabled && this.engagedNow[id] === 1;
  }

  /** Заперт ли замок по правилам — без кэша. */
  private shouldLock(L: Lock): boolean {
    const now = this.ctx.law.now;
    if (L.open || L.brokenUntil > now) return false;
    if (L.kind === 'shop') return !!L.shop && !!this.ctx.shops && !this.ctx.shops.open(L.shop);
    // Хата барыги и общага банды — дверь не запирают: к ним ходят.
    const H = this.ctx.housing;
    return !L.homes.some((h) => H.dwellings[h]?.reserved);
  }

  private refresh(): void {
    for (const L of this.list) this.engagedNow[L.id] = this.shouldLock(L) ? 1 : 0;
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < LOCKS.interval) return;
    this.acc = 0;
    const now = this.ctx.law.now;
    // Выбитые двери жильцы чинят; просроченные пропуска — вон.
    for (const L of this.list) {
      if (L.brokenUntil >= 0 && L.brokenUntil <= now) {
        L.brokenUntil = -1;
        for (const g of L.doors) g.broken = false;
      }
    }
    for (const [c, list] of this.passes) {
      const keep = list.filter((p) => p.until > now);
      if (!keep.length || !c.alive) this.passes.delete(c);
      else if (keep.length !== list.length) this.passes.set(c, keep);
    }
    this.refresh();
  }

  /** Есть ли у c ключ (или право) от замка id: служба, свой дом, лавка, подобранный ключ, пропуск. */
  can(c: Character, id: number): boolean {
    if (!c.alive) return false;
    if (FACTIONS[c.faction].authority || escorted(c)) return true;
    const L = this.list[id];
    if (c.home >= 0 && L.homes.includes(c.home)) return true;
    if (L.shop && (L.shop.vendor === c || L.shop.supplier === c)) return true;
    if (c.keys.includes(id)) return true;
    const ps = this.passes.get(c);
    return !!ps && ps.some((p) => p.lock === id && p.until > this.ctx.law.now);
  }

  /** Пройдёт ли c в дверь g сейчас: замок не заперт, ключ есть или он внутри (изнутри выйти можно всегда). */
  canPass(c: Character, g: DoorGroup): boolean {
    if (g.lock < 0 || !this.engaged(g.lock)) return true;
    if (!c.alive || c.downed) return false;
    if (this.inside(c, g)) return true;
    return this.can(c, g.lock);
  }

  /** c по ту сторону двери, что под замком (в доме, в комнате). */
  inside(c: { x: number; y: number }, g: DoorGroup): boolean {
    const d = g.inside;
    return !!d && (c.x - g.x) * d.x + (c.y - g.y) * d.y > 0;
  }

  /** Пропуск c за замок id на seconds с (гость, открыли на стук, вскрыл). */
  grant(c: Character, id: number, seconds: number): void {
    const until = this.ctx.law.now + seconds;
    const list = this.passes.get(c) ?? [];
    const old = list.find((p) => p.lock === id);
    if (old) old.until = Math.max(old.until, until);
    else list.push({ lock: id, until });
    this.passes.set(c, list);
  }

  /** В гости: host пускает guest в свой дом (и комнату). */
  invite(guest: Character, host: Character, seconds: number = LOCKS.guest): void {
    if (host.home < 0 || guest.home === host.home) return;
    for (const id of this.keysOfHome(host.home)) this.grant(guest, id, seconds);
    this.stats.guests++;
  }

  /**
   * Для поиска пути: якоря за запертыми дверями, куда c не войти (чужой дом, комната, закрытая лавка); изнутри — выйдет
   * (A* выпускает из закрытых якорей). undefined — ничего не закрыто (служба, замки выключены).
   */
  blockerFor(c: Character): ((anchor: number) => boolean) | undefined {
    if (!this.enabled || FACTIONS[c.faction].authority || escorted(c)) return undefined;
    const H = this.homeAt;
    const R = this.roomAt;
    const E = this.engagedNow;
    const mine = new Set<number>([...(c.home >= 0 ? this.keysOfHome(c.home) : []), ...c.keys]);
    const ps = this.passes.get(c);
    if (ps) for (const p of ps) if (p.until > this.ctx.law.now) mine.add(p.lock);
    for (const L of this.list) if (L.shop && (L.shop.vendor === c || L.shop.supplier === c)) mine.add(L.id);
    return (n) => {
      const h = H[n];
      if (h >= 0 && E[h] === 1 && !mine.has(h)) return true;
      const r = R[n];
      return r >= 0 && E[r] === 1 && !mine.has(r);
    };
  }

  /** Замок дома или комнаты, в которой точка мира (для подсказок и «внутри своего»), -1 — нет. */
  lockAt(x: number, y: number): number {
    const nav = this.ctx.nav;
    const a = nav.nearestWalkable(x, y, 1);
    if (a < 0) return -1;
    return this.roomAt[a] >= 0 ? this.roomAt[a] : this.homeAt[a];
  }

  /** Дверь с замком у точки (в пределах LOCKS.reach от края двери) или null. */
  doorNear(x: number, y: number): DoorGroup | null {
    const g = this.ctx.doors.nearest(x, y, LOCKS.reach);
    return g && g.lock >= 0 ? g : null;
  }

  /** Выбить дверь: стоит открытой до ремонта. */
  breakDoor(g: DoorGroup): void {
    if (g.lock < 0) return;
    const L = this.list[g.lock];
    L.brokenUntil = this.ctx.law.now + LOCKS.kick.repair;
    for (const d of L.doors) if (d === g) d.broken = true;
    this.engagedNow[L.id] = 0;
    this.stats.kicked++;
  }

  /** Хозяин отпер или запер свою дверь (игрок). */
  setOpen(id: number, open: boolean): void {
    this.list[id].open = open;
    this.engagedNow[id] = this.shouldLock(this.list[id]) ? 1 : 0;
  }

  /** Кто дома за замком id (живые, по комнатам жилищ замка). */
  occupants(id: number): Character[] {
    const L = this.list[id];
    const H = this.ctx.housing;
    const out: Character[] = [];
    for (const c of this.ctx.entities.list) {
      if (!c.alive || c.isPlayer) continue;
      if (L.homes.some((h) => H.dwellings[h] && H.inside(H.dwellings[h], c))) out.push(c);
    }
    return out;
  }
}
