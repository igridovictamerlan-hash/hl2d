import type { EventBus } from '../core/EventBus';

/** Название зоны по центру сверху при входе в неё. */
export class ZoneBanner {
  private readonly el: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'zone-banner';
    parent.appendChild(this.el);
    bus.on('zone:enter', ({ zone }) => this.show(zone.name));
  }

  show(text: string): void {
    this.el.textContent = text;
    this.el.classList.remove('visible');
    void this.el.offsetWidth; // перезапуск CSS-анимации
    this.el.classList.add('visible');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('visible'), 2600);
  }
}
