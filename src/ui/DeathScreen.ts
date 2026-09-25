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

  update(p: Character, now: number): void {
    this.el.hidden = p.alive;
    if (!p.alive) this.timer.textContent = `Возрождение через ${Math.max(0, Math.ceil(p.respawnAt - now))} с`;
  }
}
