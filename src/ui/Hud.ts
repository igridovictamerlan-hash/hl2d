import type { Character } from '../entities/Character';
import { FACTIONS, CP_DIVISIONS, rankOf } from '../config/factions';
import { PROFESSIONS, DEFAULT_PROFESSION } from '../config/professions';
import { hasLoyalty, loyaltyTier } from '../systems/Loyalty';

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
  private loyaltyEl: HTMLElement;
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
      <div class="hud-id"><div class="hud-name" data-name></div><div class="hud-role" data-role></div><div class="hud-loyalty" data-loyalty></div></div>
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
    this.loyaltyEl = this.el.querySelector('[data-loyalty]')!;
  }

  /** rallyCooldown — до готовности клича главы восстания, с (-1 — не глава). */
  update(p: Character, now: number, weapon: string, ration: string, rallyCooldown = -1): void {
    const status = lawStatus(p, now);
    const hunger = Math.ceil(p.hunger);
    const key = `${Math.ceil(p.health)}|${p.maxHealth}|${p.money}|${p.name}|${p.faction}|${p.rank}|${p.division}|${p.cid}|${status}|${hunger}|${weapon}|${ration}|${p.loyalty}`;
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
    const div = p.division ? ` · ${CP_DIVISIONS[p.division].short}` : '';
    const prof = p.profession ? PROFESSIONS[p.profession] : null;
    const pname = prof && prof.id !== DEFAULT_PROFESSION[p.faction] ? ` · ${prof.name}` : '';
    const mask = p.disguised ? ' · в маскировке' : '';
    // Глава восстания: готовность клича.
    const cd = p.profession === 'rebel_leader' && p.faction === 'rebel' ? rallyCooldown : -1;
    const rally = cd < 0 ? '' : cd > 0 ? ` · клич через ${Math.ceil(cd)} с` : ' · клич готов (G)';
    this.role.textContent = r ? `${f.role} · ${r.name}${div}${pname}${mask}${rally}` : `${prof && pname ? prof.name : f.role} · CID #${p.cid}`;
    this.role.style.color = r ? r.color : f.label;
    const loyal = hasLoyalty(p);
    this.loyaltyEl.hidden = !loyal;
    if (loyal) {
      const t = loyaltyTier(p);
      this.loyaltyEl.textContent = `Лояльность ${p.loyalty} · ${t.name}`;
      this.loyaltyEl.style.color = t.color;
    }
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
