import { REBEL_UNIT } from '../config/factions';
import { COMBAT } from '../config/combat';
import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { Vec2 } from '../core/math';
import { WAR } from '../config/war';
import { ALARM } from '../config/underground';
import { FACTIONS, cpUnit } from '../config/factions';
import { T } from '../world/tiles';
import { ZONE_NAMES } from '../config/names';
import { equipKit, poiWorld } from './Population';
import { RebelBrain } from '../ai/brains/RebelBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { OtaBrain } from '../ai/brains/OtaBrain';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { DefectorBrain } from '../ai/brains/DefectorBrain';
import { RebelCommand } from './RebelCommand';
import { spawnRole } from './Roster';
import { armySpec } from './Population';
import type { Corpse } from './CombatSystem';
import { CrimeScenes } from './CrimeScenes';
import { lineOfSight } from '../world/visibility';
import { VISION } from '../config/vision';

/** Мозг бойца отряда — если он сейчас «свой» (задержанный ведёт себя как PrisonerBrain). */
function rebelBrain(r: Character): RebelBrain | null {
  return r.brain instanceof RebelBrain ? r.brain : null;
}

/**
 * Код тревоги: зелёный — спокойно; жёлтый — в городе нашли убитого патрульного; красный — КПП прорван,
 * повстанцы в городе штурмуют Управа (возрождения нет ни у кого).
 */
export type AlertCode = 'green' | 'yellow' | 'red';

/** Идущий капт КПП: до какого времени и счёт убийств в зоне. */
export interface Capture {
  since: number;
  until: number;
  rebelKills: number;
  /** Сколько секунд подряд двор у повстанцев, а Протектората в нём нет (WAR.capture.secure). */
  secured: number;
  /** Повстанцы во дворе штурмуемой точки (на последнем тике). */
  inside: number;
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
  /** Сколько секунд в отбиваемой точке нет повстанцев (а ВС уже там). */
  rebelFree: number;
  /** Когда следующий контрудар с ГЭС по захваченной точке. */
  retakeAt: number;
  reinforceAt: number;
  medicAt: number;
}

/**
 * Война на границе. У каждого пограничного КПП по ту сторону ворот — отряды повстанцев,
 * постоянная перестрелка с часовыми GRID. Иногда отряд идёт на прорыв через коридор;
 * прорвавшийся в город объявляет КРАСНЫЙ КОД: комендантский час, из Управы выходит OTA,
 * ВС прочёсывает город. Когда прорвавшихся не осталось — отбой (зелёный код).
 */
export class WarSystem {
  code: AlertCode = 'green';
  /** Код, включённый с терминала Коменданта (держится до отмены), и кто его включил. */
  manualCode: AlertCode | null = null;
  private manualBy: Character | null = null;
  curfew = false;
  readonly fronts: Front[] = [];
  readonly infiltrators = new Set<Character>();
  /** Нападавшие в городе (повстанцы с операций из канализации, напавший на ВС игрок). */
  readonly operatives = new Set<Character>();
  /** Точка тревоги: куда стягиваются патрули, пока нападавших не видно. */
  alarm: { x: number; y: number; until: number } | null = null;
  private yellowSince = 0;
  /** Тела ВС в городе, которые уже заметили (код жёлтый поднимается один раз на тело). */
  private readonly seenCorpses = new Set<Corpse>();
  /** Тела, которые оцепят, когда рядом стихнет бой (CrimeScenes.quiet). */
  private readonly sceneQueue = new Set<Corpse>();
  private corpseScan = 0;
  private otaTimer = 0;
  /** Победа восстания: когда перезапуск карты (событие 'restart'), -1 — не было. */
  restartAt = -1;
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
  /** Повстанцы рвутся в город (WAR.cityPushOn: прорван КПП или все точки D). */
  cityPush = false;
  /** Мобилизованные красным кодом ВС (CpBrain.rally) и места обороны Управы. */
  private mobilized = new Set<Character>();
  private rallySpots: Vec2[] | null = null;
  /** Заслон у прорванного КПП (WAR.blockade): кто стоит и у какого КПП; места заслона. */
  readonly blockaders = new Set<Character>();
  /** Повстанцы у выхода из прорванного КПП (holdGate): прикрывают прорыв в город, на штурм не уходят. */
  readonly gateGuards = new Set<Character>();
  private blockadeFront = -1;
  private blockSpots: Vec2[] = [];
  private blockadeTimer = 0;
  private mobilizeTimer = 0;
  /** Подкрепления ВС с ГЭС на КПП (тесты отключают, чтобы они не шли через город). */
  reinforcements = true;
  /** Граждане, бегущие к прорванному КПП, чтобы примкнуть к повстанцам. */
  readonly defectors = new Set<Character>();
  private defectIn = 0;
  /** Сколько граждан ещё может уйти за текущий прорыв; граждан было в начале. */
  private defectLeft = 0;
  private citizensAtStart = -1;
  readonly stats = { defected: 0, counterattacks: 0, nexusFalls: 0, victories: 0, otaDeployed: 0, gateHolders: 0 };
  /** Штурм Управы: накопленный захват (с), захвачен ли и когда, объявлен ли штурм. */
  readonly nexus = { progress: 0, fallen: false, fallenAt: 0, rebels: 0, defenders: 0, wave: false, waveSince: 0, stagedSince: -1 };
  /** Командование сопротивления: армия в лагере, цель главы, клич. */
  readonly command: RebelCommand;
  /** Места преступления: оцепление у тел убитых ВС в городе. */
  readonly scenes: CrimeScenes;

  constructor(private readonly ctx: AiContext) {
    this.command = new RebelCommand(ctx);
    this.scenes = new CrimeScenes(ctx);
    this.buildFronts();
    ctx.economy.paused = () => this.curfew;
    ctx.economy.onSabotage = (spot) => this.raiseAlarm(spot.x, spot.y, 'саботаж узла Протектората');
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

  /** Сообщить: сотрудник Протектората видит прорвавшегося. */
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
      const c = spawnRole(this.ctx, armySpec('rebel_soldier', 'rebel_soldier', REBEL_UNIT.soldier), { x: this.ctx.nav.worldX(a), y: this.ctx.nav.worldY(a) });
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

  /** Сколько защитников (ВС на постах, OTA) живы у точки k фронта f. */
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
   * Контрудар: свободные OTA из резерва на ГЭС бегут на посты точки k (ВС туда же приходят сами —
   * часовые этой точки после гибели возрождаются на ГЭС и бегут на свои посты).
   */
  private counterattack(f: Front, k: number): number {
    // Штурм Управы (красный код) — резерв OTA держит ГЭС, контрударов нет; штурм отбит — КПП отбивают.
    if (!this.reinforcements || this.code === 'red') return 0;
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

  /** Ранение сотрудника Протектората в городе — тревога; погибшие за тревогу — эскалация до красного. */
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
    // Досрочная победа — только с перевесом (как в капте: у кого больше убийств) и если повстанцы
    // уже во дворе точки: по счёту убийств из пустоши точку не взять.
    if (c.rebelKills >= WAR.capture.killsToWin && c.rebelKills > c.cpKills && this.yardCount(f, c.point).rebels > 0) this.endCapture(f, true);
  }

  /** Кто во дворе точки k фронта f (боеспособные): повстанцы и Протекторат. */
  private yardCount(f: Front, k: number): { rebels: number; alliance: number } {
    let rebels = 0;
    let alliance = 0;
    for (const o of this.ctx.entities.list) {
      if (!o.fit || this.sectionAt(f, o.x, o.y) !== k * 2) continue;
      if (o.faction === 'rebel') rebels++;
      else if (FACTIONS[o.faction].authority) alliance++;
    }
    return { rebels, alliance };
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
    // И OTA на постах этой точки.
    for (const o of this.ota) {
      const b = o.brain;
      if (o.alive && b instanceof OtaBrain && b.front === f.index && b.post && this.pointOfPost(f, b.post) === point) defenders.push(o);
    }
    f.capture = { since: this.time, until: this.time + WAR.capture.duration, rebelKills: 0, cpKills: 0, defenders, point, secured: 0, inside: 0 };
    f.reinforceAt = f.medicAt = 0;
    const help = WAR.capture.reinforce ? 'Резерв выдвигается — держать точку!' : 'Подкреплений не будет — держать оборону!';
    this.ctx.law.log(`${f.name}: КАПТ точки ${pt.name}! Повстанцы (${f.squad.length}) идут на захват. ${help}`, 'radio');
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
    if (breached) this.holdGate(f, attackers, posts);
    else
      attackers.forEach((r, k) => {
        if (k < posts.length) rebelBrain(r)?.orderHold(posts[k % posts.length]);
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
    // Захват точки — патрули стягиваются к проходной (код не меняется: жёлтый — только убитый
    // патрульный в городе, красный — штурм Управы).
    this.raiseAlarm(f.apron.x, f.apron.y, `${f.name}: точка ${pt.name} захвачена повстанцами`);
  }

  /**
   * Внутренний двор взят: самые сильные (по HP) из штурмовавших и державших точки становятся у
   * выхода в город — за углами проходной и перед ней (WAR.capture.gateHold), лицом к проспекту;
   * остальные держат посты двора.
   */
  private holdGate(f: Front, attackers: Character[], posts: Vec2[]): void {
    const G = WAR.capture.gateHold;
    const pool = [...new Set([...attackers, ...f.squad])].filter((r) => {
      const m = rebelBrain(r)?.mode;
      return r.fit && r.maxHealth >= G.minHp && (m === 'capture' || m === 'hold' || m === 'gather') && this.frontAt(r.x, r.y) === f;
    });
    pool.sort((a, b) => b.maxHealth - a.maxHealth);
    const spots = this.gateSpots(f);
    // Смотрят в город: от внутренних ворот через дверь проходной и дальше.
    const face = { x: f.apron.x + (f.apron.x - f.innerGate.x), y: f.apron.y + (f.apron.y - f.innerGate.y) };
    let k = 0;
    for (const r of pool) {
      const b = rebelBrain(r)!;
      if (k < Math.min(G.count, spots.length)) {
        b.orderHold(spots[k++], face);
        this.gateGuards.add(r);
        this.stats.gateHolders++;
      }
    }
    // Остальные штурмовавшие держат посты двора.
    attackers.forEach((r, i) => {
      if (!spots.some((s) => rebelBrain(r)?.post === s)) rebelBrain(r)?.orderHold(posts[i % posts.length]);
    });
    if (k > 0) this.ctx.law.log(`${f.name}: повстанцы заняли выход в город — стрелки у углов проходной!`, 'radio');
  }

  /** Места у выхода в город: анкеры у стен и углов проходной и перед её дверью, ближе к двери — раньше. */
  gateSpots(f: Front): Vec2[] {
    const G = WAR.capture.gateHold;
    const { map, nav } = this.ctx;
    const cand: { p: Vec2; d: number }[] = [];
    for (const a of nav.walkable) {
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      const d = Math.hypot(x - f.apron.x, y - f.apron.y);
      if (d > G.radius) continue;
      const zid = nav.zone[a];
      const kind = map.zones[zid]?.kind;
      // Проходная этого КПП или город перед ней (не дворы КПП и не пустошь).
      if (zid !== f.gatehouse && (kind === 'checkpoint' || kind === 'outlands' || kind === 'wasteland' || !this.inCity(x, y))) continue;
      const ax = nav.ax(a);
      const ay = nav.ay(a);
      let walls = 0;
      for (let ty = ay - 1; ty <= ay + 2; ty++) {
        for (let tx = ax - 1; tx <= ax + 2; tx++) {
          if (tx >= ax && tx <= ax + 1 && ty >= ay && ty <= ay + 1) continue;
          if (map.isSolid(tx, ty)) walls++;
        }
      }
      if (walls >= G.minWalls) cand.push({ p: { x, y }, d });
    }
    cand.sort((u, v) => u.d - v.d);
    const out: Vec2[] = [];
    for (const c of cand) {
      if (out.every((o) => Math.hypot(o.x - c.p.x, o.y - c.p.y) >= G.spacing)) out.push(c.p);
      if (out.length >= G.count) break;
    }
    return out;
  }

  /** Сколько повстанцев у каждого КПП (во дворах и на пустоши перед ним). */
  rebelsAtFronts(): number[] {
    const n = this.fronts.map(() => 0);
    for (const c of this.ctx.entities.list) {
      if (!c.alive || c.faction !== 'rebel') continue;
      const f = this.frontAt(c.x, c.y);
      if (f) n[f.index]++;
    }
    return n;
  }

  /**
   * OTA — туда, где сопротивление (WAR.ota): резерв и OTA с тихих КПП уходят на КПП, где повстанцев
   * больше всего, — на посты ближайшей к пустоши точки Протектората (КПП прорван — отбиваемой).
   */
  private deployOta(counts: number[]): void {
    const O = WAR.ota;
    if (!this.reinforcements || this.cityPush || this.code === 'red' || !this.fronts.length) return;
    let best = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
    const f = this.fronts[best];
    if (counts[best] < O.minRebels || (f.capture && !WAR.capture.reinforce)) return;
    const k = f.held < f.points.length ? f.held : f.points.length - 1;
    const posts = f.points[k]?.posts.length ? f.points[k].posts : f.posts;
    if (!posts.length) return;
    const here = this.ota.filter((o) => o.alive && o.brain instanceof OtaBrain && o.brain.mode === 'post' && o.brain.front === best).length;
    let need = O.perFront - here;
    if (need <= 0) return;
    // Сперва резерв, потом OTA с КПП, где тихо.
    const pool = this.ota
      .filter((o) => {
        const b = o.brain;
        if (!o.alive || !(b instanceof OtaBrain)) return false;
        if (b.available) return true;
        return b.mode === 'post' && b.front !== best && b.front >= 0 && counts[b.front] < O.minRebels && !this.fronts[b.front]?.capture && !this.blockaders.has(o);
      })
      .sort((a, b) => Number((b.brain as OtaBrain).available) - Number((a.brain as OtaBrain).available));
    let sent = 0;
    for (const o of pool) {
      if (need <= 0) break;
      const p = posts[(here + sent) % posts.length];
      (o.brain as OtaBrain).assignPost(f.index, p, Math.atan2(f.exit.y - p.y, f.exit.x - p.x));
      sent++;
      need--;
    }
    if (sent > 0) {
      this.stats.otaDeployed += sent;
      this.ctx.law.log(`Надзор: у ${f.name} скопление повстанцев (${counts[best]}) — легионеры (${sent}) выдвигаются на ${f.points[k].name}.`, 'radio');
    }
  }

  /** Убитый ВС в городе, которого увидел кто-то из Протектората, — код жёлтый. */
  private scanCorpses(): void {
    const { combat, entities, map } = this.ctx;
    for (const b of combat.corpses) {
      const cp = b.faction === 'cp';
      if ((!cp && !CIVIL.has(b.faction)) || b.burning || this.seenCorpses.has(b) || !this.inCity(b.x, b.y)) continue;
      for (const o of entities.list) {
        if (!o.alive || !FACTIONS[o.faction].authority) continue;
        if (Math.hypot(o.x - b.x, o.y - b.y) > VISION.npcRange || !lineOfSight(map, o.x, o.y, b.x, b.y)) continue;
        this.seenCorpses.add(b);
        // Убит патрульный — код жёлтый; гражданский — точка тревоги рядом.
        if (cp) this.raiseAlarm(b.x, b.y, `найден убитый патрульный ${b.name}`, true);
        else if (b.killer) this.raiseAlarm(b.x, b.y, `найдено тело гражданина ${b.name}`);
        // Проходы перекрывают, на осмотр идут следователь и медик — когда рядом стихнет стрельба
        // (при штурме Управы — не до того). Гражданского — только убитого (не от голода).
        if (cp || b.killer) this.sceneQueue.add(b);
        break;
      }
    }
    for (const b of this.seenCorpses) if (!combat.corpses.includes(b)) this.seenCorpses.delete(b);
    for (const b of this.sceneQueue) {
      if (this.code === 'red' || !combat.corpses.includes(b) || b.burning) {
        this.sceneQueue.delete(b);
        continue;
      }
      if (!this.scenes.quiet(b.x, b.y)) continue;
      this.sceneQueue.delete(b);
      this.scenes.open(b, b.faction === 'cp' ? 'cp' : 'civil');
    }
  }

  /** Жив ли Комендант. */
  adminAlive(): boolean {
    return this.ctx.entities.list.some((c) => c.alive && c.faction === 'admin');
  }

  /**
   * КПП прорван: все точки у повстанцев — к нему потянутся граждане (WAR.defect). Повстанцы рвутся
   * через него в город (WAR.cityPushOn 'breach'); по прежнему правилу ('all') армия идёт на следующий КПП.
   */
  breach(f: Front): void {
    f.held = f.points.length;
    f.owner = 'rebels';
    this.defectIn = 0;
    this.defectLeft += WAR.defect.perBreach;
    if (WAR.cityPushOn === 'breach') this.command.target = f.index;
    else if (this.fronts.some((o) => o.owner !== 'rebels')) this.command.pickTarget(`${f.name} прорван`);
  }

  /**
   * Заслон (WAR.blockade): КПП прорван — патрули ВС (не с постов, ближайшие) и свободный резерв Легиона
   * перекрывают выход из проходной в город. КПП отбит — заслон снимается.
   */
  private updateBlockade(): void {
    const B = WAR.blockade;
    const f = this.reinforcements ? (this.fronts.find((o) => o.owner === 'rebels') ?? null) : null;
    if (!f) {
      this.releaseBlockade();
      return;
    }
    if (this.blockadeFront !== f.index) {
      this.releaseBlockade();
      this.blockadeFront = f.index;
      this.blockSpots = this.blockadeSpots(f);
      this.ctx.law.log(`Надзор: ${f.name} прорван — заслон у проходной! Патрули и Легион — перекрыть выход в город.`, 'radio');
    }
    for (const c of [...this.blockaders]) if (!c.alive) this.blockaders.delete(c);
    const spots = this.blockSpots;
    if (!spots.length) return;
    const taken = new Set<Vec2>();
    let cps = 0;
    for (const c of this.blockaders) {
      const b = c.brain;
      if (b instanceof CpBrain && b.rally) {
        taken.add(b.rally);
        cps++;
      } else if (b instanceof OtaBrain && b.post) taken.add(b.post);
    }
    const free = (): Vec2 | null => spots.find((s) => !taken.has(s)) ?? null;
    const face = (s: Vec2) => Math.atan2(f.innerGate.y - s.y, f.innerGate.x - s.x);
    // Часть резерва Легиона (B.ota): остальные отбивают КПП контрударами.
    let otas = [...this.blockaders].filter((c) => c.brain instanceof OtaBrain).length;
    for (const o of this.ota) {
      if (otas >= B.ota) break;
      const b = o.brain;
      if (!o.alive || this.blockaders.has(o) || !(b instanceof OtaBrain) || (!b.available && b.mode !== 'home')) continue;
      const s = free();
      if (!s) break;
      taken.add(s);
      b.assignPost(-1, s, face(s));
      this.blockaders.add(o);
      otas++;
    }
    // Ближайшие патрули ВС (с постов не снимают: посты держат свои места, при красном коде — Управу).
    if (cps >= B.cp) return;
    const pool = this.ctx.entities.list.filter((c) => {
      const b = c.brain;
      if (!c.alive || c.isPlayer || this.blockaders.has(c) || c.law.phase !== 'none' || !(b instanceof CpBrain)) return false;
      if (b.guardPost || b.medicStation || b.rally || (b.duty !== null && b.duty !== 'squad')) return false;
      return this.ctx.map.levelAt(c.x, c.y) === 'city';
    });
    pool.sort((a, b) => Math.hypot(a.x - f.apron.x, a.y - f.apron.y) - Math.hypot(b.x - f.apron.x, b.y - f.apron.y));
    for (const c of pool) {
      if (cps >= B.cp) break;
      const s = free();
      if (!s) break;
      taken.add(s);
      const b = c.brain as CpBrain;
      b.rally = s;
      b.rallyFacing = face(s);
      this.blockaders.add(c);
      cps++;
      if (b.fsm.current !== 'fight' && b.fsm.current !== 'retreat') b.fsm.change('guard');
    }
  }

  /** Снять заслон: ВС — к своей службе, Легион — на ГЭС. */
  private releaseBlockade(): void {
    if (this.blockadeFront < 0 && !this.blockaders.size) return;
    for (const c of this.blockaders) {
      const b = c.brain;
      if (b instanceof CpBrain && b.rally && !this.mobilized.has(c)) {
        b.rally = null;
        if (c.alive && b.fsm.current === 'guard') b.fsm.change(b.idleState);
      } else if (b instanceof OtaBrain && b.mode === 'post' && b.front < 0) b.goHome();
    }
    this.blockaders.clear();
    this.blockadeFront = -1;
    this.blockSpots = [];
  }

  /**
   * Места заслона: якоря города в radius[0]…radius[1] px от выхода из проходной, откуда виден выход,
   * за углом (не меньше minWalls сплошных тайлов вокруг), не ближе spacing px друг к другу — ближние раньше.
   */
  private blockadeSpots(f: Front): Vec2[] {
    const B = WAR.blockade;
    const { map, nav } = this.ctx;
    const ts = map.tileSize;
    const cand: { p: Vec2; d: number }[] = [];
    for (const a of nav.walkable) {
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      const d = Math.hypot(x - f.apron.x, y - f.apron.y);
      if (d < B.radius[0] || d > B.radius[1] || !this.inCity(x, y)) continue;
      if (!lineOfSight(map, x, y, f.apron.x, f.apron.y)) continue;
      const tx = Math.floor(x / ts);
      const ty = Math.floor(y / ts);
      let walls = 0;
      for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) if (map.isSolid(tx + dx, ty + dy)) walls++;
      if (walls < B.minWalls) continue;
      cand.push({ p: { x, y }, d });
    }
    cand.sort((u, v) => u.d - v.d);
    const out: Vec2[] = [];
    for (const c of cand) {
      if (out.every((o) => Math.hypot(o.x - c.p.x, o.y - c.p.y) >= B.spacing)) out.push(c.p);
      if (out.length >= B.cp + 8) break;
    }
    return out;
  }

  /**
   * Капт: старт при сборе повстанцев, таймер. Захваченные точки Протекторат отбивает контрударами из
   * ГЭС (ВС + OTA), начиная с ближней к городу; точка отбита, когда в её камере (и дальше к
   * городу) нет повстанцев, а ВС уже там — retakeCalm с.
   */
  private updateCapture(f: Front, dt: number): void {
    const W = WAR.capture;
    const list = this.ctx.entities.list;
    // На капт — бойцы отряда этого КПП у него (отходящие в лагерь не в счёт).
    const rebels = f.squad.filter((c) => c.fit && rebelBrain(c) && rebelBrain(c)!.mode !== 'retreat' && this.frontAt(c.x, c.y) === f).length;
    if (f.held < f.points.length && !f.capture && rebels >= W.minAttackers && this.time >= f.nextCaptureAt) this.startCapture(f);
    const c = f.capture;
    if (c) {
      // Гарнизон точки перебит — захвачена; штурмующих не осталось (погибли, отошли) — отбита.
      // Защитников на точке не осталось (гарнизон перебит, ВС и OTA во дворе нет), а штурмующие уже
      // во дворе — точка взята сразу, без ожидания таймера.
      // Тяжелораненые (лежат) — уже не бойцы ни с той, ни с другой стороны.
      const attackers = f.squad.filter((r) => r.fit && rebelBrain(r)?.mode === 'capture').length;
      const { rebels: inside, alliance } = this.yardCount(f, c.point);
      c.inside = inside;
      // Двор удержан: гарнизон перебит, Протектората во дворе нет, повстанцы там — secure с подряд
      // (успели подойти подкрепления — счёт сначала).
      const wiped = inside > 0 && alliance === 0 && c.defenders.every((d) => !d.fit);
      c.secured = wiped ? c.secured + dt : 0;
      if (c.secured >= W.secure) this.endCapture(f, true);
      else if (attackers === 0 && this.time - c.since > 2) this.endCapture(f, false);
      else if (this.time >= c.until) this.endCapture(f, inside > 0 && inside >= alliance && c.rebelKills >= W.minKills && c.rebelKills > c.cpKills);
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
        this.ctx.law.log(`${f.name}: контрудар — из Управы на ${pt.name} бегут легионеры (${sent}).`, 'radio');
      }
    }
    let rebelsIn = 0;
    let cpIn = 0;
    for (const o of list) {
      if (!o.fit) continue;
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
      this.ctx.law.log(`${f.name}: точка ${pt.name} отбита.${all ? ' КПП снова под контролем Протектората.' : ''}`, 'radio');
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
  }

  /** Действует ли точка тревоги (патрули рядом прочёсывают и при зелёном коде). */
  get alarmActive(): boolean {
    return !!this.alarm && this.time < this.alarm.until;
  }

  /**
   * Тревога: патрули рядом стягиваются к точке и прочёсывают её (нападение, саботаж, побег…). Код
   * жёлтый (yellow = true) — только когда нашли убитого патрульного в городе: проверки CID чаще.
   */
  raiseAlarm(x: number, y: number, what: string, yellow = false): void {
    this.lastAlarmRaise = this.time;
    this.alarm = { x, y, until: this.time + ALARM.pointTime };
    const zone = this.ctx.map.zoneAtWorld(x, y)?.name ?? 'город';
    if (this.code !== 'green' || !yellow) {
      this.ctx.law.log(`Надзор: ${what} — ${zone}. Всем патрулям в квартале — усилить поиск.`, 'radio');
      return;
    }
    this.code = 'yellow';
    this.yellowSince = this.time;
    this.calm = 0;
    this.ctx.law.log(`Администрация: Код ЖЁЛТЫЙ! ${what[0].toUpperCase()}${what.slice(1)} — ${zone}. Граждане, сохраняйте спокойствие и предъявляйте CID по первому требованию.`, 'world');
    this.ctx.bus.emit('alert', { code: 'yellow' });
    this.ctx.bus.emit('announce', { text: `Код жёлтый · ${what}` });
    for (const c of this.ctx.entities.list) if (c.faction === 'admin') c.say('Внимание! Код жёлтый!', this.ctx.law.now, 4);
  }

  /** Может ли персонаж пользоваться терминалом кодов тревоги. */
  canSetCode(c: Character): boolean {
    return c.alive && (c.faction === 'admin' || (c.faction === 'cp' && cpUnit(c.rank).command >= WAR.terminal.minCommand));
  }

  /**
   * Терминал Коменданта: включить код жёлтый / красный или отбой (зелёный). null — сделано, иначе
   * причина отказа. Включённый так код держится, пока его не снимут с терминала.
   */
  setCode(code: AlertCode, by: Character): string | null {
    if (!this.canSetCode(by)) return 'Доступ запрещён: только Комендант и старшие офицеры ВС.';
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
      this.declareYellow(`по приказу ${who}`, 'Код жёлтый · приказ Администрации');
    }
    this.manualCode = code;
    this.manualBy = by;
    return null;
  }

  /** Жёлтый: с зелёного — усиленные проверки; с красного — комендантский час снимается. */
  private declareYellow(why: string, banner: string): void {
    const wasCurfew = this.curfew;
    this.code = 'yellow';
    this.curfew = false;
    this.shelterClaims.clear();
    this.yellowSince = this.time;
    this.calm = 0;
    for (const o of this.ota) (o.brain as OtaBrain | null)?.goHome();
    this.ctx.law.log(
      `Администрация: Код ЖЁЛТЫЙ ${why}.${wasCurfew ? ' Комендантский час отменён.' : ''} Граждане, предъявляйте CID по первому требованию.`,
      'world',
    );
    this.ctx.bus.emit('alert', { code: 'yellow' });
    this.ctx.bus.emit('announce', { text: banner });
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
    this.scenes.closeAll();
    this.ctx.bus.emit('announce', { text: 'Код красный · комендантский час' });
    for (const c of this.ctx.entities.list) if (c.faction === 'admin') c.say('Внимание! Код красный. Комендантский час!', this.ctx.law.now, 5);
    // OTA по городу не ходит — держит ГЭС и КПП; прочёсывают город PCU и SU.
    if (this.ota.some((o) => o.alive)) this.ctx.law.log('Надзор: Легион держит Управу. PCU и SU — прочёсывание кварталов.', 'radio');
  }

  /**
   * Штурм Управы: повстанцев в зоне Управы ≥ WAR.nexus.minAttackers и больше, чем защитников, —
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
      if (!c.fit) continue;
      const b = rebelBrain(c);
      if (b?.mode === 'storm' || (b?.mode === 'assault' && this.cityPush)) {
        stormers++;
        if (b.staged) staged++;
      }
      if (map.zoneAtWorld(c.x, c.y)?.kind !== 'nexus') continue;
      // Штурмующие — бойцы в режиме штурма и игрок-повстанец (не отпущенные из КПЗ).
      if (c.faction === 'rebel' && c.law.phase === 'none' && (c.isPlayer || b?.mode === 'storm')) rebels++;
      // Защитники — боеспособные: раненый, отошедший перевязываться, Управа не держит.
      else if ((c.faction === 'cp' || c.faction === 'ota') && c.health >= c.maxHealth * COMBAT.woundedFraction) defenders++;
    }
    n.rebels = rebels;
    n.defenders = defenders;
    // Волна: собрались у Управы (или ждали достаточно) — все разом; штурмующих не осталось — конец.
    if (stormers === 0 || (n.wave && !n.fallen && this.time - n.waveSince > N.waveMax)) {
      // Волна выдохлась — ГЭС снова высылает силы; уцелевшие собираются на новую.
      if (n.wave && stormers > 0) for (const c of entities.list) if (c.alive && rebelBrain(c)?.mode === 'assault') rebelBrain(c)!.staged = false;
      n.wave = false;
      n.stagedSince = -1;
    } else if (!n.wave) {
      if (staged > 0 && n.stagedSince < 0) n.stagedSince = this.time;
      // По таймеру — только если собралась хотя бы треть (иначе двое уходят на верную смерть),
      // но не дольше stageHardMax.
      const waited = this.time - n.stagedSince;
      const part = Math.min(N.waveSize, Math.ceil(stormers / 3));
      if (staged >= N.waveSize || (staged >= part && waited >= N.stageMax) || (staged > 0 && waited >= N.stageHardMax)) {
        n.wave = true;
        n.waveSince = this.time;
        this.ctx.law.log(`Надзор: повстанцы (${stormers}) штурмуют Управу! Всем юнитам — к Управе!`, 'radio');
        this.ctx.bus.emit('announce', { text: 'Штурм Управы' });
      }
    }
    if (!n.fallen) {
      if (rebels >= N.minAttackers && rebels >= defenders) n.progress = Math.min(N.captureTime, n.progress + dt);
      else n.progress = Math.max(0, n.progress - dt * N.decay);
      if (n.progress >= N.captureTime) {
        n.fallen = true;
        n.fallenAt = this.time;
        this.stats.nexusFalls++;
        this.ctx.law.log(`Администрация: УПРАВА ЗАХВАЧЕН повстанцами!${this.adminAlive() ? ' Комендант ещё жив — защищать Коменданта!' : ''} Всем силам Протектората — отбить Управу!`, 'world');
        this.ctx.bus.emit('announce', { text: 'Управа захвачена повстанцами' });
      }
      return;
    }
    if (rebels === 0) {
      n.fallen = false;
      n.progress = 0;
      this.ctx.law.log('Надзор: Управа отбита. Повстанцы выбиты из Управы.', 'radio');
      this.ctx.bus.emit('announce', { text: 'Управа отбита' });
      return;
    }
    // Управа взят и Комендант мёртв — город пал.
    if (!this.adminAlive()) this.rebelVictory();
  }

  /**
   * Управа взят, Комендант мёртв: победа восстания. Бойцы уходят в лагерь, через
   * WAR.nexus.restartDelay с — событие 'restart' (Game перезапускает карту).
   */
  private rebelVictory(): void {
    this.stats.victories++;
    this.restartAt = this.time + WAR.nexus.restartDelay;
    this.ctx.bus.emit('victory', { side: 'rebels' });
    const n = this.nexus;
    n.progress = 0;
    n.fallen = false;
    n.wave = false;
    n.stagedSince = -1;
    this.ctx.law.log(`Сопротивление: УПРАВА ВЗЯТ, КОМЕНДАНТ МЁРТВ — ВОССТАНИЕ ПОБЕДИЛО! Через ${WAR.nexus.restartDelay} с — новый город.`, 'world');
    this.ctx.bus.emit('announce', { text: 'Победа восстания · город пал' });
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
    this.declareGreen('Протекторат восстановил контроль');
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
   * Мобилизация красного кода: ВС с постов, медики КПП, кладовщик, экипаж конвоя и охрана склада
   * (кроме WAR.mobilize.depotKeep часовых) — на оборону Управы (CpBrain.rally); OTA с постов — в
   * ГЭС. Код снят — все назад на свои посты и службы.
   */
  private updateMobilize(): void {
    const M = WAR.mobilize;
    const red = this.code === 'red';
    if (!red) {
      if (!this.mobilized.size) return;
      for (const c of this.mobilized) {
        const b = c.brain;
        if (!(b instanceof CpBrain) || !b.rally) continue;
        b.rally = null;
        if (c.alive && b.fsm.current === 'guard') b.fsm.change(b.idleState);
      }
      this.mobilized.clear();
      this.rallySpots = null;
      return;
    }
    for (const o of this.ota) {
      const b = o.brain;
      if (o.alive && b instanceof OtaBrain && b.mode === 'post' && b.front >= 0) b.goHome();
    }
    const spots = (this.rallySpots ??= this.nexusSpots());
    if (!spots.length) return;
    const gate = poiWorld(this.ctx, 'nexus_gate') ?? spots[0];
    const taken = new Set<Vec2>();
    for (const c of this.mobilized) {
      const b = c.brain;
      if (c.alive && b instanceof CpBrain && b.rally) taken.add(b.rally);
    }
    let depot = 0;
    for (const c of this.ctx.entities.list) {
      const b = c.brain;
      if (!c.alive || c.isPlayer || !(b instanceof CpBrain) || b.rally || c.law.phase !== 'none') continue;
      const kind = c.role?.kind;
      const posted = !!b.guardPost || !!b.medicStation || b.duty === 'convoy' || b.duty === 'qm';
      // Тюрьму не бросают: охрана остаётся стеречь заключённых.
      if (!posted || kind === 'epu' || kind === 'bodyguard' || kind === 'inspector' || kind === 'officer' || kind === 'jailer' || kind === 'warden') continue;
      // Пара часовых остаётся стеречь склад.
      if (b.duty === 'sentry' && depot < M.depotKeep) {
        depot++;
        continue;
      }
      // Уже в Управе (посты у ворот и на ГЭС) — и так обороняют.
      if (this.ctx.map.zoneAtWorld(b.guardPost?.x ?? -1, b.guardPost?.y ?? -1)?.kind === 'nexus') continue;
      // Ближайшее к воротам свободное место.
      let spot: Vec2 | null = null;
      for (const s of spots) if (!taken.has(s)) {
        spot = s;
        break;
      }
      spot ??= spots[this.mobilized.size % spots.length];
      taken.add(spot);
      b.rally = spot;
      b.rallyFacing = Math.atan2(gate.y - spot.y, gate.x - spot.x);
      this.mobilized.add(c);
      if (b.fsm.current !== 'fight' && b.fsm.current !== 'retreat') b.fsm.change('guard');
    }
  }

  /** Места обороны Управы: якоря его зоны не дальше reach px от ворот, через spacing px, ближе к воротам — раньше. */
  private nexusSpots(): Vec2[] {
    const M = WAR.mobilize;
    const { map, nav } = this.ctx;
    const gate = poiWorld(this.ctx, 'nexus_gate');
    const cand: { p: Vec2; d: number }[] = [];
    for (const a of nav.walkable) {
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      if (map.zoneAtWorld(x, y)?.kind !== 'nexus') continue;
      const d = gate ? Math.hypot(x - gate.x, y - gate.y) : 0;
      if (d > M.reach) continue;
      cand.push({ p: { x, y }, d });
    }
    cand.sort((u, v) => u.d - v.d);
    const out: Vec2[] = [];
    for (const c of cand) if (out.every((o) => Math.hypot(o.x - c.p.x, o.y - c.p.y) >= M.spacing)) out.push(c.p);
    return out;
  }

  /**
   * Все точки D (оба тамбура) у повстанцев — сопротивление выходит в город: все, кроме
   * WAR.holdKeep бойцов на каждом КПП, идут на прорыв (прорвавшиеся → красный код).
   */
  private updateCityPush(): void {
    const breached = this.fronts.filter((f) => f.held >= f.points.length);
    const on = WAR.cityPushOn === 'all' ? this.fronts.length > 0 && breached.length === this.fronts.length : breached.length > 0;
    if (!on) {
      this.cityPush = false;
      return;
    }
    if (!this.cityPush) {
      this.cityPush = true;
      // Повстанцы рвутся в город — Легион с КПП уходит держать ГЭС (кроме заслона у прорыва).
      for (const o of this.ota) if (!this.blockaders.has(o)) (o.brain as OtaBrain | null)?.goHome();
      if (WAR.cityPushOn === 'all') {
        const names = this.fronts.flatMap((f) => f.points.map((p) => p.name)).join(', ');
        this.ctx.law.log(`Надзор: все точки ${names} в руках повстанцев — сопротивление выходит в город!`, 'radio');
        this.ctx.bus.emit('announce', { text: 'Все точки D у повстанцев · выход в город' });
      } else {
        const names = breached.map((f) => f.name).join(', ');
        this.ctx.law.log(`Надзор: ${names} прорван — повстанцы рвутся в город!`, 'radio');
        this.ctx.bus.emit('announce', { text: `Прорыв · повстанцы рвутся в город` });
      }
    }
    // Красный код — мобилизация: на КПП остаётся rebelKeep, остальные — на Управу. Рвутся в город
    // через прорванные КПП (по прежнему правилу — со всех).
    const holdKeep = this.code === 'red' ? WAR.mobilize.rebelKeep : WAR.holdKeep;
    for (const c of [...this.gateGuards]) if (!c.fit || rebelBrain(c)?.mode !== 'hold') this.gateGuards.delete(c);
    for (const f of WAR.cityPushOn === 'all' ? this.fronts : breached) {
      let keep = holdKeep;
      for (const r of f.squad) {
        const b = rebelBrain(r);
        if (!b || b.mode === 'assault' || b.mode === 'retreat') continue;
        // Стрелки у выхода прикрывают прорыв (при красном коде и они — на штурм).
        if (b.mode === 'hold' && this.code !== 'red' && this.gateGuards.has(r)) continue;
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
      (c) => c.alive && !c.isPlayer && c.faction === 'citizen' && c.gang < 0 && c.brain instanceof CitizenBrain && c.law.phase === 'none' &&
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
    c.rank = REBEL_UNIT.soldier;
    c.division = null;
    c.profession = 'rebel_soldier';
    c.disguised = false;
    c.carrying = false;
    c.law.wanted = true;
    this.ctx.law.clear(c);
    equipKit(c, 'rebel_soldier', this.ctx);
    this.stats.defected++;
    this.ctx.law.log(`${f.name}: ${c.isPlayer ? 'вы примкнули' : `${c.name} примкнул(а)`} к сопротивлению.`, 'radio');
    if (c.isPlayer) {
      this.ctx.bus.emit('defected', { who: c });
      return;
    }
    // Теперь — боец армии сопротивления (погибнет — вернётся из лагеря).
    c.role = { ...armySpec('rebel_soldier', 'rebel_soldier', REBEL_UNIT.soldier), name: c.name };
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
    const counts = this.rebelsAtFronts();
    this.otaTimer -= dt;
    if (this.otaTimer <= 0) {
      this.otaTimer = WAR.ota.every;
      this.deployOta(counts);
    }
    this.mobilizeTimer -= dt;
    if (this.mobilizeTimer <= 0) {
      this.mobilizeTimer = WAR.mobilize.every;
      this.updateMobilize();
    }
    this.blockadeTimer -= dt;
    if (this.blockadeTimer <= 0) {
      this.blockadeTimer = WAR.blockade.every;
      this.updateBlockade();
    }
    this.corpseScan -= dt;
    if (this.corpseScan <= 0) {
      this.corpseScan = ALARM.corpseScan;
      this.scanCorpses();
    }
    this.scenes.update(dt);
    if (this.restartAt >= 0 && this.time >= this.restartAt) {
      this.restartAt = -1;
      this.ctx.bus.emit('restart', {});
    }
    // Прорыв в город (WAR.cityPushOn) — до проверки прорвавшихся: они сразу штурмуют Управу.
    this.updateCityPush();
    for (const f of this.fronts) {
      // В город рвутся через прорванный КПП (по прежнему правилу 'all' — через любой).
      const pushHere = this.cityPush && (WAR.cityPushOn === 'all' || f.owner === 'rebels');
      // Прорыв в город: боец в штурме (КПП прорван, forceAssault) вышел за КПП.
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
        if (b.mode !== 'assault' && !pushHere) continue;
        f.squad.splice(f.squad.indexOf(r), 1);
        if (b.mode === 'storm' || b.mode === 'infiltrate') continue;
        this.infiltrators.add(r);
        this.lastKnown.set(r, { x: r.x, y: r.y });
        // КПП прорван — не прятаться, а штурмовать Управу.
        if (pushHere) b.storm();
        else b.infiltrate();
        // Красный код — только штурм Управы (КПП прорван, повстанцы в городе).
        if (pushHere && this.code !== 'red') this.declareRed(f.name, 'КПП прорван, повстанцы штурмуют Управу');
      }
      this.updateCapture(f, dt);
      if (!f.assaultAnnounced && f.squad.some((r) => rebelBrain(r)?.mode === 'assault')) {
        f.assaultAnnounced = true;
        this.ctx.law.log(`${f.name}: повстанцы идут на прорыв!`, 'radio');
      }
      // Точки снова у Протектората и повстанцев у КПП мало — OTA этого фронта возвращаются в резерв.
      if (f.held === 0 && !f.capture && counts[f.index] < WAR.ota.minRebels) {
        for (const o of this.ota) {
          const b = o.brain;
          if (b instanceof OtaBrain && b.front === f.index && b.mode === 'post') b.goHome();
        }
      }
    }

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
      // Красный код держится, пока в городе есть прорвавшиеся. Штурм отбит, а КПП всё ещё у
      // повстанцев — код жёлтый (возрождение, контрудары); КПП снова наши — зелёный.
      this.calm = this.infiltrators.size === 0 ? this.calm + dt : 0;
      const long = this.time - this.redSince;
      const storming = [...this.infiltrators].some((r) => rebelBrain(r)?.mode === 'storm');
      if (long > WAR.redMaxTime && this.infiltrators.size > 0 && !storming) this.goUnderground();
      if (this.calm >= WAR.calmToGreen && long >= WAR.redMinTime) {
        if (this.fronts.some((f) => f.held > 0)) this.declareYellow('— штурм Управы отбит, КПП ещё у повстанцев', 'Штурм отбит · код жёлтый');
        else this.declareGreen();
      }
    }
    // Погибшие OTA — из списка (возвращаются через постоянный состав).
    for (let i = this.ota.length - 1; i >= 0; i--) if (!this.ota[i].alive) this.ota.splice(i, 1);
  }
}

/** Гражданские: их тела тоже оцепляют (следователь SU.01 и медик). */
const CIVIL: ReadonlySet<string> = new Set(['citizen', 'cwu', 'vort']);
