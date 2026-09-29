import type { Character } from '../entities/Character';
import type { EntityManager } from '../entities/EntityManager';
import type { GameMap } from '../world/GameMap';
import type { NavGrid } from '../world/NavGrid';
import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/rng';
import type { DoorSystem, DoorGroup } from './DoorSystem';
import { canSeeCircle } from '../world/visibility';
import { adjustLoyalty } from './Loyalty';
import { LOYALTY } from '../config/loyalty';
import { LAW, VIOLATION_NAMES, type Violation } from '../config/law';
import { VISION } from '../config/vision';
import { loyalistPerk } from './Loyalty';
import { FACTIONS, cpHas } from '../config/factions';
import { LINES, fill } from '../config/lines';
import { T } from '../world/tiles';
import { apparentFaction, coverAuthority } from '../entities/cover';
import { PrisonerBrain } from '../ai/brains/PrisonerBrain';
import { CHARACTER } from '../config/entities';
import { PARTISANS } from '../config/underground';

const PRISONER_MASS = 0.4;

export interface Verdict {
  kind: 'ok' | 'fine' | 'arrest';
  reason: Violation;
  fine: number;
}

export interface Cell {
  index: number;
  /** Центр камеры, px мира. */
  x: number;
  y: number;
  /** Точка в коридоре перед дверью, px мира. */
  frontX: number;
  frontY: number;
  door: DoorGroup | null;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Общая камера (много мест) — для граждан и партизан. */
  common: boolean;
  /** Места: у одиночной — одно в центре, у общей — по площади. */
  slots: CellSlot[];
  /** Клетка в кабинете Администратора (без двери): для пойманных партизан — допрос CMD.EPU. */
  cage: boolean;
  /** Дверь выбита спецагентом: до этого времени не запирается. */
  brokenUntil: number;
}

export interface CellSlot {
  x: number;
  y: number;
  occupant: Character | null;
  reserved: Character | null;
}

/** Партизан или спецагент — их сажают в клетки у Администратора на допрос. */
export function isUnderground(c: Character): boolean {
  return c.faction === 'rebel' && (c.profession === 'partisan' || c.profession === 'spec_agent');
}

/** Кого сажают в общую камеру: граждан, ГСР и вортигонтов (не бойцов армии). */
function belongsInCommon(c: Character): boolean {
  return c.faction === 'citizen' || c.faction === 'cwu' || c.faction === 'vort';
}

/**
 * Закон Сити-17: кто что нарушил на глазах у ГО, приказы «стоять», проверка CID, штрафы,
 * аресты, камеры КПЗ и сроки. Решения за NPC (побежит ли) принимаются здесь.
 * Мозги ГО (CpBrain) решают, КОГДА вмешаться; эта система — ЧТО из этого следует.
 */
export class LawSystem {
  readonly cells: Cell[] = [];
  private time = 0;

  constructor(
    private readonly map: GameMap,
    private readonly nav: NavGrid,
    private readonly doors: DoorSystem,
    private readonly entities: EntityManager,
    private readonly bus: EventBus,
    private readonly rng: Rng,
  ) {
    this.buildCells();
  }

  get now(): number {
    return this.time;
  }

  private buildCells(): void {
    const map = this.map;
    const ts = map.tileSize;
    const pois = [...map.poisOf('cell').map((p) => ({ p, common: false })), ...map.poisOf('common_cell').map((p) => ({ p, common: true }))];
    pois.forEach(({ p: poi, common }, index) => {
      // Камера — связная область пола в зоне КПЗ вокруг точки.
      const zone = map.zoneAtTile(poi.x, poi.y);
      let x0 = poi.x, y0 = poi.y, x1 = poi.x, y1 = poi.y;
      const seen = new Set<number>([poi.y * map.width + poi.x]);
      const stack = [[poi.x, poi.y]];
      while (stack.length) {
        const [x, y] = stack.pop()!;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const k = ny * map.width + nx;
          if (seen.has(k) || map.tileAt(nx, ny) !== T.INTERIOR || map.zoneAtTile(nx, ny) !== zone) continue;
          seen.add(k);
          stack.push([nx, ny]);
        }
      }
      let door: DoorGroup | null = null;
      for (let y = y0 - 1; y <= y1 + 1 && !door; y++) {
        for (let x = x0 - 1; x <= x1 + 1 && !door; x++) door = this.doors.groupAtTile(x, y);
      }
      const cx = ((x0 + x1 + 1) / 2) * ts;
      const cy = ((y0 + y1 + 1) / 2) * ts;
      let fx = cx;
      let fy = cy;
      if (door) {
        const dx = door.x - cx;
        const dy = door.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        fx = door.x + (dx / d) * 36;
        fy = door.y + (dy / d) * 36;
      }
      const slots: CellSlot[] = [];
      if (common) {
        // Места — центры якорей внутри камеры, не ближе spacing друг к другу и не у самой двери.
        const C = LAW.commonCell;
        const nav = this.nav;
        for (let ay = y0; ay < y1 && slots.length < C.max; ay++) {
          for (let ax = x0; ax < x1 && slots.length < C.max; ax++) {
            if (!nav.isWalkable(ax, ay)) continue;
            const x = (ax + 1) * ts;
            const y = (ay + 1) * ts;
            if (door && Math.hypot(door.x - x, door.y - y) < C.spacing * 1.5) continue;
            if (slots.some((s) => Math.hypot(s.x - x, s.y - y) < C.spacing)) continue;
            slots.push({ x, y, occupant: null, reserved: null });
          }
        }
      }
      if (!slots.length) slots.push({ x: cx, y: cy, occupant: null, reserved: null });
      this.cells.push({ index, x: cx, y: cy, frontX: fx, frontY: fy, door, bounds: { x0, y0, x1, y1 }, common, slots, cage: false, brokenUntil: 0 });
    });
    // Клетки в кабинете Администратора (POI partisan_cage — якорь 2×2): без двери, одно место,
    // перед клеткой — место допрашивающего.
    for (const p of map.poisOf('partisan_cage')) {
      // Нексус может быть повёрнут — якорь клетки ищем у тайла Z (он в любом случае внутри).
      const a = this.nav.nearestWalkable((p.x + 0.5) * ts, (p.y + 0.5) * ts, 1);
      if (a < 0) continue;
      const cx = this.nav.worldX(a);
      const cy = this.nav.worldY(a);
      const ax = this.nav.ax(a);
      const ay = this.nav.ay(a);
      const f = this.nav.nearestWalkable(cx, cy + LAW.cageFront, 3);
      const fx = f >= 0 ? this.nav.worldX(f) : cx;
      const fy = f >= 0 ? this.nav.worldY(f) : cy;
      this.cells.push({
        index: this.cells.length, x: cx, y: cy, frontX: fx, frontY: fy, door: null,
        bounds: { x0: ax, y0: ay, x1: ax + 1, y1: ay + 1 }, common: false,
        slots: [{ x: cx, y: cy, occupant: null, reserved: null }], cage: true, brokenUntil: 0,
      });
    }
  }

  /** Может ли observer увидеть target: дальность, угол обзора, стены и закрытые двери. */
  canSee(observer: Character, target: Character): boolean {
    const dx = target.x - observer.x;
    const dy = target.y - observer.y;
    const d = Math.hypot(dx, dy);
    if (d > VISION.npcRange) return false;
    if (d > VISION.npcCloseAwareness) {
      let a = Math.atan2(dy, dx) - observer.facing;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      if (Math.abs(a) > ((VISION.npcFovDeg / 2) * Math.PI) / 180) return false;
    }
    return canSeeCircle(this.map, observer.x, observer.y, target.x, target.y, target.radius);
  }

  /** Задаёт Game: нарушает ли персонаж комендантский час (красный код, на улице). */
  curfewCheck: (c: Character) => boolean = () => false;
  /** Задаёт Game: паникует ли персонаж (бег от стрельбы — не нарушение). */
  panicking: (c: Character) => boolean = () => false;

  /** Нарушение, которое observer видит прямо сейчас, или null. */
  observe(observer: Character, target: Character): Violation | null {
    // Лежащего тяжелораненого не «замечают» как нарушителя: его задерживают отдельно (ai/Tactics).
    if (FACTIONS[target.faction].authority || target.law.phase !== 'none' || !target.alive || target.downed) return null;
    // Переодетый в сотрудника Альянса — «свой».
    if (coverAuthority(target)) return null;
    // Вортигонтов-рабов Альянс не проверяет.
    if (target.faction === 'vort') return null;
    if (!this.canSee(observer, target)) return null;
    // Повстанца узнают сразу (форма), вооружённого — тоже; партизана в маскировке — нет.
    if (target.faction === 'rebel' && !target.disguised) return 'rebel';
    // Только что украл — на глазах у ГО.
    if ((target.law.crimeUntil ?? -1) > this.time) return 'theft';
    if ((target.law.riotUntil ?? -1) > this.time) return 'riot';
    if (target.weapon) return 'weapon';
    const zk = this.map.zoneAtWorld(target.x, target.y)?.kind;
    if (zk === 'restricted') return 'restricted';
    // На склад Альянса посторонним нельзя (рабочие ГСР — по работе).
    if (zk === 'arsenal' && apparentFaction(target) === 'citizen') return 'restricted';
    if (this.curfewCheck(target)) return 'curfew';
    // Лоялистам бегать разрешено.
    if (target.moveSpeed > LAW.runSpeed && !this.panicking(target) && !loyalistPerk(target, 'run')) return 'running';
    return null;
  }

  /** Можно ли сейчас устроить плановую проверку. */
  checkable(target: Character): boolean {
    return (
      !FACTIONS[target.faction].authority && !coverAuthority(target) && target.faction !== 'vort' && target.law.phase === 'none' && target.alive && !target.downed &&
      this.time - target.law.lastCheck > LAW.recheckCooldown
    );
  }

  /** ГО приказывает стоять. NPC может решить бежать. */
  order(handler: Character, target: Character, reason: Violation): void {
    const law = target.law;
    law.phase = 'ordered';
    law.handler = handler;
    law.reason = reason;
    law.orderX = target.x;
    law.orderY = target.y;
    law.since = this.time;
    const lines =
      reason === 'running' ? LINES.cpOrderRun
      : reason === 'restricted' ? LINES.cpOrderRestricted
      : reason === 'curfew' ? LINES.cpOrderCurfew
      : reason === 'insult' ? LINES.cpOrderInsult
      : reason === 'rebel' || reason === 'weapon' ? LINES.cpOrderRebel
      : LINES.cpOrder;
    handler.say(this.rng.pick(lines), this.time);
    if (!target.isPlayer) {
      // Подпольщик под личиной не бежит: бег выдал бы его. Лоялист (не в розыске) — тоже: ему незачем.
      const loyal = target.faction === 'citizen' && target.loyalty >= LOYALTY.uniform.min && !law.wanted;
      const flee = target.disguised || loyal ? 0 : LAW.npc.fleeChance[target.profession ?? ''] ?? LAW.npc.fleeChance[target.faction] ?? 0.1;
      // Под личиной — поддельная CID: «без документов» он не бежит.
      const guilty = !loyal && !target.disguised && (law.wanted || !law.hasCid);
      if (this.rng.chance(guilty ? Math.max(flee, 0.5) : flee)) this.startFlee(target);
      else target.say(this.rng.pick(LINES.comply), this.time, 2);
    }
  }

  startFlee(target: Character): void {
    const law = target.law;
    law.phase = 'fleeing';
    law.reason = 'resisting';
    law.since = this.time;
    target.say(this.rng.pick(LINES.flee), this.time, 2);
    if (law.handler) {
      law.handler.say(this.rng.pick(LINES.cpChase), this.time);
      this.log(`${label(law.handler)}: убегает ${who(target, true).toLowerCase()}`, 'radio');
    }
  }

  /** Начать проверку (ГО рядом). */
  beginCheck(handler: Character, target: Character): void {
    const law = target.law;
    law.phase = 'checking';
    law.handler = handler;
    law.since = this.time;
    law.lastCheck = this.time;
    if (!law.reason) law.reason = 'routine';
  }

  /** Решение по результатам проверки CID. */
  judge(target: Character): Verdict {
    const law = target.law;
    let reason: Violation = law.reason ?? 'routine';
    // Подпольщик под личиной показывает поддельную CID: раскрывают с шансом (в розыске — всегда).
    const fake = target.faction === 'rebel' && target.disguised && !law.wanted && !this.rng.chance(PARTISANS.checkReveal);
    if (target.faction === 'rebel' && !fake) {
      target.disguised = false;
      target.cover = null;
      reason = 'rebel';
    } else if ((target.law.crimeUntil ?? -1) > this.time) reason = 'theft';
    else if ((target.law.riotUntil ?? -1) > this.time) reason = 'riot';
    else if (law.wanted && !LAW.arrestFor.includes(reason)) reason = 'wanted';
    else if (!law.hasCid && !fake) reason = 'no_cid';
    if (LAW.arrestFor.includes(reason)) return { kind: 'arrest', reason, fine: 0 };
    if (reason === 'running' || reason === 'restricted' || reason === 'insult') {
      return { kind: 'fine', reason, fine: LAW.fines[reason] };
    }
    return { kind: 'ok', reason, fine: 0 };
  }

  apply(handler: Character, target: Character, verdict: Verdict): void {
    if (verdict.kind === 'arrest') {
      this.arrest(handler, target, verdict.reason);
      return;
    }
    if (verdict.kind === 'fine') {
      if (cpHas(handler, 'investigate')) verdict = { ...verdict, fine: verdict.fine * LAW.juryFineMul };
      const paid = Math.min(target.money, verdict.fine);
      target.money -= paid;
      handler.money += Math.floor(paid / 2);
      handler.say(fill(this.rng.pick(LINES.cpFine), { n: verdict.fine }), this.time);
      adjustLoyalty(target, verdict.reason === 'insult' ? LOYALTY.points.insult : LOYALTY.points.fine, 'штраф', this.bus);
      this.log(`${label(handler)} оштрафовал ${who(target)} на ${verdict.fine} токенов (${VIOLATION_NAMES[verdict.reason]})`, 'law');
    } else {
      handler.say(this.rng.pick(LINES.cpOk), this.time);
      adjustLoyalty(target, LOYALTY.points.checkOk, 'проверка пройдена', this.bus);
    }
    this.clear(target);
  }

  /** Снять разбирательство (отпустили или ГО отвлёкся). */
  clear(target: Character): void {
    const law = target.law;
    const wasPlayerCheck = law.handler?.isPlayer;
    // Сняли процедуру с задержанного (конвоир погиб, ГО отвлёкся) — прежний мозг назад, бронь места в
    // камере — снять (иначе «пленник» без процедуры стоит вечно).
    const freed = target.brain instanceof PrisonerBrain && !!law.savedBrain;
    const wasReleasing = law.phase === 'releasing';
    if (freed) {
      if (law.phase === 'cuffed' || law.phase === 'entering') this.vacate(target);
      this.restoreBrain(target);
    }
    law.phase = 'none';
    if (freed && wasReleasing) this.onReleased?.(target);
    law.handler = null;
    law.reason = null;
    if (wasPlayerCheck) this.bus.emit('law:checkClosed', { target });
  }

  /** ГО потерял беглеца — тот в розыске. */
  lost(target: Character): void {
    const handler = target.law.handler;
    target.law.wanted = true;
    if (handler) {
      handler.say(this.rng.pick(LINES.cpLost), this.time);
      this.log(`${label(handler)}: потерял ${who(target)}, объявлен в розыск`, 'radio');
    }
    this.clear(target);
  }

  /** Отсидевшего отпустили (мозг уже прежний) — подполье даёт ему документы и уводит в схрон. */
  onReleased: ((c: Character) => void) | null = null;

  arrest(handler: Character, target: Character, reason: Violation): void {
    const law = target.law;
    if (law.phase === 'cuffed' || law.phase === 'entering' || law.phase === 'jailed') return;
    const wasPlayerCheck = law.handler?.isPlayer && law.phase === 'checking';
    law.phase = 'cuffed';
    law.handler = handler;
    law.reason = reason;
    law.since = this.time;
    // Взяли снова, пока ещё выводят (мозг — пленника): прежний настоящий мозг не терять.
    if (!(target.brain instanceof PrisonerBrain)) law.savedBrain = target.brain;
    target.brain = new PrisonerBrain(target);
    // Задержанный повстанец больше не под личиной.
    if (target.faction === 'rebel') {
      target.disguised = false;
      target.cover = null;
    }
    // В наручниках не упирается: конвоир и прохожие легко отталкивают.
    target.mass = PRISONER_MASS;
    target.wantX = target.wantY = 0;
    handler.say(this.rng.pick(LINES.cpArrest), this.time);
    adjustLoyalty(target, LOYALTY.points.arrest, 'задержание', this.bus);
    this.log(`${label(handler)} задержал ${who(target)} (${VIOLATION_NAMES[reason]})`, 'law');
    if (wasPlayerCheck) this.bus.emit('law:checkClosed', { target });
  }

  /** Свободное место (не занято и не зарезервировано) в камере или -1. */
  private freeSlot(cell: Cell): number {
    return cell.slots.findIndex((s) => !s.occupant && !s.reserved);
  }

  /** Место персонажа в камере (занятое или зарезервированное) или null. */
  slotOf(cell: Cell, c: Character): CellSlot | null {
    return cell.slots.find((s) => s.occupant === c || s.reserved === c) ?? null;
  }

  /** Сколько сидит в камере. */
  occupants(cell: Cell): Character[] {
    const out: Character[] = [];
    for (const s of cell.slots) if (s.occupant) out.push(s.occupant);
    return out;
  }

  /**
   * Камера со свободным местом — ближайшая к точке. Граждан и партизан (prisoner) — сперва в
   * общую, остальных — сперва в одиночные; нет места — в любую.
   */
  freeCell(x: number, y: number, prisoner: Character | null = null): Cell | null {
    const wantCommon = prisoner ? belongsInCommon(prisoner) : false;
    // Партизаны и спецагент — в клетки у Администратора (мест нет — в обычную камеру); остальных в клетки не сажают.
    const wantCage = prisoner ? isUnderground(prisoner) : false;
    let best: Cell | null = null;
    let bestD = Infinity;
    for (const c of this.cells) {
      if (this.freeSlot(c) < 0) continue;
      if (c.cage && !wantCage) continue;
      if (wantCage && !c.cage && this.cells.some((o) => o.cage && this.freeSlot(o) >= 0)) continue;
      const d = Math.hypot(c.frontX - x, c.frontY - y) + (c.common === wantCommon ? 0 : 1e6);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  reserve(cell: Cell, prisoner: Character): void {
    if (this.slotOf(cell, prisoner)) return;
    const k = this.freeSlot(cell);
    if (k >= 0) cell.slots[k].reserved = prisoner;
  }

  /** Снять бронь места (конвой сорвался). */
  unreserve(cell: Cell, prisoner: Character): void {
    for (const s of cell.slots) if (s.reserved === prisoner) s.reserved = null;
  }

  /** Конвоир у двери камеры: открыть, завести. */
  putInCell(prisoner: Character, cell: Cell): void {
    const law = prisoner.law;
    law.phase = 'entering';
    law.cell = cell.index;
    this.reserve(cell, prisoner);
    if (cell.door) {
      this.doors.setLocked(cell.door, false);
      this.doors.open(cell.door);
    }
  }

  /** Освободить место персонажа во всех камерах (дверь запрёт update, если там ещё кто-то сидит). */
  vacate(c: Character): void {
    for (const cell of this.cells) {
      for (const s of cell.slots) {
        if (s.occupant === c || s.reserved === c) {
          s.occupant = null;
          s.reserved = null;
          if (cell.door) this.doors.setLocked(cell.door, false);
        }
      }
    }
  }

  /** Снять с персонажа любые процедуры (гибель, смена роли): освободить камеру, вернуть мозг. */
  release(c: Character): void {
    this.vacate(c);
    c.law.cell = -1;
    if (c.law.savedBrain || c.brain instanceof PrisonerBrain) this.restoreBrain(c);
    this.clear(c);
  }

  /** Отпустить без камеры (КПЗ переполнены). */
  releaseNoCell(handler: Character, prisoner: Character): void {
    handler.say(this.rng.pick(LINES.noCellFree), this.time);
    const paid = Math.min(prisoner.money, LAW.fines.restricted);
    prisoner.money -= paid;
    this.restoreBrain(prisoner);
    this.clear(prisoner);
  }

  private restoreBrain(p: Character): void {
    p.mass = p.isPlayer ? CHARACTER.mass.player : CHARACTER.mass.npc;
    p.brain = p.law.savedBrain;
    p.law.savedBrain = null;
    p.wantX = p.wantY = 0;
  }

  /** Точка в какой-нибудь камере или клетке (с запасом r px) — туда никого не ставят при заселении. */
  inAnyCell(x: number, y: number, r = 0): boolean {
    const ts = this.map.tileSize;
    return this.cells.some((c) => x > c.bounds.x0 * ts - r && y > c.bounds.y0 * ts - r && x < (c.bounds.x1 + 1) * ts + r && y < (c.bounds.y1 + 1) * ts + r);
  }

  private inside(c: Cell, x: number, y: number): boolean {
    const ts = this.map.tileSize;
    return x > c.bounds.x0 * ts && y > c.bounds.y0 * ts && x < (c.bounds.x1 + 1) * ts && y < (c.bounds.y1 + 1) * ts;
  }

  update(dt: number, player: Character | null): void {
    this.time += dt;
    for (const c of this.entities.list) {
      const law = c.law;
      switch (law.phase) {
        case 'ordered':
        case 'checking': {
          const h = law.handler;
          if (!h || !h.alive) {
            this.clear(c);
            break;
          }
          // Игрок, которому приказали стоять, но он уходит — сопротивление.
          if (c.isPlayer && this.time - law.since > LAW.complyGrace) {
            const moved = Math.hypot(c.x - law.orderX, c.y - law.orderY);
            if (moved > LAW.complyRadius) {
              this.log(`Вы не подчинились приказу ${label(h)}!`, 'law');
              this.startFlee(c);
            }
          }
          // Игрок-ГО ушёл от задержанного — отпускаем.
          if (h.isPlayer && Math.hypot(h.x - c.x, h.y - c.y) > 90) this.clear(c);
          break;
        }
        case 'cuffed': {
          const h = law.handler;
          if (!h || !h.alive) {
            this.restoreBrain(c);
            this.clear(c);
            break;
          }
          // Игрок-ГО привёл задержанного к свободной камере — заводим.
          if (h.isPlayer) {
            const cell = this.freeCell(h.x, h.y, c);
            if (cell && Math.hypot(h.x - cell.frontX, h.y - cell.frontY) < 56) this.putInCell(c, cell);
          }
          break;
        }
        case 'entering': {
          const cell = this.cells[law.cell];
          const slot = cell ? this.slotOf(cell, c) : null;
          if (cell && slot && this.inside(cell, c.x, c.y) && Math.hypot(c.x - slot.x, c.y - slot.y) < 20) {
            slot.occupant = c;
            slot.reserved = null;
            law.phase = 'jailed';
            const T = cell.cage ? LAW.cageTime : LAW.jailTime;
            law.jailUntil = this.time + (c.isPlayer ? T.player : T.npc);
            law.wanted = false;
            law.hasCid = true;
            law.handler = null;
            this.log(`${who(c, true)} помещён в ${cell.cage ? 'клетку в кабинете Администратора — на допрос' : cell.common ? 'общую камеру' : 'КПЗ'} на ${Math.round(law.jailUntil - this.time)} с`, 'law');
          } else if (this.time - law.since > 25) {
            // Застрял на входе — всё равно считаем посаженным.
            law.since = this.time;
          }
          break;
        }
        case 'jailed':
          if (this.time >= law.jailUntil) {
            const cell = this.cells[law.cell];
            if (cell) {
              const slot = this.slotOf(cell, c);
              if (slot) slot.occupant = null;
              if (cell.door) {
                this.doors.setLocked(cell.door, false);
                this.doors.open(cell.door);
              }
            }
            law.phase = 'releasing';
            law.since = this.time;
            law.cell = -1;
            this.log(`${who(c, true)} отбыл срок и отпущен`, 'law');
            if (c.isPlayer) {
              this.restoreBrain(c);
              this.clear(c);
            }
          }
          break;
        case 'releasing':
          // PrisonerBrain выводит к воротам Нексуса и сообщает done.
          if ((c.brain as PrisonerBrain | null)?.done || this.time - law.since > 30) {
            this.restoreBrain(c);
            this.clear(c);
            this.onReleased?.(c);
          }
          break;
        case 'fleeing':
          if (!law.handler || !law.handler.alive) this.clear(c);
          break;
      }
    }
    this.lockCells();
    void player;
  }

  /**
   * Дверь камеры заперта, пока там кто-то сидит и никто не входит и не выходит: в общей камере
   * новичка заводят и отпускают отсидевшего, не выпуская остальных.
   */
  private lockCells(): void {
    for (const cell of this.cells) {
      if (!cell.door || cell.brokenUntil > this.time) continue;
      let seated = false;
      let moving = false;
      for (const s of cell.slots) {
        if (s.occupant) seated = true;
        if (s.reserved && s.reserved.law.phase === 'entering') moving = true;
      }
      if (!seated || moving) continue;
      if (!cell.common) {
        this.doors.setLocked(cell.door, true);
        continue;
      }
      // Отпущенный ещё внутри — не запирать, пока не выйдет.
      for (const o of this.entities.list) {
        if (o.law.phase === 'releasing' && this.inside(cell, o.x, o.y)) {
          moving = true;
          break;
        }
      }
      if (!moving) this.doors.setLocked(cell.door, true);
    }
  }

  log(text: string, kind: 'law' | 'radio' | 'world' = 'law'): void {
    this.bus.emit('log', { text, kind });
  }

  /**
   * Спецагент выбил дверь камеры (или открыл клетку): все, кто сидит, выходят — и в розыск;
   * дверь не запирается LAW.brokenDoor с. Возвращает, сколько сбежало.
   */
  breakCell(cell: Cell): number {
    let n = 0;
    for (const s of cell.slots) {
      const c = s.occupant ?? s.reserved;
      s.occupant = null;
      s.reserved = null;
      if (!c || !c.alive) continue;
      n++;
      c.law.phase = 'releasing';
      c.law.since = this.time;
      c.law.cell = -1;
      c.law.wanted = true;
      if (c.isPlayer) {
        this.restoreBrain(c);
        this.clear(c);
        c.law.wanted = true;
      }
    }
    cell.brokenUntil = this.time + LAW.brokenDoor;
    if (cell.door) {
      this.doors.setLocked(cell.door, false);
      this.doors.open(cell.door);
    }
    return n;
  }

  /** Кто сидит в клетках у Администратора. */
  caged(): Character[] {
    const out: Character[] = [];
    for (const cell of this.cells) if (cell.cage) for (const s of cell.slots) if (s.occupant) out.push(s.occupant);
    return out;
  }

  /** Ячейка НавГрида для точки перед камерой. */
  frontAnchor(cell: Cell): number {
    return this.nav.nearestWalkable(cell.frontX, cell.frontY, 4);
  }

  /** Якорь места персонажа в камере (без брони — центр камеры). */
  cellAnchor(cell: Cell, c: Character | null = null): number {
    const slot = c ? this.slotOf(cell, c) : null;
    return this.nav.nearestWalkable(slot?.x ?? cell.x, slot?.y ?? cell.y, 3);
  }
}

/** «ГО-2231» / «Иван Попов». */
export function label(c: Character): string {
  return c.isPlayer ? `${c.name} (вы)` : c.name;
}

/** «гражданина #48102» — как в радиопереговорах. */
export function who(c: Character, nominative = false): string {
  if (c.isPlayer) return nominative ? 'Вы' : 'вас';
  const f = c.faction === 'rebel' ? (nominative ? 'Повстанец' : 'повстанца') : c.faction === 'cwu' ? (nominative ? 'Рабочий ГСР' : 'рабочего ГСР') : nominative ? 'Гражданин' : 'гражданина';
  return `${f} #${c.cid}`;
}
