/** Описание системы — docs/response.md. */
import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import type { Vec2 } from '../core/math';
import type { DoorGroup } from './DoorSystem';
import type { Violation } from '../config/law';
import { RESPONSE } from '../config/response';
import { CHARACTER } from '../config/entities';
import { CP_UNIT, cpUnit } from '../config/factions';
import { CpBrain } from '../ai/brains/CpBrain';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { GangOpBrain } from '../ai/brains/GangOpBrain';
import { HiredGunBrain } from '../ai/brains/HiredGunBrain';
import { ArmingBrain } from '../ai/brains/ArmingBrain';
import { HoldoutBrain } from '../ai/brains/HoldoutBrain';
import { computeBuildings, openAt, type Buildings } from '../world/buildings';
import { lineOfSight } from '../world/visibility';
import { T } from '../world/tiles';
import { whereOf } from '../world/places';

const near: Character[] = [];
const DEG = Math.PI / 180;

/** Выход здания: дверь, точка снаружи (out) и внутри (inside), куда смотрит наружу (nx, ny), комната за ней. */
export interface Exit {
  door: DoorGroup;
  out: Vec2;
  inside: Vec2;
  nx: number;
  ny: number;
  room: number;
}

/** Комната здания: центр, места «веером» (spots), двери в соседние комнаты: id комнаты → точка входа в эту комнату. */
export interface Room {
  id: number;
  cx: number;
  cy: number;
  tiles: number;
  spots: Vec2[];
  links: Map<number, { door: DoorGroup; into: Vec2 }>;
}

/** План здания для операции: выходы, комнаты, порядок зачистки от входа. */
export interface BuildingPlan {
  id: number;
  exits: Exit[];
  rooms: Room[];
  /** Комната по тайлу (индекс тайла карты → id комнаты). */
  roomAt: Map<number, number>;
}

interface Suspect {
  c: Character;
  x: number;
  y: number;
  seen: number;
}

/** Пост оцепления: где стоять, куда смотреть, кто стоит, какой выход держит. */
interface Post {
  spot: Vec2;
  face: number;
  unit: Character | null;
  exit: Exit | null;
}

export type OpStage = 'contain' | 'assault' | 'done';

export interface Operation {
  id: number;
  x: number;
  y: number;
  where: string;
  suspects: Map<Character, Suspect>;
  building: BuildingPlan | null;
  posts: Post[];
  commander: Character | null;
  stage: OpStage;
  opened: number;
  /** Когда засел в здании (−1 — нет). */
  besieged: number;
  shoutAt: number;
  casualties: number;
  team: Team | null;
  /** Сколько раз группа отходила (второй раз — не шлём ту же). */
  tries: number;
  said: Set<string>;
  closed: boolean;
}

type TeamPhase = 'rest' | 'muster' | 'move' | 'stage' | 'stack' | 'breach' | 'clear' | 'sweep' | 'withdraw' | 'done' | 'return';

/** Группа реагирования: бойцы (ведущий — первый), следователь, операция, этап штурма. */
export interface Team {
  id: number;
  members: Character[];
  investigator: Character | null;
  op: Operation | null;
  phase: TeamPhase;
  t: number;
  stage: Vec2 | null;
  entry: Exit | null;
  order: number[];
  idx: number;
  /** Комната: путь ко входу (enter) или веером внутри (spread); с какого момента тихо. */
  sub: 'enter' | 'spread';
  quietSince: number;
  cleared: Set<number>;
  flashed: boolean;
  losses: number;
  restUntil: number;
  /** Кого задерживает следователь (после штурма). */
  arresting: Character | null;
  /** Кто вышел на штурм (потери считаются по ним). */
  roster: Character[];
  /** План здания штурма (null — перестрелка на улице); засевший ушёл из него — группа за ним на улицу. */
  plan: BuildingPlan | null;
  /** Цепь на улице: направление от группы на врага (бойцы — поперёк него). */
  axis: number;
  /** Последний контакт на подходе к зданию (бой из укрытий, пока не стихнет на contactHold с). */
  contactAt: number;
}

/** Приказ бойцу группы (CpBrain, состояние swat): идти к точке, колонной за ведущим, стоять. */
export type SwatOrder =
  | { mode: 'go'; x: number; y: number; speed: number; face: number | null; crouch: boolean }
  | { mode: 'column'; leader: Character; k: number; speed: number }
  | { mode: 'hold'; face: number; crouch: boolean }
  /** Перестрелка на улице: к точке (цепью); видит врага — бой из укрытий (Tactician), как у ВС. */
  | { mode: 'engage'; x: number; y: number; speed: number; face: number };

/** Свободные состояния юнита ВС: можно поставить в оцепление. */
const FREE = new Set(['patrol', 'patrol-again', 'post', 'hunt', 'follow', 'guard', 'fight']);

/**
 * Операции ВС против вооружённых в городе. Видит вооружённого врага (кого ВС видел недавно) — операция: оцепление (посты у
 * выходов здания из-за углов или кольцо на улице), старший, переговоры; прижатого — в здание (HoldoutBrain); засел или
 * бьют по ВС — штурм группы реагирования из Управы со следователем (сбор, колонна, дверь, светошумовая, зачистка по
 * комнатам). Патрульные внутрь не входят и здание не прочёсывают (forbids).
 */
export class Response {
  enabled = true;
  readonly ops: Operation[] = [];
  readonly teams: Team[] = [];
  readonly stats = { ops: 0, holdouts: 0, surrendered: 0, escaped: 0, assaults: 0, entries: 0, flashes: 0, roomsCleared: 0, arrested: 0, killed: 0, posts: 0, retreats: 0, closedQuiet: 0, together: 0, rescues: 0, orphans: 0 };
  private readonly rng: Rng;
  /** Своя случайность живого поста в Управе (CpBrain, служба swat): не сдвигает общую случайность мира. */
  readonly dutyRng: Rng;
  private readonly buildings: Buildings;
  private readonly plans = new Map<number, BuildingPlan | null>();
  /** Кого ВС видел и где (для операций). */
  private readonly seen = new Map<Character, { x: number; y: number; t: number }>();
  /** Места дежурства групп в Управе: у входов (лицом наружу) и в казарме (сидя). */
  readonly doorSpots: { x: number; y: number; face: number }[] = [];
  /** Строй у главного входа Управы (ближайшая к воротам дверь): по бокам проёма в два ряда, лицом наружу. */
  readonly mainSpots: { x: number; y: number; face: number }[] = [];
  /** Смена постов: сдвиг номеров мест в группе (раз в duty.rotate с — из казармы на вход, с входа — отдыхать). */
  private shift = 0;
  private shiftT = 0;
  readonly bunkSpots: Vec2[] = [];
  private nextId = 1;
  private scanT = 0;

  constructor(private readonly ctx: AiContext) {
    this.rng = ctx.rng.fork(0x5a7);
    this.dutyRng = ctx.rng.fork(0x5a8);
    this.buildings = computeBuildings(ctx.map);
    for (let t = 0; t < RESPONSE.swat.teams; t++) {
      this.teams.push({ id: t, members: [], investigator: null, op: null, phase: 'rest', t: 0, stage: null, entry: null, order: [], idx: 0, sub: 'enter', quietSince: 0, cleared: new Set(), flashed: false, losses: 0, restUntil: 0, arresting: null, roster: [], plan: null, axis: 0, contactAt: -1e9 });
    }
    this.findBase();
  }

  get active(): boolean {
    return this.enabled;
  }

  // ───────────────────────────── база в Управе ─────────────────────────────

  /** Входы Управы (двери на улицу) и нары казармы — места дежурства групп. */
  private findBase(): void {
    const { map, nav, doors } = this.ctx;
    const ts = map.tileSize;
    const nexus = new Set(map.zones.filter((z) => z.kind === 'nexus').map((z) => z.id));
    const gp = map.poisOf('nexus_gate')[0];
    const gate = gp ? { x: (gp.x + 0.5) * ts, y: (gp.y + 0.5) * ts } : null;
    let mainD = Infinity;
    let main: { g: DoorGroup; nx: number; ny: number } | null = null;
    for (const g of doors.groups) {
      const t0 = g.tiles[0];
      if (!nexus.has(map.zoneGrid[t0])) continue;
      // Наружу: соседний тайл двери — открытая земля.
      let ox = 0;
      let oy = 0;
      for (const t of g.tiles) {
        const x = t % map.width;
        const y = (t - x) / map.width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (openAt(map, x + dx, y + dy)) {
            ox += dx;
            oy += dy;
          }
        }
      }
      const len = Math.hypot(ox, oy);
      if (len < 0.5) continue;
      let nx = ox / len;
      let ny = oy / len;
      // У ворот Управы открыто с обеих сторон (внутри — двор): «наружу» — туда, где кончается зона Управы.
      const zoneOut = (sx: number) => {
        const z = map.zoneAtWorld(g.x + nx * sx * ts * 3, g.y + ny * sx * ts * 3);
        return !z || !nexus.has(z.id);
      };
      if (!zoneOut(1) && zoneOut(-1)) {
        nx = -nx;
        ny = -ny;
      }
      const dg = gate ? Math.hypot(g.x - gate.x, g.y - gate.y) : Infinity;
      if (dg < mainD) {
        mainD = dg;
        main = { g, nx, ny };
      }
      for (const side of [-1, 1]) {
        const px = g.x + nx * ts * 2.2 - ny * side * ts * 1.6;
        const py = g.y + ny * ts * 2.2 + nx * side * ts * 1.6;
        const a = nav.nearestWalkable(px, py, 2);
        if (a >= 0) this.doorSpots.push({ x: nav.worldX(a), y: nav.worldY(a), face: Math.atan2(ny, nx) });
      }
    }
    // Строй у главного входа — у ворот Управы (nexus_gate; нет ворот — ближайшая к ним дверь): по бокам проёма — ряды
    // вдоль фасада (ближе к проёму — первыми), через одного — шаг наружу. «Наружу» — где кончается зона Управы.
    const entry = gate ?? (main ? { x: main.g.x, y: main.g.y } : null);
    if (entry) {
      const D = RESPONSE.duty.main;
      let nx = main?.nx ?? 0;
      let ny = main?.ny ?? 1;
      if (gate) {
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          const z = map.zoneAtWorld(gate.x + dx * ts * 3, gate.y + dy * ts * 3);
          if ((!z || !nexus.has(z.id)) && nav.nearestWalkable(gate.x + dx * ts * 3, gate.y + dy * ts * 3, 0) >= 0) {
            nx = dx;
            ny = dy;
            break;
          }
        }
      }
      // Ширина проёма ворот: строй — по бокам, проход свободен.
      let cx = entry.x;
      let cy = entry.y;
      let half = 0;
      if (gp) {
        const tx = -ny;
        const ty = nx;
        let lo = 0;
        let hi = 0;
        while (lo < 12 && map.tileAt(gp.x - tx * (lo + 1), gp.y - ty * (lo + 1)) === T.GATE) lo++;
        while (hi < 12 && map.tileAt(gp.x + tx * (hi + 1), gp.y + ty * (hi + 1)) === T.GATE) hi++;
        half = (lo + hi + 1) / 2;
        cx += ((hi - lo) / 2) * tx * ts;
        cy += ((hi - lo) / 2) * ty * ts;
      }
      const used = new Set<number>();
      for (let j = 0; j < D.perSide; j++) {
        for (const side of [-1, 1]) {
          const along = side * (half + D.gap + j * D.step) * ts;
          const out = (D.out + (j % 2) * D.row) * ts;
          const a = nav.nearestWalkable(cx + nx * out - ny * along, cy + ny * out + nx * along, 1);
          if (a < 0 || used.has(a)) continue;
          used.add(a);
          this.mainSpots.push({ x: nav.worldX(a), y: nav.worldY(a), face: Math.atan2(ny, nx) });
        }
      }
    }
    for (const p of map.poisOf('bunk')) {
      const a = nav.nearestWalkable((p.x + 0.5) * ts, (p.y + 0.5) * ts, 2);
      if (a >= 0) this.bunkSpots.push({ x: nav.worldX(a), y: nav.worldY(a) });
    }
  }

  /**
   * Место дежурства бойца группы team (номер k в группе): первые atMain — в строю у главного входа, следующие atDoors
   * — у других входов, остальные — в казарме. Номер сдвигается сменой постов (shift).
   */
  restSpot(team: number, k0: number): { x: number; y: number; face: number; sit: boolean } | null {
    const S = RESPONSE.swat;
    const k = (k0 + this.shift) % S.size;
    if (k < S.atMain && this.mainSpots.length) {
      const p = this.mainSpots[(k * S.teams + team) % this.mainSpots.length];
      return { x: p.x, y: p.y, face: p.face, sit: false };
    }
    if (k < S.atMain + S.atDoors && this.doorSpots.length) {
      const p = this.doorSpots[(team * S.atDoors + k - S.atMain) % this.doorSpots.length];
      return { x: p.x, y: p.y, face: p.face, sit: false };
    }
    if (this.bunkSpots.length) {
      const p = this.bunkSpots[(team * S.size + k) % this.bunkSpots.length];
      return { x: p.x, y: p.y, face: this.rng.range(0, Math.PI * 2), sit: true };
    }
    const g = this.doorSpots[0];
    return g ? { x: g.x, y: g.y, face: g.face, sit: false } : null;
  }

  /**
   * Место дежурства бойца (по его группе и номеру в ней). null — группа его ещё не знает: мозг только создан (в
   * конструкторе c.brain — ещё прежний), список группы обновится в следующем update.
   */
  restSpotOf(c: Character): { x: number; y: number; face: number; sit: boolean } | null {
    const b = c.brain;
    if (!(b instanceof CpBrain) || b.squad < 0) return null;
    const k = this.teams[b.squad]?.members.indexOf(c) ?? -1;
    return k < 0 ? null : this.restSpot(b.squad, k);
  }

  // ───────────────────────────── план здания ─────────────────────────────

  /** Здание точки мира (индекс в Buildings) или −1: только под крышей и не казённое. */
  buildingAt(x: number, y: number): number {
    const map = this.ctx.map;
    const tx = Math.floor(x / map.tileSize);
    const ty = Math.floor(y / map.tileSize);
    const b = this.buildings.of[ty * map.width + tx];
    if (b < 0) return -1;
    const t = map.tileAt(tx, ty);
    return t === T.INTERIOR || t === T.DOOR || t === T.BARRIER ? b : -1;
  }

  /** Годится ли здание засевшему: жилое, лавка, общага (не Управа, склад, тюрьма, академия, больница, КПП). */
  holdable(b: number): boolean {
    const B = this.buildings.list[b];
    if (!B || B.kind === 'civic') return false;
    const k = this.ctx.map.zoneAtTile(B.x0 + ((B.x1 - B.x0) >> 1), B.y0 + ((B.y1 - B.y0) >> 1))?.kind;
    return k !== 'nexus' && k !== 'cells' && k !== 'arsenal' && k !== 'prison' && k !== 'academy' && k !== 'hospital' && k !== 'checkpoint' && k !== 'ges' && k !== 'cwu_hq';
  }

  /** План здания (кэш): комнаты — связные куски пола под крышей (двери их разделяют), выходы — двери на улицу. */
  plan(b: number): BuildingPlan | null {
    if (this.plans.has(b)) return this.plans.get(b)!;
    const p = this.makePlan(b);
    this.plans.set(b, p);
    return p;
  }

  private makePlan(bi: number): BuildingPlan | null {
    const { map, nav, doors } = this.ctx;
    const B = this.buildings.list[bi];
    if (!B) return null;
    const w = map.width;
    const ts = map.tileSize;
    const inB = (x: number, y: number) => x >= B.x0 && y >= B.y0 && x <= B.x1 && y <= B.y1 && this.buildings.of[y * w + x] === bi;
    const roomTile = (x: number, y: number) => {
      const t = map.tileAt(x, y);
      return inB(x, y) && (t === T.INTERIOR || t === T.BARRIER);
    };
    const roomAt = new Map<number, number>();
    const rooms: Room[] = [];
    for (let y = B.y0; y <= B.y1; y++) {
      for (let x = B.x0; x <= B.x1; x++) {
        const i = y * w + x;
        if (roomAt.has(i) || !roomTile(x, y)) continue;
        const id = rooms.length;
        const stack = [i];
        roomAt.set(i, id);
        let sx = 0;
        let sy = 0;
        let n = 0;
        while (stack.length) {
          const j = stack.pop()!;
          const jx = j % w;
          const jy = (j - jx) / w;
          sx += jx;
          sy += jy;
          n++;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const k = (jy + dy) * w + jx + dx;
            if (roomAt.has(k) || !roomTile(jx + dx, jy + dy)) continue;
            roomAt.set(k, id);
            stack.push(k);
          }
        }
        rooms.push({ id, cx: (sx / n + 0.5) * ts, cy: (sy / n + 0.5) * ts, tiles: n, spots: [], links: new Map() });
      }
    }
    if (!rooms.length) return null;
    // Места в комнате: проходимые якоря целиком в ней — по углу вокруг центра, вразброс.
    const anchors: Vec2[][] = rooms.map(() => []);
    for (const [i, r] of roomAt) {
      const x = i % w;
      const y = (i - x) / w;
      if (!nav.isWalkable(x, y) || roomAt.get(i + 1 + w) !== r) continue;
      anchors[r].push({ x: (x + 1) * ts, y: (y + 1) * ts });
    }
    rooms.forEach((r, k) => {
      const list = anchors[k];
      if (!list.length) return;
      const byAng = list.map((p) => ({ p, a: Math.atan2(p.y - r.cy, p.x - r.cx), d: Math.hypot(p.x - r.cx, p.y - r.cy) }));
      for (let s = 0; s < 5; s++) {
        const lo = -Math.PI + (s * 2 * Math.PI) / 5;
        const hi = lo + (2 * Math.PI) / 5;
        let best: { p: Vec2; d: number } | null = null;
        for (const q of byAng) if (q.a >= lo && q.a < hi && (!best || q.d > best.d)) best = q;
        if (best) r.spots.push(best.p);
      }
      if (!r.spots.length) r.spots.push(list[0]);
    });
    // Двери: на улицу — выход; между комнатами — связь.
    const exits: Exit[] = [];
    const seenDoor = new Set<number>();
    for (let y = B.y0 - 1; y <= B.y1 + 1; y++) {
      for (let x = B.x0 - 1; x <= B.x1 + 1; x++) {
        if (map.tileAt(x, y) !== T.DOOR) continue;
        const g = doors.groupAtTile(x, y);
        if (!g || seenDoor.has(g.id)) continue;
        seenDoor.add(g.id);
        const roomsNear = new Set<number>();
        let ox = 0;
        let oy = 0;
        for (const t of g.tiles) {
          const tx = t % w;
          const ty = (t - tx) / w;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const r = roomAt.get((ty + dy) * w + tx + dx);
            if (r !== undefined) roomsNear.add(r);
            else if (openAt(map, tx + dx, ty + dy)) {
              ox += dx;
              oy += dy;
            }
          }
        }
        const rs = [...roomsNear];
        const len = Math.hypot(ox, oy);
        if (len > 0.5 && rs.length >= 1) {
          const nx = ox / len;
          const ny = oy / len;
          const ao = nav.nearestWalkable(g.x + nx * ts * 1.8, g.y + ny * ts * 1.8, 2);
          const ai = nav.nearestWalkable(g.x - nx * ts * 1.6, g.y - ny * ts * 1.6, 2);
          if (ao >= 0 && ai >= 0) exits.push({ door: g, out: { x: nav.worldX(ao), y: nav.worldY(ao) }, inside: { x: nav.worldX(ai), y: nav.worldY(ai) }, nx, ny, room: rs[0] });
        } else if (rs.length >= 2) {
          for (const a of rs) {
            for (const b2 of rs) {
              if (a === b2) continue;
              // Точка входа в комнату b2 — на шаг от двери в её сторону.
              const R = rooms[b2];
              const d = Math.hypot(R.cx - g.x, R.cy - g.y) || 1;
              const ai = nav.nearestWalkable(g.x + ((R.cx - g.x) / d) * ts * 1.7, g.y + ((R.cy - g.y) / d) * ts * 1.7, 2);
              if (ai >= 0 && !rooms[a].links.has(b2)) rooms[a].links.set(b2, { door: g, into: { x: nav.worldX(ai), y: nav.worldY(ai) } });
            }
          }
        }
      }
    }
    if (!exits.length) return null;
    return { id: bi, exits, rooms, roomAt };
  }

  /** Порядок зачистки: от комнаты входа в ширину по дверям. */
  private roomOrder(plan: BuildingPlan, from: number): number[] {
    const order = [from];
    const seen = new Set(order);
    for (let k = 0; k < order.length; k++) {
      for (const r of plan.rooms[order[k]].links.keys()) {
        if (seen.has(r)) continue;
        seen.add(r);
        order.push(r);
      }
    }
    // Комнаты, куда из этих не пройти, — тоже (через другие выходы): в конец.
    for (const r of plan.rooms) if (!seen.has(r.id) && r.spots.length) order.push(r.id);
    return order.filter((r) => plan.rooms[r].spots.length > 0);
  }

  /** Комната, где точка (или −1). */
  roomOf(plan: BuildingPlan, x: number, y: number): number {
    const map = this.ctx.map;
    return plan.roomAt.get(Math.floor(y / map.tileSize) * map.width + Math.floor(x / map.tileSize)) ?? -1;
  }

  /** Не ходить сюда патрулю (прочёсывание): здание, где засел вооружённый. */
  forbids(x: number, y: number): boolean {
    if (!this.enabled) return false;
    for (const op of this.ops) {
      if (op.closed || !op.building) continue;
      if (this.buildingAt(x, y) === op.building.id) return true;
    }
    return false;
  }

  // ───────────────────────────── враги и операции ─────────────────────────────

  /** Вооружённый враг Протектората в городе, с кем воюет операция. */
  private threat(c: Character): boolean {
    if (!c.alive || c.isPlayer || !c.hostile || c.law.phase !== 'none' || FACTIONS_AUTH(c)) return false;
    if (c.faction === 'rebel' && !(c.brain instanceof HoldoutBrain)) return false;
    if (this.ctx.combat.maxRange(c) <= 0) return false;
    return this.inCity(c.x, c.y);
  }

  private inCity(x: number, y: number): boolean {
    const map = this.ctx.map;
    if (map.levelAt(x, y) !== 'city') return false;
    const k = map.zoneAtWorld(x, y)?.kind;
    return k !== 'checkpoint' && k !== 'outlands' && k !== 'wasteland' && k !== 'rebel_camp' && k !== 'ges';
  }

  /** Может ли засесть (мозг бандита, наёмника, беглого, вооружённого жителя; не армия и подполье). */
  private canHold(c: Character): boolean {
    const b = c.brain;
    if (b instanceof GangOpBrain) return b.op.kind !== 'storm';
    return b instanceof CitizenBrain || b instanceof HiredGunBrain || b instanceof ArmingBrain;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const now = this.ctx.combat.now;
    // Красный код — не до операций: оцепления снять, группы — на оборону Управы (WarSystem).
    if (this.ctx.war.code === 'red') {
      for (const op of this.ops) if (!op.closed) this.close(op, 'red');
      this.ops.length = 0;
    }
    this.updateTeams(dt);
    // Смена постов в Управе: места сдвигаются — отдохнувший из казармы встаёт в строй, с поста — отдыхать.
    this.shiftT += dt;
    if (this.shiftT >= RESPONSE.duty.rotate) {
      this.shiftT = 0;
      this.shift = (this.shift + 1) % RESPONSE.swat.size;
      for (const t of this.teams) {
        if (t.phase !== 'rest') continue;
        for (const c of t.members) if (c.brain instanceof CpBrain && c.brain.fsm.current === 'duty') c.brain.nextDuty();
      }
    }
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = RESPONSE.op.every;
    const step = RESPONSE.op.every;
    this.lookout(now);
    for (const op of this.ops) if (!op.closed) this.tick(op, now, step);
    // Засевший без операции (её закрыли, его в неё не взяли) — к прежней жизни.
    for (const c of this.ctx.entities.list) {
      const hb = c.brain;
      if (hb instanceof HoldoutBrain && c.alive && !hb.surrendered && !this.opOf(c)) {
        hb.finish(c);
        this.stats.orphans++;
      }
    }
    for (let i = this.ops.length - 1; i >= 0; i--) if (this.ops[i].closed) this.ops.splice(i, 1);
  }

  /** Кого видят ВС: цели стрелков ВС (и засевшие — их видели входящими в здание). */
  private lookout(now: number): void {
    const R = RESPONSE.op;
    for (const u of this.ctx.entities.list) {
      const b = u.brain;
      if (u.faction !== 'cp' || !u.alive || !(b instanceof CpBrain)) continue;
      const t = b.gunner.target;
      if (t && this.threat(t)) this.seen.set(t, { x: t.x, y: t.y, t: now });
    }
    for (const [c, s] of this.seen) {
      if (!c.alive || now - s.t > R.known * 3) {
        this.seen.delete(c);
        continue;
      }
      if (now - s.t > R.known || !this.threat(c) || this.opOf(c)) continue;
      // Рядом с открытой — та же операция; иначе новая (не больше maxOpen).
      let op = this.ops.find((o) => !o.closed && Math.hypot(o.x - s.x, o.y - s.y) < R.merge) ?? null;
      if (!op) {
        if (this.ops.filter((o) => !o.closed).length >= R.maxOpen) continue;
        op = this.open(s.x, s.y, now);
      }
      op.suspects.set(c, { c, x: s.x, y: s.y, seen: s.t });
    }
  }

  /** Сигнал о вооружённом (донос, вызов, игрок-ВС увидел): как будто его видел ВС — в операцию. */
  spotted(c: Character): void {
    if (this.enabled && this.threat(c)) this.seen.set(c, { x: c.x, y: c.y, t: this.ctx.combat.now });
  }

  opOf(c: Character): Operation | null {
    for (const op of this.ops) if (!op.closed && op.suspects.has(c)) return op;
    return null;
  }

  private open(x: number, y: number, now: number): Operation {
    const zone = this.ctx.map.zoneAtWorld(x, y);
    const op: Operation = {
      id: this.nextId++, x, y, where: whereOf(zone), suspects: new Map(), building: null, posts: [], commander: null, stage: 'contain',
      opened: now, besieged: -1, shoutAt: now + RESPONSE.talk.every, casualties: 0, team: null, tries: 0, said: new Set(), closed: false,
    };
    this.ops.push(op);
    this.stats.ops++;
    return op;
  }

  /** Шаг операции: подозреваемые, засевший, оцепление, переговоры, вызов группы, итог. */
  private tick(op: Operation, now: number, step: number): void {
    const R = RESPONSE;
    // Подозреваемые: где они, кто выбыл.
    let alive = 0;
    let holdouts = 0;
    for (const [c, s] of op.suspects) {
      const sn = this.seen.get(c);
      if (sn && sn.t > s.seen) {
        s.x = sn.x;
        s.y = sn.y;
        s.seen = sn.t;
      }
      if (c.brain instanceof HoldoutBrain) {
        s.x = c.x;
        s.y = c.y;
        s.seen = now;
      }
      if (!c.alive) {
        op.suspects.delete(c);
        this.stats.killed++;
        continue;
      }
      const ph = c.law.phase;
      if (ph === 'cuffed' || ph === 'entering' || ph === 'jailed') {
        op.suspects.delete(c);
        this.stats.arrested++;
        continue;
      }
      const hb = c.brain instanceof HoldoutBrain ? c.brain : null;
      if (!c.hostile && !hb && !c.downed) {
        // Остыл и ушёл (не засел, не сдался): операция по нему кончена.
        op.suspects.delete(c);
        continue;
      }
      alive++;
      if (hb && !hb.surrendered) holdouts++;
      // Прижали — в здание.
      if (!hb && c.fit && c.hostile && this.canHold(c)) this.tryHoldout(c);
    }
    // Потери ВС у места.
    for (const u of this.ctx.entities.near(op.x, op.y, R.contain.recruit * 0.4, near)) {
      if (u.faction === 'cp' && u.downed && u.downedAt > now - step - 1e-6) op.casualties++;
    }
    if (!op.suspects.size) {
      this.close(op, op.said.has('escaped') ? 'escaped' : 'clear');
      return;
    }
    // Центр операции и здание.
    let sx = 0;
    let sy = 0;
    let lastSeen = -1e9;
    let inside: number = -1;
    for (const s of op.suspects.values()) {
      sx += s.x;
      sy += s.y;
      lastSeen = Math.max(lastSeen, s.seen);
      const b = s.c.brain instanceof HoldoutBrain ? s.c.brain.plan.id : -1;
      if (b >= 0) inside = b;
    }
    op.x = sx / op.suspects.size;
    op.y = sy / op.suspects.size;
    const plan = inside >= 0 ? this.plan(inside) : null;
    if (plan && op.building?.id !== plan.id) {
      op.building = plan;
      op.besieged = now;
      op.posts = this.doorPosts(plan);
      this.say(op, 'barricade', R.lines.barricade, null);
    } else if (!plan && (op.building || !op.posts.length)) {
      op.building = null;
      op.besieged = -1;
      op.posts = this.ringPosts(op.x, op.y);
    }
    // Ушёл: никто не видит, не в здании — после quiet с операция закрыта.
    if (!plan && now - lastSeen > R.op.quiet) {
      op.said.add('escaped');
      this.say(op, 'escapedLine', R.lines.escaped, null, true);
      this.stats.closedQuiet++;
      this.close(op, 'escaped');
      return;
    }
    if (now - op.opened > R.op.maxTime && !op.team) {
      this.close(op, 'timeout');
      return;
    }
    this.staffPosts(op, now);
    if (plan) this.negotiate(op, now);
    this.handleSurrendered(op);
    // Вызов группы реагирования.
    if (!op.team && op.tries < RESPONSE.swat.teams && (op.stage === 'contain')) {
      const S = R.swat;
      const long = op.besieged >= 0 && now - op.besieged > S.after;
      const hot = op.casualties > 0 || alive >= S.many;
      if ((plan && holdouts > 0 && (long || hot)) || (!plan && hot)) this.callTeam(op, now);
    }
  }

  /** Прижатого вооружённого — в ближайшее здание (бойца банды — в его общагу, если рядом); уже в доме — там и засел. */
  private tryHoldout(c: Character): void {
    const H = RESPONSE.holdout;
    const here = this.buildingAt(c.x, c.y);
    const inPlan = here >= 0 && this.holdable(here) ? this.plan(here) : null;
    if (inPlan && inPlan.rooms.length) {
      const e = inPlan.exits.reduce((a, q) => (Math.hypot(q.inside.x - c.x, q.inside.y - c.y) < Math.hypot(a.inside.x - c.x, a.inside.y - c.y) ? q : a));
      c.brain = new HoldoutBrain(this, inPlan, e, c.brain, this.ctx.rng);
      this.stats.holdouts++;
      this.gangHoldout(c, inPlan, e);
      return;
    }
    let cops = 0;
    for (const u of this.ctx.entities.near(c.x, c.y, H.copsNear, near)) if (u.faction === 'cp' && u.fit) cops++;
    const hurt = c.health < c.maxHealth * H.hurtBelow;
    if (cops < H.cops && !(hurt && cops > 0)) return;
    // Своя общага банды — если недалеко.
    let best: { plan: BuildingPlan; exit: Exit; d: number } | null = null;
    const home = c.gang >= 0 ? this.ctx.gangs?.gangs[c.gang]?.hq ?? null : null;
    if (home && Math.hypot(home.x - c.x, home.y - c.y) < H.home) {
      const b = this.buildingAt(home.x, home.y);
      const p = b >= 0 ? this.plan(b) : null;
      if (p) {
        const e = p.exits.reduce((a, q) => (Math.hypot(q.out.x - c.x, q.out.y - c.y) < Math.hypot(a.out.x - c.x, a.out.y - c.y) ? q : a));
        best = { plan: p, exit: e, d: 0 };
      }
    }
    if (!best) {
      for (const g of this.ctx.doors.groups) {
        const d = Math.hypot(g.x - c.x, g.y - c.y);
        if (d > H.door || (best && d >= best.d)) continue;
        const b = this.buildings.of[Math.floor(g.y / this.ctx.map.tileSize) * this.ctx.map.width + Math.floor(g.x / this.ctx.map.tileSize)];
        const bi = b >= 0 ? b : this.buildingAt(g.x + 8, g.y + 8);
        if (bi < 0 || !this.holdable(bi)) continue;
        const p = this.plan(bi);
        const e = p?.exits.find((q) => q.door === g);
        if (p && e && p.rooms.length) best = { plan: p, exit: e, d };
      }
    }
    if (!best) return;
    c.brain = new HoldoutBrain(this, best.plan, best.exit, c.brain, this.ctx.rng);
    this.stats.holdouts++;
    this.gangHoldout(c, best.plan, best.exit);
  }

  /**
   * Засел боец банды: свои со стволом рядом — в тот же дом, в другие комнаты (RESPONSE.gang.together); банда идёт
   * выручать (Gangs.rescue) — Надзор предупреждает оцепление.
   */
  private gangHoldout(c: Character, plan: BuildingPlan, exit: Exit): void {
    if (c.gang < 0) return;
    const T = RESPONSE.gang.together;
    const op0 = this.opOf(c);
    let n = 0;
    for (const o of this.ctx.entities.near(c.x, c.y, T.near, near)) {
      if (n >= T.max) break;
      if (o === c || o.gang !== c.gang || !o.alive || !o.fit || o.isPlayer || !o.hostile || o.law.phase !== 'none') continue;
      if (o.brain instanceof HoldoutBrain || !this.canHold(o) || this.ctx.combat.maxRange(o) <= 0) continue;
      o.brain = new HoldoutBrain(this, plan, exit, o.brain, this.ctx.rng, ++n);
      this.stats.holdouts++;
      this.stats.together++;
      this.spotted(o);
      // Сразу в ту же операцию (иначе мог остаться засевшим без операции — «сиротой»).
      if (op0 && !op0.suspects.has(o)) op0.suspects.set(o, { c: o, x: o.x, y: o.y, seen: this.ctx.combat.now });
    }
    const team = this.ctx.gangs?.rescue(c, { x: c.x, y: c.y }) ?? [];
    if (!team.length) return;
    this.stats.rescues++;
    const op = this.opOf(c);
    const u = op?.posts.find((p) => p.unit)?.unit ?? null;
    if (u && op) this.ctx.radio?.opNadzor(this.rng.pick(RESPONSE.gang.lines.radio).replace('{where}', op.where), [u], u);
  }

  /** Посты у выходов здания: угол снаружи, откуда дверь видна, а из проёма — нет. */
  private doorPosts(plan: BuildingPlan): Post[] {
    const C = RESPONSE.contain;
    const { nav, map } = this.ctx;
    const posts: Post[] = [];
    for (const e of plan.exits) {
      let best: { spot: Vec2; score: number } | null = null;
      for (let k = 0; k < 40; k++) {
        const ang = Math.atan2(e.ny, e.nx) + (k % 2 ? 1 : -1) * (C.minAngle + ((C.maxAngle - C.minAngle) * ((k >> 1) % 5)) / 4) * DEG;
        const r = C.near + ((C.far - C.near) * Math.floor(k / 10)) / 3;
        const a = nav.nearestWalkable(e.door.x + Math.cos(ang) * r, e.door.y + Math.sin(ang) * r, 1);
        if (a < 0) continue;
        const x = nav.worldX(a);
        const y = nav.worldY(a);
        // Видно, кто выходит: точка перед дверью (сама закрытая дверь непрозрачна).
        if (this.buildingAt(x, y) >= 0 || map.levelAt(x, y) !== 'city' || !lineOfSight(map, x, y, e.out.x, e.out.y)) continue;
        if (posts.some((p) => Math.hypot(p.spot.x - x, p.spot.y - y) < C.spacing)) continue;
        // Лучше — у стены (угол), дальше от оси двери, ближе к ней.
        const off = Math.abs(Math.atan2(y - e.door.y, x - e.door.x) - Math.atan2(e.ny, e.nx));
        const score = this.walls(x, y) * 2 + Math.min(off, Math.PI * 2 - off) * 3 - Math.hypot(x - e.door.x, y - e.door.y) / 60;
        if (!best || score > best.score) best = { spot: { x, y }, score };
      }
      if (best) posts.push({ spot: best.spot, face: Math.atan2(e.out.y - best.spot.y, e.out.x - best.spot.x), unit: null, exit: e });
    }
    // Главный выход (первый) — ещё один пост, с другой стороны.
    const main = plan.exits[0];
    if (posts.length < RESPONSE.contain.posts && main) {
      const p0 = posts.find((p) => p.exit === main);
      if (p0) {
        const mx = 2 * main.door.x - p0.spot.x + main.nx * 40;
        const my = 2 * main.door.y - p0.spot.y + main.ny * 40;
        const a = nav.nearestWalkable(mx, my, 2);
        if (a >= 0 && this.buildingAt(nav.worldX(a), nav.worldY(a)) < 0) posts.push({ spot: { x: nav.worldX(a), y: nav.worldY(a) }, face: Math.atan2(main.door.y - nav.worldY(a), main.door.x - nav.worldX(a)), unit: null, exit: main });
      }
    }
    return posts.slice(0, Math.max(RESPONSE.contain.posts, plan.exits.length));
  }

  /** Кольцо на улице: у стен в ring px вокруг места, по секторам, с видом на место. */
  private ringPosts(x: number, y: number): Post[] {
    const C = RESPONSE.contain;
    const { nav, map } = this.ctx;
    const posts: Post[] = [];
    for (let s = 0; s < C.ring.sectors; s++) {
      let best: { spot: Vec2; score: number } | null = null;
      for (let k = 0; k < 12; k++) {
        const ang = ((s + (k % 4) / 4) / C.ring.sectors) * Math.PI * 2;
        const r = C.ring.min + ((C.ring.max - C.ring.min) * Math.floor(k / 4)) / 2;
        const a = nav.nearestWalkable(x + Math.cos(ang) * r, y + Math.sin(ang) * r, 1);
        if (a < 0) continue;
        const px = nav.worldX(a);
        const py = nav.worldY(a);
        if (map.levelAt(px, py) !== 'city' || !lineOfSight(map, px, py, x, y)) continue;
        if (posts.some((p) => Math.hypot(p.spot.x - px, p.spot.y - py) < C.spacing)) continue;
        const score = this.walls(px, py);
        if (score < C.wallNear && best) continue;
        if (!best || score > best.score) best = { spot: { x: px, y: py }, score };
      }
      if (best) posts.push({ spot: best.spot, face: Math.atan2(y - best.spot.y, x - best.spot.x), unit: null, exit: null });
    }
    return posts;
  }

  /** Сколько стен рядом (укрытие на посту). */
  private walls(x: number, y: number): number {
    const map = this.ctx.map;
    const tx = Math.floor(x / map.tileSize);
    const ty = Math.floor(y / map.tileSize);
    let n = 0;
    for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) if (map.isSolid(tx + dx, ty + dy)) n++;
    return n;
  }

  /** Посты: выбывших — заменить, свободные — ближайшими свободными патрульными; старший — самый старший по званию. */
  private staffPosts(op: Operation, now: number): void {
    const C = RESPONSE.contain;
    for (const p of op.posts) {
      const u = p.unit;
      const b = u?.brain;
      if (u && (!u.alive || u.downed || !(b instanceof CpBrain) || b.opPost !== op.id || b.fsm.current === 'retreat')) {
        if (b instanceof CpBrain && b.opPost === op.id) b.releaseOpPost();
        p.unit = null;
      }
    }
    const free = op.posts.filter((p) => !p.unit);
    if (free.length) {
      const cands: { c: Character; d: number }[] = [];
      for (const c of this.ctx.entities.list) {
        if (!this.recruitable(c)) continue;
        const d = Math.hypot(c.x - op.x, c.y - op.y);
        if (d < C.recruit) cands.push({ c, d });
      }
      cands.sort((a, b) => a.d - b.d);
      const sent: Character[] = [];
      for (const p of free) {
        let best = -1;
        let bestD = Infinity;
        cands.forEach((q, i) => {
          if (sent.includes(q.c)) return;
          const d = Math.hypot(q.c.x - p.spot.x, q.c.y - p.spot.y);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (best < 0) break;
        const u = cands[best].c;
        sent.push(u);
        p.unit = u;
        (u.brain as CpBrain).assignOpPost(op.id, p.spot, p.face, this.avoidOf(op));
        this.stats.posts++;
        if (this.rng.chance(0.5)) u.say(this.rng.pick(RESPONSE.lines.post), this.ctx.law.now + 1.5, 2);
      }
      if (sent.length) this.say(op, 'contain', RESPONSE.lines.contain, null, false, sent);
    }
    // Старший: высший по командованию из стоящих в оцеплении.
    let cmd: Character | null = null;
    for (const p of op.posts) {
      const u = p.unit;
      if (u && (!cmd || cpUnit(u.rank).command > cpUnit(cmd.rank).command)) cmd = u;
    }
    op.commander = cmd;
    void now;
  }

  /** Свободен ли юнит для оцепления. */
  private recruitable(c: Character): boolean {
    const b = c.brain;
    if (c.faction !== 'cp' || !c.alive || c.isPlayer || !c.fit || c.cadet || !(b instanceof CpBrain)) return false;
    if (b.opPost >= 0 || b.guardPost || b.medicStation || b.rally || b.raidPost || b.formation || b.ward || b.scene || b.target || b.front >= 0) return false;
    if (b.duty && b.duty !== 'squad') return false;
    if (c.health < c.maxHealth * 0.5 || this.ctx.map.levelAt(c.x, c.y) !== 'city') return false;
    return FREE.has(b.fsm.current);
  }

  /** Путь на пост — в обход мест подозреваемых. */
  private avoidOf(op: Operation): ((a: number) => number) | undefined {
    const C = RESPONSE.contain;
    const nav = this.ctx.nav;
    const pts = [...op.suspects.values()].map((s) => ({ x: s.x, y: s.y }));
    if (!pts.length) return undefined;
    const r2 = C.avoidRadius * C.avoidRadius;
    return (a: number) => {
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      for (const p of pts) if ((x - p.x) ** 2 + (y - p.y) ** 2 < r2) return C.avoidCost;
      return 0;
    };
  }

  /** Переговоры: старший кричит «выходи», засевший отвечает или сдаётся. */
  private negotiate(op: Operation, now: number): void {
    const K = RESPONSE.talk;
    const cmd = op.commander;
    if (!cmd || now < op.shoutAt) return;
    op.shoutAt = now + K.every;
    cmd.say(this.rng.pick(RESPONSE.lines.shout), this.ctx.law.now, 3);
    const onPost = op.posts.filter((p) => p.unit).length;
    for (const s of op.suspects.values()) {
      const hb = s.c.brain;
      if (!(hb instanceof HoldoutBrain) || hb.surrendered || !s.c.fit) continue;
      const kind = s.c.gang >= 0 ? 'gang' : hb.saved instanceof HiredGunBrain ? 'hired' : s.c.faction === 'citizen' || s.c.faction === 'cwu' ? 'citizen' : 'other';
      const hurt = 1 - s.c.health / s.c.maxHealth;
      const brave = this.ctx.relations?.enabled ? this.ctx.relations.persona(s.c).brave : 0;
      const mins = (now - op.besieged) / 60;
      const p = Math.min(K.max, K.base[kind] * (1 + K.hurt * hurt) * (1 + K.cops * Math.max(0, onPost - 1)) * (1 + K.time * mins) * (1 - K.brave * Math.max(0, brave)));
      if (this.rng.chance(p)) {
        hb.surrender(s.c, this.ctx);
        this.stats.surrendered++;
      } else if (this.rng.chance(0.4)) s.c.say(this.rng.pick(RESPONSE.lines.reply), this.ctx.law.now + 0.8, 2.5);
    }
  }

  /** Сдавшегося — задержать: следователь группы, иначе ближайший из оцепления. */
  private handleSurrendered(op: Operation): void {
    for (const s of op.suspects.values()) {
      const hb = s.c.brain;
      if (!(hb instanceof HoldoutBrain) || !hb.surrendered || !hb.out) continue;
      const team = op.team;
      if (team && team.phase !== 'rest' && team.phase !== 'return') continue;
      // Ближайший из оцепления.
      let best: Post | null = null;
      for (const p of op.posts) if (p.unit && (!best || Math.hypot(p.unit.x - s.c.x, p.unit.y - s.c.y) < Math.hypot(best.unit!.x - s.c.x, best.unit!.y - s.c.y))) best = p;
      const u = best?.unit;
      // Пост мог выбыть: ранен — мозг больницы (PatientBrain, EvacBrain…), не CpBrain.
      if (!u || !(u.brain instanceof CpBrain)) continue;
      const ub = u.brain;
      if (Math.hypot(u.x - s.c.x, u.y - s.c.y) <= RESPONSE.talk.arrestReach + u.radius) {
        ub.releaseOpPost();
        best!.unit = null;
        this.takeIn(u, s.c);
      } else ub.goArrest(s.c);
    }
  }

  /** Задержать (лежащего — сперва поднять): прежний мозг, наручники, конвой в тюрьму или КПЗ. */
  takeIn(u: Character, s: Character): void {
    const combat = this.ctx.combat;
    const hb = s.brain instanceof HoldoutBrain ? s.brain : null;
    if (hb) hb.finish(s);
    if (s.downed) combat.raise(s, s.maxHealth * 0.25);
    combat.equip(s, null);
    const reason: Violation = s.faction === 'rebel' ? 'rebel' : s.law.wanted || s.hostile ? 'assault' : 'resisting';
    s.hostile = false;
    this.ctx.law.arrest(u, s, reason);
    u.say(this.rng.pick(RESPONSE.lines.take), this.ctx.law.now, 2.5);
    const ub = u.brain;
    if (ub instanceof CpBrain && s.law.phase === 'cuffed') {
      ub.target = s;
      ub.fsm.change('escort');
    }
  }

  /** Закрыть операцию: оцепление снять, группе — домой. */
  private close(op: Operation, why: string): void {
    if (op.closed) return;
    op.closed = true;
    for (const p of op.posts) {
      const b = p.unit?.brain;
      if (b instanceof CpBrain && b.opPost === op.id) b.releaseOpPost();
      p.unit = null;
    }
    for (const u of this.ctx.entities.list) {
      const b = u.brain;
      if (b instanceof CpBrain && b.opPost === op.id) b.releaseOpPost();
    }
    if (op.team && op.team.op === op) {
      const t = op.team;
      if (t.phase !== 'return' && t.phase !== 'rest') this.goHome(t);
      t.op = null;
    }
    for (const s of op.suspects.values()) {
      const hb = s.c.brain;
      if (hb instanceof HoldoutBrain && !hb.surrendered) hb.finish(s.c);
    }
    if (why !== 'red' && why !== 'escaped') this.say(op, 'close', RESPONSE.lines.close, null, true);
  }

  /** Реплика по операции в эфир: от юнита (u) или Надзора (null), один раз на ключ (или каждый раз — always). */
  private say(op: Operation, key: string, lines: readonly string[], u: Character | null, always = false, to: Character[] = []): void {
    if (!always && op.said.has(key)) return;
    op.said.add(key);
    const units = to.map((c) => c.name).join(', ') || 'ближайшие';
    const n = op.team ? String(op.team.id + 1) : '';
    const text = this.rng.pick(lines).replace('{where}', op.where).replace('{units}', units).replace('{n}', n);
    const radio = this.ctx.radio;
    const from = u ?? op.commander;
    if (radio?.enabled) {
      if (u) radio.opLine(u, text);
      else radio.opNadzor(text, to.length ? to : from ? [from] : [], { x: op.x, y: op.y });
    } else if (from) from.say(text, this.ctx.law.now, 3);
  }

  // ───────────────────────────── группы реагирования ─────────────────────────────

  /** Состав групп (бойцы со службой swat по номеру группы; ведущий — первым) и их ход. */
  private updateTeams(dt: number): void {
    for (const t of this.teams) {
      const ms: Character[] = [];
      for (const c of this.ctx.entities.list) {
        const b = c.brain;
        if (c.alive && b instanceof CpBrain && b.duty === 'swat' && b.squad === t.id) ms.push(c);
      }
      ms.sort((a, b) => Number((b.brain as CpBrain).lead) - Number((a.brain as CpBrain).lead) || a.id - b.id);
      t.members = ms;
      if (t.phase !== 'rest') this.runTeam(t, dt);
    }
  }

  /** Боец группы в строю (жив, на ногах, в состоянии swat). */
  private inTeam(c: Character): boolean {
    const b = c.brain;
    return c.alive && c.fit && b instanceof CpBrain && b.fsm.current === 'swat';
  }

  private callTeam(op: Operation, now: number): void {
    let best: Team | null = null;
    let bestD = Infinity;
    for (const t of this.teams) {
      if (t.phase !== 'rest' || now < t.restUntil) continue;
      const fit = t.members.filter((c) => c.fit && (c.brain as CpBrain).fsm.current !== 'retreat');
      if (fit.length < RESPONSE.swat.quorum - 1) continue;
      const d = Math.hypot(fit[0].x - op.x, fit[0].y - op.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) return;
    const t = best;
    t.op = op;
    op.team = t;
    op.stage = 'assault';
    t.phase = 'muster';
    t.t = 0;
    t.losses = 0;
    t.cleared = new Set();
    t.flashed = false;
    t.idx = 0;
    t.sub = 'enter';
    t.arresting = null;
    t.entry = null;
    t.stage = null;
    t.order = [];
    t.roster = [];
    t.plan = null;
    t.axis = 0;
    t.contactAt = -1e9;
    for (const c of t.members) {
      const b = c.brain as CpBrain;
      if (!c.fit || b.fsm.current === 'retreat') continue;
      b.joinSwat();
      t.roster.push(c);
    }
    // Следователь — ближайший свободный SU.01.
    t.investigator = null;
    let inv: Character | null = null;
    let invD: number = RESPONSE.swat.investigatorSeek;
    for (const c of this.ctx.entities.list) {
      const b = c.brain;
      if (c.rank !== CP_UNIT.su1 || !c.fit || !(b instanceof CpBrain) || !this.recruitable(c)) continue;
      const d = Math.hypot(c.x - op.x, c.y - op.y);
      if (d < invD) {
        invD = d;
        inv = c;
      }
    }
    if (inv) {
      t.investigator = inv;
      (inv.brain as CpBrain).joinSwat();
    }
    this.stats.assaults++;
    this.say(op, 'swatCall', RESPONSE.lines.swatCall, null, true, t.members.slice(0, 1));
    const lead = t.members[0];
    if (lead) this.ctx.radio?.opLine(lead, this.rng.pick(RESPONSE.lines.swatAck).replace('{n}', String(t.id + 1)));
  }

  /** Боец видит живого врага (цель его стрелка — на ногах). */
  private contact(c: Character): boolean {
    const g = (c.brain as CpBrain).gunner.target;
    return !!g && g.alive && !g.downed;
  }

  /** Перестрелка на улице: цепью к месту врага, на контакт — бой из укрытий (orderFor: engage). */
  private startSweep(t: Team, lead: Character): void {
    const op = t.op!;
    t.phase = 'sweep';
    t.t = 0;
    t.plan = null;
    t.entry = null;
    t.axis = Math.atan2(op.y - lead.y, op.x - lead.x);
    if (!t.stage) t.stage = { x: lead.x, y: lead.y };
  }

  /** Точка сбора у перестрелки на улице: street.min…max px от места врага, со стороны группы, вне его вида, у стены. */
  private streetStaging(op: Operation, lead: Character): Vec2 {
    const S = RESPONSE.swat.street;
    const { nav, map } = this.ctx;
    const base = Math.atan2(lead.y - op.y, lead.x - op.x);
    const sus = [...op.suspects.values()];
    let best: { p: Vec2; score: number } | null = null;
    for (let k = 0; k < S.samples; k++) {
      // Веером от направления на группу: 0, +15°, −15°, +30°… до ±90°.
      const turn = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / S.samples);
      for (let j = 0; j < 3; j++) {
        const r = S.min + ((S.max - S.min) * j) / 2;
        const a = nav.nearestWalkable(op.x + Math.cos(base + turn) * r, op.y + Math.sin(base + turn) * r, 2);
        if (a < 0) continue;
        const x = nav.worldX(a);
        const y = nav.worldY(a);
        if (this.buildingAt(x, y) >= 0 || map.levelAt(x, y) !== 'city') continue;
        const seen = sus.some((s) => lineOfSight(map, s.x, s.y, x, y));
        const score = (seen ? 0 : 10) + this.walls(x, y) - Math.abs(turn) * 2 - Math.hypot(x - lead.x, y - lead.y) / 400;
        if (!best || score > best.score) best = { p: { x, y }, score };
      }
    }
    return best?.p ?? { x: op.x + Math.cos(base) * S.min, y: op.y + Math.sin(base) * S.min };
  }

  /** Точка сбора: снаружи у входа, вне вида из проёма. */
  private stagingFor(e: Exit): Vec2 {
    const S = RESPONSE.swat.stage;
    const { nav, map } = this.ctx;
    let best: { p: Vec2; score: number } | null = null;
    for (let k = 0; k < 24; k++) {
      const ang = Math.atan2(e.ny, e.nx) + (k % 2 ? 1 : -1) * (40 + 6 * (k >> 1)) * DEG;
      const r = S.min + ((S.max - S.min) * (k % 3)) / 2;
      const a = nav.nearestWalkable(e.door.x + Math.cos(ang) * r, e.door.y + Math.sin(ang) * r, 2);
      if (a < 0) continue;
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      if (this.buildingAt(x, y) >= 0 || map.levelAt(x, y) !== 'city') continue;
      const seenFromDoor = lineOfSight(map, e.inside.x, e.inside.y, x, y);
      const score = (seenFromDoor ? 0 : 5) + this.walls(x, y) - Math.abs(Math.hypot(x - e.door.x, y - e.door.y) - S.min) / 80;
      if (!best || score > best.score) best = { p: { x, y }, score };
    }
    return best?.p ?? e.out;
  }

  /** Ход штурма группы. */
  private runTeam(t: Team, dt: number): void {
    const S = RESPONSE.swat;
    const now = this.ctx.combat.now;
    t.t += dt;
    const op = t.op;
    const active = t.members.filter((c) => this.inTeam(c));
    const lead = active[0] ?? null;
    // Потери: из вышедших на штурм — убит, лежит, отходит раненым.
    const out = t.roster.filter((c) => !c.alive || c.downed || (c.brain instanceof CpBrain && c.brain.fsm.current === 'retreat')).length;
    t.losses = Math.max(t.losses, out);
    if (t.phase === 'return') {
      if (!lead || active.every((c) => this.atRest(c))) this.endTeam(t, now);
      else if (t.t > 90) this.endTeam(t, now);
      return;
    }
    if (!op || op.closed) {
      if (t.phase !== 'done') {
        this.goHome(t);
        return;
      }
    }
    if (!lead) {
      if (op) {
        op.team = null;
        op.stage = 'contain';
        op.tries++;
      }
      this.endTeam(t, now);
      return;
    }
    if ((t.losses >= S.retreatAfter || t.t > S.maxTime) && t.phase !== 'withdraw' && t.phase !== 'done') {
      t.phase = 'withdraw';
      t.t = 0;
      this.stats.retreats++;
      this.ctx.radio?.opLine(lead, this.rng.pick(RESPONSE.lines.retreat).replace('{n}', String(t.id + 1)));
    }
    if ((t.phase === 'stage' || t.phase === 'stack' || t.phase === 'breach' || t.phase === 'clear') && op!.building !== t.plan) {
      // Засевший ушёл из здания: на улице — цепью за ним; засел в другом — заново по плану того.
      if (op!.building) {
        t.phase = 'muster';
        t.t = S.muster;
      } else this.startSweep(t, lead);
    }
    if ((t.phase === 'move' || t.phase === 'stage') && active.some((c) => this.contact(c))) t.contactAt = now;
    switch (t.phase) {
      case 'muster': {
        const close = active.filter((c) => Math.hypot(c.x - lead.x, c.y - lead.y) < 90).length;
        if (close >= Math.min(S.quorum, active.length) || t.t > S.muster) {
          t.phase = 'move';
          t.t = 0;
          t.plan = op!.building;
          if (t.plan) {
            const plan = t.plan;
            // Вход — ближайший к группе выход, где нет огня из проёма (просто ближайший).
            t.entry = plan.exits.reduce((a, q) => (Math.hypot(q.out.x - lead.x, q.out.y - lead.y) < Math.hypot(a.out.x - lead.x, a.out.y - lead.y) ? q : a));
            t.stage = this.stagingFor(t.entry);
            t.order = this.roomOrder(plan, t.entry.room);
          } else {
            // Перестрелка на улице: точка сбора поодаль, вне вида врага (не колонной на стволы).
            t.entry = null;
            t.stage = this.streetStaging(op!, lead);
          }
        }
        break;
      }
      case 'move': {
        // Засевший вышел на улицу или засел в другом здании — заново: точка сбора, вход.
        if ((op!.building ?? null) !== t.plan) {
          t.phase = 'muster';
          t.t = S.muster;
          break;
        }
        // На улице враг уже на виду — сразу бой из укрытий, а не бежать колонной дальше.
        if (!t.plan && active.some((c) => this.contact(c))) {
          this.startSweep(t, lead);
          break;
        }
        const st = t.stage!;
        if (now - t.contactAt < S.contactHold) break;
        if (Math.hypot(lead.x - st.x, lead.y - st.y) < 26 || t.t > S.moveMax) {
          if (t.plan) {
            t.phase = 'stage';
            t.t = 0;
            this.ctx.radio?.opLine(lead, this.rng.pick(RESPONSE.lines.swatStage).replace('{n}', String(t.id + 1)));
          } else this.startSweep(t, lead);
        }
        break;
      }
      case 'stage': {
        const close = active.filter((c) => Math.hypot(c.x - lead.x, c.y - lead.y) < 80).length;
        if (now - t.contactAt < S.contactHold) break;
        if (close >= active.length || t.t > S.stage.wait) {
          t.phase = 'stack';
          t.t = 0;
        }
        break;
      }
      case 'stack': {
        const e = t.entry!;
        const atDoor = Math.hypot(lead.x - e.out.x, lead.y - e.out.y) < 18;
        const stacked = active.filter((c) => Math.hypot(c.x - lead.x, c.y - lead.y) < 70).length;
        if ((atDoor && stacked >= Math.min(3, active.length)) || t.t > 20) {
          t.phase = 'breach';
          t.t = 0;
          lead.say(this.rng.pick(RESPONSE.lines.breach), this.ctx.law.now, 1.5);
          lead.strikeAt = now;
          lead.strikeKind = 'fist';
          lead.strikeAng = Math.atan2(e.door.y - lead.y, e.door.x - lead.x);
        }
        break;
      }
      case 'breach': {
        const e = t.entry!;
        if (t.t >= S.breach && !t.flashed) {
          // Запертую — выбить; открыть.
          const L = this.ctx.locks;
          if (L && e.door.lock >= 0) L.breakDoor(e.door);
          if (e.door.locked) this.ctx.doors.setLocked(e.door, false);
          this.ctx.doors.open(e.door);
          // Светошумовая — внутрь (кто ближе к двери, у кого есть).
          const thrower = active.find((c) => c !== lead && c.inventory.has('flashbang')) ?? (lead.inventory.has('flashbang') ? lead : null);
          if (thrower) {
            const R0 = t.plan!.rooms[e.room];
            const tx = R0 ? (R0.cx + e.inside.x) / 2 : e.inside.x - e.nx * 30;
            const ty = R0 ? (R0.cy + e.inside.y) / 2 : e.inside.y - e.ny * 30;
            if (this.ctx.combat.throwGrenade(thrower, tx, ty, 'flashbang')) {
              thrower.say(this.rng.pick(RESPONSE.lines.flash), this.ctx.law.now, 1.4);
              this.stats.flashes++;
            }
          }
          t.flashed = true;
        }
        if (t.flashed && t.t >= S.breach + S.flashWait) {
          this.stats.entries++;
          t.phase = 'clear';
          t.t = 0;
          t.idx = 0;
          t.sub = 'enter';
          t.quietSince = now;
        }
        break;
      }
      case 'clear':
        this.clearStep(t, active, lead, now);
        break;
      case 'sweep': {
        // Засевшего нет — цепью к последнему месту врага; нашли здание — штурм по плану.
        if (op!.building) {
          t.phase = 'muster';
          t.t = S.muster;
          break;
        }
        if (t.t > S.sweep || this.resolved(op!)) this.finishAssault(t, now);
        break;
      }
      case 'withdraw': {
        const st = t.stage ?? lead;
        if (Math.hypot(lead.x - st.x, lead.y - st.y) < 30 || t.t > 30) {
          if (op) {
            op.team = null;
            op.stage = 'contain';
            op.tries++;
            op.besieged = now;
          }
          this.goHome(t);
        }
        break;
      }
      case 'done':
        this.doneStep(t, now);
        break;
    }
  }

  /** Все подозреваемые операции выбыли (убит, лежит, сдался, задержан). */
  private resolved(op: Operation): boolean {
    for (const s of op.suspects.values()) {
      const c = s.c;
      if (!c.alive || c.downed || c.law.phase !== 'none') continue;
      const hb = c.brain;
      if (hb instanceof HoldoutBrain && hb.surrendered) continue;
      if (!c.hostile) continue;
      return false;
    }
    return true;
  }

  /** Зачистка: к входу в комнату, веером по углам; тихо — «Чисто!», дальше. */
  private clearStep(t: Team, active: Character[], lead: Character, now: number): void {
    const S = RESPONSE.swat;
    const op = t.op!;
    const plan = t.plan!;
    if (this.resolved(op) && t.sub === 'spread' && now - t.quietSince > S.quiet) {
      this.finishAssault(t, now);
      return;
    }
    if (t.idx >= t.order.length) {
      this.finishAssault(t, now);
      return;
    }
    const r = plan.rooms[t.order[t.idx]];
    // Видит ли кто-то из группы живого врага (засевший, вооружённый враг).
    let contact = false;
    for (const c of active) {
      const tg = (c.brain as CpBrain).gunner.target;
      if (tg && tg.alive && !tg.downed) contact = true;
    }
    if (contact) t.quietSince = now;
    if (t.sub === 'enter') {
      const into = this.entryInto(t, plan, r);
      if (Math.hypot(lead.x - into.x, lead.y - into.y) < 20 || t.t > S.room * 0.6) {
        t.sub = 'spread';
        t.t = 0;
        t.quietSince = now;
      }
      return;
    }
    // Веером: тихо quiet с, все внутри — комната чистая.
    const inside = active.filter((c) => this.roomOf(plan, c.x, c.y) === r.id).length;
    if ((now - t.quietSince > S.quiet && (inside >= Math.min(2, active.length) || t.t > S.room * 0.5)) || t.t > S.room) {
      t.cleared.add(r.id);
      this.stats.roomsCleared++;
      lead.say(this.rng.pick(RESPONSE.lines.clearRoom), this.ctx.law.now, 1.4);
      t.idx++;
      t.sub = 'enter';
      t.t = 0;
      t.quietSince = now;
    }
  }

  /** Точка входа в комнату: для первой — вход здания, дальше — дверь из уже зачищенной. */
  private entryInto(t: Team, plan: BuildingPlan, r: Room): Vec2 {
    if (t.idx === 0 || !t.cleared.size) return t.entry!.inside;
    for (const c of t.cleared) {
      const l = plan.rooms[c].links.get(r.id);
      if (l) return l.into;
    }
    const e = plan.exits.find((q) => q.room === r.id);
    return e ? e.inside : { x: r.cx, y: r.cy };
  }

  private finishAssault(t: Team, now: number): void {
    t.phase = 'done';
    t.t = 0;
    const lead = t.members.find((c) => this.inTeam(c));
    if (lead) this.ctx.radio?.opLine(lead, this.rng.pick(RESPONSE.lines.done).replace('{n}', String(t.id + 1)));
    void now;
  }

  /** После штурма: следователь (нет — ведущий) задерживает лежащих и сдавшихся; потом группа — домой. */
  private doneStep(t: Team, now: number): void {
    const op = t.op;
    const inv = t.investigator && this.inTeam(t.investigator) ? t.investigator : null;
    const taker = inv ?? t.members.find((c) => this.inTeam(c)) ?? null;
    if (!op || !taker) {
      this.goHome(t);
      return;
    }
    const left = [...op.suspects.values()].map((s) => s.c).filter((c) => c.alive && c.law.phase === 'none' && (c.downed || !c.hostile || (c.brain instanceof HoldoutBrain && c.brain.surrendered)));
    if (!left.length || t.t > 60) {
      this.goHome(t);
      return;
    }
    const s = t.arresting && left.includes(t.arresting) ? t.arresting : left.reduce((a, b) => (Math.hypot(b.x - taker.x, b.y - taker.y) < Math.hypot(a.x - taker.x, a.y - taker.y) ? b : a));
    t.arresting = s;
    if (Math.hypot(s.x - taker.x, s.y - taker.y) <= RESPONSE.talk.arrestReach + taker.radius) {
      (taker.brain as CpBrain).leaveSwat();
      if (taker === t.investigator) t.investigator = null;
      this.takeIn(taker, s);
      t.arresting = null;
    }
    void now;
  }

  /** Группа — в Управу (колонной), следователь — к своей службе. */
  private goHome(t: Team): void {
    t.phase = 'return';
    t.t = 0;
    if (t.investigator) {
      const b = t.investigator.brain;
      if (b instanceof CpBrain && b.fsm.current === 'swat') b.leaveSwat();
      t.investigator = null;
    }
    t.stage = this.restSpot(t.id, 0);
  }

  private atRest(c: Character): boolean {
    const r = this.restSpotOf(c);
    return !r || Math.hypot(c.x - r.x, c.y - r.y) < 30;
  }

  private endTeam(t: Team, now: number): void {
    t.phase = 'rest';
    t.restUntil = now + RESPONSE.swat.cooldown;
    t.op = null;
    for (const c of t.members) {
      const b = c.brain;
      if (b instanceof CpBrain && b.fsm.current === 'swat') b.leaveSwat();
    }
    if (t.investigator) {
      const b = t.investigator.brain;
      if (b instanceof CpBrain && b.fsm.current === 'swat') b.leaveSwat();
      t.investigator = null;
    }
  }

  /** Группа бойца (или следователя при ней). */
  teamOf(c: Character): Team | null {
    for (const t of this.teams) if (t.phase !== 'rest' && (t.members.includes(c) || t.investigator === c)) return t;
    return null;
  }

  /** Приказ бойцу группы (или следователю при ней) на этот тик. null — группа не в деле (вернуть к службе). */
  orderFor(c: Character): SwatOrder | null {
    const t = this.teamOf(c);
    if (!t) return null;
    const S = RESPONSE.swat;
    const run = CHARACTER.runSpeed * S.run;
    const walkIn = CHARACTER.runSpeed * S.inside;
    const active = t.members.filter((m) => this.inTeam(m));
    const lead = active[0] ?? null;
    const inv = c === t.investigator;
    const k = inv ? active.length : Math.max(0, active.indexOf(c));
    const op = t.op;
    const faceTo = (p: Vec2) => Math.atan2(p.y - c.y, p.x - c.x);
    if (!lead) return null;
    // Подход к зданию под огнём (кто-то в группе видит врага): каждый — в укрытие рядом и отвечает; стихло на
    // contactHold с — дальше колонной.
    if ((t.phase === 'move' || t.phase === 'stage') && !inv && this.ctx.combat.now - t.contactAt < S.contactHold) {
      return { mode: 'engage', x: c.x, y: c.y, speed: walkIn, face: op ? faceTo(op) : c.facing };
    }
    switch (t.phase) {
      case 'muster':
        if (c === lead) return { mode: 'hold', face: op ? faceTo(op) : lead.facing, crouch: false };
        return { mode: 'column', leader: lead, k, speed: run };
      case 'move':
      case 'withdraw':
      case 'return': {
        const st = t.stage ?? lead;
        if (c === lead) return { mode: 'go', x: st.x, y: st.y, speed: t.phase === 'return' ? CHARACTER.walkSpeed : run, face: null, crouch: false };
        if (t.phase === 'return' && !inv) {
          // Своё место — по номеру в группе (как у службы в Управе), а не в строю: выбывшие не сдвигают места.
          const r = this.restSpotOf(c);
          if (r && Math.hypot(lead.x - st.x, lead.y - st.y) < 120) return { mode: 'go', x: r.x, y: r.y, speed: CHARACTER.walkSpeed, face: r.face, crouch: false };
        }
        return { mode: 'column', leader: lead, k, speed: run };
      }
      case 'stage': {
        const e = t.entry!;
        if (c === lead) return { mode: 'hold', face: faceTo(e.door), crouch: true };
        return { mode: 'column', leader: lead, k, speed: run };
      }
      case 'stack':
      case 'breach': {
        const e = t.entry!;
        if (inv) return { mode: 'go', x: t.stage!.x, y: t.stage!.y, speed: run, face: faceTo(e.door), crouch: true };
        if (c === lead) return t.phase === 'stack' ? { mode: 'go', x: e.out.x, y: e.out.y, speed: walkIn, face: faceTo(e.door), crouch: false } : { mode: 'hold', face: faceTo(e.door), crouch: false };
        return { mode: 'column', leader: lead, k, speed: walkIn };
      }
      case 'clear': {
        const plan = t.plan!;
        if (inv) return { mode: 'go', x: t.entry!.out.x, y: t.entry!.out.y, speed: run, face: faceTo(t.entry!.door), crouch: true };
        const r = plan.rooms[t.order[Math.min(t.idx, t.order.length - 1)]];
        if (t.sub === 'enter') {
          const into = this.entryInto(t, plan, r);
          if (c === lead) return { mode: 'go', x: into.x, y: into.y, speed: walkIn, face: Math.atan2(r.cy - into.y, r.cx - into.x), crouch: false };
          return { mode: 'column', leader: lead, k, speed: walkIn };
        }
        const spot = r.spots[k % r.spots.length];
        return { mode: 'go', x: spot.x, y: spot.y, speed: walkIn, face: Math.atan2(r.cy - spot.y, r.cx - spot.x) + (k % 2 ? 0.5 : -0.5), crouch: false };
      }
      case 'sweep': {
        // Следователь — на точке сбора; бойцы — цепью поперёк направления на врага, через spacing px.
        if (inv) return { mode: 'go', x: t.stage?.x ?? c.x, y: t.stage?.y ?? c.y, speed: run, face: op ? faceTo(op) : c.facing, crouch: true };
        const off = (k - (active.length - 1) / 2) * S.street.spacing;
        const ox = op ? op.x : lead.x;
        const oy = op ? op.y : lead.y;
        return { mode: 'engage', x: ox - Math.sin(t.axis) * off, y: oy + Math.cos(t.axis) * off, speed: walkIn, face: t.axis };
      }
      case 'done': {
        if (c === t.arresting) return null;
        const s = t.arresting;
        const taker = t.investigator && this.inTeam(t.investigator) ? t.investigator : lead;
        if (s && c === taker) return { mode: 'go', x: s.x, y: s.y, speed: walkIn, face: faceTo(s), crouch: false };
        return { mode: 'hold', face: op ? faceTo(op) : c.facing, crouch: false };
      }
      default:
        return null;
    }
  }

  // ───────────────────────────── для засевшего ─────────────────────────────

  /** Выход здания без поста (засевший может уйти через него): никто из ВС его не видит ближе escapeClear. */
  openExit(plan: BuildingPlan, self: Character): Exit | null {
    const H = RESPONSE.holdout;
    const map = this.ctx.map;
    for (const e of plan.exits) {
      let watched = false;
      for (const u of this.ctx.entities.near(e.out.x, e.out.y, H.escapeClear, near)) {
        if (u.faction === 'cp' && u.fit && lineOfSight(map, u.x, u.y, e.out.x, e.out.y)) {
          watched = true;
          break;
        }
      }
      if (!watched && Math.hypot(e.inside.x - self.x, e.inside.y - self.y) < 600) return e;
    }
    return null;
  }

  /** Засевший ушёл из здания (побег): операция снова на улице. */
  escaped(c: Character): void {
    const op = this.opOf(c);
    this.stats.escaped++;
    this.seen.set(c, { x: c.x, y: c.y, t: this.ctx.combat.now });
    if (op) {
      op.building = null;
      op.besieged = -1;
      const u = op.posts.find((p) => p.unit)?.unit ?? null;
      if (u) this.ctx.radio?.opLine(u, this.rng.pick(RESPONSE.lines.escape));
    }
  }
}

/** Протекторат (ВС, Легион, комендант) — не враг операции. */
function FACTIONS_AUTH(c: Character): boolean {
  return c.faction === 'cp' || c.faction === 'ota' || c.faction === 'admin';
}
