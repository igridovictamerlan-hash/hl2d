import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { Vec2 } from '../core/math';
import { WAR } from '../config/war';
import { ALARM } from '../config/underground';
import { FACTIONS } from '../config/factions';
import { T } from '../world/tiles';
import { ZONE_NAMES } from '../config/names';
import { equipKit } from './Population';
import { RebelBrain } from '../ai/brains/RebelBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { OtaBrain } from '../ai/brains/OtaBrain';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { DefectorBrain } from '../ai/brains/DefectorBrain';
import { RebelCommand } from './RebelCommand';
import { spawnRole } from './Roster';
import { armySpec } from './Population';

/** Мозг бойца отряда — если он сейчас «свой» (задержанный ведёт себя как PrisonerBrain). */
function rebelBrain(r: Character): RebelBrain | null {
  return r.brain instanceof RebelBrain ? r.brain : null;
}

/** Код тревоги: зелёный — спокойно, жёлтый — нападение/саботаж в городе, красный — прорыв периметра. */
export type AlertCode = 'green' | 'yellow' | 'red';

/** Идущий капт КПП: до какого времени и счёт убийств в зоне. */
export interface Capture {
  since: number;
  until: number;
  rebelKills: number;
  cpKills: number;
  /** Гарнизон точки в начале капта: перебит — точка захвачена. */
  defenders: Character[];
  /** Какую точку тамбура штурмуют (индекс в Front.points). */
  point: number;
}

/**
 * Точка тамбура КПП (как D3–D4 / D5–D6 на UnionRP): камера коридора между воротами, её посты
 * и доля коридора (от внешних ворот), которую она занимает.
 */
export interface DPoint {
  name: string;
  /** Зона двора на карте, посты в нём, пол двора (якоря, от входа со стороны пустоши) и центр. */
  zone: number;
  posts: Vec2[];
  floor: number[];
  center: Vec2;
}


/** Фронт — пограничный КПП: пустошь с отрядами повстанцев по ту сторону ворот. */
export interface Front {
  index: number;
  name: string;
  /** Центр пустоши, px. */
  exit: Vec2;
  /** Центры внешних ворот, середина шорта, внутренние ворота, точка за ними (в сторону города). */
  outerGate: Vec2;
  midGate: Vec2;
  innerGate: Vec2;
  /** Проходы между дворами, как в CS: шорт (прямой) и лонг (обход поверху) — якоря и зоны. */
  short: number[];
  long: number[];
  shortZone: number;
  longZone: number;
  apron: Vec2;
  posts: Vec2[];
  /** Проходная со стороны города (зона, -1 — нет) и её посты RCT. */
  gatehouse: number;
  gatePosts: Vec2[];
  /** Якоря пустоши у этого КПП и укрытия бункера. */
  outlands: number[];
  bunker: number[];
  /** Все бойцы повстанцев на этом фронте (из всех подошедших отрядов). */
  squad: Character[];
  /** Когда здесь последний раз стреляли (для маркеров на экране). */
  lastShot: number;
  /** О штурме текущего отряда уже сообщили. */
  assaultAnnounced: boolean;
  /** Пол КПП (внешний двор, шорт, внутренний двор), от внешних ворот к внутренним. */
  corridor: number[];
  /** Точки тамбура: [внешняя, внутренняя]; сколько из них (с внешней) держат повстанцы. */
  points: DPoint[];
  held: number;
  /** КПП прорван (все точки у повстанцев) — 'rebels'; идущий капт (счёт убийств). */
  owner: 'combine' | 'rebels';
  capture: Capture | null;
  nextCaptureAt: number;
  heldSince: number;
  /** Сколько секунд в отбиваемой точке нет повстанцев (а ГО уже там). */
  rebelFree: number;
  /** Когда следующий контрудар из Цитадели по захваченной точке. */
  retakeAt: number;
  reinforceAt: number;
  medicAt: number;
}

/**
 * Война на границе. У каждого пограничного КПП по ту сторону ворот — отряды повстанцев,
 * постоянная перестрелка с часовыми GRID. Иногда отряд идёт на прорыв через коридор;
 * прорвавшийся в город объявляет КРАСНЫЙ КОД: комендантский час, из Нексуса выходит OTA,
 * ГО прочёсывает город. Когда прорвавшихся не осталось — отбой (зелёный код).
 */
export class WarSystem {
  code: AlertCode = 'green';
  /** Код, включённый с терминала Администратора (держится до отмены), и кто его включил. */
  manualCode: AlertCode | null = null;
  private manualBy: Character | null = null;
  curfew = false;
  readonly fronts: Front[] = [];
  readonly infiltrators = new Set<Character>();
  /** Нападавшие в городе (повстанцы с операций из канализации, напавший на ГО игрок). */
  readonly operatives = new Set<Character>();
  /** Точка тревоги: куда стягиваются патрули, пока нападавших не видно. */
  alarm: { x: number; y: number; until: number } | null = null;
  private yellowSince = 0;
  private alarmKills = 0;
  private lastAlarmRaise = -1e9;
  /** Последние известные позиции прорвавшихся (для охоты). */
  readonly lastKnown = new Map<Character, Vec2>();
  /** Укрытия на время комендантского часа: подъезды, дворы, магазин. */
  readonly shelters: number[] = [];
  /** Кто какое укрытие занял (якорь → гражданин). */
  private readonly shelterClaims = new Map<number, Character>();
  readonly ota: Character[] = [];
  private time = 0;
  private redSince = 0;
  private calm = 0;
  private scanTimer = 0;
  curfewSince = 0;
  /** Все точки D у повстанцев — они выходят в город. */
  cityPush = false;
  /** Подкрепления ГО из Цитадели на КПП (тесты отключают, чтобы они не шли через город). */
  reinforcements = true;
  /** Граждане, бегущие к прорванному КПП, чтобы примкнуть к повстанцам. */
  readonly defectors = new Set<Character>();
  private defectIn = 0;
  /** Сколько граждан ещё может уйти за текущий прорыв; граждан было в начале. */
  private defectLeft = 0;
  private citizensAtStart = -1;
  readonly stats = { defected: 0, counterattacks: 0, nexusFalls: 0, victories: 0 };
  /** Штурм Нексуса: накопленный захват (с), захвачен ли и когда, объявлен ли штурм. */
  readonly nexus = { progress: 0, fallen: false, fallenAt: 0, rebels: 0, defenders: 0, wave: false, waveSince: 0, stagedSince: -1 };
  /** Командование сопротивления: армия в лагере, цель главы, клич. */
  readonly command: RebelCommand;

  constructor(private readonly ctx: AiContext) {
    this.command = new RebelCommand(ctx);
    this.buildFronts();
    ctx.economy.paused = () => this.curfew;
    ctx.economy.onSabotage = (spot) => this.raiseAlarm(spot.x, spot.y, 'саботаж узла Альянса');
    ctx.combat.onDamage = (target, attacker, killed) => this.onDamage(target, attacker, killed);
    const nav = ctx.nav;
    for (const a of nav.walkable) {
      const t = ctx.map.tileAt(nav.ax(a) + 1, nav.ay(a) + 1);
      const kind = ctx.map.zones[nav.zone[a]]?.kind;
      if ((t === T.INTERIOR || t === T.COURTYARD) && (kind === 'residential' || kind === 'industrial' || kind === 'shop')) this.shelters.push(a);
    }
  }

  get now(): number {
    return this.time;
  }

  /**
   * Фронты по карте: у каждого выхода в пустошь — свой КПП из зон: внешний двор (с воротами к
   * пустоши), внутренний (с воротами к городу), шорт (прямой проход, ближе к оси ворот) и лонг.
   */
  private buildFronts(): void {
    const { map, nav, rng } = this.ctx;
    const ts = map.tileSize;
    const exits = map.poisOf('outlands_exit').map((e) => ({ x: (e.x + 0.5) * ts, y: (e.y + 0.5) * ts }));
    const nearestExit = (p: Vec2) => {
      let best = 0;
      exits.forEach((e, k) => {
        if (Math.hypot(p.x - e.x, p.y - e.y) < Math.hypot(p.x - exits[best].x, p.y - exits[best].y)) best = k;
      });
      return best;
    };
    // Якоря зон КПП, по зонам.
    const zoneAnchors = new Map<number, number[]>();
    for (const a of nav.walkable) {
      const z = nav.zone[a];
      if (map.zones[z]?.kind !== 'checkpoint') continue;
      if (!zoneAnchors.has(z)) zoneAnchors.set(z, []);
      zoneAnchors.get(z)!.push(a);
    }
    const centroid = (list: number[]): Vec2 => ({
      x: list.reduce((s, a) => s + nav.worldX(a), 0) / Math.max(1, list.length),
      y: list.reduce((s, a) => s + nav.worldY(a), 0) / Math.max(1, list.length),
    });
    const avg = (list: Vec2[]) => ({ x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length });
    const posts = map.poisOf('checkpoint_post').map((p) => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts }));
    exits.forEach((exit, index) => {
      const allHere = [...zoneAnchors.keys()].filter((z) => nearestExit(centroid(zoneAnchors.get(z)!)) === index);
      // Проходная — не часть «войны на D»: её ворота-дверь и посты RCT отдельно.
      const gatehouse = allHere.find((z) => map.zones[z]?.name.endsWith(ZONE_NAMES.gatehouse)) ?? -1;
      const zonesHere = allHere.filter((z) => z !== gatehouse);
      const myPosts = posts.filter((p) => nearestExit(p) === index);
      const dExit = (p: Vec2) => Math.hypot(p.x - exit.x, p.y - exit.y);
      // Ворота: группа ближе к пустоши — внешние, дальше — внутренние (к проспекту).
      const gates: Vec2[] = [];
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (map.tileAt(x, y) !== T.GATE) continue;
          const z = map.zoneGrid[y * map.width + x];
          if (zonesHere.includes(z)) gates.push({ x: (x + 0.5) * ts, y: (y + 0.5) * ts });
        }
      }
      gates.sort((a, b) => dExit(a) - dExit(b));
      const groups: Vec2[][] = [];
      for (const g of gates) {
        const last = groups[groups.length - 1];
        if (last && Math.hypot(g.x - last[0].x, g.y - last[0].y) < ts * 4) last.push(g);
        else groups.push([g]);
      }
      const outerGate = groups.length ? avg(groups[0]) : exit;
      const innerGate = groups.length > 1 ? avg(groups[groups.length - 1]) : exit;
      const zoneOfPoint = (p: Vec2) => map.zoneGrid[Math.floor(p.y / ts) * map.width + Math.floor(p.x / ts)];
      const outerZone = zoneOfPoint(outerGate);
      const innerZone = zoneOfPoint(innerGate);
      // Остальные две зоны — шорт (ближе к оси ворот) и лонг.
      const dl = Math.hypot(innerGate.x - outerGate.x, innerGate.y - outerGate.y) || 1;
      const offAxis = (p: Vec2) => Math.abs((p.x - outerGate.x) * (innerGate.y - outerGate.y) - (p.y - outerGate.y) * (innerGate.x - outerGate.x)) / dl;
      const links = zonesHere.filter((z) => z !== outerZone && z !== innerZone).sort((a, b) => offAxis(centroid(zoneAnchors.get(a)!)) - offAxis(centroid(zoneAnchors.get(b)!)));
      const shortZone = links[0] ?? -1;
      const longZone = links[1] ?? -1;
      const anchorsOf = (z: number) => zoneAnchors.get(z) ?? [];
      const floor = (z: number) => anchorsOf(z).filter((a) => map.tileAt(nav.ax(a) + 1, nav.ay(a) + 1) !== T.INTERIOR);
      // Точка за КПП со стороны города: за дверью проходной (нет проходной — за внутренними воротами).
      const doors: Vec2[] = [];
      if (gatehouse >= 0) {
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            if (map.zoneGrid[y * map.width + x] === gatehouse && map.tileAt(x, y) === T.DOOR) doors.push({ x: (x + 0.5) * ts, y: (y + 0.5) * ts });
          }
        }
      }
      const cityDoor = doors.length ? avg(doors) : innerGate;
      const apron = { x: cityDoor.x + ((innerGate.x - outerGate.x) / dl) * 56, y: cityDoor.y + ((innerGate.y - outerGate.y) / dl) * 56 };
      const gatePosts = map.poisOf('gate_post').map((p) => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts })).filter((p) => nearestExit(p) === index);
      const outlands: number[] = [];
      for (const a of nav.walkable) {
        if (map.zones[nav.zone[a]]?.kind === 'outlands' && dExit({ x: nav.worldX(a), y: nav.worldY(a) }) < 14 * ts) outlands.push(a);
      }
      const bunker = zonesHere.flatMap((z) => anchorsOf(z).filter((a) => map.tileAt(nav.ax(a) + 1, nav.ay(a) + 1) === T.INTERIOR));
      const byDist = (from: Vec2) => (a: number, b: number) =>
        Math.hypot(nav.worldX(a) - from.x, nav.worldY(a) - from.y) - Math.hypot(nav.worldX(b) - from.x, nav.worldY(b) - from.y);
      const corridor = [...floor(outerZone), ...floor(shortZone), ...floor(innerZone)].sort(byDist(outerGate));
      const names = WAR.pointNames[index] ?? [`D${index * 2 + 1}`, `D${index * 2 + 2}`];
      const outerFloor = floor(outerZone).sort(byDist(outerGate));
      const outerCenter = outerFloor.length ? centroid(outerFloor) : outerGate;
      const innerFloor = floor(innerZone).sort(byDist(outerCenter));
      const points: DPoint[] = [
        { name: names[0], zone: outerZone, posts: myPosts.filter((p) => zoneOfPoint(p) === outerZone), floor: outerFloor, center: outerCenter },
        { name: names[1], zone: innerZone, posts: myPosts.filter((p) => zoneOfPoint(p) === innerZone), floor: innerFloor, center: innerFloor.length ? centroid(innerFloor) : innerGate },
      ];
      const shortFloor = floor(shortZone).sort(byDist(outerGate));
      const longFloor = floor(longZone).sort(byDist(outerGate));
      const baseName = (map.zones[outerZone]?.name ?? `КПП ${index + 1}`).replace(/ · .*$/, '');
      this.fronts.push({
        index, name: baseName, exit, outerGate, midGate: shortFloor.length ? centroid(shortFloor) : avg([outerGate, innerGate]), innerGate, apron,
        posts: myPosts, gatehouse, gatePosts, outlands, bunker, short: shortFloor, long: longFloor, shortZone, longZone,
        squad: [],
        lastShot: -1e9, reinforceAt: 0, medicAt: 0, assaultAnnounced: false, corridor, points, held: 0,
        owner: 'combine', capture: null, nextCaptureAt: WAR.capture.firstAfter + rng.range(0, 10), heldSince: 0, rebelFree: 0, retakeAt: 0,
      });
    });
  }

  /** Персонаж на улице (не в подъезде/дворе/помещении). */
  outdoors(c: Character): boolean {
    const map = this.ctx.map;
    const tx = Math.floor(c.x / map.tileSize);
    const ty = Math.floor(c.y / map.tileSize);
    const t = map.tileAt(tx, ty);
    if (t === T.INTERIOR || t === T.COURTYARD || t === T.DOOR) return false;
    const kind = map.zoneAtTile(tx, ty)?.kind;
    return kind !== 'shop' && kind !== 'nexus' && kind !== 'cells';
  }

  /** Нарушает ли персонаж комендантский час (после отсрочки на то, чтобы дойти до дома). */
  curfewViolation(c: Character): boolean {
    return (
      this.curfew && this.time - this.curfewSince > WAR.curfewGrace && c.alive &&
      !FACTIONS[c.faction].authority && c.law.phase === 'none' && this.outdoors(c)
    );
  }

  /**
   * Укрытие для гражданина на время комендантского часа: ближайшее из случайной выборки, но не
   * занятое другими и не вплотную к занятым (иначе толпа набивается в один тупик и застревает).
   */
  nearestShelter(x: number, y: number, who: Character | null = null): number {
    const nav = this.ctx.nav;
    if (who) this.releaseShelter(who);
    const claimed = [...this.shelterClaims.entries()].filter(([, c]) => c.alive).map(([a]) => a);
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < 60 && this.shelters.length; k++) {
      const a = this.ctx.rng.pick(this.shelters);
      const ax = nav.worldX(a);
      const ay = nav.worldY(a);
      let d = Math.hypot(ax - x, ay - y);
      for (const b of claimed) if (Math.hypot(nav.worldX(b) - ax, nav.worldY(b) - ay) < WAR.shelterSpacing) d += WAR.shelterCrowdPenalty;
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (who && best >= 0) this.shelterClaims.set(best, who);
    return best;
  }

  releaseShelter(who: Character): void {
    for (const [a, c] of this.shelterClaims) if (c === who) this.shelterClaims.delete(a);
  }

  /** Сообщить: сотрудник Альянса видит прорвавшегося. */
  sighted(c: Character): void {
    if (this.infiltrators.has(c) || this.operatives.has(c)) this.lastKnown.set(c, { x: c.x, y: c.y });
  }

  /** Ближайшая известная позиция прорвавшегося. */
  nearestKnown(x: number, y: number): Vec2 | null {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const [c, p] of this.lastKnown) {
      if (!c.alive || (!this.infiltrators.has(c) && !this.operatives.has(c))) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    // Никого не видели — точка тревоги (пока не истекла).
    if (!best && this.alarm && this.time < this.alarm.until) best = { x: this.alarm.x, y: this.alarm.y };
    return best;
  }

  /**
   * Принудительный штурм (отладка, тесты): отряд фронта идёт на прорыв в город. Нет отряда — из
   * лагеря выходит боец армии прямо на пустошь этого КПП.
   */
  forceAssault(front = 0): void {
    const f = this.fronts[front];
    if (!f) return;
    if (f.squad.length === 0 && f.outlands.length) {
      const a = this.ctx.rng.pick(f.outlands);
      const c = spawnRole(this.ctx, armySpec('rebel_soldier', 'rebel_raider', 0), { x: this.ctx.nav.worldX(a), y: this.ctx.nav.worldY(a) });
      const b = c ? rebelBrain(c) : null;
      if (c && b) {
        b.setFront(front);
        b.march('gather');
        f.squad.push(c);
      }
    }
    for (const r of f.squad) rebelBrain(r)?.orderAssault();
  }

  /** Посты, где сейчас стоят часовые (для огня на подавление). */
  guardPosts(f: Front): Vec2[] {
    const out: Vec2[] = [];
    for (const g of this.guardsOf(f).guards) {
      const b = g.brain as CpBrain;
      if (b.guardPost && b.fsm.current !== 'retreat') out.push(b.guardPost);
    }
    return out;
  }

  /** Индекс точки тамбура, к которой относится пост (или -1). */
  pointOfPost(f: Front, post: Vec2): number {
    return f.points.findIndex((pt) => pt.posts.some((p) => p.x === post.x && p.y === post.y));
  }

  /**
   * Часть КПП фронта f под точкой: 0 — внешний двор, 1 — шорт или лонг, 2 — внутренний двор,
   * -1 — не КПП этого фронта.
   */
  sectionAt(f: Front, x: number, y: number): number {
    const map = this.ctx.map;
    const ts = map.tileSize;
    const tx = Math.floor(x / ts);
    const ty = Math.floor(y / ts);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1;
    const z = map.zoneGrid[ty * map.width + tx];
    if (z === f.points[0]?.zone) return 0;
    if (z === f.points[1]?.zone) return 2;
    if (z === f.shortZone || z === f.longZone) return 1;
    return -1;
  }

  /** Индекс точки D (двора), где стоит персонаж, или -1 (шорт, лонг, вне КПП). */
  pointAt(f: Front, x: number, y: number): number {
    const s = this.sectionAt(f, x, y);
    return s === 0 ? 0 : s === 2 ? 1 : -1;
  }

  /** Часовые (по точкам тамбура) и медики КПП. */
  private guardsOf(f: Front): { guards: Character[]; medics: Character[] } {
    const guards: Character[] = [];
    const medics: Character[] = [];
    for (const c of this.ctx.entities.list) {
      if (!c.alive || !(c.brain instanceof CpBrain) || c.brain.front !== f.index) continue;
      if (c.brain.medicStation) medics.push(c);
      else if (c.brain.guardPost) guards.push(c);
    }
    return { guards, medics };
  }

  /** Сколько защитников (ГО на постах, OTA) живы у точки k фронта f. */
  defendersAt(f: Front, k: number): number {
    let n = 0;
    for (const c of this.ctx.entities.list) {
      if (!c.alive) continue;
      const b = c.brain;
      if (b instanceof CpBrain && b.front === f.index && b.guardPost && this.pointOfPost(f, b.guardPost) === k) n++;
      else if (b instanceof OtaBrain && b.front === f.index && b.post && this.pointOfPost(f, b.post) === k) n++;
    }
    return n;
  }

  /**
   * Контрудар: свободные OTA из резерва в Цитадели бегут на посты точки k (ГО туда же приходят сами —
   * часовые этой точки после гибели возрождаются в Цитадели и бегут на свои посты).
   */
  private counterattack(f: Front, k: number): number {
    if (!this.reinforcements) return 0;
    const pt = f.points[k];
    const posts = pt?.posts.length ? pt.posts : f.posts;
    let sent = 0;
    for (const o of this.ota) {
      if (sent >= WAR.capture.retakeOta || !o.alive) continue;
      const b = o.brain;
      if (!(b instanceof OtaBrain) || !b.available) continue;
      b.assignPost(f.index, posts[sent % posts.length], Math.atan2(f.exit.y - posts[sent % posts.length].y, f.exit.x - posts[sent % posts.length].x));
      sent++;
    }
    return sent;
  }

  /** В городе ли точка (не КПП, не пустошь, не канализация) — там нападение поднимает тревогу. */
  private inCity(x: number, y: number): boolean {
    if (this.ctx.map.levelAt(x, y) !== 'city') return false;
    const kind = this.ctx.map.zoneAtWorld(x, y)?.kind;
    return kind !== 'checkpoint' && kind !== 'outlands' && kind !== 'wasteland' && kind !== 'rebel_camp';
  }

  /** Ранение сотрудника Альянса в городе — тревога; погибшие за тревогу — эскалация до красного. */
  /** Фронт, в зоне которого точка (КПП или пустошь у него), или null. */
  frontAt(x: number, y: number): Front | null {
    const kind = this.ctx.map.zoneAtWorld(x, y)?.kind;
    if (kind !== 'checkpoint' && kind !== 'outlands') return null;
    let best: Front | null = null;
    let bestD = Infinity;
    for (const f of this.fronts) {
      const d = Math.hypot(f.innerGate.x - x, f.innerGate.y - y);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  /** Убийство в зоне КПП во время капта — в счёт. */
  private countCaptureKill(target: Character, attacker: Character): void {
    const f = this.frontAt(target.x, target.y) ?? this.frontAt(attacker.x, attacker.y);
    const c = f?.capture;
    if (!f || !c) return;
    const rebelKill = attacker.faction === 'rebel' && FACTIONS[target.faction].authority;
    const cpKill = FACTIONS[attacker.faction].authority && target.faction === 'rebel';
    if (!rebelKill && !cpKill) return;
    if (rebelKill) c.rebelKills++;
    else c.cpKills++;
    if (attacker.isPlayer) this.ctx.bus.emit('log', { text: `Капт ${f.name}: ваше убийство засчитано (${c.rebelKills} : ${c.cpKills}).`, kind: 'system' });
    // Досрочная победа — только с перевесом (как в капте: у кого больше убийств).
    if (c.rebelKills >= WAR.capture.killsToWin && c.rebelKills > c.cpKills) this.endCapture(f, true);
  }

  /** Начать капт очередной точки КПП (или принудительно — для тестов и отладки). */
  startCapture(f: Front): void {
    if (f.capture || f.held >= f.points.length) return;
    const point = f.held;
    const pt = f.points[point];
    const { guards, medics } = this.guardsOf(f);
    // Гарнизон точки: часовые её постов (внутренней — ещё и медики бункера).
    const defenders = guards.filter((g) => this.pointOfPost(f, (g.brain as CpBrain).guardPost!) === point);
    if (point === f.points.length - 1) defenders.push(...medics);
    f.capture = { since: this.time, until: this.time + WAR.capture.duration, rebelKills: 0, cpKills: 0, defenders, point };
    f.reinforceAt = f.medicAt = 0;
    this.ctx.law.log(`${f.name}: КАПТ точки ${pt.name}! Повстанцы (${f.squad.length}) идут на захват. Подкреплений не будет — держать оборону!`, 'radio');
    this.ctx.bus.emit('announce', { text: `Капт · ${f.name} · ${pt.name}` });
    // На внутренний двор идут и державшие внешний (на постах остаётся WAR.capture.keepOnHeld).
    let keep = point > 0 ? WAR.capture.keepOnHeld : 0;
    for (const r of f.squad) {
      const b = rebelBrain(r);
      if (!b) continue;
      if (b.mode === 'hold' && keep > 0) {
        keep--;
        continue;
      }
      b.orderCapture(point > 0);
    }
    // Не одной толпой: звенья со своими полосами двора и проходами, перекаты.
    this.command.formTeams(f, true);
  }

  private endCapture(f: Front, won: boolean): void {
    const c = f.capture;
    if (!c) return;
    f.capture = null;
    f.nextCaptureAt = this.time + WAR.capture.cooldown;
    const pt = f.points[c.point];
    const score = `${c.rebelKills} : ${c.cpKills}`;
    const attackers = f.squad.filter((r) => rebelBrain(r)?.mode === 'capture');
    this.command.onCaptureEnd(f.index, won);
    if (!won) {
      this.ctx.law.log(`${f.name}: капт ${pt.name} отбит (${score}). Точка удержана.`, 'radio');
      this.ctx.bus.emit('announce', { text: `${pt.name} удержана · ${score}` });
      for (const r of attackers) rebelBrain(r)?.orderRegroup();
      return;
    }
    f.held = c.point + 1;
    f.heldSince = this.time;
    f.retakeAt = this.time + WAR.capture.counterDelay;
    f.rebelFree = 0;
    f.reinforceAt = 0;
    const breached = f.held >= f.points.length;
    // Точку держат штурмовавшие: занимают её посты; лишние (пока КПП не прорван) — назад на сбор.
    const posts = pt.posts.length ? pt.posts : f.posts;
    attackers.forEach((r, k) => {
      if (breached || k < posts.length) rebelBrain(r)?.orderHold(posts[k % posts.length]);
      else rebelBrain(r)?.orderRegroup();
    });
    if (breached) {
      this.breach(f);
      this.ctx.law.log(`${f.name}: КПП ПРОРВАН — ${f.points.map((p) => p.name).join('–')} у повстанцев (${score})! Граждане бегут к КПП примкнуть к сопротивлению.`, 'radio');
      this.ctx.bus.emit('announce', { text: `КПП прорван · ${f.name}` });
    } else {
      this.ctx.law.log(`${f.name}: точка ${pt.name} ЗАХВАЧЕНА повстанцами (${score})! Следующая — ${f.points[f.held].name}.`, 'radio');
      this.ctx.bus.emit('announce', { text: `${pt.name} захвачена · ${score}` });
    }
    // Захват точки — тревога (код жёлтый); красный — только выход повстанцев в город.
    this.raiseAlarm(f.apron.x, f.apron.y, `${f.name}: точка ${pt.name} захвачена повстанцами`);
  }

  /** КПП прорван: все точки у повстанцев — к нему потянутся граждане (WAR.defect). */
  breach(f: Front): void {
    f.held = f.points.length;
    f.owner = 'rebels';
    this.defectIn = 0;
    this.defectLeft += WAR.defect.perBreach;
    // Посты прорванного КПП держат захватившие; остальная армия — на следующий КПП.
    if (this.fronts.some((o) => o.owner !== 'rebels')) this.command.pickTarget(`${f.name} прорван`);
  }

  /**
   * Капт: старт при сборе повстанцев, таймер. Захваченные точки Альянс отбивает контрударами из
   * Цитадели (ГО + OTA), начиная с ближней к городу; точка отбита, когда в её камере (и дальше к
   * городу) нет повстанцев, а ГО уже там — retakeCalm с.
   */
  private updateCapture(f: Front, dt: number): void {
    const W = WAR.capture;
    const list = this.ctx.entities.list;
    const rebels = list.filter((c) => c.alive && c.faction === 'rebel' && this.frontAt(c.x, c.y) === f).length;
    if (f.held < f.points.length && !f.capture && rebels >= W.minAttackers && this.time >= f.nextCaptureAt) this.startCapture(f);
    const c = f.capture;
    if (c) {
      // Гарнизон точки перебит — захвачена; штурмующих не осталось (погибли, отошли) — отбита.
      const wiped = c.defenders.length > 0 && c.defenders.every((d) => !d.alive);
      const attackers = f.squad.filter((r) => rebelBrain(r)?.mode === 'capture').length;
      if (wiped) this.endCapture(f, true);
      else if (attackers === 0 && this.time - c.since > 2) this.endCapture(f, false);
      else if (this.time >= c.until) this.endCapture(f, c.rebelKills >= W.minKills && c.rebelKills > c.cpKills);
      return;
    }
    if (f.held === 0) return;
    const k = f.held - 1;
    const pt = f.points[k];
    if (this.time >= f.retakeAt) {
      f.retakeAt = this.time + W.retakeEvery;
      const sent = this.counterattack(f, k);
      if (sent > 0) {
        this.stats.counterattacks++;
        this.ctx.law.log(`${f.name}: контрудар — из Цитадели на ${pt.name} бегут OTA (${sent}).`, 'radio');
      }
    }
    let rebelsIn = 0;
    let cpIn = 0;
    for (const o of list) {
      if (!o.alive) continue;
      // Отбиваемая точка и всё, что ближе к городу (для внешнего двора — ещё шорт и лонг).
      const at = this.sectionAt(f, o.x, o.y);
      if (at < k * 2) continue;
      if (o.faction === 'rebel') rebelsIn++;
      else if (FACTIONS[o.faction].authority) cpIn++;
    }
    f.rebelFree = rebelsIn === 0 && cpIn > 0 ? f.rebelFree + dt : 0;
    if (this.time - f.heldSince >= W.holdTime && f.rebelFree >= W.retakeCalm) {
      f.held = k;
      f.owner = 'combine';
      f.heldSince = this.time;
      f.rebelFree = 0;
      f.retakeAt = this.time + W.counterDelay;
      f.nextCaptureAt = this.time + W.cooldown;
      // Кто держал посты отбитой точки — назад на сбор.
      for (const r of f.squad) {
        const b = rebelBrain(r);
        if (b?.mode === 'hold' && b.post && this.pointOfPost(f, b.post) >= k) b.orderRegroup();
      }
      const all = f.held === 0;
      this.ctx.law.log(`${f.name}: точка ${pt.name} отбита.${all ? ' КПП снова под контролем Альянса.' : ''}`, 'radio');
      this.ctx.bus.emit('announce', { text: all ? `КПП отбит · ${f.name}` : `${pt.name} отбита` });
    }
  }

  private onDamage(target: Character, attacker: Character | null, killed: boolean): void {
    if (attacker && killed) this.countCaptureKill(target, attacker);
    if (!attacker || !FACTIONS[target.faction].authority || FACTIONS[attacker.faction].authority) return;
    // Нападение в городе — и цель, и стрелок в городе (огонь с постов КПП по проспекту — это фронт).
    if (!this.inCity(target.x, target.y) || !this.inCity(attacker.x, attacker.y)) return;
    this.operatives.add(attacker);
    this.lastKnown.set(attacker, { x: attacker.x, y: attacker.y });
    if (this.time - this.lastAlarmRaise > 10) this.raiseAlarm(target.x, target.y, `нападение на сотрудника ${FACTIONS[target.faction].role}`);
    else if (this.alarm) this.alarm.until = this.time + ALARM.pointTime;
    if (killed && this.code === 'yellow' && ++this.alarmKills >= ALARM.escalateKills) {
      this.declareRed(this.ctx.map.zoneAtWorld(target.x, target.y)?.name ?? 'город', 'Потери среди сотрудников Альянса');
    }
  }

  /**
   * Тревога Администратора (код жёлтый): нападение или саботаж в городе. Патрули рядом стягиваются
   * к точке тревоги, проверки CID чаще. При красном коде — только обновляет точку.
   */
  raiseAlarm(x: number, y: number, what: string): void {
    this.lastAlarmRaise = this.time;
    this.alarm = { x, y, until: this.time + ALARM.pointTime };
    const zone = this.ctx.map.zoneAtWorld(x, y)?.name ?? 'город';
    if (this.code !== 'green') {
      this.ctx.law.log(`Надзор: ${what} — ${zone}. Всем патрулям в квартале — усилить поиск.`, 'radio');
      return;
    }
    this.code = 'yellow';
    this.yellowSince = this.time;
    this.alarmKills = 0;
    this.calm = 0;
    this.ctx.law.log(`Администрация: Код ЖЁЛТЫЙ! ${what[0].toUpperCase()}${what.slice(1)} — ${zone}. Граждане, сохраняйте спокойствие и предъявляйте CID по первому требованию.`, 'world');
    this.ctx.bus.emit('alert', { code: 'yellow' });
    this.ctx.bus.emit('announce', { text: `Код жёлтый · ${what}` });
    for (const c of this.ctx.entities.list) if (c.faction === 'admin') c.say('Внимание! Код жёлтый!', this.ctx.law.now, 4);
  }

  /** Может ли персонаж пользоваться терминалом кодов тревоги. */
  canSetCode(c: Character): boolean {
    return c.alive && (c.faction === 'admin' || (c.faction === 'cp' && c.rank >= WAR.terminal.minCpRank));
  }

  /**
   * Терминал Администратора: включить код жёлтый / красный или отбой (зелёный). null — сделано, иначе
   * причина отказа. Включённый так код держится, пока его не снимут с терминала.
   */
  setCode(code: AlertCode, by: Character): string | null {
    if (!this.canSetCode(by)) return 'Доступ запрещён: только Администратор и старшие офицеры ГО.';
    if (code === this.code) {
      if (code === 'green') return 'Тревоги нет — код уже зелёный.';
      this.manualCode = code;
      this.manualBy = by;
      return null;
    }
    const who = by.name;
    if (code === 'green') {
      this.declareGreen(`по приказу ${who}`);
      return null;
    }
    if (code === 'red') {
      this.declareRed('весь город', `По приказу ${who}`);
    } else {
      // Жёлтый: с зелёного — усиленные проверки; с красного — комендантский час снимается.
      const wasCurfew = this.curfew;
      this.code = 'yellow';
      this.curfew = false;
      this.shelterClaims.clear();
      this.yellowSince = this.time;
      this.alarmKills = 0;
      this.calm = 0;
      for (const o of this.ota) (o.brain as OtaBrain | null)?.goHome();
      this.ctx.law.log(
        `Администрация: Код ЖЁЛТЫЙ по приказу ${who}.${wasCurfew ? ' Комендантский час отменён.' : ''} Граждане, предъявляйте CID по первому требованию.`,
        'world',
      );
      this.ctx.bus.emit('alert', { code: 'yellow' });
      this.ctx.bus.emit('announce', { text: 'Код жёлтый · приказ Администрации' });
    }
    this.manualCode = code;
    this.manualBy = by;
    return null;
  }

  private declareRed(where: string, why = 'Прорыв периметра'): void {
    this.manualCode = null;
    this.code = 'red';
    this.curfew = true;
    this.redSince = this.time;
    this.curfewSince = this.time;
    this.calm = 0;
    this.ctx.law.log(`Администрация: Код КРАСНЫЙ! ${why} — ${where}. Объявлен комендантский час. Граждане, немедленно пройдите в жилые блоки.`, 'world');
    this.ctx.bus.emit('alert', { code: 'red' });
    this.ctx.economy.forceClose();
    this.ctx.bus.emit('announce', { text: 'Код красный · комендантский час' });
    for (const c of this.ctx.entities.list) if (c.faction === 'admin') c.say('Внимание! Код красный. Комендантский час!', this.ctx.law.now, 5);
    // Весь свободный резерв OTA из Цитадели — на прочёсывание.
    let n = 0;
    for (const o of this.ota) {
      const b = o.brain;
      if (o.alive && b instanceof OtaBrain && b.available) {
        b.hunt();
        n++;
      }
    }
    if (n) this.ctx.law.log(`Надзор: отряд OTA (${n}) выходит из Цитадели.`, 'radio');
  }

  /**
   * Штурм Нексуса: повстанцев в зоне Нексуса ≥ WAR.nexus.minAttackers и больше, чем защитников, —
   * захват копится; захвачен и удержан holdToWin с — победа восстания (раунд заново).
   */
  private updateNexus(dt: number): void {
    const N = WAR.nexus;
    const n = this.nexus;
    const { map, entities } = this.ctx;
    let rebels = 0;
    let defenders = 0;
    let stormers = 0;
    let staged = 0;
    for (const c of entities.list) {
      if (!c.alive) continue;
      const b = rebelBrain(c);
      if (b?.mode === 'storm' || (b?.mode === 'assault' && this.cityPush)) {
        stormers++;
        if (b.staged) staged++;
      }
      if (map.zoneAtWorld(c.x, c.y)?.kind !== 'nexus') continue;
      // Штурмующие — бойцы в режиме штурма и игрок-повстанец (не отпущенные из КПЗ).
      if (c.faction === 'rebel' && c.law.phase === 'none' && (c.isPlayer || b?.mode === 'storm')) rebels++;
      else if (c.faction === 'cp' || c.faction === 'ota') defenders++;
    }
    n.rebels = rebels;
    n.defenders = defenders;
    // Волна: собрались у Нексуса (или ждали достаточно) — все разом; штурмующих не осталось — конец.
    if (stormers === 0 || (n.wave && !n.fallen && this.time - n.waveSince > N.waveMax)) {
      // Волна выдохлась — Цитадель снова высылает силы; уцелевшие собираются на новую.
      if (n.wave && stormers > 0) for (const c of entities.list) if (c.alive && rebelBrain(c)?.mode === 'assault') rebelBrain(c)!.staged = false;
      n.wave = false;
      n.stagedSince = -1;
    } else if (!n.wave) {
      if (staged > 0 && n.stagedSince < 0) n.stagedSince = this.time;
      if (staged >= N.waveSize || (staged > 0 && this.time - n.stagedSince >= N.stageMax)) {
        n.wave = true;
        n.waveSince = this.time;
        this.ctx.law.log(`Надзор: повстанцы (${stormers}) штурмуют Нексус! Всем юнитам — к Нексусу!`, 'radio');
        this.ctx.bus.emit('announce', { text: 'Штурм Нексуса' });
      }
    }
    if (!n.fallen) {
      if (rebels >= N.minAttackers && rebels >= defenders) n.progress = Math.min(N.captureTime, n.progress + dt);
      else n.progress = Math.max(0, n.progress - dt * N.decay);
      if (n.progress >= N.captureTime) {
        n.fallen = true;
        n.fallenAt = this.time;
        this.stats.nexusFalls++;
        this.ctx.law.log(`Администрация: НЕКСУС ЗАХВАЧЕН повстанцами! Удержат ${N.holdToWin} с — город падёт. Всем силам Альянса — отбить Нексус!`, 'world');
        this.ctx.bus.emit('announce', { text: 'Нексус захвачен повстанцами' });
      }
      return;
    }
    if (rebels === 0) {
      n.fallen = false;
      n.progress = 0;
      this.ctx.law.log('Надзор: Нексус отбит. Повстанцы выбиты из Цитадели.', 'radio');
      this.ctx.bus.emit('announce', { text: 'Нексус отбит' });
      return;
    }
    if (this.time - n.fallenAt >= N.holdToWin) this.rebelVictory();
  }

  /** Нексус удержан: победа восстания. Альянс отводит силы и начинает заново — раунд сначала. */
  private rebelVictory(): void {
    this.stats.victories++;
    const n = this.nexus;
    n.progress = 0;
    n.fallen = false;
    n.wave = false;
    n.stagedSince = -1;
    this.ctx.law.log('Сопротивление: НЕКСУС УДЕРЖАН — ВОССТАНИЕ ПОБЕДИЛО! Альянс перебрасывает свежие силы; повстанцы уходят в лагерь с трофеями.', 'world');
    this.ctx.bus.emit('announce', { text: 'Победа восстания · Нексус удержан' });
    for (const c of this.ctx.entities.list) {
      if (!c.alive || c.faction !== 'rebel') continue;
      if (c.isPlayer) c.money += WAR.nexus.reward;
      rebelBrain(c)?.withdraw();
    }
    for (const f of this.fronts) {
      f.held = 0;
      f.owner = 'combine';
      f.capture = null;
      f.squad = [];
      f.nextCaptureAt = this.time + WAR.capture.cooldown;
    }
    this.infiltrators.clear();
    this.lastKnown.clear();
    this.cityPush = false;
    this.declareGreen('Альянс восстановил контроль');
    this.command.pickTarget('новый штурм');
  }

  /** Не нашли за отведённое время: прорвавшиеся прячут оружие и живут как подпольщики. */
  private goUnderground(): void {
    for (const r of this.infiltrators) {
      r.weapon = null;
      r.brain = new CitizenBrain(r, this.ctx);
    }
    this.ctx.law.log(`Надзор: прорвавшиеся (${this.infiltrators.size}) скрылись в подполье. Поиск прекращён.`, 'radio');
    this.infiltrators.clear();
    this.lastKnown.clear();
  }

  private declareGreen(by = ''): void {
    const wasCurfew = this.curfew;
    this.manualCode = null;
    this.manualBy = null;
    this.code = 'green';
    this.curfew = false;
    this.shelterClaims.clear();
    this.alarm = null;
    this.ctx.law.log(
      (wasCurfew ? 'Администрация: Код зелёный. Комендантский час отменён.' : 'Администрация: Код зелёный. Отбой тревоги.') +
        (by ? ` (${by})` : ' Благодарим за сотрудничество.'),
      'world',
    );
    this.ctx.bus.emit('alert', { code: 'green' });
    this.ctx.bus.emit('announce', { text: 'Код зелёный' });
    for (const o of this.ota) (o.brain as OtaBrain | null)?.goHome();
  }

  /**
   * Все точки D (оба тамбура) у повстанцев — сопротивление выходит в город: все, кроме
   * WAR.holdKeep бойцов на каждом КПП, идут на прорыв (прорвавшиеся → красный код).
   */
  private updateCityPush(): void {
    const all = this.fronts.length > 0 && this.fronts.every((f) => f.held >= f.points.length);
    if (!all) {
      this.cityPush = false;
      return;
    }
    if (!this.cityPush) {
      this.cityPush = true;
      const names = this.fronts.flatMap((f) => f.points.map((p) => p.name)).join(', ');
      this.ctx.law.log(`Надзор: все точки ${names} в руках повстанцев — сопротивление выходит в город!`, 'radio');
      this.ctx.bus.emit('announce', { text: 'Все точки D у повстанцев · выход в город' });
    }
    for (const f of this.fronts) {
      let keep = WAR.holdKeep;
      for (const r of f.squad) {
        const b = rebelBrain(r);
        if (!b || b.mode === 'assault' || b.mode === 'retreat') continue;
        if (b.mode === 'hold' && keep > 0) {
          keep--;
          continue;
        }
        b.orderAssault();
      }
    }
  }

  /**
   * Прорванный КПП: граждане (не лоялисты) бегут туда и становятся повстанцами. По одному раз в
   * WAR.defect.every с, не больше WAR.defect.max одновременно. КПП отбит — бегущие возвращаются.
   */
  private updateDefection(dt: number): void {
    const D = WAR.defect;
    const open = this.fronts.filter((f) => f.owner === 'rebels');
    for (const c of this.defectors) {
      const b = c.brain;
      const f = b instanceof DefectorBrain ? this.fronts[b.front] : null;
      if (!c.alive || c.faction !== 'citizen') {
        this.defectors.delete(c);
        continue;
      }
      if (!f || c.law.phase === 'cuffed' || c.law.phase === 'jailed' || c.law.phase === 'entering') {
        if (!(c.brain instanceof DefectorBrain)) this.defectors.delete(c);
        continue;
      }
      if (f.owner !== 'rebels') {
        c.brain = new CitizenBrain(c, this.ctx);
        this.defectors.delete(c);
        continue;
      }
      if (this.sectionAt(f, c.x, c.y) >= 0) this.defect(c, f);
    }
    const citizens = this.ctx.entities.list.filter((c) => c.alive && c.faction === 'citizen').length;
    if (this.citizensAtStart < 0) this.citizensAtStart = citizens;
    if (open.length === 0) this.defectLeft = 0;
    if (open.length === 0 || this.curfew || this.defectLeft <= 0 || citizens <= this.citizensAtStart * D.minShare) return;
    this.defectIn -= dt;
    if (this.defectIn > 0 || this.defectors.size >= D.max) return;
    const { rng } = this.ctx;
    this.defectIn = rng.range(D.every[0], D.every[1]);
    const pool = this.ctx.entities.list.filter(
      (c) => c.alive && !c.isPlayer && c.faction === 'citizen' && c.brain instanceof CitizenBrain && c.law.phase === 'none' &&
        c.loyalty < D.maxLoyalty && this.ctx.map.levelAt(c.x, c.y) === 'city' && !this.defectors.has(c),
    );
    if (!pool.length) return;
    // Беглецы бегут первыми — им в городе всё равно не жить.
    const c = pool.find((o) => o.profession === 'fugitive') ?? rng.pick(pool);
    const f = open.reduce((best, o) => (Math.hypot(o.innerGate.x - c.x, o.innerGate.y - c.y) < Math.hypot(best.innerGate.x - c.x, best.innerGate.y - c.y) ? o : best));
    this.economy().leaveQueue(c);
    c.brain = new DefectorBrain(f.index, this.ctx);
    this.defectors.add(c);
    this.defectLeft--;
    c.say(rng.pick(D.lines), this.ctx.law.now, 3);
  }

  private economy() {
    return this.ctx.economy;
  }

  /** Гражданин добрался до прорванного КПП (или игрок нажал E) — теперь он повстанец. */
  defect(c: Character, f: Front): void {
    const { rng } = this.ctx;
    this.defectors.delete(c);
    c.faction = 'rebel';
    c.rank = 0;
    c.division = null;
    c.profession = 'rebel_soldier';
    c.disguised = false;
    c.carrying = false;
    c.law.wanted = true;
    this.ctx.law.clear(c);
    equipKit(c, 'rebel_raider', this.ctx);
    this.stats.defected++;
    this.ctx.law.log(`${f.name}: ${c.isPlayer ? 'вы примкнули' : `${c.name} примкнул(а)`} к сопротивлению.`, 'radio');
    if (c.isPlayer) {
      this.ctx.bus.emit('defected', { who: c });
      return;
    }
    // Теперь — боец армии сопротивления (погибнет — вернётся из лагеря).
    c.role = { ...armySpec('rebel_soldier', 'rebel_raider', 0), name: c.name };
    const b = new RebelBrain(c, this.ctx, f.index, Infinity);
    c.brain = b;
    const posts = f.posts.length ? f.posts : [f.midGate];
    b.orderHold(rng.pick(posts));
    this.command.join(c);
    f.squad.push(c);
  }

  /** Идёт ли сейчас бой у КПП (стреляли недавно). */
  active(f: Front): boolean {
    return this.time - f.lastShot < WAR.activeWindow;
  }

  update(dt: number): void {
    this.time += dt;
    const { map } = this.ctx;
    // Где стреляли: выстрел в зоне КПП или пустоши относится к ближайшему фронту.
    const shots = this.ctx.combat.shots;
    for (let i = shots.length - 1; i >= 0 && this.ctx.combat.now - shots[i].t < dt + 1e-6; i--) {
      const sh = shots[i];
      const kind = map.zoneAtWorld(sh.x, sh.y)?.kind;
      if (kind !== 'checkpoint' && kind !== 'outlands') continue;
      let best: Front | null = null;
      let bestD = Infinity;
      for (const f of this.fronts) {
        const d = Math.hypot(f.innerGate.x - sh.x, f.innerGate.y - sh.y);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      if (best) best.lastShot = this.time;
    }
    // Командование сопротивления: лагерь, цель главы, отряды фронтов, клич.
    this.command.update(dt);
    for (const f of this.fronts) {
      // Прорыв в город: боец в штурме (все точки D взяты, forceAssault) вышел за КПП.
      for (const r of [...f.squad]) {
        const b = r.brain;
        const kind = map.zoneAtWorld(r.x, r.y)?.kind;
        const inCity = kind !== 'outlands' && kind !== 'checkpoint' && kind !== 'wasteland' && kind !== 'rebel_camp';
        if (!r.alive || !inCity) continue;
        // Задержанного ведут через город — он уже не боец отряда. Державший пост, которого вытолкнуло
        // за ворота, прорвавшимся не считается — вернётся на пост.
        if (!(b instanceof RebelBrain)) {
          f.squad.splice(f.squad.indexOf(r), 1);
          continue;
        }
        if (b.mode !== 'assault' && !this.cityPush) continue;
        f.squad.splice(f.squad.indexOf(r), 1);
        if (b.mode === 'storm' || b.mode === 'infiltrate') continue;
        this.infiltrators.add(r);
        this.lastKnown.set(r, { x: r.x, y: r.y });
        // Все точки D наши — не прятаться, а штурмовать Нексус.
        if (this.cityPush) b.storm();
        else b.infiltrate();
        if (this.code !== 'red') this.declareRed(f.name);
      }
      this.updateCapture(f, dt);
      if (!f.assaultAnnounced && f.squad.some((r) => rebelBrain(r)?.mode === 'assault')) {
        f.assaultAnnounced = true;
        this.ctx.law.log(`${f.name}: повстанцы идут на прорыв!`, 'radio');
      }
      // Точки снова у Альянса — OTA этого фронта возвращаются в резерв Цитадели.
      if (f.held === 0 && !f.capture) {
        for (const o of this.ota) {
          const b = o.brain;
          if (b instanceof OtaBrain && b.front === f.index && b.mode === 'post') b.goHome();
        }
      }
    }

    this.updateCityPush();
    this.updateNexus(dt);
    this.updateDefection(dt);

    // Прорвавшиеся: живые и не задержанные.
    for (const r of this.infiltrators) {
      if (!r.alive || r.law.phase === 'cuffed' || r.law.phase === 'entering' || r.law.phase === 'jailed') {
        this.infiltrators.delete(r);
        this.lastKnown.delete(r);
      }
    }
    // Нападавшие: пока живы, на свободе и в городе (ушёл в канализацию — след потерян).
    for (const r of this.operatives) {
      const gone = !r.alive || r.law.phase === 'cuffed' || r.law.phase === 'entering' || r.law.phase === 'jailed';
      if (gone || !this.inCity(r.x, r.y)) {
        this.operatives.delete(r);
        this.lastKnown.delete(r);
      }
    }
    // Включивший код с терминала погиб или больше не при должности — снова по обстановке.
    if (this.manualCode && (!this.manualBy || !this.canSetCode(this.manualBy))) {
      this.manualCode = null;
      this.manualBy = null;
    }
    if (this.code === 'yellow' && this.manualCode !== 'yellow') {
      // Тревога держится, пока есть нападавшие или КПП в руках повстанцев.
      this.calm = this.operatives.size === 0 && this.fronts.every((f) => f.held === 0) ? this.calm + dt : 0;
      if (this.calm >= ALARM.calmToGreen && this.time - this.yellowSince >= ALARM.minTime) this.declareGreen();
    }
    // «Надзор» периодически засекает прорвавшихся.
    this.scanTimer -= dt;
    if (this.scanTimer <= 0 && this.code === 'red') {
      this.scanTimer = WAR.overwatchScan;
      for (const r of this.infiltrators) this.lastKnown.set(r, { x: r.x + this.ctx.rng.range(-48, 48), y: r.y + this.ctx.rng.range(-48, 48) });
    }
    if (this.code === 'red' && this.manualCode !== 'red') {
      // Красный код держится, пока есть прорвавшиеся или КПП в руках повстанцев.
      this.calm = this.infiltrators.size === 0 && this.fronts.every((f) => f.held === 0) ? this.calm + dt : 0;
      const long = this.time - this.redSince;
      const storming = [...this.infiltrators].some((r) => rebelBrain(r)?.mode === 'storm');
      if (long > WAR.redMaxTime && this.infiltrators.size > 0 && !storming) this.goUnderground();
      const held = this.fronts.some((f) => f.held > 0);
      if ((this.calm >= WAR.calmToGreen && long >= WAR.redMinTime) || (long > WAR.redMaxTime && !held)) this.declareGreen();
    }
    // Погибшие OTA — из списка (возвращаются через постоянный состав).
    for (let i = this.ota.length - 1; i >= 0; i--) if (!this.ota[i].alive) this.ota.splice(i, 1);
  }
}
