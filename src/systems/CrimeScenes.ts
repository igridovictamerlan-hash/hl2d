import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Corpse } from './CombatSystem';
import { CRIME } from '../config/crime';
import { FACTIONS, CP_UNIT } from '../config/factions';
import { WEAPONS } from '../config/items';
import { T } from '../world/tiles';
import { CpBrain } from '../ai/brains/CpBrain';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { ExamineBrain } from '../ai/brains/ExamineBrain';

/** Вид места преступления: убит сотрудник ВС или гражданский. */
export type SceneKind = 'cp' | 'civil';

/**
 * Линия оцепления поперёк одного прохода: ломаная от стены до стены. Узкий проход — лента между
 * стенами; широкий (улица, проспект) — ряд переносных барьеров (barrier).
 */
export interface CordonLine {
  pts: Vec2[];
  barrier: boolean;
}

/** Место преступления: тело в городе, проходы к нему перекрыты лентой или барьерами. */
export interface CrimeScene {
  kind: SceneKind;
  /** Первое тело; все тела зоны — bodies (близкие происшествия сливаются в одну зону). */
  corpse: Corpse;
  bodies: Corpse[];
  x: number;
  y: number;
  /** Радиус оцепления, px (граница — по клеткам, `inside`). */
  r: number;
  /** Клетки внутри оцепления (индексы тайлов) и места за лентой, куда выталкивает посторонних. */
  cells: Set<number>;
  outside: Vec2[];
  /** Клетки у края оцепления изнутри (здесь встаёт охрана). */
  edge: Vec2[];
  lines: CordonLine[];
  /** Мирных не пускают внутрь: только если лежит убитый ВС с оружием (иначе проходят — меньше толкучки). */
  block: boolean;
  since: number;
  /** Тело осмотрено следователем / медиком. Оба — оцепление снимут через holdAfter с. */
  investigatedAt: number;
  examinedAt: number;
  investigator: Character | null;
  officer: Character | null;
  medic: Character | null;
  closed: boolean;
}

/**
 * Места преступления (CRIME.scene): Протекторат нашёл тело в городе — убитого ВС или гражданского.
 * Проходы вокруг перекрывают: узкие — лентой от стены до стены, широкие — переносными барьерами.
 * Идут следователь SU.01 (осмотр тела, убийца — в розыск) и медик SU.02 (с блокнотом осматривает
 * тело и накрывает его белой простынёй); к телу ВС — ещё офицер PCU.OFC или инспектор SU.INSP
 * (охраняет оцепление). За ленту не пускают мирных, тело не обыскать. Снимают через holdAfter с
 * после осмотра (или maxTime с, или тело увезли); накрытое тело потом забирает санитар. При
 * красном коде оцеплений нет.
 */
export class CrimeScenes {
  readonly list: CrimeScene[] = [];
  readonly stats = { opened: 0, investigated: 0, examined: 0, civil: 0, cwuMedics: 0, merged: 0 };
  private time = 0;

  constructor(private readonly ctx: AiContext) {}

  /**
   * Оцепление вокруг тела. Рядом (ближе CRIME.scene.merge px к телу любой зоны) уже есть оцепление —
   * тело добавляется в него (одна общая зона, а не ленты друг на друге); новое тело связало две зоны —
   * они сливаются.
   */
  open(corpse: Corpse, kind: SceneKind = 'cp'): CrimeScene | null {
    if (this.ctx.war.code === 'red') return null;
    const S = CRIME.scene;
    const open = this.list.filter((s) => !s.closed);
    if (open.some((s) => s.bodies.includes(corpse))) return null;
    const near = open.filter((s) => this.inScene(s, corpse.x, corpse.y) || s.bodies.some((k) => Math.hypot(k.x - corpse.x, k.y - corpse.y) < S.merge));
    if (near.length) {
      const s = near[0];
      for (const o of near.slice(1)) this.absorb(s, o);
      this.addBody(s, corpse, kind);
      return s;
    }
    const s: CrimeScene = {
      kind, corpse, bodies: [corpse], x: corpse.x, y: corpse.y, r: kind === 'cp' ? S.radius : S.civilRadius,
      cells: new Set(), outside: [], edge: [], lines: [], block: false,
      since: this.time, investigatedAt: -1, examinedAt: -1,
      investigator: null, officer: null, medic: null, closed: false,
    };
    this.reshape(s);
    this.list.push(s);
    this.stats.opened++;
    if (kind === 'civil') this.stats.civil++;
    this.dispatch(s);
    const zone = this.ctx.map.zoneAtWorld(s.x, s.y)?.name ?? 'город';
    const who = kind === 'cp' ? 'следователь SU, медик и офицер' : 'следователь SU и медик';
    this.ctx.law.log(`Надзор: ${kind === 'cp' ? 'место преступления' : 'найдено тело гражданина'} — ${zone}. Проход перекрыт; на осмотр — ${who}.`, 'radio');
    return s;
  }

  /** Ещё одно тело в зоне: граница заново, осмотр — и его; убит ВС — зона «ВС» (с офицером). */
  private addBody(s: CrimeScene, corpse: Corpse, kind: SceneKind): void {
    s.bodies.push(corpse);
    this.stats.merged++;
    if (kind === 'cp' && s.kind !== 'cp') {
      s.kind = 'cp';
      s.r = Math.max(s.r, CRIME.scene.radius);
    }
    if (!corpse.scanned) s.investigatedAt = -1;
    if (!corpse.covered) s.examinedAt = -1;
    this.reshape(s);
    if (!this.onScene(s.investigator, s)) this.sendInvestigator(s);
    if (!this.onScene(s.medic, s)) this.sendMedic(s);
    if (s.kind === 'cp' && !this.onScene(s.officer, s)) this.sendOfficer(s);
    this.ctx.law.log(`Надзор: рядом ещё одно тело — ${this.ctx.map.zoneAtWorld(corpse.x, corpse.y)?.name ?? 'город'}. Оцепление расширено.`, 'radio');
  }

  /** Слить зону o в s: тела и отметки, люди o свободны. */
  private absorb(s: CrimeScene, o: CrimeScene): void {
    for (const k of o.bodies) if (!s.bodies.includes(k)) s.bodies.push(k);
    if (o.kind === 'cp') s.kind = 'cp';
    s.r = Math.max(s.r, o.r);
    s.since = Math.min(s.since, o.since);
    o.closed = true;
    this.release(o);
  }

  /** Центр, радиус, граница и «пускать ли» — по всем телам зоны. */
  private reshape(s: CrimeScene): void {
    const n = s.bodies.length;
    s.x = s.bodies.reduce((a, k) => a + k.x, 0) / n;
    s.y = s.bodies.reduce((a, k) => a + k.y, 0) / n;
    s.cells.clear();
    s.outside.length = 0;
    s.edge.length = 0;
    s.lines.length = 0;
    this.cordon(s);
    this.updateBlock(s);
  }

  /** Не пускают, только пока в зоне лежит убитый ВС с оружием (есть что стащить). */
  private updateBlock(s: CrimeScene): void {
    s.block = s.bodies.some((k) => k.faction === 'cp' && CrimeScenes.armed(k) && this.ctx.combat.corpses.includes(k));
  }

  /** Следующее тело зоны, которое ещё не осмотрел следователь ('scan') / не упаковал медик ('cover'). */
  nextBody(s: CrimeScene, what: 'scan' | 'cover'): Corpse | null {
    for (const k of s.bodies) {
      if (!this.ctx.combat.corpses.includes(k)) continue;
      if (what === 'scan' ? !k.scanned : !k.covered) return k;
    }
    return null;
  }

  /**
   * Граница оцепления: клетки пола в радиусе r от тела, связные с ним (стены и двери не
   * пересекает). Клетки у края, за которыми ещё пол, — проходы; их группы — отдельные линии
   * оцепления поперёк прохода, от стены до стены (по углу вокруг тела).
   */
  private cordon(s: CrimeScene): void {
    const S = CRIME.scene;
    const { map, nav } = this.ctx;
    const ts = map.tileSize;
    const W = map.width;
    const open = (tx: number, ty: number): boolean => !map.isSolid(tx, ty) && map.tileAt(tx, ty) !== T.DOOR;
    const inR = (tx: number, ty: number): boolean => s.bodies.some((k) => Math.hypot((tx + 0.5) * ts - k.x, (ty + 0.5) * ts - k.y) <= s.r);
    const stack: number[] = [];
    for (const k of s.bodies) {
      const i = Math.floor(k.y / ts) * W + Math.floor(k.x / ts);
      if (s.cells.has(i)) continue;
      s.cells.add(i);
      stack.push(i);
    }
    while (stack.length) {
      const i = stack.pop()!;
      const tx = i % W;
      const ty = (i - tx) / W;
      for (const [dx, dy] of DIRS) {
        const nx = tx + dx;
        const ny = ty + dy;
        const j = ny * W + nx;
        if (s.cells.has(j) || !open(nx, ny) || !inR(nx, ny)) continue;
        s.cells.add(j);
        stack.push(j);
      }
    }
    // Клетки края: рядом пол вне оцепления.
    const border: number[] = [];
    const out = new Set<number>();
    for (const i of s.cells) {
      const tx = i % W;
      const ty = (i - tx) / W;
      let edge = false;
      for (const [dx, dy] of DIRS) {
        const j = (ty + dy) * W + tx + dx;
        if (s.cells.has(j) || !open(tx + dx, ty + dy)) continue;
        edge = true;
        out.add(j);
      }
      if (edge) border.push(i);
    }
    // Куда выталкивать: проходимые якоря за краем.
    const seen = new Set<number>();
    for (const j of out) {
      const jx = j % W;
      const a = nav.nearestWalkable((jx + 0.5) * ts, ((j - jx) / W + 0.5) * ts, 2);
      if (a < 0 || seen.has(a)) continue;
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      if (s.cells.has(Math.floor(y / ts) * W + Math.floor(x / ts))) continue;
      seen.add(a);
      s.outside.push({ x, y });
    }
    // Группы клеток края (8-связность) — проходы.
    const left = new Set(border);
    for (const i of border) {
      const tx = i % W;
      s.edge.push({ x: (tx + 0.5) * ts, y: ((i - tx) / W + 0.5) * ts });
    }
    while (left.size) {
      const first = left.values().next().value as number;
      left.delete(first);
      const group = [first];
      for (let g = 0; g < group.length; g++) {
        const gx = group[g] % W;
        const gy = (group[g] - gx) / W;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = (gy + dy) * W + gx + dx;
            if (!left.has(j)) continue;
            left.delete(j);
            group.push(j);
          }
        }
      }
      if (group.length < S.minGap) continue;
      s.lines.push(...this.line(s, group));
    }
  }

  /** Линия поперёк прохода: клетки края по углу вокруг тела (разрыв — в самом большом промежутке), концы — до стен. */
  private line(s: CrimeScene, group: number[]): CordonLine[] {
    const S = CRIME.scene;
    const { map } = this.ctx;
    const ts = map.tileSize;
    const W = map.width;
    const pts = group.map((i) => {
      const tx = i % W;
      const ty = (i - tx) / W;
      return { x: (tx + 0.5) * ts, y: (ty + 0.5) * ts, a: Math.atan2((ty + 0.5) * ts - s.y, (tx + 0.5) * ts - s.x), tx, ty };
    });
    pts.sort((p, q) => p.a - q.a);
    // Кольцо вокруг тела (широкая улица): начинать после самого большого разрыва по углу.
    let cut = 0;
    let gap = pts.length ? pts[0].a + Math.PI * 2 - pts[pts.length - 1].a : 0;
    for (let k = 1; k < pts.length; k++) {
      if (pts[k].a - pts[k - 1].a > gap) {
        gap = pts[k].a - pts[k - 1].a;
        cut = k;
      }
    }
    const ordered = [...pts.slice(cut), ...pts.slice(0, cut)];
    // Прореживание: точка через каждые step px.
    const line: Vec2[] = [];
    for (const p of ordered) {
      const last = line[line.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= S.step) line.push({ x: p.x, y: p.y });
    }
    const end = ordered[ordered.length - 1];
    if (line.length && (line[line.length - 1].x !== end.x || line[line.length - 1].y !== end.y)) line.push({ x: end.x, y: end.y });
    // Концы — до стены: сдвиг к сплошной соседней клетке (на полклетки — в грань стены).
    const toWall = (p: { tx: number; ty: number }, q: Vec2): void => {
      for (const [dx, dy] of DIRS) {
        if (!map.isSolid(p.tx + dx, p.ty + dy)) continue;
        q.x += dx * ts * 0.5;
        q.y += dy * ts * 0.5;
        return;
      }
    };
    if (line.length) {
      toWall(ordered[0], line[0]);
      if (line.length > 1) toWall(end, line[line.length - 1]);
    }
    let len = 0;
    for (let k = 1; k < line.length; k++) len += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
    // Барьеры стоят вдоль края оцепления; лента натянута прямо от стены до стены.
    if (len > S.tapeMax) return [{ pts: line, barrier: true }];
    if (line.length <= 2) return [{ pts: line, barrier: false }];
    // Край загибается (два прохода сошлись углом) — ленты поперёк каждого прохода: делим ломаную
    // в самой далёкой от хорды точке, пока все точки не ближе bend px к своей хорде.
    const out: CordonLine[] = [];
    const split = (i: number, j: number): void => {
      const p = line[i];
      const q = line[j];
      const L = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      let far = -1;
      let fd: number = S.bend;
      for (let k = i + 1; k < j; k++) {
        const d = Math.abs((q.x - p.x) * (p.y - line[k].y) - (p.x - line[k].x) * (q.y - p.y)) / L;
        if (d > fd) {
          fd = d;
          far = k;
        }
      }
      if (far < 0) {
        out.push({ pts: [p, q], barrier: false });
        return;
      }
      split(i, far);
      split(far, j);
    };
    split(0, line.length - 1);
    return out;
  }

  /** Точка внутри оцепления s. */
  inScene(s: CrimeScene, x: number, y: number): boolean {
    const ts = this.ctx.map.tileSize;
    return s.cells.has(Math.floor(y / ts) * this.ctx.map.width + Math.floor(x / ts));
  }

  /** Свободный ВС нужного вида, ближайший к месту. */
  private nearest(s: CrimeScene, ok: (c: Character, b: CpBrain) => boolean): Character | null {
    let best: Character | null = null;
    let bestD: number = CRIME.scene.seek;
    for (const c of this.ctx.entities.list) {
      const b = c.brain;
      if (!c.alive || c.isPlayer || !(b instanceof CpBrain) || b.scene || b.guardPost || b.medicStation || b.rally) continue;
      // Начальник тюрьмы (SU.INSP) тюрьму не бросает.
      if (b.duty === 'warden') continue;
      const st = b.fsm.current;
      if (st === 'fight' || st === 'escort' || st === 'retreat' || st === 'check' || st === 'chase') continue;
      if (this.ctx.map.levelAt(c.x, c.y) !== 'city' || !ok(c, b)) continue;
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Отправить следователя SU.01, медика SU.02 и (к телу ВС) офицера PCU.OFC или SU.INSP. */
  private dispatch(s: CrimeScene): void {
    this.sendInvestigator(s);
    this.sendMedic(s);
    if (s.kind === 'cp') this.sendOfficer(s);
  }

  private sendOfficer(s: CrimeScene): void {
    const ofc = this.nearest(s, (c) => c.rank === CP_UNIT.ofc || c.rank === CP_UNIT.insp);
    if (!ofc) return;
    s.officer = ofc;
    (ofc.brain as CpBrain).assignScene(s, 'guard');
  }

  private sendInvestigator(s: CrimeScene): void {
    const inv = this.nearest(s, (c) => c.rank === CP_UNIT.su1);
    if (!inv) return;
    s.investigator = inv;
    (inv.brain as CpBrain).assignScene(s, 'investigate');
  }

  /**
   * Медик: SU.02, пока на местах происшествий их меньше CRIME.scene.suMedicMax (и свободный есть), иначе
   * медик ТС (свой мозг — ExamineBrain, потом назад к работе).
   */
  private sendMedic(s: CrimeScene): void {
    const busy = this.list.filter((o) => !o.closed && o.medic?.alive && o.medic.faction === 'cp').length;
    const su = busy < CRIME.scene.suMedicMax ? this.nearest(s, (c) => c.rank === CP_UNIT.su2) : null;
    if (su) {
      s.medic = su;
      (su.brain as CpBrain).assignScene(s, 'examine');
      return;
    }
    let best: Character | null = null;
    let bestD: number = CRIME.scene.seek;
    for (const c of this.ctx.entities.list) {
      // Стоящего в очереди за пайком не срывают.
      if (!c.alive || c.isPlayer || c.profession !== 'cwu_medic' || !(c.brain instanceof CitizenBrain) || c.law.phase !== 'none' || this.ctx.economy.queue.includes(c)) continue;
      if (this.ctx.map.levelAt(c.x, c.y) !== 'city') continue;
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      s.medic = best;
      best.brain = new ExamineBrain(s, best.brain);
      this.stats.cwuMedics++;
    } else {
      // Медика ТС нет — всё же SU.02, если есть.
      const any = this.nearest(s, (c) => c.rank === CP_UNIT.su2);
      if (!any) return;
      s.medic = any;
      (any.brain as CpBrain).assignScene(s, 'examine');
    }
  }

  /** Занят ли c этим местом происшествия (по своему мозгу). */
  private onScene(c: Character | null, s: CrimeScene): boolean {
    const b = c?.brain;
    return !!c?.alive && ((b instanceof CpBrain && b.scene === s) || (b instanceof ExamineBrain && b.scene === s));
  }

  /** Следователь осмотрел тело. */
  investigated(s: CrimeScene): void {
    if (s.investigatedAt >= 0) return;
    s.investigatedAt = this.time;
    this.stats.investigated++;
  }

  /** Медик осмотрел тело k и упаковал его в мешок; все тела зоны готовы — осмотр закончен. */
  examined(s: CrimeScene, k: Corpse = s.corpse): void {
    this.cover(k);
    if (s.examinedAt >= 0 || this.nextBody(s, 'cover')) return;
    s.examinedAt = this.time;
    this.stats.examined++;
  }

  /** Накрыть тело белой простынёй: лежит, пока его не заберёт санитар. */
  cover(corpse: Corpse): void {
    if (corpse.covered) return;
    corpse.covered = true;
    corpse.until = Math.max(corpse.until, this.ctx.combat.now + CRIME.scene.coveredKeep);
  }

  /** Тело под оцеплением — обыскать его может только сотрудник Протектората. */
  sealed(corpse: Corpse, who: Character | null = null): boolean {
    if (who && FACTIONS[who.faction].authority) return false;
    return !!corpse.covered || this.list.some((s) => !s.closed && s.bodies.includes(corpse));
  }

  /** Тело под оцеплением (санитару ждать, пока его не снимут). */
  awaiting(corpse: Corpse): boolean {
    return this.list.some((s) => !s.closed && s.bodies.includes(corpse));
  }

  /** Точка внутри какого-нибудь оцепления. */
  inside(x: number, y: number): CrimeScene | null {
    for (const s of this.list) if (!s.closed && this.inScene(s, x, y)) return s;
    return null;
  }

  /** Есть ли у тела оружие (бандитам есть что брать). */
  static armed(corpse: Corpse): boolean {
    return corpse.loot.some((st) => st.id in WEAPONS && st.qty > 0);
  }

  /** Снять все оцепления (красный код: не до следствия). */
  closeAll(): void {
    for (const s of this.list) if (!s.closed) this.close(s);
  }

  private close(s: CrimeScene): void {
    s.closed = true;
    this.release(s);
    this.ctx.law.log(`Надзор: оцепление снято — ${this.ctx.map.zoneAtWorld(s.x, s.y)?.name ?? 'город'}.`, 'radio');
  }

  /** Отпустить людей зоны к их службе. */
  private release(s: CrimeScene): void {
    for (const c of [s.investigator, s.officer, s.medic]) {
      const b = c?.brain;
      if (b instanceof CpBrain) b.releaseScene(s);
      else if (b instanceof ExamineBrain && b.scene === s) b.finish(c!);
    }
  }

  /** Сделана ли работа: следователь осмотрел, медик осмотрел (или медика нет и не будет). */
  private done(s: CrimeScene): boolean {
    if (s.investigatedAt < 0) return false;
    if (s.examinedAt < 0 && s.medic) return false;
    return this.time - Math.max(s.investigatedAt, s.examinedAt) >= CRIME.scene.holdAfter;
  }

  update(dt: number): void {
    this.time += dt;
    const S = CRIME.scene;
    const { combat, entities } = this.ctx;
    for (const s of this.list) {
      if (s.closed) continue;
      const left = s.bodies.filter((k) => combat.corpses.includes(k));
      const gone = left.length === 0;
      // Пока стоит оцепление, тела не исчезают сами.
      for (const k of left) k.until = Math.max(k.until, combat.now + 5);
      if (gone || this.done(s) || this.time - s.since >= S.maxTime) {
        // Медик не дошёл — тела всё равно упаковывают перед уходом.
        if (s.investigatedAt >= 0) for (const k of left) this.cover(k);
        this.close(s);
        continue;
      }
      this.updateBlock(s);
      // Погиб или занят другим — прислать замену.
      if (s.investigatedAt < 0 && !this.onScene(s.investigator, s)) {
        s.investigator = null;
        this.sendInvestigator(s);
      }
      if (s.examinedAt < 0 && s.medic && !this.onScene(s.medic, s)) {
        s.medic = null;
        this.sendMedic(s);
      }
      // Лежит убитый ВС с оружием — мирных за ограждение не пускают (выталкивает к ближайшему месту
      // снаружи); иначе проходят под лентой и между козлами — меньше толкучки.
      if (!s.block || !s.outside.length) continue;
      for (const c of entities.near(s.x, s.y, s.r + c0, near)) {
        // Лента держит мирных (горожане, ТС, поднадзорные); вооружённых повстанцев она не остановит.
        if (!c.alive || c === s.medic || !CORDONED.has(c.faction) || c.law.phase !== 'none' || !this.inScene(s, c.x, c.y)) continue;
        let best = s.outside[0];
        let bd = Infinity;
        for (const p of s.outside) {
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        c.x = best.x;
        c.y = best.y;
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].closed) this.list.splice(i, 1);
  }
}

const DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Запас на радиус персонажа при поиске тех, кто зашёл за ленту. */
const c0 = 24;
const near: Character[] = [];
/** Кого оцепление не пускает внутрь. */
const CORDONED: ReadonlySet<string> = new Set(['citizen', 'cwu', 'vort']);
