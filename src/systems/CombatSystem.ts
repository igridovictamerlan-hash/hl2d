import type { Character } from '../entities/Character';
import type { EntityManager } from '../entities/EntityManager';
import type { Stack } from '../entities/Inventory';
import type { GameMap } from '../world/GameMap';
import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/rng';
import type { LawSystem } from './LawSystem';
import { castRayWith } from '../world/visibility';
import { T } from '../world/tiles';
import { COMBAT } from '../config/combat';
import { WEAPONS, AMMO_ITEM, type WeaponDef } from '../config/items';
import { FACTIONS, type FactionId } from '../config/factions';

export interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  combine: boolean;
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
}

const near: Character[] = [];

/**
 * Бой: выстрелы лучом с разбросом, стены и закрытые двери останавливают пули, бетонный блок —
 * с вероятностью COMBAT.barrierStopChance (свой блок рядом со стрелком не мешает).
 * Урон, смерть, тело с лутом, перезарядка из инвентаря, медленная регенерация, лечение HELIX.
 */
export class CombatSystem {
  readonly tracers: Tracer[] = [];
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
    return w ? c.inventory.count(AMMO_ITEM[w.ammo]) : 0;
  }

  reloading(c: Character): boolean {
    return c.reloadUntil > this.time;
  }

  /** Начать перезарядку, если есть чем. */
  reload(c: Character): boolean {
    const w = this.weaponOf(c);
    if (!w || this.reloading(c) || c.mag >= w.magazine || this.reserveAmmo(c) <= 0) return false;
    c.reloadUntil = this.time + w.reload;
    return true;
  }

  /** Выбрать оружие (магазин считается пустым до перезарядки, кроме первого взятия в руки). */
  equip(c: Character, id: Character['weapon']): void {
    if (c.weapon === id) return;
    c.equip(id);
    c.mag = 0;
    c.reloadUntil = 0;
    if (id) this.loadInstant(c);
  }

  /** Мгновенно зарядить магазин из запаса (при выдаче оружия). */
  loadInstant(c: Character): void {
    const w = this.weaponOf(c);
    if (!w) return;
    const need = w.magazine - c.mag;
    const have = this.reserveAmmo(c);
    const k = Math.min(need, have);
    if (k > 0) {
      c.inventory.remove(AMMO_ITEM[w.ammo], k);
      c.mag += k;
    }
  }

  canFire(c: Character): boolean {
    return !!c.weapon && c.alive && !this.reloading(c) && this.time >= c.nextShot && c.mag > 0;
  }

  /** Выстрел в сторону точки. Возвращает, в кого попали. */
  fire(c: Character, tx: number, ty: number, accuracy = 1): Character | null {
    const w = this.weaponOf(c);
    if (!w || !this.canFire(c)) {
      if (w && c.mag <= 0) this.reload(c);
      return null;
    }
    c.mag--;
    c.nextShot = this.time + 1 / w.fireRate;
    this.shotsFired++;
    const moving = c.moveSpeed > 20 ? COMBAT.movingSpreadMul : 1;
    const g = (this.rng.next() + this.rng.next() + this.rng.next() - 1.5) / 1.5;
    const ang = Math.atan2(ty - c.y, tx - c.x) + g * ((w.spread * Math.PI) / 180) * moving * accuracy;
    c.facing = Math.atan2(ty - c.y, tx - c.x);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const ox = c.x + dx * (c.radius + 1);
    const oy = c.y + dy * (c.radius + 1);
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
      if (entering && t > COMBAT.ownCoverDistance && this.rng.chance(COMBAT.barrierStopChance)) {
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
    this.tracers.push({ x0: ox, y0: oy, x1: ex, y1: ey, t: COMBAT.tracerTime, combine: FACTIONS[c.faction].authority });
    this.shots.push({ x: c.x, y: c.y, t: this.time, shooter: c });
    if (hitT < w.range) this.impacts.push({ x: ex, y: ey, t: COMBAT.impactTime, blood: !!hit });
    if (hit) {
      this.hits++;
      this.stats.hit++;
      this.damage(hit, w.damage, c);
    } else this.stats[stoppedBy]++;
    return hit;
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
    for (let i = this.corpses.length - 1; i >= 0; i--) if (this.corpses[i].until < this.time) this.corpses.splice(i, 1);
    while (this.shots.length > 0 && this.time - this.shots[0].t > 2) this.shots.shift();
    // Убитые NPC уходят из мира после тика (не посреди обхода списка мозгами).
    for (const c of this.dead) this.entities.remove(c);
    this.dead.length = 0;
    for (const c of this.entities.list) {
      if (!c.alive) continue;
      // Перезарядка.
      if (c.reloadUntil > 0 && this.time >= c.reloadUntil) {
        c.reloadUntil = 0;
        this.loadInstant(c);
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
      if (s.shooter !== c && Math.hypot(s.x - c.x, s.y - c.y) < r) return s;
    }
    return null;
  }
}
