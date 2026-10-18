import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Front, WarSystem } from './WarSystem';
import { RebelBrain, type BunkerTask } from '../ai/brains/RebelBrain';
import { OtaBrain } from '../ai/brains/OtaBrain';
import { AMMO_ITEM, KITS, WEAPONS, type WeaponId } from '../config/items';
import { COMMAND } from '../config/roster';
import { WAR } from '../config/war';
import { T } from '../world/tiles';

/** Койка блиндажа: место отдыха (px), якорь для пути и кто занял. */
export interface Bunk {
  x: number;
  y: number;
  anchor: number;
  user: Character | null;
}

/** Чья сейчас землянка: повстанцев или разрушена (Протекторат взорвал, ждёт, пока отстроят). */
export type DugoutOwner = 'rebels' | 'ruined';

/**
 * Передовой блиндаж повстанцев у одного КПП (POI dugout, здание — generator/checkpoints.ts): запас патронов и гранат,
 * койки, подносчик, вылазка Протектората и восстановление. Все числа — WAR.dugout.
 */
export class Dugout {
  owner: DugoutOwner = 'rebels';
  kits: number = WAR.dugout.stock.kits.start;
  grenades: number = WAR.dugout.stock.grenades.start;
  /** Когда разрушен и до какого времени (время Dugouts) нельзя отстраивать. */
  ruinedAt = -Infinity;
  ruinedUntil = 0;
  /** Прогресс отстройки, с. */
  rebuild = 0;
  /** Подносчик (с ящиком) или строитель; следующий выход подносчика. */
  porter: Character | null = null;
  nextSupply: number = WAR.dugout.supply.first;
  /** Подряд потерянных подносчиков/строителей (погиб, не донёс) и до какого времени штаб никого не шлёт (подход простреливается). */
  lost = 0;
  holdUntil = 0;
  /** Вылазка Протектората: легионеры, прогресс заряда, когда началась, когда можно следующую. */
  raiders: Character[] = [];
  charge = 0;
  /** Сколько вылазок было против этого блиндажа. */
  sorties = 0;
  sortieSince = 0;
  nextSortie: number = WAR.dugout.sortie.firstAfter;
  /** Следующая проверка защитников (с). */
  scanAt = 0;

  constructor(
    readonly index: number,
    readonly front: Front,
    /** Пол блиндажа, тайлы. */
    readonly rect: { x: number; y: number; w: number; h: number },
    readonly face: string,
    /** Центр пола, px (координаты света и меток). */
    readonly x: number,
    readonly y: number,
    /** Середина проёма и точка у входа снаружи, px; якорь снаружи. */
    readonly door: Vec2,
    readonly outside: Vec2,
    readonly outsideAnchor: number,
    /** Ящик со снабжением и якорь у него. */
    readonly cache: Vec2,
    readonly cacheAnchor: number,
    readonly bunks: Bunk[],
    /** Якорь в середине пола (ожидание без койки). */
    readonly centerAnchor: number,
  ) {}

  /** Разрушен (для света: ровно как «сломан» у узлов). */
  get broken(): boolean {
    return this.owner === 'ruined';
  }
}

/**
 * Передовые блиндажи повстанцев (WAR.dugout): запас патронов и гранат у каждого КПП, подвоз ящиков из лагеря, отдых и
 * резерв линии (ходить в лагерь тропой через пустошь реже), вылазка Протектората (разрушить блиндаж, где никого нет),
 * отстройка. Работают вместе с линией фронта (RebelCommand.lineEnabled): линии нет — блиндажи молчат.
 * Здание на карте — только генератор; здесь — состояние и поведение. Свой счётчик времени, свои броски — только через ctx.rng.
 */
export class Dugouts {
  readonly list: Dugout[] = [];
  /** Счётчики для тестов и отладки. */
  readonly stats = { supplied: 0, restocked: 0, rests: 0, sorties: 0, ruined: 0, rebuilt: 0, builders: 0, crewLost: 0 };
  private time = 0;

  constructor(
    private readonly ctx: AiContext,
    private readonly war: WarSystem,
  ) {
    this.build();
  }

  get now(): number {
    return this.time;
  }

  /** Блиндажи работают вместе с линией фронта. */
  get enabled(): boolean {
    return this.war.command.lineEnabled && this.list.length > 0;
  }

  /** Блиндаж у фронта (по номеру или самому фронту). */
  of(front: number | Front): Dugout | null {
    const i = typeof front === 'number' ? front : front.index;
    return this.list.find((d) => d.index === i) ?? null;
  }

  /** Цел и пригоден: свой, не разрушен, работа блиндажей включена. */
  usable(d: Dugout | null): d is Dugout {
    return !!d && d.owner === 'rebels' && this.enabled;
  }

  /** Блиндаж, до ящика которого дотянуться из (x, y). */
  cacheNear(x: number, y: number, reach: number): Dugout | null {
    return this.list.find((d) => Math.hypot(d.cache.x - x, d.cache.y - y) <= reach) ?? null;
  }

  // ───────────────────────── Сборка по карте ─────────────────────────

  private build(): void {
    const { map, nav } = this.ctx;
    const ts = map.tileSize;
    for (const p of map.poisOf('dugout')) {
      const rect = { x: p.x, y: p.y, w: p.w ?? 1, h: p.h ?? 1 };
      const inFloor = (q: { x: number; y: number }) => q.x >= rect.x && q.y >= rect.y && q.x < rect.x + rect.w && q.y < rect.y + rect.h;
      const cx = (rect.x + rect.w / 2) * ts;
      const cy = (rect.y + rect.h / 2) * ts;
      // Фронт — тот, чья пустошь ближе.
      let front: Front | null = null;
      let bestD = Infinity;
      for (const f of this.war.fronts) {
        const d = Math.hypot(f.exit.x - cx, f.exit.y - cy);
        if (d < bestD) {
          bestD = d;
          front = f;
        }
      }
      if (!front || this.list.some((d) => d.index === front!.index)) continue;
      // Проём: клетки пола в кольце стен.
      let dx = 0;
      let dy = 0;
      let n = 0;
      for (let y = rect.y - 1; y <= rect.y + rect.h; y++) {
        for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
          if (x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h) continue;
          if (map.tileAt(x, y) !== T.DUGOUT) continue;
          dx += (x + 0.5) * ts;
          dy += (y + 0.5) * ts;
          n++;
        }
      }
      const door = n ? { x: dx / n, y: dy / n } : { x: cx, y: cy };
      const len = Math.hypot(door.x - cx, door.y - cy) || 1;
      const ox = door.x + ((door.x - cx) / len) * ts * 1.5;
      const oy = door.y + ((door.y - cy) / len) * ts * 1.5;
      const outsideAnchor = nav.nearestWalkable(ox, oy, 3);
      const outside = outsideAnchor >= 0 ? { x: nav.worldX(outsideAnchor), y: nav.worldY(outsideAnchor) } : { x: ox, y: oy };
      const cachePoi = map.poisOf('dugout_cache').find(inFloor);
      const cache = cachePoi ? { x: (cachePoi.x + 0.5) * ts, y: (cachePoi.y + 0.5) * ts } : { x: cx, y: cy };
      const cacheAnchor = nav.nearestWalkable(cache.x, cache.y, 2);
      const bunks: Bunk[] = map.poisOf('dugout_bunk').filter(inFloor).map((b) => {
        const x = (b.x + 0.5) * ts;
        const y = (b.y + 0.5) * ts;
        return { x, y, anchor: nav.nearestWalkable(x, y, 2), user: null };
      });
      const centerAnchor = nav.nearestWalkable(cx, cy, 2);
      this.list.push(new Dugout(front.index, front, rect, p.face ?? 'W', cx, cy, door, outside, outsideAnchor, cache, cacheAnchor, bunks, centerAnchor));
    }
  }

  // ───────────────────────── Запас и снабжение ─────────────────────────

  /** Запас ниже доли low (по патронам или по гранатам) — нужен подвоз. */
  needsStock(d: Dugout): boolean {
    const S = WAR.dugout;
    return d.kits < S.low * S.stock.kits.cap || d.grenades < S.low * S.stock.grenades.cap;
  }

  /** Сколько магазинов не хватает бойцу до WAR.dugout.mags по самому недоукомплектованному стволу (в магазинах). */
  ammoShort(c: Character): number {
    let worst = 0;
    for (const s of c.inventory.slots) {
      const w = WEAPONS[s.id as WeaponId];
      if (!w?.ammo) continue;
      const need = w.magazine * WAR.dugout.mags - c.inventory.count(AMMO_ITEM[w.ammo]);
      worst = Math.max(worst, need / w.magazine);
    }
    return worst;
  }

  /** Гранат в наборе роли и сколько сейчас. */
  private grenadesWanted(c: Character): number {
    const kit = KITS[c.role?.kit ?? ''] ?? [];
    return kit.find(([id]) => id === 'grenade')?.[1] ?? 0;
  }

  /** Бойцу есть чем пополниться в блиндаже. */
  canRestock(d: Dugout, c: Character): boolean {
    if (d.kits > 0 && this.ammoShort(c) >= 1) return true;
    return d.grenades > 0 && c.inventory.count('grenade') < this.grenadesWanted(c);
  }

  /** Боец у ящика: пополнить патроны (до WAR.dugout.mags магазинов) и гранаты (до набора). Что взял — для реплики. */
  resupply(c: Character, d: Dugout): string | null {
    const got: string[] = [];
    if (d.kits > 0 && this.ctx.economy.refillAmmo(c, WAR.dugout.mags) > 0) {
      d.kits--;
      got.push('магазины');
    }
    const lack = this.grenadesWanted(c) - c.inventory.count('grenade');
    const n = Math.min(lack, d.grenades);
    if (n > 0 && c.inventory.add('grenade', n) > 0) {
      d.grenades -= n;
      got.push(n > 1 ? `гранаты ×${n}` : 'граната');
    }
    if (!got.length) return null;
    this.stats.restocked++;
    return got.join(', ');
  }

  /** Подносчик дошёл: ящик в запас. */
  deliver(c: Character, d: Dugout): void {
    const S = WAR.dugout;
    d.kits = Math.min(S.stock.kits.cap, d.kits + S.supply.perCrate.kits);
    d.grenades = Math.min(S.stock.grenades.cap, d.grenades + S.supply.perCrate.grenades);
    c.carrying = false;
    if (d.porter === c) d.porter = null;
    d.lost = 0;
    this.stats.supplied++;
    c.say(this.ctx.rng.pick(S.lines.bring), this.ctx.law.now, 2);
    this.ctx.insurgency.radio(`${d.front.name}: в блиндаж доставлен ящик — патронов ${d.kits}/${S.stock.kits.cap}, гранат ${d.grenades}/${S.stock.grenades.cap}.`);
  }

  // ───────────────────────── Койки, отдых, резерв ─────────────────────────

  /** Бойцы фронта в блиндаже (режим bunker) с задачей отдыха или резерва — они занимают койки. */
  private sitters(d: Dugout, except: Character | null = null): Character[] {
    const out: Character[] = [];
    for (const c of this.war.command.army) {
      const b = c.brain;
      if (c === except || !c.alive || !(b instanceof RebelBrain) || b.mode !== 'bunker' || b.front !== d.index || b.bunkerTask === 'restock') continue;
      out.push(c);
    }
    return out;
  }

  /** Сколько бойцов отдыхает или ждёт замены в блиндаже (резерв линии). */
  reserveCount(d: Dugout): number {
    return this.sitters(d).length;
  }

  /** Сколько бойцов сейчас в блиндаже или идёт в него (в том числе за патронами). */
  garrison(d: Dugout): number {
    let n = 0;
    for (const c of this.war.command.army) {
      const b = c.brain;
      if (c.alive && b instanceof RebelBrain && b.mode === 'bunker' && b.front === d.index) n++;
    }
    return n;
  }

  /** Сколько бойцов блиндаж вмещает на койках (не больше резерва с запасом и коек). */
  capacity(d: Dugout): number {
    return Math.min(d.bunks.length, WAR.dugout.reserve + WAR.dugout.spare);
  }

  /** Резерву не хватает людей: можно присылать из лагеря. */
  needsReserve(d: Dugout): boolean {
    return this.usable(d) && this.time >= WAR.dugout.reserveFrom && this.garrison(d) < WAR.dugout.reserve && this.capacity(d) > 0;
  }

  /**
   * Куда боец уходит с линии: в блиндаж — за патронами / отдыхать (null — в лагерь: блиндаж разрушен или пуст, нет места,
   * тяжело ранен, слишком долго вне лагеря). reason — shift (отстоял смену), ammo (мало патронов), hurt (ранен).
   */
  admit(c: Character, b: RebelBrain, reason: 'shift' | 'ammo' | 'hurt'): BunkerTask | null {
    const d = this.of(b.front);
    const S = WAR.dugout;
    if (!this.usable(d)) return null;
    if (this.war.command.now - b.outSince > S.rotateCamp) return null;
    if (c.health < c.maxHealth * S.rest.severe) return null;
    const restock = this.canRestock(d, c);
    if (reason === 'ammo') return restock ? 'restock' : null;
    // Отдых и ожидание — на койке; мест нет — только за патронами и дальше в лагерь.
    if (this.sitters(d, c).length >= this.capacity(d)) return null;
    return restock ? 'restock' : this.needsRest(c) ? 'rest' : 'ready';
  }

  /** Бойцу нужно подлечиться (здоровье ниже доли rest.cap максимума). */
  needsRest(c: Character): boolean {
    return c.health < c.maxHealth * WAR.dugout.rest.cap || c.bleed > 0;
  }

  /** После пополнения: отдыхать, ждать в резерве или (мест нет) в лагерь — null. */
  afterRestock(c: Character, d: Dugout): BunkerTask | null {
    if (this.sitters(d, c).length >= this.capacity(d)) return null;
    return this.needsRest(c) ? 'rest' : 'ready';
  }

  /** Койка бойца (занятая им или первая свободная); null — все заняты. */
  claimBunk(d: Dugout, c: Character): Bunk | null {
    const own = d.bunks.find((k) => k.user === c);
    if (own) return own;
    const free = d.bunks.find((k) => !k.user || !k.user.alive);
    if (!free) return null;
    free.user = c;
    return free;
  }

  releaseBunk(c: Character): void {
    for (const d of this.list) for (const k of d.bunks) if (k.user === c) k.user = null;
  }

  /**
   * Отдых на койке, тик: лечение до WAR.dugout.rest.cap максимума, перевязка (кровь остановлена), сухпаёк. true — отдохнул
   * (время вышло и подлечился).
   */
  rest(c: Character, dt: number, left: number): boolean {
    const R = WAR.dugout.rest;
    c.bleed = 0;
    c.limpUntil = 0;
    if (c.health < c.maxHealth * R.cap) c.health = Math.min(c.maxHealth * R.cap, c.health + R.heal * dt);
    this.ctx.economy.feed(c, R.feed, dt);
    return left <= 0 && c.health >= Math.min(c.maxHealth * R.cap, c.maxHealth) - 1e-6;
  }

  // ───────────────────────── Игрок ─────────────────────────

  /** E повстанца-игрока у ящика блиндажа: пополнить патроны; null — рядом нет блиндажа. */
  playerUse(p: Character): string | null {
    const S = WAR.dugout;
    const d = this.cacheNear(p.x, p.y, S.player.reach);
    if (!d) return null;
    if (p.faction !== 'rebel') return 'Ящики сопротивления. Вам тут ничего не положено.';
    if (d.owner === 'ruined') return 'Блиндаж разрушен: ящик сгорел. Его отстроят свои, когда уляжется.';
    const added = d.kits > 0 ? this.ctx.economy.refillAmmo(p, S.player.mags) : 0;
    if (added > 0) d.kits--;
    const lack = this.grenadesWanted(p) - p.inventory.count('grenade');
    const g = Math.min(lack, d.grenades);
    if (g > 0 && p.inventory.add('grenade', g) > 0) d.grenades -= g;
    else if (!added) return `Блиндаж «${d.front.name}»: ${d.kits ? 'патронов вам хватает' : 'запас кончился — ждите подвоза из лагеря'} (комплектов ${d.kits}/${S.stock.kits.cap}, гранат ${d.grenades}/${S.stock.grenades.cap}).`;
    return `Блиндаж «${d.front.name}»: ${added > 0 ? `+${added} патронов` : ''}${added > 0 && g > 0 ? ', ' : ''}${g > 0 ? `гранат +${g}` : ''}. Осталось: комплектов ${d.kits}, гранат ${d.grenades}.`;
  }

  // ───────────────────────── Тик ─────────────────────────

  update(dt: number): void {
    if (!this.list.length) return;
    this.time += dt;
    for (const d of this.list) {
      this.tidy(d);
      if (!this.enabled) continue;
      if (d.owner === 'ruined') this.rebuildStep(d, dt);
      else this.supplyStep(d);
      this.sortieStep(d, dt);
    }
  }

  /** Убрать брони погибших/ушедших: койки, подносчика, ящик у ушедшего с задания. */
  private tidy(d: Dugout): void {
    for (const k of d.bunks) {
      const b = k.user?.brain;
      if (k.user && (!k.user.alive || !(b instanceof RebelBrain) || b.mode !== 'bunker' || b.front !== d.index)) k.user = null;
    }
    const p = d.porter;
    if (p) {
      const b = p.brain;
      if (!p.alive || !(b instanceof RebelBrain) || b.mode !== 'supply' || b.front !== d.index) {
        // Погиб, ранен и ушёл в лагерь, не донёс: ящик пропал, а подход, видно, простреливается — следующего шлют не сразу.
        p.carrying = false;
        d.porter = null;
        d.lost++;
        d.holdUntil = this.time + WAR.dugout.supply.lossBackoff * Math.min(d.lost, WAR.dugout.supply.lossStreak);
        this.stats.crewLost++;
      }
    }
    // Ящик в руках у того, кто не подносчик, — не бывает у повстанцев.
    for (const c of this.war.command.army) {
      if (c.carrying && !c.isPlayer && !(c.brain instanceof RebelBrain && c.brain.mode === 'supply')) c.carrying = false;
    }
  }

  /** Боец из лагеря, годный в подносчики/строители блиндажа. */
  private pickCrew(): Character | null {
    const cmd = this.war.command;
    const pool = cmd.army.filter((c) => {
      const b = c.brain;
      return (
        c.alive &&
        !c.isPlayer &&
        c !== cmd.leader &&
        b instanceof RebelBrain &&
        b.mode === 'camp' &&
        b.restocked &&
        !b.isHydra &&
        (WAR.dugout.supply.professions as readonly string[]).includes(c.profession ?? '') &&
        c.health >= c.maxHealth * COMMAND.readyHealth
      );
    });
    // Сперва новобранцы (линии нужны солдаты), потом по номеру.
    pool.sort((a, b) => Number(b.profession === 'rebel_recruit') - Number(a.profession === 'rebel_recruit') || a.id - b.id);
    return pool[0] ?? null;
  }

  /** Подвоз: запас ниже low — подносчик с ящиком из лагеря. */
  private supplyStep(d: Dugout): void {
    const S = WAR.dugout.supply;
    const cmd = this.war.command;
    if (this.time < d.nextSupply || this.time < d.holdUntil || d.porter || !cmd.running) return;
    if (!this.needsStock(d)) {
      d.nextSupply = this.time + 5;
      return;
    }
    const c = this.pickCrew();
    if (!c) {
      d.nextSupply = this.time + 5;
      return;
    }
    d.nextSupply = this.time + S.every;
    d.porter = c;
    c.carrying = true;
    (c.brain as RebelBrain).beginSupply(d.index, 'deliver');
  }

  /** Разрушен: прошло ruined с — строитель из лагеря восстанавливает (rebuild.time с работы внутри). */
  private rebuildStep(d: Dugout, dt: number): void {
    const R = WAR.dugout.rebuild;
    const cmd = this.war.command;
    if (this.time < d.ruinedUntil || this.time < d.holdUntil) return;
    const crew = d.porter;
    if (!crew) {
      if (!cmd.running) return;
      const c = this.pickCrew();
      if (!c) return;
      d.porter = c;
      (c.brain as RebelBrain).beginSupply(d.index, 'build');
      this.stats.builders++;
      return;
    }
    // Строит, пока стоит в блиндаже.
    if (Math.hypot(crew.x - d.x, crew.y - d.y) <= WAR.dugout.reach * 2) {
      d.rebuild += dt;
      if (d.rebuild >= R.time) this.restore(d);
    }
  }

  private restore(d: Dugout): void {
    d.owner = 'rebels';
    d.kits = 0;
    d.grenades = 0;
    d.rebuild = 0;
    d.ruinedUntil = 0;
    d.lost = 0;
    d.holdUntil = 0;
    d.nextSupply = this.time + WAR.dugout.supply.first;
    d.nextSortie = this.time + WAR.dugout.sortie.every;
    if (d.porter) d.porter.carrying = false;
    d.porter = null;
    this.stats.rebuilt++;
    this.ctx.insurgency.radio(`${d.front.name}: блиндаж отстроен заново — запас пуст, нужен подвоз.`);
  }

  // ───────────────────────── Вылазка Протектората ─────────────────────────

  /** Живые повстанцы на ногах ближе r px от точки. */
  private rebelsNear(x: number, y: number, r: number): number {
    let n = 0;
    for (const c of this.ctx.entities.list) {
      if (c.faction === 'rebel' && c.fit && c.law.phase === 'none' && Math.hypot(c.x - x, c.y - y) <= r) n++;
    }
    return n;
  }

  /** Защитники блиндажа: повстанцы внутри и в radius px вокруг него. */
  defenders(d: Dugout): number {
    return this.rebelsNear(d.x, d.y, WAR.dugout.radius);
  }

  private sortieStep(d: Dugout, dt: number): void {
    const SO = WAR.dugout.sortie;
    const war = this.war;
    if (d.raiders.length) {
      d.raiders = d.raiders.filter((c) => c.alive && c.brain instanceof OtaBrain && c.brain.mode === 'sortie');
      const aborted = war.cityPush || war.code === 'red' || !war.reinforcements || d.owner !== 'rebels';
      if (aborted || !d.raiders.length || this.time - d.sortieSince > SO.maxTime) {
        this.endSortie(d);
        return;
      }
      // Закладка: хоть один легионер у входа и рядом нет защитников — заряд копится, иначе сбивается.
      const planting = d.raiders.some((c) => c.fit && Math.hypot(c.x - d.outside.x, c.y - d.outside.y) <= SO.plantReach);
      if (planting) {
        if (this.rebelsNear(d.outside.x, d.outside.y, SO.guard) === 0) d.charge += dt;
        else d.charge = Math.max(0, d.charge - dt);
      }
      if (d.charge >= SO.blowTime) this.blow(d);
      return;
    }
    if (d.owner !== 'rebels' || this.time < d.nextSortie) return;
    if (!war.reinforcements || war.cityPush || war.code === 'red' || d.front.capture) return;
    d.nextSortie = this.time + SO.every;
    // Рядом есть повстанцы — блиндаж держат, вылазки нет.
    if (this.defenders(d) >= SO.minDefenders) return;
    if (!this.ctx.rng.chance(SO.chance)) return;
    const pool = war.ota.filter((o) => o.alive && o.brain instanceof OtaBrain && o.brain.available);
    if (!pool.length) return;
    pool.sort((a, b) => Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y));
    for (const o of pool.slice(0, SO.ota)) {
      (o.brain as OtaBrain).assignSortie(d.index, d.outside, Math.atan2(d.y - d.outside.y, d.x - d.outside.x));
      d.raiders.push(o);
    }
    d.charge = 0;
    d.sortieSince = this.time;
    this.stats.sorties++;
    d.sorties++;
    this.ctx.law.log(`Надзор: у ${d.front.name} замечен блиндаж повстанцев — легионеры (${d.raiders.length}) идут его уничтожить.`, 'radio');
    this.ctx.insurgency.radio(`${d.front.name}: легионеры идут к нашему блиндажу!`);
  }

  /** Вылазка кончилась (взорвали, погибли, отбой): легионеры домой. */
  private endSortie(d: Dugout): void {
    for (const o of d.raiders) if (o.alive && o.brain instanceof OtaBrain && o.brain.mode === 'sortie') o.brain.goHome();
    d.raiders = [];
    d.charge = 0;
    d.nextSortie = this.time + WAR.dugout.sortie.every;
  }

  /** Заряд сработал: блиндаж разрушен, запас пропал, бойцы внутри выходят в лагерь. */
  private blow(d: Dugout, by: Character | null = d.raiders.find((c) => c.alive) ?? null): void {
    const S = WAR.dugout;
    d.owner = 'ruined';
    d.kits = 0;
    d.grenades = 0;
    d.ruinedAt = this.time;
    d.ruinedUntil = this.time + S.ruined;
    d.rebuild = 0;
    if (d.porter) d.porter.carrying = false;
    d.porter = null;
    this.stats.ruined++;
    if (by) this.ctx.combat.demolition(d.x, d.y, by, S.sortie.blastMul);
    for (const c of this.war.command.army) {
      const b = c.brain;
      if (c.alive && b instanceof RebelBrain && b.front === d.index && (b.mode === 'bunker' || b.mode === 'supply')) b.withdraw();
    }
    for (const k of d.bunks) k.user = null;
    this.endSortie(d);
    this.ctx.law.log(`Надзор: блиндаж противника у ${d.front.name} уничтожен.`, 'radio');
    this.ctx.insurgency.radio(`${this.ctx.rng.pick(S.lines.ruined)} (${d.front.name})`);
  }

  /** Тест и отладка: сразу разрушить блиндаж фронта. */
  ruin(d: Dugout): void {
    this.blow(d, this.war.ota.find((c) => c.alive) ?? null);
  }

  /** Точка сбора перед наступлением: окрестности блиндажа (цел) — безопасное место рядом с лагерем. */
  gatherAround(front: number): Vec2 | null {
    const d = this.of(front);
    return this.usable(d) ? d.outside : null;
  }
}
