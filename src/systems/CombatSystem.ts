import { ARSENAL } from '../config/arsenal';
import type { Character } from '../entities/Character';
import type { EntityManager } from '../entities/EntityManager';
import type { Stack } from '../entities/Inventory';
import type { GameMap } from '../world/GameMap';
import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/rng';
import type { LawSystem } from './LawSystem';
import { castRayWith, lineOfSight } from '../world/visibility';
import { T } from '../world/tiles';
import { COMBAT, GRENADE, FIRE, HITS, ROCKET, MINE, type HitZone } from '../config/combat';
import { SUPPRESS, CROUCH, DOWNED } from '../config/tactics';
import { resolveCircleVsTiles } from '../world/collision';
import { CHARACTER } from '../config/entities';
import { WEAPONS, AMMO_ITEM, ITEMS, GEAR, weaponDps, type WeaponDef, type WeaponId, type WeaponClass, type GrenadeId } from '../config/items';
import { gearLoot } from './Gear';
import { armorOf, roleArmor, rollZone, behind } from './wounds';
import { FACTIONS, cpHas, type FactionId } from '../config/factions';
import type { ProfessionId } from '../config/professions';
import { muzzleWorld } from '../entities/weaponPose';
import { BARKS } from '../config/barks';
import { FISTS } from '../config/brawl';
import { bark, barkSide } from './Barks';

const DEG = Math.PI / 180;

/**
 * Пуля (болт, ракета) в полёте: летит от дула со скоростью оружия. Куда попадёт, решается при
 * выстреле (стена, блок, первый на линии — target и зона), урон — по прилёту. Ракета (rocket)
 * проверяет попадание на лету и взрывается о стену или первого на пути.
 */
export interface Bullet {
  /** Голова пули и где была тиком раньше (хвост рисуется между ними). */
  x: number;
  y: number;
  px: number;
  py: number;
  /** Откуда летит (центр стрелка у края круга) и направление. */
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  /** Пройдено и где остановится (от ox, oy), px. */
  dist: number;
  end: number;
  speed: number;
  w: WeaponDef;
  shooter: Character;
  target: Character | null;
  zone: HitZone;
  /** Урон с учётом падения на дистанции (до брони и зоны). */
  damage: number;
  /** Во что упрётся: стена, блок, мимо (предел дальности). */
  stop: 'wall' | 'barrier' | 'miss';
  combine: boolean;
  kind: WeaponClass;
  rocket: boolean;
  /** Ракета: когда в последний раз оставила дымный след. */
  trailT: number;
  done: boolean;
  /** Вес ствола для подавления (SUPPRESS) и кого эта пуля уже прижала (не дважды). */
  press: number;
  pressed: Character[] | null;
  /** Когда выпущена (упавший после выстрела — пуля уходит поверх). */
  t0: number;
}

/**
 * Эффект для отрисовки и звука (частицы, вспышки, маркер попадания): бой пишет, рендер и звук
 * читают новые по seq (логика от них не зависит).
 */
export interface Fx {
  seq: number;
  /** Когда случилось (игровое время боя). */
  t: number;
  kind: 'muzzle' | 'hit' | 'wall' | 'blast' | 'stab' | 'smoke' | 'fire' | 'rocket' | 'bleed' | 'whiz';
  x: number;
  y: number;
  ang: number;
  cls: WeaponClass | null;
  /** Кто стрелял / в кого попали (маркер попадания игроку, тряска). */
  by: Character | null;
  target: Character | null;
  zone: HitZone | 'blast' | null;
  /** Сила: урон попадания или радиус взрыва. */
  power: number;
  lethal: boolean;
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

export interface Corpse {
  x: number;
  y: number;
  faction: FactionId;
  profession: ProfessionId | null;
  /** Кто убил (для сканирования OBS) и отсканировано ли уже. */
  killer: Character | null;
  scanned?: boolean;
  /** Сжигает санитар: до этого времени горит, потом исчезает; кто сжигает. */
  burning?: number;
  cremator?: Character | null;
  rank: number;
  name: string;
  until: number;
  loot: Stack[];
  /** Спецагент снял форму (переоделся в убитого) — второй раз нельзя. */
  stripped?: boolean;
  /** Медик на месте преступления накрыл тело белой простынёй (CrimeScenes.cover). */
  covered?: boolean;
}

/** Граната в полёте или на земле. */
export interface Grenade {
  kind: GrenadeId;
  x: number;
  y: number;
  /** Откуда и куда летит; flight — доля пройденного пути 0..1. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  flight: number;
  dur: number;
  /** Когда взорвётся (игровое время). */
  at: number;
  thrower: Character;
}

/** Взрыв (для тряски экрана и отрисовки): осталось t с из life, радиус r. */
export interface Blast {
  x: number;
  y: number;
  t: number;
  life: number;
  r: number;
  kind: 'frag' | 'fire' | 'rocket';
}

/**
 * Растяжка из гранаты: взводится к armedAt; задевает враг ставившего (сторона — authority владельца)
 * — взрыв. corpse — заминированное тело (растяжка лежит под ним).
 */
export interface Mine {
  x: number;
  y: number;
  kind: 'grenade' | 'fire_grenade';
  owner: Character;
  /** Ставил сотрудник Протектората (тогда задевают повстанцы и напавшие). */
  alliance: boolean;
  armedAt: number;
  corpse: Corpse | null;
}

/** Дымовая завеса: тайлы tiles непрозрачны (map.smoke) до until. */
export interface Smoke {
  x: number;
  y: number;
  r: number;
  born: number;
  until: number;
  tiles: number[];
}

/** След на земле: кровь, гильза, копоть от взрыва, выбоина от пули у стены. */
export interface Decal {
  x: number;
  y: number;
  kind: 'blood' | 'casing' | 'scorch' | 'chip';
  /** Когда исчезнет; ang/size — для разнообразия. */
  until: number;
  ang: number;
  size: number;
}

/** Недавний выстрел (или взрыв) — его «слышат» NPC поблизости. */
export interface Shot {
  x: number;
  y: number;
  t: number;
  shooter: Character;
  /** Ствол или взрыв (граната, ракета) / хлопок дымовой. */
  weapon: WeaponId | 'blast' | 'smoke';
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
/** Где луч пули входит в бетонные блоки (для присевшего за блоком). */
const barrierAt: number[] = [];
const FX_KEEP = 400;

/** Медик: поднимает быстрее и крепче (ветеран-медик, медик ТС, SU.02). */
export function isMedic(c: Character): boolean {
  return c.profession === 'rebel_medic' || c.profession === 'cwu_medic' || cpHas(c, 'medic');
}

/**
 * Бой. Пули летят с конечной скоростью (Bullet): куда попадёт, решается при выстреле внутри конуса
 * разброса (как в Foxhole: прицеливание сужает конус, движение и отдача расширяют; отдача ещё и
 * уводит ствол — kick), урон — по прилёту. Стены и закрытые двери останавливают пули, бетонный
 * блок — с вероятностью COMBAT.barrierStopChance × (1 − пробитие); свой блок у стрелка не мешает.
 * Попадание — в зону (голова, корпус, руки, ноги) с бронёй по зонам (wounds.ts): голова без шлема —
 * смерть от любого огнестрела; каждое ранение кровоточит до перевязки. Ближний бой: дубинка
 * (оглушает) и нож (в спину — мимо брони и сильнее). Гранаты: осколочная, дымовая, зажигательная;
 * РПГ — ракета со взрывом. Смерть, тело с лутом, перезарядка (магазин у каждого ствола свой).
 */
export class CombatSystem {
  readonly bullets: Bullet[] = [];
  readonly swings: Swing[] = [];
  readonly corpses: Corpse[] = [];
  readonly shots: Shot[] = [];
  readonly grenades: Grenade[] = [];
  readonly blasts: Blast[] = [];
  readonly decals: Decal[] = [];
  readonly smokes: Smoke[] = [];
  readonly mines: Mine[] = [];
  private mineScan = 0;
  /** Сколько растяжек сработало и сколько обезврежено (для тестов и отладки). */
  readonly mineStats = { planted: 0, triggered: 0, defused: 0 };
  /** Эффекты для отрисовки и звука (последние FX_KEEP, по возрастанию seq). */
  readonly fx: Fx[] = [];
  fxSeq = 0;
  /** Пламя от зажигательных гранат. */
  readonly fires: { x: number; y: number; r: number; until: number; owner: Character }[] = [];
  private time = 0;
  private readonly dead: Character[] = [];
  /** Сколько выстрелов сделано (для тестов и отладки). */
  shotsFired = 0;
  /** Осечки порченых патронов (склад). */
  jams = 0;
  hits = 0;
  kills = 0;
  headshots = 0;
  bledOut = 0;
  /** Тяжёлые ранения, поднятые и добитые (для тестов и отладки). */
  downs = 0;
  revives = 0;
  finished = 0;
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

  /** Стычка банд (задаёт GangSystem): враги ли бойцы a и b разных банд. */
  gangHostile: ((a: Character, b: Character) => boolean) | null = null;

  /** Вражда банды с обидчиком своего (задаёт Brawls): бойцы банды и обидчик — враги. */
  vendettaHostile: ((a: Character, b: Character) => boolean) | null = null;

  /** Враги ли a и b: Протекторат против повстанцев и тех, кто на него напал. */
  isHostile(a: Character, b: Character): boolean {
    if (!a.alive || !b.alive || a === b) return false;
    if (this.vendettaHostile?.(a, b)) return true;
    const A = FACTIONS[a.faction].authority;
    const B = FACTIONS[b.faction].authority;
    // Бойцы разных банд в стычке (GangSystem) — враги друг другу.
    if (!A && !B && a.gang >= 0 && b.gang >= 0) return this.gangHostile?.(a, b) ?? false;
    if (A === B) return false;
    const other = A ? b : a;
    // Партизан в маскировке — «гражданин», пока не выдал себя.
    return (other.faction === 'rebel' && !other.disguised) || other.hostile;
  }

  /**
   * Стрелять ли a по b: повстанцы стреляют по Протекторату всегда, Протекторат — по вооружённым
   * врагам и напавшим (безоружного повстанца ВС пытается задержать).
   */
  threat(a: Character, b: Character): boolean {
    // Лежащий и задержанный (в наручниках, в камере) — не угроза.
    if (b.downed || !this.isHostile(a, b) || inCustody(b)) return false;
    if (!FACTIONS[a.faction].authority) return true;
    return b.weapon !== null || b.hostile;
  }

  /** Подпольщик раскрыт (убил кого-то, арест, допрос): снова виден как повстанец. */
  reveal(c: Character, why: string): void {
    if (!c.disguised) return;
    c.disguised = false;
    c.cover = null;
    if (c.isPlayer) this.bus.emit('log', { text: `Маскировка раскрыта: вы ${why}. Теперь ВС узнаёт вас в лицо.`, kind: 'law' });
  }

  weaponOf(c: Character): WeaponDef | null {
    return c.weapon ? WEAPONS[c.weapon] : null;
  }

  /** Запас патронов к стволу id (не в магазине). */
  reserveOf(c: Character, id: WeaponId): number {
    const w = WEAPONS[id];
    return w.ammo ? c.inventory.count(AMMO_ITEM[w.ammo]) : 0;
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
    c.kick = 0;
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
   * в секунду с учётом падения урона. РПГ сюда не входит — его ИИ берёт отдельно (Gunner).
   * null — нечем стрелять.
   */
  bestWeapon(c: Character, d: number): WeaponId | null {
    let best: WeaponId | null = null;
    let bestScore = 0;
    for (const id of this.weaponsOf(c)) {
      const w = WEAPONS[id];
      if (w.mode === 'melee' || w.blastMul || !this.hasAmmo(c, id)) continue;
      const reach = d <= Math.min(w.range, w.effectiveRange * COMBAT.ai.maxRangeMul) ? 1 : 0.05;
      // Грубая оценка попадания: полуширина прицельного конуса у цели против радиуса кружка.
      const hit = Math.min(1, CHARACTER.radius / (d * Math.tan(w.spreadAim * DEG) + 1));
      // Урон в секунду × «вес залпа» (дробь и магнум валят быстрее, чем видно по DPS); автомат
      // стреляет очередями с паузами — реально выпускает меньше.
      const alpha = 1 + (w.damage * w.pellets) / 80;
      const score = weaponDps(w) * (w.mode === 'auto' ? 0.6 : 1) * alpha * falloffMul(w, d) * hit * reach * (id === c.weapon ? 1.15 : 1);
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
      if (w.mode !== 'melee' && !w.blastMul && this.hasAmmo(c, id)) r = Math.max(r, w.range);
    }
    return r;
  }

  /** Дистанция, с которой ИИ реально ведёт огонь (дробовик — только вблизи). */
  reach(c: Character): number {
    let r = 0;
    for (const id of this.weaponsOf(c)) {
      const w = WEAPONS[id];
      if (w.mode !== 'melee' && !w.blastMul && this.hasAmmo(c, id)) r = Math.max(r, Math.min(w.range, w.effectiveRange * COMBAT.ai.maxRangeMul));
    }
    return r;
  }

  /** Перевязывается (стоит, не стреляет). */
  bandaging(c: Character): boolean {
    return c.bandageUntil > this.time;
  }

  /** Занят руками: перевязывается, ставит растяжку, поднимает раненого — или сам лежит. */
  busy(c: Character): boolean {
    return c.bandageUntil > this.time || c.plantUntil > this.time || c.reviveUntil > this.time || c.downed;
  }

  canFire(c: Character): boolean {
    if (!c.weapon || !c.alive || this.time < c.nextShot || this.busy(c)) return false;
    if (WEAPONS[c.weapon].mode === 'melee') return true;
    return !this.reloading(c) && c.mag > 0;
  }

  /**
   * Текущий полуугол конуса разброса, градусы: от бедра → прицельно по мере прицеливания,
   * плюс движение (бег — сильнее) и накопленная отдача; ранен в руку — шире. У NPC — чуть шире.
   */
  spreadOf(c: Character, w: WeaponDef | null = this.weaponOf(c)): number {
    if (!w) return 0;
    if (w.mode === 'melee') return w.spreadHip;
    const base = w.spreadHip + (w.spreadAim - w.spreadHip) * c.aim;
    const v = c.moveSpeed / CHARACTER.walkSpeed;
    const move = v < 0.15 ? 0 : w.moveSpread * (v <= 1 ? v : 1 + (v - 1) * COMBAT.runSpreadMul);
    let s = base + move + c.recoil + c.suppress * SUPPRESS.spread;
    if (c.crouch) s *= CROUCH.spreadMul;
    if (c.armUntil > this.time) s *= HITS.armSpread;
    if (!c.isPlayer) s *= COMBAT.ai.spreadMul;
    return Math.min(s, COMBAT.maxSpread);
  }

  /** Записать эффект (для отрисовки и звука). */
  private emit(kind: Fx['kind'], x: number, y: number, ang: number, cls: WeaponClass | null, by: Character | null, target: Character | null = null, zone: Fx['zone'] = null, power = 0, lethal = false): void {
    this.fx.push({ seq: ++this.fxSeq, t: this.time, kind, x, y, ang, cls, by, target, zone, power, lethal });
    if (this.fx.length > FX_KEEP) this.fx.splice(0, this.fx.length - FX_KEEP);
  }

  /**
   * Выстрел (удар) в сторону точки. Возвращает, в кого попадёт пуля (для дроби — последняя
   * попавшая); урон — когда пуля долетит. Ракета РПГ цель не предсказывает (null).
   */
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
    // Порченые патроны со склада: осечка — ствол клинит.
    if (c.badAmmo && this.rng.chance(ARSENAL.taint.jam)) {
      c.nextShot = this.time + ARSENAL.taint.jamTime;
      this.jams++;
      c.say('Осечка!', this.time, 1.2);
      return null;
    }
    c.mag--;
    c.nextShot = this.time + 1 / w.fireRate;
    c.lastFired = this.time;
    this.shotsFired++;
    const aim = Math.atan2(ty - c.y, tx - c.x);
    c.facing = aim;
    const spread = this.spreadOf(c, w) * DEG;
    // Увод ствола: пуля летит туда, куда ствол увело прошлыми выстрелами.
    const dir = aim + c.kick;
    let hit: Character | null = null;
    for (let k = 0; k < w.pellets; k++) {
      // Треугольное распределение в [−1, 1]: гуще к центру, но всегда внутри конуса.
      const g = this.rng.next() + this.rng.next() - 1;
      hit = this.bullet(c, w, dir + g * spread, tx, ty) ?? hit;
    }
    c.recoil = Math.min(w.maxRecoil, c.recoil + w.recoil);
    // Отдача уводит ствол вбок: чаще в ту же сторону, иногда разворачивается.
    if (w.kick > 0) {
      if (this.rng.chance(w.kickSide)) c.kickDir = -c.kickDir;
      const lim = w.kickMax * DEG;
      c.kick = Math.max(-lim, Math.min(lim, c.kick + c.kickDir * w.kick * DEG * this.rng.range(0.6, 1.2)));
    }
    const m = muzzleWorld(c, w.id);
    this.emit('muzzle', m.x, m.y, aim, w.class, c, null, null, w.shake);
    // Гильза — вправо-назад от стрелка (у арбалета и РПГ гильз нет).
    if (w.class !== 'crossbow' && w.class !== 'launcher' && w.class !== 'pulse') {
      const ca = aim + Math.PI / 2 + this.rng.range(-0.5, 0.5);
      const cd = this.rng.range(10, 20);
      this.addDecal(c.x + Math.cos(ca) * cd, c.y + Math.sin(ca) * cd, 'casing', COMBAT.decals.casingTime, this.rng.range(0, Math.PI), 1);
    }
    this.shots.push({ x: c.x, y: c.y, t: this.time, shooter: c, weapon: w.id, noise: w.noise });
    return hit;
  }

  /** Пуля (дробина, болт, ракета) по направлению ang: решить, куда попадёт, и выпустить. */
  private bullet(c: Character, w: WeaponDef, ang: number, aimX: number, aimY: number): Character | null {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const ox = c.x + dx * (c.radius + 1);
    const oy = c.y + dy * (c.radius + 1);
    const stopChance = Math.min(COMBAT.barrierMaxStop, Math.max(0, COMBAT.barrierStopChance * (1 - w.penetration)));
    const rocket = !!w.blastMul;
    let stop: Bullet['stop'] = 'miss';
    // Блок из нескольких тайлов — одно укрытие: шанс остановки бросается при входе в него.
    let inBarrier = false;
    barrierAt.length = 0;
    const wallT = castRayWith(this.map, ox, oy, dx, dy, w.range, (x, y, t) => {
      if (this.map.blocksShot(x, y)) {
        stop = 'wall';
        return true;
      }
      const barrier = this.map.tileAt(x, y) === T.BARRIER;
      const entering = barrier && !inBarrier;
      inBarrier = barrier;
      if (entering) barrierAt.push(t);
      // Ракета бьёт в блок всегда (взрыв у укрытия).
      if (entering && t > COMBAT.ownCoverDistance && (rocket || this.rng.chance(stopChance))) {
        stop = 'barrier';
        return true;
      }
      return false;
    });
    // Первый персонаж на линии огня (для ракеты — решается в полёте).
    let hit: Character | null = null;
    let hitT = wallT;
    if (!rocket) {
      const mx = ox + (dx * wallT) / 2;
      const my = oy + (dy * wallT) / 2;
      for (const o of this.entities.near(mx, my, wallT / 2 + 16, near)) {
        if (o === c || !o.alive) continue;
        // Лежащий раненый: пули летят поверх, если целятся не в него (в своего лежащего — никогда).
        if (o.downed && (Math.hypot(o.x - aimX, o.y - aimY) > o.radius * 1.6 || FACTIONS[o.faction].authority === FACTIONS[c.faction].authority)) continue;
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
    }
    // Присевший за блоком: блок у него на линии огня почти всегда держит пулю.
    if (hit && hit.crouch && !rocket) {
      const pierce = Math.min(1, w.penetration * CROUCH.coverPierce);
      for (const bt of barrierAt) {
        if (bt > COMBAT.ownCoverDistance && bt <= hitT && hitT - bt <= CROUCH.coverReach && this.rng.chance(CROUCH.coverStop * (1 - pierce))) {
          hit = null;
          hitT = bt;
          stop = 'barrier';
          break;
        }
      }
    }
    // Пуля вылетает из дульного среза (если ствол не упёрся в стену и цель не ближе ствола).
    const m = muzzleWorld(c, w.id);
    const md = (m.x - ox) * dx + (m.y - oy) * dy;
    const fromMuzzle = md > 0 && md < hitT && lineOfSight(this.map, c.x, c.y, m.x, m.y);
    const start = fromMuzzle ? md : 0;
    const zone = hit ? rollZone(this.rng, c.aim, hit.crouch ? CROUCH.legMul : 1) : 'torso';
    this.bullets.push({
      x: ox + dx * start, y: oy + dy * start, px: ox + dx * start, py: oy + dy * start, ox, oy, dx, dy,
      dist: start, end: hitT, speed: w.speed, w, shooter: c, target: hit, zone,
      damage: w.damage * falloffMul(w, hitT + c.radius), stop, combine: FACTIONS[c.faction].authority, kind: w.class,
      rocket, trailT: 0, done: false,
      t0: this.time,
      press: Math.max(SUPPRESS.weight[0], Math.min(SUPPRESS.weight[1], (w.damage * w.pellets ** 0.5 * (rocket ? 3 : 1)) / SUPPRESS.weightDamage)) / (w.pellets > 1 ? w.pellets : 1),
      pressed: null,
    });
    if (hit) {
      this.hits++;
      this.stats.hit++;
    } else if (!rocket) this.stats[stop]++;
    return hit;
  }

  /** Пуля долетела: попадание в цель, в стену, в блок или на излёте. */
  private land(b: Bullet): void {
    const ex = b.ox + b.dx * b.end;
    const ey = b.oy + b.dy * b.end;
    const ang = Math.atan2(b.dy, b.dx);
    if (b.rocket) {
      this.explode(ex - b.dx * 6, ey - b.dy * 6, b.shooter, 'rocket', b.w.blastMul ?? 1);
      return;
    }
    const t = b.target;
    // Цель упала, пока пуля летела, — пуля уходит поверх.
    if (t && t.alive && !(t.downed && t.downedAt >= b.t0)) {
      // Брызги крови позади раненого.
      if (this.rng.chance(COMBAT.decals.bloodChance)) {
        const bd = this.rng.range(4, 14);
        this.addDecal(ex + b.dx * bd, ey + b.dy * bd, 'blood', COMBAT.decals.bloodTime, this.rng.range(0, Math.PI), this.rng.range(0.6, 1.2));
      }
      this.shotHit(t, b.w, b.damage, b.zone, b.shooter, ang, ex, ey);
      // Болт пиротехника поджигает.
      if (b.w.class === 'crossbow' && b.shooter.profession === 'pyro' && t.alive) this.ignite(t, b.shooter, FIRE.boltBurn);
      return;
    }
    if (b.end >= b.w.range - 1) return;
    this.emit('wall', ex, ey, ang, b.kind, b.shooter, null, null, b.stop === 'barrier' ? 1 : 0);
    if (b.stop === 'wall' && this.rng.chance(COMBAT.decals.chipChance)) {
      this.addDecal(ex - b.dx * 2, ey - b.dy * 2, 'chip', COMBAT.decals.chipTime, ang, this.rng.range(0.7, 1.2));
    }
  }

  /** Попадание из оружия id в зону (для тестов и отладки): как пуля вплотную. */
  applyHit(target: Character, id: WeaponId, zone: HitZone, attacker: Character): void {
    const ang = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    this.shotHit(target, WEAPONS[id], WEAPONS[id].damage, zone, attacker, ang, target.x, target.y);
  }

  /**
   * Попадание пули в зону: урон × множитель зоны × (1 − броня × (1 − бронебойность)); голова без
   * шлема — смерть от любого огнестрела. Ранение кровоточит, нога — хромота, рука — шире конус.
   */
  private shotHit(target: Character, w: WeaponDef, base: number, zone: HitZone, attacker: Character, ang: number, x: number, y: number): void {
    const armor = armorOf(target);
    const prot = zone === 'head' ? armor.head : zone === 'torso' ? armor.torso : 0;
    const lethal = zone === 'head' && prot <= 0;
    const dmg = lethal ? target.health + 1 : base * HITS.mul[zone] * (1 - prot * (1 - w.pierce));
    if (lethal) this.headshots++;
    this.emit('hit', x, y, ang, w.class, attacker, target, zone, dmg, lethal);
    this.wound(target, dmg, zone);
    this.damage(target, dmg, attacker, zone, lethal);
  }

  /** Кровотечение и последствия ранения в зону (урон — отдельно, через damage). */
  private wound(target: Character, dmg: number, zone: HitZone | 'blast'): void {
    if (!target.alive) return;
    const per = zone === 'blast' ? HITS.bleed.arm : HITS.bleed[zone];
    target.bleed = Math.min(HITS.bleedMax, target.bleed + dmg * per);
    if (zone === 'leg') target.limpUntil = this.time + HITS.limpTime;
    if (zone === 'arm') target.armUntil = this.time + HITS.armTime;
  }

  /**
   * Удар: ближайший в секторе перед собой. Дубинка оглушает; нож режет (кровотечение), в спину —
   * × backstab и мимо брони (два удара в спину валят патрульного).
   */
  /** Ударили кулаком (задаёт Brawls: ответить, позвать братву). */
  onPunch: (target: Character, attacker: Character) => void = () => {};

  /**
   * Удар кулаком — пустыми руками, оружие в руках не нужно (FISTS): кулаком не убить — здоровье не ниже
   * floor, дошёл до него — нокаут (оглушён knockout с). Возвращает, в кого попал.
   */
  punch(c: Character, tx: number, ty: number): Character | null {
    if (!c.alive || c.downed || this.time < c.nextShot || this.busy(c)) return null;
    c.nextShot = this.time + 1 / FISTS.rate;
    const ang = Math.atan2(ty - c.y, tx - c.x);
    c.facing = ang;
    const half = 45 * DEG;
    let best: Character | null = null;
    let bestD = Infinity;
    for (const o of this.entities.near(c.x, c.y, c.radius + FISTS.range + 16, near)) {
      if (o === c || !o.alive || o.downed) continue;
      const gap = Math.hypot(o.x - c.x, o.y - c.y) - o.radius - c.radius;
      if (gap > FISTS.range) continue;
      if (gap > 4 && Math.abs(angleDiff(Math.atan2(o.y - c.y, o.x - c.x), ang)) > half) continue;
      if (!lineOfSight(this.map, c.x, c.y, o.x, o.y)) continue;
      if (gap < bestD) {
        bestD = gap;
        best = o;
      }
    }
    this.swings.push({ x: c.x, y: c.y, ang, half, reach: c.radius + FISTS.range, t: COMBAT.swingTime, hit: !!best });
    if (!best) return null;
    this.stats.hit++;
    best.stunUntil = Math.max(best.stunUntil, this.time + FISTS.stun);
    best.aim = 0;
    const dmg = Math.min(FISTS.damage * (1 - armorOf(best).torso * 0.5), Math.max(0, best.health - FISTS.floor));
    this.emit('stab', best.x - Math.cos(ang) * best.radius, best.y - Math.sin(ang) * best.radius, ang, 'melee', c, best, 'torso', dmg, false);
    if (dmg > 0) this.damage(best, dmg, c, 'torso');
    else if (!best.disguised && !FACTIONS[c.faction].authority && FACTIONS[best.faction].authority) this.damage(best, 0, c, 'torso');
    if (best.alive && best.health <= FISTS.floor + 0.01) best.stunUntil = Math.max(best.stunUntil, this.time + FISTS.knockout);
    this.onPunch(best, c);
    return best;
  }

  /** Нокаутирован кулаками (оглушён и на пороге здоровья). */
  knockedOut(c: Character): boolean {
    return c.health <= FISTS.floor + 0.01 && c.stunUntil > this.time;
  }

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
    this.hits++;
    this.stats.hit++;
    const hx = best.x - Math.cos(ang) * best.radius;
    const hy = best.y - Math.sin(ang) * best.radius;
    if (w.class === 'blade') {
      const back = behind(best, c);
      const armor = armorOf(best);
      const dmg = back ? w.damage * (w.backstab ?? 1) : w.damage * (1 - armor.torso * (1 - w.pierce));
      this.emit('stab', hx, hy, ang, w.class, c, best, 'torso', dmg, back);
      if (back && c.isPlayer) this.bus.emit('log', { text: `Удар в спину: ${best.name}.`, kind: 'world' });
      this.addDecal(hx + Math.cos(ang) * 6, hy + Math.sin(ang) * 6, 'blood', COMBAT.decals.bloodTime, this.rng.range(0, Math.PI), this.rng.range(0.7, 1.1));
      this.wound(best, dmg, 'torso');
      this.damage(best, dmg, c, 'torso');
      return best;
    }
    const armor = armorOf(best);
    const dmg = w.damage * (1 - armor.torso * 0.5);
    this.emit('stab', hx, hy, ang, w.class, c, best, 'torso', dmg, false);
    this.damage(best, dmg, c, 'torso');
    return best;
  }

  /**
   * Урон как есть (зоны и броня уже учтены вызывающим): пули — shotHit, взрыв — explode, огонь и
   * кровотечение — update. zone — для журнала и HUD.
   */
  damage(target: Character, amount: number, attacker: Character | null, zone: HitZone | 'blast' | null = null, instant = false): void {
    if (!target.alive) return;
    // Лежащего тяжелораненого добивает любой урон.
    if (target.downed) {
      if (amount <= 0) return;
      if (attacker) target.lastAttacker = attacker;
      this.finished++;
      this.kill(target, attacker ?? target.lastAttacker, 'добит');
      this.onDamage(target, attacker, true);
      return;
    }
    target.health -= amount;
    target.lastHurt = this.time;
    target.lastAttacker = attacker;
    if (zone) target.lastZone = zone;
    this.press(target, SUPPRESS.hit);
    // Под личиной ранивший остаётся неузнанным — выдаёт только убийство (kill).
    if (attacker && !attacker.disguised && !FACTIONS[attacker.faction].authority && FACTIONS[target.faction].authority && !attacker.hostile) {
      attacker.hostile = true;
      attacker.law.wanted = true;
      if (attacker.isPlayer) this.bus.emit('log', { text: 'Вы напали на Протекторат — ВС будет стрелять без предупреждения.', kind: 'law' });
    }
    if (target.health <= 0) {
      // Тяжёлое ранение, если не в голову без шлема, не взрыв вплотную и не урон «с запасом».
      if (!instant && -target.health <= target.maxHealth * DOWNED.overkill) this.down(target, attacker);
      else this.kill(target, attacker);
    }
    this.onDamage(target, attacker, !target.alive);
  }

  /** Прижать огнём: подавление + amount (не больше 1). */
  press(c: Character, amount: number): void {
    if (!c.alive || c.downed || amount <= 0) return;
    c.suppress = Math.min(1, c.suppress + amount);
    c.suppressAt = this.time;
  }

  /**
   * Тяжёлое ранение: падает и DOWNED.time с истекает кровью (потом смерть от ранившего), если никто
   * не поднимет. Не боец: не стреляет, не ходит (игрок ползёт), его не обстреливают.
   */
  down(c: Character, by: Character | null): void {
    if (!c.alive || c.downed) return;
    c.downedUntil = this.time + DOWNED.time;
    c.downedAt = this.time;
    c.health = 1;
    c.bleed = 0;
    c.bandageUntil = c.plantUntil = c.reloadUntil = 0;
    this.cancelRevive(c);
    this.stopDrag(c);
    c.aiming = false;
    c.aim = c.recoil = c.kick = 0;
    c.crouch = false;
    c.suppress = 0;
    c.wantX = c.wantY = 0;
    if (by) c.lastAttacker = by;
    this.downs++;
    // Кого он вёл или проверял — отпущены; его самого не проверяют.
    for (const o of this.entities.list) if (o.law.handler === c && o !== c && o.law.phase !== 'jailed') this.law.clear(o);
    if (c.law.phase === 'ordered' || c.law.phase === 'checking' || c.law.phase === 'fleeing') this.law.clear(c);
    c.say(this.rng.pick(DOWNED.lines.down), this.time, 2.5);
    if (c.isPlayer) this.bus.emit('log', { text: `Вы тяжело ранены: ${DOWNED.time} с, пока свои не поднимут. E — не ждать помощи.`, kind: 'law' });
    else if (by?.isPlayer) this.bus.emit('log', { text: `Тяжело ранен: ${c.name}.`, kind: 'world' });
  }

  /** Кто сейчас поднимает лежащего (или null). */
  reviverOf(t: Character): Character | null {
    for (const o of this.entities.list) if (o.reviving === t && o.reviveUntil > 0) return o;
    return null;
  }

  /**
   * Может ли h поднять лежащего t (свой, рядом, есть бинт или аптечка) — или, если arrest,
   * «стабилизировать» и задержать (сотрудник Протектората и враг Протектората).
   */
  canRevive(h: Character, t: Character, arrest = false): boolean {
    if (!t.alive || !t.downed || !h.fit || h === t || this.busy(h)) return false;
    if (Math.hypot(t.x - h.x, t.y - h.y) > DOWNED.reach + h.radius) return false;
    const other = this.reviverOf(t);
    if (other && other !== h) return false;
    if (arrest) return FACTIONS[h.faction].authority && !FACTIONS[t.faction].authority && (t.faction === 'rebel' || t.hostile);
    return !this.isHostile(h, t) && !(FACTIONS[h.faction].authority && !FACTIONS[t.faction].authority && (t.faction === 'rebel' || t.hostile)) && this.hasDressing(h);
  }

  /** Начать поднимать лежащего (DOWNED.reviveTime с, медик быстрее) или стабилизировать для ареста. */
  startRevive(h: Character, t: Character, arrest = false): boolean {
    if (!this.canRevive(h, t, arrest)) return false;
    this.stopDrag(h);
    h.reviveUntil = this.time + (arrest ? DOWNED.cuffTime : DOWNED.reviveTime * (isMedic(h) ? DOWNED.medicMul : 1));
    h.reviving = t;
    h.reviveArrest = arrest;
    h.aim = 0;
    const lines = arrest ? DOWNED.lines.cuff : FACTIONS[h.faction].authority ? DOWNED.lines.cpHelp : DOWNED.lines.help;
    h.say(this.rng.pick(lines), this.time, 2);
    return true;
  }

  /** Бросить поднимать (отошёл, сам ранен, лежащий умер). */
  cancelRevive(h: Character): void {
    h.reviveUntil = 0;
    h.reviving = null;
    h.reviveArrest = false;
  }

  /** Поднят (или стабилизирован и задержан): встаёт с долей здоровья, хромает. */
  private finishRevive(h: Character): void {
    const t = h.reviving;
    const arrest = h.reviveArrest;
    this.cancelRevive(h);
    if (!t || !t.alive || !t.downed || !h.fit || Math.hypot(t.x - h.x, t.y - h.y) > DOWNED.reach + h.radius + 14) return;
    if (arrest) {
      this.raise(t, t.maxHealth * DOWNED.reviveHp * 0.6);
      // Ствол отобран (в руки уже не взять), задержанный больше не «напавший».
      this.equip(t, null);
      t.hostile = false;
      this.law.arrest(h, t, t.faction === 'rebel' ? 'rebel' : 'resisting');
      return;
    }
    const medic = isMedic(h);
    const id = h.inventory.has('medkit') && (medic || !h.inventory.has('bandage')) ? 'medkit' : 'bandage';
    if (!h.inventory.remove(id, 1)) return;
    this.raise(t, t.maxHealth * (id === 'medkit' ? DOWNED.kitHp : DOWNED.reviveHp) * (medic ? DOWNED.medicHp : 1));
    this.revives++;
    if (t.isPlayer) this.bus.emit('log', { text: `${h.name} поднял вас на ноги.`, kind: 'system' });
    else if (h.isPlayer) this.bus.emit('log', { text: `Вы подняли ${t.name}.`, kind: 'system' });
  }

  /** Встать после тяжёлого ранения с hp здоровья (кровь остановлена, хромает). */
  private raise(t: Character, hp: number): void {
    t.downedUntil = 0;
    t.health = Math.max(1, Math.min(t.maxHealth, hp));
    t.bleed = 0;
    t.limpUntil = this.time + HITS.limpTime;
    t.lastHurt = this.time;
    this.stopDrag(t);
  }

  /** Тащить лежащего (свой или пленный — кто угодно рядом, кого ещё не тащат). */
  startDrag(h: Character, t: Character): boolean {
    if (!t.alive || !t.downed || !h.fit || this.busy(h) || t.draggedBy || h.dragging) return false;
    if (Math.hypot(t.x - h.x, t.y - h.y) > DOWNED.reach + h.radius) return false;
    h.dragging = t;
    t.draggedBy = h;
    return true;
  }

  /** Отпустить (кого тащит c или кто тащит c). */
  stopDrag(c: Character): void {
    if (c.dragging) {
      c.dragging.draggedBy = null;
      c.dragging = null;
    }
    if (c.draggedBy) {
      c.draggedBy.dragging = null;
      c.draggedBy = null;
    }
  }

  /** Лежащий на верёвке: в DOWNED.dragDist px позади тащащего (сквозь стены не тянется). */
  private updateDrag(): void {
    for (const c of this.entities.list) {
      const t = c.dragging;
      if (!t) continue;
      const d = Math.hypot(t.x - c.x, t.y - c.y);
      if (!t.alive || !t.downed || !c.fit || d > DOWNED.dragBreak) {
        this.stopDrag(c);
        continue;
      }
      if (d > DOWNED.dragDist) {
        const k = (d - DOWNED.dragDist) / d;
        t.x -= (t.x - c.x) * k;
        t.y -= (t.y - c.y) * k;
        resolveCircleVsTiles(this.map, t, t.radius);
      }
    }
  }

  /**
   * Прячется ли присевший t за бетонным блоком от взгляда из (ox, oy): блок на линии не дальше
   * CROUCH.coverReach от него, смотрящий дальше hideMinDist, t давно не стрелял.
   */
  concealed(t: Character, ox: number, oy: number): boolean {
    if (!t.crouch || this.time - t.lastFired < CROUCH.revealAfterShot) return false;
    const d = Math.hypot(ox - t.x, oy - t.y);
    if (d < CROUCH.hideMinDist) return false;
    let block = false;
    castRayWith(this.map, t.x, t.y, (ox - t.x) / d, (oy - t.y) / d, CROUCH.coverReach, (x, y) => {
      if (this.map.tileAt(x, y) === T.BARRIER) block = true;
      return block || this.map.blocksShot(x, y);
    });
    return block;
  }

  /** Кто слушает гибель персонажей: постоянный состав (возрождение), выборы коменданта. */
  readonly deathListeners: ((c: Character, killer: Character | null) => void)[] = [];

  /** Задаёт WarSystem: ранение/гибель (тревога при нападении на ВС в городе). */
  onDamage: (target: Character, attacker: Character | null, killed: boolean) => void = () => {};

  kill(c: Character, killer: Character | null, how: string | null = null): void {
    c.alive = false;
    c.health = 0;
    // Раны, огонь, оглушение и отдача в новую жизнь не переходят (игрок возрождается тем же персонажем).
    c.bleed = 0;
    c.bandageUntil = 0;
    c.plantUntil = 0;
    c.limpUntil = c.armUntil = 0;
    c.burnUntil = 0;
    c.stunUntil = 0;
    c.speedMul = 1;
    c.recoil = c.kick = c.aim = 0;
    c.wantX = c.wantY = c.vx = c.vy = 0;
    c.suppress = 0;
    c.crouch = false;
    c.downedUntil = 0;
    c.badAmmo = false;
    this.cancelRevive(c);
    this.stopDrag(c);
    this.kills++;
    const loot = c.inventory.takeAll();
    // Надетое — на теле; у бойца в форме (ВС, армия) с шансом — шлем и бронежилет его стороны.
    loot.push(...gearLoot(c));
    const drop = GEAR.drops[c.faction];
    if (drop && this.rng.chance(GEAR.dropChance)) {
      const a = roleArmor(c);
      if (a.head > 0) loot.push({ id: drop.head, qty: 1 });
      if (a.torso > 0) loot.push({ id: drop.torso, qty: 1 });
    }
    c.weapon = null;
    c.mag = 0;
    c.mags = {};
    this.corpses.push({ x: c.x, y: c.y, faction: c.faction, profession: c.profession, killer, rank: c.rank, name: c.name, until: this.time + COMBAT.corpseTime, loot });
    // Разорвать связи: кого он вёл/проверял, кто вёл его.
    for (const o of this.entities.list) if (o.law.handler === c && o !== c) this.law.clear(o);
    if (c.law.phase !== 'none') this.law.release(c);
    // Убийство выдаёт подпольщика под личиной: теперь его узнают, а за убитого из Протектората — враг и розыск.
    if (killer && killer !== c && killer.disguised) {
      this.reveal(killer, `убили ${c.name}`);
      if (FACTIONS[c.faction].authority && !FACTIONS[killer.faction].authority) {
        killer.hostile = true;
        killer.law.wanted = true;
      }
    }
    // Реплики: убийца радуется, свои рядом замечают потерю.
    if (killer && killer !== c) bark(killer, 'kill', this.time, this.rng);
    const side = barkSide(c);
    for (const o of this.entities.near(c.x, c.y, BARKS.manDownRadius, near)) {
      if (o !== c && o !== killer && o.alive && barkSide(o) === side && lineOfSight(this.map, o.x, o.y, c.x, c.y)) {
        if (bark(o, 'manDown', this.time, this.rng)) break;
      }
    }
    const who = c.isPlayer ? 'Вы погибли' : `Убит: ${c.name} (${FACTIONS[c.faction].role})`;
    const by = killer ? (killer.isPlayer ? ' — вами' : ` — ${killer.name}`) : '';
    const why = how ?? (c.lastZone === 'head' ? HITS.headshotLine : null);
    this.bus.emit('log', { text: who + by + (why ? ` (${why})` : ''), kind: FACTIONS[c.faction].authority ? 'radio' : 'world' });
    if (c.isPlayer) c.respawnAt = this.time + COMBAT.respawnDelay;
    else this.dead.push(c);
    for (const l of this.deathListeners) l(c, killer);
  }

  /** Лечение медиком / аптечкой: останавливает кровотечение. true — если было кого лечить. */
  heal(target: Character, amount: number): boolean {
    if (!target.alive) return false;
    // Медик ставит тяжелораненого на ноги.
    if (target.downed) {
      this.raise(target, target.maxHealth * DOWNED.reviveHp * DOWNED.medicHp);
      this.revives++;
      return true;
    }
    if (target.health >= target.maxHealth && target.bleed <= 0) return false;
    target.health = Math.min(target.maxHealth, target.health + amount);
    target.bleed = 0;
    return true;
  }

  /** Есть чем перевязаться (бинт или аптечка). */
  hasDressing(c: Character): boolean {
    return c.inventory.has('bandage') || c.inventory.has('medkit');
  }

  /**
   * Начать перевязку (B у игрока; NPC — сам): HITS.bandageTime с стоит, потом бинт (или аптечка)
   * останавливает кровотечение и немного лечит; аптечка ещё и снимает хромоту и рану руки.
   */
  startBandage(c: Character): boolean {
    if (!c.alive || this.bandaging(c) || !this.hasDressing(c)) return false;
    if (c.bleed <= 0 && c.health >= c.maxHealth) return false;
    c.bandageUntil = this.time + HITS.bandageTime;
    c.aim = 0;
    return true;
  }

  private finishBandage(c: Character): void {
    c.bandageUntil = 0;
    // Сильно ранен — аптечка, иначе бинт (аптечки берегут).
    const wantKit = c.health < c.maxHealth * 0.5 || !c.inventory.has('bandage');
    const id = wantKit && c.inventory.has('medkit') ? 'medkit' : c.inventory.has('bandage') ? 'bandage' : 'medkit';
    if (!c.inventory.remove(id, 1)) return;
    c.bleed = 0;
    c.health = Math.min(c.maxHealth, c.health + (ITEMS[id].heal ?? 0));
    if (id === 'medkit') c.limpUntil = c.armUntil = 0;
    if (c.isPlayer) this.bus.emit('log', { text: id === 'medkit' ? 'Рана обработана аптечкой.' : 'Перевязались: кровь остановлена.', kind: 'system' });
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

  /** След на земле (ограниченный список: старые уходят первыми). */
  addDecal(x: number, y: number, kind: Decal['kind'], life: number, ang: number, size: number): void {
    const D = COMBAT.decals;
    this.decals.push({ x, y, kind, until: this.time + life, ang, size });
    if (this.decals.length > D.max) this.decals.splice(0, this.decals.length - D.max);
  }

  /** Может ли бросить гранату (kind — какую; без kind — любую). */
  canThrow(c: Character, kind: GrenadeId | null = null): boolean {
    if (!c.alive || this.time < c.nextGrenade || c.stunUntil > this.time || this.busy(c)) return false;
    return kind ? c.inventory.has(kind) : GRENADE_KINDS.some((k) => c.inventory.has(k));
  }

  /**
   * Бросить гранату к точке (не дальше GRENADE.maxThrow). Стена останавливает полёт — граната
   * падает перед ней; бетонный блок перелетает. kind — какую (по умолчанию выбранную c.grenadeKind,
   * если её нет — первую, что есть). Возвращает гранату или null.
   */
  throwGrenade(c: Character, tx: number, ty: number, kind: GrenadeId | null = null): Grenade | null {
    const k = kind ?? (c.inventory.has(c.grenadeKind) ? c.grenadeKind : GRENADE_KINDS.find((g) => c.inventory.has(g)) ?? null);
    if (!k || !this.canThrow(c, k)) return null;
    const G = GRENADE;
    let d = Math.hypot(tx - c.x, ty - c.y);
    const ang = Math.atan2(ty - c.y, tx - c.x);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    d = Math.max(G.minThrow, Math.min(G.maxThrow, d));
    const wall = castRayWith(this.map, c.x, c.y, dx, dy, d, (x, y) => this.map.blocksShot(x, y));
    const land = Math.max(0, Math.min(d, wall - 8));
    c.inventory.remove(k, 1);
    c.nextGrenade = this.time + G.cooldown;
    c.facing = ang;
    const fuse = k === 'smoke_grenade' ? G.smoke.fuse : k === 'fire_grenade' ? G.fire.fuse : G.fuse;
    const g: Grenade = {
      kind: k, x: c.x, y: c.y, x0: c.x, y0: c.y, x1: c.x + dx * land, y1: c.y + dy * land,
      flight: 0, dur: Math.max(0.15, land / G.speed), at: this.time + fuse, thrower: c,
    };
    this.grenades.push(g);
    this.grenadesThrown++;
    return g;
  }

  /** Какой гранатой минировать: выбранной (если не дымовая), иначе осколочной или зажигательной. */
  mineKindOf(c: Character): 'grenade' | 'fire_grenade' | null {
    if (c.grenadeKind !== 'smoke_grenade' && c.inventory.has(c.grenadeKind)) return c.grenadeKind;
    return c.inventory.has('grenade') ? 'grenade' : c.inventory.has('fire_grenade') ? 'fire_grenade' : null;
  }

  /** Начать ставить растяжку под ноги (MINE.plantTime с). false — нечем или занят. */
  startPlant(c: Character, kind: 'grenade' | 'fire_grenade' | null = this.mineKindOf(c)): boolean {
    if (!kind || !c.alive || this.busy(c) || !c.inventory.has(kind)) return false;
    c.plantUntil = this.time + MINE.plantTime;
    c.plantKind = kind;
    c.aim = 0;
    return true;
  }

  /** Растяжка поставлена (граната из инвентаря): рядом тело — минируется тело. */
  plantMine(c: Character, kind: 'grenade' | 'fire_grenade', x = c.x, y = c.y): Mine | null {
    if (!c.inventory.remove(kind, 1)) return null;
    let corpse: Corpse | null = null;
    let bestD: number = MINE.corpseReach;
    for (const k of this.corpses) {
      const d = Math.hypot(k.x - x, k.y - y);
      if (d < bestD && !this.mines.some((m) => m.corpse === k)) {
        bestD = d;
        corpse = k;
      }
    }
    const m: Mine = { x: corpse ? corpse.x : x, y: corpse ? corpse.y : y, kind, owner: c, alliance: FACTIONS[c.faction].authority, armedAt: this.time + MINE.arm, corpse };
    this.mines.push(m);
    if (this.mines.length > MINE.max) this.mines.shift();
    this.mineStats.planted++;
    if (c.isPlayer) this.bus.emit('log', { text: corpse ? `Тело заминировано (${ITEMS[kind].name.toLowerCase()}).` : `Растяжка поставлена (${ITEMS[kind].name.toLowerCase()}). Своих не заденет.`, kind: 'system' });
    return m;
  }

  /** Задевает ли растяжку этот персонаж: враг стороны ставившего (мирные — нет). */
  private minesFor(m: Mine, o: Character): boolean {
    if (!o.alive || o === m.owner) return false;
    if (m.alliance) return (o.faction === 'rebel' && !o.disguised) || o.hostile;
    return FACTIONS[o.faction].authority;
  }

  /** Растяжки: сработать от врага рядом; сотрудники Протектората замечают и обезвреживают чужие. */
  private updateMines(dt: number): void {
    this.mineScan -= dt;
    const scan = this.mineScan <= 0;
    if (scan) this.mineScan = MINE.scanEvery;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      // Заминированное тело сожгли или увезли — растяжка вместе с ним.
      if (m.corpse && !this.corpses.includes(m.corpse)) {
        this.mines.splice(i, 1);
        continue;
      }
      if (this.time < m.armedAt) continue;
      let fired = false;
      for (const o of this.entities.near(m.x, m.y, MINE.trigger + 12, near)) {
        if (Math.hypot(o.x - m.x, o.y - m.y) < MINE.trigger + o.radius * 0.5 && this.minesFor(m, o)) {
          fired = true;
          break;
        }
      }
      if (fired) {
        this.mines.splice(i, 1);
        this.mineStats.triggered++;
        // Щелчок — и взрыв через delay: граната «уже на земле».
        this.grenades.push({ kind: m.kind, x: m.x, y: m.y, x0: m.x, y0: m.y, x1: m.x, y1: m.y, flight: 1, dur: 0.1, at: this.time + MINE.delay, thrower: m.owner });
        continue;
      }
      if (!scan || m.alliance) continue;
      // Заметить чужую растяжку: сотрудник Протектората видит её вблизи (в угле обзора, прямая видимость).
      for (const o of this.entities.near(m.x, m.y, MINE.spot, near)) {
        if (!o.alive || o.isPlayer || !FACTIONS[o.faction].authority) continue;
        const a = Math.atan2(m.y - o.y, m.x - o.x);
        if (Math.abs(angleDiff(a, o.facing)) > Math.PI / 3 || !lineOfSight(this.map, o.x, o.y, m.x, m.y)) continue;
        if (!this.rng.chance(MINE.spotChance * MINE.scanEvery)) continue;
        this.mines.splice(i, 1);
        this.mineStats.defused++;
        o.say(this.rng.pick(MINE.lines.spot), this.time, 2);
        this.bus.emit('log', { text: `Надзор: ${o.name} обезвредил растяжку — ${this.map.zoneAtWorld(m.x, m.y)?.name ?? 'город'}.`, kind: 'radio' });
        break;
      }
    }
  }

  /** Поджечь: горит time с, урон FIRE.dps в секунду (засчитывается поджёгшему). */
  ignite(c: Character, by: Character | null, time: number = FIRE.burnTime): void {
    c.burnUntil = Math.max(c.burnUntil, this.time + time);
    c.burnBy = by;
  }

  /** Сколько бросков и взрывов было (для тестов и отладки). */
  grenadesThrown = 0;

  /** Множитель урона взрыва по линии: стена — 0, бетонный блок — ослабляет. */
  private blastCover(x0: number, y0: number, x1: number, y1: number): number {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1) return 1;
    let mul = 1;
    let inBarrier = false;
    castRayWith(this.map, x0, y0, (x1 - x0) / d, (y1 - y0) / d, d, (x, y) => {
      if (this.map.blocksShot(x, y)) {
        mul = 0;
        return true;
      }
      const b = this.map.tileAt(x, y) === T.BARRIER;
      if (b && !inBarrier) mul *= GRENADE.barrierMul;
      inBarrier = b;
      return false;
    });
    return mul;
  }

  /** Граната сработала. */
  private detonate(g: Grenade): void {
    const G = GRENADE;
    const by = g.thrower.alive || g.thrower.isPlayer ? g.thrower : null;
    if (g.kind === 'smoke_grenade') {
      this.addSmoke(g.x, g.y);
      this.shots.push({ x: g.x, y: g.y, t: this.time, shooter: g.thrower, weapon: 'smoke', noise: 500 });
      return;
    }
    if (g.kind === 'fire_grenade') {
      this.fires.push({ x: g.x, y: g.y, r: G.fire.radius, until: this.time + G.fire.time, owner: g.thrower });
      this.blasts.push({ x: g.x, y: g.y, t: 0.5, life: 0.5, r: G.fire.radius, kind: 'fire' });
      this.addDecal(g.x, g.y, 'scorch', COMBAT.decals.scorchTime, this.rng.range(0, Math.PI), 0.9);
      this.shots.push({ x: g.x, y: g.y, t: this.time, shooter: g.thrower, weapon: 'blast', noise: G.noise * 0.6 });
      this.emit('fire', g.x, g.y, 0, null, by, null, 'blast', G.fire.radius);
      for (const o of this.entities.near(g.x, g.y, G.fire.radius, near)) {
        if (!o.alive || this.blastCover(g.x, g.y, o.x, o.y) <= 0) continue;
        this.ignite(o, by);
        this.damage(o, G.fire.damage * (1 - Math.hypot(o.x - g.x, o.y - g.y) / (G.fire.radius * 1.4)), by, 'blast');
      }
      return;
    }
    // Осколочная (у пиротехника — ещё и пламя, как раньше).
    this.explode(g.x, g.y, g.thrower, 'frag', 1);
    if (g.thrower.profession === 'pyro') this.fires.push({ x: g.x, y: g.y, r: G.radius * FIRE.zoneRadiusMul, until: this.time + FIRE.zoneTime, owner: g.thrower });
  }

  /**
   * Взрыв (граната, ракета): урон по кругу GRENADE.radius × mul от центра к краю (стена закрывает,
   * блок ослабляет, жилет держит HITS.blastVest своей доли), осколки ранят и дальше — по рукам и
   * ногам с шансом; всем — кровотечение.
   */
  explode(x: number, y: number, thrower: Character, kind: 'frag' | 'rocket', mul: number): void {
    const G = GRENADE;
    const R = G.radius * mul;
    const by = thrower.alive || thrower.isPlayer ? thrower : null;
    this.blasts.push({ x, y, t: COMBAT.blastTime, life: COMBAT.blastTime, r: R, kind });
    this.addDecal(x, y, 'scorch', COMBAT.decals.scorchTime, this.rng.range(0, Math.PI), mul);
    this.shots.push({ x, y, t: this.time, shooter: thrower, weapon: 'blast', noise: G.noise });
    this.emit('blast', x, y, this.rng.range(0, Math.PI * 2), kind === 'rocket' ? 'launcher' : null, by, null, 'blast', R);
    const reach = R * G.fragReach;
    for (const o of this.entities.near(x, y, reach + 16, near)) {
      if (!o.alive) continue;
      const d = Math.max(0, Math.hypot(o.x - x, o.y - y) - o.radius * 0.5);
      if (d > reach) continue;
      const cover = this.blastCover(x, y, o.x, o.y);
      if (cover <= 0) continue;
      const vest = armorOf(o).torso * HITS.blastVest;
      if (d <= R) {
        const k = 1 - (d / R) * (1 - G.edge);
        o.aim = 0;
        const dmg = G.damage * mul * k * cover * (1 - vest);
        this.wound(o, dmg, 'blast');
        // Вплотную к взрыву — насмерть, без тяжёлого ранения.
        this.damage(o, dmg, by, 'blast', d <= R * DOWNED.blastInstant && cover >= 0.99);
      } else if (this.rng.chance(G.fragChance * cover)) {
        // Осколок на излёте — в руку или ногу.
        const zone: HitZone = this.rng.chance(0.5) ? 'arm' : 'leg';
        const dmg = G.fragDamage * mul * (1 - (d - R) / (reach - R));
        this.emit('hit', o.x, o.y, Math.atan2(o.y - y, o.x - x), null, by, o, zone, dmg, false);
        this.wound(o, dmg, zone);
        this.damage(o, dmg, by, zone);
      }
    }
    // Взрыв прижимает всех вокруг.
    const S = R * SUPPRESS.blastReach;
    for (const o of this.entities.near(x, y, S, near)) {
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < S) this.press(o, SUPPRESS.blast * (1 - d / S));
    }
  }

  /** Дымовая завеса: тайлы в радиусе (куда дым дотекает, не сквозь стены) непрозрачны. */
  private addSmoke(x: number, y: number): void {
    const S = GRENADE.smoke;
    const ts = this.map.tileSize;
    const r = S.radius;
    const tiles: number[] = [];
    const cx = Math.floor(x / ts);
    const cy = Math.floor(y / ts);
    const rt = Math.ceil(r / ts);
    for (let ty = cy - rt; ty <= cy + rt; ty++) {
      for (let tx = cx - rt; tx <= cx + rt; tx++) {
        if (!this.map.inBounds(tx, ty) || this.map.blocksShot(tx, ty)) continue;
        const wx = (tx + 0.5) * ts;
        const wy = (ty + 0.5) * ts;
        if (Math.hypot(wx - x, wy - y) > r) continue;
        if (!lineOfSightShot(this.map, x, y, wx, wy)) continue;
        const i = ty * this.map.width + tx;
        tiles.push(i);
      }
    }
    for (const i of tiles) this.map.smoke[i]++;
    this.smokes.push({ x, y, r, born: this.time, until: this.time + S.time, tiles });
    this.emit('smoke', x, y, 0, null, null, null, null, r);
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = this.blasts.length - 1; i >= 0; i--) if ((this.blasts[i].t -= dt) <= 0) this.blasts.splice(i, 1);
    if (this.decals.length && this.decals[0].until < this.time) {
      let k = 0;
      while (k < this.decals.length && this.decals[k].until < this.time) k++;
      this.decals.splice(0, k);
    }
    // Дым рассеивается.
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      if (this.time < s.until) continue;
      for (const t of s.tiles) if (this.map.smoke[t] > 0) this.map.smoke[t]--;
      this.smokes.splice(i, 1);
    }
    // Пламя: кто в нём — горит; горящие получают урон.
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (this.time >= f.until) {
        this.fires.splice(i, 1);
        continue;
      }
      for (const o of this.entities.near(f.x, f.y, f.r, near)) if (o.alive) this.ignite(o, f.owner);
    }
    for (const c of this.entities.list) {
      if (!c.alive || c.burnUntil <= this.time) continue;
      this.damage(c, FIRE.dps * dt, c.burnBy && c.burnBy.alive ? c.burnBy : null);
    }
    // Гранаты: полёт по прямой к точке падения, взрыв по запалу.
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (g.flight < 1) {
        g.flight = Math.min(1, g.flight + dt / g.dur);
        g.x = g.x0 + (g.x1 - g.x0) * g.flight;
        g.y = g.y0 + (g.y1 - g.y0) * g.flight;
      }
      if (this.time >= g.at) {
        this.grenades.splice(i, 1);
        this.detonate(g);
      }
    }
    this.updateBullets(dt);
    this.updateMines(dt);
    this.updateDrag();
    for (let i = this.swings.length - 1; i >= 0; i--) if ((this.swings[i].t -= dt) <= 0) this.swings.splice(i, 1);
    for (let i = this.corpses.length - 1; i >= 0; i--) if (this.corpses[i].until < this.time) this.corpses.splice(i, 1);
    while (this.shots.length > 0 && this.time - this.shots[0].t > 2) this.shots.shift();
    // Убитые NPC уходят из мира после тика (не посреди обхода списка мозгами).
    for (const c of this.dead) this.entities.remove(c);
    this.dead.length = 0;
    for (const c of this.entities.list) {
      if (!c.alive) continue;
      // Тяжелораненый: не дождался помощи — смерть от ранившего.
      if (c.downed) {
        if (this.time >= c.downedUntil) {
          const killer = c.lastAttacker && (c.lastAttacker.alive || c.lastAttacker.isPlayer) ? c.lastAttacker : null;
          this.bledOut++;
          this.kill(c, killer, 'истёк кровью');
          this.onDamage(c, killer, true);
          continue;
        }
        c.speedMul = c.draggedBy ? 0 : c.isPlayer ? DOWNED.crawl : 0;
        c.aim = 0;
        if (this.rng.chance(COMBAT.decals.bleedDrip * 1.5 * dt)) {
          this.addDecal(c.x + this.rng.range(-8, 8), c.y + this.rng.range(-6, 8), 'blood', COMBAT.decals.bloodTime, this.rng.range(0, Math.PI), this.rng.range(0.4, 0.8));
        }
        continue;
      }
      // Подавление спадает, если давно не прибавлялось.
      if (c.suppress > 0 && this.time - c.suppressAt > SUPPRESS.hold) c.suppress = Math.max(0, c.suppress - SUPPRESS.decay * dt);
      // Поднимает раненого: отошёл или тот умер — бросил; время вышло — поднял.
      if (c.reviveUntil > 0) {
        const t = c.reviving;
        if (!t || !t.alive || !t.downed || Math.hypot(t.x - c.x, t.y - c.y) > DOWNED.reach + c.radius + 14) this.cancelRevive(c);
        else if (this.time >= c.reviveUntil) this.finishRevive(c);
      }
      const w = this.weaponOf(c);
      // Перезарядка: магазином или по патрону (дробовик — пока не полон или не кончится запас).
      if (c.reloadUntil > 0 && this.time >= c.reloadUntil) {
        c.reloadUntil = 0;
        if (w?.perRound) {
          this.loadInstant(c, 1);
          if (c.mag < w.magazine && this.reserveAmmo(c) > 0) c.reloadUntil = this.time + w.reload;
        } else this.loadInstant(c);
      }
      // Перевязка: закончилась — кровь остановлена; NPC перевязывается сам, когда в него давно не попадали.
      if (c.bandageUntil > 0 && this.time >= c.bandageUntil) this.finishBandage(c);
      if (c.plantUntil > 0 && this.time >= c.plantUntil) {
        c.plantUntil = 0;
        this.plantMine(c, c.plantKind === 'fire_grenade' ? 'fire_grenade' : 'grenade');
      }
      if (!c.isPlayer && c.bleed > 0 && c.bandageUntil === 0 && this.time - c.lastHurt > COMBAT.selfHealCalm && this.hasDressing(c) && c.law.phase === 'none') {
        if (this.startBandage(c)) c.say('Перевязываюсь!', this.time, 1.5);
      }
      // Оглушение, перевязка, хромота — медленнее.
      const stunned = c.stunUntil > this.time;
      const dressing = this.busy(c);
      c.speedMul = (stunned ? COMBAT.stunSpeedMul : 1) * (dressing ? COMBAT.bandageSpeedMul : 1) * (c.limpUntil > this.time ? HITS.limp : 1) * (c.crouch ? CROUCH.speedMul : 1) * (c.dragging ? DOWNED.dragSpeed : 1);
      // Прицеливание копится стоя (при ходьбе — медленнее), теряется на бегу, без ПКМ и при перезарядке.
      if (w && w.mode !== 'melee') {
        const running = c.moveSpeed > CHARACTER.walkSpeed * 1.2;
        if (c.aiming && !running && !stunned && !dressing && !this.reloading(c)) {
          const steady = (c.crouch ? CROUCH.aimMul : 1) * (1 - c.suppress * SUPPRESS.aimSlow);
          c.aim = Math.min(1, c.aim + (dt / w.aimTime) * (c.moveSpeed > 20 ? COMBAT.aimWhileMoving : 1) * steady);
        } else c.aim = Math.max(0, c.aim - dt * (running ? COMBAT.aimLossRun : COMBAT.aimLoss));
        c.recoil = Math.max(0, c.recoil - w.recovery * dt);
        // Ствол возвращается на линию прицела.
        const back = w.recovery * DEG * dt * COMBAT.kickReturn;
        c.kick = Math.abs(c.kick) <= back ? 0 : c.kick - Math.sign(c.kick) * back;
      } else {
        c.aim = 0;
        c.recoil = 0;
        c.kick = 0;
      }
      // Кровотечение — пока не перевяжут; истёк кровью — смерть от того, кто ранил.
      if (c.bleed > 0) {
        c.health -= c.bleed * dt;
        if (this.rng.chance(Math.min(1, c.bleed * COMBAT.decals.bleedDrip * dt))) {
          this.addDecal(c.x + this.rng.range(-6, 6), c.y + this.rng.range(-4, 8), 'blood', COMBAT.decals.bloodTime, this.rng.range(0, Math.PI), this.rng.range(0.25, 0.5));
        }
        if (c.health <= 0) {
          // Истёк кровью до потери сознания — тяжёлое ранение (дальше таймер DOWNED.time).
          const killer = c.lastAttacker && (c.lastAttacker.alive || c.lastAttacker.isPlayer) ? c.lastAttacker : null;
          this.down(c, killer);
          continue;
        }
      } else if (this.time - c.lastHurt > COMBAT.regenDelay && c.health < c.maxHealth * COMBAT.regenCap) {
        // Регенерация — только без кровотечения и если давно не ранили.
        c.health = Math.min(c.maxHealth * COMBAT.regenCap, c.health + COMBAT.regenPerSec * dt);
      }
    }
  }

  /**
   * Пули летят; долетевшие попадают. Долетевшая остаётся в списке ещё на тик (done) — хвост
   * дорисуется до точки попадания. Ракета проверяет попадание на лету.
   */
  private updateBullets(dt: number): void {
    let k = 0;
    for (const b of this.bullets) if (!b.done) this.bullets[k++] = b;
    this.bullets.length = k;
    for (const b of this.bullets) {
      b.px = b.x;
      b.py = b.y;
      const from = b.dist;
      b.dist = Math.min(b.end, b.dist + b.speed * dt);
      if (b.rocket) {
        // Дымный след ракеты.
        b.trailT -= dt;
        if (b.trailT <= 0) {
          b.trailT = ROCKET.trailEvery;
          this.emit('rocket', b.x, b.y, Math.atan2(b.dy, b.dx), 'launcher', b.shooter);
        }
        const o = this.rocketHit(b, from, b.dist);
        if (o !== null) b.end = b.dist = o;
      }
      b.x = b.ox + b.dx * b.dist;
      b.y = b.oy + b.dy * b.dist;
      if (b.dist > from) this.nearMiss(b, from, b.dist);
      if (b.dist >= b.end) {
        b.done = true;
        this.land(b);
      }
    }
  }

  /**
   * Пуля на отрезке [t0, t1] пути прошла рядом: враги стрелка ближе SUPPRESS.radius прижаты (раз на
   * пулю), игрок ближе whizRadius слышит щелчок пролёта.
   */
  private nearMiss(b: Bullet, t0: number, t1: number): void {
    const R = SUPPRESS.radius;
    const mx = b.ox + b.dx * ((t0 + t1) / 2);
    const my = b.oy + b.dy * ((t0 + t1) / 2);
    const side = FACTIONS[b.shooter.faction].authority;
    for (const o of this.entities.near(mx, my, (t1 - t0) / 2 + R + 4, near)) {
      if (o === b.shooter || o === b.target || !o.alive || o.downed || b.pressed?.includes(o)) continue;
      const px = o.x - b.ox;
      const py = o.y - b.oy;
      const tc = Math.max(t0, Math.min(t1, px * b.dx + py * b.dy));
      // Пуля ещё не дошла до него (или уже прошла на прошлом отрезке) — не сейчас.
      if (tc <= t0 && t0 > 0) continue;
      const d = Math.hypot(o.x - (b.ox + b.dx * tc), o.y - (b.oy + b.dy * tc));
      if (d > R) continue;
      (b.pressed ??= []).push(o);
      if (o.isPlayer && d < SUPPRESS.whizRadius) this.emit('whiz', b.ox + b.dx * tc, b.oy + b.dy * tc, Math.atan2(b.dy, b.dx), b.kind, b.shooter, o, null, 1 - d / R);
      // Свои пули не прижимают.
      if (FACTIONS[o.faction].authority !== side) this.press(o, SUPPRESS.perShot * b.press * (1 - (d / R) * 0.5));
    }
  }

  /** Ракета на отрезке [t0, t1] пути задела кого-то (не ближе ROCKET.arm от стрелка) — где. */
  private rocketHit(b: Bullet, t0: number, t1: number): number | null {
    if (t1 < ROCKET.arm) return null;
    const mx = b.ox + b.dx * ((t0 + t1) / 2);
    const my = b.oy + b.dy * ((t0 + t1) / 2);
    let best: number | null = null;
    for (const o of this.entities.near(mx, my, (t1 - t0) / 2 + 16, near)) {
      if (!o.alive || o === b.shooter) continue;
      const px = o.x - b.ox;
      const py = o.y - b.oy;
      const t = px * b.dx + py * b.dy;
      if (t < t0 - o.radius || t > t1 + o.radius) continue;
      const d2 = px * px + py * py - t * t;
      if (d2 > o.radius * o.radius) continue;
      const th = Math.max(t0, t - Math.sqrt(o.radius * o.radius - d2));
      if (best === null || th < best) best = th;
    }
    return best;
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

/** Задержан: в наручниках, его заводят в камеру или он сидит. */
export function inCustody(c: Character): boolean {
  const p = c.law.phase;
  return p === 'cuffed' || p === 'entering' || p === 'jailed';
}

/** Гранаты по порядку выбора (Y у игрока). */
export const GRENADE_KINDS: readonly GrenadeId[] = ['grenade', 'smoke_grenade', 'fire_grenade'];

/** Прямая видимость для дыма: сквозь стены и закрытые двери не течёт (дым сам себе не помеха). */
function lineOfSightShot(map: GameMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1) return true;
  return castRayWith(map, x0, y0, (x1 - x0) / d, (y1 - y0) / d, d, (x, y) => map.blocksShot(x, y)) >= d - 0.5;
}

/** Множитель урона на дистанции d: полный до effectiveRange, дальше линейно до falloff на range. */
export function falloffMul(w: WeaponDef, d: number): number {
  if (d <= w.effectiveRange || w.range <= w.effectiveRange) return 1;
  const k = Math.min(1, (d - w.effectiveRange) / (w.range - w.effectiveRange));
  return 1 + (w.falloff - 1) * k;
}
