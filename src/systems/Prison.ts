import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Cell } from './LawSystem';
import type { KppPoint } from './Arsenal';
import type { DoorGroup } from './DoorSystem';
import type { Poi } from '../world/GameMap';
import { isUnderground } from './LawSystem';
import { PRISON } from '../config/prison';
import { WEAPONS, AMMO_ITEM, type WeaponId } from '../config/items';
import { randomAnchorAround } from '../ai/destinations';
import { ArmingBrain } from '../ai/brains/ArmingBrain';
import { T } from '../world/tiles';

/** Пост охраны тюрьмы: точка, куда смотреть и где он (за стойкой приёмной, в блоке камер, во дворе). */
export interface PrisonPost {
  x: number;
  y: number;
  facing: number;
  kind: 'desk' | 'block' | 'yard';
}

/** Помещение тюрьмы (px мира) — для разметки и надписей. */
export type PrisonRoomKind = 'armory' | 'sally' | 'interrogation' | 'reception' | 'evidence' | 'guardroom' | 'office' | 'yard';
export interface PrisonRoom {
  kind: PrisonRoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Стойка оружейной: центр тайла и сторона стены (ствол висит вдоль неё). */
export interface PrisonRack {
  x: number;
  y: number;
  wx: number;
  wy: number;
}

/** Боец армии сопротивления (не подполье): его выручает армия при выходе в город. */
export function isArmy(c: Character): boolean {
  const k = c.role?.kind;
  return c.faction === 'rebel' && (k === 'army' || k === 'leader' || k === 'hydra' || (!k && !isUnderground(c)));
}

/**
 * Тюрьма Протектората — режимный объект: посты охраны (SU.GUARD, роль jailer: дежурный за стойкой приёмной,
 * коридор блока, двор) и их обход, кабинет начальника — третьего инспектора SU.INSP (роль warden),
 * приёмка задержанных у стойки, шлюз между решётками, оружейная со стволами и боекомплектом (пункт
 * боепитания склада — пополняют конвои ВС; охрана берёт патроны здесь, освобождённые из камер —
 * вооружаются), двор-площадка с посадочными маяками. Камеры и заключённые — в LawSystem (Cell.prison),
 * изъятое — LawSystem.evidence. Решает, когда армия при выходе в город идёт не на Управу, а выручать
 * своих (rescue).
 */
export class PrisonSystem {
  readonly present: boolean;
  readonly posts: PrisonPost[] = [];
  /** Место начальника за столом кабинета. */
  readonly desk: Vec2 | null = null;
  /** Центр и прямоугольник здания (px), зона тюрьмы. */
  readonly center: Vec2 | null = null;
  readonly rect: { x: number; y: number; w: number; h: number } | null = null;
  private readonly zone: number = -1;
  readonly rooms: PrisonRoom[] = [];
  /** Оружейная: стойки, стеллажи боекомплекта, запас (пункт боепитания), дверь. */
  readonly racks: PrisonRack[] = [];
  readonly shelves: Vec2[] = [];
  readonly stock: KppPoint;
  /** Место у стоек (сюда же сдают ящики конвои) и перед дверью оружейной снаружи. */
  readonly armorySpot: Vec2 | null = null;
  readonly armoryFront: Vec2 | null = null;
  readonly armoryDoor: DoorGroup | null = null;
  readonly armoryDoorTiles: Vec2[] = [];
  armoryLocked = false;
  armoryBrokenUntil = 0;
  /** Комната изъятого: где забирают своё; стеллажи. */
  readonly evidenceSpot: Vec2 | null = null;
  readonly evidenceShelves: Vec2[] = [];
  /** Приёмная: где стоит задержанный при оформлении, стойка, скамья. */
  readonly intakeSpot: Vec2 | null = null;
  readonly counter: Vec2[] = [];
  readonly benches: Vec2[] = [];
  /** Караулка, допросная, кабинет — мебель по тайлам (центры). */
  readonly cots: Vec2[] = [];
  readonly tables: Vec2[] = [];
  readonly lockers: Vec2[] = [];
  readonly itable: Vec2[] = [];
  readonly deskTiles: Vec2[] = [];
  /** Решётки шлюза (двери) и дверь корпуса (тайлы). */
  readonly sallyDoors: DoorGroup[] = [];
  readonly frontDoor: Vec2[] = [];
  /** Двор-площадка: прямоугольник, центр круга посадки, маяки, мачты, места сброса. */
  readonly padRect: { x: number; y: number; w: number; h: number } | null = null;
  readonly pad: Vec2 | null = null;
  readonly beacons: Vec2[] = [];
  readonly masts: Vec2[] = [];
  readonly drops: Vec2[] = [];
  /** Кого уже оформили в приёмной (снимок, отпечатки, обыск). */
  private readonly processed = new Set<Character>();
  /** Армия идёт на тюрьму (а не на Управу); сколько сидело, когда решили. */
  rescue = false;
  private rescueFrom = 0;
  readonly stats = { rescues: 0, freedByArmy: 0, freedByUnderground: 0, assaults: 0, armed: 0, armoryBroken: 0, intakes: 0, fromEvidence: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const ts = map.tileSize;
    const A = PRISON.armory;
    this.stock = {
      front: -2, name: A.name, x: 0, y: 0, kits: A.kits.start, grenades: A.grenades.start, cap: A.kits.cap, low: A.kits.low,
      grenadesCap: A.grenades.cap, grenadesLow: A.grenades.low, guns: A.guns.start, gunsCap: A.guns.cap, gunsLow: A.guns.low, tainted: 0, convoy: null,
    };
    const p = map.poisOf('prison')[0];
    this.present = !!p && ctx.law.hasPrison;
    if (!p || p.w == null || p.h == null) return;
    this.center = { x: (p.x + p.w / 2) * ts, y: (p.y + p.h / 2) * ts };
    this.rect = { x: p.x * ts, y: p.y * ts, w: p.w * ts, h: p.h * ts };
    this.zone = map.zoneAtTile(p.x, p.y)?.id ?? -1;
    const tile = (q: { x: number; y: number }): Vec2 => ({ x: (q.x + 0.5) * ts, y: (q.y + 0.5) * ts });
    const walk = (q: Vec2, r = 2): Vec2 | null => {
      const a = nav.nearestWalkable(q.x, q.y, r);
      return a >= 0 ? { x: nav.worldX(a), y: nav.worldY(a) } : null;
    };
    const areaOf = (t: Poi['type']): Poi | null => {
      const q = map.poisOf(t)[0];
      return q && q.w != null && q.h != null ? q : null;
    };
    const px = (q: Poi) => ({ x: q.x * ts, y: q.y * ts, w: q.w! * ts, h: q.h! * ts });
    const inArea = (q: Poi | null, x: number, y: number) => !!q && x >= q.x && y >= q.y && x < q.x + q.w! && y < q.y + q.h!;
    const roomsOf: [PrisonRoomKind, Poi['type']][] = [
      ['armory', 'prison_armory'], ['sally', 'prison_sally'], ['interrogation', 'prison_interrogation'], ['reception', 'prison_reception'],
      ['evidence', 'prison_evidence'], ['guardroom', 'prison_guardroom'], ['office', 'prison_office'], ['yard', 'prison_yard'],
    ];
    for (const [kind, t] of roomsOf) {
      const q = areaOf(t);
      if (q) this.rooms.push({ kind, ...px(q) });
    }
    const gate = ctx.law.prisonGate;
    // Центр блока камер — туда смотрят посты коридора; дежурный приёмной — на место задержанного.
    const cells = ctx.law.prisonCells;
    const block = cells.length ? { x: cells.reduce((n, c) => n + c.x, 0) / cells.length, y: cells.reduce((n, c) => n + c.y, 0) / cells.length } : this.center;
    const reception = areaOf('prison_reception');
    const intake = map.poisOf('prison_intake')[0];
    this.intakeSpot = intake ? walk(tile(intake), 2) : null;
    for (const q of map.poisOf('prison_post')) {
      const a = nav.nearestWalkable((q.x + 0.5) * ts, (q.y + 0.5) * ts, 2);
      if (a < 0) continue;
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      const kind: PrisonPost['kind'] = map.tileAt(q.x, q.y) === T.BUNKER ? 'yard' : inArea(reception, q.x, q.y) ? 'desk' : 'block';
      const to = kind === 'yard' && gate ? gate : kind === 'desk' && this.intakeSpot ? this.intakeSpot : block;
      this.posts.push({ x, y, facing: Math.atan2(to.y - y, to.x - x), kind });
    }
    // Охрану ставят по порядку: дежурный приёмной, коридор блока, двор.
    const order = { desk: 0, block: 1, yard: 2 };
    this.posts.sort((a, b) => order[a.kind] - order[b.kind]);
    const d = map.poisOf('prison_desk')[0];
    const office = areaOf('prison_office');
    if (d && office) {
      // Со стороны кабинета, у стола.
      const ox = (office.x + office.w! / 2) * ts;
      const oy = (office.y + office.h! / 2) * ts;
      const dx = (d.x + 0.5) * ts;
      const dy = (d.y + 0.5) * ts;
      const len = Math.hypot(ox - dx, oy - dy) || 1;
      this.desk = walk({ x: dx + ((ox - dx) / len) * 24, y: dy + ((oy - dy) / len) * 24 });
    }
    // Оружейная: стойки у стены (сторона стены — сплошной сосед, не мебель), стеллажи, запас у стоек.
    for (const q of map.poisOf('prison_rack')) {
      let wx = 0;
      let wy = 0;
      for (const [nx, ny] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const t = map.tileAt(q.x + nx, q.y + ny);
        if (map.isSolid(q.x + nx, q.y + ny) && t !== T.BARRIER && t !== T.DOOR) {
          wx = nx;
          wy = ny;
          break;
        }
      }
      this.racks.push({ ...tile(q), wx, wy });
    }
    for (const q of map.poisOf('prison_ammo')) this.shelves.push(tile(q));
    const armory = areaOf('prison_armory');
    if (armory) {
      const c = { x: (armory.x + armory.w! / 2) * ts, y: (armory.y + armory.h! / 2) * ts };
      this.armorySpot = walk(c, 3);
      if (this.armorySpot) {
        this.stock.x = this.armorySpot.x;
        this.stock.y = this.armorySpot.y;
      }
    }
    for (const q of map.poisOf('prison_armory_door')) {
      this.armoryDoorTiles.push(tile(q));
      const g = ctx.doors.groupAtTile(q.x, q.y);
      if (g) this.armoryDoor = g;
    }
    if (this.armoryDoor && armory) {
      // Перед дверью снаружи (в шлюзе): от центра оружейной через дверь.
      const g = this.armoryDoor;
      const cx = (armory.x + armory.w! / 2) * ts;
      const cy = (armory.y + armory.h! / 2) * ts;
      const len = Math.hypot(g.x - cx, g.y - cy) || 1;
      this.armoryFront = walk({ x: g.x + ((g.x - cx) / len) * 26, y: g.y + ((g.y - cy) / len) * 26 }, 2);
      this.armoryLocked = true;
      ctx.doors.setLocked(g, true);
    }
    const evidence = areaOf('prison_evidence');
    if (evidence) this.evidenceSpot = walk({ x: (evidence.x + evidence.w! / 2) * ts, y: (evidence.y + evidence.h! / 2) * ts }, 3);
    for (const q of map.poisOf('prison_shelf')) this.evidenceShelves.push(tile(q));
    for (const q of map.poisOf('prison_counter')) this.counter.push(tile(q));
    for (const q of map.poisOf('prison_bench')) this.benches.push(tile(q));
    for (const q of map.poisOf('prison_cot')) this.cots.push(tile(q));
    for (const q of map.poisOf('prison_table')) this.tables.push(tile(q));
    for (const q of map.poisOf('prison_locker')) this.lockers.push(tile(q));
    for (const q of map.poisOf('prison_itable')) this.itable.push(tile(q));
    for (const q of map.poisOf('prison_desk')) this.deskTiles.push(tile(q));
    // Решётки шлюза — двери во всю ширину коридора у шлюза (сквозь них видно); дверь корпуса — у двора.
    const sally = areaOf('prison_sally');
    const yard = areaOf('prison_yard');
    const near = (q: Poi | null, x: number, y: number) => !!q && x >= q.x - 1 && y >= q.y - 1 && x <= q.x + q.w! && y <= q.y + q.h!;
    for (const g of ctx.doors.groups) {
      const tiles = g.tiles.map((i) => ({ x: i % map.width, y: Math.floor(i / map.width) }));
      if (!tiles.length || map.zoneAtTile(tiles[0].x, tiles[0].y)?.id !== this.zone) continue;
      if (tiles.length >= 4 && tiles.some((t) => near(sally, t.x, t.y))) {
        for (const i of g.tiles) map.grate[i] = 1;
        this.sallyDoors.push(g);
      } else if (tiles.length >= 4 && tiles.some((t) => near(yard, t.x, t.y))) this.frontDoor.push(...tiles.map(tile));
    }
    if (yard) this.padRect = px(yard);
    for (const q of map.poisOf('prison_beacon')) this.beacons.push(tile(q));
    for (const q of map.poisOf('prison_mast')) this.masts.push(tile(q));
    for (const q of map.poisOf('prison_drop')) this.drops.push(tile(q));
    if (this.beacons.length) this.pad = { x: this.beacons.reduce((n, b) => n + b.x, 0) / this.beacons.length, y: this.beacons.reduce((n, b) => n + b.y, 0) / this.beacons.length };
    // Оружейная — пункт боепитания склада: конвои возят сюда патроны, гранаты и стволы.
    if (this.present && this.armorySpot && ctx.arsenal?.present) ctx.arsenal.addPoint(this.stock);
  }

  /** Внутри тюрьмы (зона). */
  inside(x: number, y: number): boolean {
    return this.zone >= 0 && this.ctx.map.zoneAtWorld(x, y)?.id === this.zone;
  }

  /** В оружейной (с запасом на порог). */
  inArmory(x: number, y: number): boolean {
    const r = this.rooms.find((q) => q.kind === 'armory');
    const e = this.ctx.map.tileSize;
    return !!r && x >= r.x - e && y >= r.y - e && x < r.x + r.w + e && y < r.y + r.h + e;
  }

  /** Точка обхода рядом с постом: в тюрьме, не у дверей камер и входа, не в оружейной. */
  sentrySpot(post: Vec2): Vec2 | null {
    const { ctx } = this;
    const S = PRISON.sentry;
    const none = new Set<number>();
    for (let k = 0; k < 12; k++) {
      const a = randomAnchorAround(post, ctx, S.radius[0], S.radius[1], none);
      if (a < 0) continue;
      const x = ctx.nav.worldX(a);
      const y = ctx.nav.worldY(a);
      if (!this.inside(x, y) || ctx.law.inAnyCell(x, y, 4) || this.nearDoor(x, y) || this.inArmory(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  private nearDoor(x: number, y: number): boolean {
    const r = PRISON.sentry.doorClear;
    for (const d of this.ctx.doors.groups) if (Math.hypot(d.x - x, d.y - y) < r) return true;
    return false;
  }

  /** Камера, где сидит подпольщик, которого ещё допрашивают (или null). */
  questionCell(): Cell | null {
    for (const c of this.ctx.law.prisonCells) {
      for (const s of c.slots) if (s.occupant && isUnderground(s.occupant) && !this.ctx.insurgency.brokeUnder(s.occupant)) return c;
    }
    return null;
  }

  /** Сколько армии в тюрьме и на воле. */
  armyCounts(): { jailed: number; free: number } {
    let jailed = 0;
    let free = 0;
    for (const c of this.ctx.entities.list) {
      if (!c.alive || !isArmy(c)) continue;
      const cell = c.law.cell >= 0 ? this.ctx.law.cells[c.law.cell] : null;
      if (c.law.phase === 'jailed' && cell?.prison) jailed++;
      else if (c.law.phase === 'none') free++;
    }
    return { jailed, free };
  }

  /** Занятая камера тюрьмы, ближайшая к точке. */
  occupiedCellNear(x: number, y: number, skip: ReadonlySet<Cell> | null = null): Cell | null {
    let best: Cell | null = null;
    let bestD = Infinity;
    for (const c of this.ctx.law.prisonCells) {
      if (skip?.has(c) || !c.slots.some((s) => s.occupant)) continue;
      const d = Math.hypot(c.frontX - x, c.frontY - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  // ————— Приёмка —————

  /** Задержанного для тюрьмы ещё не оформили (конвоир ведёт сперва к стойке приёмной). */
  needsIntake(c: Character): boolean {
    return this.present && !!this.intakeSpot && !this.processed.has(c);
  }

  /** Оформить у стойки: снимок, отпечатки, обыск — оружие и патроны в комнату изъятого. */
  intake(c: Character, by: Character | null): void {
    if (this.processed.has(c)) return;
    this.processed.add(c);
    this.ctx.law.confiscate(c);
    this.stats.intakes++;
    by?.say(this.ctx.rng.pick(PRISON.lines.intake), this.ctx.law.now, 2.5);
    this.ctx.law.log(`Тюрьма Протектората: ${c.isPlayer ? 'вас оформили' : `${c.name} оформлен`} в приёмной — снимок, отпечатки, обыск; изъятое — в комнату улик.`, 'law');
  }

  /** Оформление больше не нужно помнить (сел, освобождён, погиб). */
  forget(c: Character): void {
    this.processed.delete(c);
  }

  // ————— Оружейная —————

  /** Какой ствол на стойке k (по списку оружейной по кругу). */
  rackWeapon(k: number): WeaponId {
    const W = PRISON.armory.weapons;
    return W[k % W.length];
  }

  /** Охраннику тюрьмы пора за патронами: мало магазинов, в оружейной есть комплект. */
  needsStock(c: Character): boolean {
    if (!this.present || !this.armorySpot || this.stock.kits <= 0) return false;
    const guns = this.ctx.combat.weaponsOf(c).filter((id) => !!WEAPONS[id].ammo && WEAPONS[id].mode !== 'melee');
    return guns.some((id) => c.inventory.count(AMMO_ITEM[WEAPONS[id].ammo!]) < WEAPONS[id].magazine * PRISON.armory.lowMags);
  }

  /** Выбить запертую дверь оружейной: открыта armory.broken с, тревога. */
  breakArmory(by: Character): void {
    const { ctx } = this;
    this.armoryBrokenUntil = ctx.law.now + PRISON.armory.broken;
    this.stats.armoryBroken++;
    this.setArmoryLock(false);
    if (this.armoryDoor) ctx.doors.open(this.armoryDoor);
    ctx.law.log(`Тюрьма Протектората: дверь оружейной выбита${by.isPlayer ? ' — вами' : ''}! Беглые разбирают стволы.`, 'radio');
    const d = this.armoryDoorTiles[0];
    if (d) ctx.war.raiseAlarm(d.x, d.y, 'взлом оружейной тюрьмы', false, { kind: 'prison', suspect: by });
  }

  /**
   * Беглый (или игрок) у стоек: ствол со стойки, магазины (комплект со стеллажа; нет — только полный
   * магазин в стволе), гранаты. Что взял (для журнала) или null — оружейная пуста.
   */
  takeArms(c: Character): string | null {
    const { ctx } = this;
    const S = this.stock;
    const A = PRISON.armory;
    const got: string[] = [];
    let gun: WeaponId | null = null;
    if (S.guns > 0) {
      const id = this.rackWeapon(S.guns - 1);
      if (c.inventory.add(id, 1) > 0) {
        S.guns--;
        gun = id;
        got.push(WEAPONS[id].name);
      }
    }
    if (S.kits > 0 && ctx.combat.weaponsOf(c).some((id) => !!WEAPONS[id].ammo)) {
      if (ctx.economy.refillAmmo(c, A.take.mags) > 0) {
        S.kits--;
        got.push('магазины');
      }
    } else if (gun) {
      // Без комплекта — только то, что в стволе.
      c.mags[gun] = WEAPONS[gun].magazine;
    }
    const n = Math.min(A.take.grenades, S.grenades);
    if (n > 0 && c.inventory.add('grenade', n) > 0) {
      S.grenades -= n;
      got.push(n > 1 ? `гранаты ×${n}` : 'граната');
    }
    if (!got.length) return null;
    const best = ctx.combat.bestWeapon(c, 200);
    if (best) ctx.combat.equip(c, best);
    this.stats.armed++;
    return got.join(', ');
  }

  /** Забрать своё из комнаты изъятого (стоит рядом). true — было что забрать. */
  takeEvidence(c: Character): boolean {
    if (!this.ctx.law.evidence.has(c)) return false;
    this.ctx.law.returnEvidence(c, true);
    this.stats.fromEvidence++;
    const best = this.ctx.combat.bestWeapon(c, 200);
    if (best) this.ctx.combat.equip(c, best);
    return true;
  }

  /** Освобождённого — в оружейную (и за изъятым): временный мозг, потом then (куда ему дальше). */
  startArming(c: Character, then: () => void): boolean {
    if (!this.present || c.isPlayer) return false;
    const armory = this.stock.guns > 0 && !!this.armorySpot;
    const own = this.ctx.law.evidence.has(c) && !!this.evidenceSpot;
    if (!armory && !own) return false;
    c.brain = new ArmingBrain(this.ctx, c.brain, then);
    return true;
  }

  /**
   * Дверь оружейной: отперта, пока рядом сотрудник Протектората, внутри кто-то есть, охранник идёт за
   * патронами, конвой склада везёт сюда груз — или она выбита.
   */
  private updateArmoryDoor(): void {
    if (!this.armoryDoor) return;
    const { ctx } = this;
    const d = this.armoryDoor;
    let open = this.armoryBrokenUntil > ctx.law.now;
    // Конвой склада везёт груз — оружейная открыта для приёмки (путь к стеллажам строится заранее).
    if (this.stock.convoy) open = true;
    if (!open) {
      for (const o of ctx.entities.list) {
        const b = o.brain as { resupplyPoint?: unknown; fsm?: { current: string } } | null;
        if (o.fit && o.faction === 'cp' && b?.resupplyPoint === this.stock && b.fsm?.current === 'resupply') {
          open = true;
          break;
        }
      }
    }
    if (!open) {
      for (const o of ctx.entities.near(d.x, d.y, PRISON.armory.reach * 3, nearBuf)) {
        if (!o.alive) continue;
        if (this.inArmory(o.x, o.y)) {
          open = true;
          break;
        }
        if ((o.faction === 'cp' || o.faction === 'ota') && o.law.phase === 'none' && o.fit && Math.hypot(o.x - d.x, o.y - d.y) < PRISON.armory.reach) {
          open = true;
          break;
        }
      }
    }
    this.setArmoryLock(!open);
  }

  private setArmoryLock(locked: boolean): void {
    if (!this.armoryDoor || locked === this.armoryLocked) return;
    this.armoryLocked = locked;
    this.ctx.doors.setLocked(this.armoryDoor, locked);
  }

  update(): void {
    if (!this.present) return;
    this.updateArmoryDoor();
    for (const c of this.processed) if (!c.alive || c.law.phase === 'none' || c.law.phase === 'jailed') this.processed.delete(c);
    const war = this.ctx.war;
    const R = PRISON.rescue;
    if (!war.cityPush) {
      this.rescue = false;
      return;
    }
    const { jailed, free } = this.armyCounts();
    if (!this.rescue) {
      if (jailed >= R.min && free < jailed * R.ratio) {
        this.rescue = true;
        this.rescueFrom = jailed;
        this.stats.rescues++;
        this.ctx.law.log(`Надзор: повстанцы идут на тюрьму Протектората — выручать своих (${jailed} в камерах)! Охране — к бою!`, 'radio');
        this.ctx.bus.emit('announce', { text: 'Повстанцы штурмуют тюрьму' });
      }
    } else if (jailed < R.min || jailed <= this.rescueFrom * (1 - R.freed)) {
      this.rescue = false;
      this.ctx.law.log(`Сопротивление: из тюрьмы вызволили своих — теперь на Управу!`, 'world');
    }
  }
}

const nearBuf: Character[] = [];
