import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import { ARSENAL, type CrateKind } from '../config/arsenal';
import { KITS, ITEMS, WEAPONS, AMMO_ITEM, type WeaponId } from '../config/items';
import { T } from '../world/tiles';
import { cpKit } from './Population';
import { adjustLoyalty } from './Loyalty';
import { LOYALTY } from '../config/loyalty';
import { canSeeCircle, lineOfSight } from '../world/visibility';
import { FACTIONS, isCpUnit } from '../config/factions';
import { GRENADE } from '../config/combat';
import { CpBrain } from '../ai/brains/CpBrain';
import type { DoorGroup } from './DoorSystem';

/** Груз: ящик (патроны, гранаты, стволы в консервации) или один ствол (gun: исправный или на ремонт). */
/** Помещение склада (для разметки). */
export type ArsenalRoom = 'hall' | 'vault' | 'workshop' | 'issue' | 'office' | 'breakroom' | 'guardroom' | 'pad';

export type LoadKind = CrateKind | 'gun';

export interface Crate {
  id: number;
  kind: LoadKind;
  /** Сколько внутри: комплектов патронов, гранат, стволов (у ствола — 1). */
  left: number;
  /** Порченые патроны (диверсия). */
  tainted: boolean;
  /** Ствол ещё в консервации (у оружейника до верстака). */
  broken: boolean;
  /** Проверен оружейником (выборочно). */
  checked: boolean;
  /** Ящик конвоя, брошенный по дороге (его донесут на пункт первым делом). */
  convoy?: Convoy | null;
  x: number;
  y: number;
}

/** Где лежит груз: зал (патроны), отсек (гранаты), стойка (ствол), расходный стеллаж, ящик на ремонт. */
export type SlotArea = 'hall' | 'vault' | 'rack' | 'shelf' | 'repair';

/** Ячейка хранения: где нарисована (x, y — центр тайла), откуда до неё дотягиваются (ax, ay), что в ней. */
export interface Slot {
  area: SlotArea;
  x: number;
  y: number;
  ax: number;
  ay: number;
  crate: Crate | null;
  /** Кто уже идёт сюда положить или забрать. */
  reserved: Character | null;
  /** В какую сторону от ячейки стена (для стоек у стены; 0,0 — стены рядом нет). */
  wx: number;
  wy: number;
}

/** Пункт боепитания КПП (в проходной): комплекты патронов и гранаты для гарнизона. */
export interface KppPoint {
  front: number;
  x: number;
  y: number;
  kits: number;
  grenades: number;
  /** Сколько комплектов из порченых ящиков. */
  tainted: number;
  /** Идёт ли туда конвой. */
  convoy: Convoy | null;
}

/** Конвой: сколько ящиков ещё назначить грузчикам и кто сопровождает. */
export interface Convoy {
  point: KppPoint;
  ammo: number;
  grenades: number;
  /** В пути (назначено, ещё не донесли). */
  carrying: number;
  escort: Character | null;
  until: number;
}

/** Работа грузчика. */
export type HaulTask =
  | { type: 'beacon' }
  | { type: 'store'; crate: Crate; to: Slot }
  | { type: 'restock'; from: Slot; to: Slot }
  | { type: 'convoy'; from: Slot | null; crate: Crate | null; convoy: Convoy; kind: CrateKind };

/** Работа оружейника: расконсервация ствола (ящик → верстак → стойка) или проверка ящика патронов. */
export type ArmorerTask = { type: 'repair'; from: Slot; to: Slot } | { type: 'check'; slot: Slot };

export interface Stock {
  /** Ящики патронов и гранат, исправные стволы, стволы в консервации. */
  ammo: number;
  grenades: number;
  weapons: number;
  parts: number;
}

/** Диверсия подполья на складе: кража ящика, брак в патроны, заряд у двери зала, порча маяка. */
export type DepotAct = 'steal' | 'taint' | 'bomb' | 'beacon';

const near: Character[] = [];
const AREA_OF: Record<CrateKind, SlotArea> = { ammo: 'hall', grenades: 'vault', weapons: 'repair' };

/**
 * Склад Альянса на окраине (config/arsenal.ts). Всё по ячейкам: что видно на стеллажах — то и лежит.
 *  Цитадель → борт на крыльцо (ящики на места сброса, кладовщик на приёмке) → грузчики ГСР разносят:
 *  патроны на стеллажи зала, гранаты в запертый отсек, стволы в консервации — в ящики мастерской;
 *  оружейник расконсервирует ствол за верстаком и вешает на стойку зала; грузчики держат полным
 *  расходный стеллаж у окна; кладовщик SU.QM выдаёт у окна (табельное, боекомплект, гранаты).
 *  Пункт боепитания в проходной КПП пустеет — конвой: грузчики несут туда ящики из зала, охранник
 *  склада сопровождает; гарнизон КПП пополняется у пункта. ГО города после возрождения — с одним
 *  пистолетом, сначала за табельным. Опись и инспекция; диверсии подполья.
 */
export class ArsenalSystem {
  readonly present: boolean;
  readonly rect: { x: number; y: number; w: number; h: number } | null = null;
  /** Крыльцо (посадочная площадка): центр и прямоугольник. */
  readonly pad: Vec2 | null = null;
  readonly padRect: { x: number; y: number; w: number; h: number } | null = null;
  readonly hall: Vec2 | null = null;
  readonly desk: Vec2 | null = null;
  /** Где стоит кладовщик (у стола) и где ГО у окна; тайлы окна. */
  readonly deskSpot: Vec2 | null = null;
  readonly window: Vec2 | null = null;
  readonly windowTiles: Vec2[] = [];
  readonly ledgerDesk: Vec2 | null = null;
  readonly ledgerSpot: Vec2 | null = null;
  readonly beacon: Vec2 | null = null;
  readonly bench: Vec2 | null = null;
  readonly benchSpot: Vec2 | null = null;
  readonly benchTiles: Vec2[] = [];
  readonly drops: Vec2[] = [];
  readonly posts: { x: number; y: number; facing: number }[] = [];
  readonly masts: Vec2[] = [];
  readonly cots: Vec2[] = [];
  /** Помещения (px мира) — для разметки пола и надписей. */
  readonly rooms: { kind: ArsenalRoom; x: number; y: number; w: number; h: number }[] = [];
  readonly tables: Vec2[] = [];
  /** Где ставят заряд: у двери зала изнутри. Где кладовщик принимает груз на крыльце. */
  readonly bombSpot: Vec2 | null = null;
  readonly receiveSpot: Vec2 | null = null;
  /** Где грузчики ждут борт (на крыльце у двери) и отдыхают (бытовка). */
  readonly waitSpot: Vec2 | null = null;
  readonly restSpots: Vec2[] = [];
  /** Проём в ограде крыльца (единственный въезд): центр и направление наружу. */
  readonly gate: Vec2 | null = null;
  readonly gateDir: Vec2 = { x: 0, y: 1 };
  /** Дверь гранатного отсека (группа дверей) и тайлы двери. */
  private vaultDoor: DoorGroup | null = null;
  readonly vaultDoorTiles: Vec2[] = [];
  /** Ячейки хранения. */
  readonly slots: Slot[] = [];
  /** Ящики на земле (крыльцо после сброса, брошенные в пути). */
  readonly crates: Crate[] = [];
  private readonly carried = new Map<Character, Crate>();
  /** Пункты боепитания КПП и конвои к ним. */
  readonly points: KppPoint[] = [];
  readonly convoys: Convoy[] = [];
  readonly ledger: Stock = { ammo: 0, grenades: 0, weapons: 0, parts: 0 };
  /** Верстак: ствол на нём и сколько уже сделано (для отрисовки). */
  workbench: { gun: boolean; progress: number } = { gun: false, progress: 0 };
  readonly ship = { phase: 'none' as 'none' | 'arrive' | 'hover' | 'leave', t: 0, aborted: false, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
  nextFlight: number = ARSENAL.flight.first;
  private requested = false;
  /** Кладовщик на приёмке груза (до). */
  receiving = false;
  private receiveUntil = 0;
  beaconBroken = false;
  beaconProgress = 0;
  private beaconBy: Character | null = null;
  lockdownUntil = 0;
  bomb: { x: number; y: number; at: number; by: Character } | null = null;
  private bombScan = 0;
  lastInspection = -1e9;
  private inspecting = 0;
  private inspectScan = 0;
  private dispatchT = 0;
  /** Смена: какая патрульная группа вызвана на склад (до), когда следующая, чья очередь. */
  readonly shift = { squad: -1, until: 0, next: ARSENAL.shift.first as number, turn: 0 };
  private readonly shiftServed = new Set<Character>();
  private vaultUsers = new Set<Character>();
  private vaultLocked = true;
  private qm: Character | null = null;
  private nextId = 1;
  private time = 0;
  private redLogged = false;
  readonly stats = {
    flights: 0, aborted: 0, delivered: 0, stored: 0, restocked: 0, convoys: 0, convoyCrates: 0, pointDraws: 0, pointEmpty: 0,
    issued: 0, drawn: 0, repaired: 0, checked: 0, caught: 0, stolen: 0, tainted: 0, jams: 0, bombs: 0, defused: 0,
    shortages: 0, inspections: 0, requisitions: 0, requests: 0, repairedBeacon: 0, shifts: 0, shiftChecks: 0,
  };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const ts = map.tileSize;
    const a = map.poisOf('arsenal')[0];
    this.present = !!a;
    if (!a) return;
    const at = (p: { x: number; y: number }): Vec2 => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts });
    const walk = (p: Vec2 | null, r = 3): Vec2 | null => {
      if (!p) return null;
      const k = nav.nearestWalkable(p.x, p.y, r);
      return k >= 0 ? { x: nav.worldX(k), y: nav.worldY(k) } : p;
    };
    const area = (t: 'arsenal_pad' | 'arsenal_hall') => {
      const p = map.poisOf(t)[0];
      return p ? { x: (p.x + (p.w ?? 1) / 2) * ts, y: (p.y + (p.h ?? 1) / 2) * ts } : null;
    };
    const one = (t: 'arsenal_desk' | 'arsenal_ledger' | 'arsenal_beacon') => {
      const ps = map.poisOf(t);
      if (!ps.length) return null;
      // Стол из нескольких тайлов — середина.
      const x = ps.reduce((s, p) => s + p.x, 0) / ps.length;
      const y = ps.reduce((s, p) => s + p.y, 0) / ps.length;
      return { x: (x + 0.5) * ts, y: (y + 0.5) * ts };
    };
    this.rect = { x: a.x * ts, y: a.y * ts, w: (a.w ?? 1) * ts, h: (a.h ?? 1) * ts };
    this.pad = area('arsenal_pad');
    const pr = map.poisOf('arsenal_pad')[0];
    this.padRect = pr ? { x: pr.x * ts, y: pr.y * ts, w: (pr.w ?? 1) * ts, h: (pr.h ?? 1) * ts } : null;
    this.hall = area('arsenal_hall');
    const ROOMS: [Parameters<typeof map.poisOf>[0], ArsenalRoom][] = [
      ['arsenal_hall', 'hall'], ['arsenal_vault_room', 'vault'], ['arsenal_workshop', 'workshop'], ['arsenal_issue_room', 'issue'],
      ['arsenal_office', 'office'], ['arsenal_breakroom', 'breakroom'], ['arsenal_guardroom', 'guardroom'], ['arsenal_pad', 'pad'],
    ];
    for (const [t, kind] of ROOMS) {
      for (const p of map.poisOf(t)) this.rooms.push({ kind, x: p.x * ts, y: p.y * ts, w: (p.w ?? 1) * ts, h: (p.h ?? 1) * ts });
    }
    this.desk = one('arsenal_desk');
    this.ledgerDesk = one('arsenal_ledger');
    this.beacon = one('arsenal_beacon');
    for (const p of map.poisOf('arsenal_bench')) this.benchTiles.push(at(p));
    this.bench = this.benchTiles.length ? { x: this.benchTiles.reduce((s, p) => s + p.x, 0) / this.benchTiles.length, y: this.benchTiles[0].y } : null;
    for (const p of map.poisOf('arsenal_drop')) this.drops.push(at(p));
    for (const p of map.poisOf('arsenal_mast')) this.masts.push(at(p));
    for (const p of map.poisOf('arsenal_cot')) this.cots.push(at(p));
    for (const p of map.poisOf('arsenal_table')) this.tables.push(at(p));
    const inRect = (px: number, py: number, r: { x: number; y: number; w?: number; h?: number } | undefined) =>
      !!r && px >= r.x && py >= r.y && px < r.x + (r.w ?? 1) && py < r.y + (r.h ?? 1);
    // Сторона, куда смотрит вход: крыльцо по отношению к зданию.
    const cx = this.rect.x + this.rect.w / 2;
    const cy = this.rect.y + this.rect.h / 2;
    const out = this.pad ? { x: Math.sign(Math.round(this.pad.x - cx)), y: Math.sign(Math.round(this.pad.y - cy)) } : { x: 0, y: 1 };
    this.gateDir = Math.abs(this.pad ? this.pad.y - cy : 1) >= Math.abs(this.pad ? this.pad.x - cx : 0) ? { x: 0, y: out.y || 1 } : { x: out.x || 1, y: 0 };
    for (const p of map.poisOf('arsenal_post')) {
      const q = at(p);
      const f = Math.atan2(q.y - cy, q.x - cx);
      // Посты смотрят наружу — к проёму крыльца и к двери.
      this.posts.push({ ...q, facing: Math.abs(Math.cos(f)) > 0.9 || Math.abs(Math.sin(f)) > 0.9 ? f : Math.atan2(this.gateDir.y, this.gateDir.x) });
    }
    // Ячейки: у каждой — место, откуда до неё дотягиваются (ближайший свободный соседний тайл).
    const access = (tx: number, ty: number): Vec2 => {
      let best: Vec2 | null = null;
      let bestD = Infinity;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (map.isSolid(tx + dx, ty + dy)) continue;
        const k = nav.nearestWalkable((tx + dx + 0.5) * ts, (ty + dy + 0.5) * ts, 1);
        if (k < 0) continue;
        const q = { x: nav.worldX(k), y: nav.worldY(k) };
        const d = Math.hypot(q.x - (tx + 0.5) * ts, q.y - (ty + 0.5) * ts);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
      return best ?? walk(at({ x: tx, y: ty }), 3)!;
    };
    const addSlots = (t: 'arsenal_ammo' | 'arsenal_grenades' | 'arsenal_rack' | 'arsenal_issue' | 'arsenal_repair', areaName: SlotArea) => {
      for (const p of map.poisOf(t)) {
        const c = at(p);
        const ac = access(p.x, p.y);
        let wx = 0;
        let wy = 0;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const tt = map.tileAt(p.x + dx, p.y + dy);
          if (tt === T.METAL || tt === T.WALL) {
            wx = dx;
            wy = dy;
            break;
          }
        }
        this.slots.push({ area: areaName, x: c.x, y: c.y, ax: ac.x, ay: ac.y, crate: null, reserved: null, wx, wy });
      }
    };
    addSlots('arsenal_ammo', 'hall');
    addSlots('arsenal_grenades', 'vault');
    addSlots('arsenal_rack', 'rack');
    addSlots('arsenal_issue', 'shelf');
    addSlots('arsenal_repair', 'repair');
    // Окно выдачи: место ГО — в коридоре перед окном (с той стороны, что дальше от стола кладовщика).
    let fx = 0;
    let fy = 0;
    let n = 0;
    for (const p of map.poisOf('arsenal_window')) {
      this.windowTiles.push(at(p));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (map.isSolid(p.x + dx, p.y + dy)) continue;
        const q = at({ x: p.x + dx, y: p.y + dy });
        const d = this.desk ? Math.hypot(q.x - this.desk.x, q.y - this.desk.y) : 0;
        if (d > ts * 1.5) {
          fx += q.x;
          fy += q.y;
          n++;
        }
      }
    }
    this.window = n ? walk({ x: fx / n, y: fy / n }, 2) : null;
    // Кладовщик — за столом, с той стороны, что от окна.
    if (this.desk && this.window) {
      const d = Math.hypot(this.desk.x - this.window.x, this.desk.y - this.window.y) || 1;
      this.deskSpot = walk({ x: this.desk.x + ((this.desk.x - this.window.x) / d) * ts * 1.2, y: this.desk.y + ((this.desk.y - this.window.y) / d) * ts * 1.2 }, 2);
    }
    this.ledgerSpot = this.ledgerDesk ? walk({ x: this.ledgerDesk.x, y: this.ledgerDesk.y + ts * 1.5 }, 3) : null;
    this.benchSpot = this.bench ? walk({ x: this.bench.x, y: this.bench.y + ts * 1.5 }, 2) : null;
    // Дверь зала: тайлы двери, у которых с одной стороны зал; заряд — со стороны зала.
    const hr = map.poisOf('arsenal_hall')[0];
    let bx = 0;
    let by = 0;
    let bn = 0;
    for (let y = a.y; y < a.y + (a.h ?? 1); y++) {
      for (let x = a.x; x < a.x + (a.w ?? 1); x++) {
        if (map.tileAt(x, y) !== T.DOOR) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!inRect(x + dx, y + dy, hr)) continue;
          bx += (x + dx * 2 + 0.5) * ts;
          by += (y + dy * 2 + 0.5) * ts;
          bn++;
        }
      }
    }
    this.bombSpot = bn ? walk({ x: bx / bn, y: by / bn }, 2) : this.hall;
    // Крыльцо: приёмка — посередине ближе к двери, ожидание грузчиков — у двери, проём — дальний край.
    if (this.padRect && this.pad) {
      const P = this.padRect;
      const d = this.gateDir;
      const edge = (k: number) => ({ x: this.pad!.x - d.x * (P.w / 2) * k, y: this.pad!.y - d.y * (P.h / 2) * k });
      this.receiveSpot = walk(edge(0.35), 3);
      this.waitSpot = walk(edge(0.8), 3);
      this.gate = { x: this.pad.x + d.x * (P.w / 2), y: this.pad.y + d.y * (P.h / 2) };
    }
    // Бытовка: места вокруг стола.
    const br = map.poisOf('arsenal_breakroom')[0];
    if (br) {
      for (let y = br.y; y < br.y + (br.h ?? 1); y++) {
        for (let x = br.x; x < br.x + (br.w ?? 1); x++) {
          if (map.isSolid(x, y)) continue;
          const nextToTable = this.tables.some((t) => Math.hypot(t.x - (x + 0.5) * ts, t.y - (y + 0.5) * ts) < ts * 1.6);
          if (!nextToTable) continue;
          const q = walk(at({ x, y }), 1);
          if (q && !this.restSpots.some((s) => Math.hypot(s.x - q.x, s.y - q.y) < ts * 1.5)) this.restSpots.push(q);
        }
      }
    }
    if (!this.restSpots.length && this.waitSpot) this.restSpots.push(this.waitSpot);
    // Гранатный отсек заперт; отпирается, пока туда идут по делу.
    for (const p of map.poisOf('arsenal_vault')) {
      this.vaultDoorTiles.push(at(p));
      const g = ctx.doors.groupAtTile(p.x, p.y);
      if (g) {
        this.vaultDoor = g;
        ctx.doors.setLocked(g, true);
      }
    }
    this.buildPoints();
    this.fillStart();
  }

  // ————— Начальное состояние —————

  private newCrate(kind: LoadKind, x: number, y: number): Crate {
    const left = kind === 'gun' ? 1 : ARSENAL.perCrate[kind];
    return { id: this.nextId++, kind, left, tainted: false, broken: false, checked: false, x, y };
  }

  /** В начале: зал, отсек, стойки заполнены на долю start, расходный стеллаж полон, ящик стволов на ремонт. */
  private fillStart(): void {
    const S = ARSENAL.start;
    const fill = (area: SlotArea, share: number, kind: LoadKind) => {
      const list = this.slots.filter((s) => s.area === area);
      const n = Math.round(list.length * share);
      for (const s of list.slice(0, n)) s.crate = this.newCrate(kind, s.x, s.y);
    };
    fill('hall', S.hall, 'ammo');
    fill('vault', S.vault, 'grenades');
    fill('rack', S.racks, 'gun');
    const repair = this.slots.filter((s) => s.area === 'repair');
    for (const s of repair.slice(0, S.repair)) s.crate = this.newCrate('weapons', s.x, s.y);
    const shelf = this.slots.filter((s) => s.area === 'shelf');
    const want: LoadKind[] = [...Array(ARSENAL.shelf.ammo).fill('ammo'), ...Array(ARSENAL.shelf.grenades).fill('grenades'), ...Array(ARSENAL.shelf.guns).fill('gun')];
    shelf.forEach((s, k) => {
      if (want[k]) s.crate = this.newCrate(want[k], s.x, s.y);
    });
    Object.assign(this.ledger, this.stock);
  }

  /** Пункты боепитания: в проходной каждого КПП — в нише у стены, не на проходе. */
  private buildPoints(): void {
    const { ctx } = this;
    const { nav, map } = ctx;
    for (const f of ctx.war.fronts) {
      if (f.gatehouse < 0) continue;
      let best = -1;
      let bestScore = -Infinity;
      let cx = 0;
      let cy = 0;
      let n = 0;
      for (const k of nav.walkable) {
        if (nav.zone[k] !== f.gatehouse) continue;
        cx += nav.worldX(k);
        cy += nav.worldY(k);
        n++;
      }
      if (!n) continue;
      cx /= n;
      cy /= n;
      for (const k of nav.walkable) {
        if (nav.zone[k] !== f.gatehouse) continue;
        const x = nav.worldX(k);
        const y = nav.worldY(k);
        const tx = Math.floor(x / map.tileSize);
        const ty = Math.floor(y / map.tileSize);
        let walls = 0;
        for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) if (map.isSolid(tx + dx, ty + dy)) walls++;
        const score = walls * 40 - Math.hypot(x - cx, y - cy);
        if (score > bestScore) {
          bestScore = score;
          best = k;
        }
      }
      if (best < 0) continue;
      const K = ARSENAL.kpp;
      this.points.push({ front: f.index, x: nav.worldX(best), y: nav.worldY(best), kits: K.start, grenades: K.grenadesStart, tainted: 0, convoy: null });
    }
  }

  // ————— Сводки —————

  get now(): number {
    return this.time;
  }

  /** Всё, что на складе (в ячейках, на крыльце, в руках на территории): ящики, стволы, стволы на ремонт. */
  get stock(): Stock {
    const s: Stock = { ammo: 0, grenades: 0, weapons: 0, parts: 0 };
    const add = (c: Crate) => {
      if (c.left <= 0) return;
      if (c.kind === 'ammo') s.ammo++;
      else if (c.kind === 'grenades') s.grenades++;
      else if (c.kind === 'weapons') s.parts += c.left;
      else if (c.broken) s.parts++;
      else s.weapons++;
    };
    for (const sl of this.slots) if (sl.crate) add(sl.crate);
    for (const c of this.crates) if (this.inside(c.x, c.y) || c.convoy) add(c);
    // В руках у грузчиков и оружейника — тоже склад (конвой — пока не сдан на пункт).
    for (const c of this.carried.values()) add(c);
    return s;
  }

  /** Сколько ячеек занято в области (и всего). */
  fill(area: SlotArea): { used: number; total: number } {
    let used = 0;
    let total = 0;
    for (const s of this.slots) {
      if (s.area !== area) continue;
      total++;
      if (s.crate) used++;
    }
    return { used, total };
  }

  inside(x: number, y: number): boolean {
    const r = this.rect;
    return !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  onPad(x: number, y: number): boolean {
    const r = this.padRect;
    return !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  /** Кладовщик за столом (или игрок-кладовщик у стола). */
  get quartermaster(): Character | null {
    if (!this.desk) return null;
    for (const o of this.ctx.entities.near(this.desk.x, this.desk.y, ARSENAL.issue.deskReach + 12, near)) {
      if (o.fit && isQuartermaster(o)) return o;
    }
    return null;
  }

  get closed(): boolean {
    return this.time < this.lockdownUntil;
  }

  /** Сколько осталось до рейса (для HUD). */
  get flightIn(): number {
    return this.ship.phase === 'none' ? Math.max(0, this.nextFlight - this.time) : 0;
  }

  shipView(): { x: number; y: number; k: number; phase: string } | null {
    const s = this.ship;
    const F = ARSENAL.flight;
    if (s.phase === 'none' || !this.pad) return null;
    const p = this.pad;
    if (s.phase === 'arrive') {
      const k = Math.min(1, s.t / F.arrive);
      const e = 1 - (1 - k) * (1 - k);
      return { x: s.from.x + (p.x - s.from.x) * e, y: s.from.y + (p.y - s.from.y) * e, k: 1 - e * 0.4, phase: s.phase };
    }
    if (s.phase === 'hover') return { x: p.x, y: p.y + Math.sin(s.t * 2) * 3, k: 0.6, phase: s.phase };
    const k = Math.min(1, s.t / F.leave);
    const e = k * k;
    return { x: p.x + (s.to.x - p.x) * e, y: p.y + (s.to.y - p.y) * e, k: 0.6 + e * 0.4, phase: s.phase };
  }

  /** Борт летит или висит над крыльцом. */
  get shipInbound(): boolean {
    return this.ship.phase === 'arrive' || this.ship.phase === 'hover';
  }

  pointOf(front: number): KppPoint | null {
    return this.points.find((p) => p.front === front) ?? null;
  }

  // ————— Такт —————

  update(dt: number): void {
    if (!this.present) return;
    this.time += dt;
    this.updateFlight(dt);
    // Брошенный груз (погиб, упал, работа сорвана): ящик остаётся на земле.
    for (const c of [...this.carried.keys()]) if (!c.carrying || !this.working(c)) this.drop(c);
    this.updateQm();
    this.updateVault(true);
    this.dispatchT -= dt;
    if (this.dispatchT <= 0) {
      this.dispatchT = ARSENAL.convoy.dispatchEvery;
      this.dispatchConvoys();
      this.requestFlight();
    }
    this.updateShift();
    this.updateBomb(dt);
    this.updateInspection(dt);
  }

  /**
   * Смена: раз в shift.every с очередная патрульная группа (ведущий и ведомые) идёт на склад — сдать
   * смену, пополнить боекомплект, расписаться в описи; при тревоге — не до того.
   */
  private updateShift(): void {
    if (this.time < this.shift.next) return;
    this.shift.next = this.time + ARSENAL.shift.every;
    if (this.ctx.war.code !== 'green') return;
    const squads = new Set<number>();
    for (const c of this.ctx.entities.list) {
      const b = c.brain;
      if (c.fit && b instanceof CpBrain && b.duty === 'squad' && b.lead) squads.add(b.squad);
    }
    const list = [...squads].sort((a, b) => a - b);
    if (!list.length) return;
    const sq = list[this.shift.turn++ % list.length];
    this.shift.squad = sq;
    this.shift.until = this.time + ARSENAL.shift.window;
    this.shiftServed.clear();
    this.stats.shifts++;
    this.ctx.law.log(`Склад Альянса: патрульная группа ${sq + 1} — на склад, сдать смену и пополнить боекомплект.`, 'radio');
  }

  /** Вызвана ли группа бойца на склад (смена) и он ещё не отметился у окна. */
  shiftCalled(c: Character): boolean {
    const b = c.brain;
    return this.time < this.shift.until && b instanceof CpBrain && b.duty === 'squad' && b.squad === this.shift.squad && !this.shiftServed.has(c);
  }

  private updateFlight(dt: number): void {
    const { ctx } = this;
    const F = ARSENAL.flight;
    const s = this.ship;
    if (s.phase === 'none' && this.time >= this.nextFlight) {
      if (ctx.war.code === 'red') {
        this.nextFlight = this.time + 20;
        if (!this.redLogged) ctx.law.log('Склад Альянса: красный код — рейсы из Цитадели отменены.', 'radio');
        this.redLogged = true;
      } else {
        this.redLogged = false;
        this.startFlight();
      }
    }
    if (s.phase === 'none') return;
    s.t += dt;
    if (s.phase === 'arrive' && s.t >= F.arrive) {
      s.t = 0;
      if (this.beaconBroken) {
        s.aborted = true;
        s.phase = 'leave';
        this.stats.aborted++;
        ctx.law.log('Склад Альянса: маяк крыльца не отвечает — борт ушёл без разгрузки. Рейс сорван.', 'radio');
        if (this.pad) ctx.war.raiseAlarm(this.pad.x, this.pad.y, 'срыв поставки на склад', false);
      } else {
        s.phase = 'hover';
        this.dropContainer();
      }
    } else if (s.phase === 'hover' && s.t >= F.hover) {
      s.t = 0;
      s.phase = 'leave';
    } else if (s.phase === 'leave' && s.t >= F.leave) {
      s.phase = 'none';
      s.t = 0;
      this.nextFlight = this.time + F.every;
      this.requested = false;
    }
  }

  private startFlight(): void {
    const { ctx } = this;
    const p = this.pad!;
    const s = this.ship;
    // Прилетает со стороны Цитадели (Нексуса), уходит дальше.
    const nx = ctx.map.poisOf('nexus_gate')[0];
    const ts = ctx.map.tileSize;
    const dir = nx ? Math.atan2((nx.y + 0.5) * ts - p.y, (nx.x + 0.5) * ts - p.x) : -Math.PI / 2;
    const R = 900;
    s.from = { x: p.x + Math.cos(dir) * R, y: p.y + Math.sin(dir) * R };
    s.to = { x: p.x - Math.cos(dir + 0.6) * R, y: p.y - Math.sin(dir + 0.6) * R };
    s.phase = 'arrive';
    s.t = 0;
    s.aborted = false;
    this.stats.flights++;
    ctx.law.log(`Склад Альянса: ${ctx.rng.pick(ARSENAL.lines.dropship)}`, 'radio');
  }

  /** Заявка в Цитадель: ячеек занято меньше reorder — борт через lead с (если раньше не летит). */
  private requestFlight(): void {
    if (this.requested || this.ship.phase !== 'none') return;
    const R = ARSENAL.reorder;
    // Ящики на крыльце и в руках — уже приход: пока их не разложили, новую заявку не шлют.
    const incoming = (kind: LoadKind) => {
      let n = 0;
      for (const c of this.crates) if (c.kind === kind && !c.convoy) n += kind === 'weapons' ? c.left : 1;
      for (const c of this.carried.values()) if (c.kind === kind && !c.convoy) n += kind === 'weapons' ? c.left : 1;
      if (kind === 'weapons') for (const sl of this.slots) if (sl.area === 'repair' && sl.crate) n += sl.crate.left;
      return n;
    };
    const low = (area: SlotArea, share: number, kind: LoadKind) => {
      const f = this.fill(area);
      return f.total > 0 && f.used + incoming(kind) < f.total * share;
    };
    if (!low('hall', R.hall, 'ammo') && !low('vault', R.vault, 'grenades') && !low('rack', R.racks, 'weapons')) return;
    this.requested = true;
    this.stats.requests++;
    const at = this.time + ARSENAL.flight.lead;
    if (at < this.nextFlight) this.nextFlight = at;
    const who = this.qm?.fit ? this.qm.name : 'Кладовщик';
    this.ctx.law.log(`Склад Альянса: ${who} — ${this.ctx.rng.pick(ARSENAL.lines.request)} Борт через ${Math.round(this.nextFlight - this.time)} с.`, 'radio');
  }

  /** Контейнер: ящики по накладной — на места сброса крыльца, стопками; накладная — в опись. */
  private dropContainer(): void {
    const { ctx } = this;
    const F = ARSENAL.flight;
    const free = (area: SlotArea) => this.slots.filter((s) => s.area === area && !s.crate && !this.held(s)).length;
    const onGround = (kind: CrateKind) => this.crates.filter((c) => c.kind === kind).length;
    const want: [CrateKind, number][] = [
      ['ammo', Math.max(0, free('hall') - onGround('ammo'))],
      ['grenades', Math.max(0, free('vault') - onGround('grenades'))],
      ['weapons', Math.max(0, Math.min(free('repair'), Math.ceil(free('rack') / ARSENAL.perCrate.weapons)) - onGround('weapons'))],
    ];
    // Контейнер ограничен: делим места пропорционально нужде.
    const total = want.reduce((s, [, n]) => s + n, 0);
    const cap = Math.min(F.container, this.drops.length * F.stack);
    const scale = total > cap ? cap / total : 1;
    let slot = 0;
    let dropped = 0;
    for (const [kind, need] of want) {
      const n = Math.max(need > 0 ? 1 : 0, Math.floor(need * scale));
      for (let k = 0; k < n && dropped < cap; k++) {
        const d = this.drops[slot % Math.max(1, this.drops.length)] ?? this.pad!;
        const layer = Math.floor(slot / Math.max(1, this.drops.length));
        slot++;
        dropped++;
        this.crates.push(this.newCrate(kind, d.x + ctx.rng.range(-2, 2), d.y - layer * 5 + ctx.rng.range(-1, 1)));
        if (kind === 'weapons') this.ledger.parts += ARSENAL.perCrate.weapons;
        else this.ledger[kind]++;
      }
    }
    this.stats.delivered++;
    this.receiving = dropped > 0;
    this.receiveUntil = this.time + ARSENAL.receiveMax;
  }

  /** Кладовщик: на приёмку на крыльцо, пока там ящики, — и назад за стол. */
  private updateQm(): void {
    if (!this.qm || !this.qm.alive || !isQuartermaster(this.qm)) {
      this.qm = this.ctx.entities.list.find((c) => c.alive && !c.isPlayer && isQuartermaster(c)) ?? null;
    }
    if (this.receiving && (this.time > this.receiveUntil || !this.crates.some((c) => this.onPad(c.x, c.y)))) this.receiving = false;
    const b = this.qm?.brain;
    if (b instanceof CpBrain) {
      const want = this.receiving ? this.receiveSpot : null;
      if (b.raidPost !== want) {
        b.raidPost = want;
        // Перейти на новое место (приёмка на крыльце или назад за стол).
        if (b.fsm.current === 'guard') b.fsm.change('guard');
        if (want && this.qm) this.qm.say(this.ctx.rng.pick(ARSENAL.lines.receive), this.ctx.law.now, 3);
      }
    }
  }

  /** Отсек отперт, только пока туда идут по делу. */
  private updateVault(purge = false): void {
    if (!this.vaultDoor) return;
    // Бросившие работу (арест, гибель) — не в счёт (раз в такт, после мозгов: работа уже выдана).
    if (purge) for (const c of this.vaultUsers) if (!this.working(c)) this.vaultUsers.delete(c);
    // Игрок-работник склада (грузчик, кладовщик) у двери — отперто.
    const p = this.ctx.player;
    const d = this.vaultDoorTiles[0];
    const player = !!p && p.fit && !!d && Math.hypot(p.x - d.x, p.y - d.y) < ARSENAL.vault.reach && (p.profession === 'loader' || isQuartermaster(p));
    // Кто-то внутри отсека (зашёл по делу и ещё не вышел) — не запирать: иначе окажется взаперти.
    const locked = this.vaultUsers.size === 0 && !player && !this.someoneInVault();
    if (locked !== this.vaultLocked) {
      this.vaultLocked = locked;
      this.ctx.doors.setLocked(this.vaultDoor, locked);
    }
  }

  private someoneInVault(): boolean {
    const r = this.vaultRoom;
    if (!r) return false;
    // С запасом на порог и радиус: стоящий в проёме тоже «внутри».
    const e = this.ctx.map.tileSize * 2;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    for (const o of this.ctx.entities.near(cx, cy, Math.hypot(r.w, r.h) / 2 + e, near)) {
      if (o.alive && o.x >= r.x - e && o.y >= r.y - e && o.x < r.x + r.w + e && o.y < r.y + r.h + e) return true;
    }
    return false;
  }

  private get vaultRoom(): { x: number; y: number; w: number; h: number } | null {
    return this.rooms.find((q) => q.kind === 'vault') ?? null;
  }

  get vaultOpen(): boolean {
    return !this.vaultLocked;
  }

  private useVault(c: Character, on: boolean): void {
    if (on) this.vaultUsers.add(c);
    else this.vaultUsers.delete(c);
    this.updateVault();
  }

  // ————— Конвои на КПП —————

  private dispatchConvoys(): void {
    const { ctx } = this;
    const K = ARSENAL.kpp;
    for (let i = this.convoys.length - 1; i >= 0; i--) {
      const v = this.convoys[i];
      const f = ctx.war.fronts[v.point.front];
      const lost = f?.owner === 'rebels' || this.time > v.until;
      if ((v.ammo + v.grenades + v.carrying > 0) && !lost) continue;
      this.convoys.splice(i, 1);
      v.point.convoy = null;
      this.releaseEscort(v);
      for (const cr of this.crates) if (cr.convoy === v) cr.convoy = null;
    }
    if (this.convoys.length >= ARSENAL.convoy.max || ctx.war.code === 'red') return;
    for (const p of this.points) {
      if (p.convoy || p.kits >= K.low) continue;
      const f = ctx.war.fronts[p.front];
      if (!f || f.owner === 'rebels') continue;
      const hall = this.slots.filter((s) => s.area === 'hall' && s.crate && !this.held(s)).length;
      if (hall <= 1) continue;
      const ammo = Math.min(K.crates, Math.ceil((K.cap - p.kits) / ARSENAL.perCrate.ammo), hall - 1);
      const vault = this.slots.filter((s) => s.area === 'vault' && s.crate && !this.held(s)).length;
      const grenades = p.grenades < K.grenadesLow && vault > 1 ? 1 : 0;
      const v: Convoy = { point: p, ammo, grenades, carrying: 0, escort: null, until: this.time + ARSENAL.convoy.escortTime };
      p.convoy = v;
      this.convoys.push(v);
      this.stats.convoys++;
      ctx.law.log(`Склад Альянса: пункт боепитания ${f.name} пустеет — конвой, ящиков: ${ammo + grenades}.`, 'radio');
      return;
    }
  }

  /** Охранник склада сопровождает конвой (первого грузчика). */
  private assignEscort(v: Convoy, loader: Character): void {
    if (v.escort?.fit) return;
    let best: Character | null = null;
    let bestD = Infinity;
    for (const c of this.ctx.entities.list) {
      const b = c.brain;
      if (!c.fit || c.isPlayer || c.role?.kind !== 'depot' || !(b instanceof CpBrain) || b.ward) continue;
      const d = Math.hypot(c.x - loader.x, c.y - loader.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) return;
    v.escort = best;
    (best.brain as CpBrain).assignGuard(loader, v.until);
    loader.say(this.ctx.rng.pick(ARSENAL.lines.convoy), this.ctx.law.now, 2.5);
  }

  private releaseEscort(v: Convoy): void {
    const b = v.escort?.brain;
    if (b instanceof CpBrain) b.wardUntil = 0;
    v.escort = null;
  }

  // ————— Работа ГСР: грузчики —————

  /** Что делать грузчику сейчас (null — нечего). Ячейки и ящики бронируются. */
  loaderTask(c: Character): HaulTask | null {
    if (!this.present) return null;
    if (this.beaconBroken && (!this.beaconBy || !this.beaconBy.fit || this.beaconBy === c)) {
      this.beaconBy = c;
      return { type: 'beacon' };
    }
    // 1) Ящики с крыльца (и брошенные) — на хранение.
    let bestCrate: Crate | null = null;
    let bestD = Infinity;
    for (const cr of this.crates) {
      if (this.claimed(cr) || (cr.convoy && this.convoys.includes(cr.convoy))) continue;
      if (!this.freeSlot(AREA_OF[cr.kind as CrateKind], cr.x, cr.y)) continue;
      const d = Math.hypot(cr.x - c.x, cr.y - c.y);
      if (d < bestD) {
        bestD = d;
        bestCrate = cr;
      }
    }
    if (bestCrate) {
      const to = this.freeSlot(AREA_OF[bestCrate.kind as CrateKind], bestCrate.x, bestCrate.y)!;
      to.reserved = c;
      this.crateClaims.set(bestCrate, c);
      if (to.area === 'vault') this.useVault(c, true);
      return { type: 'store', crate: bestCrate, to };
    }
    // 2) Расходный стеллаж у окна пуст по какому-то виду — поднести.
    const restock = this.restockTask(c, true);
    if (restock) return restock;
    // 3) Конвой на КПП.
    for (const v of this.convoys) {
      // Брошенный по дороге ящик этого конвоя — подобрать первым.
      const lost = this.crates.find((cr) => cr.convoy === v && !this.claimed(cr));
      if (lost) {
        const kind = lost.kind as CrateKind;
        this.crateClaims.set(lost, c);
        if (kind === 'ammo') v.ammo = Math.max(0, v.ammo - 1);
        else v.grenades = Math.max(0, v.grenades - 1);
        v.carrying++;
        this.assignEscort(v, c);
        return { type: 'convoy', from: null, crate: lost, convoy: v, kind };
      }
      const kind: CrateKind | null = v.ammo > 0 ? 'ammo' : v.grenades > 0 ? 'grenades' : null;
      if (!kind) continue;
      const from = this.fullSlot(AREA_OF[kind], c.x, c.y);
      if (!from) continue;
      from.reserved = c;
      if (from.area === 'vault') this.useVault(c, true);
      if (kind === 'ammo') v.ammo--;
      else v.grenades--;
      v.carrying++;
      this.assignEscort(v, c);
      return { type: 'convoy', from, crate: null, convoy: v, kind };
    }
    // 4) Стеллаж выдачи не полон — поднести.
    return this.restockTask(c, false);
  }

  private readonly crateClaims = new Map<Crate, Character>();

  private claimed(cr: Crate): boolean {
    const who = this.crateClaims.get(cr);
    if (who && this.working(who)) return true;
    this.crateClaims.delete(cr);
    return false;
  }

  /** Человек и правда занят работой склада (не арестован, не убит, не бросил дело). */
  private working(c: Character | null): boolean {
    if (!c || !c.fit) return false;
    if (c.isPlayer) return true;
    const kind = (c.brain as { job?: { kind?: string } | null } | null)?.job?.kind;
    return kind === 'haul' || kind === 'armory';
  }

  /** Ячейка забронирована тем, кто ещё на этой работе; иначе бронь снимается. */
  private held(s: Slot): boolean {
    if (s.reserved && !this.working(s.reserved)) {
      s.reserved = null;
      this.incoming.delete(s);
    }
    return !!s.reserved;
  }

  /** Поднести на расходный стеллаж: urgent — только если какого-то вида там нет совсем. */
  private restockTask(c: Character, urgent: boolean): HaulTask | null {
    const shelf = this.slots.filter((s) => s.area === 'shelf');
    const count = (k: LoadKind) => shelf.filter((s) => (s.crate?.kind === k && s.crate.left > 0) || (this.held(s) && this.incoming.get(s) === k)).length;
    const S = ARSENAL.shelf;
    const need: [LoadKind, number, SlotArea][] = [
      ['ammo', S.ammo, 'hall'],
      ['grenades', S.grenades, 'vault'],
      ['gun', S.guns, 'rack'],
    ];
    for (const [kind, want, area] of need) {
      const have = count(kind);
      if (have >= want || (urgent && have > 0)) continue;
      const to = shelf.find((s) => !s.crate && !this.held(s));
      if (!to) return null;
      const from = this.fullSlot(area, to.x, to.y, kind === 'gun');
      if (!from) continue;
      to.reserved = c;
      from.reserved = c;
      this.incoming.set(to, kind);
      if (from.area === 'vault') this.useVault(c, true);
      return { type: 'restock', from, to };
    }
    return null;
  }

  /** Что несут на расходный стеллаж (для подсчёта «уже в пути»). */
  private readonly incoming = new Map<Slot, LoadKind>();

  /** Свободная ячейка области, ближайшая к точке. */
  private freeSlot(area: SlotArea, x: number, y: number): Slot | null {
    let best: Slot | null = null;
    let bestD = Infinity;
    for (const s of this.slots) {
      if (s.area !== area || s.crate || this.held(s)) continue;
      const d = Math.hypot(s.ax - x, s.ay - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Ячейка области с грузом (для стоек — исправный ствол), ближайшая к точке. */
  private fullSlot(area: SlotArea, x: number, y: number, gun = false): Slot | null {
    let best: Slot | null = null;
    let bestD = Infinity;
    for (const s of this.slots) {
      if (s.area !== area || !s.crate || this.held(s) || s.crate.left <= 0) continue;
      if (gun && s.crate.broken) continue;
      const d = Math.hypot(s.ax - x, s.ay - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Куда идти за грузом. */
  pickTarget(task: HaulTask): Vec2 | null {
    if (task.type === 'beacon') return this.beacon;
    if (task.type === 'store') return { x: task.crate.x, y: task.crate.y };
    if (task.type === 'convoy' && !task.from) return task.crate ? { x: task.crate.x, y: task.crate.y } : null;
    return task.from ? { x: task.from.ax, y: task.from.ay } : null;
  }

  /** Куда нести. */
  dropTarget(task: HaulTask): Vec2 | null {
    if (task.type === 'beacon') return this.beacon;
    if (task.type === 'convoy') return { x: task.convoy.point.x, y: task.convoy.point.y };
    return { x: task.to.ax, y: task.to.ay };
  }

  /** Задача ещё имеет смысл. */
  taskValid(task: HaulTask): boolean {
    if (task.type === 'beacon') return this.beaconBroken;
    if (task.type === 'store') return this.crates.includes(task.crate) || [...this.carried.values()].includes(task.crate);
    if (task.type === 'convoy') return this.ctx.war.fronts[task.convoy.point.front]?.owner !== 'rebels' && this.convoys.includes(task.convoy);
    return true;
  }

  /** Взять груз. false — брать нечего (задача сорвана). */
  pickUp(c: Character, task: HaulTask): boolean {
    if (task.type === 'beacon') return false;
    let crate: Crate | null = null;
    const loose = task.type === 'store' ? task.crate : task.type === 'convoy' && !task.from ? task.crate : null;
    if (loose) {
      const i = this.crates.indexOf(loose);
      if (i < 0) return false;
      this.crates.splice(i, 1);
      crate = loose;
    } else if (task.type !== 'store' && task.from) {
      crate = task.from.crate;
      if (!crate || crate.left <= 0) return false;
      task.from.crate = null;
      task.from.reserved = null;
    }
    if (!crate) return false;
    this.carried.set(c, crate);
    c.carrying = true;
    return true;
  }

  /** Поставить груз: в ячейку или на пункт КПП. Платят за каждый ящик. */
  putDown(c: Character, task: HaulTask): boolean {
    const crate = this.carried.get(c);
    if (!crate || task.type === 'beacon') return false;
    this.carried.delete(c);
    c.carrying = false;
    this.crateClaims.delete(crate);
    const W = ARSENAL.work;
    let pay = 0;
    if (task.type === 'convoy') {
      crate.convoy = null;
      const p = task.convoy.point;
      const K = ARSENAL.kpp;
      if (crate.kind === 'ammo') {
        p.kits = Math.min(K.cap + ARSENAL.perCrate.ammo, p.kits + crate.left);
        if (crate.tainted) p.tainted += crate.left;
        this.ledger.ammo--;
      } else if (crate.kind === 'grenades') {
        p.grenades = Math.min(K.grenadesCap + ARSENAL.perCrate.grenades, p.grenades + crate.left);
        this.ledger.grenades--;
      }
      task.convoy.carrying = Math.max(0, task.convoy.carrying - 1);
      this.stats.convoyCrates++;
      this.useVault(c, false);
      pay = W.payConvoy;
      const f = this.ctx.war.fronts[p.front];
      if (task.convoy.carrying + task.convoy.ammo + task.convoy.grenades === 0) this.ctx.law.log(`Склад Альянса: конвой дошёл — пункт боепитания ${f?.name ?? 'КПП'} пополнен (${p.kits} компл.).`, 'radio');
    } else {
      const to = task.to;
      to.reserved = null;
      this.incoming.delete(to);
      if (to.crate) {
        // Ячейку заняли — ящик рядом на пол.
        crate.x = to.ax;
        crate.y = to.ay;
        this.crates.push(crate);
        return false;
      }
      crate.x = to.x;
      crate.y = to.y;
      to.crate = crate;
      this.useVault(c, false);
      if (task.type === 'store') {
        this.stats.stored++;
        pay = W.payStore;
      } else {
        this.stats.restocked++;
        pay = W.payShelf;
      }
    }
    c.money += pay;
    this.ctx.economy.markWorked(c);
    adjustLoyalty(c, LOYALTY.points.cwuWork * 0.25, 'работа на складе', c.isPlayer ? this.ctx.bus : undefined);
    return true;
  }

  /**
   * Работа брошена: несомый груз — на землю (на территории склада его потом уберут на место),
   * брони ячеек, ящика и места в конвое снимаются.
   */
  abandon(c: Character, task: HaulTask | null): void {
    const had = this.carried.get(c) ?? null;
    this.drop(c);
    if (!task) return;
    this.useVault(c, false);
    if (task.type === 'beacon') {
      if (this.beaconBy === c) this.beaconBy = null;
      return;
    }
    if (task.type === 'store') {
      if (this.crateClaims.get(task.crate) === c) this.crateClaims.delete(task.crate);
      if (task.to.reserved === c) task.to.reserved = null;
    } else {
      if (task.from?.reserved === c) task.from.reserved = null;
      if (task.type === 'restock') {
        if (task.to.reserved === c) task.to.reserved = null;
        this.incoming.delete(task.to);
      } else {
        // Не донёс или не успел взять — ящик снова в очереди конвоя (брошенный — подберут первым).
        task.convoy.carrying = Math.max(0, task.convoy.carrying - 1);
        if (task.kind === 'ammo') task.convoy.ammo++;
        else task.convoy.grenades++;
        const lost = had ?? (task.from ? null : task.crate);
        if (lost && this.crates.includes(lost)) lost.convoy = task.convoy;
        if (task.crate && this.crateClaims.get(task.crate) === c) this.crateClaims.delete(task.crate);
      }
    }
  }

  /** Несомый груз — на землю, где стоит. */
  private drop(c: Character): void {
    const crate = this.carried.get(c);
    if (!crate) return;
    this.carried.delete(c);
    c.carrying = false;
    this.crateClaims.delete(crate);
    crate.x = c.x;
    crate.y = c.y;
    if (crate.kind === 'gun') {
      // Ствол из рук — назад в ящик на ремонт (или на свободную стойку, если исправен).
      const back = crate.broken ? this.slots.find((s) => s.area === 'repair' && s.crate?.kind === 'weapons') : this.freeSlot('rack', c.x, c.y);
      if (back?.crate && crate.broken) back.crate.left++;
      else if (back && !back.crate) back.crate = { ...crate, x: back.x, y: back.y };
      else this.crates.push(crate);
      this.workbench.gun = false;
      return;
    }
    this.crates.push(crate);
  }

  // ————— Игрок-грузчик и игрок-оружейник —————

  /** Откуда игрок взял груз (оплата — за полезное перемещение, а не за перекладывание). */
  private readonly playerFrom = new Map<Character, SlotArea | 'ground'>();

  /** Ячейка рядом (по месту, откуда до неё дотягиваются). */
  slotNear(x: number, y: number, r: number, pred: (s: Slot) => boolean): Slot | null {
    let best: Slot | null = null;
    let bestD = r;
    for (const s of this.slots) {
      if (this.held(s) || !pred(s)) continue;
      const d = Math.min(Math.hypot(s.ax - x, s.ay - y), Math.hypot(s.x - x, s.y - y));
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** E без груза: взять ящик с крыльца (или брошенный) или из ячейки хранения. Сообщение или null. */
  playerTake(p: Character, reach: number): string | null {
    let best: Crate | null = null;
    let bestD = reach;
    for (const c of this.crates) {
      if (this.claimed(c)) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      this.crates.splice(this.crates.indexOf(best), 1);
      this.carried.set(p, best);
      p.carrying = true;
      this.playerFrom.set(p, 'ground');
      return best.kind === 'ammo' ? 'Ящик патронов — на стеллаж зала.' : best.kind === 'grenades' ? 'Ящик гранат — в отсек (дверь отопрут, когда подойдёте).' : 'Ящик стволов в консервации — в мастерскую, к верстаку.';
    }
    const s = this.slotNear(p.x, p.y, reach, (q) => !!q.crate && q.crate.left > 0 && q.area !== 'shelf' && q.area !== 'repair' && !(q.crate.kind === 'gun' && q.crate.broken));
    if (!s?.crate) return null;
    this.carried.set(p, s.crate);
    this.playerFrom.set(p, s.area);
    s.crate = null;
    p.carrying = true;
    return 'Взяли груз — на расходный стеллаж у окна или конвоем на пункт боепитания КПП.';
  }

  /** E с грузом: поставить в подходящую ячейку рядом или сдать на пункт КПП. Сообщение. */
  playerPut(p: Character, reach: number): string {
    const crate = this.carried.get(p);
    if (!crate) return 'Рук свободны.';
    const from = this.playerFrom.get(p) ?? 'ground';
    const W = ARSENAL.work;
    // Пункт боепитания КПП рядом — сдать.
    const point = this.points.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < ARSENAL.kpp.reach + 12);
    if (point && (crate.kind === 'ammo' || crate.kind === 'grenades')) {
      this.carried.delete(p);
      p.carrying = false;
      if (crate.kind === 'ammo') {
        point.kits += crate.left;
        if (crate.tainted) point.tainted += crate.left;
        this.ledger.ammo--;
      } else {
        point.grenades += crate.left;
        this.ledger.grenades--;
      }
      this.stats.convoyCrates++;
      p.money += from === 'hall' || from === 'vault' ? W.payConvoy : 0;
      return `Сдано на пункт боепитания: ${point.kits} компл. патронов, ${point.grenades} гранат. +${W.payConvoy} токенов.`;
    }
    const kind = crate.kind;
    const home: SlotArea[] = kind === 'ammo' ? ['hall', 'shelf'] : kind === 'grenades' ? ['vault', 'shelf'] : kind === 'weapons' ? ['repair'] : crate.broken ? ['repair'] : ['rack', 'shelf'];
    const s = this.slotNear(p.x, p.y, reach, (q) => !q.crate && home.includes(q.area));
    if (!s) return kind === 'ammo' ? 'Нужна свободная ячейка стеллажа в зале (или на стеллаже выдачи).' : kind === 'grenades' ? 'Гранаты — в отсек, на свободную полку.' : 'Сюда не поставить — ищите свободное место.';
    this.carried.delete(p);
    p.carrying = false;
    crate.x = s.x;
    crate.y = s.y;
    s.crate = crate;
    const pay = s.area === 'shelf' ? (from !== 'shelf' && from !== 'ground' ? W.payShelf : 0) : from === 'ground' ? W.payStore : 0;
    if (pay) {
      p.money += pay;
      this.ctx.economy.markWorked(p);
    }
    if (s.area === 'shelf') this.stats.restocked++;
    else this.stats.stored++;
    return pay ? `Поставлено. +${pay} токенов.` : 'Поставлено.';
  }

  /** Игрок-оружейник: взять ствол из ящика на ремонт рядом. */
  playerTakeGun(p: Character, reach: number): boolean {
    const s = this.slotNear(p.x, p.y, reach, (q) => q.area === 'repair' && q.crate?.kind === 'weapons' && q.crate.left > 0);
    if (!s) return false;
    return this.takeGun(p, { type: 'repair', from: s, to: s });
  }

  /** Игрок-оружейник: ствол готов (после работы за верстаком). */
  playerFinishRepair(p: Character): boolean {
    const gun = this.carried.get(p);
    if (!gun?.broken) return false;
    this.workbench.progress = 1;
    return this.repairGun(p, 1);
  }

  /** Игрок-оружейник: повесить исправный ствол на свободную стойку рядом. */
  playerRackGun(p: Character, reach: number): boolean {
    const s = this.slotNear(p.x, p.y, reach, (q) => q.area === 'rack' && !q.crate);
    if (!s) return false;
    return this.rackGun(p, { type: 'repair', from: s, to: s });
  }

  /** Игрок-оружейник: проверить ящик патронов рядом (после check с работы). true — брак найден. */
  playerCheck(p: Character, slot: Slot): boolean {
    const had = slot.crate?.tainted ?? false;
    this.checkCrate(p, { type: 'check', slot }, 1e9, { t: 0 });
    return had && !slot.crate;
  }

  cargo(c: Character): Crate | null {
    return this.carried.get(c) ?? null;
  }

  get carriedCrates(): ReadonlyMap<Character, Crate> {
    return this.carried;
  }

  /** Починка маяка: true — готово. */
  repairBeacon(c: Character, dt: number): boolean {
    if (!this.beaconBroken) return true;
    this.beaconProgress += dt;
    if (this.beaconProgress < ARSENAL.beacon.repair) return false;
    this.beaconBroken = false;
    this.beaconProgress = 0;
    this.beaconBy = null;
    this.stats.repairedBeacon++;
    c.money += ARSENAL.work.payStore * 2;
    this.ctx.law.log(`${c.name} (ГСР) починил маяк крыльца склада.`, 'world');
    return true;
  }

  // ————— Оружейник —————

  armorerTask(c: Character): ArmorerTask | null {
    if (!this.present) return null;
    const from = this.slots.find((s) => s.area === 'repair' && s.crate?.kind === 'weapons' && s.crate.left > 0 && !this.held(s));
    const to = this.freeSlot('rack', this.bench?.x ?? c.x, this.bench?.y ?? c.y);
    if (from && to) {
      from.reserved = c;
      to.reserved = c;
      return { type: 'repair', from, to };
    }
    // Выборочная проверка ящика патронов, ещё не проверенного.
    const list = this.slots.filter((s) => s.area === 'hall' && s.crate && !s.crate.checked && !this.held(s));
    if (!list.length) return null;
    const slot = this.ctx.rng.pick(list);
    slot.reserved = c;
    return { type: 'check', slot };
  }

  /** Взять ствол из ящика на ремонт. */
  takeGun(c: Character, task: Extract<ArmorerTask, { type: 'repair' }>): boolean {
    const cr = task.from.crate;
    task.from.reserved = null;
    if (!cr || cr.kind !== 'weapons' || cr.left <= 0) return false;
    cr.left--;
    if (cr.left <= 0) task.from.crate = null;
    const gun = this.newCrate('gun', c.x, c.y);
    gun.broken = true;
    this.carried.set(c, gun);
    c.carrying = true;
    return true;
  }

  /** За верстаком: true — ствол готов (исправный — в руках). */
  repairGun(c: Character, dt: number): boolean {
    const gun = this.carried.get(c);
    if (!gun || gun.kind !== 'gun') return true;
    if (!gun.broken) return true;
    this.workbench.gun = true;
    this.workbench.progress += dt / ARSENAL.armorer.repair;
    if (this.workbench.progress < 1) return false;
    this.workbench.progress = 0;
    this.workbench.gun = false;
    gun.broken = false;
    this.ledger.parts--;
    this.ledger.weapons++;
    this.stats.repaired++;
    c.money += ARSENAL.armorer.pay;
    this.ctx.economy.markWorked(c);
    return true;
  }

  /** Повесить ствол на стойку. */
  rackGun(c: Character, task: Extract<ArmorerTask, { type: 'repair' }>): boolean {
    const gun = this.carried.get(c);
    task.to.reserved = null;
    if (!gun || gun.kind !== 'gun' || gun.broken) return false;
    const to = task.to.crate ? this.freeSlot('rack', c.x, c.y) : task.to;
    if (!to) return false;
    this.carried.delete(c);
    c.carrying = false;
    gun.x = to.x;
    gun.y = to.y;
    to.crate = gun;
    return true;
  }

  /** Проверка ящика патронов (check с); брак — ящик списан. true — итог. */
  checkCrate(c: Character, task: Extract<ArmorerTask, { type: 'check' }>, dt: number, work: { t: number }): boolean {
    const cr = task.slot.crate;
    if (!cr) {
      task.slot.reserved = null;
      return true;
    }
    work.t += dt;
    if (work.t < ARSENAL.armorer.check) return false;
    task.slot.reserved = null;
    cr.checked = true;
    this.stats.checked++;
    c.money += ARSENAL.armorer.checkPay;
    this.ctx.economy.markWorked(c);
    if (cr.tainted && this.ctx.rng.chance(ARSENAL.armorer.findTaint)) {
      task.slot.crate = null;
      this.ledger.ammo--;
      this.stats.caught++;
      this.ctx.law.log(`Оружейник ${c.name}: в ящике патронов брак — партия списана. Кто-то копался в ящиках!`, 'radio');
      if (this.hall) this.ctx.war.raiseAlarm(this.hall.x, this.hall.y, 'брак в патронах на складе Альянса', false);
    }
    return true;
  }

  /** Оружейник бросил работу: брони снять, ствол из рук — назад. */
  abandonArmorer(c: Character, task: ArmorerTask | null): void {
    this.drop(c);
    if (!task) return;
    if (task.type === 'repair') {
      if (task.from.reserved === c) task.from.reserved = null;
      if (task.to.reserved === c) task.to.reserved = null;
    } else if (task.slot.reserved === c) task.slot.reserved = null;
  }

  // ————— Выдача ГО —————

  private shelfCrate(kind: LoadKind): Slot | null {
    return this.slots.find((s) => s.area === 'shelf' && s.crate?.kind === kind && s.crate.left > 0 && !(kind === 'gun' && s.crate.broken)) ?? null;
  }

  /** Табельное оружие по набору юнита (огнестрел, кроме пистолета, который есть всегда). */
  private kitGuns(c: Character): WeaponId[] {
    if (c.faction !== 'cp') return [];
    return (KITS[cpKit(c.rank)] ?? []).map(([id]) => id).filter((id): id is WeaponId => ITEMS[id].kind === 'weapon' && !!WEAPONS[id as WeaponId].ammo && id !== 'usp');
  }

  /**
   * Выдать у окна: табельный ствол (если нет), боекомплект (issue.mags магазинов к каждому стволу),
   * гранаты до набора — с расходного стеллажа. Порченый ящик — у бойца осечки. Причина отказа или null.
   */
  issue(c: Character): string | null {
    if (!this.present || !this.window) return 'склада нет';
    if (this.closed) return this.ctx.rng.pick(ARSENAL.lines.closed);
    const qm = this.quartermaster;
    if (!qm) return this.ctx.rng.pick(ARSENAL.lines.away);
    const I = ARSENAL.issue;
    this.shiftServed.add(c);
    const kitG0 = (KITS[cpKit(c.rank)] ?? []).find(([id]) => id === 'grenade')?.[1] ?? 0;
    const need = this.kitGuns(c).some((id) => !c.inventory.has(id)) || this.lowAmmo(c, I.mags) || c.inventory.count('grenade') < Math.min(kitG0, I.grenades);
    if (!need) {
      // Полный комплект (смена): проверил, записал — свободен.
      this.stats.shiftChecks++;
      qm.say(this.ctx.rng.pick(ARSENAL.lines.full), this.ctx.law.now, 2);
      return null;
    }
    let got = false;
    for (const id of this.kitGuns(c)) {
      if (c.inventory.has(id)) continue;
      const s = this.shelfCrate('gun');
      if (!s) break;
      s.crate = null;
      c.inventory.add(id, 1);
      this.ledger.weapons--;
      got = true;
    }
    const ammo = this.shelfCrate('ammo');
    if (ammo?.crate && this.lowAmmo(c, I.mags) && this.ctx.economy.refillAmmo(c, I.mags) > 0) {
      c.badAmmo = ammo.crate.tainted;
      if (--ammo.crate.left <= 0) {
        ammo.crate = null;
        this.ledger.ammo--;
      }
      got = true;
    }
    const kitG = (KITS[cpKit(c.rank)] ?? []).find(([id]) => id === 'grenade')?.[1] ?? 0;
    const wantG = Math.min(kitG, I.grenades) - c.inventory.count('grenade');
    if (wantG > 0) {
      const n = this.takeGrenades(wantG);
      if (n > 0) {
        c.inventory.add('grenade', n);
        got = true;
      }
    }
    if (!got) return this.ctx.rng.pick(ARSENAL.lines.empty);
    this.stats.issued++;
    // Табельный ствол — в руки (ГО вне боя всё равно возьмёт дубинку, если надо).
    qm.say(this.ctx.rng.pick(ARSENAL.lines.qm), this.ctx.law.now, 2);
    return null;
  }

  private takeGrenades(n: number): number {
    let got = 0;
    while (got < n) {
      const s = this.shelfCrate('grenades');
      if (!s?.crate) break;
      const k = Math.min(n - got, s.crate.left);
      s.crate.left -= k;
      got += k;
      if (s.crate.left <= 0) {
        s.crate = null;
        this.ledger.grenades--;
      }
    }
    return got;
  }

  /** Основной ствол бойца (в руках или первый в инвентаре; дубинка не в счёт). */
  private lowAmmo(c: Character, mags: number): boolean {
    const w = primaryGun(this.ctx, c);
    if (!w) return true;
    const def = WEAPONS[w];
    return !!def.ammo && c.inventory.count(AMMO_ITEM[def.ammo]) < def.magazine * mags;
  }

  /**
   * Идти ли ГО города к окну: нет табельного ствола (и на складе есть), или патронов к основному меньше
   * issue.lowMags магазинов (и патроны есть). Склад закрыт — нет.
   */
  needsKit(c: Character): boolean {
    if (!this.present || this.closed) return false;
    const missing = this.kitGuns(c).some((id) => !c.inventory.has(id));
    if (missing && (this.shelfCrate('gun') || this.slots.some((s) => s.area === 'rack' && s.crate && !s.crate.broken))) return true;
    const ammo = this.slots.some((s) => (s.area === 'shelf' || s.area === 'hall') && s.crate?.kind === 'ammo' && s.crate.left > 0);
    return ammo && this.lowAmmo(c, ARSENAL.issue.lowMags);
  }

  /** Совместимость: нужны ли патроны. */
  needsAmmo(c: Character): boolean {
    return this.needsKit(c);
  }

  /** Нет табельного ствола (после возрождения). */
  missingKit(c: Character): boolean {
    return this.kitGuns(c).some((id) => !c.inventory.has(id));
  }

  /**
   * Возрождённый ГО города (патруль, группа, техник, офицер) выходит из казармы с одним пистолетом —
   * табельное и боекомплект получит на складе. Гарнизоны КПП, посты и охрану снаряжает Цитадель.
   */
  kitOnRespawn(c: Character): void {
    if (!this.present || c.faction !== 'cp') return;
    const kind = c.role?.kind;
    if (kind !== 'patrol' && kind !== 'squad' && kind !== 'tech' && kind !== 'officer') return;
    for (const id of this.kitGuns(c)) {
      const w = WEAPONS[id];
      c.inventory.remove(id, c.inventory.count(id));
      if (w.ammo) c.inventory.remove(AMMO_ITEM[w.ammo], c.inventory.count(AMMO_ITEM[w.ammo]));
    }
    const usp = WEAPONS.usp;
    if (usp.ammo) {
      const item = AMMO_ITEM[usp.ammo];
      const extra = c.inventory.count(item) - usp.magazine * ARSENAL.respawn.poorMags;
      if (extra > 0) c.inventory.remove(item, extra);
    }
    const g = c.inventory.count('grenade');
    if (g > 0) c.inventory.remove('grenade', g);
    if (c.weapon && !c.inventory.has(c.weapon)) this.ctx.combat.equip(c, c.inventory.has('usp') ? 'usp' : null);
    this.stats.drawn++;
  }

  // ————— Пункты боепитания КПП —————

  /** Идти ли бойцу гарнизона к пункту: мало патронов, пункт не пуст, КПП не прорван. */
  needsPoint(c: Character, front: number): boolean {
    const p = this.pointOf(front);
    if (!p || p.kits <= 0) return false;
    if (this.ctx.war.fronts[front]?.owner === 'rebels') return false;
    return this.lowAmmo(c, ARSENAL.kpp.lowMags);
  }

  /** Пополниться у пункта: магазины и гранаты. Причина отказа или null. */
  drawAtPoint(c: Character, front: number): string | null {
    const p = this.pointOf(front);
    if (!p) return 'пункта нет';
    const K = ARSENAL.kpp;
    if (p.kits <= 0) {
      this.stats.pointEmpty++;
      return this.ctx.rng.pick(ARSENAL.lines.pointEmpty);
    }
    this.ctx.economy.refillAmmo(c, K.mags);
    c.badAmmo = p.tainted > 0 && this.ctx.rng.chance(p.tainted / p.kits);
    if (c.badAmmo) p.tainted--;
    p.kits--;
    const kitG = (KITS[cpKit(c.rank)] ?? []).find(([id]) => id === 'grenade')?.[1] ?? 0;
    const want = Math.min(kitG, K.grenades) - c.inventory.count('grenade');
    if (want > 0 && p.grenades > 0) {
      const n = Math.min(want, p.grenades);
      c.inventory.add('grenade', n);
      p.grenades -= n;
    }
    this.stats.pointDraws++;
    return null;
  }

  // ————— Инспекция —————

  private updateInspection(dt: number): void {
    const I = ARSENAL.inspect;
    const p = this.ledgerSpot;
    if (!p || this.time - this.lastInspection < I.every) return;
    this.inspectScan -= dt;
    if (this.inspectScan > 0) return;
    this.inspectScan = 0.5;
    const by = this.ctx.entities.near(p.x, p.y, I.reach, near).find((o) => o.fit && o.faction === 'cp' && !o.isPlayer && (o.brain as { duty?: string } | null)?.duty === 'inspector');
    if (!by) {
      this.inspecting = 0;
      return;
    }
    this.inspecting += 0.5;
    if (this.inspecting < I.check) return;
    this.inspecting = 0;
    this.inspect(by);
  }

  /** Сверка описи с запасами. Недостача — тревога, выдача закрыта, опись — по факту. */
  inspect(by: Character): number {
    const { ctx } = this;
    this.stats.inspections++;
    this.lastInspection = this.time;
    const st = this.stock;
    let short = 0;
    for (const k of ['ammo', 'grenades', 'weapons', 'parts'] as const) short += Math.max(0, this.ledger[k] - st[k]);
    if (short > 0) {
      this.stats.shortages++;
      this.lockdownUntil = this.time + ARSENAL.inspect.lockdown;
      ctx.law.log(`${by.name}: недостача на складе Альянса — ${short} ед. Выдача закрыта, склад под проверкой!`, 'radio');
      if (this.hall) ctx.war.raiseAlarm(this.hall.x, this.hall.y, 'недостача на складе Альянса', false);
      by.say('Недостача! Кто подписывал накладные?', ctx.law.now, 3);
    } else {
      ctx.law.log(`${by.name} проверил опись склада Альянса: всё сходится.`, 'radio');
      by.say('Опись сходится. Продолжайте.', ctx.law.now, 2.5);
    }
    Object.assign(this.ledger, st);
    return short;
  }

  // ————— Диверсии —————

  /** Ящик для диверсии рядом: на крыльце (не взятый) или в ячейке зала. */
  private crateAt(x: number, y: number, r: number, pred: (c: Crate) => boolean): { crate: Crate; slot: Slot | null } | null {
    let best: { crate: Crate; slot: Slot | null } | null = null;
    let bestD = r;
    for (const c of this.crates) {
      if (this.claimed(c) || !pred(c)) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) {
        bestD = d;
        best = { crate: c, slot: null };
      }
    }
    for (const s of this.slots) {
      if (!s.crate || this.held(s) || s.area === 'rack' || !pred(s.crate)) continue;
      const d = Math.hypot(s.ax - x, s.ay - y);
      if (d < bestD) {
        bestD = d;
        best = { crate: s.crate, slot: s };
      }
    }
    return best;
  }

  /** Кража: ящик рядом (крыльцо или зал). Что унёс. */
  steal(by: Character): CrateKind | null {
    const hit = this.crateAt(by.x, by.y, 60, (c) => c.kind !== 'gun');
    if (!hit) return null;
    if (hit.slot) hit.slot.crate = null;
    else this.crates.splice(this.crates.indexOf(hit.crate), 1);
    this.stats.stolen++;
    return hit.crate.kind as CrateKind;
  }

  /** Подмешать брак в ящик патронов рядом. */
  taint(by: Character): boolean {
    const hit = this.crateAt(by.x, by.y, 60, (c) => c.kind === 'ammo' && !c.tainted);
    if (!hit) return false;
    hit.crate.tainted = true;
    hit.crate.checked = false;
    this.stats.tainted++;
    return true;
  }

  get tainted(): number {
    let n = 0;
    for (const s of this.slots) if (s.crate?.tainted) n++;
    for (const c of this.crates) if (c.tainted) n++;
    return n;
  }

  breakBeacon(): boolean {
    if (this.beaconBroken) return false;
    this.beaconBroken = true;
    this.beaconProgress = 0;
    return true;
  }

  /** Заряд у двери зала (граната из инвентаря): взрыв через bomb.fuse с. */
  plantBomb(by: Character): boolean {
    if (this.bomb || !this.bombSpot || !by.inventory.remove('grenade', 1)) return false;
    this.bomb = { x: this.bombSpot.x, y: this.bombSpot.y, at: this.time + ARSENAL.bomb.fuse, by };
    return true;
  }

  private updateBomb(dt: number): void {
    const b = this.bomb;
    if (!b) return;
    const { ctx } = this;
    const B = ARSENAL.bomb;
    this.bombScan -= dt;
    if (this.bombScan <= 0) {
      this.bombScan = 0.5;
      for (const o of ctx.entities.near(b.x, b.y, B.spot, near)) {
        if (!o.fit || o.isPlayer || !FACTIONS[o.faction].authority || !lineOfSight(ctx.map, o.x, o.y, b.x, b.y)) continue;
        if (!ctx.rng.chance(B.spotChance * 0.5)) continue;
        this.bomb = null;
        this.stats.defused++;
        o.say('Заряд у двери! Обезвреживаю!', ctx.law.now, 2.5);
        ctx.law.log(`Склад Альянса: ${o.name} обезвредил заряд у двери зала.`, 'radio');
        return;
      }
    }
    if (this.time < b.at) return;
    this.bomb = null;
    this.stats.bombs++;
    ctx.combat.explode(b.x, b.y, b.by, 'frag', B.blast);
    ctx.combat.fires.push({ x: b.x, y: b.y, r: GRENADE.radius * 0.8, until: ctx.combat.now + 10, owner: b.by });
    // Сгорает доля ящиков зала (и в опись — как списанные).
    const hall = this.slots.filter((s) => s.area === 'hall' && s.crate);
    const lost = Math.round(hall.length * B.destroy);
    for (const s of hall.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y)).slice(0, lost)) {
      s.crate = null;
      this.ledger.ammo = Math.max(0, this.ledger.ammo - 1);
    }
    ctx.law.log('Взрыв на складе Альянса! Часть запасов уничтожена, пожар.', 'radio');
    ctx.war.raiseAlarm(b.x, b.y, 'взрыв на складе Альянса', false);
  }

  /** Спецагент в форме Альянса «по наряду»: гранаты у окна (кладовщик записывает — это не кража). */
  requisition(by: Character): number {
    if (this.closed || !this.quartermaster) return 0;
    const n = this.takeGrenades(ARSENAL.requisition.grenades);
    if (n > 0) {
      by.inventory.add('grenade', n);
      this.stats.requisitions++;
    }
    return n;
  }

  /** Что подпольщику сделать на складе (доли ARSENAL.ops; невозможное не выбирается) и где. */
  pickSabotage(by: Character): { act: DepotAct; spot: Vec2 } | null {
    if (!this.present) return null;
    const O = ARSENAL.ops;
    const any = this.crateAt(this.hall?.x ?? by.x, this.hall?.y ?? by.y, 1e9, (c) => c.kind === 'ammo' || c.kind === 'grenades');
    const ammo = this.crateAt(this.hall?.x ?? by.x, this.hall?.y ?? by.y, 1e9, (c) => c.kind === 'ammo' && !c.tainted);
    const spotOf = (h: { crate: Crate; slot: Slot | null } | null): Vec2 | null => (h ? (h.slot ? { x: h.slot.ax, y: h.slot.ay } : { x: h.crate.x, y: h.crate.y }) : null);
    const opts: [DepotAct, number, Vec2 | null][] = [
      ['steal', O.steal, spotOf(any)],
      ['taint', O.taint, spotOf(ammo)],
      ['bomb', by.inventory.has('grenade') && !this.bomb ? O.bomb : 0, this.bombSpot],
      ['beacon', this.beaconBroken ? 0 : O.beacon, this.beacon],
    ];
    const ok = opts.filter(([, w, p]) => w > 0 && p);
    let r = this.ctx.rng.next() * ok.reduce((n, [, w]) => n + w, 0);
    for (const [act, w, p] of ok) if ((r -= w) <= 0) return { act, spot: p! };
    return null;
  }

  sabotageTime(act: DepotAct): number {
    return act === 'steal' ? ARSENAL.steal.time : act === 'bomb' ? ARSENAL.bomb.plant : act === 'taint' ? ARSENAL.tamper.taint : ARSENAL.tamper.beacon;
  }

  /** Дело на складе. Охрана, видящая подпольщика за делом, с шансом ops.caught раскрывает. */
  doSabotage(by: Character, act: DepotAct): boolean {
    const { ctx } = this;
    let ok = false;
    if (act === 'steal') {
      const kind = this.steal(by);
      ok = !!kind;
      if (kind === 'ammo') ctx.economy.refillAmmo(by, ARSENAL.steal.mags);
      else if (kind === 'grenades') by.inventory.add('grenade', ARSENAL.steal.grenades);
      else if (kind === 'weapons') by.inventory.add('mp7', 1);
    } else if (act === 'taint') ok = this.taint(by);
    else if (act === 'bomb') ok = this.plantBomb(by);
    else ok = this.breakBeacon();
    if (ok && act !== 'bomb' && this.watched(by.x, by.y, by) && ctx.rng.chance(ARSENAL.ops.caught)) {
      ctx.combat.reveal(by, 'пойманы на складе Альянса');
      by.law.wanted = true;
      ctx.war.raiseAlarm(by.x, by.y, 'диверсия на складе Альянса', false);
    }
    return ok;
  }

  watched(x: number, y: number, except: Character | null = null): boolean {
    for (const o of this.ctx.entities.near(x, y, ARSENAL.ops.watch, near)) {
      if (o !== except && o.fit && !o.isPlayer && FACTIONS[o.faction].authority && canSeeCircle(this.ctx.map, o.x, o.y, x, y, 10)) return true;
    }
    return false;
  }
}

/** Юнит кладовщика SU.QM. */
export function isQuartermaster(c: Character): boolean {
  return isCpUnit(c, 'qm');
}

/** Основной огнестрел бойца (в руках или первый в инвентаре; дубинка не в счёт). */
function primaryGun(ctx: AiContext, c: Character): WeaponId | null {
  const guns = ctx.combat.weaponsOf(c).filter((id) => !!WEAPONS[id].ammo && WEAPONS[id].mode !== 'melee');
  // Длинный ствол важнее пистолета.
  return guns.find((id) => id !== 'usp' && id !== 'revolver' && id !== 'rebel_pistol') ?? guns[0] ?? null;
}
