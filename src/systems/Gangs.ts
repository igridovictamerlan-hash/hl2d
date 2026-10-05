import { phrase } from './phrases';
import { FACTIONS } from '../config/factions';
import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Dwelling } from './Housing';
import type { StreetShop } from './StreetShops';
import type { Convoy } from './Arsenal';
import { Inventory } from '../entities/Inventory';
import { ROUTINE } from '../config/routine';
import { GANGS, FENCE, type GangDef } from '../config/gangs';
import { ITEMS, WEAPONS, type ItemId, type WeaponId } from '../config/items';
import { ECONOMY } from '../config/economy';
import { lineOfSight } from '../world/visibility';
import { spawnRole } from './Roster';
import { GangOpBrain } from '../ai/brains/GangOpBrain';
import { CitizenBrain } from '../ai/brains/CitizenBrain';

export type GangOpKind = 'racket' | 'raid' | 'hit' | 'convoy' | 'buy' | 'sell';

/** Дело банды: кто идёт, куда, до какого времени. */
export interface GangOp {
  kind: GangOpKind;
  gang: Gang;
  team: Character[];
  /** Точка: лавка (дань), центр чужого района (налёт), барыга (покупка). */
  target: Vec2 | null;
  shop: StreetShop | null;
  convoy: Convoy | null;
  /** Налёт: на чей район. */
  rival: Gang | null;
  until: number;
  /** Заказ подполья через барыгу (удар по ВС оплачен). */
  paid: boolean;
  /** Дань уже собрана, ствол куплен. */
  done: boolean;
}

export interface Gang {
  id: number;
  def: GangDef;
  /** Общежитие банды (номер POI dorm), его комнаты, общая комната (общак). */
  building: number;
  rooms: Dwelling[];
  hq: Vec2;
  /** Район: квартал вокруг общаги и сама общага (id зон); якоря района — для прогулок. */
  turf: Set<number>;
  quarter: string;
  anchors: number[];
  /** Тайлы района с кромкой GANGS.pairs.edge (правило «по одному — только на районе»). */
  mask: Uint8Array;
  /** Зоны не района — в A* одиночке дороже (путь по своему району, а не через чужие кварталы). */
  away: Set<number>;
  center: Vec2;
  bank: number;
  stash: Inventory;
  nextOp: number;
  op: GangOp | null;
  stats: { racket: number; raids: number; hits: number; convoys: number; buys: number; sells: number; feuds: number; looted: number };
}

/**
 * Банды города (config/gangs.ts): две, изредка три. У каждой общага (общежитие целиком: авторитет
 * и бойцы там живут и возрождаются, в общей комнате — общак: деньги и стволы), район (квартал
 * вокруг общаги) и цвет. Бойцы держатся своего района; встретил бойца чужой банды — стычка (оба
 * стреляют). Авторитет раз в ops.every с посылает бойцов на дело: дань с лавки, налёт на чужой
 * район, удар по ВС (сами, по заказу подполья через барыгу или в помощь штурму повстанцев),
 * засада на конвой склада, покупка ствола у барыги.
 */
export class GangSystem {
  readonly gangs: Gang[] = [];
  private time = 0;
  private scan = 0;
  private armTimer = 0;
  /** Стычки между бандами: пара → до какого времени (и когда можно снова). */
  private feuds = new Map<string, { until: number; next: number }>();
  /** Когда пара банд последний раз перебранивалась (без стрельбы). */
  private readonly barked = new Map<string, number>();
  paused = false;
  readonly stats = { feuds: 0, ops: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav, rng } = ctx;
    const ts = map.tileSize;
    const dorms = map.poisOf('dorm');
    const H = ctx.housing;
    if (!H || dorms.length < 2) return;
    // Квартал вокруг общаги: самая частая жилая зона по кольцу в паре тайлов от стен.
    const quarterOf = (d: (typeof dorms)[number]): number => {
      const count = new Map<number, number>();
      const own = map.zoneGrid[(d.y + (d.h! >> 1)) * map.width + d.x + (d.w! >> 1)];
      for (let y = d.y - 4; y < d.y + d.h! + 4; y++) {
        for (let x = d.x - 4; x < d.x + d.w! + 4; x++) {
          if (x >= d.x - 1 && x <= d.x + d.w! && y >= d.y - 1 && y <= d.y + d.h!) continue;
          const z = map.zoneAtTile(x, y);
          if (!z || z.id === own || z.kind !== 'residential') continue;
          count.set(z.id, (count.get(z.id) ?? 0) + 1);
        }
      }
      let best = -1;
      let bestN = 0;
      for (const [z, n] of count) if (n > bestN) [best, bestN] = [z, n];
      return best;
    };
    const n = dorms.length >= 3 && rng.chance(GANGS.thirdChance) ? 3 : 2;
    const cands = rng.shuffle(dorms.map((d) => ({ d, q: quarterOf(d), c: { x: (d.x + d.w! / 2) * ts, y: (d.y + d.h! / 2) * ts } })));
    const chosen: typeof cands = [];
    while (chosen.length < n) {
      let best: (typeof cands)[number] | null = null;
      let bestD = -1;
      for (const c of cands) {
        if (chosen.includes(c) || chosen.some((o) => o.q === c.q)) continue;
        const d = chosen.length ? Math.min(...chosen.map((o) => Math.hypot(o.c.x - c.c.x, o.c.y - c.c.y))) : 1;
        if (d > bestD) [best, bestD] = [c, d];
      }
      if (!best) break;
      chosen.push(best);
    }
    chosen.forEach((c, k) => {
      const def = GANGS.defs[k];
      const rooms = H.dwellings.filter((w) => w.building === c.d.id);
      for (const r of rooms) r.reserved = true;
      const common = map.poisOf('dorm_common').find((p) => p.id === c.d.id);
      const hp = common ? { x: (common.x + common.w! / 2) * ts, y: (common.y + common.h! / 2) * ts } : c.c;
      const a = nav.nearestWalkable(hp.x, hp.y, 3);
      const hq = a >= 0 ? { x: nav.worldX(a), y: nav.worldY(a) } : hp;
      const turf = new Set<number>();
      if (c.q >= 0) turf.add(c.q);
      const own = map.zoneGrid[(c.d.y + (c.d.h! >> 1)) * map.width + c.d.x + (c.d.w! >> 1)];
      turf.add(own);
      // Точки района — только связная с общагой часть (зона квартала бывает разорвана чужими).
      const mask = turfMask(map, turf, GANGS.pairs.edge);
      const anchors = turfComponent(nav, mask, hq, turf);
      const away = new Set(map.zones.map((z) => z.id).filter((id) => !turf.has(id)));
      let sx = 0;
      let sy = 0;
      for (const an of anchors) {
        sx += nav.worldX(an);
        sy += nav.worldY(an);
      }
      const stash = new Inventory(GANGS.stashSize);
      for (const [id, q] of GANGS.stash) stash.add(id, q);
      this.gangs.push({
        id: k,
        def,
        building: c.d.id ?? -1,
        rooms,
        hq,
        turf,
        quarter: c.q >= 0 ? map.zones[c.q].name : '',
        anchors,
        mask,
        away,
        center: anchors.length ? { x: sx / anchors.length, y: sy / anchors.length } : c.c,
        bank: GANGS.bank,
        stash,
        nextOp: rng.range(GANGS.ops.first[0], GANGS.ops.first[1]),
        op: null,
        stats: { racket: 0, raids: 0, hits: 0, convoys: 0, buys: 0, sells: 0, feuds: 0, looted: 0 },
      });
    });
    // Бойцы разных банд в стычке — враги друг другу (CombatSystem.isHostile).
    ctx.combat.gangHostile = (a, b) => this.feuding(a.gang, b.gang);
  }

  get now(): number {
    return this.time;
  }

  of(c: Character): Gang | null {
    return c.gang >= 0 ? this.gangs[c.gang] ?? null : null;
  }

  members(g: Gang): Character[] {
    return this.ctx.entities.list.filter((c) => c.alive && c.gang === g.id);
  }

  boss(g: Gang): Character | null {
    return this.ctx.entities.list.find((c) => c.alive && c.gang === g.id && c.profession === 'gang_boss') ?? null;
  }

  /** Банда, чей район — эта зона (для баннера и карты), или null. */
  turfOf(zoneId: number): Gang | null {
    return this.gangs.find((g) => g.turf.has(zoneId)) ?? null;
  }

  /** На районе ли точка (зоны района или у самой общаги — её крыльцо выходит на улицу). */
  inTurf(g: Gang, x: number, y: number): boolean {
    if (Math.hypot(x - g.hq.x, y - g.hq.y) < GANGS.pairs.hqRadius) return true;
    const m = this.ctx.map;
    const tx = Math.floor(x / m.tileSize);
    const ty = Math.floor(y / m.tileSize);
    return tx >= 0 && ty >= 0 && tx < m.width && ty < m.height && g.mask[ty * m.width + tx] === 1;
  }

  /** На районе ли якорь сетки. */
  anchorInTurf(g: Gang, a: number): boolean {
    return a >= 0 && (g.turf.has(this.ctx.nav.zone[a]) || this.inTurf(g, this.ctx.nav.worldX(a), this.ctx.nav.worldY(a)));
  }

  /** Ближняя из нескольких случайных точек района — вернуться на район. */
  turfReturn(g: Gang, x: number, y: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < 6; k++) {
      const a = this.turfAnchor(g);
      if (a < 0) continue;
      const d = Math.hypot(this.ctx.nav.worldX(a) - x, this.ctx.nav.worldY(a) - y);
      if (d < bestD) [best, bestD] = [a, d];
    }
    return best;
  }

  /** Случайная точка своего района (прогулки бойцов). */
  turfAnchor(g: Gang): number {
    return g.anchors.length ? this.ctx.rng.pick(g.anchors) : -1;
  }

  /** Идёт ли стычка между бандами a и b. */
  feuding(a: number, b: number): boolean {
    if (a < 0 || b < 0 || a === b) return false;
    const f = this.feuds.get(a < b ? `${a}:${b}` : `${b}:${a}`);
    return !!f && f.until > this.time;
  }

  /** Заселить банды: авторитет у общака, бойцы — по комнатам общаги. */
  populate(): void {
    const { ctx } = this;
    for (const g of this.gangs) {
      if (!g.rooms.length) continue;
      const room = (k: number) => g.rooms[k % g.rooms.length];
      const cycle = GANGS.kits.cycle;
      const spec = (prof: 'gang_boss' | 'bandit', k: number) => ({
        kind: 'gang' as const, faction: 'citizen' as const, profession: prof, division: null, rank: 0,
        kit: prof === 'gang_boss' ? GANGS.kits.boss : cycle[(k - 1) % cycle.length], gang: g.id, home: room(k).id, loyalty: -20,
      });
      const boss = spawnRole(ctx, spec('gang_boss', 0), g.hq);
      if (boss) this.dress(boss, g);
      const n = ctx.rng.int(GANGS.members[0], GANGS.members[1]);
      for (let k = 0; k < n; k++) {
        const r = room(k + 1);
        const c = spawnRole(ctx, spec('bandit', k + 1), ctx.rng.pick(r.spots));
        if (c) this.dress(c, g);
      }
      for (const r of g.rooms) r.households = Math.max(r.households, 1);
    }
  }

  /** Принять в банду (NPC при появлении, игрок-бандит): банда, дом в общаге, без лояльности. */
  dress(c: Character, g: Gang): void {
    c.gang = g.id;
    c.loyalty = Math.min(c.loyalty, -10);
    if (c.role) c.role.gang = g.id;
  }

  /** Игрок-бандит: в банду, где людей меньше всего; дом — комната её общаги. */
  join(c: Character): Gang | null {
    if (!this.gangs.length) return null;
    const g = [...this.gangs].sort((a, b) => this.members(a).length - this.members(b).length)[0];
    this.dress(c, g);
    const r = g.rooms[0];
    if (r) c.home = r.id;
    return g;
  }

  leave(c: Character): void {
    c.gang = -1;
  }

  // ——— Стычки ———

  private startFeud(a: Character, b: Character): void {
    const ga = this.gangs[a.gang];
    const gb = this.gangs[b.gang];
    const key = a.gang < b.gang ? `${a.gang}:${b.gang}` : `${b.gang}:${a.gang}`;
    const f = this.feuds.get(key);
    if (f && (f.until > this.time || f.next > this.time)) return;
    const F = GANGS.feud;
    this.feuds.set(key, { until: this.time + F.time, next: this.time + F.time + F.cooldown });
    this.stats.feuds++;
    ga.stats.feuds++;
    gb.stats.feuds++;
    const now = this.ctx.law.now;
    a.say(phrase(this.ctx.rng, a, GANGS.lines.turf), now, 2.5);
    b.say(phrase(this.ctx.rng, b, GANGS.lines.turf), now + 0.6, 2.5);
    const z = this.ctx.map.zoneAtWorld(a.x, a.y);
    this.ctx.bus.emit('log', { text: `Стычка банд: ${ga.def.name} против ${gb.def.name}${z ? ` (${z.name})` : ''}.`, kind: 'world' });
  }

  private scanFeuds(): void {
    const { ctx } = this;
    const F = GANGS.feud;
    for (const a of ctx.entities.list) {
      if (a.gang < 0 || !a.fit || a.law.phase !== 'none' || ctx.map.levelAt(a.x, a.y) !== 'city') continue;
      for (const b of ctx.entities.near(a.x, a.y, F.see, near)) {
        if (b.gang < 0 || b.gang === a.gang || !b.fit || b.law.phase !== 'none') continue;
        if (this.feuding(a.gang, b.gang)) break;
        if (!lineOfSight(ctx.map, a.x, a.y, b.x, b.y)) continue;
        // Стреляют за свой район и не на глазах у ВС; иначе — перебранка.
        const home = this.inTurf(this.gangs[a.gang], a.x, a.y) || this.inTurf(this.gangs[b.gang], b.x, b.y);
        if (home && !this.copsWatching(a, b)) this.startFeud(a, b);
        else this.standoff(a, b);
        break;
      }
    }
  }

  /** ВС рядом и видит кого-то из двоих — стрелять при них банды не станут. */
  private copsWatching(a: Character, b: Character): boolean {
    const F = GANGS.feud;
    for (const c of this.ctx.entities.near(a.x, a.y, F.cops, near)) {
      if (!c.fit || c.isPlayer || !FACTIONS[c.faction].authority) continue;
      if (lineOfSight(this.ctx.map, c.x, c.y, a.x, a.y) || lineOfSight(this.ctx.map, c.x, c.y, b.x, b.y)) return true;
    }
    return false;
  }

  /** Перебранка вместо стрельбы (не чаще barkEvery с на пару банд). */
  private standoff(a: Character, b: Character): void {
    const key = a.gang < b.gang ? `${a.gang}:${b.gang}` : `${b.gang}:${a.gang}`;
    const t = this.barked.get(key) ?? -1e9;
    if (this.time - t < GANGS.feud.barkEvery) return;
    this.barked.set(key, this.time);
    const now = this.ctx.law.now;
    a.say(this.ctx.rng.pick(GANGS.lines.standoff), now, 2.5);
    b.say(this.ctx.rng.pick(GANGS.lines.standoff), now + 0.7, 2.5);
  }

  // ——— Общак ———

  /** Лучший ствол из общака — бойцу у общаги, если у него хуже. */
  private armAtHq(g: Gang): void {
    for (const c of this.members(g)) {
      if (c.isPlayer || Math.hypot(c.x - g.hq.x, c.y - g.hq.y) > GANGS.armReach) continue;
      // Кормёжка в общаге — за счёт общака.
      const M = GANGS.meal;
      if (c.hunger < M.below && g.bank >= M.cost && !this.ctx.economy.hasFood(c)) {
        g.bank -= M.cost;
        c.hunger = Math.min(ECONOMY.hunger.max, c.hunger + (ITEMS[M.item].food ?? 0));
      }
      const rank = (id: string) => {
        const i = GANGS.arms.indexOf(id as WeaponId);
        return i < 0 ? GANGS.arms.length : i;
      };
      // Лишние стволы (снятые с тел ВС, трофеи) — в общак: при себе один, лучший.
      const guns = c.inventory.slots.filter((s) => WEAPONS[s.id as WeaponId]?.ammo).map((s) => s.id as WeaponId);
      if (guns.length > 1) {
        const keep = [...guns].sort((a, b) => rank(a) - rank(b))[0];
        for (const id of guns) {
          if (id === keep || c.weapon === id) continue;
          const n = c.inventory.count(id);
          if (n > 0 && c.inventory.remove(id, n)) g.stash.add(id, n);
        }
      }
      const have = Math.min(...c.inventory.slots.filter((s) => WEAPONS[s.id as WeaponId]?.ammo).map((s) => rank(s.id)), GANGS.arms.length);
      const best = GANGS.arms.find((id) => g.stash.has(id) && rank(id) < have);
      if (!best) continue;
      g.stash.remove(best, 1);
      c.inventory.add(best, 1);
      const ammo = WEAPONS[best].ammo;
      if (ammo) this.ctx.economy.refillAmmo(c, 3);
      this.ctx.combat.equip(c, null);
    }
  }

  // ——— Дела ———

  /** Дань с лавки: платит продавец (или касса), деньги — в общак. */
  collectRacket(op: GangOp, by: Character): void {
    const { ctx } = this;
    if (op.done || !op.shop) return;
    op.done = true;
    const R = GANGS.ops.racket;
    const take = ctx.rng.int(R.take[0], R.take[1]);
    const v = op.shop.vendor;
    const paid = v && v.alive ? Math.min(take, Math.max(0, v.money)) || take : take;
    if (v && v.alive) {
      v.money = Math.max(0, v.money - paid);
      v.say(ctx.rng.pick(GANGS.lines.pay), ctx.law.now + 0.8, 2.2);
    }
    op.gang.bank += paid;
    op.gang.stats.racket++;
    by.say(ctx.rng.pick(GANGS.lines.racket), ctx.law.now, 2.2);
    ctx.bus.emit('log', { text: `${op.gang.def.name} собрали дань с «${op.shop.name}» (${paid} ток.).`, kind: 'world' });
  }

  /** Покупка ствола у барыги на деньги общака. */
  buyAtFence(op: GangOp, by: Character): void {
    const { ctx } = this;
    const F = ctx.fence;
    if (op.done || !F?.open) return;
    op.done = true;
    const g = op.gang;
    const deal = F.bestGunFor(g.bank, GANGS.arms);
    if (!deal) return;
    const id = F.sellToGang(deal.k);
    if (!id) return;
    g.bank -= deal.price;
    g.stash.add(id, 1);
    g.stats.buys++;
    by.say(ctx.rng.pick(GANGS.lines.buy), ctx.law.now, 2);
    if (F.trader) F.trader.say(ctx.rng.pick(FENCE.lines.deal), ctx.law.now + 1, 2);
  }

  /** Сколько стволов в общаке. */
  stashGuns(g: Gang): number {
    return g.stash.slots.filter((s) => WEAPONS[s.id as WeaponId]?.ammo).reduce((n, s) => n + s.qty, 0);
  }

  /** Что из общака лишнее (стволы сверх ops.sell.keep, гранаты сверх ops.sell.grenades) — на продажу барыге. */
  surplus(g: Gang): { id: ItemId; qty: number }[] {
    const S = GANGS.ops.sell;
    const out: { id: ItemId; qty: number }[] = [];
    let guns = 0;
    // Лучшие стволы остаются в общаке (по порядку GANGS.arms), остальное — на продажу.
    const order = [...g.stash.slots].filter((s) => WEAPONS[s.id as WeaponId]?.ammo).sort((a, b) => {
      const r = (id: string) => (GANGS.arms.indexOf(id as WeaponId) + GANGS.arms.length + 1) % (GANGS.arms.length + 1);
      return r(a.id) - r(b.id);
    });
    for (const s of order) {
      const keep = Math.max(0, Math.min(s.qty, S.keep - guns));
      guns += keep;
      if (s.qty > keep) out.push({ id: s.id, qty: s.qty - keep });
    }
    const gr = g.stash.count('grenade');
    if (gr > S.grenades) out.push({ id: 'grenade', qty: gr - S.grenades });
    return out;
  }

  /** Сбыт лишнего из общака барыге: товар — ему, деньги — в общак. */
  sellAtFence(op: GangOp, by: Character): void {
    const { ctx } = this;
    const F = ctx.fence;
    if (op.done || !F?.open) return;
    op.done = true;
    const g = op.gang;
    const bag = this.surplus(g).filter((q) => g.stash.remove(q.id, q.qty));
    if (!bag.length) return;
    const pay = F.takeIn(bag);
    g.bank += pay;
    g.stats.sells++;
    by.say(ctx.rng.pick(GANGS.lines.sell), ctx.law.now, 2);
    if (F.trader) F.trader.say(ctx.rng.pick(FENCE.lines.deal), ctx.law.now + 1, 2);
    ctx.bus.emit('log', { text: `${g.def.name} сбыли барыге ${bag.reduce((n, q) => n + q.qty, 0)} шт. товара (${pay} ток.).`, kind: 'world' });
  }

  /** Ящик с конвоя — в общак (патроны или гранаты). */
  lootToStash(g: Gang, by: Character, r = 40): boolean {
    const kind = this.ctx.arsenal?.lootConvoy(by, r);
    if (!kind) return false;
    if (kind === 'ammo') g.stash.add('ammo_smg', 90);
    else if (kind === 'grenades') g.stash.add('grenade', 3);
    else g.stash.add('mp7', 1);
    g.stats.looted++;
    by.say(this.ctx.rng.pick(GANGS.lines.convoy), this.ctx.law.now, 2);
    return true;
  }

  /** Кто свободен для дела: бойцы на ногах в городе, не игрок, не на деле, не задержаны. */
  private free(g: Gang): Character[] {
    const { ctx } = this;
    return this.members(g).filter((c) => !c.isPlayer && c.profession === 'bandit' && c.fit && c.law.phase === 'none' && !c.law.wanted && !(c.brain instanceof GangOpBrain) && ctx.map.levelAt(c.x, c.y) === 'city');
  }

  /** Начать дело (или конкретное — для тестов). */
  startOp(g: Gang, kind?: GangOpKind, paid = false): GangOp | null {
    const { ctx } = this;
    const O = GANGS.ops;
    const free = this.free(g).sort((a, b) => Math.hypot(a.x - g.hq.x, a.y - g.hq.y) - Math.hypot(b.x - g.hq.x, b.y - g.hq.y));
    // Все дела — в городе, а по городу ходят не меньше pairs.min.
    const MIN = GANGS.pairs.min;
    if (free.length < MIN) return null;
    const war = ctx.war.fronts.some((f) => f.capture) || !!ctx.war.nexus?.wave;
    const convoy = ctx.arsenal?.present ? ctx.arsenal.convoys.find((v) => v.phase === 'march' && Math.hypot(v.lead.x - g.hq.x, v.lead.y - g.hq.y) < O.convoy.seek) ?? null : null;
    const shops = ctx.shops?.shops.filter((s) => s.vendorSpot && Math.hypot(s.front.x - g.hq.x, s.front.y - g.hq.y) < O.racket.seek) ?? [];
    const rivals = this.gangs.filter((o) => o !== g && o.anchors.length);
    let type = kind;
    if (!type && (paid || (war && ctx.rng.chance(GANGS.assistChance)))) type = 'hit';
    if (!type) {
      const W = O.weights;
      const opts: [GangOpKind, number][] = [
        ['racket', shops.length ? W.racket : 0],
        ['raid', rivals.length ? W.raid : 0],
        ['hit', W.hit],
        ['convoy', convoy && free.length >= 3 ? W.convoy * 3 : 0],
        // Покупать — пока в общаке стволов меньше, чем держат про запас (лишнее и так несут барыге).
        ['buy', ctx.fence?.present && g.bank >= O.buy.minBank && this.stashGuns(g) < O.sell.keep ? W.buy : 0],
        ['sell', ctx.fence?.present && this.surplus(g).length ? W.sell : 0],
      ];
      let r = ctx.rng.range(0, opts.reduce((a, [, w]) => a + w, 0));
      for (const [k, w] of opts) {
        if ((r -= w) < 0) {
          type = k;
          break;
        }
      }
    }
    if (!type) return null;
    const pickN = (range: readonly [number, number]) => free.slice(0, Math.min(free.length, Math.max(MIN, ctx.rng.int(range[0], range[1]))));
    const op: GangOp = { kind: type, gang: g, team: [], target: null, shop: null, convoy: null, rival: null, until: this.time + 60, paid, done: false };
    switch (type) {
      case 'racket': {
        if (!shops.length) return null;
        op.shop = ctx.rng.pick(shops);
        op.target = op.shop.front;
        op.team = free.slice(0, MIN);
        op.until = this.time + 90;
        break;
      }
      case 'raid': {
        const rival = ctx.rng.pick(rivals);
        op.rival = rival;
        const a = this.turfAnchor(rival);
        if (a < 0) return null;
        op.target = { x: ctx.nav.worldX(a), y: ctx.nav.worldY(a) };
        op.team = pickN(O.raid.size);
        op.until = this.time + O.raid.time;
        break;
      }
      case 'hit':
        op.team = pickN(O.hit.size);
        op.until = this.time + O.hit.time;
        if (paid) g.bank += FENCE.deal.order;
        break;
      case 'convoy':
        if (!convoy) return null;
        op.convoy = convoy;
        op.team = pickN(O.convoy.size);
        op.until = this.time + O.convoy.time;
        break;
      case 'buy':
      case 'sell':
        if (!ctx.fence?.counter) return null;
        op.target = ctx.fence.counter;
        op.team = free.slice(0, MIN);
        op.until = this.time + (type === 'buy' ? O.buy.time : O.sell.time);
        break;
    }
    if (op.team.length < MIN) return null;
    // Кто идёт в паре — на дело вместе с напарником (никого не бросают одного в городе).
    for (const c of [...op.team]) {
      const b = c.brain;
      if (!(b instanceof CitizenBrain)) continue;
      const lead = b.crewLead ?? c;
      const lb = lead.brain instanceof CitizenBrain ? lead.brain : null;
      for (const o of [lead, ...(lb?.escort ?? [])]) if (!op.team.includes(o) && free.includes(o)) op.team.push(o);
    }
    for (const c of op.team) {
      // Место в очереди за рационом — не держать, пока на деле.
      ctx.economy.leaveQueue(c);
      const b = c.brain;
      if (!(b instanceof CitizenBrain)) continue;
      b.leaveCrew();
      b.dropCrew();
    }
    g.op = op;
    this.stats.ops++;
    if (type === 'raid') g.stats.raids++;
    if (type === 'hit') g.stats.hits++;
    if (type === 'convoy') g.stats.convoys++;
    for (const c of op.team) c.brain = new GangOpBrain(c, ctx, op, c.brain);
    const boss = this.boss(g);
    if (boss && !boss.isPlayer) boss.say(ctx.rng.pick(GANGS.lines.boss), ctx.law.now, 2.5);
    return op;
  }

  private endOp(g: Gang): void {
    const op = g.op;
    if (!op) return;
    for (const c of op.team) if (c.brain instanceof GangOpBrain) c.brain.finish(c, this.ctx);
    g.op = null;
    this.homeTogether(g, op.team);
    // Ночью дела чаще (распорядок).
    g.nextOp = this.time + this.ctx.rng.range(GANGS.ops.every[0], GANGS.ops.every[1]) * (this.ctx.routine.night ? ROUTINE.night.opsMul : 1);
  }

  /**
   * После дела — назад на район вместе: первый вне района ведёт, остальные вне района — колонной за
   * ним (по одному по городу не ходят).
   */
  private homeTogether(g: Gang, team: Character[]): void {
    const out = team.filter((c) => c.alive && c.fit && !c.isPlayer && c.law.phase === 'none' && c.brain instanceof CitizenBrain && !this.inTurf(g, c.x, c.y));
    if (out.length < 2) return;
    const lead = out[0].brain as CitizenBrain;
    for (const c of out.slice(1)) lead.adopt(c);
    lead.headHome();
  }

  update(dt: number): void {
    this.time += dt;
    this.ctx.fence?.update(dt);
    if (!this.gangs.length) return;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = GANGS.feud.scanEvery;
      this.scanFeuds();
    }
    this.armTimer -= dt;
    if (this.armTimer <= 0) {
      this.armTimer = 2;
      for (const g of this.gangs) this.armAtHq(g);
    }
    for (const g of this.gangs) {
      const op = g.op;
      if (op) {
        const active = op.team.some((c) => c.alive && c.brain instanceof GangOpBrain);
        if (!active || this.time > op.until) this.endOp(g);
        continue;
      }
      if (this.paused || this.ctx.war.code === 'red' || this.time < g.nextOp) continue;
      // Заказ подполья через барыгу — сперва (оплачен); иначе — своё дело.
      const paid = !!this.ctx.fence?.orders && this.ctx.fence.takeOrder();
      if (!this.startOp(g, undefined, paid)) {
        if (paid) this.ctx.fence.placeOrder();
        g.nextOp = this.time + 10;
      }
    }
  }
}

const near: Character[] = [];

/**
 * Якоря района, связные с общагой по тайлам района (с кромкой); из них — в зонах района (если таких
 * мало — все связные).
 */
function turfComponent(nav: AiContext['nav'], mask: Uint8Array, hq: Vec2, turf: Set<number>): number[] {
  const mw = nav.map.width;
  const inMask = (i: number) => mask[(nav.ay(i) + 1) * mw + nav.ax(i) + 1] === 1;
  const start = nav.nearestWalkable(hq.x, hq.y, 3);
  if (start < 0) return [...turf].flatMap((z) => nav.anchorsByZone.get(z) ?? []);
  const seen = new Uint8Array(nav.w * nav.h);
  const out: number[] = [];
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop()!;
    out.push(i);
    const ax = nav.ax(i);
    const ay = nav.ay(i);
    for (const [dx, dy] of DIRS) {
      const x = ax + dx;
      const y = ay + dy;
      if (!nav.isWalkable(x, y)) continue;
      const j = y * nav.w + x;
      if (seen[j] || !inMask(j)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  out.sort((a, b) => a - b);
  const own = out.filter((i) => turf.has(nav.zone[i]));
  return own.length >= 50 ? own : out;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Тайлы зон района, расширенные на edge тайлов (квадратное окно, по строкам и столбцам). */
function turfMask(map: AiContext['map'], turf: Set<number>, edge: number): Uint8Array {
  const { width: w, height: h } = map;
  const base = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (turf.has(map.zoneGrid[i])) base[i] = 1;
  const row = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = Math.max(0, x - edge); k <= Math.min(w - 1, x + edge); k++) {
        if (base[y * w + k]) {
          row[y * w + x] = 1;
          break;
        }
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = Math.max(0, y - edge); k <= Math.min(h - 1, y + edge); k++) {
        if (row[k * w + x]) {
          out[y * w + x] = 1;
          break;
        }
      }
    }
  }
  return out;
}
