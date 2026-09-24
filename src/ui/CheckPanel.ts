import type { EventBus } from '../core/EventBus';
import type { Character } from '../entities/Character';
import type { Verdict } from '../systems/LawSystem';
import { VIOLATION_NAMES, LAW } from '../config/law';
import { FACTIONS } from '../config/factions';

export type CheckChoice = 'release' | 'fine' | 'arrest';

/** Результат проверки CID для игрока-ГО: 1 — отпустить, 2 — штраф, 3 — арест. */
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
    const cid = t.law.hasCid ? `#${t.cid}` : '<span class="bad">нет действующей CID</span>';
    const status = t.law.wanted ? '<span class="bad">В РОЗЫСКЕ</span>' : 'чист';
    const hint = v.kind === 'arrest' ? 'рекомендуется арест' : v.kind === 'fine' ? `рекомендуется штраф ${v.fine}` : 'нарушений нет';
    const fine = v.fine || LAW.fines.running;
    this.el.innerHTML = `
      <div class="check-head">ПРОВЕРКА CID</div>
      <div class="check-name">${t.name} · ${FACTIONS[t.faction].role}</div>
      <div>CID: ${cid}</div>
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
