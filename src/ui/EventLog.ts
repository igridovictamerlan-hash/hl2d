import type { EventBus } from '../core/EventBus';
import { HUD } from '../config/hud';

const KIND_PREFIX: Record<string, string> = { radio: '[Рация] ', law: '', world: '', system: '', chat: '' };

/**
 * Журнал событий мира и чат (задержания, штрафы, рация ГО, речь персонажей). В игре — компактно:
 * последние HUD.log.lines строк в одну строку, гаснут через fadeAfter с. Открыт чат (expand) —
 * вся история целиком, с прокруткой.
 */
export class EventLog {
  readonly el: HTMLElement;
  private expanded = false;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'event-log';
    parent.appendChild(this.el);
    // Клик по истории не уводит фокус из строки чата (иначе чат закроется); листать — колесом.
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    bus.on('log', ({ text, kind }) => this.push(text, kind));
  }

  push(text: string, kind: string): void {
    const line = document.createElement('div');
    line.className = `log-line log-${kind}${kind === 'chat' && text.startsWith('* ') ? ' log-emote' : ''}`;
    line.textContent = KIND_PREFIX[kind] + text;
    line.title = line.textContent;
    this.el.appendChild(line);
    while (this.el.children.length > HUD.log.history) this.el.firstElementChild?.remove();
    window.setTimeout(() => line.classList.add('old'), HUD.log.fadeAfter * 1000);
    this.trim();
  }

  /** Чат открыт — показать историю; закрыт — снова компактно. */
  expand(on: boolean): void {
    this.expanded = on;
    this.el.classList.toggle('expanded', on);
    this.trim();
    if (on) this.el.scrollTop = this.el.scrollHeight;
  }

  /** Компактно видны только последние lines строк. */
  private trim(): void {
    const n = this.el.children.length;
    for (let i = 0; i < n; i++) (this.el.children[i] as HTMLElement).classList.toggle('hidden-line', !this.expanded && i < n - HUD.log.lines);
    if (this.expanded) this.el.scrollTop = this.el.scrollHeight;
  }
}
