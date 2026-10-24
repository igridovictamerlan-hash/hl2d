import type { OrgCrime, OrgMember, OrgSummary, OrgWanted } from '../systems/CpOrg';
import { ORG } from '../config/org';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const mmss = (s: number): string => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '∞');
const ago = (s: number): string => (s < 60 ? `${Math.max(0, Math.round(s))} с назад` : `${Math.round(s / 60)} мин назад`);

/** Данные меню организации (Game): сводка, преступления, ориентировки, штат; приказы — ответ для игрока. */
export interface OrgSource {
  summary(): OrgSummary;
  crimes(): OrgCrime[];
  wanted(): OrgWanted[];
  staff(): OrgMember[];
  /** Может ли игрок отдавать приказы о составе (уровень командования). */
  manager(): boolean;
  order(id: number, kind: 'promote' | 'demote'): string;
}

type Tab = 'summary' | 'crimes' | 'wanted' | 'staff';
const TABS: [Tab, string][] = [
  ['summary', 'Сводка'],
  ['crimes', 'Преступления'],
  ['wanted', 'Ориентировки'],
  ['staff', 'Сотрудники'],
];

/**
 * Меню организации ВС (клавиша J): сводка по городу, список преступлений (оцепления, вызовы, дела), ориентировки
 * и штат с должностями; командиру (ORG.manageFrom и выше) — кнопки «повысить» и «понизить» у юнитов ниже себя.
 * Обновляется, пока открыто (ORG.refresh).
 */
export class OrgPanel {
  readonly el: HTMLElement;
  isOpen = false;
  private tab: Tab = 'summary';
  private acc = 0;
  private note = '';

  constructor(
    parent: HTMLElement,
    private readonly src: OrgSource,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'org panel';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) return this.toggle(false);
      const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (tab) {
        this.tab = tab;
        return this.render();
      }
      const btn = t.closest<HTMLElement>('[data-order]');
      if (btn) {
        this.note = this.src.order(Number(btn.dataset.id), btn.dataset.order as 'promote' | 'demote');
        this.render();
      }
    });
  }

  toggle(on = !this.isOpen): void {
    this.isOpen = on;
    this.el.hidden = !on;
    this.acc = 0;
    if (!on) this.note = '';
    if (on) this.render();
  }

  update(dt: number): void {
    if (!this.isOpen) return;
    this.acc += dt;
    if (this.acc < ORG.refresh) return;
    this.acc = 0;
    // Список с кнопками — не перерисовывать под курсором (кнопка уехала бы из-под клика).
    if (this.tab === 'staff' && this.el.matches(':hover')) return;
    this.render();
  }

  private render(): void {
    // Перерисовка не сбрасывает прокрутку списка (та же вкладка).
    const prev = this.el.querySelector<HTMLElement>('.org-body');
    const scroll = prev && prev.dataset.view === this.tab ? prev.scrollTop : 0;
    const tabs = TABS.map(([k, name]) => `<button class="org-tab${k === this.tab ? ' on' : ''}" data-tab="${k}">${name}</button>`).join('');
    const body = this.tab === 'summary' ? this.summary() : this.tab === 'crimes' ? this.crimes() : this.tab === 'wanted' ? this.wanted() : this.staff();
    this.el.innerHTML = `
      <div class="org-head"><span>ВНУТРЕННЯЯ СТРАЖА · ОРГАНИЗАЦИЯ</span><button class="org-x" data-close title="Закрыть (J)">✕</button></div>
      <div class="org-tabs">${tabs}</div>
      ${this.note ? `<div class="org-note">${esc(this.note)}</div>` : ''}
      <div class="org-body" data-view="${this.tab}">${body}</div>`;
    const el = this.el.querySelector<HTMLElement>('.org-body');
    if (el) el.scrollTop = scroll;
  }

  private summary(): string {
    const s = this.src.summary();
    const code = `<span class="org-code ${s.code === 'красный' ? 'red' : s.code === 'жёлтый' ? 'amber' : ''}">${esc(s.code)}</span>`;
    const tile = (n: number | string, label: string, warn = false) => `<div class="org-tile${warn ? ' warn' : ''}"><b>${n}</b><span>${label}</span></div>`;
    const w = s.wanted;
    return `
      <div class="org-line">Код тревоги: ${code}${s.alarm ? ' · <span class="org-warn">точка тревоги — прочёсывание</span>' : ''}</div>
      <div class="org-tiles">
        ${tile(s.calls, 'вызовов по рации', s.calls > 0)}
        ${tile(s.scenes, `мест преступлений${s.bodies ? ` · тел ${s.bodies}` : ''}`, s.scenes > 0)}
        ${tile(s.cases, `открытых дел${s.murders ? ` · убийств ${s.murders}` : ''}`, s.murders > 0)}
        ${tile(w[0] + w[1] + w[2], `в розыске · ★${w[0]} ★★${w[1]} ★★★${w[2]}`, w[2] > 0)}
        ${tile(s.jailed, 'в КПЗ')}
        ${tile(s.imprisoned, 'в тюрьме')}
      </div>
      <div class="org-sub">Штат</div>
      <div class="org-tiles">
        ${tile(`${s.staffed}/${s.slots}`, 'должностей занято', s.vacancies > 0)}
        ${tile(s.vacancies, 'вакансий', s.vacancies > 0)}
        ${tile(s.reserve, 'в резерве академии')}
        ${tile(s.cadets, 'курсантов')}
        ${tile(s.lost, 'должностей освобождено (погибли, переведены)')}
      </div>`;
  }

  private crimes(): string {
    const list = this.src.crimes();
    if (!list.length) return '<div class="org-empty">Активных преступлений нет: оцеплений, вызовов и открытых дел — ноль.</div>';
    const icon = { scene: '⬛', call: '📻', case: '📁' } as const;
    return list
      .map((c) => `<div class="org-row ${c.kind}${c.prio >= 3 ? ' hot' : ''}">
        <div class="org-top"><span class="org-ico">${icon[c.kind]}</span><span class="org-title">${esc(c.title)}</span><span class="org-ago">${ago(c.ago)}</span></div>
        <div class="org-meta">${esc(c.zone)} · ${esc(c.detail)}</div></div>`)
      .join('');
  }

  private wanted(): string {
    const list = this.src.wanted();
    if (!list.length) return '<div class="org-empty">Ориентировок нет: никто не в розыске.</div>';
    return list
      .map((w) => `<div class="org-row${w.level >= 3 ? ' hot' : ''}">
        <div class="org-top"><span class="org-stars">${'★'.repeat(w.level)}</span><span class="org-title">${esc(w.name)}</span><span class="org-ago">${Number.isFinite(w.left) ? `снимут через ${mmss(w.left)}` : 'бессрочно'}</span></div>
        <div class="org-meta">${esc(w.charge)} · последний раз: ${esc(w.zone)}${w.armed ? ' · <span class="org-warn">вооружён</span>' : ''}</div></div>`)
      .join('');
  }

  private staff(): string {
    const list = this.src.staff();
    const mgr = this.src.manager();
    const hint = mgr
      ? '<div class="org-hint">Вы командир: ▲ — повысить на свободную должность выше, ▼ — понизить (на свободную младшую или поменять с лучшим из младших). Только тех, кто ниже вас.</div>'
      : `<div class="org-hint">Приказы о составе отдают с офицера и выше. Ваше повышение — по баллам службы.</div>`;
    const rows = list
      .map((m) => {
        const hp = Math.round(m.health * 100);
        const btns = mgr && !m.isPlayer
          ? `<span class="org-btns">${m.promote ? `<button data-order="promote" data-id="${m.id}" title="Повысить до ${esc(m.promote)}">▲ ${esc(m.promote)}</button>` : ''}${m.demote ? `<button data-order="demote" data-id="${m.id}" title="Понизить до ${esc(m.demote)}">▼ ${esc(m.demote)}</button>` : ''}</span>`
          : '';
        return `<div class="org-row${m.isPlayer ? ' me' : ''}">
          <div class="org-top"><span class="org-unit" title="${esc(m.unitName)}">${esc(m.unit)}</span><span class="org-title">${esc(m.name)}${m.isPlayer ? ' (вы)' : ''}</span><span class="org-ago">баллы ${m.score}</span>${btns}</div>
          <div class="org-meta">${esc(m.post)} · ${esc(m.state)} · ${esc(m.zone)} · <span class="${hp < 50 ? 'org-warn' : ''}">здоровье ${hp}%</span></div></div>`;
      })
      .join('');
    return `${hint}<div class="org-count">Сотрудников: ${list.length}</div>${rows}`;
  }
}
