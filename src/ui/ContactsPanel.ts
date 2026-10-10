import type { PersonInfo, Tier } from '../systems/Relations';
import { RELATIONS } from '../config/relations';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** Цвет уровня знакомства. */
const TIER_COLOR: Record<Tier, string> = {
  stranger: '#a5998a',
  acquaintance: '#d4c7a8',
  friend: '#9ad88c',
  close: '#6fe0a0',
  rival: '#e0a35a',
  enemy: '#ff6a58',
};

/**
 * Знакомые (клавиша K): те, кто вас знает, — как относятся к вам (мнение от −100 до 100), кто они, какой у них характер и
 * настроение и что запомнили. Обновляется, пока открыта.
 */
export class ContactsPanel {
  readonly el: HTMLElement;
  isOpen = false;
  private acc = 0;

  constructor(
    parent: HTMLElement,
    private readonly list: () => readonly PersonInfo[],
  ) {
    this.el = document.createElement('div');
    this.el.className = 'contacts panel';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) this.toggle(false);
    });
  }

  toggle(on = !this.isOpen): void {
    this.isOpen = on;
    this.el.hidden = !on;
    this.acc = 0;
    if (on) this.render();
  }

  update(dt: number): void {
    if (!this.isOpen) return;
    this.acc += dt;
    if (this.acc < RELATIONS.contacts.refresh) return;
    this.acc = 0;
    this.render();
  }

  private render(): void {
    const people = this.list();
    const rows = people.map((p) => this.row(p)).join('');
    this.el.innerHTML = `
      <div class="ct-head"><span>ЗНАКОМЫЕ</span><span class="ct-count">${people.length}</span><button class="ct-x" data-close title="Закрыть (K)">✕</button></div>
      <div class="ct-hint">Кто вас знает и как к вам относится. Говорите (E), помогайте, угощайте — мнение растёт; обижайте — обида помнится.</div>
      <div class="ct-list">${rows || '<div class="ct-empty">Вас пока никто не знает. Подойдите к человеку и нажмите E — познакомьтесь.</div>'}</div>`;
  }

  private row(p: PersonInfo): string {
    const tier = p.kin ? RELATIONS.tiers.kin : RELATIONS.tiers[p.tier];
    const color = TIER_COLOR[p.tier];
    const pct = Math.round(((p.opinion + 100) / 200) * 100);
    const meta = [p.role, p.tags, p.hobby].filter(Boolean).join(' · ');
    const mood = `<span style="color:${p.moodColor}">${esc(p.moodName)}</span>${p.because ? ` — ${esc(p.because)}` : ''}`;
    return `<div class="ct-row${p.alive ? '' : ' dead'}">
      <div class="ct-top"><span class="ct-name">${esc(p.name)}${p.alive ? '' : ' ✝'}</span><span class="ct-tier" style="color:${color}">${esc(tier)}</span><span class="ct-op" style="color:${color}">${p.opinion > 0 ? '+' : ''}${p.opinion}</span></div>
      <div class="ct-bar"><i style="width:${pct}%;background:${color}"></i><b></b></div>
      <div class="ct-meta">${esc(meta)}</div>
      <div class="ct-meta">${mood}${p.memory ? ` · помнит: ${esc(p.memory)}` : ''}</div>
    </div>`;
  }
}
