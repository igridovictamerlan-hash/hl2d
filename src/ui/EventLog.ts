import type { EventBus } from '../core/EventBus';

const KIND_PREFIX: Record<string, string> = { radio: '[Рация] ', law: '', world: '', system: '', chat: '' };

/** Журнал событий мира и чат (задержания, штрафы, рация ГО, речь персонажей). */
export class EventLog {
  readonly el: HTMLElement;
  private readonly max = 8;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'event-log';
    parent.appendChild(this.el);
    bus.on('log', ({ text, kind }) => this.push(text, kind));
  }

  push(text: string, kind: string): void {
    const line = document.createElement('div');
    line.className = `log-line log-${kind}${kind === 'chat' && text.startsWith('* ') ? ' log-emote' : ''}`;
    line.textContent = KIND_PREFIX[kind] + text;
    this.el.appendChild(line);
    while (this.el.children.length > this.max) this.el.firstElementChild?.remove();
    window.setTimeout(() => line.classList.add('old'), 12000);
  }
}
