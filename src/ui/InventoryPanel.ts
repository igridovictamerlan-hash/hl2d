import type { Character } from '../entities/Character';
import { ITEMS, WEAPONS, type ItemId, type WeaponId, type WeaponDef } from '../config/items';

export interface InventoryHost {
  useItem(id: ItemId): void;
  equipItem(id: WeaponId | null): void;
}

/** Инвентарь (Tab): еда и лекарства — применить, оружие — взять в руки / убрать. */
export class InventoryPanel {
  private readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private sig = '';
  isOpen = false;

  constructor(parent: HTMLElement, private readonly host: InventoryHost) {
    this.el = document.createElement('div');
    this.el.className = 'inventory panel';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="inv-head"><span>ИНВЕНТАРЬ</span><span class="dev-key">Tab</span></div><div class="inv-list"></div>`;
    this.list = this.el.querySelector('.inv-list')!;
    parent.appendChild(this.el);
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!b) return;
      const id = b.dataset.id as ItemId;
      if (b.dataset.act === 'use') this.host.useItem(id);
      else if (b.dataset.act === 'equip') this.host.equipItem(id as WeaponId);
      else if (b.dataset.act === 'holster') this.host.equipItem(null);
      b.blur();
    });
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.el.hidden = !this.isOpen;
    this.sig = '';
  }

  update(p: Character): void {
    if (!this.isOpen) return;
    const sig = p.inventory.slots.map((s) => `${s.id}:${s.qty}`).join(',') + `|${p.weapon}`;
    if (sig === this.sig) return;
    this.sig = sig;
    if (p.inventory.slots.length === 0) {
      this.list.innerHTML = '<div class="inv-empty">Пусто.</div>';
      return;
    }
    this.list.innerHTML = p.inventory.slots
      .map((s) => {
        const def = ITEMS[s.id];
        let action = '';
        if (def.food || def.heal) action = `<button data-id="${s.id}" data-act="use">${def.food ? 'Съесть' : 'Применить'}</button>`;
        else if (def.kind === 'weapon') {
          action = p.weapon === s.id
            ? `<button data-id="${s.id}" data-act="holster">Убрать</button>`
            : `<button data-id="${s.id}" data-act="equip">В руки</button>`;
        }
        const extra = def.kind === 'weapon' ? `<div class="inv-stats">${weaponStats(WEAPONS[s.id as WeaponId], p.weapon === s.id ? p.mag : p.mags[s.id as WeaponId])}</div>` : '';
        return `<div class="inv-row${p.weapon === s.id ? ' active' : ''}"><div><b>${def.name}</b>${s.qty > 1 ? ` ×${s.qty}` : ''}<div class="inv-desc">${def.desc}${extra}</div></div>${action}</div>`;
      })
      .join('');
  }
}

/** Характеристики оружия одной строкой для инвентаря. */
function weaponStats(w: WeaponDef, mag: number | undefined): string {
  if (w.mode === 'melee') return `урон ${w.damage} · оглушение ${w.stun} с · ${w.fireRate} уд/с`;
  const dmg = w.pellets > 1 ? `${w.damage}×${w.pellets}` : `${w.damage}`;
  const parts = [
    `урон ${dmg}`,
    `${w.fireRate} выстр/с`,
    `дальность ${w.effectiveRange}/${w.range}`,
    `разброс ±${w.spreadHip}°→±${w.spreadAim}° за ${w.aimTime} с`,
    `магазин ${mag ?? '—'}/${w.magazine}`,
    `перезарядка ${w.reload} с${w.perRound ? ' на патрон' : ''}`,
  ];
  if (w.penetration > 0) parts.push(`пробитие ${Math.round(w.penetration * 100)}%`);
  return parts.join(' · ');
}
