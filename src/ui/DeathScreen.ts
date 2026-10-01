import type { Character } from '../entities/Character';

/** «Вы погибли» с отсчётом до возрождения. */
export class DeathScreen {
  private readonly el: HTMLElement;
  private readonly timer: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'death';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="death-title">ВЫ ПОГИБЛИ</div><div class="death-timer"></div>';
    this.timer = this.el.querySelector('.death-timer')!;
    parent.appendChild(this.el);
  }

  /** arena — текст режима «отряд на отряд» (вернётся в следующем раунде). */
  update(p: Character, now: number, red = false, arena: string | null = null): void {
    this.el.hidden = p.alive;
    if (!p.alive) {
      this.timer.textContent = arena ?? (red
        ? 'Код красный: идёт штурм Управы — возрождения нет до отбоя'
        : `Возрождение через ${Math.max(0, Math.ceil(p.respawnAt - now))} с`);
    }
  }
}
