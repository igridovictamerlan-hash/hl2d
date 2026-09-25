import type { Character } from '../entities/Character';
import { FACTIONS, rankOf } from '../config/factions';

/** HUD в духе HL2: здоровье, токены, личность (имя, роль, CID). Обновляется, только если что-то изменилось. */
export class Hud {
  readonly el: HTMLElement;
  private hpFill: HTMLElement;
  private hpText: HTMLElement;
  private money: HTMLElement;
  private name: HTMLElement;
  private role: HTMLElement;
  private lawEl: HTMLElement;
  private hungerText: HTMLElement;
  private hungerFill: HTMLElement;
  private weaponEl: HTMLElement;
  private rationEl: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud panel';
    this.el.innerHTML = `
      <div class="hud-row"><span class="hud-label">ЗДОРОВЬЕ</span><span class="hud-value" data-hp></span></div>
      <div class="hp-bar"><div class="hp-fill" data-hpfill></div></div>
      <div class="hud-row"><span class="hud-label">СЫТОСТЬ</span><span class="hud-small" data-hunger></span></div>
      <div class="hp-bar"><div class="hp-fill hunger-fill" data-hungerfill></div></div>
      <div class="hud-row"><span class="hud-label">ТОКЕНЫ</span><span class="hud-value" data-money></span></div>
      <div class="hud-weapon" data-weapon></div>
      <div class="hud-ration" data-ration></div>
      <div class="hud-id"><div class="hud-name" data-name></div><div class="hud-role" data-role></div></div>
      <div class="hud-law" data-law></div>`;
    parent.appendChild(this.el);
    this.hpFill = this.el.querySelector('[data-hpfill]')!;
    this.hpText = this.el.querySelector('[data-hp]')!;
    this.money = this.el.querySelector('[data-money]')!;
    this.name = this.el.querySelector('[data-name]')!;
    this.role = this.el.querySelector('[data-role]')!;
    this.lawEl = this.el.querySelector('[data-law]')!;
    this.hungerText = this.el.querySelector('[data-hunger]')!;
    this.hungerFill = this.el.querySelector('[data-hungerfill]')!;
    this.weaponEl = this.el.querySelector('[data-weapon]')!;
    this.rationEl = this.el.querySelector('[data-ration]')!;
  }

  update(p: Character, now: number, weapon: string, ration: string): void {
    const status = lawStatus(p, now);
    const hunger = Math.ceil(p.hunger);
    const key = `${Math.ceil(p.health)}|${p.maxHealth}|${p.money}|${p.name}|${p.faction}|${p.rank}|${p.division}|${p.cid}|${status}|${hunger}|${weapon}|${ration}`;
    if (key === this.last) return;
    this.last = key;
    const hp = Math.max(0, Math.ceil(p.health));
    this.hpText.textContent = String(hp);
    this.hpFill.style.width = `${(100 * hp) / p.maxHealth}%`;
    this.hpFill.classList.toggle('low', hp <= 25);
    this.money.textContent = String(p.money);
    this.hungerText.textContent = hunger <= 0 ? 'голод!' : `${hunger}`;
    this.hungerFill.style.width = `${hunger}%`;
    this.hungerFill.classList.toggle('low', hunger < 25);
    this.weaponEl.textContent = weapon;
    this.weaponEl.hidden = weapon === '';
    this.rationEl.textContent = ration;
    this.name.textContent = p.name;
    const f = FACTIONS[p.faction];
    const r = rankOf(p.faction, p.rank);
    const div = p.division ? ` · ${p.division.toUpperCase()}` : '';
    this.role.textContent = r ? `${f.role} · ${r.name}${div}` : `${f.role} · CID #${p.cid}`;
    this.role.style.color = r ? r.color : f.label;
    this.lawEl.textContent = status;
    this.lawEl.hidden = status === '';
  }
}

/** Строка «что со мной сейчас» для игрока. */
function lawStatus(p: Character, now: number): string {
  const l = p.law;
  switch (l.phase) {
    case 'ordered': return `${l.handler?.name ?? 'ГО'}: стоять на месте!`;
    case 'checking': return 'Проверка документов…';
    case 'fleeing': return 'Вы в бегах — ГО преследует!';
    case 'cuffed': return 'Задержаны. Конвой в КПЗ';
    case 'entering': return 'Вас заводят в камеру';
    case 'jailed': return `КПЗ: ещё ${Math.max(0, Math.ceil(l.jailUntil - now))} с`;
    case 'releasing': return 'Свободны';
  }
  return l.wanted ? 'В розыске' : '';
}
