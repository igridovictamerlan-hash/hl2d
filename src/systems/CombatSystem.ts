import type { Character } from '../entities/Character';
import type { EntityManager } from '../entities/EntityManager';
import type { Stack } from '../entities/Inventory';
import type { GameMap } from '../world/GameMap';
import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/rng';
import type { LawSystem } from './LawSystem';
import { castRayWith, lineOfSight } from '../world/visibility';
import { T } from '../world/tiles';
import { COMBAT } from '../config/combat';
import { CHARACTER } from '../config/entities';
import { WEAPONS, AMMO_ITEM, weaponDps, type WeaponDef, type WeaponId, type WeaponClass } from '../config/items';
import { FACTIONS, type FactionId } from '../config/factions';

const DEG = Math.PI / 180;

export interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  combine: boolean;
  kind: WeaponClass;
}

/** Взмах дубинкой — сектор удара (для отрисовки). */
export interface Swing {
  x: number;
  y: number;
  ang: number;
  half: number;
  reach: number;
  t: number;
  hit: boolean;
}

export interface Impact {
  x: number;
  y: number;
  t: number;
  blood: boolean;
}

export interface Corpse {
  x: number;
  y: number;
  faction: FactionId;
  rank: number;
  name: string;
  until: number;
  loot: Stack[];
}

/** Недавний выстрел — его «слышат» NPC поблизости. */
export interface Shot {
  x: number;
  y: number;
  t: number;
  shooter: Character;
  weapon: WeaponId;
  /** Слышимость, px. */
  noise: number;
}

/** Угол a − b, приведённый к (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

const near: Character[] = [];

/**
 * Бой: выстрелы лучом внутри конуса разброса (как в Foxhole: прицеливание сужает конус, движение и
 * отдача расширяют), дробь — несколько лучей. Стены и закрытые двери останавливают пули, бетонный
 * блок — с вероятностью COMBAT.barrierStopChance × (1 − пробитие оружия); свой блок рядом со стрелком
 * не мешает. Урон падает с дальностью. Дубинка — удар в секторе перед собой с оглушением.
 * Смерть, тело с лутом, перезарядка (магазин у каждого ствола свой), регенерация, лечение HELIX.
 */
export class CombatSystem {
  readonly tracers: Tracer[] = [];
  readonly swings: Swing[] = [];
  readonly impacts: Impact[] = [];
  readonly corpses: Corpse[] = [];
  readonly shots: Shot[] = [];
  private time = 0;
  private readonly dead: Character[] = [];
  /** Сколько выстрелов сделано (для тестов и отладки). */
  shotsFired = 0;
  hits = 0;
  kills = 0;
  /** Куда ушли пули (для отладки баланса): стена, укрытие, мимо, попадание. */
  readonly stats = { wall: 0, barrier: 0, miss: 0, hit: 0 };

  constructor(
    private readonly map: GameMap,
    private readonly entities: EntityManager,
    private readonly bus: EventBus,
    private readonly rng: Rng,
    private readonly law: LawSystem,
  ) {}

  get now(): number {
    return this.time;
  }

  /** Враги ли a и b: Альянс против повстанцев и тех, кто на него напал. */
  isHostile(a: Character, b: Character): boolean {
    if (!a.alive || !b.alive || a === b) return false;
    const A = FACTIONS[a.faction].authority;
    const B = FACTIONS[b.faction].authority;
    if (A === B) return false;
    const other = A ? b : a;
    return other.faction === 'rebel' || other.hostile;
  }

  /**
   * Стрелять ли a по b: повстанцы стреляют по Альянсу всегда, Альянс — по вооружённым
   * врагам и напавшим (безоружного повстанца ГО пытается задержать).
   */
  threat(a: Character, b: Character): boolean {
    if (!this.isHostile(a, b)) return false;
    if (!FACTIONS[a.faction].authority) return true;
    return b.weapon !== null || b.hostile;
  }

  weaponOf(c: Character): WeaponDef | null {
    return c.weapon ? WEAPONS[c.weapon] : null;
  }

  reserveAmmo(c: Character): number {
    const w = this.weaponOf(c);
    return w?.ammo ? c.inventory.count(AMMO_ITEM[w.ammo]) : 0;
  }

  reloading(c: Character): boolean {
    return c.reloadUntil > this.time;
  }

  /** Начать перезарядку, если есть чем. */
  reload(c: Character): boolean {
    const w = this.weaponOf(c);
    if (!w || !w.ammo || this.reloading(c) || c.mag >= w.magazine || this.reserveAmmo(c) <= 0) return false;
    c.reloadUntil = this.time + w.reload;
    return true;
  }

  /**
   * Взять оружие в руки (null — убрать). Патроны в магазине остаются у ствола: при смене
   * оружия они не теряются. Новый ствол заряжается из запаса при первом взятии; достать его —
   * WeaponDef.draw секунд (раньше не выстрелить).
   */
  equip(c: Character, id: Character['weapon']): void {
    if (c.weapon === id) return;
    if (c.weapon) c.mags[c.weapon] = c.mag;
    if (!c.equip(id)) return;
    c.reloadUntil = 0;
    c.aim = 0;
    c.recoil = 0;
    if (!id) {
      c.mag = 0;
      return;
    }
    const stored = c.mags[id];
    c.mag = stored ?? 0;
    if (stored === undefined) this.loadInstant(c);
    c.nextShot = Math.max(c.nextShot, this.time + WEAPONS[id].draw);
  }

  /** Мгновенно зарядить магазин из запаса (при выдаче оружия). */
  loadInstant(c: Character, max = Infinity): void {
    const w = this.weaponOf(c);
    if (!w?.ammo) return;
    const need = Math.min(max, w.magazine - c.mag);
    const have = this.reserveAmmo(c);
    const k = Math.min(need, have);
    if (k > 0) {
      c.inventory.remove(AMMO_ITEM[w.ammo], k);
      c.mag += k;
    }
  }

  /** Оружие в инвентаре (для смены по Q и выбора ИИ). */
  weaponsOf(c: Character): WeaponId[] {
    const out: WeaponId[] = [];
    for (const s of c.inventory.slots) if (s.id in WEAPONS && !out.includes(s.id as WeaponId)) out.push(s.id as WeaponId);
    return out;
  }

  /** Есть ли у ствола патроны (в магазине или в запасе). */
  hasAmmo(c: Character, id: WeaponId): boolean {
    const w = WEAPONS[id];
    if (!w.ammo) return true;
    const inMag = c.weapon === id ? c.mag : (c.mags[id] ?? 0);
    return inMag > 0 || c.inventory.count(AMMO_ITEM[w.ammo]) > 0;
  }

  /**
   * Лучший огнестрел против цели на дистанции d (для ИИ): с патронами, достаёт, наибольший урон
   * в секунду с учётом падения урона. null — нечем стрелять.
   */
  bestWeapon(c: Character, d: number): WeaponId | null {
    let best: WeaponId | null = null;
    let bestScore = 0;
    for (const id of this.weaponsOf(c)) {
      const w = WEAPONS[id];
      if (w.mode === 'melee' || !this.hasAmmo(c, id)) continue;
      const reach = d <= Math.min(w.range, w.effectiveRange * COMBAT.ai.maxRangeMul) ? 1 : 0.05;
      // Грубая оценка попадания: полуширина прицельного конуса у цели против радиуса кружка.
      const hit = Math.min(1, CHARACTER.radius / (d * Math.tan(w.spreadAim * DEG) + 1));
      // Урон в секунду × «вес залпа» (дробь и магнум валят быстрее, чем видно по DPS).
      const alpha = 1 + (w.damage * w.pellets) / 100;
      const score = weaponDps(w) * alpha * falloffMul(w, d) * hit * reach * (id === c.weapon ? 1.15 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  /** Наибольшая дальность огнестрела с патронами (ИИ ищет цели в этом радиусе). */
  maxRange(c: Character): number {
    let r = 0;
    for (const id of this.weaponsOf(c)) {
      const w = WEAPONS[id];
      if (w.mode !== 'melee' && this.hasAmmo(c, id)) r = Math.max(r, w.range);
    }
    return r;
  }

  /** Дистанция, с которой ИИ реально ведёт огонь (дробовик — только вблизи). */
  reach(c: Character): number {
    let r = 0;
    for (const id of this.weaponsOf(c)) {
      const w = WEAPONS[id];
      if (w.mode !== 'melee' && this.hasAmmo(c, id)) r = Math.max(r, Math.min(w.range, w.effectiveRange * COMBAT.ai.maxRangeMul));
    }
    return r;
  }

  canFire(c: Character): boolean {
    if (!c.weapon || !c.alive || this.time < c.nextShot) return false;
    if (WEAPONS[c.weapon].mode === 'melee') return true;
    return !this.reloading(c) && c.mag > 0;
  }

  /**
   * Текущий полуугол конуса разброса, градусы: от бедра → прицельно по мере прицеливания,
   * плюс движение (бег — сильнее) и накопленная отдача. У NPC — чуть шире (COMBAT.ai.spreadMul).
   */
  spreadOf(c: Character, w: WeaponDef | null = this.weaponOf(c)): number {
    if (!w) return 0;
    if (w.mode === 'melee') return w.spreadHip;
    const base = w.spreadHip + (w.spreadAim - w.spreadHip) * c.aim;
    const v = c.moveSpeed / CHARACTER.walkSpeed;
    const move = v < 0.15 ? 0 : w.moveSpread * (v <= 1 ? v : 1 + (v - 1) * COMBAT.runSpreadMul);
    let s = base + move + c.recoil;
    if (!c.isPlayer) s *= COMBAT.ai.spreadMul;
    return Math.min(s, COMBAT.maxSpread);
  }

  /** Выстрел (удар) в сторону точки. Возвращает, в кого попали (для дроби — в последнего). */
  fire(c: Character, tx: number, ty: number): Character | null {
    const w = this.weaponOf(c);
    if (!w) return null;
    if (w.mode === 'melee') return this.swing(c, w, tx, ty);
    // Дробовик заряжается по патрону: выстрел прерывает перезарядку, если в магазине что-то есть.
    if (w.perRound && this.reloading(c) && c.mag > 0) c.reloadUntil = 0;
    if (!this.canFire(c)) {
      if (c.mag <= 0) this.reload(c);
      return null;
    }
    c.mag--;
    c.nextShot = this.time + 1 / w.fireRate;
    this.shotsFired++;
    const aim = Math.atan2(ty - c.y, tx - c.x);
    c.facing = aim;
    const spread = this.spreadOf(c, w) * DEG;
    let hit: Character | null = null;
    for (let k = 0; k < w.pellets; k++) {
      // Треугольное распределение в [−1, 1]: гуще к центру, но всегда внутри конуса.
      const g = this.rng.next() + this.rng.next() - 1;
      hit = this.bullet(c, w, aim + g * spread) ?? hit;
    }
    c.recoil = Math.min(w.maxRecoil, c.recoil + w.recoil);
    this.shots.push({ x: c.x, y: c.y, t: this.time, shooter: c, weapon: w.id, noise: w.noise });
    return hit;
  }

  /** Одна пуля (дробина) по направлению ang. */
  private bullet(c: Character, w: WeaponDef, ang: number): Character | null {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const ox = c.x + dx * (c.radius + 1);
    const oy = c.y + dy * (c.radius + 1);
    const stopChance = Math.min(COMBAT.barrierMaxStop, Math.max(0, COMBAT.barrierStopChance * (1 - w.penetration)));
    let stoppedBy: 'wall' | 'barrier' | 'miss' = 'miss';
    // Блок из нескольких тайлов — одно укрытие: шанс остановки бросается при входе в него.
    let inBarrier = false;
    const wallT = castRayWith(this.map, ox, oy, dx, dy, w.range, (x, y, t) => {
      if (this.map.isOpaque(x, y)) {
        stoppedBy = 'wall';
        return true;
      }
      const barrier = this.map.tileAt(x, y) === T.BARRIER;
      const entering = barrier && !inBarrier;
      inBarrier = barrier;
      if (entering && t > COMBAT.ownCoverDistance && this.rng.chance(stopChance)) {
        stoppedBy = 'barrier';
        return true;
      }
      return false;
    });
    // Первый персонаж на линии огня.
    let hit: Character | null = null;
    let hitT = wallT;
    const mx = ox + (dx * wallT) / 2;
    const my = oy + (dy * wallT) / 2;
    for (const o of this.entities.near(mx, my, wallT / 2 + 16, near)) {
      if (o === c || !o.alive) continue;
      const px = o.x - ox;
      const py = o.y - oy;
      const t = px * dx + py * dy;
      if (t < 0 || t > hitT) continue;
      const d2 = px * px + py * py - t * t;
      const r2 = o.radius * o.radius;
      if (d2 > r2) continue;
      const th = t - Math.sqrt(r2 - d2);
      if (th < hitT) {
        hitT = th;
        hit = o;
      }
    }
    const ex = ox + dx * hitT;
    const ey = oy + dy * hitT;
    this.tracers.push({ x0: ox, y0: oy, x1: ex, y1: ey, t: COMBAT.tracerTime, combine: FACTIONS[c.faction].authority, kind: w.class });
    if (hitT < w.range) this.impacts.push({ x: ex, y: ey, t: COMBAT.impactTime, blood: !!hit });
    if (hit) {
      this.hits++;
      this.stats.hit++;
      this.damage(hit, w.damage * falloffMul(w, hitT + c.radius), c);
    } else this.stats[stoppedBy]++;
    return hit;
  }

  /** Удар дубинкой: ближайший в секторе перед собой; оглушает. */
  private swing(c: Character, w: WeaponDef, tx: number, ty: number): Character | null {
    if (!this.canFire(c)) return null;
    c.nextShot = this.time + 1 / w.fireRate;
    const ang = Math.atan2(ty - c.y, tx - c.x);
    c.facing = ang;
    const half = w.spreadHip * DEG;
    let best: Character | null = null;
    let bestD = Infinity;
    for (const o of this.entities.near(c.x, c.y, c.radius + w.range + 16, near)) {
      if (o === c || !o.alive) continue;
      const gap = Math.hypot(o.x - c.x, o.y - c.y) - o.radius - c.radius;
      if (gap > w.range) continue;
      if (gap > 4 && Math.abs(angleDiff(Math.atan2(o.y - c.y, o.x - c.x), ang)) > half) continue;
      if (!lineOfSight(this.map, c.x, c.y, o.x, o.y)) continue;
      if (gap < bestD) {
        bestD = gap;
        best = o;
      }
    }
    this.swings.push({ x: c.x, y: c.y, ang, half, reach: c.radius + w.range, t: COMBAT.swingTime, hit: !!best });
    if (!best) return null;
    best.stunUntil = Math.max(best.stunUntil, this.time + w.stun);
    best.aim = 0;
    this.impacts.push({ x: best.x - Math.cos(ang) * best.radius, y: best.y - Math.sin(ang) * best.radius, t: COMBAT.impactTime, blood: false });
    this.hits++;
    this.stats.hit++;
    this.damage(best, w.damage, c);
    return best;
  }

  damage(target: Character, amount: number, attacker: Character | null): void {
    if (!target.alive) return;
    target.health -= amount * (COMBAT.armor[target.faction] ?? 1);
    target.lastHurt = this.time;
    target.lastAttacker = attacker;
    if (attacker && !FACTIONS[attacker.faction].authority && FACTIONS[target.faction].authority && !attacker.hostile) {
      attacker.hostile = true;
      attacker.law.wanted = true;
      if (attacker.isPlayer) this.bus.emit('log', { text: 'Вы напали на Альянс — ГО будет стрелять без предупреждения.', kind: 'law' });
    }
    if (target.health <= 0) this.kill(target, attacker);
  }

  kill(c: Character, killer: Character | null): void {
    c.alive = false;
    c.health = 0;
    c.wantX = c.wantY = c.vx = c.vy = 0;
    this.kills++;
    const loot = c.inventory.takeAll();
    c.weapon = null;
    c.mag = 0;
    c.mags = {};
    this.corpses.push({ x: c.x, y: c.y, faction: c.faction, rank: c.rank, name: c.name, until: this.time + COMBAT.corpseTime, loot });
    // Разорвать связи: кого он вёл/проверял, кто вёл его.
    for (const o of this.entities.list) if (o.law.handler === c && o !== c) this.law.clear(o);
    if (c.law.phase !== 'none') this.law.release(c);
    const who = c.isPlayer ? 'Вы погибли' : `Убит: ${c.name} (${FACTIONS[c.faction].role})`;
    const by = killer ? (killer.isPlayer ? ' — вами' : ` — ${killer.name}`) : '';
    this.bus.emit('log', { text: who + by, kind: FACTIONS[c.faction].authority ? 'radio' : 'world' });
    if (c.isPlayer) c.respawnAt = this.time + COMBAT.respawnDelay;
    else this.dead.push(c);
  }

  /** Лечение HELIX / аптечкой: true — если было кого лечить. */
  heal(target: Character, amount: number): boolean {
    if (!target.alive || target.health >= target.maxHealth) return false;
    target.health = Math.min(target.maxHealth, target.health + amount);
    return true;
  }

  /** Ближайшее тело в радиусе. */
  corpseNear(x: number, y: number, r: number): Corpse | null {
    let best: Corpse | null = null;
    let bestD = r;
    for (const c of this.corpses) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD && c.loot.length > 0) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Забрать с тела всё, что влезет. Возвращает, сколько стопок взято. */
  loot(c: Character, corpse: Corpse): number {
    let taken = 0;
    for (let i = corpse.loot.length - 1; i >= 0; i--) {
      const s = corpse.loot[i];
      const k = c.inventory.add(s.id, s.qty);
      s.qty -= k;
      if (k > 0) taken++;
      if (s.qty <= 0) corpse.loot.splice(i, 1);
    }
    return taken;
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = this.tracers.length - 1; i >= 0; i--) if ((this.tracers[i].t -= dt) <= 0) this.tracers.splice(i, 1);
    for (let i = this.impacts.length - 1; i >= 0; i--) if ((this.impacts[i].t -= dt) <= 0) this.impacts.splice(i, 1);
    for (let i = this.swings.length - 1; i >= 0; i--) if ((this.swings[i].t -= dt) <= 0) this.swings.splice(i, 1);
    for (let i = this.corpses.length - 1; i >= 0; i--) if (this.corpses[i].until < this.time) this.corpses.splice(i, 1);
    while (this.shots.length > 0 && this.time - this.shots[0].t > 2) this.shots.shift();
    // Убитые NPC уходят из мира после тика (не посреди обхода списка мозгами).
    for (const c of this.dead) this.entities.remove(c);
    this.dead.length = 0;
    for (const c of this.entities.list) {
      if (!c.alive) continue;
      const w = this.weaponOf(c);
      // Перезарядка: магазином или по патрону (дробовик — пока не полон или не кончится запас).
      if (c.reloadUntil > 0 && this.time >= c.reloadUntil) {
        c.reloadUntil = 0;
        if (w?.perRound) {
          this.loadInstant(c, 1);
          if (c.mag < w.magazine && this.reserveAmmo(c) > 0) c.reloadUntil = this.time + w.reload;
        } else this.loadInstant(c);
      }
      // Оглушение: медленнее и без прицела.
      const stunned = c.stunUntil > this.time;
      c.speedMul = stunned ? COMBAT.stunSpeedMul : 1;
      // Прицеливание копится стоя (при ходьбе — медленнее), теряется на бегу, без ПКМ и при перезарядке.
      if (w && w.mode !== 'melee') {
        const running = c.moveSpeed > CHARACTER.walkSpeed * 1.2;
        if (c.aiming && !running && !stunned && !this.reloading(c)) {
          c.aim = Math.min(1, c.aim + (dt / w.aimTime) * (c.moveSpeed > 20 ? COMBAT.aimWhileMoving : 1));
        } else c.aim = Math.max(0, c.aim - dt * (running ? COMBAT.aimLossRun : COMBAT.aimLoss));
        c.recoil = Math.max(0, c.recoil - w.recovery * dt);
      } else {
        c.aim = 0;
        c.recoil = 0;
      }
      // Регенерация, если давно не ранили.
      if (this.time - c.lastHurt > COMBAT.regenDelay && c.health < c.maxHealth * COMBAT.regenCap) {
        c.health = Math.min(c.maxHealth * COMBAT.regenCap, c.health + COMBAT.regenPerSec * dt);
      }
    }
  }

  /** Был ли выстрел ближе r за последние sec секунд (не свой). */
  heardShot(c: Character, r: number, sec = 1): Shot | null {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      if (this.time - s.t > sec) break;
      if (s.shooter !== c && Math.hypot(s.x - c.x, s.y - c.y) < Math.min(r, s.noise)) return s;
    }
    return null;
  }
}

/** Множитель урона на дистанции d: полный до effectiveRange, дальше линейно до falloff на range. */
export function falloffMul(w: WeaponDef, d: number): number {
  if (d <= w.effectiveRange || w.range <= w.effectiveRange) return 1;
  const k = Math.min(1, (d - w.effectiveRange) / (w.range - w.effectiveRange));
  return 1 + (w.falloff - 1) * k;
}
