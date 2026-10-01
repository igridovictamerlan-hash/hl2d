import type { Brain } from '../Brain';
import { bark } from '../../systems/Barks';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement, faceTowards } from '../facing';
import { randomAnchorAround, randomAnchorInZone, zoneIds } from '../destinations';
import { canSeeCircle } from '../../world/visibility';
import { COMBAT } from '../../config/combat';
import { WAR } from '../../config/war';
import { CHARACTER } from '../../config/entities';
import { T } from '../../world/tiles';
import { COMMAND } from '../../config/roster';
import { poiWorld } from '../../systems/Population';
import type { Vec2 } from '../../core/math';
import type { Front } from '../../systems/WarSystem';
import { Tactician, followColumn, watchSector } from '../Tactics';
import { TACTICS, SUPPRESS } from '../../config/tactics';
import { PRISON } from '../../config/prison';
import type { Cell } from '../../systems/LawSystem';

const nearRebels: Character[] = [];
/** У КПП укрытия ищем только на пустоши перед ним и в самом КПП (не на тропе за скалами). */
const FRONT_ZONES: ReadonlySet<string> = new Set(['outlands', 'checkpoint']);

export type RebelMode = 'camp' | 'gather' | 'raid' | 'assault' | 'infiltrate' | 'storm' | 'retreat' | 'capture' | 'hold';

/**
 * Боец армии сопротивления (лагерь в пустоши, штурм КПП).
 *  camp — в лагере: лечится, пополняет патроны; готов — командование (RebelCommand) шлёт к КПП;
 *  gather — собирается с остальными на пустоши вне видимости постов, ждёт капта (не лезет под огонь);
 *  raid — занимает позицию на пустоши с видом на ворота КПП и перестреливается с часовыми;
 *  assault — идёт на прорыв через коридор КПП в город (стреляет по пути);
 *  infiltrate — прорвался: прячется в кварталах, отстреливается, если нашли;
 *  storm — все точки D наши: штурм Управы (перебежками к зоне Управы и держать её); своих в тюрьме
 *    много, а на воле мало (PrisonSystem.rescue) — сперва штурм тюрьмы: выбить двери камер;
 *  retreat — ранен или без патронов: уходит тропой в лагерь (там — camp);
 *  capture — идёт капт КПП: занимает позиции в передней части коридора и у внешних ворот;
 *  hold — КПП захвачен: держит пост часового.
 * Поверх режимов: клич главы (идёт за ним на штурм), HYDRA держится рядом с главой.
 */
export class RebelBrain implements Brain {
  readonly mover: Mover;
  readonly gunner: Gunner;
  mode: RebelMode = 'raid';
  /** Больше не используется: погибшие и отошедшие не исчезают, а возвращаются (постоянный состав). */
  departed = false;
  /** Патроны в лагере уже пополнены (сбрасывается при выходе). */
  restocked = false;
  /** Шёл за главой по кличу в прошлом тике. */
  private following = false;
  /** Обычный шаг (на тропе через пустошь — быстрее). */
  private readonly baseSpeed: number;
  private relocate = 0;
  private goal = -1;
  private suppressIn = 0;
  private suppressLeft = 0;
  private suppressAt: { x: number; y: number } | null = null;
  private repath = 0;
  private holdPost: { x: number; y: number } | null = null;
  /** Куда смотреть на посту (стрелки у выхода в город — на проспект). */
  private holdFace: { x: number; y: number } | null = null;
  /** Капт: доля пути по коридору, сколько ещё держаться в укрытии, фаза перебежки. */
  private advance = 0;
  private coverLeft = 0;
  private shooting = false;
  private phaseLeft = 0;
  /** Капт: маршрут во внутренний двор (точки шорта или лонга), вход в проход и для какой точки он выбран. */
  private route: number[] = [];
  private routeFor = -1;
  private entry = -1;
  private stackReady = 0;
  /** Идёт через лонг (для отладки и тестов). */
  viaLong = false;
  /** Звено штурма (-1 — без звена) и его полоса двора. */
  team = -1;
  private lane = 1;
  /** Звено вошло в проход (шорт/лонг) — в свой такт переката. */
  private routeStarted = false;
  /** Идёт вперёд по кличу NPC-главы (своей полосой, без очереди перекатов). */
  private rallied = false;
  /** Медик: кого лечит, перерыв между перевязками, как часто искать раненых. */
  private patient: Character | null = null;
  private healCooldown = 0;
  private medicScan = 0;
  /** Тактика боя (углы, укрытия, раненые). */
  readonly tactics = new Tactician();
  /** Колонна звена: шёл за ведущим в прошлом тике, место в колонне, ведущий, накопление у входа. */
  private inCol = false;
  private readonly column = { repath: 0 };
  private colK = 1;
  private colLast = false;
  private colLead: Character | null = null;
  private colCheck = 0;
  private stackSince = -1;

  constructor(
    private self: Character,
    private ctx: AiContext,
    public front: number,
    /** Когда отряд пойдёт на штурм (Infinity — не пойдёт). */
    private assaultAt: number,
  ) {
    this.baseSpeed = ctx.rng.range(75, 90);
    this.mover = new Mover(this.baseSpeed);
    this.gunner = new Gunner(ctx.rng);
  }

  get stateName(): string {
    const tac = this.tactics.label;
    return `${this.mode}${this.inCol ? ' · колонна' : ''}${this.gunner.target ? ' · бой' : ''}${tac ? ` · ${tac}` : ''}`;
  }

  /** Ведущий звена (идёт первым через проход, остальные — колонной за ним). */
  get stacking(): boolean {
    return this.stackSince >= 0;
  }

  /** Звено идёт колонной: ведущий накапливает звено у входа в проход или ведёт его по проходу. */
  get inColumn(): boolean {
    return this.mode === 'capture' && (this.stacking || (this.routeStarted && this.route.length > 0));
  }

  /** Ведущий звена на этом фронте (глава, если он NPC и в звене, иначе младший по номеру) и своё место за ним. */
  private pointman(f: Front): Character | null {
    const now = this.ctx.combat.now;
    if (now < this.colCheck) return this.colLead;
    this.colCheck = now + 0.5;
    this.colLead = null;
    if (this.team < 0) return null;
    const leader = this.ctx.war.command.leader;
    const team: Character[] = [];
    for (const r of f.squad) {
      const b = r.brain;
      if (!r.fit || !(b instanceof RebelBrain) || b.mode !== 'capture' || b.team !== this.team) continue;
      team.push(r);
    }
    if (team.length < 2) return null;
    team.sort((a, b) => (a === leader ? -1 : b === leader ? 1 : a.id - b.id));
    this.colLead = team[0];
    const k = team.indexOf(this.self);
    this.colK = Math.max(1, k);
    this.colLast = k === team.length - 1;
    return this.colLead;
  }

  /** Спецотряд HYDRA: держится рядом с главой. */
  get isHydra(): boolean {
    return (this.self.profession?.startsWith('hydra') || this.self.profession === 'commando') ?? false;
  }

  /** Доля пути по двору в капте (HYDRA и клич подтягиваются к главе). */
  get progress(): number {
    return this.advance;
  }

  /** Цель движения (якорь) — соседи по штурму не встают в то же укрытие. */
  get goalAnchor(): number {
    return this.goal;
  }

  /** Назначить звено штурма: полоса двора; маршрут во внутренний двор выбирается заново. */
  setTeam(team: number): void {
    if (team === this.team) return;
    this.team = team;
    // Звено главы — по центру, остальные — справа, слева, снова по центру…
    this.lane = team < 0 ? this.ctx.rng.int(0, WAR.capture.lanes - 1) : (team + 1) % WAR.capture.lanes;
    this.routeFor = -1;
  }

  /** Перекат: звенья бегут по очереди — чётные в чётный такт, нечётные в нечётный. */
  private boundTurn(f: Front): boolean {
    if (this.team < 0 || !f.capture || this.rallied) return true;
    const turn = Math.floor((this.ctx.war.now - f.capture.since) / WAR.capture.bound);
    return turn % 2 === this.team % 2;
  }

  /** Сменить фронт (из лагеря, сбора или перестрелки; держащие посты и штурмующие — нет). */
  setFront(front: number): void {
    if (front === this.front) return;
    if (this.mode !== 'camp' && this.mode !== 'gather' && this.mode !== 'raid') return;
    this.front = front;
    this.goal = -1;
  }

  /** В лагерь (новый или возрождённый боец). */
  toCamp(): void {
    this.mode = 'camp';
    this.goal = -1;
    this.restocked = false;
  }

  /** Из лагеря — к своему КПП: на сбор (штурм) или перестрелку (отвлекающая группа). */
  march(kind: 'gather' | 'raid'): void {
    if (this.mode !== 'camp') return;
    this.mode = kind;
    this.goal = -1;
    this.assaultAt = Infinity;
    this.restocked = false;
  }

  /** Пост, который держит (режим hold). */
  get post(): { x: number; y: number } | null {
    return this.mode === 'hold' ? this.holdPost : null;
  }

  orderAssault(): void {
    if (this.mode === 'hold' || this.mode === 'capture') {
      this.mode = 'assault';
      this.goal = -1;
      return;
    }
    if (this.mode === 'gather') this.mode = 'raid';
    if (this.mode === 'raid') this.assaultAt = 0;
  }

  /** Собираться на точке сбора до начала капта. */
  orderGather(): void {
    if (this.mode !== 'raid') return;
    this.mode = 'gather';
    this.goal = -1;
  }

  /** Капт начался: вперёд по коридору перебежками от укрытия к укрытию. */
  orderCapture(withHolders = false): void {
    if (this.mode !== 'raid' && this.mode !== 'assault' && this.mode !== 'gather' && !(withHolders && this.mode === 'hold')) return;
    this.mode = 'capture';
    this.goal = -1;
    this.routeFor = -1;
    this.team = -1;
    this.advance = this.ctx.rng.range(0, WAR.capture.advanceStep);
    this.coverLeft = this.ctx.rng.range(WAR.capture.coverWait[0], WAR.capture.coverWait[1]);
    this.shooting = false;
    this.phaseLeft = 0;
  }

  /**
   * Якорь во дворе штурмуемой точки на доле пути t (пол двора отсортирован от входа со стороны
   * пустоши), по возможности — за блоком.
   */
  private coverAt(floor: readonly number[], fallback: { x: number; y: number }, t: number, taken: readonly Vec2[] = []): number {
    const { ctx } = this;
    const n = floor.length;
    if (n === 0) return ctx.nav.nearestWalkable(fallback.x, fallback.y, 6);
    const C = WAR.capture;
    const lat = lateralOf(ctx, floor, fallback);
    const lane = (a: number) => Math.min(C.lanes - 1, Math.floor(((lat.of.get(a)! - lat.min) / (lat.max - lat.min || 1)) * C.lanes));
    const free = (a: number) => !taken.some((p) => Math.hypot(p.x - ctx.nav.worldX(a), p.y - ctx.nav.worldY(a)) < C.spacing);
    // Сначала своя полоса рядом с долей пути t, потом шире, потом — любая полоса.
    for (const [win, own] of [[0.08, true], [0.18, true], [0.18, false], [1, false]] as const) {
      const lo = Math.max(0, Math.floor((t - win) * (n - 1)));
      const hi = Math.min(n - 1, Math.ceil((t + win) * (n - 1)));
      const pool: number[] = [];
      const covered: number[] = [];
      for (let i = lo; i <= hi; i++) {
        const a = floor[i];
        if ((own && lane(a) !== this.lane) || !free(a)) continue;
        pool.push(a);
        // Блок рядом — укрытие.
        const ax = ctx.nav.ax(a);
        const ay = ctx.nav.ay(a);
        let cover = false;
        for (let dy = -1; dy <= 2 && !cover; dy++) for (let dx = -1; dx <= 2; dx++) if (ctx.map.tileAt(ax + dx, ay + dy) === T.BARRIER) cover = true;
        if (cover) covered.push(a);
      }
      if (pool.length) return ctx.rng.pick(covered.length ? covered : pool);
    }
    const k = Math.min(n - 1, Math.floor(t * (n - 1)));
    return floor[k];
  }

  /** Звено выстроилось за ведущим (каждый не дальше своего места в колонне). */
  private teamStacked(f: Front): boolean {
    const S = TACTICS.stack;
    const team: Character[] = [];
    for (const r of f.squad) {
      const b = r.brain;
      if (r !== this.self && r.fit && b instanceof RebelBrain && b.mode === 'capture' && b.team === this.team) team.push(r);
    }
    team.sort((a, b) => a.id - b.id);
    return team.every((r, i) => Math.hypot(r.x - this.self.x, r.y - this.self.y) <= (i + 1) * S.gap + S.near * 1.5);
  }

  /** Куда уже идут другие штурмующие этого фронта (их укрытия заняты). */
  private takenSpots(f: Front): Vec2[] {
    const out: Vec2[] = [];
    for (const r of f.squad) {
      const b = r.brain;
      if (r === this.self || !r.alive || !(b instanceof RebelBrain) || b.mode !== 'capture' || b.goalAnchor < 0) continue;
      out.push({ x: this.ctx.nav.worldX(b.goalAnchor), y: this.ctx.nav.worldY(b.goalAnchor) });
    }
    return out;
  }

  /** КПП захвачен: держать пост. */
  orderHold(post: { x: number; y: number }, face: { x: number; y: number } | null = null): void {
    if (this.mode === 'retreat' || this.mode === 'infiltrate') return;
    this.team = -1;
    this.mode = 'hold';
    this.holdPost = post;
    this.holdFace = face;
    this.goal = -1;
  }

  /** Капт отбит / КПП отбит — назад на точку сбора, ждать подхода своих. */
  orderRegroup(): void {
    if (this.mode !== 'capture' && this.mode !== 'hold' && this.mode !== 'raid') return;
    this.team = -1;
    this.mode = 'gather';
    this.goal = -1;
    this.assaultAt = Infinity;
  }

  /**
   * Точка сбора: пустошь в WAR.gatherDist от внешних ворот, не видна ни с одного поста (не лезть
   * под огонь по одному), рядом со своими, но не вплотную.
   */
  private pickGather(f: NonNullable<AiContext['war']['fronts'][number]>): number {
    const { ctx, self } = this;
    // Внешний двор уже наш — собираемся в нём, вне видимости постов внутреннего двора.
    const yard = f.held >= 1 ? f.points[0]?.floor ?? [] : [];
    if (yard.length) {
      let best = -1;
      let bestScore = -Infinity;
      const enemy = f.points[1]?.posts ?? [];
      for (let k = 0; k < 30; k++) {
        const a = ctx.rng.pick(yard);
        const x = ctx.nav.worldX(a);
        const y = ctx.nav.worldY(a);
        let score = ctx.rng.range(0, 2);
        if (enemy.some((p) => canSeeCircle(ctx.map, x, y, p.x, p.y, 10))) score -= 20;
        score -= 4 * this.crowdAt(f, x, y);
        if (score > bestScore) {
          bestScore = score;
          best = a;
        }
      }
      return best;
    }
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < 40; k++) {
      const a = ctx.rng.pick(f.outlands);
      const x = ctx.nav.worldX(a);
      const y = ctx.nav.worldY(a);
      const d = Math.hypot(x - f.outerGate.x, y - f.outerGate.y);
      let score = ctx.rng.range(0, 2);
      if (d < WAR.gatherDist[0] || d > WAR.gatherDist[1]) score -= 8;
      if (f.posts.some((p) => canSeeCircle(ctx.map, x, y, p.x, p.y, 10))) score -= 20;
      score -= 4 * this.crowdAt(f, x, y);
      for (const o of f.squad) {
        const od = Math.hypot(o.x - x, o.y - y);
        if (o !== self && od >= WAR.capture.spacing && od < 120) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** Сколько штурмующих Управа стоит или идёт ближе WAR.capture.spacing к точке. */
  private crowdNear(x: number, y: number): number {
    let n = 0;
    const r = WAR.capture.spacing;
    for (const o of this.ctx.entities.near(x, y, r * 2, nearRebels)) {
      if (o === this.self || !o.alive || o.faction !== 'rebel') continue;
      const b = o.brain;
      const g = b instanceof RebelBrain ? b.goalAnchor : -1;
      if (Math.hypot(o.x - x, o.y - y) < r || (g >= 0 && Math.hypot(this.ctx.nav.worldX(g) - x, this.ctx.nav.worldY(g) - y) < r)) n++;
    }
    return n;
  }

  /** Сколько своих стоит или идёт ближе WAR.capture.spacing к точке (сбор — не кучей). */
  private crowdAt(f: Front, x: number, y: number): number {
    let n = 0;
    const r = WAR.capture.spacing;
    for (const o of f.squad) {
      if (o === this.self || !o.alive) continue;
      const b = o.brain;
      const g = b instanceof RebelBrain ? b.goalAnchor : -1;
      if (Math.hypot(o.x - x, o.y - y) < r || (g >= 0 && Math.hypot(this.ctx.nav.worldX(g) - x, this.ctx.nav.worldY(g) - y) < r)) n++;
    }
    return n;
  }

  /** Выход в город: дошёл до сбора волны во внутреннем дворе и ждёт; точка сбора выбрана. */
  staged = false;
  private stageSpot = false;

  /** Штурм Управы (выход в город при всех точках D). */
  storm(): void {
    this.mode = 'storm';
    this.staged = false;
    this.stageSpot = false;
    this.goal = -1;
    this.team = -1;
    this.shooting = false;
    this.phaseLeft = 0;
  }

  /** Раунд окончен (Управа удержан): все бойцы уходят в лагерь. */
  withdraw(): void {
    if (this.mode === 'camp') return;
    this.mode = 'retreat';
    this.goal = -1;
    this.team = -1;
  }

  infiltrate(): void {
    this.mode = 'infiltrate';
    this.goal = -1;
    this.mover.speed = CHARACTER.runSpeed * 0.8;
  }

  /**
   * Огневая позиция на пустоши: видно пост часового (иначе — хотя бы ворота), пост в пределах
   * дальности своего оружия (арбалетчик держится подальше), завал на линии огня рядом (укрытие),
   * не вплотную к своим.
   */
  private pickPosition(f: NonNullable<AiContext['war']['fronts'][number]>): number {
    const { ctx, self } = this;
    const reach = ctx.combat.reach(self);
    const sniper = self.inventory.has('crossbow');
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < 40; k++) {
      const a = ctx.rng.pick(f.outlands);
      const x = ctx.nav.worldX(a);
      const y = ctx.nav.worldY(a);
      let score = ctx.rng.range(0, 2);
      let post: { x: number; y: number } | null = null;
      for (const p of f.posts) {
        if (canSeeCircle(ctx.map, x, y, p.x, p.y, 8) && (!post || Math.hypot(p.x - x, p.y - y) < Math.hypot(post.x - x, post.y - y))) post = p;
      }
      if (post) {
        const d = Math.hypot(post.x - x, post.y - y);
        score += 10;
        if (d <= reach * 0.95) score += 6;
        if (sniper) score += Math.min(6, d / 80);
        if (coverOnLine(ctx, x, y, post.x, post.y)) score += 4;
      } else if (canSeeCircle(ctx.map, x, y, f.outerGate.x, f.outerGate.y, 4)) score += 3;
      for (const o of f.squad) {
        if (o !== self && Math.hypot(o.x - x, o.y - y) < 40) score -= 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** Очередь по видимому посту, где стоит часовой (за укрытием — не видно, но известно). */
  private suppress(f: NonNullable<AiContext['war']['fronts'][number]>, dt: number): void {
    const { ctx, self } = this;
    this.suppressIn -= dt;
    if (this.suppressIn > 0) {
      if (this.suppressLeft > 0 && this.suppressAt && ctx.combat.canFire(self)) {
        ctx.combat.fire(self, this.suppressAt.x + ctx.rng.range(-10, 10), this.suppressAt.y + ctx.rng.range(-10, 10));
        this.suppressLeft--;
      }
      return;
    }
    this.suppressIn = ctx.rng.range(WAR.suppressEvery[0], WAR.suppressEvery[1]);
    this.suppressAt = null;
    const reach = ctx.combat.reach(self);
    const manned = ctx.war.guardPosts(f);
    for (const p of manned) {
      if (Math.hypot(p.x - self.x, p.y - self.y) <= reach && canSeeCircle(ctx.map, self.x, self.y, p.x, p.y, 6)) {
        this.suppressAt = p;
        break;
      }
    }
    if (!this.suppressAt) return;
    const best = ctx.combat.bestWeapon(self, Math.hypot(this.suppressAt.x - self.x, this.suppressAt.y - self.y));
    if (best && best !== self.weapon) ctx.combat.equip(self, best);
    self.aiming = true;
    faceTowards(self, this.suppressAt.x, this.suppressAt.y, 1);
    this.suppressLeft = ctx.rng.int(WAR.suppressBurst[0], WAR.suppressBurst[1]);
  }

  /** Медик: найти раненого своего и перевязать. true — занят лечением (движение уже задано). */
  private medic(self: Character, ctx: AiContext, dt: number, fighting: boolean): boolean {
    this.healCooldown -= dt;
    this.medicScan -= dt;
    if (this.medicScan <= 0) {
      this.medicScan = 0.5;
      this.patient = null;
      if (!self.inventory.has('bandage') && !self.inventory.has('medkit')) return false;
      let bestD = 240;
      for (const o of ctx.entities.near(self.x, self.y, bestD, nearRebels)) {
        // Лечит всех нуждающихся: своих и мирных (не Протекторат и не бандитов).
        const friend = o.faction === 'rebel' || ((o.faction === 'citizen' || o.faction === 'cwu' || o.faction === 'vort') && !o.hostile);
        if (o === self || !friend || !o.alive || (o.health >= o.maxHealth * COMBAT.medicBelow && o.bleed <= 0)) continue;
        const d = Math.hypot(o.x - self.x, o.y - self.y);
        if (d < bestD) {
          bestD = d;
          this.patient = o;
        }
      }
    }
    const p = this.patient;
    if (!p || !p.alive || (fighting && this.gunner.target && Math.hypot(p.x - self.x, p.y - self.y) > 60)) return false;
    if (Math.hypot(p.x - self.x, p.y - self.y) > COMBAT.healRange) {
      if (this.repath <= 0 || this.mover.status === 'idle' || this.mover.status === 'arrived') {
        this.repath = 0.8;
        this.mover.speed = CHARACTER.runSpeed * 0.8;
        this.go(ctx.nav.nearestWalkable(p.x, p.y, 3));
      }
      return true;
    }
    this.mover.stop();
    if (this.healCooldown <= 0 && (self.inventory.remove('bandage', 1) || self.inventory.remove('medkit', 1))) {
      ctx.combat.heal(p, COMBAT.healAmount);
      this.healCooldown = COMBAT.healCooldown;
      self.say('Держись, брат, латаю.', ctx.law.now, 1.5);
      if (p.health >= p.maxHealth * COMBAT.medicBelow && p.bleed <= 0) {
        this.patient = null;
        this.goal = -1;
      }
    }
    return true;
  }

  private go(anchor: number): void {
    if (anchor < 0) return;
    this.goal = anchor;
    this.mover.goTo(this.self, this.ctx, anchor);
  }

  /** Проспект и площадь (для штурма Управы — идти к нему переулками, а не по открытому). */
  private openStreets: ReadonlySet<number> | null = null;

  /** В городе к Управе — переулками, пока до него дальше WAR.nexus.alleysUntil; у Управы — напрямую. */
  private approachNexus(): void {
    const { ctx } = this;
    const gate = ctx.map.poisOf('nexus_gate')[0];
    const ts = ctx.map.tileSize;
    this.approach(gate ? { x: (gate.x + 0.5) * ts, y: (gate.y + 0.5) * ts } : null);
  }

  /** К цели в городе — переулками, пока до неё дальше WAR.nexus.alleysUntil; вблизи — напрямую. */
  private approach(to: Vec2 | null): void {
    const { ctx, self } = this;
    const far = !to || Math.hypot(to.x - self.x, to.y - self.y) > WAR.nexus.alleysUntil;
    this.openStreets ??= zoneIds(ctx, ['avenue', 'plaza']);
    this.mover.avoidZones = far ? this.openStreets : undefined;
    this.mover.avoidCost = WAR.nexus.alleyCost;
  }

  /** Выручка своих: какую камеру тюрьмы вскрывает и сколько уже возится с дверью. */
  jailCell: Cell | null = null;
  private jailWork = 0;

  /**
   * Штурм тюрьмы (выход в город, своих в тюрьме много, а на воле мало — PrisonSystem.rescue): перебежками
   * к своей занятой камере (не туда, куда уже идут другие), дверь выбить за PRISON.assault.breakTime с,
   * потом к следующей. Выпущенные берут оружие из изъятого и идут со всеми.
   */
  private stormPrison(self: Character, ctx: AiContext, dt: number, fighting: boolean): void {
    const P = PRISON.assault;
    const C = WAR.capture;
    this.phaseLeft -= dt;
    if (fighting && this.gunner.target) {
      if (this.phaseLeft <= 0) {
        this.shooting = !this.shooting;
        this.phaseLeft = this.shooting ? ctx.rng.range(C.shootStop[0], C.shootStop[1]) : ctx.rng.range(C.dash[0], C.dash[1]);
        if (!this.shooting) bark(self, 'advance', ctx.combat.now, ctx.rng);
      }
    } else this.shooting = false;
    if (!this.jailCell || !this.jailCell.slots.some((s) => s.occupant)) {
      const taken = new Set<Cell>();
      for (const o of ctx.entities.list) {
        const b = o.brain;
        if (o !== self && o.alive && b instanceof RebelBrain && b.jailCell) taken.add(b.jailCell);
      }
      this.jailCell = ctx.prison.occupiedCellNear(self.x, self.y, taken) ?? ctx.prison.occupiedCellNear(self.x, self.y);
      this.jailWork = 0;
      this.goal = -1;
    }
    const cell = this.jailCell;
    const to = cell ? { x: cell.frontX, y: cell.frontY } : ctx.prison.center;
    this.mover.speed = CHARACTER.runSpeed * 0.75;
    if (cell && Math.hypot(cell.frontX - self.x, cell.frontY - self.y) < P.reach) {
      this.mover.stop();
      if (!this.gunner.target) faceTowards(self, cell.x, cell.y, dt);
      this.jailWork += dt;
      if (this.jailWork >= P.breakTime) {
        ctx.insurgency.jailbreak(self, cell);
        this.jailCell = null;
      }
      return;
    }
    if (this.shooting) {
      this.mover.stop();
      return;
    }
    const st = this.mover.status;
    if (to && (this.goal < 0 || st === 'failed' || st === 'idle' || st === 'arrived')) {
      this.approach(to);
      this.go(ctx.nav.nearestWalkable(to.x, to.y, 4));
    }
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    this.self = self;
    this.ctx = ctx;
    const f = ctx.war.fronts[this.front];
    const outOfAmmo = ctx.combat.maxRange(self) <= 0;
    // В капте раненые не уходят — дерутся до конца (без патронов — уходят).
    const stays = (this.mode === 'capture' || this.mode === 'storm' || (this.mode === 'assault' && ctx.war.cityPush)) && !outOfAmmo;
    if (this.mode !== 'infiltrate' && this.mode !== 'retreat' && this.mode !== 'camp' && !stays && (self.health < self.maxHealth * COMBAT.woundedFraction || outOfAmmo)) {
      this.mode = 'retreat';
      this.goal = -1;
    }
    if (this.mode === 'raid' && ctx.combat.now >= this.assaultAt) {
      this.mode = 'assault';
      this.goal = -1;
    }
    const fighting = this.gunner.update(self, ctx, dt);
    this.relocate -= dt;
    this.repath -= dt;
    // Медик: раненый свой рядом — к нему и перевязать (важнее позиции, но не во время перестрелки в упор).
    if (self.profession === 'rebel_medic' && this.mode !== 'retreat' && this.mode !== 'infiltrate' && this.medic(self, ctx, dt, fighting)) {
      this.mover.update(self, ctx, dt);
      if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
      return;
    }
    // Свой тяжелораненый рядом — оттащить из-под огня и поднять.
    if (this.mode !== 'retreat' && this.mode !== 'infiltrate' && this.tactics.rescue(self, ctx, this.gunner, this.mover, dt)) {
      this.mover.update(self, ctx, dt);
      if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
      return;
    }
    // Бой кончился — укрытие больше не держим.
    if (!fighting && this.tactics.mode !== 'none') {
      this.tactics.reset(self);
      this.gunner.memory = 3;
    }
    const covered = this.tactics.mode !== 'none';
    // Клич главы: бойцы рядом бегут за ним (стреляя на ходу) и вместе идут на штурм.
    const lead = ctx.war.command.rallyFor(self);
    const leadBrain = lead && !lead.isPlayer && lead.brain instanceof RebelBrain && lead.brain.mode === 'capture' ? lead.brain : null;
    this.rallied = false;
    if (lead && leadBrain && (this.mode === 'gather' || this.mode === 'raid' || this.mode === 'capture')) {
      // Клич NPC-главы: все звенья разом вперёд до рубежа главы — но каждое своей полосой, не кучей.
      if (this.mode !== 'capture') this.orderCapture();
      this.rallied = true;
      if (leadBrain.progress > this.advance) {
        this.advance = leadBrain.progress;
        this.goal = -1;
      }
    } else if (lead && (this.mode === 'gather' || this.mode === 'raid' || this.mode === 'capture')) {
      // За игроком-главой — врассыпную вокруг него.
      if (this.mode !== 'capture') this.orderCapture();
      this.following = true;
      const st = this.mover.status;
      if (this.repath <= 0 || st === 'idle' || st === 'failed' || st === 'arrived') {
        this.repath = 0.5;
        // Врассыпную вокруг главы, а не кучей.
        const ang = (self.id * 2.39996) % (Math.PI * 2);
        const r = COMMAND.rally.spread[0] + (self.id % 4) * COMMAND.rally.spread[1];
        this.go(ctx.nav.nearestWalkable(lead.x + Math.cos(ang) * r, lead.y + Math.sin(ang) * r, 3));
      }
      this.mover.speed = CHARACTER.runSpeed * 0.8 * COMMAND.rally.speedMul;
      this.mover.update(self, ctx, dt);
      if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
      return;
    }
    const leader = ctx.war.command.leader;
    const lb = leader && leader !== self && leader.brain instanceof RebelBrain && leader.brain.front === this.front ? leader.brain : null;
    if (this.following) {
      // Клич кончился — продолжаем штурм оттуда, куда дошёл глава.
      this.following = false;
      this.goal = -1;
      if (lb) this.advance = Math.max(this.advance, lb.progress);
    }

    // Сбор и перестрелка: по тропе через пустошь — быстрым шагом, у КПП — обычным.
    if (this.mode === 'gather' || this.mode === 'raid') {
      this.mover.speed = ctx.map.zoneAtWorld(self.x, self.y)?.kind === 'wasteland' ? CHARACTER.runSpeed * COMMAND.trailSpeed : this.baseSpeed;
    }
    switch (this.mode) {
      case 'camp': {
        const camp = poiWorld(ctx, 'rebel_camp');
        if (!camp) break;
        const inCamp = ctx.map.zoneAtWorld(self.x, self.y)?.kind === 'rebel_camp';
        this.mover.speed = inCamp ? 60 : CHARACTER.runSpeed * 0.6;
        if (this.goal < 0 || this.mover.status === 'failed' || (this.mover.status === 'arrived' && this.relocate <= 0)) {
          this.relocate = ctx.rng.range(4, 10);
          const a = randomAnchorAround(camp, ctx, 1, 7, new Set());
          this.go(a >= 0 ? a : ctx.nav.nearestWalkable(camp.x, camp.y, 6));
        } else if (this.mover.status === 'arrived') this.mover.stop();
        break;
      }
      case 'gather': {
        if (!f) break;
        // HYDRA — рядом с главой, если он на этом же фронте.
        if (this.isHydra && lb && leader && (lb.mode === 'gather' || lb.mode === 'raid')) {
          if (this.repath <= 0 && Math.hypot(leader.x - self.x, leader.y - self.y) > COMMAND.escortRange) {
            this.repath = 1.5;
            this.go(ctx.nav.nearestWalkable(leader.x + ctx.rng.range(-40, 40), leader.y + ctx.rng.range(-40, 40), 3));
          }
          if (fighting && this.gunner.target) this.mover.stop();
          break;
        }
        if (!covered && (this.goal < 0 || this.mover.status === 'failed')) this.go(this.pickGather(f));
        // Заметили — отстреливается из укрытия рядом, но вперёд не лезет.
        if (fighting && this.gunner.target) {
          const home = this.goal >= 0 ? { x: ctx.nav.worldX(this.goal), y: ctx.nav.worldY(this.goal) } : null;
          if (!this.tactics.fight(self, ctx, this.gunner, this.mover, dt, home, TACTICS.leash * 0.6, FRONT_ZONES)) this.mover.stop();
        } else if (this.mover.status === 'idle' && this.goal >= 0 && Math.hypot(ctx.nav.worldX(this.goal) - self.x, ctx.nav.worldY(this.goal) - self.y) > 20) this.go(this.goal);
        else if (this.mover.status === 'arrived') this.mover.stop();
        break;
      }
      case 'raid': {
        if (!f) break;
        // Позиция: пустошь, с видом на внешние ворота (в укрытии боя — не дёргаться).
        if (!covered && (this.goal < 0 || this.relocate <= 0 || this.mover.status === 'failed')) {
          this.relocate = ctx.rng.range(WAR.relocateEvery[0], WAR.relocateEvery[1]);
          const pick = this.pickPosition(f);
          if (pick >= 0) this.go(pick);
        }
        // Часовых не видно (или цель скрылась) — огонь на подавление по постам (перестрелка не затихает).
        if ((!this.gunner.target || !self.aiming) && this.mover.status !== 'moving') this.suppress(f, dt);
        // Стреляя — из укрытия рядом с позицией (угол, завал), иначе стоит.
        if (fighting && this.gunner.target) {
          const home = this.goal >= 0 ? { x: ctx.nav.worldX(this.goal), y: ctx.nav.worldY(this.goal) } : null;
          if (!this.tactics.fight(self, ctx, this.gunner, this.mover, dt, home, TACTICS.leash, FRONT_ZONES)) this.mover.stop();
        } else if (this.mover.status === 'idle' && this.goal >= 0) this.go(this.goal);
        break;
      }
      case 'assault': {
        if (!f) break;
        // Все точки D наши — сначала сбор волны во внутреннем дворе (он наш), потом все разом на Управу.
        if (ctx.war.cityPush && !ctx.war.nexus.wave) {
          const yard = f.points[f.points.length - 1]?.floor ?? [];
          if (!this.stageSpot && yard.length) {
            let best = -1;
            let bestScore = Infinity;
            for (let k = 0; k < 12; k++) {
              const a = yard[Math.floor(ctx.rng.next() * yard.length)];
              const x = ctx.nav.worldX(a);
              const y = ctx.nav.worldY(a);
              // Ближе к выходу в город (проходной), не кучей.
              const score = Math.hypot(x - f.apron.x, y - f.apron.y) + 80 * this.crowdNear(x, y);
              if (score < bestScore) {
                bestScore = score;
                best = a;
              }
            }
            this.stageSpot = true;
            this.go(best);
          }
          if (this.mover.status === 'arrived' || (this.stageSpot && this.goal >= 0 && Math.hypot(ctx.nav.worldX(this.goal) - self.x, ctx.nav.worldY(this.goal) - self.y) < 20)) {
            this.staged = true;
            this.mover.stop();
          } else if (this.mover.status === 'failed' || (this.mover.status === 'idle' && !fighting)) this.stageSpot = false;
          this.mover.speed = fighting ? 55 : CHARACTER.runSpeed * 0.7;
          if (fighting && this.gunner.target) this.mover.stop();
          break;
        }
        // Остановился (перестрелка, уступил дорогу) — дальше к цели, иначе так и стоит в коридоре.
        const stalled = this.goal < 0 || this.mover.status === 'failed' || this.mover.status === 'arrived' || (this.mover.status === 'idle' && !(fighting && this.gunner.target));
        if (ctx.war.cityPush && (this.stageSpot || stalled)) {
          this.stageSpot = false;
          // Цель волны — Управа или (своих в тюрьме много) тюрьма.
          if (ctx.prison?.rescue && ctx.prison.center) {
            this.approach(ctx.prison.center);
            this.go(ctx.nav.nearestWalkable(ctx.prison.center.x, ctx.prison.center.y, 6));
          } else {
            this.approachNexus();
            this.go(randomAnchorInZone(ctx, 'nexus'));
          }
        } else if (stalled) {
          // Цель — за внутренними воротами, в город.
          const beyond = { x: f.apron.x + (f.apron.x - f.outerGate.x) * 0.6, y: f.apron.y + (f.apron.y - f.outerGate.y) * 0.6 };
          this.go(ctx.nav.nearestWalkable(beyond.x, beyond.y, 8));
        }
        // Прорыв: перебежками — стреляет, но не останавливается надолго.
        this.mover.speed = fighting ? 55 : CHARACTER.runSpeed * 0.75;
        break;
      }
      case 'capture': {
        if (!f) break;
        const C = WAR.capture;
        // Штурмуемый двор; во внутренний — через шорт или лонг (выбор в начале капта, как в CS).
        const k = f.capture?.point ?? Math.min(f.held, f.points.length - 1);
        const pt = f.points[k];
        // HYDRA идёт тем же путём и не отстаёт от главы.
        const withLeader = this.isHydra && lb && lb.mode === 'capture';
        if (withLeader) this.advance = Math.max(this.advance, lb.progress);
        if (this.routeFor !== k) {
          this.routeFor = k;
          // Звено идёт одним проходом: чётные — шорт, нечётные — лонг (как в CS — разделиться).
          const long = withLeader ? lb.viaLong : this.team >= 0 ? this.team % 2 === 1 : ctx.rng.chance(C.longChance);
          const via = k > 0 && f.long.length && long ? f.long : k > 0 ? f.short : [];
          this.viaLong = via === f.long && via.length > 0;
          // Точки маршрута у каждого свои (середина и конец прохода), не в одном месте со всеми.
          const taken = this.takenSpots(f);
          const pickOn = (lo: number, hi: number) => {
            const part = via.slice(Math.floor(lo * via.length), Math.max(Math.floor(lo * via.length) + 1, Math.ceil(hi * via.length)));
            const free = part.filter((a) => !taken.some((p) => Math.hypot(p.x - ctx.nav.worldX(a), p.y - ctx.nav.worldY(a)) < C.spacing));
            return ctx.rng.pick(free.length ? free : part);
          };
          this.route = via.length ? [pickOn(0.35, 0.65), pickOn(0.8, 1)] : [];
          this.entry = via.length ? via[Math.min(via.length - 1, 1)] : -1;
          this.routeStarted = withLeader ? lb.routeStarted : false;
          this.stackSince = -1;
          this.inCol = false;
          this.goal = -1;
        }
        // Колонна: звено идёт через проход след в след за ведущим, каждый смотрит в свой сектор.
        const lead = this.route.length ? this.pointman(f) : null;
        const pb = lead && lead !== self && lead.brain instanceof RebelBrain ? lead.brain : null;
        if (pb && pb.inColumn) {
          this.inCol = true;
          followColumn(self, ctx, this.mover, lead!, this.colK, dt, this.column);
          break;
        }
        if (this.inCol) {
          // Ведущий прошёл проход — дальше каждый своей полосой двора, без своего маршрута.
          this.inCol = false;
          this.route = [];
          this.routeStarted = true;
          this.goal = -1;
        }
        // В проход звено входит в свой такт переката; пока — стоит и прикрывает (огонь на подавление).
        if (this.route.length && !this.routeStarted) {
          const now = ctx.combat.now;
          if (lead === self && this.entry >= 0) {
            // Ведущий: встать у входа, подождать, пока звено выстроится за спиной, — и вперёд.
            if (this.stackSince < 0) {
              this.stackSince = now;
              this.stackReady = now + ctx.rng.range(TACTICS.stack.stackWait[0], TACTICS.stack.stackWait[1]);
              this.go(this.entry);
            }
            const atEntry = Math.hypot(ctx.nav.worldX(this.entry) - self.x, ctx.nav.worldY(this.entry) - self.y) < 18;
            const ready = now >= this.stackReady && (this.teamStacked(f) || now - this.stackSince > TACTICS.stack.stackMax);
            if (!atEntry || !ready || (!this.boundTurn(f) && !(withLeader && lb.routeStarted))) {
              if (atEntry) this.mover.stop();
              else if (this.mover.status === 'idle' || this.mover.status === 'failed') this.go(this.entry);
              if (!(fighting && this.gunner.target) && atEntry) this.suppress(f, dt);
              break;
            }
            this.stackSince = -1;
            self.say(ctx.rng.pick(['Заходим! За мной!', 'Пошли, пошли!', 'Колонной — вперёд!']), now, 1.6);
          } else if (!this.boundTurn(f) && !(withLeader && lb.routeStarted)) {
            if (this.mover.status !== 'moving' || (fighting && this.gunner.target)) this.mover.stop();
            if (!(fighting && this.gunner.target) && this.mover.status !== 'moving') this.suppress(f, dt);
            break;
          }
          this.routeStarted = true;
          this.goal = -1;
        }
        const at = (t: number) => (pt ? this.coverAt(pt.floor, pt.center, t, this.takenSpots(f)) : -1);
        // Медик на рожон не лезет: держится позади своего звена.
        const lag = self.profession === 'rebel_medic' ? WAR.capture.medicLag : 0;
        const target = () => (this.route.length ? this.route[0] : at(Math.max(0, this.advance - lag)));
        if (this.goal < 0 || this.mover.status === 'failed') this.go(target());
        const arrived = this.goal >= 0 && Math.hypot(ctx.nav.worldX(this.goal) - self.x, ctx.nav.worldY(this.goal) - self.y) < (this.route.length ? 24 : 14);
        if (arrived && this.route.length) {
          // Точка маршрута пройдена — дальше без остановки.
          this.route.shift();
          this.go(target());
        } else if (arrived) {
          this.mover.stop();
          // Прижали огнём — из укрытия не высовывается, но огрызается и давит огнём в ответ.
          const pinned = self.suppress >= SUPPRESS.pinned;
          this.coverLeft -= pinned ? 0 : dt;
          if (!(fighting && this.gunner.target)) this.suppress(f, dt);
          if (this.coverLeft <= 0 && this.advance < 1 && this.boundTurn(f)) {
            this.advance = Math.min(1, this.advance + C.advanceStep);
            this.coverLeft = ctx.rng.range(C.coverWait[0], C.coverWait[1]);
            this.go(at(Math.max(0, this.advance - lag)));
          }
          break;
        }
        // Перебежки: под огнём — короткая остановка на очередь, потом рывок к укрытию.
        this.phaseLeft -= dt;
        if (fighting && this.gunner.target) {
          if (this.phaseLeft <= 0) {
            this.shooting = !this.shooting || self.suppress >= SUPPRESS.pinned;
            this.phaseLeft = this.shooting ? ctx.rng.range(C.shootStop[0], C.shootStop[1]) : ctx.rng.range(C.dash[0], C.dash[1]);
            if (!this.shooting) bark(self, 'advance', ctx.combat.now, ctx.rng);
          }
        } else this.shooting = false;
        this.mover.speed = CHARACTER.runSpeed * 0.8 * (this.rallied ? COMMAND.rally.speedMul : 1);
        if (this.shooting) this.mover.stop();
        else if (this.mover.status === 'idle') this.go(this.goal);
        break;
      }
      case 'hold': {
        const p = this.holdPost;
        if (!p) break;
        if (!covered && (this.goal < 0 || this.mover.status === 'failed')) this.go(ctx.nav.nearestWalkable(p.x, p.y, 3));
        // Держит пост: бой — из укрытия у поста.
        if (fighting && this.gunner.target) {
          if (!this.tactics.fight(self, ctx, this.gunner, this.mover, dt, p, TACTICS.postLeash)) this.mover.stop();
        } else if (this.mover.status === 'idle' && Math.hypot(p.x - self.x, p.y - self.y) > 20) this.go(this.goal);
        break;
      }
      case 'storm': {
        // Своих в тюрьме много, а на воле мало — сперва выручить их.
        if (ctx.prison?.rescue) {
          this.stormPrison(self, ctx, dt, fighting);
          break;
        }
        this.jailCell = null;
        // Перебежками к Управе; внутри — меняет позицию, держит зону.
        const N = WAR.nexus;
        const C = WAR.capture;
        const inside = ctx.map.zoneAtWorld(self.x, self.y)?.kind === 'nexus';
        // В Управе — бой из-за углов коридоров, а не посреди зала.
        if (inside && fighting && this.gunner.target && this.tactics.fight(self, ctx, this.gunner, this.mover, dt, null, TACTICS.leash)) {
          this.goal = -1;
          break;
        }
        if (this.goal < 0 || this.mover.status === 'failed' || (this.mover.status === 'arrived' && (!inside || this.relocate <= 0))) {
          this.relocate = ctx.rng.range(N.relocate[0], N.relocate[1]);
          // Из нескольких точек Управы — где меньше своих (не толпой).
          let best = -1;
          let bestN = Infinity;
          for (let k = 0; k < 5; k++) {
            const a = randomAnchorInZone(ctx, 'nexus');
            if (a < 0) continue;
            const n = this.crowdNear(ctx.nav.worldX(a), ctx.nav.worldY(a)) + ctx.rng.range(0, 0.5);
            if (n < bestN) {
              bestN = n;
              best = a;
            }
          }
          // Внутри (или Управа уже взят) — часть бойцов идёт прямо на Коменданта: без него город не пал.
          if ((inside || ctx.war.nexus.fallen) && ctx.rng.chance(N.huntAdmin)) {
            const admin = ctx.entities.list.find((c) => c.alive && c.faction === 'admin');
            const a = admin ? ctx.nav.nearestWalkable(admin.x, admin.y, 4) : -1;
            if (a >= 0) best = a;
          }
          this.approachNexus();
          this.go(best);
        }
        this.phaseLeft -= dt;
        if (fighting && this.gunner.target) {
          if (this.phaseLeft <= 0) {
            this.shooting = !this.shooting;
            this.phaseLeft = this.shooting ? ctx.rng.range(C.shootStop[0], C.shootStop[1]) : ctx.rng.range(C.dash[0], C.dash[1]);
            if (!this.shooting) bark(self, 'advance', ctx.combat.now, ctx.rng);
          }
        } else this.shooting = false;
        this.mover.speed = CHARACTER.runSpeed * 0.75;
        if (this.shooting || (this.mover.status === 'arrived' && inside)) this.mover.stop();
        else if (this.mover.status === 'idle' && this.goal >= 0) this.go(this.goal);
        break;
      }
      case 'infiltrate': {
        if (fighting && this.gunner.target && self.health > self.maxHealth * 0.5) {
          if (!this.tactics.fight(self, ctx, this.gunner, this.mover, dt, null, TACTICS.leash)) this.mover.stop();
          this.goal = -1;
          break;
        }
        if (this.goal < 0 || this.mover.status === 'arrived' || this.mover.status === 'failed' || this.mover.status === 'idle') {
          const avoid = zoneIds(ctx, ['nexus', 'cells', 'checkpoint', 'outlands', 'plaza', 'avenue', 'wasteland', 'rebel_camp']);
          const g = randomAnchorAround(self, ctx, 12, 45, avoid);
          this.mover.speed = CHARACTER.runSpeed * 0.7;
          this.go(g);
        }
        break;
      }
      case 'retreat': {
        this.mover.speed = CHARACTER.runSpeed * 0.7;
        // Отход тропой в лагерь: там лечение и патроны.
        const camp = poiWorld(ctx, 'rebel_camp');
        if (camp) {
          if (ctx.map.zoneAtWorld(self.x, self.y)?.kind === 'rebel_camp') {
            this.toCamp();
            break;
          }
          if (this.goal < 0 || this.mover.status === 'failed' || this.mover.status === 'arrived') this.go(ctx.nav.nearestWalkable(camp.x, camp.y, 6));
          break;
        }
        if (!f) {
          this.departed = true;
          break;
        }
        if (this.goal < 0 || this.mover.status === 'failed') {
          // Самая дальняя от ворот точка пустоши.
          let best = -1;
          let bestD = -1;
          for (const a of f.outlands) {
            const d = Math.hypot(ctx.nav.worldX(a) - f.outerGate.x, ctx.nav.worldY(a) - f.outerGate.y);
            if (d > bestD) {
              bestD = d;
              best = a;
            }
          }
          this.go(best);
        }
        if (this.mover.status === 'arrived') this.departed = true;
        break;
      }
    }
    this.mover.update(self, ctx, dt);
    if (this.gunner.look(self, ctx, dt)) return;
    if (this.tactics.face(self, dt)) return;
    // В колонне на месте — каждый смотрит в свой сектор.
    if (this.inCol && this.colLead && self.moveSpeed < 8) {
      watchSector(self, this.colLead, this.colK, this.colLast, dt);
      return;
    }
    // На позиции смотрит на КПП (глаз на спине нет — иначе часовых не заметить).
    if ((this.mode === 'raid' || this.mode === 'gather') && f && self.moveSpeed < 8) {
      const post = f.posts[0] ?? f.outerGate;
      faceTowards(self, (post.x + f.outerGate.x) / 2, (post.y + f.outerGate.y) / 2, dt);
    } else if (this.mode === 'hold' && this.holdFace && self.moveSpeed < 8) faceTowards(self, this.holdFace.x, this.holdFace.y, dt);
    else faceMovement(self, ctx, dt);
  }
}

/** Есть ли бетонный завал на линии огня в пределах WAR.coverReach от стрелка. */
function coverOnLine(ctx: AiContext, x: number, y: number, tx: number, ty: number): boolean {
  const d = Math.hypot(tx - x, ty - y) || 1;
  const ts = ctx.map.tileSize;
  for (let t = 14; t <= WAR.coverReach; t += 4) {
    const px = x + ((tx - x) / d) * t;
    const py = y + ((ty - y) / d) * t;
    if (ctx.map.tileAt(Math.floor(px / ts), Math.floor(py / ts)) === T.BARRIER) return true;
  }
  return false;
}

/** Поперечная координата якорей двора (от входа к центру) — для полос звеньев; считается один раз. */
interface Lateral {
  of: Map<number, number>;
  min: number;
  max: number;
}
const lateralCache = new WeakMap<readonly number[], Lateral>();
function lateralOf(ctx: AiContext, floor: readonly number[], center: Vec2): Lateral {
  const cached = lateralCache.get(floor);
  if (cached) return cached;
  const ex = ctx.nav.worldX(floor[0]);
  const ey = ctx.nav.worldY(floor[0]);
  const len = Math.hypot(center.x - ex, center.y - ey);
  const nx = len > 1 ? (center.x - ex) / len : 1;
  const ny = len > 1 ? (center.y - ey) / len : 0;
  const lat: Lateral = { of: new Map(), min: Infinity, max: -Infinity };
  for (const a of floor) {
    const v = (ctx.nav.worldX(a) - ex) * ny - (ctx.nav.worldY(a) - ey) * nx;
    lat.of.set(a, v);
    lat.min = Math.min(lat.min, v);
    lat.max = Math.max(lat.max, v);
  }
  lateralCache.set(floor, lat);
  return lat;
}
