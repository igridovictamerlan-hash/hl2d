import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import { ELECTION } from '../config/election';
import { LOYALTY } from '../config/loyalty';
import { hasLoyalty } from './Loyalty';
import { equipKit, poiWorld } from './Population';
import { PostBrain } from '../ai/brains/PostBrain';

/** Идущие выборы: кандидаты, голоса, до какого времени; кто уже голосовал. */
export interface Election {
  candidates: Character[];
  votes: number[];
  until: number;
  voted: Set<Character>;
}

/**
 * Выборы Администратора города. Администратор погиб — в течение ELECTION.duration с граждане и ГСР
 * голосуют за одного из ELECTION.candidates самых лояльных (не ниже уровня «Лоялист»; нет таких —
 * самые лояльные). NPC голосуют сами (чаще — за более лояльного), игрок — командой /голос N.
 * Победитель идёт в кабинет Нексуса и становится Администратором (погибнет — снова выборы).
 */
export class ElectionSystem {
  current: Election | null = null;
  /** Сколько выборов прошло (для тестов и отладки). */
  held = 0;
  private time = 0;

  constructor(private readonly ctx: AiContext) {
    ctx.combat.deathListeners.push((c) => {
      if (c.faction === 'admin' && !this.current && !this.adminAlive()) this.start();
    });
  }

  get now(): number {
    return this.time;
  }

  private adminAlive(): boolean {
    return this.ctx.entities.list.some((c) => c.alive && c.faction === 'admin');
  }

  private log(text: string): void {
    this.ctx.bus.emit('log', { text, kind: 'world' });
  }

  /** Начать выборы (или принудительно — тесты). null — некого выдвинуть. */
  start(): Election | null {
    const pool = this.ctx.entities.list.filter((c) => c.alive && hasLoyalty(c) && c.law.phase === 'none');
    pool.sort((a, b) => b.loyalty - a.loyalty);
    const loyal = pool.filter((c) => c.loyalty >= ELECTION.minLoyalty);
    const candidates = (loyal.length ? loyal : pool).slice(0, ELECTION.candidates);
    if (!candidates.length) return null;
    this.current = { candidates, votes: candidates.map(() => 0), until: this.time + ELECTION.duration, voted: new Set() };
    const list = candidates.map((c, i) => `${i + 1}) ${c.isPlayer ? 'ВЫ' : c.name} (лояльность ${c.loyalty})`).join(', ');
    this.log(`Альянс: Администратор города погиб. Выборы нового Администратора среди лоялистов: ${list}. Голосуйте: /голос номер.`);
    this.ctx.bus.emit('announce', { text: 'Выборы Администратора' });
    return this.current;
  }

  /** Голос: null — принят, иначе причина отказа. */
  vote(voter: Character, index: number): string | null {
    const e = this.current;
    if (!e) return 'Сейчас выборов нет.';
    if (!hasLoyalty(voter)) return 'Голосуют только граждане и ГСР.';
    if (e.voted.has(voter)) return 'Вы уже проголосовали.';
    if (index < 0 || index >= e.candidates.length) return `Номер кандидата — от 1 до ${e.candidates.length}.`;
    e.voted.add(voter);
    e.votes[index]++;
    return null;
  }

  /** Строка о ходе выборов (для /выборы). */
  status(): string {
    const e = this.current;
    if (!e) return 'Сейчас выборов нет.';
    const left = Math.max(0, Math.ceil(e.until - this.time));
    return `Выборы (${left} с): ` + e.candidates.map((c, i) => `${i + 1}) ${c.isPlayer ? 'ВЫ' : c.name} — ${e.votes[i]}`).join(', ');
  }

  update(dt: number): void {
    this.time += dt;
    const e = this.current;
    if (!e) return;
    // NPC голосуют понемногу: чаще за самого лояльного кандидата.
    for (const c of this.ctx.entities.list) {
      if (c.isPlayer || !c.alive || !hasLoyalty(c) || e.voted.has(c) || !this.ctx.rng.chance(ELECTION.npcVoteRate * dt)) continue;
      const alive = e.candidates.map((k) => (k.alive ? Math.max(1, k.loyalty - LOYALTY.tiers[1].min + 10) : 0));
      const total = alive.reduce((a, b) => a + b, 0);
      if (total <= 0) break;
      let r = this.ctx.rng.range(0, total);
      let pick = 0;
      while (r > alive[pick]) r -= alive[pick++];
      this.vote(c, pick);
    }
    if (this.time < e.until) return;
    this.current = null;
    // Победитель — больше голосов (при равенстве — лояльнее), из живых.
    let best = -1;
    e.candidates.forEach((c, i) => {
      if (!c.alive) return;
      if (best < 0 || e.votes[i] > e.votes[best] || (e.votes[i] === e.votes[best] && c.loyalty > e.candidates[best].loyalty)) best = i;
    });
    if (best < 0) {
      this.start();
      return;
    }
    this.held++;
    this.appoint(e.candidates[best], e.votes[best]);
  }

  /** Новый Администратор: форма, кабинет в Нексусе, роль (погибнет — снова выборы). */
  private appoint(c: Character, votes: number): void {
    const { ctx } = this;
    ctx.law.clear(c);
    ctx.economy.leaveQueue(c);
    ctx.economy.releaseDispenser(c);
    c.faction = 'admin';
    c.profession = null;
    c.rank = 0;
    c.division = null;
    c.carrying = false;
    equipKit(c, 'admin', ctx);
    c.name = `Администратор ${c.name.split(' ').slice(-1)[0]}`;
    c.role = { kind: 'admin', faction: 'admin', profession: null, division: null, rank: 0, kit: 'admin', name: c.name };
    const desk = poiWorld(ctx, 'nexus_desk');
    if (!c.isPlayer && desk) c.brain = new PostBrain(desk, ctx.rng.range(0, Math.PI * 2));
    this.log(`Альянс: новый Администратор города — ${c.isPlayer ? 'ВЫ' : c.name} (${votes} голосов).`);
    ctx.bus.emit('announce', { text: `Новый Администратор · ${c.isPlayer ? 'вы' : c.name}` });
    if (c.isPlayer) ctx.bus.emit('elected', { who: c });
  }
}
