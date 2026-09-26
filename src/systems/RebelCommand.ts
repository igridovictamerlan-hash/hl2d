import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import { RebelBrain } from '../ai/brains/RebelBrain';
import { COMMAND, ROSTER } from '../config/roster';
import type { ProfessionId } from '../config/professions';
import { CHARACTER } from '../config/entities';
import { armySpec, equipKit } from './Population';
import { WAR } from '../config/war';
import type { Front } from './WarSystem';

/** Идущий клич главы: кто кричал, до какого времени, на каком фронте. */
export interface Rally {
  leader: Character;
  until: number;
  front: number;
}

/**
 * Командование сопротивления. Армия (постоянный состав: глава, ветераны, солдаты, пиротехник,
 * подрывник и спецотряд HYDRA) живёт в лагере в пустоши и ходит к КПП тропой. Глава выбирает, какой
 * КПП штурмовать: большинство идёт туда, отвлекающая группа (COMMAND.diversion бойцов) — на второй.
 * Игрок-глава выбирает сам: армия идёт на тот КПП, у которого он. Раненые и без патронов уходят в
 * лагерь, лечатся и возвращаются. Клич главы — бойцы рядом на время идут за ним на штурм.
 */
export class RebelCommand {
  readonly army: Character[] = [];
  /** Фронт, который штурмует большинство. */
  target = 0;
  rally: Rally | null = null;
  /** Армия не выходит из лагеря (тесты). */
  paused = false;
  private time = 0;
  private started = false;
  private fails = 0;
  private rallyReady = 0;
  private readonly diversion = new Set<Character>();
  /** Сколько раз глава менял цель и кричал клич (для тестов и отладки). */
  readonly stats = { retargets: 0, rallies: 0 };

  constructor(private readonly ctx: AiContext) {}

  get now(): number {
    return this.time;
  }

  /** Глава восстания: игрок в этой профессии или NPC. */
  get leader(): Character | null {
    const p = this.ctx.player;
    if (p?.alive && p.faction === 'rebel' && p.profession === 'rebel_leader') return p;
    return this.army.find((c) => c.alive && c.profession === 'rebel_leader') ?? null;
  }

  /** Игрок стал главой: NPC-глава — ветеран (глава восстания один). */
  demoteNpcLeader(): void {
    for (const c of this.army) {
      if (c.profession !== 'rebel_leader' || c.isPlayer) continue;
      this.retire(c, 'veteran', 'rebel_veteran');
    }
  }

  /** Сменить бойцу профессию (набор, здоровье, роль для возрождения). */
  private retire(c: Character, profession: ProfessionId, kit: string): void {
    c.profession = profession;
    c.rank = ROSTER.rank[profession] ?? c.rank;
    c.role = { ...armySpec(profession, kit, c.rank), name: c.name };
    equipKit(c, kit, this.ctx);
    c.maxHealth = ROSTER.hp[profession] ?? CHARACTER.maxHealth;
    c.health = Math.min(c.health, c.maxHealth);
  }

  /**
   * Главы нет (игрок перестал им быть, а NPC-главу разжаловали) и никто не ждёт возрождения в этой
   * роли — главой становится ветеран.
   */
  private ensureLeader(): void {
    if (this.leader || this.ctx.roster?.pending('leader')) return;
    const vet = this.army.find((c) => c.alive && !c.isPlayer && c.profession === 'veteran');
    if (!vet) return;
    this.retire(vet, 'rebel_leader', 'rebel_leader');
    vet.health = vet.maxHealth;
    this.ctx.insurgency.radio(`${vet.name} — новый глава восстания.`);
  }

  /** Новый (или возрождённый) боец армии. */
  join(c: Character): void {
    if (!this.army.includes(c)) this.army.push(c);
    const b = c.brain;
    if (b instanceof RebelBrain) b.setFront(this.frontFor(c));
  }

  /** Куда идёт боец: отвлекающая группа — на второй КПП, остальные — на цель главы. */
  frontFor(c: Character): number {
    const n = this.ctx.war.fronts.length;
    return this.diversion.has(c) && n > 1 ? (this.target + 1) % n : this.target;
  }

  /** Кто в отвлекающей группе: первые ветераны и солдаты по порядку в составе. */
  private pickDiversion(): void {
    this.diversion.clear();
    const alive = this.army.filter((c) => c.alive && (c.profession === 'veteran' || c.profession === 'rebel_soldier'));
    const vet = alive.find((c) => c.profession === 'veteran');
    if (vet) this.diversion.add(vet);
    for (const c of alive) {
      if (this.diversion.size >= COMMAND.diversion) break;
      if (c.profession === 'rebel_soldier') this.diversion.add(c);
    }
  }

  /**
   * Глава выбирает КПП: из ещё не прорванных — где точки уже наши (закрепить успех), иначе — где
   * меньше защитников у очередной точки. Сообщает своим по связи; «Надзор» перехватывает — ГО знает, куда идут.
   */
  pickTarget(reason = ''): void {
    const war = this.ctx.war;
    if (!war.fronts.length) return;
    const leader = this.leader;
    if (leader?.isPlayer) return;
    let best = this.target;
    let bestScore = -Infinity;
    // Прорванный КПП держат оставшиеся на постах; армия идёт на следующий (в город — только когда все прорваны).
    const open = war.fronts.filter((f) => f.owner !== 'rebels');
    for (const f of open.length ? open : war.fronts) {
      let score = f.held * 4 + this.ctx.rng.range(0, 1.5);
      score -= war.defendersAt(f, Math.min(f.held, f.points.length - 1));
      if (f.index === this.target && reason) score -= 3;
      if (score > bestScore) {
        bestScore = score;
        best = f.index;
      }
    }
    const changed = best !== this.target || !this.started;
    this.target = best;
    this.fails = 0;
    if (!changed) return;
    this.stats.retargets++;
    const f = war.fronts[best];
    const who = leader ? leader.name : 'Штаб';
    this.ctx.insurgency.radio(`${who}: все на ${f.name}!${reason ? ` (${reason})` : ''}`);
    this.ctx.law.log(`Надзор: крупные силы повстанцев движутся к ${f.name}.`, 'radio');
    leader?.say(`Идём на ${f.points[Math.min(f.held, f.points.length - 1)].name}!`, this.ctx.law.now, 3);
  }

  /** Капт на фронте закончился: неудачи подряд на цели — глава пересматривает выбор. */
  onCaptureEnd(front: number, won: boolean): void {
    if (front !== this.target) return;
    if (won) {
      this.fails = 0;
      return;
    }
    if (++this.fails >= COMMAND.retargetAfterFails) this.pickTarget('штурм захлебнулся');
  }

  /**
   * Звенья штурма на фронте f: глава со спецотрядом HYDRA — звено 0, остальные штурмующие — по
   * WAR.capture.teamSize. reset — капт только начался (раздать заново); иначе — только бойцам без
   * звена (подошли по кличу), в самое малочисленное звено.
   */
  formTeams(f: Front, reset: boolean): void {
    const T = WAR.capture;
    const members = f.squad.filter((r) => r.alive && r.brain instanceof RebelBrain && r.brain.mode === 'capture');
    const brains = members.map((r) => r.brain as RebelBrain);
    const leader = this.leader;
    const leaderHere = !!leader && members.includes(leader);
    if (reset) {
      for (const b of brains) b.setTeam(-1);
      let next = 0;
      if (leaderHere) {
        for (const r of members) if (r === leader || (r.brain as RebelBrain).isHydra) (r.brain as RebelBrain).setTeam(0);
        next = 1;
      }
      const rest = members.filter((r) => (r.brain as RebelBrain).team < 0).sort((a, b) => a.id - b.id);
      rest.forEach((r, k) => (r.brain as RebelBrain).setTeam(next + Math.floor(k / T.teamSize)));
      return;
    }
    const loose = brains.filter((b) => b.team < 0);
    if (!loose.length) return;
    const size = new Map<number, number>();
    for (const b of brains) if (b.team > 0 || (b.team === 0 && !leaderHere)) size.set(b.team, (size.get(b.team) ?? 0) + 1);
    for (const b of loose) {
      let best = -1;
      for (const [t, n] of size) if (n < T.teamSize && (best < 0 || n < size.get(best)!)) best = t;
      if (best < 0) best = size.size ? Math.max(...size.keys()) + 1 : leaderHere ? 1 : 0;
      b.setTeam(best);
      size.set(best, (size.get(best) ?? 0) + 1);
    }
  }

  /** Клич: бойцы в радиусе идут за главой COMMAND.rally.time секунд. null — удалось, иначе причина. */
  shout(leader: Character): string | null {
    if (this.time < this.rallyReady) return `Клич ещё не готов: ${Math.ceil(this.rallyReady - this.time)} с.`;
    const f = this.ctx.war.frontAt(leader.x, leader.y);
    this.rally = { leader, until: this.time + COMMAND.rally.time, front: f?.index ?? this.target };
    this.rallyReady = this.time + COMMAND.rally.cooldown;
    this.stats.rallies++;
    leader.say('За мной! На штурм!', this.ctx.law.now, 3);
    let n = 0;
    for (const c of this.army) {
      if (c === leader || !c.alive || Math.hypot(c.x - leader.x, c.y - leader.y) > COMMAND.rally.radius) continue;
      if (n++ < 3) c.say(this.ctx.rng.pick(['Вперёд!', 'За главой!', 'Урааа!']), this.ctx.law.now + 0.3 * n, 2);
    }
    this.ctx.insurgency.radio(`${leader.name}: клич — все за мной!`);
    return null;
  }

  /** За кем идёт боец по кличу (null — клича нет или он далеко). */
  rallyFor(c: Character): Character | null {
    const r = this.rally;
    if (!r || c === r.leader || !r.leader.alive || this.time >= r.until) return null;
    if (this.ctx.map.levelAt(c.x, c.y) !== this.ctx.map.levelAt(r.leader.x, r.leader.y)) return null;
    return Math.hypot(c.x - r.leader.x, c.y - r.leader.y) <= COMMAND.rally.radius ? r.leader : null;
  }

  /** Сколько секунд до готовности клича (для HUD игрока-главы). */
  get rallyCooldown(): number {
    return Math.max(0, this.rallyReady - this.time);
  }

  update(dt: number): void {
    this.time += dt;
    const war = this.ctx.war;
    for (let i = this.army.length - 1; i >= 0; i--) if (!this.army[i].alive) this.army.splice(i, 1);
    if (this.rally && (this.time >= this.rally.until || !this.rally.leader.alive)) this.rally = null;
    this.ensureLeader();
    if (!war.fronts.length) return;
    if (!this.started && this.time >= COMMAND.firstMarch && !this.paused) {
      this.pickTarget();
      this.started = true;
    }
    // Игрок-глава: цель — КПП, у которого он.
    const leader = this.leader;
    if (leader?.isPlayer) {
      const f = war.frontAt(leader.x, leader.y);
      if (f && f.index !== this.target) {
        this.target = f.index;
        this.ctx.insurgency.radio(`Армия идёт за вами на ${f.name}.`);
      }
    }
    this.pickDiversion();
    // Лагерь: лечение и патроны; готовые — в путь к своему КПП.
    for (const c of this.army) {
      const b = c.brain;
      if (!(b instanceof RebelBrain)) continue;
      const want = this.frontFor(c);
      if (b.front !== want) b.setFront(want);
      if (b.mode !== 'camp') continue;
      if (this.ctx.map.zoneAtWorld(c.x, c.y)?.kind === 'rebel_camp') {
        c.health = Math.min(c.maxHealth, c.health + COMMAND.campHeal * dt);
        if (!b.restocked) {
          this.ctx.economy.refillAmmo(c, COMMAND.campMags);
          b.restocked = true;
        }
      }
      if (this.started && !this.paused && c.health >= c.maxHealth * COMMAND.readyHealth) b.march(this.diversion.has(c) ? 'raid' : 'gather');
    }
    // Отряды фронтов — бойцы армии, идущие туда или уже там (не в лагере и не на отходе).
    for (const f of war.fronts) {
      const keep = f.squad.filter((r) => r.alive && !this.army.includes(r));
      f.squad = [
        ...keep,
        ...this.army.filter((c) => {
          const b = c.brain;
          return b instanceof RebelBrain && b.front === f.index && b.mode !== 'camp' && b.mode !== 'retreat';
        }),
      ];
    }
    // Подошедшие к идущему капту (по кличу, из лагеря) — в звенья.
    for (const f of war.fronts) if (f.capture) this.formTeams(f, false);
    // NPC-глава в капте кричит клич, как только готов.
    if (leader && !leader.isPlayer && leader.brain instanceof RebelBrain && leader.brain.mode === 'capture' && this.time >= this.rallyReady) {
      const f = war.frontAt(leader.x, leader.y);
      if (f?.capture) this.shout(leader);
    }
  }
}
