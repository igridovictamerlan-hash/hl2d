import type { EventBus } from '../core/EventBus';

/** Постоянная полоса «КОД КРАСНЫЙ · КОМЕНДАНТСКИЙ ЧАС», пока действует тревога. */
export class AlertBar {
  private readonly el: HTMLElement;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'alert-bar';
    this.el.hidden = true;
    this.el.textContent = 'КОД КРАСНЫЙ · КОМЕНДАНТСКИЙ ЧАС — граждане, пройдите в жилые блоки';
    parent.appendChild(this.el);
    bus.on('alert', ({ code }) => {
      this.el.hidden = code !== 'red';
    });
  }

  reset(): void {
    this.el.hidden = true;
  }
}
