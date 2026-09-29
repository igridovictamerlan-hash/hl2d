import type { EventBus } from '../core/EventBus';

/** Название зоны по центру сверху при входе в неё. */
export class ZoneBanner {
  private readonly el: HTMLElement;
  private timer = 0;
  /** Чей это район (банда) — дописывается к названию зоны. */
  turf: ((zoneId: number) => string | null) | null = null;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'zone-banner';
    parent.appendChild(this.el);
    bus.on('zone:enter', ({ zone }) => {
      const gang = this.turf?.(zone.id);
      this.show(gang ? `${zone.name} · район «${gang}»` : zone.name);
    });
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
