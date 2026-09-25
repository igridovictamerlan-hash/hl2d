import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { Vec2 } from '../core/math';
import { WAR } from '../config/war';
import { ALARM } from '../config/underground';
import { FACTIONS } from '../config/factions';
import { T } from '../world/tiles';
import { createCharacter } from '../entities/factory';
import { equipKit, poiWorld } from './Population';
import { RebelBrain } from '../ai/brains/RebelBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { OtaBrain } from '../ai/brains/OtaBrain';
import { CitizenBrain } from '../ai/brains/CitizenBrain';

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
}

/** Как радио называет особых бойцов отряда. */
const KIT_ROLE: Record<string, string> = { rebel_commander: 'командир', rebel_marksman: 'арбалетчик', rebel_shotgunner: 'дробовик', rebel_rifleman: 'AR2' };

/** Фронт — пограничный КПП: пустошь с отрядами повстанцев по ту сторону ворот. */
export interface Front {
  index: number;
  name: string;
  /** Центр пустоши, px. */
  exit: Vec2;
  /** Центры внешних и внутренних ворот, точка за внутренними (в сторону города). */
  outerGate: Vec2;
  innerGate: Vec2;
  apron: Vec2;
  posts: Vec2[];
  /** Якоря пустоши у этого КПП и укрытия бункера. */
  outlands: number[];
  bunker: number[];
  /** Все бойцы повстанцев на этом фронте (из всех подошедших отрядов). */
  squad: Character[];
  nextSquadAt: number;
  /** Когда подойдёт следующая волна (сверх минимума). */
  nextWaveAt: number;
  /** Когда здесь последний раз стреляли (для маркеров на экране). */
  lastShot: number;
  /** Сколько секунд на КПП нет ни одного часового на посту. */
  unguarded: number;
  /** О штурме текущего отряда уже сообщили. */
  assaultAnnounced: boolean;
  /** Пол коридора КПП, от внешних ворот к внутренним. */
  corridor: number[];
  /** Кто держит КПП и идущий капт (счёт убийств). */
  owner: 'combine' | 'rebels';
  capture: Capture | null;
  nextCaptureAt: number;
  heldSince: number;
  /** Сколько секунд в зоне захваченного КПП нет повстанцев. */
  rebelFree: number;
  /** Когда следующий контрудар по захваченному КПП. */
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

  constructor(private readonly ctx: AiContext) {
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

  private buildFronts(): void {
    const { map, nav, rng } = this.ctx;
    const ts = map.tileSize;
    const exits = map.poisOf('outlands_exit');
    const posts = map.poisOf('checkpoint_post').map((p) => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts }));
    exits.forEach((e, index) => {
      const exit = { x: (e.x + 0.5) * ts, y: (e.y + 0.5) * ts };
      const myPosts = posts.filter((p) => exits.every((o) => Math.hypot(p.x - exit.x, p.y - exit.y) <= Math.hypot(p.x - (o.x + 0.5) * ts, p.y - (o.y + 0.5) * ts)));
      const zone = myPosts[0] ? map.zoneAtWorld(myPosts[0].x, myPosts[0].y) : null;
      const gates: Vec2[] = [];
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (map.tileAt(x, y) === T.GATE && map.zoneAtTile(x, y) === zone) gates.push({ x: (x + 0.5) * ts, y: (y + 0.5) * ts });
        }
      }
      const dExit = (p: Vec2) => Math.hypot(p.x - exit.x, p.y - exit.y);
      const mid = gates.reduce((s, g) => s + dExit(g), 0) / Math.max(1, gates.length);
      const avg = (list: Vec2[]) => ({ x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length });
      const outer = gates.filter((g) => dExit(g) <= mid);
      const inner = gates.filter((g) => dExit(g) > mid);
      const outerGate = outer.length ? avg(outer) : exit;
      const innerGate = inner.length ? avg(inner) : exit;
      const dl = Math.hypot(innerGate.x - outerGate.x, innerGate.y - outerGate.y) || 1;
      const apron = { x: innerGate.x + ((innerGate.x - outerGate.x) / dl) * 56, y: innerGate.y + ((innerGate.y - outerGate.y) / dl) * 56 };
      const outlands: number[] = [];
      const bunker: number[] = [];
      const corridor: number[] = [];
      for (const a of nav.walkable) {
        const x = nav.worldX(a);
        const y = nav.worldY(a);
        const kind = map.zones[nav.zone[a]]?.kind;
        if (kind === 'outlands' && dExit({ x, y }) < 14 * ts) outlands.push(a);
        if (map.zones[nav.zone[a]] === zone && map.tileAt(nav.ax(a) + 1, nav.ay(a) + 1) === T.INTERIOR) bunker.push(a);
        if (map.zones[nav.zone[a]] === zone && map.tileAt(nav.ax(a) + 1, nav.ay(a) + 1) === T.BUNKER) corridor.push(a);
      }
      this.fronts.push({
        index, name: zone?.name ?? `КПП ${index + 1}`, exit, outerGate, innerGate, apron, posts: myPosts, outlands, bunker,
        squad: [], nextSquadAt: rng.range(WAR.firstSquad[0], WAR.firstSquad[1]), nextWaveAt: rng.range(WAR.waveEvery[0], WAR.waveEvery[1]),
        lastShot: -1e9, reinforceAt: 0, medicAt: 0, unguarded: 0, assaultAnnounced: false,
        corridor: corridor.sort((a, b) => Math.hypot(nav.worldX(a) - outerGate.x, nav.worldY(a) - outerGate.y) - Math.hypot(nav.worldX(b) - outerGate.x, nav.worldY(b) - outerGate.y)),
        owner: 'combine', capture: null, nextCaptureAt: WAR.capture.firstAfter * (1 + index) + rng.range(0, 30), heldSince: 0, rebelFree: 0, retakeAt: 0,
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

  /** Принудительный штурм (отладка, тесты): текущий отряд идёт на прорыв. */
  forceAssault(front = 0): void {
    const f = this.fronts[front];
    if (!f) return;
    if (f.squad.length === 0) this.spawnSquad(f, true);
    for (const r of f.squad) rebelBrain(r)?.orderAssault();
  }

  private spawnSquad(f: Front, assault: boolean): void {
    const { rng, nav } = this.ctx;
    if (f.outlands.length === 0) return;
    // Спавн — в дальней от ворот части пустоши.
    const far = [...f.outlands].sort(
      (a, b) =>
        Math.hypot(nav.worldX(b) - f.outerGate.x, nav.worldY(b) - f.outerGate.y) -
        Math.hypot(nav.worldX(a) - f.outerGate.x, nav.worldY(a) - f.outerGate.y),
    ).slice(0, Math.max(6, Math.floor(f.outlands.length / 3)));
    const n = rng.int(WAR.squadSize[0], WAR.squadSize[1]);
    const assaultAt = assault ? this.time + rng.range(WAR.assaultAfter[0], WAR.assaultAfter[1]) : Infinity;
    if (assault) f.assaultAnnounced = false;
    const roles: string[] = [];
    for (let k = 0; k < n; k++) {
      const a = rng.pick(far);
      let kit = rng.chance(WAR.rifleChance) ? 'rebel_rifleman' : 'rebel_raider';
      let rank = Math.min(rng.int(0, 3), rng.int(0, 3));
      if (k === 0 && rng.chance(WAR.commanderChance)) {
        kit = 'rebel_commander';
        rank = 4;
      } else if (k === 1 && !assault && rng.chance(WAR.marksmanChance)) {
        kit = 'rebel_marksman';
        rank = Math.max(rank, 2);
      } else if (rng.chance(assault ? WAR.shotgunChance * 2 : WAR.shotgunChance)) kit = 'rebel_shotgunner';
      const c = createCharacter(this.ctx.entities, rng, 'rebel', nav.worldX(a) + rng.range(-4, 4), nav.worldY(a) + rng.range(-4, 4), false, rank);
      equipKit(c, kit, this.ctx);
      const brain = new RebelBrain(c, this.ctx, f.index, assaultAt);
      c.brain = brain;
      // Подошли во время капта — сразу в бой за КПП.
      if (f.capture) brain.orderCapture();
      f.squad.push(c);
      roles.push(KIT_ROLE[kit] ?? '');
    }
    const extra = roles.filter(Boolean);
    this.ctx.law.log(
      `${f.name}: контакт! Отряд повстанцев у ворот (${n}${extra.length ? `: ${extra.join(', ')}` : ''})${assault ? ', готовится штурм' : ''}.`,
      'radio',
    );
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

  private reinforce(f: Front, medic: boolean, quiet = false): void {
    const { rng, nav } = this.ctx;
    // Подкрепление подвозят к внутренним воротам КПП (с городской стороны).
    const a = nav.nearestWalkable(f.apron.x + rng.range(-16, 16), f.apron.y + rng.range(-16, 16), 6);
    if (a < 0) return;
    const c = createCharacter(this.ctx.entities, rng, 'cp', nav.worldX(a), nav.worldY(a), false, rng.int(0, 4));
    if (medic) {
      c.division = 'helix';
      equipKit(c, 'cp_helix', this.ctx);
      const st = f.bunker.length ? rng.pick(f.bunker) : a;
      c.brain = new CpBrain(c, this.ctx, { front: f.index, medicStation: { x: nav.worldX(st), y: nav.worldY(st) } });
    } else {
      c.division = 'grid';
      equipKit(c, 'cp_grid', this.ctx);
      const taken = this.guardsOf(f).guards.map((g) => (g.brain as CpBrain).guardPost!);
      const post = f.posts.find((p) => !taken.some((t) => t.x === p.x && t.y === p.y)) ?? rng.pick(f.posts);
      const facing = Math.atan2(f.exit.y - post.y, f.exit.x - post.x);
      c.brain = new CpBrain(c, this.ctx, { front: f.index, post, facing });
    }
    if (!quiet) this.ctx.law.log(`${f.name}: подкрепление в пути — ${c.name} (${medic ? 'HELIX' : 'GRID'}).`, 'radio');
  }

  /** В городе ли точка (не КПП, не пустошь, не канализация) — там нападение поднимает тревогу. */
  private inCity(x: number, y: number): boolean {
    if (this.ctx.map.levelAt(x, y) !== 'city') return false;
    const kind = this.ctx.map.zoneAtWorld(x, y)?.kind;
    return kind !== 'checkpoint' && kind !== 'outlands';
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

  /** Начать капт КПП (или принудительно — для тестов и отладки). */
  startCapture(f: Front): void {
    if (f.capture || f.owner !== 'combine') return;
    f.capture = { since: this.time, until: this.time + WAR.capture.duration, rebelKills: 0, cpKills: 0 };
    this.ctx.law.log(`${f.name}: КАПТ! Повстанцы начали захват КПП. Всем постам — держать оборону!`, 'radio');
    this.ctx.bus.emit('announce', { text: `Капт · ${f.name}` });
    for (const r of f.squad) rebelBrain(r)?.orderCapture();
  }

  private endCapture(f: Front, won: boolean): void {
    const c = f.capture;
    if (!c) return;
    f.capture = null;
    f.nextCaptureAt = this.time + WAR.capture.cooldown;
    const score = `${c.rebelKills} : ${c.cpKills}`;
    if (!won) {
      this.ctx.law.log(`${f.name}: капт отбит (${score}). КПП удержан.`, 'radio');
      this.ctx.bus.emit('announce', { text: `КПП удержан · ${score}` });
      for (const r of f.squad) rebelBrain(r)?.orderRaid();
      return;
    }
    f.owner = 'rebels';
    f.heldSince = this.time;
    f.retakeAt = this.time + WAR.capture.holdTime;
    f.rebelFree = 0;
    f.reinforceAt = 0;
    this.ctx.law.log(`${f.name}: КПП ЗАХВАЧЕН повстанцами (${score})!`, 'radio');
    this.ctx.bus.emit('announce', { text: `КПП захвачен · ${score}` });
    // Повстанцы занимают посты часовых; остальные остаются в коридоре.
    f.squad.forEach((r, k) => {
      if (k < f.posts.length) rebelBrain(r)?.orderHold(f.posts[k]);
    });
    if (this.code !== 'red') this.declareRed(f.name, 'КПП захвачен повстанцами');
  }

  /** Капт: старт при сборе повстанцев, таймер, удержание и возврат захваченного КПП. */
  private updateCapture(f: Front, dt: number): void {
    const W = WAR.capture;
    const rebels = this.ctx.entities.list.filter((c) => c.alive && c.faction === 'rebel' && this.frontAt(c.x, c.y) === f).length;
    if (f.owner === 'combine') {
      if (!f.capture && rebels >= W.minAttackers && this.time >= f.nextCaptureAt) this.startCapture(f);
      const c = f.capture;
      if (c && this.time >= c.until) this.endCapture(f, c.rebelKills >= W.minKills && c.rebelKills > c.cpKills);
      return;
    }
    // Захвачен: контрудары отрядами GRID; КПП отбит — когда в самом КПП (не на пустоши) не осталось повстанцев.
    const inside = this.ctx.entities.list.filter(
      (c) => c.alive && c.faction === 'rebel' && this.ctx.map.zoneAtWorld(c.x, c.y)?.kind === 'checkpoint' && this.frontAt(c.x, c.y) === f,
    ).length;
    if (this.time >= f.retakeAt) {
      f.retakeAt = this.time + W.retakeEvery;
      for (let k = 0; k < W.retakeSquad; k++) this.reinforce(f, false, k > 0);
      this.ctx.law.log(`${f.name}: контрудар — отряд GRID (${W.retakeSquad}) идёт отбивать КПП.`, 'radio');
    }
    f.rebelFree = inside === 0 ? f.rebelFree + dt : 0;
    if (this.time - f.heldSince >= W.holdTime && f.rebelFree >= W.retakeCalm) {
      f.owner = 'combine';
      this.ctx.law.log(`${f.name}: КПП отбит. Гарнизон восстанавливается.`, 'radio');
      this.ctx.bus.emit('announce', { text: `КПП отбит · ${f.name}` });
      for (const r of f.squad) rebelBrain(r)?.orderRaid();
    }
  }

  private onDamage(target: Character, attacker: Character | null, killed: boolean): void {
    if (attacker && killed) this.countCaptureKill(target, attacker);
    if (!attacker || !FACTIONS[target.faction].authority || FACTIONS[attacker.faction].authority) return;
    if (!this.inCity(target.x, target.y)) return;
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

  private declareRed(where: string, why = 'Прорыв периметра'): void {
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
    const gate = poiWorld(this.ctx, 'nexus_gate');
    if (!gate) return;
    const { rng, nav } = this.ctx;
    for (let k = 0; k < WAR.otaSquad; k++) {
      const a = nav.nearestWalkable(gate.x + rng.range(-24, 24), gate.y + rng.range(-24, 24), 6);
      if (a < 0) continue;
      const c = createCharacter(this.ctx.entities, rng, 'ota', nav.worldX(a), nav.worldY(a), false);
      equipKit(c, rng.chance(WAR.otaShotgunChance) ? 'ota_shotgun' : 'ota', this.ctx);
      c.brain = new OtaBrain(c, this.ctx);
      this.ota.push(c);
    }
    this.ctx.law.log(`Надзор: отряд OTA (${WAR.otaSquad}) развёрнут из Нексуса.`, 'radio');
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

  private declareGreen(): void {
    const wasCurfew = this.curfew;
    this.code = 'green';
    this.curfew = false;
    this.shelterClaims.clear();
    this.alarm = null;
    this.ctx.law.log(
      wasCurfew ? 'Администрация: Код зелёный. Комендантский час отменён. Благодарим за сотрудничество.' : 'Администрация: Код зелёный. Отбой тревоги. Благодарим за бдительность.',
      'world',
    );
    this.ctx.bus.emit('alert', { code: 'green' });
    this.ctx.bus.emit('announce', { text: 'Код зелёный' });
    for (const o of this.ota) (o.brain as OtaBrain | null)?.goHome();
  }

  /** Идёт ли сейчас бой у КПП (стреляли недавно). */
  active(f: Front): boolean {
    return this.time - f.lastShot < WAR.activeWindow;
  }

  update(dt: number): void {
    this.time += dt;
    const { entities, map } = this.ctx;
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
    for (const f of this.fronts) {
      // Отряд: живые, не ушедшие, не прорвавшиеся.
      f.squad = f.squad.filter((r) => {
        if (!r.alive) return false;
        const b = r.brain as RebelBrain | null;
        if (b instanceof RebelBrain && b.departed) {
          entities.remove(r);
          return false;
        }
        const kind = map.zoneAtWorld(r.x, r.y)?.kind;
        if (kind !== 'outlands' && kind !== 'checkpoint') {
          // Прорыв в город.
          this.infiltrators.add(r);
          this.lastKnown.set(r, { x: r.x, y: r.y });
          if (b instanceof RebelBrain) b.infiltrate();
          if (this.code !== 'red') this.declareRed(f.name);
          return false;
        }
        return true;
      });
      // Подход отрядов: минимум бойцов держится всегда, сверх него — волнами до maxRebels.
      const rng = this.ctx.rng;
      const holding = f.squad.length;
      const low = holding < (f.capture ? WAR.capture.minAttackers : WAR.minRebels) && this.time >= f.nextSquadAt;
      const wave = this.time >= f.nextWaveAt && holding + WAR.squadSize[1] <= WAR.maxRebels;
      if (low || wave) {
        const { guards } = this.guardsOf(f);
        // Никого на посту — отряд идёт на штурм сразу.
        const assault = guards.length === 0 || rng.chance(WAR.assaultChance);
        this.spawnSquad(f, assault);
        // Во время капта подкрепления повстанцев подходят вдвое быстрее.
        f.nextSquadAt = this.time + rng.range(WAR.squadGap[0], WAR.squadGap[1]) * (f.capture ? 0.5 : 1);
        f.nextWaveAt = this.time + rng.range(WAR.waveEvery[0], WAR.waveEvery[1]);
      } else if (holding >= WAR.minRebels) {
        // Пока бойцов хватает, таймер подхода не «копится».
        f.nextSquadAt = Math.max(f.nextSquadAt, this.time + WAR.squadGap[0]);
      }
      this.updateCapture(f, dt);
      // Подкрепления ГО.
      const { guards, medics } = this.guardsOf(f);
      // Часовые выбиты или отошли — отряд у ворот идёт на прорыв (во время капта — нет: там свой счёт).
      const onPost = guards.filter((g) => (g.brain as CpBrain).fsm.current !== 'retreat').length;
      f.unguarded = onPost === 0 && f.squad.length > 0 && !f.capture && f.owner === 'combine' ? f.unguarded + dt : 0;
      if (f.unguarded > WAR.pushWhenUnguarded) {
        f.unguarded = 0;
        for (const r of f.squad) rebelBrain(r)?.orderAssault();
        this.ctx.law.log(`${f.name}: пост оголён — повстанцы идут в коридор!`, 'radio');
        f.assaultAnnounced = true;
      }
      if (!f.assaultAnnounced && f.squad.some((r) => rebelBrain(r)?.mode === 'assault')) {
        f.assaultAnnounced = true;
        this.ctx.law.log(`${f.name}: повстанцы идут на прорыв!`, 'radio');
      }
      // Нехватка часовых: погибли — или двое+ отошли раненными (тогда — один сверх штата).
      // Во время капта оборону подкрепляют быстрее и сверх штата; у захваченного КПП — только контрудары.
      const extra = f.capture ? WAR.capture.defenseExtra : 0;
      const short = guards.length < WAR.guardsPerFront + extra || (onPost < WAR.guardsPerFront - 1 && guards.length < WAR.guardsPerFront + 1);
      if (short && f.owner === 'combine') {
        if (f.reinforceAt === 0) f.reinforceAt = this.time + WAR.reinforceDelay * (f.capture ? WAR.capture.defenseReinforceMul : 1);
        else if (this.time >= f.reinforceAt) {
          f.reinforceAt = 0;
          this.reinforce(f, false);
        }
      } else f.reinforceAt = 0;
      if (medics.length < WAR.medicPerFront) {
        if (f.medicAt === 0) f.medicAt = this.time + WAR.reinforceDelay * 1.5;
        else if (this.time >= f.medicAt) {
          f.medicAt = 0;
          this.reinforce(f, true);
        }
      } else f.medicAt = 0;
    }

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
    if (this.code === 'yellow') {
      this.calm = this.operatives.size === 0 ? this.calm + dt : 0;
      if (this.calm >= ALARM.calmToGreen && this.time - this.yellowSince >= ALARM.minTime) this.declareGreen();
    }
    // «Надзор» периодически засекает прорвавшихся.
    this.scanTimer -= dt;
    if (this.scanTimer <= 0 && this.code === 'red') {
      this.scanTimer = WAR.overwatchScan;
      for (const r of this.infiltrators) this.lastKnown.set(r, { x: r.x + this.ctx.rng.range(-48, 48), y: r.y + this.ctx.rng.range(-48, 48) });
    }
    if (this.code === 'red') {
      // Красный код держится, пока есть прорвавшиеся или КПП в руках повстанцев.
      this.calm = this.infiltrators.size === 0 && this.fronts.every((f) => f.owner === 'combine') ? this.calm + dt : 0;
      const long = this.time - this.redSince;
      if (long > WAR.redMaxTime && this.infiltrators.size > 0) this.goUnderground();
      const held = this.fronts.some((f) => f.owner === 'rebels');
      if ((this.calm >= WAR.calmToGreen && long >= WAR.redMinTime) || (long > WAR.redMaxTime && !held)) this.declareGreen();
    }
    // OTA, вернувшиеся в Нексус, уходят.
    for (let i = this.ota.length - 1; i >= 0; i--) {
      const o = this.ota[i];
      const b = o.brain as OtaBrain | null;
      if (!o.alive || b?.departed) {
        if (o.alive) entities.remove(o);
        this.ota.splice(i, 1);
      }
    }
  }
}
