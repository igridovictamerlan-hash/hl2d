/** Описание системы — docs/hospital.md. */
import type { AiContext } from '../ai/AiContext';
import type { Brain } from '../ai/Brain';
import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import type { Vec2 } from '../core/math';
import { HOSPITAL } from '../config/hospital';
import { CHARACTER } from '../config/entities';
import { CP_UNIT, FACTIONS, cpHas } from '../config/factions';
import type { Violation } from '../config/law';
import type { ItemId } from '../config/items';
import { CpBrain } from '../ai/brains/CpBrain';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { EvacBrain } from '../ai/brains/EvacBrain';
import { PatientBrain } from '../ai/brains/PatientBrain';
import { CustodyBrain } from '../ai/brains/CustodyBrain';
import { lineOfSight } from '../world/visibility';

/** Место больного: койка (рамка для отрисовки лёжа — px мира, центр и размер) или носилки в приёмном покое. */
export interface Bed {
  /** Центр и размер койки (px) — больной рисуется лёжа на ней; null — носилки на полу. */
  box: { x: number; y: number; w: number; h: number } | null;
  /** Где стоит больной (клетка за изножьем), px. */
  spot: Vec2;
  occupant: Character | null;
  /** Занята под того, кого несут. */
  reserved: Character | null;
}

/** Вызов медика к тяжелораненому: кто лежит, с какого времени в списке, кто идёт. */
export interface Evac {
  patient: Character;
  since: number;
  medic: Character | null;
  brain: EvacBrain | null;
  /** Сколько медиков не нашли к нему пути (заперт в доме, отрезан) — после HOSPITAL.evac.maxFails не шлют. */
  fails: number;
}

/** Кто идёт за преступником в больницу. */
interface Custody {
  unit: Character | null;
  brain: CustodyBrain | null;
  /** За что задержат при выписке. */
  reason: Violation;
}

/** Свободные состояния юнита ВС: можно снять на вызов медика или за задержанным. */
const FREE = new Set(['patrol', 'patrol-again', 'post', 'guard', 'duty', 'hunt', 'follow']);

/**
 * Городская больница и медслужба. Тяжелораненый в городе лежит дольше (HOSPITAL.downed), над ним «!»; Надзор
 * шлёт ближайшего свободного медика (медик ТС, медик ВС из больницы, техник SU.02) — EvacBrain: подбежать (под
 * огнём — ждать), стабилизировать, нести на носилках на свободную койку. Больной (PatientBrain) лечится и
 * выписывается: ВС — на должность (место в штате за ним), житель — к своей жизни. Преступника на койке
 * охраняет и после выписки уводит в тюрьму следователь или другой свободный юнит (CustodyBrain).
 */
export class HospitalSystem {
  enabled = true;
  readonly present: boolean;
  /** Здание, px мира. */
  readonly rect: { x: number; y: number; w: number; h: number } | null = null;
  readonly face: 'N' | 'S' | 'E' | 'W' = 'S';
  readonly beds: Bed[] = [];
  /** Носилки в приёмном покое (коек нет). */
  readonly stretchers: Bed[] = [];
  /** Места медиков в ординаторской. */
  readonly hub: Vec2[] = [];
  /** Посты рекрутов у входа: место и взгляд наружу. */
  readonly posts: { x: number; y: number; facing: number }[] = [];
  /** Тамбур у дверей — сюда приходят и отсюда уходят. */
  readonly door: Vec2 | null = null;
  /** Помещения (px): палаты, ординаторская, приёмный покой, тамбур — для отрисовки. */
  readonly areas: { kind: 'ward' | 'hub' | 'reception' | 'lobby'; x: number; y: number; w: number; h: number }[] = [];
  readonly evacs = new Map<Character, Evac>();
  private readonly custody = new Map<Character, Custody>();
  readonly stats = { downs: 0, dispatched: 0, stabilized: 0, admitted: 0, walkIns: 0, discharged: 0, custody: 0, handedOver: 0, diedWaiting: 0, diedCarried: 0, savedCp: 0, waited: 0 };
  private readonly rng: Rng;
  private scanT = 0;
  private custodyT = 0;

  constructor(private readonly ctx: AiContext) {
    this.rng = ctx.rng.fork(0x405b);
    const map = ctx.map;
    const ts = map.tileSize;
    const P = map.poisOf('hospital')[0];
    this.present = !!P;
    if (!P) return;
    this.rect = { x: P.x * ts, y: P.y * ts, w: (P.w ?? 1) * ts, h: (P.h ?? 1) * ts };
    this.face = P.face ?? 'S';
    const c = (x: number, y: number) => ({ x: (x + 0.5) * ts, y: (y + 0.5) * ts });
    for (const b of map.poisOf('hospital_bed')) {
      const w = b.w ?? 1;
      const h = b.h ?? 1;
      // Место больного — клетка за изножьем (face — от изголовья к изножью).
      const sx = b.face === 'E' ? b.x + w : b.face === 'W' ? b.x - 1 : b.x;
      const sy = b.face === 'S' ? b.y + h : b.face === 'N' ? b.y - 1 : b.y;
      this.beds.push({ box: { x: (b.x + w / 2) * ts, y: (b.y + h / 2) * ts, w: w * ts, h: h * ts }, spot: c(sx, sy), occupant: null, reserved: null });
    }
    for (const s of map.poisOf('hospital_intake')) this.stretchers.push({ box: null, spot: c(s.x, s.y), occupant: null, reserved: null });
    for (const s of map.poisOf('hospital_hub_spot')) this.hub.push(c(s.x, s.y));
    const out = this.face === 'N' ? -Math.PI / 2 : this.face === 'S' ? Math.PI / 2 : this.face === 'E' ? 0 : Math.PI;
    for (const s of map.poisOf('hospital_post')) this.posts.push({ ...c(s.x, s.y), facing: out });
    const kinds = [['hospital_ward', 'ward'], ['hospital_hub', 'hub'], ['hospital_reception', 'reception'], ['hospital_lobby', 'lobby']] as const;
    for (const [t, kind] of kinds) for (const a of map.poisOf(t)) this.areas.push({ kind, x: a.x * ts, y: a.y * ts, w: (a.w ?? 1) * ts, h: (a.h ?? 1) * ts });
    const lobby = this.areas.find((a) => a.kind === 'lobby');
    this.door = lobby ? { x: lobby.x + lobby.w / 2, y: lobby.y + lobby.h / 2 } : { x: this.rect.x + this.rect.w / 2, y: this.rect.y + this.rect.h / 2 };
  }

  /** Работает ли медслужба (включена и в городе есть больница). */
  get active(): boolean {
    return this.enabled && this.present;
  }

  /** Сейчас в больнице (на койках и носилках). */
  get patients(): number {
    let n = 0;
    for (const b of this.beds) if (b.occupant) n++;
    for (const b of this.stretchers) if (b.occupant) n++;
    return n;
  }

  /** Место медика в ординаторской (по номеру медика — разные). */
  hubSpot(c: Character): Vec2 | null {
    if (!this.hub.length) return this.door;
    const p = this.hub[(c.pid + Math.floor(this.ctx.law.now / HOSPITAL.hub.hold[1])) % this.hub.length];
    return { x: p.x, y: p.y };
  }

  /** Пополнить перевязку медику (до HOSPITAL.restock). */
  private restock(c: Character): void {
    for (const [id, n] of Object.entries(HOSPITAL.restock) as [ItemId, number][]) {
      const have = c.inventory.count(id);
      if (have < n) c.inventory.add(id, n - have);
    }
  }

  /** Лежащий в городе, которого можно увезти в больницу. */
  private eligible(c: Character): boolean {
    if (!c.alive || !c.downed || c.isPlayer || c.faction === 'ota' || c.law.phase !== 'none') return false;
    const map = this.ctx.map;
    if (map.levelAt(c.x, c.y) !== 'city') return false;
    const k = map.zoneAtWorld(c.x, c.y)?.kind ?? '';
    return !HOSPITAL.downed.skipZones.includes(k);
  }

  /** Преступник: повстанец, напавший, в розыске — на койке под охраной, после выписки — в тюрьму. */
  criminal(c: Character): boolean {
    return c.faction === 'rebel' || c.hostile || c.law.wanted;
  }

  update(dt: number): void {
    if (!this.active) return;
    const now = this.ctx.combat.now;
    for (const [p, e] of this.evacs) {
      if (!p.alive) {
        if (p.evacStable) this.stats.diedCarried++;
        else this.stats.diedWaiting++;
        this.evacs.delete(p);
        continue;
      }
      if (!p.downed) {
        this.evacs.delete(p);
        continue;
      }
      if (e.medic && (!e.medic.alive || e.medic.brain !== e.brain)) {
        e.medic = null;
        e.brain = null;
      }
    }
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = HOSPITAL.evac.every;
    // Койка освободилась сама: больной умер (больницу обстреляли) или его мозг сменили (повышение, арест).
    for (const b of this.beds) if (b.occupant && (!b.occupant.alive || !(b.occupant.brain instanceof PatientBrain))) b.occupant = null;
    for (const b of this.stretchers) if (b.occupant && (!b.occupant.alive || !(b.occupant.brain instanceof PatientBrain))) b.occupant = null;
    const r = this.rect!;
    for (const c of this.ctx.entities.list) {
      // Медик в больнице — бинты и аптечки из шкафов ординаторской.
      if (c.alive && c.x >= r.x && c.y >= r.y && c.x < r.x + r.w && c.y < r.y + r.h && (c.profession === 'cwu_medic' || cpHas(c, 'medic'))) this.restock(c);
      if (this.evacs.has(c) || !this.eligible(c)) continue;
      // В городе лежит дольше: зажимает рану, ждёт медика.
      const hold = c.downedAt + HOSPITAL.downed.city;
      if (hold > c.downedUntil) {
        c.downedUntil = hold;
        c.downedSpan = hold - c.downedAt;
      }
      this.evacs.set(c, { patient: c, since: now, medic: null, brain: null, fails: 0 });
      this.stats.downs++;
    }
    this.dispatch(now);
    this.custodyT -= HOSPITAL.evac.every;
    if (this.custodyT <= 0) {
      this.custodyT = HOSPITAL.custody.every;
      this.custodyTick();
    }
  }

  /** Медики к лежащим без медика: сперва ВС, потом жители, преступники — последними; на вызовах не больше maxBusy. */
  private dispatch(now: number): void {
    let busy = 0;
    const waiting: Evac[] = [];
    for (const e of this.evacs.values()) {
      if (e.medic) busy++;
      else if (e.fails < HOSPITAL.evac.maxFails) waiting.push(e);
    }
    if (!waiting.length) return;
    const rank = (c: Character) => (c.faction === 'cp' ? 0 : this.criminal(c) ? 2 : 1);
    waiting.sort((a, b) => rank(a.patient) - rank(b.patient) || a.since - b.since);
    for (const e of waiting) {
      if (busy >= HOSPITAL.evac.maxBusy) return;
      const p = e.patient;
      const m = this.pickMedic(p, now);
      if (!m) continue;
      const E = HOSPITAL.evac;
      const eta = (Math.hypot(m.x - p.x, m.y - p.y) * E.pathMul) / (CHARACTER.runSpeed * E.run);
      const brain = new EvacBrain(this, e, m.brain);
      m.brain = brain;
      e.medic = m;
      e.brain = brain;
      busy++;
      this.stats.dispatched++;
      // Медик в пути — лежащий держится до его прихода (не дольше maxHold от падения).
      const hold = Math.min(p.downedAt + HOSPITAL.downed.maxHold, now + eta + HOSPITAL.downed.margin);
      if (hold > p.downedUntil) {
        p.downedUntil = hold;
        p.downedSpan = hold - p.downedAt;
      }
      m.say(this.rng.pick(HOSPITAL.lines.dispatch), this.ctx.law.now, 2.5);
    }
  }

  /** Свободен ли медик для вызова. */
  private freeMedic(m: Character): boolean {
    if (!m.alive || !m.fit || m.isPlayer || m.cadet || m.law.phase !== 'none' || m.dragging || m.reviving) return false;
    if (this.ctx.map.levelAt(m.x, m.y) !== 'city' || m.health < m.maxHealth * 0.5) return false;
    const b = m.brain;
    if (m.profession === 'cwu_medic' && b instanceof CitizenBrain) {
      return !this.ctx.economy.queue.includes(m) && m.panicUntil <= this.ctx.law.now;
    }
    if (m.faction === 'cp' && b instanceof CpBrain && cpHas(m, 'medic')) {
      // Медик КПП — при своём бункере.
      if (b.front >= 0 || b.medicStation || b.rally || b.formation || b.scene || b.gunner.target || b.target) return false;
      return FREE.has(b.fsm.current);
    }
    return false;
  }

  /** Ближайший свободный медик, успевающий до maxHold (медик ТС — не дальше cwuSeek). */
  private pickMedic(p: Character, now: number): Character | null {
    const E = HOSPITAL.evac;
    const left = p.downedAt + HOSPITAL.downed.maxHold - now;
    let best: Character | null = null;
    let bestD = Infinity;
    for (const m of this.ctx.entities.list) {
      if (m === p || !this.freeMedic(m)) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d >= bestD) continue;
      if (m.faction !== 'cp' && d > E.cwuSeek) continue;
      if ((d * E.pathMul) / (CHARACTER.runSpeed * E.run) > left) continue;
      best = m;
      bestD = d;
    }
    return best;
  }

  /**
   * «Горячо» у лежащего: враг медика с оружием на виду ближе hot px или стрельба там за hotFor с (не своих).
   */
  hot(p: Character, medic: Character): boolean {
    const E = HOSPITAL.evac;
    const combat = this.ctx.combat;
    const now = combat.now;
    const ours = FACTIONS[medic.faction].authority;
    for (let i = combat.shots.length - 1; i >= 0; i--) {
      const s = combat.shots[i];
      if (now - s.t > E.hotFor) break;
      if (s.weapon === 'smoke' || !s.shooter || s.shooter === medic) continue;
      if (ours && FACTIONS[s.shooter.faction].authority) continue;
      if (Math.hypot(s.x - p.x, s.y - p.y) < E.hot) return true;
    }
    for (const o of this.ctx.entities.near(p.x, p.y, E.hot)) {
      // С оружием в руках и враждебен медику, лежащему или Протекторату (напавший).
      if (o === p || o === medic || !o.fit || !o.weapon || !(o.hostile || combat.isHostile(o, medic) || combat.isHostile(o, p))) continue;
      if (lineOfSight(this.ctx.map, o.x, o.y, p.x, p.y)) return true;
    }
    return false;
  }

  /** Медик бросил вызов (ранен, не успел, лежащего подняли) — лежащего возьмёт другой. */
  released(e: Evac, medic: Character, noPath = false): void {
    if (noPath) e.fails++;
    if (e.medic === medic) {
      e.medic = null;
      e.brain = null;
    }
    for (const b of [...this.beds, ...this.stretchers]) if (b.reserved === e.patient && !b.occupant) b.reserved = null;
  }

  /** Свободная койка (или носилки) под того, кого несут. */
  reserveBed(p: Character): Bed | null {
    for (const list of [this.beds, this.stretchers]) {
      for (const b of list) if (b.reserved === p) return b;
      for (const b of list) {
        if (!b.occupant && !b.reserved) {
          b.reserved = p;
          return b;
        }
      }
    }
    return null;
  }

  /** Принять в больницу (медик донёс): лежит на койке, лечится; преступник — под охраной. */
  admit(p: Character, bed: Bed | null, medic: Character | null): boolean {
    const combat = this.ctx.combat;
    const slot = bed && (!bed.occupant || bed.occupant === p) ? bed : this.reserveBed(p);
    combat.stopDrag(p);
    combat.raise(p, p.maxHealth * HOSPITAL.care.admitHp);
    this.evacs.delete(p);
    if (!slot) return false;
    this.lay(p, slot, false);
    this.stats.admitted++;
    if (p.faction === 'cp') this.stats.savedCp++;
    if (medic) medic.say(this.rng.pick(HOSPITAL.lines.admit), this.ctx.law.now, 2.5);
    return true;
  }

  /** Сам дошёл (раненый ВС отходит в больницу): ложится, если есть место и здоровья мало. */
  walkIn(c: Character): boolean {
    if (!this.active || !c.fit || c.health >= c.maxHealth * HOSPITAL.care.walkInBelow || c.brain instanceof PatientBrain) return false;
    const slot = this.reserveBed(c);
    if (!slot) return false;
    this.lay(c, slot, true);
    this.stats.walkIns++;
    return true;
  }

  private lay(p: Character, slot: Bed, walkIn: boolean): void {
    slot.occupant = p;
    slot.reserved = null;
    if (!walkIn) {
      p.x = p.prevX = slot.spot.x;
      p.y = p.prevY = slot.spot.y;
    }
    const custody = this.criminal(p);
    p.brain = new PatientBrain(this, slot, p.brain, custody, walkIn);
    if (custody) {
      // Под охраной — уже не «напавший» (как задержанный): по койке не стреляют; за что задержат — запомнить.
      const reason: Violation = p.faction === 'rebel' ? 'rebel' : p.law.wanted ? 'wanted' : 'assault';
      p.hostile = false;
      this.custody.set(p, { unit: null, brain: null, reason });
      this.stats.custody++;
    }
  }

  /** Выписка: место свободно, прежняя жизнь (ВС — на свою должность). */
  discharge(p: Character, pb: PatientBrain, hurt = false): void {
    if (pb.bed.occupant === p) pb.bed.occupant = null;
    p.asleep = false;
    p.sleepAt = null;
    p.ghost = 0;
    p.inBed = false;
    p.brain = pb.saved;
    // Преступник сбежал с койки (больницу обстреляли) — снова в розыске как напавший.
    if (hurt && this.custody.has(p)) p.hostile = true;
    this.custody.delete(p);
    const b = p.brain;
    if (b instanceof CpBrain) b.fsm.change(b.idleState);
    if (!hurt) {
      this.stats.discharged++;
      p.say(this.rng.pick(p.faction === 'cp' ? HOSPITAL.lines.cpDischarge : HOSPITAL.lines.discharge), this.ctx.law.now, 2.5);
    }
  }

  /** Выписан под стражу: юнит задерживает и ведёт в тюрьму или КПЗ. */
  handOver(p: Character, pb: PatientBrain, unit: Character, saved: Brain | null): void {
    const reason = this.custody.get(p)?.reason ?? 'assault';
    this.custody.delete(p);
    this.discharge(p, pb, true);
    unit.brain = saved;
    this.ctx.law.arrest(unit, p, reason);
    unit.say(this.rng.pick(HOSPITAL.lines.takeAway), this.ctx.law.now, 2.5);
    this.stats.handedOver++;
    if (saved instanceof CpBrain && p.law.phase === 'cuffed') {
      saved.target = p;
      saved.fsm.change('escort');
    }
  }

  /** Конвоир за преступником ушёл (ранен, не дошёл) — пошлют другого. */
  custodyReleased(p: Character, unit: Character): void {
    const k = this.custody.get(p);
    if (k && k.unit === unit) {
      k.unit = null;
      k.brain = null;
    }
  }

  /** Преступники на койках без конвоира — ближайший свободный следователь, иначе патрульный. */
  private custodyTick(): void {
    for (const [p, k] of this.custody) {
      if (!p.alive || !(p.brain instanceof PatientBrain)) {
        this.custody.delete(p);
        continue;
      }
      if (k.unit && (!k.unit.alive || k.unit.brain !== k.brain)) {
        k.unit = null;
        k.brain = null;
      }
      if (k.unit) continue;
      const u = this.pickCustodian(p);
      if (!u) continue;
      const brain = new CustodyBrain(this, p, u.brain);
      u.brain = brain;
      k.unit = u;
      k.brain = brain;
    }
  }

  private pickCustodian(p: Character): Character | null {
    let best: Character | null = null;
    let bestScore = Infinity;
    for (const u of this.ctx.entities.list) {
      const b = u.brain;
      if (!u.alive || !u.fit || u.isPlayer || u.cadet || u.faction !== 'cp' || !(b instanceof CpBrain)) continue;
      if (b.guardPost || b.front >= 0 || b.medicStation || b.rally || b.formation || b.scene || b.target || b.gunner.target || b.ward) continue;
      if ((b.duty && b.duty !== 'squad') || !FREE.has(b.fsm.current) || this.ctx.map.levelAt(u.x, u.y) !== 'city') continue;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d > HOSPITAL.custody.seek) continue;
      // Следователь — в первую очередь.
      const score = d - (u.rank === CP_UNIT.su1 ? HOSPITAL.custody.seek : 0);
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  }
}
