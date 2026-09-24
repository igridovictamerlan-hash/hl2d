import type { EventBus } from '../core/EventBus';

const KIND_PREFIX: Record<string, string> = { radio: '[Рация] ', law: '', world: '', system: '' };

/** Журнал событий мира (задержания, штрафы, рация ГО). Полноценный чат с командами — этап 5. */
export class EventLog {
  private readonly el: HTMLElement;
  private readonly max = 7;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'event-log';
    parent.appendChild(this.el);
    bus.on('log', ({ text, kind }) => this.push(text, kind));
  }

  push(text: string, kind: string): void {
    const line = document.createElement('div');
    line.className = `log-line log-${kind}`;
    line.textContent = KIND_PREFIX[kind] + text;
    this.el.appendChild(line);
    while (this.el.children.length > this.max) this.el.firstElementChild?.remove();
    window.setTimeout(() => line.classList.add('old'), 12000);
  }
}
