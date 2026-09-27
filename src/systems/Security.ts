import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import { CpBrain, type CpDuty } from '../ai/brains/CpBrain';
import { SECURITY } from '../config/security';
import { LOYALTY } from '../config/loyalty';
import { poiWorld } from './Population';

/**
 * Штаб силового блока: построения PCU.OFC на плацу Нексуса (раз в formation.every с при зелёном
 * коде), охрана SU.GUARD по очереди (инспекторы всегда под охраной, остальные охранники раз в
 * rotateEvery с переходят к следующей цели — глава, Администратор, лоялисты), выходы главы CMD.EPU
 * к площади со всей охраной и инспекторами. Охранников меньше, чем целей, — иначе город не взять.
 */
export class SecuritySystem {
  private time = 0;
  private nextFormation: number = SECURITY.formation.first;
  private nextRotation = 1;
  private nextTour: number = SECURITY.tour.first;
  private shift = 0;
  /** Идущее построение: офицер, строй, когда начали, до какого времени стоят. */
  formation: { officer: Character; members: Character[]; since: number; standUntil: number; nextLine: number } | null = null;
  /** Выход главы: куда (площадь) и до какого времени. */
  tourSpot: Vec2 | null = null;
  private tourUntil = 0;
  readonly stats = { formations: 0, rotations: 0, tours: 0 };

  constructor(private readonly ctx: AiContext) {}

  get now(): number {
    return this.time;
  }

  /** Юниты ГО с данной службой (живые, с мозгом ГО). */
  units(duty: CpDuty): Character[] {
    return this.ctx.entities.list.filter((c) => c.alive && c.brain instanceof CpBrain && c.brain.duty === duty);
  }

  update(dt: number): void {
    this.time += dt;
    const green = this.ctx.war.code === 'green';
    this.updateFormation(green);
    this.updateTour(green);
    if (this.time >= this.nextRotation) {
      this.nextRotation = this.time + SECURITY.guard.rotateEvery;
      this.rotateGuards();
    }
  }

  private updateFormation(green: boolean): void {
    const F = SECURITY.formation;
    const ctx = this.ctx;
    const f = this.formation;
    if (f) {
      const officerGone = !f.officer.alive || !(f.officer.brain instanceof CpBrain) || !f.officer.brain.formation;
      if (!green || officerGone) return this.endFormation(false);
      const t = this.time;
      // Все в строю (или сбор затянулся) — стоят stand с; офицер говорит перед строем.
      if (!f.standUntil) {
        const ready = f.members.every((m) => !m.alive || !(m.brain instanceof CpBrain) || !m.brain.formation || Math.hypot(m.x - m.brain.formation.x, m.y - m.brain.formation.y) < 20);
        if (ready || t - f.since > F.gather) {
          f.standUntil = t + F.stand;
          f.officer.say('Смирно!', ctx.law.now, 2);
        }
        return;
      }
      if (t >= f.nextLine) {
        f.nextLine = t + F.lineEvery;
        f.officer.say(ctx.rng.pick(SECURITY.lines.formation), ctx.law.now, 4);
      }
      if (t >= f.standUntil) this.endFormation(true);
      return;
    }
    if (!green || this.time < this.nextFormation) return;
    this.nextFormation = this.time + F.every;
    this.startFormation();
  }

  /** Построение: офицер и до max свободных юнитов PCU — на плац Нексуса. */
  startFormation(): boolean {
    const F = SECURITY.formation;
    const ctx = this.ctx;
    const yard = poiWorld(ctx, 'nexus_yard');
    if (!yard || ctx.war.code !== 'green') return false;
    const officers = this.units('officer').filter((o) => (o.brain as CpBrain).fsm.current === 'duty');
    if (!officers.length) return false;
    const officer = officers[this.stats.formations % officers.length];
    const free = ctx.entities.list
      .filter((c) => c.alive && c.faction === 'cp' && c.division === 'pcu' && c.brain instanceof CpBrain && c.brain.canForm && c.brain.duty !== 'officer')
      .sort((a, b) => Math.hypot(a.x - yard.x, a.y - yard.y) - Math.hypot(b.x - yard.x, b.y - yard.y))
      .slice(0, F.max);
    if (free.length < 2) return false;
    // Строй — ряды по rows юнитов лицом к офицеру; офицер — перед строем.
    const rows = Math.ceil(free.length / F.rows);
    const top = yard.y - ((rows - 1) * F.gap) / 2 + F.front / 2;
    const face = -Math.PI / 2;
    free.forEach((m, k) => {
      const r = Math.floor(k / F.rows);
      const col = k % F.rows;
      const x = yard.x + (col - (F.rows - 1) / 2) * F.gap;
      const y = top + r * F.gap;
      (m.brain as CpBrain).joinFormation({ x, y, facing: face });
    });
    (officer.brain as CpBrain).joinFormation({ x: yard.x, y: top - F.front, facing: Math.PI / 2 });
    officer.say(ctx.rng.pick(SECURITY.lines.formationCall), ctx.law.now, 3);
    ctx.law.log(`${officer.name}: построение юнитов PCU на плацу Нексуса.`, 'radio');
    this.formation = { officer, members: free, since: this.time, standUntil: 0, nextLine: 0 };
    this.stats.formations++;
    return true;
  }

  private endFormation(dismiss: boolean): void {
    const f = this.formation;
    if (!f) return;
    if (dismiss && f.officer.alive) f.officer.say(this.ctx.rng.pick(SECURITY.lines.dismiss), this.ctx.law.now, 3);
    for (const m of [...f.members, f.officer]) if (m.brain instanceof CpBrain) m.brain.leaveFormation();
    this.formation = null;
  }

  /** Цели охраны: инспекторы (всегда), затем глава, Администратор, лоялисты. */
  private targets(): { always: Character[]; rotating: Character[] } {
    const ctx = this.ctx;
    const always = this.units('inspector');
    const rotating: Character[] = [...this.units('epu')];
    for (const c of ctx.entities.list) if (c.alive && c.faction === 'admin') rotating.push(c);
    const loyalists = ctx.entities.list
      .filter((c) => c.alive && c.faction === 'citizen' && !c.isPlayer && c.loyalty >= LOYALTY.uniform.min)
      .sort((a, b) => b.loyalty - a.loyalty)
      .slice(0, SECURITY.guard.loyalists);
    rotating.push(...loyalists);
    return { always, rotating };
  }

  /** Раздать охранников: инспекторы — всегда; остальным — по очереди (сдвиг каждый раз). */
  rotateGuards(): void {
    const ctx = this.ctx;
    const until = this.time + SECURITY.guard.rotateEvery + 5;
    const guards = this.units('bodyguard').filter((g) => {
      const b = g.brain as CpBrain;
      return !b.gunner.target && b.fsm.current !== 'retreat';
    });
    if (!guards.length) return;
    this.shift++;
    this.stats.rotations++;
    // На выходе главы — вся охрана при нём.
    const epu = this.tourSpot ? this.units('epu')[0] : undefined;
    const { always, rotating } = this.targets();
    const order = guards.map((_, k) => guards[(k + this.shift) % guards.length]);
    order.forEach((g, k) => {
      let ward: Character | undefined;
      if (epu) ward = epu;
      else if (k < always.length) ward = always[k];
      else if (rotating.length) ward = rotating[(k - always.length + this.shift) % rotating.length];
      const b = g.brain as CpBrain;
      if (ward) b.assignGuard(ward, ctx.law.now + (until - this.time));
    });
  }

  private updateTour(green: boolean): void {
    const T = SECURITY.tour;
    const ctx = this.ctx;
    if (this.tourSpot) {
      if (!green || this.time >= this.tourUntil) {
        this.tourSpot = null;
        for (const e of this.units('epu')) (e.brain as CpBrain).nextDuty();
        for (const i of this.units('inspector')) {
          const b = i.brain as CpBrain;
          b.ward = null;
          i.guarding = null;
          if (b.fsm.current === 'bodyguard') b.fsm.change('duty');
        }
        this.rotateGuards();
      }
      return;
    }
    if (!green || this.time < this.nextTour) return;
    this.nextTour = this.time + T.every;
    const epu = this.units('epu')[0];
    const plaza = poiWorld(ctx, 'plaza_center');
    if (!epu || !plaza || this.units('bodyguard').length === 0) return;
    // Из Нексуса — только с охраной и инспекторами.
    this.tourSpot = plaza;
    this.tourUntil = this.time + T.time + 40;
    (epu.brain as CpBrain).nextDuty();
    for (const i of this.units('inspector')) (i.brain as CpBrain).assignGuard(epu, ctx.law.now + T.time + 40);
    this.rotateGuards();
    ctx.law.log(`${epu.name}: глава силового блока выходит в город (площадь) с охраной и инспекторами.`, 'radio');
    this.stats.tours++;
  }
}
