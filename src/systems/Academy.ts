import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Bullet } from './CombatSystem';
import type { Poi } from '../world/GameMap';
import { ACADEMY, type AcademySession, type CadetRecord } from '../config/academy';
import { CP_UNIT, cpUnit } from '../config/factions';
import { CpBrain } from '../ai/brains/CpBrain';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { CadetBrain } from '../ai/brains/CadetBrain';
import { EnlistBrain } from '../ai/brains/EnlistBrain';
import { equipKit } from './Population';
import { applyPost } from './Staffing';
import { nameFor } from '../entities/factory';
import type { RoleSpec } from './Roster';

/** Место и куда смотреть, px мира. */
export interface Spot {
  x: number;
  y: number;
  facing: number;
}

/** Что сейчас делать курсанту (CadetBrain). */
export type CadetTask =
  | { kind: 'go'; spot: Spot; act?: 'sleep' | 'eat' | 'sit' | 'stand' | 'free'; run?: boolean }
  | { kind: 'lead'; path: readonly Vec2[] }
  | { kind: 'follow'; leader: Character; k: number }
  | { kind: 'loop'; path: readonly Vec2[]; start: number }
  | { kind: 'shoot'; spot: Spot; target: Vec2; lane: number };

/** Прямоугольник помещения, px мира. */
interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Face = 'N' | 'S' | 'E' | 'W';

/** Поворот вектора шаблона (каноническая ориентация — вход внизу) под фасад здания. */
function rot(face: Face, dx: number, dy: number): Vec2 {
  if (face === 'N') return { x: -dx, y: -dy };
  if (face === 'W') return { x: -dy, y: dx };
  if (face === 'E') return { x: dy, y: -dx };
  return { x: dx, y: dy };
}

/**
 * Академия ВС: здание (вахта, плац, тир, класс, кубрик, столовая, кабинет), распорядок занятий, курсанты и
 * инструкторы, набор лоялистов, экзамен и присяга. Занятие идёт для всех сразу: AcademySystem выдаёт каждому
 * курсанту задачу (task — место в строю, на парте, в колонне, на огневом рубеже…), CadetBrain её выполняет;
 * присутствие за занятие — баллы по предмету (ACADEMY.gain). В тире попадания считаются по настоящим пулям.
 */
export class AcademySystem {
  readonly present: boolean;
  /** Прямоугольник здания и помещения, px мира. */
  readonly rect: Area | null = null;
  readonly areas: Partial<Record<'range' | 'office' | 'class' | 'plac' | 'barracks' | 'mess' | 'vakhta' | 'lobby', Area>> = {};
  readonly face: Face = 'S';
  /** Огневые рубежи (место стрелка и его мишень), места ожидания смены. */
  readonly lanes: { spot: Spot; target: Vec2 }[] = [];
  readonly targets: Vec2[] = [];
  readonly waitSpots: Spot[] = [];
  readonly rangeLead: Spot | null = null;
  /** Строй на плацу, место инструктора перед строем, маршрут строевой и круг физо. */
  readonly ranks: Spot[] = [];
  readonly front: Spot | null = null;
  readonly drillLoop: Vec2[] = [];
  readonly ptLoop: Vec2[] = [];
  readonly placCenter: Vec2 | null = null;
  readonly flag: Vec2 | null = null;
  readonly obstacles: Vec2[] = [];
  /** Класс: места за партами, у доски; столовая; кубрик (у каждой койки — два места); кабинет. */
  readonly seats: Spot[] = [];
  /** Класс: где стоят те, кому не хватило парт (у стен). */
  readonly classExtra: Spot[] = [];
  readonly lectern: Spot | null = null;
  readonly board: Vec2[] = [];
  readonly messSeats: Spot[] = [];
  readonly beds: Spot[] = [];
  readonly bunks: Vec2[] = [];
  readonly desk: Spot | null = null;
  /** Вахта: посты вахтёров, турникет, где ждёт заявитель (у стойки дежурного), места дневальных. */
  readonly posts: Spot[] = [];
  readonly turnstile: Vec2 | null = null;
  readonly counter: Vec2 | null = null;
  readonly applySpot: Spot | null = null;
  readonly dutySpots: Spot[] = [];
  readonly barracks: Vec2 | null = null;

  /** Текущее занятие и когда оно кончится; номер в распорядке. */
  session: AcademySession = 'free';
  sessionStart = 0;
  sessionEnd = 0;
  private slot = -1;
  /** Курсанты (живые, с мозгом курсанта или игрок-курсант). */
  cadets: Character[] = [];
  private cadetCheck = 0;
  /** Сколько курсант пробыл на месте занятия за это занятие, с. */
  private readonly present_ = new Map<Character, number>();
  /** Койка курсанта (номер места в кубрике). */
  private readonly bedOf = new Map<Character, number>();
  /** Тир: кто на каком рубеже, сколько выстрелов осталось, когда рубеж освободился. */
  readonly laneHolder: (Character | null)[] = [];
  private readonly laneFree: number[] = [];
  readonly shotsLeft = new Map<Character, number>();
  private readonly seen = new WeakSet<Bullet>();
  /** Заявители по пути на вахту. */
  readonly applicants = new Set<Character>();
  private nextRecruit: number = ACADEMY.recruit.every;
  private nextLine = 0;
  private rollIndex = 0;
  private readonly lastSay = new Map<Character, number>();
  /** Набор (выключают в тестах). */
  recruiting = true;
  readonly stats = { enrolled: 0, graduated: 0, exams: 0, failed: 0, shots: 0, hits: 0, sessions: 0, applied: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const ts = map.tileSize;
    const P = map.poisOf('academy')[0];
    this.present = !!P;
    if (!P) return;
    const face: Face = P.face ?? 'S';
    this.face = face;
    this.rect = { x: P.x * ts, y: P.y * ts, w: (P.w ?? 1) * ts, h: (P.h ?? 1) * ts };
    const area = (t: Poi['type']): Area | undefined => {
      const a = map.poisOf(t)[0];
      return a ? { x: a.x * ts, y: a.y * ts, w: (a.w ?? 1) * ts, h: (a.h ?? 1) * ts } : undefined;
    };
    this.areas = {
      range: area('academy_range'), office: area('academy_office'), class: area('academy_class'), plac: area('academy_plac'),
      barracks: area('academy_barracks'), mess: area('academy_mess'), vakhta: area('academy_vakhta'), lobby: area('academy_lobby'),
    };
    const centre = (p: Poi): Vec2 => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts });
    const anchor = (x: number, y: number, r = 2): Vec2 | null => {
      const a = nav.nearestWalkable(x, y, r);
      return a >= 0 ? { x: nav.worldX(a), y: nav.worldY(a) } : null;
    };
    const diag = rot(face, 1, 1);
    const half = ts / 2;
    const ang = (v: Vec2) => Math.atan2(v.y, v.x);

    // Тир: мишени у дальней стены, рубежи (место стрелка — якорь 2×2 от символа ж), смена ждёт позади.
    for (const p of map.poisOf('academy_target')) this.targets.push(centre(p));
    const toTargets = rot(face, -1, 0);
    for (const p of map.poisOf('academy_lane')) {
      const c = centre(p);
      const a = anchor(c.x + diag.x * half, c.y + diag.y * half, 1);
      if (!a) continue;
      // Своя мишень — та, что ближе всего поперёк линии огня.
      let best = this.targets[0];
      let bd = Infinity;
      for (const t of this.targets) {
        const dx = t.x - a.x;
        const dy = t.y - a.y;
        const across = Math.abs(dx * toTargets.y - dy * toTargets.x);
        if (across < bd) {
          bd = across;
          best = t;
        }
      }
      if (best) this.lanes.push({ spot: { x: a.x, y: a.y, facing: Math.atan2(best.y - a.y, best.x - a.x) }, target: best });
    }
    for (let k = 0; k < this.lanes.length; k++) {
      this.laneHolder.push(null);
      this.laneFree.push(0);
    }
    const rg = this.areas.range;
    if (rg && this.lanes.length) {
      const lx = this.lanes.reduce((s, l) => s + l.spot.x, 0) / this.lanes.length;
      const ly = this.lanes.reduce((s, l) => s + l.spot.y, 0) / this.lanes.length;
      const back = rot(face, 1, 0);
      const behind = (x: number, y: number) => (x - lx) * back.x + (y - ly) * back.y;
      for (const p of this.anchorsIn(rg)) if (behind(p.x, p.y) >= 30) this.waitSpots.push({ x: p.x, y: p.y, facing: ang(toTargets) });
      const lead = anchor(lx + back.x * 40, ly + back.y * 40, 2);
      if (lead) this.rangeLead = { x: lead.x, y: lead.y, facing: ang(toTargets) };
    }

    // Плац: строй в свободной от полосы препятствий части, инструктор перед строем; маршруты строевой и физо.
    const pl = this.areas.plac;
    for (const p of map.poisOf('academy_obstacle')) this.obstacles.push(centre(p));
    const fl = map.poisOf('academy_flag')[0];
    if (fl) this.flag = centre(fl);
    if (pl) {
      const cx = pl.x + pl.w / 2;
      const cy = pl.y + pl.h / 2;
      this.placCenter = { x: cx, y: cy };
      // Свободная часть — дальше от полосы препятствий (вдоль длинной оси плаца).
      const along = rot(face, 1, 0);
      const long = Math.abs(along.x) > 0.5 ? pl.w : pl.h;
      const fc = { x: cx - along.x * long * 0.16, y: cy - along.y * long * 0.16 };
      const F = ACADEMY.formation;
      const row = rot(face, 1, 0);
      const file = rot(face, 0, 1);
      const facing = ang(rot(face, 0, -1));
      const cap = ACADEMY.recruit.capacity;
      const rows = Math.ceil(cap / F.rows);
      for (let k = 0; k < cap; k++) {
        const r = Math.floor(k / F.rows);
        const col = k % F.rows;
        const x = fc.x + (col - (F.rows - 1) / 2) * F.gap * row.x + (r - (rows - 1) / 2) * F.gap * file.x;
        const y = fc.y + (col - (F.rows - 1) / 2) * F.gap * row.y + (r - (rows - 1) / 2) * F.gap * file.y;
        const a = anchor(x, y, 2);
        if (a) this.ranks.push({ x: a.x, y: a.y, facing });
      }
      const fr = anchor(fc.x - file.x * (F.front + ((rows - 1) * F.gap) / 2), fc.y - file.y * (F.front + ((rows - 1) * F.gap) / 2), 2);
      if (fr) this.front = { x: fr.x, y: fr.y, facing: ang(file) };
      // Строевая — прямоугольник вокруг места строя; физо — круг по всему плацу.
      const D = ACADEMY.drill;
      const hx = long * 0.3;
      const hy = (Math.abs(along.x) > 0.5 ? pl.h : pl.w) / 2 - D.inset * ts;
      for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const a = anchor(fc.x + along.x * hx * sa + file.x * hy * sb, fc.y + along.y * hx * sa + file.y * hy * sb, 2);
        if (a) this.drillLoop.push(a);
      }
      const ins = ACADEMY.pt.inset * ts + 16;
      for (const [x, y] of [[pl.x + ins, pl.y + ins], [pl.x + pl.w - ins, pl.y + ins], [pl.x + pl.w - ins, pl.y + pl.h - ins], [pl.x + ins, pl.y + pl.h - ins]]) {
        const a = anchor(x, y, 2);
        if (a) this.ptLoop.push(a);
      }
      for (const p of this.anchorsIn(pl)) {
        if (Math.hypot(p.x - cx, p.y - cy) > Math.min(pl.w, pl.h) * 0.42 && !this.obstacles.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 40)) this.dutySpots.push({ x: p.x, y: p.y, facing: this.ctx.rng.range(0, Math.PI * 2) });
      }
    }

    // Класс: места за партами (с дальней от доски стороны), место преподавателя у доски.
    for (const p of map.poisOf('academy_board')) this.board.push(centre(p));
    const away = rot(face, 0, 1);
    const seen = new Set<string>();
    for (const p of map.poisOf('academy_desk')) {
      const c = centre(p);
      const a = anchor(c.x + away.x * ts, c.y + away.y * ts, 1);
      if (!a) continue;
      const key = `${a.x},${a.y}`;
      if (seen.has(key)) continue;
      // Место — сразу за партой (не в проходе сбоку).
      if (Math.abs((a.x - c.x) * away.y - (a.y - c.y) * away.x) > ts * 1.1) continue;
      seen.add(key);
      this.seats.push({ x: a.x, y: a.y, facing: ang(rot(face, 0, -1)) });
    }
    const cl = this.areas.class;
    if (cl) for (const p of this.anchorsIn(cl)) if (!this.seats.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 24)) this.classExtra.push({ x: p.x, y: p.y, facing: ang(rot(face, 0, -1)) });
    const lec = map.poisOf('academy_lectern')[0];
    if (lec) {
      const c = centre(lec);
      const a = anchor(c.x, c.y, 2);
      if (a) this.lectern = { x: a.x, y: a.y, facing: ang(away) };
    }

    // Столовая: места вокруг столов.
    const mseen = new Set<string>();
    for (const p of map.poisOf('academy_table')) {
      const c = centre(p);
      for (const [dx, dy] of [[0, 1.5], [0, -1.5], [1.5, 0], [-1.5, 0]]) {
        const a = anchor(c.x + dx * ts, c.y + dy * ts, 0);
        if (!a) continue;
        const key = `${a.x},${a.y}`;
        if (mseen.has(key)) continue;
        mseen.add(key);
        this.messSeats.push({ x: a.x, y: a.y, facing: Math.atan2(c.y - a.y, c.x - a.x) });
      }
    }

    // Кубрик: у каждой двухъярусной койки (2×2) — два места рядом.
    for (const p of map.poisOf('academy_bunk')) {
      const c = centre(p);
      const bx = c.x + diag.x * half;
      const by = c.y + diag.y * half;
      this.bunks.push({ x: bx, y: by });
      const near: Vec2[] = [];
      for (let r = 1; r <= 3 && near.length < 2; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const ax = Math.round(bx / ts) - 1 + dx;
            const ay = Math.round(by / ts) - 1 + dy;
            if (!nav.isWalkable(ax, ay)) continue;
            const q = { x: (ax + 1) * ts, y: (ay + 1) * ts };
            if (near.some((n) => n.x === q.x && n.y === q.y) || this.beds.some((b) => b.x === q.x && b.y === q.y)) continue;
            near.push(q);
          }
        }
        near.sort((a, b) => Math.hypot(a.x - bx, a.y - by) - Math.hypot(b.x - bx, b.y - by));
      }
      for (const q of near.slice(0, 2)) this.beds.push({ x: q.x, y: q.y, facing: Math.atan2(by - q.y, bx - q.x) });
    }
    const bk = this.areas.barracks;
    if (bk) this.barracks = anchor(bk.x + bk.w / 2, bk.y + bk.h / 2, 3);

    // Кабинет начальника курса.
    const hd = map.poisOf('academy_head_desk');
    if (hd.length) {
      const c = hd.map(centre).reduce((s, v) => ({ x: s.x + v.x / hd.length, y: s.y + v.y / hd.length }), { x: 0, y: 0 });
      const a = anchor(c.x - away.x * ts * 1.5, c.y - away.y * ts * 1.5, 1);
      if (a) this.desk = { x: a.x, y: a.y, facing: ang(away) };
    }

    // Вахта: посты вахтёров (лицом к входу), турникет, место заявителя у стойки дежурного.
    for (const p of map.poisOf('academy_post')) {
      const c = centre(p);
      const a = anchor(c.x + diag.x * half, c.y + diag.y * half, 1);
      if (a) this.posts.push({ x: a.x, y: a.y, facing: ang(away) });
    }
    const tt = map.poisOf('academy_turnstile');
    if (tt.length) this.turnstile = tt.map(centre).reduce((s, v) => ({ x: s.x + v.x / tt.length, y: s.y + v.y / tt.length }), { x: 0, y: 0 });
    const cn = map.poisOf('academy_counter');
    if (cn.length) {
      this.counter = cn.map(centre).reduce((s, v) => ({ x: s.x + v.x / cn.length, y: s.y + v.y / cn.length }), { x: 0, y: 0 });
      const a = anchor(this.counter.x + away.x * ts * 1.5, this.counter.y + away.y * ts * 1.5, 2);
      if (a) this.applySpot = { x: a.x, y: a.y, facing: Math.atan2(this.counter.y - a.y, this.counter.x - a.x) };
    }
    this.sessionEnd = 0;
  }

  /** Проходимые якоря (центры) в прямоугольнике. */
  private anchorsIn(r: Area): Vec2[] {
    const { nav } = this.ctx;
    const ts = this.ctx.map.tileSize;
    const out: Vec2[] = [];
    for (let ay = Math.floor(r.y / ts); ay < Math.ceil((r.y + r.h) / ts) - 1; ay++) {
      for (let ax = Math.floor(r.x / ts); ax < Math.ceil((r.x + r.w) / ts) - 1; ax++) {
        if (nav.isWalkable(ax, ay)) out.push({ x: (ax + 1) * ts, y: (ay + 1) * ts });
      }
    }
    return out;
  }

  /** Точка в здании академии? */
  inside(x: number, y: number): boolean {
    const r = this.rect;
    return !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  inArea(a: keyof AcademySystem['areas'], x: number, y: number): boolean {
    const r = this.areas[a];
    return !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  /** Инструкторы академии (живые). */
  instructors(): Character[] {
    return this.ctx.entities.list.filter((c) => c.alive && c.faction === 'cp' && cpUnit(c.rank).unit === 'instr' && c.role?.kind === 'instructor');
  }

  /** Усиленный набор: вакансий RCT много или штат ВС поредел. */
  urgent(): boolean {
    const S = this.ctx.staffing;
    if (!S) return false;
    const R = ACADEMY.recruit;
    return S.vacancies('rct').length >= R.urgentVacancies || S.staffed < R.urgentStaff;
  }

  /** Ночь — курсанты спят (если распорядок дня включён). */
  private sleepTime(): boolean {
    const r = this.ctx.routine;
    if (!r?.enabled) return false;
    const h = r.hour();
    const [a, b] = ACADEMY.sleep;
    return a > b ? h >= a || h < b : h >= a && h < b;
  }

  update(dt: number): void {
    if (!this.present) return;
    const now = this.ctx.law.now;
    if (now >= this.cadetCheck) {
      this.cadetCheck = now + 1;
      this.cadets = this.ctx.entities.list.filter((c) => c.alive && c.faction === 'cp' && c.cadet !== null && (c.isPlayer || c.brain instanceof CadetBrain));
      this.cadets.sort((a, b) => a.id - b.id);
      for (const c of this.cadets) if (!this.bedOf.has(c)) this.bedOf.set(c, this.freeBed());
      for (const c of [...this.bedOf.keys()]) if (!c.alive || !c.cadet) this.bedOf.delete(c);
    }
    this.recruit(now);
    if (now >= this.sessionEnd) this.nextSession(now);
    this.attend(dt, now);
    if (this.session === 'range') this.rangeTick(now);
    this.scoreBullets();
    this.talk(now);
  }

  private freeBed(): number {
    const used = new Set(this.bedOf.values());
    for (let k = 0; k < this.beds.length; k++) if (!used.has(k)) return k;
    return this.beds.length ? this.ctx.rng.int(0, this.beds.length - 1) : -1;
  }

  // ————— Распорядок —————

  private nextSession(now: number): void {
    this.finishSession();
    let next: AcademySession;
    let len: number;
    if (this.sleepTime()) {
      next = 'sleep';
      len = 20;
    } else {
      this.slot = (this.slot + 1) % ACADEMY.schedule.length;
      // Ускоренный курс (нехватка штата): без личного времени.
      if (ACADEMY.schedule[this.slot][0] === 'free' && this.urgent()) this.slot = (this.slot + 1) % ACADEMY.schedule.length;
      [next, len] = ACADEMY.schedule[this.slot];
    }
    const was = this.session;
    this.session = next;
    this.sessionStart = now;
    this.sessionEnd = now + len;
    this.present_.clear();
    this.rollIndex = 0;
    this.nextLine = now + 3;
    this.stats.sessions++;
    if (next === 'range') {
      this.shotsLeft.clear();
      for (const c of this.cadets) this.shotsLeft.set(c, ACADEMY.range.shots);
      for (let k = 0; k < this.laneHolder.length; k++) {
        this.laneHolder[k] = null;
        this.laneFree[k] = now + 8;
      }
    }
    for (const c of this.cadets) c.asleep = false;
    // Инструкторы — на места занятия.
    for (const i of this.instructors()) if (i.brain instanceof CpBrain) i.brain.nextDuty();
    const lead = this.instructors()[0];
    const L = ACADEMY.lines;
    const call = next === 'formation' ? L.formationCall : next === 'range' ? L.rangeCall : next === 'sleep' ? (was !== 'sleep' ? L.sleep : null) : next === 'pt' ? L.pt : next === 'meal' ? L.meal : null;
    if (lead && call) lead.say(this.ctx.rng.pick(call), this.ctx.law.now, 3);
    // Присяга сдавших экзамен — в начале построения.
    if (next === 'formation') for (const c of this.cadets) if (c.cadet?.passed) this.graduate(c);
  }

  /** Конец занятия: баллы по присутствию, экзамен у готовых. */
  private finishSession(): void {
    const s = this.session;
    const len = Math.max(1, this.sessionEnd - this.sessionStart);
    const gain = ACADEMY.gain[s];
    const mul = this.urgent() ? ACADEMY.recruit.urgentMul : 1;
    for (const c of this.cadets) {
      const r = c.cadet;
      if (!r) continue;
      const frac = Math.min(1, (this.present_.get(c) ?? 0) / (len * 0.6));
      if (gain && s !== 'range') for (const [k, v] of Object.entries(gain) as [keyof CadetRecord & string, number][]) (r[k] as number) += v * frac * mul;
      if (s === 'range') {
        const fired = ACADEMY.range.shots - (this.shotsLeft.get(c) ?? ACADEMY.range.shots);
        r.fire += (gain?.fire ?? 1) * (fired / ACADEMY.range.shots) * mul;
      }
      if (s === 'meal' && frac > 0.3) c.hunger = Math.max(c.hunger, 95);
    }
    // Набрал баллы по всем предметам — экзамен сразу после занятия (а не только после класса: курс короче на круг).
    if (s !== 'sleep' && this.instructors().length) for (const c of this.cadets) if (c.cadet && !c.cadet.passed && this.ready(c.cadet)) this.examine(c);
  }

  /** Набрал баллы по всем предметам. */
  ready(r: CadetRecord): boolean {
    const N = ACADEMY.exam.need;
    return r.drill >= N.drill && r.fitness >= N.fitness && r.theory >= N.theory && r.fire >= N.fire;
  }

  /** Экзамен: точность в тире не ниже нормы — сдал; иначе — недобор урезается, пересдача. */
  examine(c: Character): void {
    const r = c.cadet!;
    const E = ACADEMY.exam;
    r.exams++;
    this.stats.exams++;
    const lead = this.instructors()[0];
    if (lead) lead.say(this.ctx.rng.pick(ACADEMY.lines.exam), this.ctx.law.now, 2.5);
    if (r.accuracy >= E.accuracy) {
      r.passed = true;
      c.say(this.ctx.rng.pick(ACADEMY.lines.passed), this.ctx.law.now, 2.5);
      this.ctx.law.log(`Академия ВС: экзамен сдан — курсант ${c.name} (точность ${Math.round(r.accuracy * 100)}%), присяга на построении.`, 'world');
    } else {
      r.fire *= E.fail;
      this.stats.failed++;
      c.say(this.ctx.rng.pick(ACADEMY.lines.failed), this.ctx.law.now, 2.5);
      if (c.isPlayer) this.ctx.law.log(`Академия: экзамен не сдан — точность ${Math.round(r.accuracy * 100)}% (нужно ${Math.round(E.accuracy * 100)}%). Больше стрельб — и пересдача.`, 'world');
    }
  }

  /** Присутствие на месте занятия — копится каждый тик. */
  private attend(dt: number, now: number): void {
    for (const c of this.cadets) {
      const t = this.task(c);
      let ok = false;
      if (t.kind === 'go' || t.kind === 'shoot') ok = Math.hypot(c.x - t.spot.x, c.y - t.spot.y) < 40;
      else ok = this.inArea('plac', c.x, c.y);
      if (ok) this.present_.set(c, (this.present_.get(c) ?? 0) + dt);
      // Спит у своей койки.
      c.asleep = this.session === 'sleep' && ok && t.kind === 'go' && t.act === 'sleep';
    }
    void now;
  }

  // ————— Задачи курсантов —————

  private orderOf(c: Character): number {
    const k = this.cadets.indexOf(c);
    return k >= 0 ? k : 0;
  }

  /** Что сейчас делать курсанту. */
  task(c: Character): CadetTask {
    const k = this.orderOf(c);
    const pick = (list: readonly Spot[], i = k): Spot | null => (list.length ? list[i % list.length] : null);
    const bed = this.beds.length ? this.beds[Math.max(0, this.bedOf.get(c) ?? k) % this.beds.length] : null;
    const fallback: Spot = bed ?? (this.barracks ? { ...this.barracks, facing: 0 } : { x: c.x, y: c.y, facing: c.facing });
    switch (this.session) {
      case 'formation': {
        const s = pick(this.ranks);
        return s ? { kind: 'go', spot: s, act: 'stand' } : { kind: 'go', spot: fallback };
      }
      case 'drill': {
        if (this.drillLoop.length < 2) return { kind: 'go', spot: pick(this.ranks) ?? fallback };
        const leader = this.cadets.find((o) => !o.isPlayer && this.inArea('plac', o.x, o.y)) ?? this.cadets.find((o) => !o.isPlayer);
        if (!leader || leader === c) return { kind: 'lead', path: this.drillLoop };
        return { kind: 'follow', leader, k: Math.max(1, k - this.cadets.indexOf(leader) + (k < this.cadets.indexOf(leader) ? this.cadets.length : 0)) };
      }
      case 'pt':
        return this.ptLoop.length > 1 ? { kind: 'loop', path: this.ptLoop, start: k % this.ptLoop.length } : { kind: 'go', spot: fallback };
      case 'range': {
        const lane = this.laneHolder.indexOf(c);
        if (lane >= 0) return { kind: 'shoot', spot: this.lanes[lane].spot, target: this.lanes[lane].target, lane };
        const w = pick(this.waitSpots);
        return { kind: 'go', spot: w ?? fallback, act: 'stand' };
      }
      case 'class': {
        const s = k < this.seats.length ? this.seats[k] : pick(this.classExtra.length ? this.classExtra : this.seats, k - this.seats.length);
        return { kind: 'go', spot: s ?? fallback, act: 'sit' };
      }
      case 'meal': {
        const s = pick(this.messSeats);
        return { kind: 'go', spot: s ?? fallback, act: 'eat' };
      }
      case 'sleep':
        return { kind: 'go', spot: fallback, act: 'sleep' };
      default: {
        // Личное время: кто у своей койки, кто на плацу.
        if (k % 3 === 2 && this.dutySpots.length) return { kind: 'go', spot: this.dutySpots[(k * 7) % this.dutySpots.length], act: 'free' };
        return { kind: 'go', spot: fallback, act: 'free' };
      }
    }
  }

  /** Тир: свободный рубеж — следующему из смены (не раньше shiftGap с после прошлого стрелка). */
  private rangeTick(now: number): void {
    const R = ACADEMY.range;
    for (let k = 0; k < this.laneHolder.length; k++) {
      const h = this.laneHolder[k];
      if (h && (!h.alive || !h.cadet || (this.shotsLeft.get(h) ?? 0) <= 0)) {
        this.laneHolder[k] = null;
        this.laneFree[k] = now + R.shiftGap;
        if (h.alive && !h.isPlayer) this.ctx.combat.equip(h, null);
      }
      if (this.laneHolder[k] || now < this.laneFree[k]) continue;
      const next = this.cadets.find((c) => (this.shotsLeft.get(c) ?? 0) > 0 && !this.laneHolder.includes(c) && this.inArea('range', c.x, c.y));
      if (!next) continue;
      this.laneHolder[k] = next;
      // Патроны на стрельбы — от академии.
      if (next.inventory.count('ammo_pistol') < R.shots * 2) next.inventory.add('ammo_pistol', R.shots * 2);
      if (k === 0) this.instructors()[0]?.say(this.ctx.rng.pick(ACADEMY.lines.rangeCall), now, 2.5);
    }
  }

  /** Попадания в тире — по настоящим пулям курсантов: луч проходит у мишени ближе hitRadius. */
  private scoreBullets(): void {
    if (this.session !== 'range' || !this.targets.length) return;
    for (const b of this.ctx.combat.bullets) {
      if (this.seen.has(b)) continue;
      this.seen.add(b);
      const c = b.shooter;
      if (!c?.cadet || !this.inArea('range', c.x, c.y)) continue;
      const left = this.shotsLeft.get(c) ?? 0;
      if (left <= 0) continue;
      this.shotsLeft.set(c, left - 1);
      let hit = false;
      for (const t of this.targets) {
        const px = t.x - b.ox;
        const py = t.y - b.oy;
        const along = px * b.dx + py * b.dy;
        if (along <= 0 || b.end < along - 20) continue;
        if (Math.abs(px * b.dy - py * b.dx) <= ACADEMY.range.hitRadius) hit = true;
      }
      const r = c.cadet;
      r.shots++;
      if (hit) r.hits++;
      r.accuracy = r.hits / r.shots;
      this.stats.shots++;
      if (hit) this.stats.hits++;
      if (this.ctx.rng.chance(0.25)) c.say(this.ctx.rng.pick(hit ? ACADEMY.lines.rangeHit : ACADEMY.lines.rangeMiss), this.ctx.law.now, 1.5);
    }
  }

  /** Реплики занятия: команды инструктора, перекличка, вопросы на уроке. */
  private talk(now: number): void {
    if (now < this.nextLine) return;
    const L = ACADEMY.lines;
    const rng = this.ctx.rng;
    const lead = this.instructors()[0];
    this.nextLine = now + rng.range(4, 8);
    const say = (c: Character | undefined, lines: readonly string[], t = 2.5) => {
      if (!c || now - (this.lastSay.get(c) ?? -1e9) < 3) return;
      this.lastSay.set(c, now);
      c.say(rng.pick(lines), now, t);
    };
    const anyCadet = () => (this.cadets.length ? rng.pick(this.cadets.filter((c) => !c.isPlayer).length ? this.cadets.filter((c) => !c.isPlayer) : this.cadets) : undefined);
    switch (this.session) {
      case 'formation': {
        // Перекличка: инструктор называет фамилию, курсант отвечает.
        this.nextLine = now + ACADEMY.formation.rollCallEvery;
        const c = this.cadets[this.rollIndex++ % Math.max(1, this.cadets.length)];
        if (lead && c && this.rollIndex <= this.cadets.length) {
          lead.say(rng.pick(L.rollCall).replace('{name}', c.name.split(' ').pop() ?? c.name), now, 1.8);
          if (!c.isPlayer) c.say(rng.pick(L.rollAnswer), now, 1.5);
        } else say(lead, L.formation, 3);
        break;
      }
      case 'drill':
        say(lead, L.drill, 2);
        if (rng.chance(0.3)) say(anyCadet(), L.drillCadet, 1.5);
        break;
      case 'range':
        say(lead, L.rangeInstructor, 2.5);
        break;
      case 'class':
        say(lead, L.lecture, 4);
        if (rng.chance(0.35)) say(anyCadet(), L.question, 2);
        break;
      case 'pt':
        say(lead, L.pt, 2);
        if (rng.chance(0.4)) say(anyCadet(), L.ptCadet, 1.5);
        break;
      case 'free':
        if (rng.chance(0.5)) say(anyCadet(), L.free, 3);
        break;
      default:
        break;
    }
  }

  // ————— Инструкторы —————

  /** Место инструктора на этом занятии (CpBrain.nextDuty у службы instructor). */
  dutyFor(c: Character): { spot: Spot | null; hold: number } {
    const list = this.instructors();
    const lead = list.indexOf(c) <= 0;
    const s = this.session;
    const hold = Math.max(2, this.sessionEnd - this.ctx.law.now);
    const centre = this.placCenter ? { x: this.placCenter.x, y: this.placCenter.y, facing: 0 } : null;
    const near = (p: Spot | null, d: number): Spot | null => {
      if (!p) return null;
      const a = this.ctx.nav.nearestWalkable(p.x + Math.cos(p.facing + Math.PI / 2) * d, p.y + Math.sin(p.facing + Math.PI / 2) * d, 2);
      return a >= 0 ? { x: this.ctx.nav.worldX(a), y: this.ctx.nav.worldY(a), facing: p.facing } : p;
    };
    if (lead) {
      switch (s) {
        case 'formation': return { spot: this.front, hold };
        case 'drill':
        case 'pt': return { spot: centre ? { ...(this.anchorNear(centre) ?? centre), facing: 0 } : this.front, hold };
        case 'range': return { spot: this.rangeLead, hold };
        case 'class': return { spot: this.lectern, hold };
        case 'meal': return { spot: this.messSeats.length ? near(this.messSeats[0], 40) : this.desk, hold };
        default: return { spot: this.desk, hold };
      }
    }
    // Второй инструктор: на стрельбах — у смены, на построении — сбоку строя, иначе — кабинет и вахта.
    switch (s) {
      case 'range': return { spot: this.waitSpots.length ? this.waitSpots[this.waitSpots.length - 1] : this.rangeLead, hold };
      case 'formation': return { spot: near(this.front, 70), hold };
      case 'sleep':
      case 'free': return { spot: this.posts.length ? near(this.posts[0], -32) : this.desk, hold };
      default: return { spot: this.desk ? near(this.desk, 40) : null, hold };
    }
  }

  private anchorNear(p: Vec2): Vec2 | null {
    const a = this.ctx.nav.nearestWalkable(p.x, p.y, 3);
    return a >= 0 ? { x: this.ctx.nav.worldX(a), y: this.ctx.nav.worldY(a) } : null;
  }

  // ————— Набор, зачисление, присяга —————

  /** Набор сейчас (тесты): следующий раз — без ожидания. */
  recruitNow(): Character | null {
    this.nextRecruit = 0;
    const before = new Set(this.applicants);
    this.recruit(this.ctx.law.now);
    for (const a of this.applicants) if (!before.has(a)) return a;
    return null;
  }

  private recruit(now: number): void {
    if (now < this.nextRecruit) return;
    const R = ACADEMY.recruit;
    this.nextRecruit = now + R.every;
    if (!this.recruiting || this.ctx.war.code === 'red') return;
    for (const a of [...this.applicants]) if (!a.alive || !(a.brain instanceof EnlistBrain)) this.applicants.delete(a);
    const urgent = this.urgent();
    const reserve = this.ctx.staffing?.reserve.length ?? 0;
    if (reserve >= R.reserveMax) return;
    if (this.cadets.length + this.applicants.size >= (urgent ? R.capacity : R.target)) return;
    const min = urgent ? R.urgentLoyalty : R.minLoyalty;
    const pool = this.ctx.entities.list.filter(
      (c) => !c.isPlayer && c.alive && c.fit && c.faction === 'citizen' && c.profession === 'citizen' && c.loyalty >= min && !c.law.wanted &&
        c.law.hasCid && c.law.phase === 'none' && c.brain instanceof CitizenBrain && c.gang < 0 && this.ctx.map.levelAt(c.x, c.y) === 'city' && !this.ctx.brawls?.fighting(c),
    );
    if (!pool.length) return;
    const c = this.ctx.rng.pick(pool);
    this.applicants.add(c);
    this.stats.applied++;
    c.brain = new EnlistBrain(c.brain, now + R.walkMax);
    this.ctx.law.log(`Академия ВС: направление на учёбу${urgent ? ' (усиленный набор)' : ''} — ${c.name}.`, 'world');
  }

  /** Место у стойки дежурного вахты (заявитель). */
  get applyAt(): Spot | null {
    return this.applySpot;
  }

  /** Зачислить курсантом (гражданин у стойки вахты; игрок — E). */
  enroll(c: Character): boolean {
    if (!this.present || c.faction !== 'citizen') return false;
    this.applicants.delete(c);
    const ctx = this.ctx;
    ctx.housing?.evict(c);
    ctx.law.vacate(c);
    const money = c.money;
    const frac = c.maxHealth > 0 ? c.health / c.maxHealth : 1;
    c.faction = 'cp';
    c.rank = CP_UNIT.cdt;
    c.division = 'pcu';
    c.profession = null;
    c.disguised = false;
    c.cover = null;
    c.hostile = false;
    equipKit(c, 'cadet', ctx);
    ctx.combat.equip(c, null);
    c.money = money;
    const hp = cpUnit(c.rank).hp;
    c.maxHealth = hp;
    c.health = Math.max(1, Math.round(hp * frac));
    c.law.hasCid = true;
    c.law.wanted = false;
    c.cadet = { drill: 0, fitness: 0, theory: 0, fire: 0, accuracy: 0, shots: 0, hits: 0, since: ctx.law.now, passed: false, exams: 0 };
    c.merit = 0;
    c.serviceSince = ctx.law.now;
    c.role = { kind: 'cadet', faction: 'cp', profession: null, division: 'pcu', rank: CP_UNIT.cdt, kit: 'cadet', name: c.name, loyalty: c.loyalty };
    if (!c.isPlayer) c.brain = new CadetBrain(c, ctx);
    this.bedOf.set(c, this.freeBed());
    this.cadetCheck = 0;
    this.stats.enrolled++;
    const head = this.instructors()[0];
    if (head) head.say(ctx.rng.pick(ACADEMY.lines.enrolled), ctx.law.now, 3);
    ctx.law.log(`Академия ВС: новый курсант — ${c.name}.`, 'world');
    if (c.isPlayer) ctx.bus.emit('enlisted', { who: c });
    return true;
  }

  /** Присяга: курсант — RCT.PCU с позывным; должность RCT свободна — на неё, иначе в резерв академии. */
  graduate(c: Character): void {
    const ctx = this.ctx;
    if (!c.cadet) return;
    c.cadet = null;
    c.asleep = false;
    const civil = c.name;
    c.name = nameFor(ctx.rng, 'cp');
    c.merit = 0;
    c.serviceSince = ctx.law.now;
    c.say(ctx.rng.pick(ACADEMY.lines.oath), ctx.law.now, 3);
    this.stats.graduated++;
    const S = ctx.staffing;
    const slot = S?.bestVacancy('rct') ?? null;
    if (S && slot) {
      // Звание RCT — до назначения (Staffing пишет «назначен» на ту же должность).
      c.rank = CP_UNIT.rct;
      S.assign(c, slot, false);
    } else {
      const spot = this.dutySpots.length ? ctx.rng.pick(this.dutySpots) : this.posts[0] ?? { x: c.x, y: c.y, facing: 0 };
      const spec: RoleSpec = { kind: 'reserve', faction: 'cp', profession: null, division: 'pcu', rank: CP_UNIT.rct, kit: 'cp', post: { x: spot.x, y: spot.y }, facing: spot.facing };
      applyPost(ctx, c, spec);
      S?.toReserve(c);
    }
    ctx.law.log(`Присяга в Академии ВС: курсант ${civil} — теперь RCT.PCU ${c.name}${slot ? '' : ' (в резерве академии)'}.`, 'world');
    if (c.isPlayer) ctx.bus.emit('graduated', { who: c, rank: c.rank, name: c.name });
  }

  /** Подсказка игроку-курсанту: где сейчас занятие и что делать. */
  hint(c: Character): { text: string; at: Vec2 | null } | null {
    if (!c.cadet || !this.present) return null;
    const t = this.task(c);
    const left = Math.max(0, Math.round(this.sessionEnd - this.ctx.law.now));
    const names: Record<AcademySession, string> = {
      formation: 'Построение на плацу — встаньте в строй', drill: 'Строевая на плацу — в колонну за направляющим', range: 'Стрельбы в тире', class: 'Занятие в классе — за парту',
      pt: 'Физподготовка — бегом по кругу плаца', meal: 'Обед в столовой', free: 'Личное время', sleep: 'Отбой — к своей койке',
    };
    let text = `${names[this.session]} (${left} с)`;
    if (t.kind === 'shoot') text = `Огневой рубеж: стреляйте по своей мишени — осталось ${this.shotsLeft.get(c) ?? 0}`;
    else if (this.session === 'range') text = `Стрельбы: ждите смены в тире (${this.shotsLeft.get(c) ?? 0} выстр.)`;
    const r = c.cadet;
    const N = ACADEMY.exam.need;
    text += ` · строевая ${r.drill.toFixed(1)}/${N.drill}, физо ${r.fitness.toFixed(1)}/${N.fitness}, теория ${r.theory.toFixed(1)}/${N.theory}, стрельбы ${r.fire.toFixed(1)}/${N.fire}, точность ${Math.round(r.accuracy * 100)}%`;
    const at = t.kind === 'go' || t.kind === 'shoot' ? t.spot : this.placCenter;
    return { text, at };
  }
}
