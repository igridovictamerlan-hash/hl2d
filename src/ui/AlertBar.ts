import type { EventBus } from '../core/EventBus';

/** Постоянная полоса тревоги: «КОД КРАСНЫЙ · КОМЕНДАНТСКИЙ ЧАС» или «КОД ЖЁЛТЫЙ». */
export class AlertBar {
  private readonly el: HTMLElement;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'alert-bar';
    this.el.hidden = true;
    parent.appendChild(this.el);
    bus.on('alert', ({ code }) => {
      this.el.hidden = code === 'green';
      this.el.classList.toggle('yellow', code === 'yellow');
      this.el.textContent = code === 'red'
        ? 'КОД КРАСНЫЙ · КОМЕНДАНТСКИЙ ЧАС — граждане, пройдите в жилые блоки'
        : 'КОД ЖЁЛТЫЙ · нападение в городе — усиленные проверки CID';
    });
  }

  reset(): void {
    this.el.hidden = true;
  }
}
