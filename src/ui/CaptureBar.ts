import type { WarSystem } from '../systems/WarSystem';
import { WAR } from '../config/war';

/** Табло капта точек КПП: счёт убийств, время, гарнизон; какие точки D у повстанцев. */
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
        // Захват — перебить гарнизон или набрать убийства с перевесом; подкреплений ГО нет.
        const alive = c.defenders.filter((d) => d.alive).length;
        const attackers = f.squad.filter((r) => r.alive).length;
        rows.push(
          `<div class="cap-row"><b>КАПТ · ${name} · ${f.points[c.point]?.name ?? ''}</b> <span class="cap-rebel">Повстанцы ${c.rebelKills}</span> : <span class="cap-cp">${c.cpKills} Альянс</span> · ${mmss} · штурмуют ${attackers} · гарнизон ${alive}/${c.defenders.length} · до захвата ${Math.max(0, WAR.capture.killsToWin - c.rebelKills)} уб.</div>`,
        );
      } else if (f.held > 0) {
        const pts = f.points.map((p, k) => `<span class="${k < f.held ? 'cap-rebel' : 'cap-cp'}">${p.name}</span>`).join(' – ');
        rows.push(`<div class="cap-row"><b>${name}</b> ${pts} · ${f.owner === 'rebels' ? '<span class="cap-rebel">КПП прорван</span>' : 'точка у повстанцев'}</div>`);
      }
    }
    const n = war.nexus;
    if (n.fallen) {
      const left = Math.max(0, Math.ceil(WAR.nexus.holdToWin - (war.now - n.fallenAt)));
      rows.push(`<div class="cap-row"><b class="cap-rebel">НЕКСУС ЗАХВАЧЕН</b> · удержать ещё ${left} с · повстанцев ${n.rebels} · защитников ${n.defenders}</div>`);
    } else if (n.progress > 0 || n.rebels > 0) {
      rows.push(`<div class="cap-row"><b>ШТУРМ НЕКСУСА</b> · захват ${Math.floor((100 * n.progress) / WAR.nexus.captureTime)}% · <span class="cap-rebel">повстанцев ${n.rebels}</span> : <span class="cap-cp">${n.defenders} защитников</span></div>`);
    }
    if (war.cityPush) rows.push('<div class="cap-row"><span class="cap-rebel">Все точки D у повстанцев — они выходят в город</span></div>');
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
