import type { Character } from '../entities/Character';
import { FACTIONS } from '../config/factions';

/** HUD в духе HL2: здоровье, токены, личность (имя, роль, CID). Обновляется, только если что-то изменилось. */
export class Hud {
  readonly el: HTMLElement;
  private hpFill: HTMLElement;
  private hpText: HTMLElement;
  private money: HTMLElement;
  private name: HTMLElement;
  private role: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud panel';
    this.el.innerHTML = `
      <div class="hud-row"><span class="hud-label">ЗДОРОВЬЕ</span><span class="hud-value" data-hp></span></div>
      <div class="hp-bar"><div class="hp-fill" data-hpfill></div></div>
      <div class="hud-row"><span class="hud-label">ТОКЕНЫ</span><span class="hud-value" data-money></span></div>
      <div class="hud-id"><div class="hud-name" data-name></div><div class="hud-role" data-role></div></div>`;
    parent.appendChild(this.el);
    this.hpFill = this.el.querySelector('[data-hpfill]')!;
    this.hpText = this.el.querySelector('[data-hp]')!;
    this.money = this.el.querySelector('[data-money]')!;
    this.name = this.el.querySelector('[data-name]')!;
    this.role = this.el.querySelector('[data-role]')!;
  }

  update(p: Character): void {
    const key = `${Math.ceil(p.health)}|${p.maxHealth}|${p.money}|${p.name}|${p.faction}|${p.cid}`;
    if (key === this.last) return;
    this.last = key;
    const hp = Math.max(0, Math.ceil(p.health));
    this.hpText.textContent = String(hp);
    this.hpFill.style.width = `${(100 * hp) / p.maxHealth}%`;
    this.hpFill.classList.toggle('low', hp <= 25);
    this.money.textContent = String(p.money);
    this.name.textContent = p.name;
    const f = FACTIONS[p.faction];
    this.role.textContent = `${f.role} · CID #${p.cid}`;
    this.role.style.color = f.label;
  }
}
