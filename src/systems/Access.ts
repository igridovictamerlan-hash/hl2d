import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import { ACCESS, type AccessSite } from '../config/access';
import { FACTIONS } from '../config/factions';
import { coverAuthority } from '../entities/cover';
import { CpBrain } from '../ai/brains/CpBrain';
import { Mover } from '../ai/Mover';
import { ExamineBrain } from '../ai/brains/ExamineBrain';
import { canSeeCircle } from '../world/visibility';
import { T } from '../world/tiles';

const SITES: readonly AccessSite[] = ['nexus', 'academy', 'depot', 'prison'];

/** Решение вахты: пропустить, пропуск поддельный (могут раскрыть) или не пускать. */
export type AccessVerdict = 'yes' | 'forged' | 'no';

/**
 * Пропускной режим режимных объектов (ACCESS): Управа, академия, склад, тюрьма. Тайлы объекта (по зонам;
 * у академии без вестибюля — туда пускают всех) — маска mask. Кто без пропуска шагнул снаружи внутрь, пока
 * объект охраняют вахтёры (RoleSpec.access), — возвращается на шаг назад, ближний вахтёр требует пропуск.
 * Изнутри наружу выходят свободно (отсидевшие, вошедшие, пока вахты не было). Нарушитель внутри (его ВС
 * задержит) — только тот, кто вошёл без права, пока вахты не было (sneaked), а не отсидевший на выходе.
 */
export class Access {
  /** Тайл → номер объекта + 1 (0 — не режимный). */
  private readonly mask: Uint8Array;
  /** Якорь навигации → номер объекта + 1 (по тайлу под центром якоря, как и шаг в update). */
  private readonly anchorSite: Uint8Array;
  /** Центр объекта (для «вахтёр на месте»). */
  readonly centre: Partial<Record<AccessSite, Vec2>> = {};
  private readonly lastOut = new WeakMap<Character, Vec2>();
  private readonly barkAt = new WeakMap<Character, number>();
  private readonly forgedAt = new WeakMap<Character, number>();
  /** Вошёл без права, пока вахты не было (объект): только такого ВС задержит внутри как нарушителя. */
  private readonly sneaked = new WeakMap<Character, AccessSite>();
  private playerAt = -1e9;
  private guardCache: Partial<Record<AccessSite, Character[]>> = {};
  private guardCheck = 0;
  enabled = true;
  readonly stats = { denied: 0, forged: 0, caught: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map } = ctx;
    const ts = map.tileSize;
    this.mask = new Uint8Array(map.width * map.height);
    const lobby = map.poisOf('academy_lobby')[0];
    const inRect = (x: number, y: number) => !!lobby && x >= lobby.x && y >= lobby.y && x < lobby.x + (lobby.w ?? 0) && y < lobby.y + (lobby.h ?? 0);
    // Вестибюль академии и входная дверь в него — для всех.
    const inLobby = (x: number, y: number) =>
      inRect(x, y) || (map.tileAt(x, y) === T.DOOR && (inRect(x + 1, y) || inRect(x - 1, y) || inRect(x, y + 1) || inRect(x, y - 1)));
    const sum = SITES.map(() => ({ x: 0, y: 0, n: 0 }));
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const z = map.zoneAtTile(x, y);
        if (!z) continue;
        const k = SITES.findIndex((s) => ACCESS.zones[s].includes(z.kind));
        if (k < 0 || (SITES[k] === 'academy' && inLobby(x, y))) continue;
        this.mask[y * map.width + x] = k + 1;
        sum[k].x += (x + 0.5) * ts;
        sum[k].y += (y + 0.5) * ts;
        sum[k].n++;
      }
    }
    SITES.forEach((s, k) => {
      if (sum[k].n) this.centre[s] = { x: sum[k].x / sum[k].n, y: sum[k].y / sum[k].n };
    });
    const nav = ctx.nav;
    this.anchorSite = new Uint8Array(nav.w * nav.h);
    for (let ay = 0; ay < nav.h; ay++) for (let ax = 0; ax < nav.w; ax++) this.anchorSite[ay * nav.w + ax] = this.mask[(ay + 1) * map.width + ax + 1];
  }

  /**
   * Для поиска пути: якоря объектов, куда персонажа сейчас не пустят (вахта на месте, права нет), — путь их
   * обходит (иначе житель упирался бы в вахту на коротком пути сквозь Управу). undefined — закрытого нет.
   */
  blockerFor(c: Character): ((anchor: number) => boolean) | undefined {
    if (!this.enabled) return undefined;
    let bits = 0;
    SITES.forEach((s, k) => {
      if (this.centre[s] && this.allowed(c, s) === 'no' && this.manned(s)) bits |= 1 << k;
    });
    if (!bits) return undefined;
    const m = this.anchorSite;
    return (n) => m[n] !== 0 && ((bits >> (m[n] - 1)) & 1) === 1;
  }

  /** Режимный объект в точке мира (или null). */
  siteAt(x: number, y: number): AccessSite | null {
    const ts = this.ctx.map.tileSize;
    const tx = Math.floor(x / ts);
    const ty = Math.floor(y / ts);
    if (tx < 0 || ty < 0 || tx >= this.ctx.map.width || ty >= this.ctx.map.height) return null;
    const k = this.mask[ty * this.ctx.map.width + tx];
    return k ? SITES[k - 1] : null;
  }

  /** Есть ли у персонажа право войти. */
  allowed(c: Character, site: AccessSite): AccessVerdict {
    if (FACTIONS[c.faction].authority || coverAuthority(c)) return 'yes';
    // Под конвоем, в камере, на выходе после срока — с ВС.
    if (c.law.phase !== 'none') return 'yes';
    // Вооружённый враг вахту не спрашивает — с ним бой.
    if (c.hostile || (c.faction === 'rebel' && !c.disguised)) return 'yes';
    if (c.passes.includes(site)) return 'yes';
    const prof = c.disguised ? c.cover?.profession ?? null : c.profession;
    const civil = c.faction === 'citizen' || c.faction === 'cwu';
    if (site === 'nexus' && civil && c.loyalty >= ACCESS.minLoyalty) return 'yes';
    if (site === 'depot' && !c.disguised && (prof === 'loader' || prof === 'armorer')) return 'yes';
    // Медик ТС на месте происшествия — по вызову.
    if (c.brain instanceof ExamineBrain) return 'yes';
    // Подпольщик под личиной — с «липой»; у игрока — купленный поддельный пропуск в Управу.
    if (c.forged.includes(site) || (c.faction === 'rebel' && c.disguised)) return 'forged';
    if (site === 'nexus' && c.inventory.has('forged_pass')) return 'forged';
    return 'no';
  }

  /** Без права находится на режимном объекте (ВС задержит как за запретную зону). */
  trespassing(c: Character): boolean {
    const s = this.siteAt(c.x, c.y);
    return !!s && this.sneaked.get(c) === s && this.allowed(c, s) === 'no';
  }

  /** Вахтёры объекта на месте: живые, на ногах, не дальше onDuty px от объекта. */
  guards(site: AccessSite): Character[] {
    const now = this.ctx.law.now;
    if (now >= this.guardCheck) {
      this.guardCheck = now + 1;
      this.guardCache = {};
      for (const c of this.ctx.entities.list) {
        const s = c.role?.access;
        if (!s || !c.alive || c.downed || c.faction !== 'cp') continue;
        const p = this.centre[s];
        if (!p || Math.hypot(c.x - p.x, c.y - p.y) > ACCESS.onDuty) continue;
        (this.guardCache[s] ??= []).push(c);
      }
    }
    return this.guardCache[site] ?? [];
  }

  /** Объект охраняется. */
  manned(site: AccessSite): boolean {
    return this.guards(site).length > 0;
  }

  /** Ближний вахтёр к точке (или null). */
  private nearestGuard(site: AccessSite, x: number, y: number, r: number): Character | null {
    let best: Character | null = null;
    let bd = r;
    for (const g of this.guards(site)) {
      const d = Math.hypot(g.x - x, g.y - y);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  update(): void {
    if (!this.enabled) return;
    const now = this.ctx.law.now;
    for (const c of this.ctx.entities.list) {
      if (!c.alive) continue;
      const s = this.siteAt(c.x, c.y);
      const was = c.accessAt;
      // Вышел с объекта или попал под стражу (отсидевшего выпускают через тот же объект) — не нарушитель.
      if (this.sneaked.has(c) && (this.sneaked.get(c) !== s || c.law.phase !== 'none')) this.sneaked.delete(c);
      if (was === undefined || c.downed || c.draggedBy) {
        c.accessAt = s;
        if (!s) this.lastOut.set(c, { x: c.x, y: c.y });
        continue;
      }
      if (s && s !== was) {
        const v = this.allowed(c, s);
        if (v === 'yes' || !this.manned(s)) {
          if (v === 'no') this.sneaked.set(c, s);
          c.accessAt = s;
          continue;
        }
        const g = this.nearestGuard(s, c.x, c.y, ACCESS.inspect);
        if (v === 'forged') {
          // «Липу» вахтёр, который её видит, раскрывает с шансом catchChance (не чаще recheck с на человека).
          if (g && now - (this.forgedAt.get(c) ?? -1e9) >= ACCESS.recheck && canSeeCircle(this.ctx.map, g.x, g.y, c.x, c.y, c.radius)) {
            this.forgedAt.set(c, now);
            this.stats.forged++;
            if (this.ctx.rng.chance(ACCESS.catchChance)) {
              this.stats.caught++;
              g.say(this.ctx.rng.pick(ACCESS.lines.forged), now, 2.5);
              c.forged = c.forged.filter((x) => x !== s);
              if (c.isPlayer) c.inventory.remove('forged_pass', 1);
              this.pushBack(c, true);
              if (g.brain instanceof CpBrain && !g.brain.target) g.brain.engage(c, 'forgery');
              continue;
            }
          }
          c.accessAt = s;
          continue;
        }
        // Стоял у входа, и его втолкнули (толпа у ворот) — молча на место; шёл внутрь — вахта не пускает.
        const wants = c.isPlayer || c.wantX !== 0 || c.wantY !== 0;
        this.pushBack(c, wants);
        if (!wants) continue;
        this.stats.denied++;
        const guard = g ?? this.nearestGuard(s, c.x, c.y, ACCESS.onDuty);
        if (guard && now - (this.barkAt.get(guard) ?? -1e9) >= ACCESS.barkEvery) {
          this.barkAt.set(guard, now);
          guard.say(this.ctx.rng.pick(ACCESS.lines.stop), now, 2);
          if (!c.isPlayer && this.ctx.rng.chance(0.5)) c.say(this.ctx.rng.pick(ACCESS.lines.denied), now, 2);
        }
        if (c.isPlayer && now - this.playerAt >= ACCESS.playerEvery) {
          this.playerAt = now;
          this.ctx.bus.emit('log', { text: `Вахта: «Пропуск!» — ${ACCESS.names[s]}: вход только по пропускам.`, kind: 'system' });
        }
        continue;
      }
      c.accessAt = s;
      if (!s) this.lastOut.set(c, { x: c.x, y: c.y });
    }
  }

  /** Шаг внутрь отменяется: назад, где был снаружи; у NPC путь перестраивается в обход объекта. */
  private pushBack(c: Character, replan: boolean): void {
    const p = this.lastOut.get(c);
    if (!p) return;
    c.x = c.prevX = p.x;
    c.y = c.prevY = p.y;
    c.vx = c.vy = 0;
    const m = (c.brain as { mover?: unknown } | null)?.mover;
    if (replan && !c.isPlayer && m instanceof Mover) m.replan(c, this.ctx);
  }
}
