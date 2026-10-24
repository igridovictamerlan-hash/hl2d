import type { EventBus } from '../core/EventBus';
import type { Character } from '../entities/Character';
import type { Verdict } from '../systems/LawSystem';
import { VIOLATION_NAMES, LAW } from '../config/law';
import { FACTIONS } from '../config/factions';
import { chargeDef, wantedLevel } from '../systems/LawSystem';
import { displayName } from '../entities/cover';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export type CheckChoice = 'release' | 'fine' | 'arrest';

/** Результат проверки документов для игрока-ВС: 1 — отпустить, 2 — штраф, 3 — арест. */
export class CheckPanel {
  private readonly el: HTMLElement;
  target: Character | null = null;

  constructor(
    parent: HTMLElement,
    bus: EventBus,
    private readonly onChoice: (target: Character, choice: CheckChoice) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'check-panel panel';
    this.el.hidden = true;
    parent.appendChild(this.el);
    bus.on('law:checkResult', ({ target, verdict }) => this.show(target, verdict));
    bus.on('law:checkClosed', ({ target }) => {
      if (target === this.target) this.hide();
    });
  }

  private show(t: Character, v: Verdict): void {
    this.target = t;
    const pp = t.passport;
    const cid = !pp ? '<span class="bad">нет паспорта</span>' : `№ ${esc(pp.no)} · ${esc(pp.name)}${t.law.hasCid ? '' : ' · <span class="bad">просрочен</span>'}`;
    const job = pp ? esc(pp.job) : '—';
    const status = t.law.wanted ? `<span class="bad">В РОЗЫСКЕ ${'★'.repeat(wantedLevel(t))} — ${chargeDef(t).name}</span>` : 'чист';
    const hint = v.kind === 'arrest' ? 'рекомендуется арест' : v.kind === 'fine' ? `рекомендуется штраф ${v.fine}` : 'нарушений нет';
    const fine = v.fine || LAW.fines.running;
    this.el.innerHTML = `
      <div class="check-head">ПРОВЕРКА ДОКУМЕНТОВ</div>
      <div class="check-name">${esc(displayName(t))} · ${FACTIONS[t.disguised && t.cover ? t.cover.faction : t.faction].role}</div>
      <div>Паспорт: ${cid}</div>
      <div>Работа: ${job}</div>
      <div>Статус: ${status}</div>
      <div>Причина: ${VIOLATION_NAMES[v.reason]} — ${hint}</div>
      <div class="check-actions">
        <button data-c="release"><kbd>1</kbd> Отпустить</button>
        <button data-c="fine"><kbd>2</kbd> Штраф ${fine}</button>
        <button data-c="arrest"><kbd>3</kbd> Арест</button>
      </div>`;
    this.el.querySelectorAll<HTMLButtonElement>('button[data-c]').forEach((b) =>
      b.addEventListener('click', () => this.choose(b.dataset.c as CheckChoice)),
    );
    this.el.hidden = false;
  }

  choose(choice: CheckChoice): void {
    const t = this.target;
    if (!t) return;
    this.hide();
    this.onChoice(t, choice);
  }

  hide(): void {
    this.target = null;
    this.el.hidden = true;
  }
}
