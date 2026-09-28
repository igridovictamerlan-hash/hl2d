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

/** Ящик на площадке: прилетел (in — нести в зал) или загружен для КПП (out — ждёт корабль). */
export interface Crate {
  id: number;
  kind: CrateKind;
  x: number;
  y: number;
  dir: 'in' | 'out';
  tainted: boolean;
  carrier: Character | null;
}

/** Работа грузчика: ящик с площадки в зал, из зала на площадку для КПП, починка маяка. */
export type HaulTask = { type: 'in'; crate: Crate } | { type: 'out'; kind: CrateKind } | { type: 'beacon' };

export type Stock = Record<CrateKind, number>;

/** Диверсия подполья на складе: кража ящика, брак в патроны, заряд у двери зала, порча маяка. */
export type DepotAct = 'steal' | 'taint' | 'bomb' | 'beacon';

const KINDS: CrateKind[] = ['ammo', 'grenades', 'weapons'];
const near: Character[] = [];

/**
 * Склад Альянса на окраине (config/arsenal.ts): запасы (патроны, гранаты, стволы) и опись у
 * кладовщика; поставки кораблём из Цитадели на площадку склада (контейнер — ящики на места
 * площадки), грузчики ГСР носят их в зал и грузят ящики для гарнизонов КПП (корабль забирает их
 * в следующий рейс), оружейник ГСР чинит стволы; выдача ГО у окна (кладовщик SU.QM), возрождение ГО
 * — с набором со склада; инспекция описи; диверсии подполья: кража, брак, подрыв, срыв рейса.
 */
export class ArsenalSystem {
  readonly present: boolean;
  /** Здание, двор (площадка), зал, стол кладовщика, место у окна выдачи, стол описи, маяк, верстак. */
  readonly rect: { x: number; y: number; w: number; h: number } | null = null;
  readonly pad: Vec2 | null = null;
  readonly padRect: { x: number; y: number; w: number; h: number } | null = null;
  readonly hall: Vec2 | null = null;
  readonly desk: Vec2 | null = null;
  readonly window: Vec2 | null = null;
  readonly windowTiles: Vec2[] = [];
  readonly ledgerDesk: Vec2 | null = null;
  readonly beacon: Vec2 | null = null;
  readonly bench: Vec2 | null = null;
  readonly drops: Vec2[] = [];
  readonly posts: { x: number; y: number; facing: number }[] = [];
  /** Где ставят заряд: у двери из зала на площадку (со стороны площадки). */
  readonly bombSpot: Vec2 | null = null;
  /** Где стоят грузчики без дела; где в зале сдают и берут ящики; где стоит оружейник. */
  readonly waitSpot: Vec2 | null = null;
  readonly hallSpot: Vec2 | null = null;
  /** Где инспектор сверяет опись (у стола описи в конторе). */
  readonly ledgerSpot: Vec2 | null = null;
  readonly benchSpot: Vec2 | null = null;
  /** Для отрисовки: стеллажи, ящики патронов, ящики гранат, койки. */
  readonly racks: Vec2[] = [];
  readonly ammoSlots: Vec2[] = [];
  readonly grenadeSlots: Vec2[] = [];
  readonly cots: Vec2[] = [];
  readonly benchTiles: Vec2[] = [];

  readonly stock: Stock = { ammo: ARSENAL.start.ammo, grenades: ARSENAL.start.grenades, weapons: ARSENAL.start.weapons };
  readonly ledger: Stock = { ammo: ARSENAL.start.ammo, grenades: ARSENAL.start.grenades, weapons: ARSENAL.start.weapons };
  /** Порченых ящиков патронов среди запасов. */
  tainted = 0;
  /** Открытые ящики: сколько боекомплектов и гранат в них осталось, порченый ли ящик патронов. */
  openAmmo = 0;
  openGrenades = 0;
  private openTainted = false;
  readonly crates: Crate[] = [];
  private readonly carried = new Map<Character, Crate>();
  /** Сколько ещё ящиков погрузить для КПП до следующего рейса. */
  outQuota = 0;
  /** Корабль: фаза, время в фазе, сорван ли рейс (маяк). */
  readonly ship = { phase: 'none' as 'none' | 'arrive' | 'hover' | 'leave', t: 0, aborted: false, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
  nextFlight: number = ARSENAL.flight.first;
  private emergency = false;
  beaconBroken = false;
  beaconProgress = 0;
  lockdownUntil = 0;
  bomb: { x: number; y: number; at: number; by: Character } | null = null;
  private bombScan = 0;
  private benchAcc = new Map<Character, number>();
  /** Инспекция: когда была последняя, сколько инспектор уже сверяет. */
  lastInspection = -1e9;
  private inspecting = 0;
  private inspectScan = 0;
  private nextId = 1;
  private time = 0;
  private redLogged = false;
  readonly stats = { flights: 0, aborted: 0, delivered: 0, hauled: 0, loaded: 0, issued: 0, poorKits: 0, stolen: 0, tainted: 0, jams: 0, caught: 0, bombs: 0, defused: 0, shortages: 0, inspections: 0, kppCrates: 0, repaired: 0 };

  constructor(private readonly ctx: AiContext) {
    const map = ctx.map;
    const ts = map.tileSize;
    const a = map.poisOf('arsenal')[0];
    this.present = !!a;
    if (!a) return;
    const at = (p: { x: number; y: number }): Vec2 => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts });
    const area = (t: 'arsenal_pad' | 'arsenal_hall') => {
      const p = map.poisOf(t)[0];
      return p ? { x: (p.x + (p.w ?? 1) / 2) * ts, y: (p.y + (p.h ?? 1) / 2) * ts } : null;
    };
    this.rect = { x: a.x * ts, y: a.y * ts, w: (a.w ?? 1) * ts, h: (a.h ?? 1) * ts };
    this.pad = area('arsenal_pad');
    const pr = map.poisOf('arsenal_pad')[0];
    this.padRect = pr ? { x: pr.x * ts, y: pr.y * ts, w: (pr.w ?? 1) * ts, h: (pr.h ?? 1) * ts } : null;
    this.hall = area('arsenal_hall');
    const one = (t: 'arsenal_desk' | 'arsenal_ledger' | 'arsenal_beacon' | 'arsenal_bench') => {
      const p = map.poisOf(t)[0];
      return p ? at(p) : null;
    };
    this.desk = one('arsenal_desk');
    this.ledgerDesk = one('arsenal_ledger');
    this.beacon = one('arsenal_beacon');
    this.bench = one('arsenal_bench');
    for (const p of map.poisOf('arsenal_drop')) this.drops.push(at(p));
    for (const p of map.poisOf('arsenal_rack')) this.racks.push(at(p));
    for (const p of map.poisOf('arsenal_ammo')) this.ammoSlots.push(at(p));
    for (const p of map.poisOf('arsenal_grenades')) this.grenadeSlots.push(at(p));
    for (const p of map.poisOf('arsenal_cot')) this.cots.push(at(p));
    for (const p of map.poisOf('arsenal_bench')) this.benchTiles.push(at(p));
    const cx = this.rect.x + this.rect.w / 2;
    const cy = this.rect.y + this.rect.h / 2;
    for (const p of map.poisOf('arsenal_post')) {
      const q = at(p);
      this.posts.push({ ...q, facing: Math.atan2(q.y - cy, q.x - cx) });
    }
    // Окно выдачи: место в коридоре перед ним (с той стороны, что дальше от стола кладовщика).
    let fx = 0;
    let fy = 0;
    let n = 0;
    for (const p of map.poisOf('arsenal_window')) {
      this.windowTiles.push(at(p));
      let best: Vec2 | null = null;
      let bestD = -1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (map.tileAt(p.x + dx, p.y + dy) !== T.INTERIOR) continue;
        const q = at({ x: p.x + dx, y: p.y + dy });
        const d = this.desk ? Math.hypot(q.x - this.desk.x, q.y - this.desk.y) : 0;
        if (d > bestD) {
          bestD = d;
          best = q;
        }
      }
      if (best) {
        fx += best.x;
        fy += best.y;
        n++;
      }
    }
    this.window = n ? { x: fx / n, y: fy / n } : null;
    // Дверь зал ↔ площадка: двери здания, у которых с одной стороны площадка, с другой — зал.
    const hr = map.poisOf('arsenal_hall')[0];
    const inArea = (r: typeof pr, x: number, y: number) => !!r && x >= r.x && y >= r.y && x < r.x + (r.w ?? 1) && y < r.y + (r.h ?? 1);
    let bx = 0;
    let by = 0;
    let bn = 0;
    let hx = 0;
    let hy = 0;
    for (let y = a.y; y < a.y + (a.h ?? 1); y++) {
      for (let x = a.x; x < a.x + (a.w ?? 1); x++) {
        if (map.tileAt(x, y) !== T.DOOR) continue;
        let pad: Vec2 | null = null;
        let hall: Vec2 | null = null;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (inArea(pr, x + dx, y + dy)) pad = at({ x: x + dx * 2, y: y + dy * 2 });
          if (inArea(hr, x + dx, y + dy)) hall = at({ x: x + dx * 2, y: y + dy * 2 });
        }
        if (pad && hall) {
          bx += pad.x;
          by += pad.y;
          hx += hall.x;
          hy += hall.y;
          bn++;
        }
      }
    }
    const walk = (p: Vec2 | null): Vec2 | null => {
      if (!p) return null;
      const k = ctx.nav.nearestWalkable(p.x, p.y, 3);
      return k >= 0 ? { x: ctx.nav.worldX(k), y: ctx.nav.worldY(k) } : p;
    };
    this.bombSpot = bn ? { x: bx / bn, y: by / bn } : this.pad;
    this.waitSpot = walk(this.bombSpot);
    this.hallSpot = walk(bn ? { x: hx / bn, y: hy / bn } : this.hall);
    this.ledgerSpot = walk(this.ledgerDesk ? { x: this.ledgerDesk.x - ts, y: this.ledgerDesk.y } : null);
    // Верстак у стены — оружейник стоит клеткой ниже.
    this.benchSpot = walk(this.bench ? { x: this.bench.x + ts / 2, y: this.bench.y + ts } : null);
    // Гранатный отсек — всегда заперт.
    for (const p of map.poisOf('arsenal_vault')) {
      const g = ctx.doors.groupAtTile(p.x, p.y);
      if (g) ctx.doors.setLocked(g, true);
    }
  }

  get now(): number {
    return this.time;
  }

  /** Живой кладовщик за столом (или игрок-кладовщик у стола). */
  get quartermaster(): Character | null {
    if (!this.desk) return null;
    for (const o of this.ctx.entities.near(this.desk.x, this.desk.y, ARSENAL.issue.deskReach, near)) {
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

  /** Позиция корабля (для отрисовки): где, высота 0..1, фаза. */
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

  update(dt: number): void {
    if (!this.present) return;
    this.time += dt;
    const { ctx } = this;
    const F = ARSENAL.flight;
    const s = this.ship;
    // Срочный рейс: патронов почти нет.
    if (!this.emergency && this.stock.ammo < ARSENAL.emergency.below && s.phase === 'none' && this.nextFlight - this.time > ARSENAL.emergency.delay) {
      this.emergency = true;
      this.nextFlight = this.time + ARSENAL.emergency.delay;
      ctx.law.log(`Склад Альянса: патроны на исходе — Цитадель высылает срочный борт (через ${ARSENAL.emergency.delay} с).`, 'radio');
    }
    if (s.phase === 'none' && this.time >= this.nextFlight) {
      if (ctx.war.code === 'red') {
        // Штурм Нексуса: небо закрыто.
        this.nextFlight = this.time + 20;
        if (!this.redLogged) ctx.law.log('Склад Альянса: красный код — рейсы из Цитадели отменены.', 'radio');
        this.redLogged = true;
      } else {
        this.redLogged = false;
        this.startFlight();
      }
    }
    if (s.phase !== 'none') {
      s.t += dt;
      if (s.phase === 'arrive' && s.t >= F.arrive) {
        s.t = 0;
        if (this.beaconBroken) {
          // Маяк сломан — сесть негде: борт уходит, рейс сорван.
          s.aborted = true;
          s.phase = 'leave';
          this.stats.aborted++;
          ctx.law.log('Склад Альянса: маяк площадки не отвечает — борт ушёл без разгрузки. Рейс сорван.', 'radio');
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
        this.emergency = false;
      }
    }
    // Носильщики, которые бросили ящик (погибли, упали, ушли с работы), — ящик остаётся, где был.
    for (const c of [...this.carried.keys()]) if (!c.fit || !c.carrying) this.abandon(c, null);
    this.updateBomb(dt);
    this.updateInspection(dt);
  }

  /** Инспектор SU.INSP у стола описи inspect.check с — сверка (не чаще inspect.every). */
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

  /** Контейнер: ящики по накладной — на места площадки; погруженное для КПП — на борт. */
  private dropContainer(): void {
    const { ctx } = this;
    const out = this.crates.filter((c) => c.dir === 'out');
    if (out.length) this.deliverToFronts(out);
    for (let i = this.crates.length - 1; i >= 0; i--) if (this.crates[i].dir === 'out') this.crates.splice(i, 1);
    const M = this.manifest();
    let slot = 0;
    for (const kind of KINDS) {
      for (let k = 0; k < M[kind]; k++) {
        const d = this.drops[slot++ % Math.max(1, this.drops.length)] ?? this.pad!;
        const stack = Math.floor(slot / Math.max(1, this.drops.length));
        this.crates.push({ id: this.nextId++, kind, x: d.x + ctx.rng.range(-3, 3), y: d.y - stack * 4 + ctx.rng.range(-2, 2), dir: 'in', tainted: false, carrier: null });
      }
      // По накладной — в опись сразу.
      this.ledger[kind] += M[kind];
    }
    this.stats.delivered++;
    // Сколько ящиков погрузить для КПП к следующему рейсу: не больше доли полной поставки.
    const total = ARSENAL.manifest.ammo + ARSENAL.manifest.grenades + ARSENAL.manifest.weapons;
    this.outQuota = Math.min(ARSENAL.kpp.perFlight, Math.floor(total * ARSENAL.kpp.share));
  }

  /** Накладная: полная поставка, но запасы (с ящиками на площадке) не выше max. */
  manifest(): Stock {
    const out = { ...ARSENAL.manifest } as Stock;
    for (const k of KINDS) {
      const pad = this.crates.filter((c) => c.dir === 'in' && c.kind === k).length;
      out[k] = Math.max(0, Math.min(out[k], ARSENAL.max[k] - this.stock[k] - pad));
    }
    return out;
  }

  /** Ящики для КПП — гарнизонам (часовые SU, медики, OTA на постах): патроны и гранаты. */
  private deliverToFronts(out: Crate[]): void {
    const { ctx } = this;
    const fronts = ctx.war.fronts;
    if (!fronts.length) return;
    const K = ARSENAL.kpp;
    let k = 0;
    for (const crate of out) {
      const f = fronts[k++ % fronts.length];
      const garrison = ctx.entities.list.filter((c) => {
        const b = c.brain as { front?: number } | null;
        return c.fit && (c.faction === 'cp' || c.faction === 'ota') && b?.front === f.index;
      });
      for (const c of garrison.slice(0, 4)) {
        if (crate.kind === 'ammo') ctx.economy.refillAmmo(c, K.mags);
        else if (crate.kind === 'grenades') c.inventory.add('grenade', K.grenades);
        if (crate.kind === 'ammo') c.badAmmo = crate.tainted;
      }
      this.stats.kppCrates++;
    }
    ctx.law.log(`Борт сбросил гарнизонам КПП ящиков: ${out.length}.`, 'radio');
  }

  // ————— Работа ГСР —————

  /** Что делать грузчику сейчас (null — нечего). */
  loaderTask(c: Character): HaulTask | null {
    if (!this.present) return null;
    if (this.beaconBroken) return { type: 'beacon' };
    let best: Crate | null = null;
    let bestD = Infinity;
    for (const cr of this.crates) {
      if (cr.dir !== 'in' || cr.carrier) continue;
      const d = Math.hypot(cr.x - c.x, cr.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = cr;
      }
    }
    if (best) {
      best.carrier = c;
      return { type: 'in', crate: best };
    }
    const kind = this.outKind();
    if (kind) {
      this.outQuota--;
      return { type: 'out', kind };
    }
    return null;
  }

  /** Что грузить для КПП: патроны, если в запасе хватает городу, иначе гранаты; нечего — null. */
  private outKind(): CrateKind | null {
    if (this.outQuota <= 0) return null;
    const reserve = ARSENAL.emergency.below + 2;
    if (this.stock.ammo > reserve) return 'ammo';
    if (this.stock.grenades > 4) return 'grenades';
    return null;
  }

  /** Взять ящик: с площадки (in) или из зала для КПП (out). false — нечего взять. */
  pickUp(c: Character, task: HaulTask): boolean {
    if (task.type === 'in') {
      const i = this.crates.indexOf(task.crate);
      if (i < 0) return false;
      this.crates.splice(i, 1);
      task.crate.carrier = c;
      this.carried.set(c, task.crate);
      c.carrying = true;
      return true;
    }
    if (task.type === 'out') {
      if (this.stock[task.kind] <= 0) return false;
      this.stock[task.kind]--;
      this.ledger[task.kind]--;
      let tainted = false;
      if (task.kind === 'ammo' && this.tainted > 0 && this.ctx.rng.chance(this.tainted / (this.stock.ammo + 1))) {
        this.tainted--;
        tainted = true;
      }
      const crate: Crate = { id: this.nextId++, kind: task.kind, x: c.x, y: c.y, dir: 'out', tainted, carrier: c };
      this.carried.set(c, crate);
      c.carrying = true;
      return true;
    }
    return false;
  }

  /** Поставить ящик: в зал (приход в запасы) или на площадку (ждёт борт). Платят за ящик. */
  putDown(c: Character): boolean {
    const crate = this.carried.get(c);
    if (!crate) return false;
    this.carried.delete(c);
    c.carrying = false;
    crate.carrier = null;
    const W = ARSENAL.work;
    if (crate.dir === 'in') {
      this.stock[crate.kind]++;
      if (crate.tainted) this.tainted++;
      this.stats.hauled++;
      c.money += W.payIn;
    } else {
      const d = this.freeDrop() ?? this.pad!;
      crate.x = d.x + this.ctx.rng.range(-3, 3);
      crate.y = d.y + this.ctx.rng.range(-3, 3);
      this.crates.push(crate);
      this.stats.loaded++;
      c.money += W.payOut;
    }
    this.ctx.economy.markWorked(c);
    adjustLoyalty(c, LOYALTY.points.cwuWork * 0.25, 'работа на складе', c.isPlayer ? this.ctx.bus : undefined);
    return true;
  }

  /**
   * Работа брошена (не дошёл, отвлёкся): несомый ящик с площадки остаётся на земле, для КПП —
   * возвращается в запасы; бронь ящика и места в погрузке снимается.
   */
  abandon(c: Character, task: HaulTask | null): void {
    const crate = this.carried.get(c);
    if (crate) {
      this.carried.delete(c);
      c.carrying = false;
      crate.carrier = null;
      if (crate.dir === 'in') {
        crate.x = c.x;
        crate.y = c.y;
        this.crates.push(crate);
      } else {
        this.stock[crate.kind]++;
        this.ledger[crate.kind]++;
        if (crate.tainted) this.tainted++;
        this.outQuota++;
      }
      return;
    }
    if (task?.type === 'in' && task.crate.carrier === c) task.crate.carrier = null;
    if (task?.type === 'out') this.outQuota++;
  }

  /** Взять из зала ящик для КПП (в пределах погрузки). null — грузить нечего. */
  loadOut(c: Character): CrateKind | null {
    const kind = this.outKind();
    if (!kind) return null;
    this.outQuota--;
    if (this.pickUp(c, { type: 'out', kind })) return kind;
    this.outQuota++;
    return null;
  }

  /** Ящик с площадки рядом с точкой (не занятый). */
  crateNear(x: number, y: number, r: number, pred: (c: Crate) => boolean = () => true): Crate | null {
    let best: Crate | null = null;
    let bestD = r;
    for (const c of this.crates) {
      if (c.carrier || !pred(c)) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** На площадке ли точка. */
  onPad(x: number, y: number): boolean {
    const r = this.padRect;
    return !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  /** Где поставить ящик для КПП (свободное место площадки). */
  loadSpot(): Vec2 | null {
    return this.freeDrop() ?? this.pad;
  }

  /** Кто что несёт (для отрисовки). */
  get carriedCrates(): ReadonlyMap<Character, Crate> {
    return this.carried;
  }

  /** Несёт ли ящик (и куда он). */
  cargo(c: Character): Crate | null {
    return this.carried.get(c) ?? null;
  }

  private freeDrop(): Vec2 | null {
    let best: Vec2 | null = null;
    let bestN = Infinity;
    for (const d of this.drops) {
      const n = this.crates.filter((cr) => Math.hypot(cr.x - d.x, cr.y - d.y) < 10).length;
      if (n < bestN) {
        bestN = n;
        best = d;
      }
    }
    return best;
  }

  /** Починка маяка (грузчик у маяка): true — готово. */
  repairBeacon(c: Character, dt: number): boolean {
    if (!this.beaconBroken) return true;
    this.beaconProgress += dt;
    if (this.beaconProgress < ARSENAL.beacon.repair) return false;
    this.beaconBroken = false;
    this.beaconProgress = 0;
    this.stats.repaired++;
    c.money += ARSENAL.work.payIn * 2;
    this.ctx.law.log(`${c.name} (ГСР) починил маяк площадки склада.`, 'world');
    return true;
  }

  /**
   * Оружейник за верстаком: раз в armorer.every с — ствол вычищен и починен (+1 к запасным, пока их
   * меньше max.weapons); с шансом находит порченый ящик патронов — брак списан. true — итог.
   */
  benchWork(c: Character, dt: number): boolean {
    const A = ARSENAL.armorer;
    const acc = (this.benchAcc.get(c) ?? 0) + dt;
    if (acc < A.every) {
      this.benchAcc.set(c, acc);
      return false;
    }
    this.benchAcc.set(c, 0);
    if (this.stock.weapons < ARSENAL.max.weapons) {
      this.stock.weapons++;
      this.ledger.weapons++;
    }
    c.money += A.pay;
    this.ctx.economy.markWorked(c);
    if (this.tainted > 0 && this.stock.ammo > 0 && this.ctx.rng.chance(A.findTaint)) {
      this.tainted--;
      this.stock.ammo--;
      this.ledger.ammo--;
      this.stats.caught++;
      this.ctx.law.log(`Оружейник ${c.name}: в ящике патронов брак — партия списана.`, 'radio');
    }
    return true;
  }

  // ————— Выдача ГО —————

  /** Взять боекомплект (один ящик — на perCrate.ammo бойцов). null — пусто, иначе порченый ли. */
  private takeAmmoKit(): boolean | null {
    if (this.openAmmo <= 0) {
      if (this.stock.ammo <= 0) return null;
      this.stock.ammo--;
      this.ledger.ammo--;
      this.openTainted = this.tainted > 0 && this.ctx.rng.chance(this.tainted / (this.stock.ammo + 1));
      if (this.openTainted) this.tainted--;
      this.openAmmo = ARSENAL.perCrate.ammo;
    }
    this.openAmmo--;
    return this.openTainted;
  }

  /** Взять до n гранат (ящик — perCrate.grenades штук). Сколько дали. */
  private takeGrenades(n: number): number {
    let got = 0;
    while (got < n) {
      if (this.openGrenades <= 0) {
        if (this.stock.grenades <= 0) break;
        this.stock.grenades--;
        this.ledger.grenades--;
        this.openGrenades = ARSENAL.perCrate.grenades;
      }
      this.openGrenades--;
      got++;
    }
    return got;
  }

  /** Есть ли что выдать (патроны или гранаты — в запасе или в открытом ящике). */
  get hasAmmo(): boolean {
    return this.stock.ammo > 0 || this.openAmmo > 0;
  }

  /**
   * Выдать боекомплект у окна (issue.mags магазинов на каждый ствол, гранаты — до набора юнита, но не
   * больше issue.grenades; потерянное табельное оружие — из запасных). Порченый ящик — у бойца осечки.
   * Возвращает причину отказа или null (выдано).
   */
  issue(c: Character): string | null {
    if (!this.present || !this.window) return 'склада нет';
    if (this.closed) return this.ctx.rng.pick(ARSENAL.lines.closed);
    const qm = this.quartermaster;
    if (!qm) return 'Кладовщика нет на месте.';
    const I = ARSENAL.issue;
    let got = false;
    // Табельное оружие — если потерял.
    const kit = c.faction === 'cp' ? KITS[cpKit(c.rank)] ?? [] : [];
    for (const [id] of kit) {
      if (ITEMS[id].kind === 'weapon' && !c.inventory.has(id) && this.stock.weapons > 0) {
        c.inventory.add(id, 1);
        this.stock.weapons--;
        this.ledger.weapons--;
        got = true;
      }
    }
    const bad = this.takeAmmoKit();
    if (bad !== null) {
      this.ctx.economy.refillAmmo(c, I.mags);
      c.badAmmo = bad;
      got = true;
    }
    const wantG = Math.min(kit.find(([id]) => id === 'grenade')?.[1] ?? 0, I.grenades) - c.inventory.count('grenade');
    if (wantG > 0) {
      const n = this.takeGrenades(wantG);
      if (n > 0) {
        c.inventory.add('grenade', n);
        got = true;
      }
    }
    if (!got) return this.ctx.rng.pick(ARSENAL.lines.empty);
    this.stats.issued++;
    qm.say(this.ctx.rng.pick(ARSENAL.lines.qm), this.ctx.law.now, 2);
    return null;
  }

  /** Нужно ли бойцу ГО пополниться: у основного ствола меньше issue.lowMags магазинов в запасе. */
  needsAmmo(c: Character): boolean {
    if (!this.present || this.closed || !this.hasAmmo) return false;
    const w = primaryGun(this.ctx, c);
    if (!w) return false;
    const def = WEAPONS[w];
    return !!def.ammo && c.inventory.count(AMMO_ITEM[def.ammo]) < def.magazine * ARSENAL.issue.lowMags;
  }

  /**
   * Возрождённый ГО города получает набор со склада: боекомплект и гранаты по набору. Пусто — только
   * respawn.poorMags магазинов и без гранат. Гарнизоны КПП (часовые, медики, RCT проходной) и OTA
   * снаряжает сама Цитадель — их снабжают ящики, которые забирает борт.
   */
  kitOnRespawn(c: Character): void {
    if (!this.present || c.faction !== 'cp' || (c.role?.front ?? -1) >= 0) return;
    const bad = this.takeAmmoKit();
    if (bad !== null) c.badAmmo = bad;
    else {
      // Пустой склад: патронов — по минимуму.
      this.stats.poorKits++;
      for (const id of this.ctx.combat.weaponsOf(c)) {
        const w = WEAPONS[id];
        if (!w.ammo) continue;
        const item = AMMO_ITEM[w.ammo];
        const extra = c.inventory.count(item) - w.magazine * ARSENAL.respawn.poorMags;
        if (extra > 0) c.inventory.remove(item, extra);
      }
    }
    const g = c.inventory.count('grenade');
    if (g > 0) {
      const n = this.takeGrenades(g);
      if (g > n) c.inventory.remove('grenade', g - n);
    }
  }

  // ————— Инспекция —————

  /** Инспектор сверяет опись с запасами. Недостача — тревога, выдача закрыта, опись списана. */
  inspect(by: Character): number {
    const { ctx } = this;
    this.stats.inspections++;
    this.lastInspection = this.time;
    let short = 0;
    for (const k of KINDS) short += Math.max(0, this.ledger[k] - this.stock[k]);
    if (short > 0) {
      this.stats.shortages++;
      this.lockdownUntil = this.time + ARSENAL.inspect.lockdown;
      ctx.law.log(`${by.name}: недостача на складе Альянса — ${short} ящ. Выдача закрыта, склад под проверкой!`, 'radio');
      if (this.hall) ctx.war.raiseAlarm(this.hall.x, this.hall.y, 'недостача на складе Альянса', false);
      by.say('Недостача! Кто подписывал накладные?', ctx.law.now, 3);
    } else {
      ctx.law.log(`${by.name} проверил опись склада Альянса: всё сходится.`, 'radio');
      by.say('Опись сходится. Продолжайте.', ctx.law.now, 2.5);
    }
    for (const k of KINDS) this.ledger[k] = this.stock[k];
    return short;
  }

  // ————— Диверсии —————

  /** Кража: ящик с площадки (не записан как выданный) или из зала. true — унёс. */
  steal(by: Character): CrateKind | null {
    let kind: CrateKind | null = null;
    const i = this.crates.findIndex((cr) => cr.dir === 'in' && !cr.carrier && Math.hypot(cr.x - by.x, cr.y - by.y) < 60);
    if (i >= 0) {
      kind = this.crates[i].kind;
      this.crates.splice(i, 1);
    } else if (this.hall && Math.hypot(this.hall.x - by.x, this.hall.y - by.y) < 90) {
      kind = this.stock.ammo > 0 ? 'ammo' : this.stock.grenades > 0 ? 'grenades' : this.stock.weapons > 0 ? 'weapons' : null;
      if (kind) this.stock[kind]--;
    }
    if (!kind) return null;
    this.stats.stolen++;
    return kind;
  }

  /** Подмешать брак в ящик патронов на площадке (ещё не в зале). */
  taint(by: Character): boolean {
    const cr = this.crates.find((c) => c.dir === 'in' && c.kind === 'ammo' && !c.tainted && !c.carrier && Math.hypot(c.x - by.x, c.y - by.y) < 60);
    if (!cr) return false;
    cr.tainted = true;
    this.stats.tainted++;
    return true;
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
    for (const k of KINDS) {
      const lost = Math.round(this.stock[k] * B.destroy);
      this.stock[k] -= lost;
      this.ledger[k] = Math.max(0, this.ledger[k] - lost);
    }
    this.tainted = Math.min(this.tainted, this.stock.ammo);
    ctx.law.log('Взрыв на складе Альянса! Часть запасов уничтожена, пожар.', 'radio');
    ctx.war.raiseAlarm(b.x, b.y, 'взрыв на складе Альянса', false);
  }

  /** Спецагент в форме Альянса «по наряду»: гранаты у окна (кладовщик записывает — это не кража). */
  requisition(by: Character): number {
    if (this.closed || !this.quartermaster) return 0;
    const n = this.takeGrenades(ARSENAL.requisition.grenades);
    if (n > 0) by.inventory.add('grenade', n);
    return n;
  }

  /** Что подпольщику сделать на складе (доли ARSENAL.ops; невозможное не выбирается) и где. */
  pickSabotage(by: Character): { act: DepotAct; spot: Vec2 } | null {
    if (!this.present) return null;
    const O = ARSENAL.ops;
    const padAmmo = this.crates.find((c) => c.dir === 'in' && c.kind === 'ammo' && !c.tainted && !c.carrier);
    const padAny = this.crates.find((c) => c.dir === 'in' && !c.carrier);
    const opts: [DepotAct, number, Vec2 | null][] = [
      ['steal', O.steal, padAny ? { x: padAny.x, y: padAny.y } : this.stock.ammo + this.stock.grenades > 0 ? this.hallSpot : null],
      ['taint', O.taint, padAmmo ? { x: padAmmo.x, y: padAmmo.y } : null],
      ['bomb', by.inventory.has('grenade') && !this.bomb ? O.bomb : 0, this.bombSpot],
      ['beacon', this.beaconBroken ? 0 : O.beacon, this.beacon],
    ];
    const ok = opts.filter(([, w, p]) => w > 0 && p);
    let r = this.ctx.rng.next() * ok.reduce((n, [, w]) => n + w, 0);
    for (const [act, w, p] of ok) if ((r -= w) <= 0) return { act, spot: p! };
    return null;
  }

  /** Сколько возиться с делом на складе, с. */
  sabotageTime(act: DepotAct): number {
    return act === 'steal' ? ARSENAL.steal.time : act === 'bomb' ? ARSENAL.bomb.plant : act === 'taint' ? ARSENAL.tamper.taint : ARSENAL.tamper.beacon;
  }

  /**
   * Сделать дело на складе. Охрана, видящая подпольщика за делом, с шансом ops.caught его
   * раскрывает (тревога). Кража: ящик — подпольщику (патроны к стволам, гранаты, ствол). true — сделано.
   */
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

  /** Видит ли охрана (или кладовщик) персонажа у точки (для диверсий под личиной не важно). */
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
  if (c.weapon && c.weapon !== 'stunstick' && WEAPONS[c.weapon].ammo) return c.weapon;
  return ctx.combat.weaponsOf(c).find((id) => !!WEAPONS[id].ammo) ?? null;
}
