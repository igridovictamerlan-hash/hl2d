import type { SquadArena } from '../systems/SquadArena';
import { ARENA } from '../config/arena';

/** Табло режима «отряд на отряд»: счёт, раунд, живые в отрядах, время раунда. */
export class ArenaBar {
  private readonly el: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'capture-bar panel';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  update(arena: SquadArena | null): void {
    if (!arena) {
      this.el.hidden = true;
      this.last = '';
      return;
    }
    const t = Math.max(0, Math.ceil(arena.timer));
    const mmss = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const n = (s: 'combine' | 'rebel') => `${arena.alive(s)}/${arena.members[s].length}`;
    const state = arena.live
      ? `раунд ${arena.round} · ${mmss}`
      : arena.lastWinner === 'draw' ? 'ничья · следующий раунд…' : `победа: ${ARENA.sideNames[arena.lastWinner ?? arena.playerSide]} · следующий раунд через ${t} с`;
    const html = `<div class="cap-row"><b>ОТРЯД НА ОТРЯД</b> · <span class="cap-cp">${ARENA.sideNames.combine} ${arena.score.combine}</span> : <span class="cap-rebel">${arena.score.rebel} ${ARENA.sideNames.rebel}</span> · живы ${n('combine')} против ${n('rebel')} · ${state} · вы — ${ARENA.sideNames[arena.playerSide]}</div>`;
    if (html === this.last) return;
    this.last = html;
    this.el.innerHTML = html;
    this.el.hidden = false;
  }
}
