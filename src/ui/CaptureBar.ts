import type { WarSystem } from '../systems/WarSystem';
import { WAR } from '../config/war';

/** Табло капта КПП: счёт убийств, сколько осталось времени и нужно для захвата; захваченные КПП. */
export class CaptureBar {
  private readonly el: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'capture-bar panel';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  update(war: WarSystem): void {
    const rows: string[] = [];
    for (const f of war.fronts) {
      const name = f.name.replace('Пограничный ', '');
      const c = f.capture;
      if (c) {
        const left = Math.max(0, Math.ceil(c.until - war.now));
        const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        rows.push(
          `<div class="cap-row"><b>КАПТ · ${name}</b> <span class="cap-rebel">Повстанцы ${c.rebelKills}</span> : <span class="cap-cp">${c.cpKills} Альянс</span> · ${mmss} · до захвата ${Math.max(0, WAR.capture.killsToWin - c.rebelKills)} уб.</div>`,
        );
      } else if (f.owner === 'rebels') rows.push(`<div class="cap-row"><b>${name}</b> <span class="cap-rebel">в руках повстанцев</span></div>`);
    }
    const html = rows.join('');
    if (html === this.last) return;
    this.last = html;
    this.el.innerHTML = html;
    this.el.hidden = rows.length === 0;
  }

  reset(): void {
    this.last = '';
    this.el.hidden = true;
  }
}
