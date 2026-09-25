import type { Character } from '../entities/Character';
import { ITEMS, type ItemId } from '../config/items';
import { ECONOMY } from '../config/economy';

export type ShopKind = 'cwu' | 'black';

export interface ShopHandlers {
  buy(id: ItemId): string | null;
  buyBlack(k: number): string | null;
  sell(id: ItemId): string | null;
}

/**
 * Прилавок (E): магазин ГСР или чёрный рынок в канализации (покупка оружия и патронов,
 * скупка трофеев и рационов). Закрывается, если отойти.
 */
export class ShopPanel {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private readonly sellList: HTMLElement;
  private readonly money: HTMLElement;
  private readonly msg: HTMLElement;
  private sellSig = '';
  kind: ShopKind = 'cwu';
  isOpen = false;

  constructor(parent: HTMLElement, private readonly h: ShopHandlers) {
    this.el = document.createElement('div');
    this.el.className = 'shop panel';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="inv-head"><span data-title></span><button class="role-close" title="Закрыть">×</button></div>
      <div class="shop-money"></div><div class="inv-list" data-buy></div><div class="inv-list shop-sell" data-sell></div><div class="shop-msg"></div>`;
    this.title = this.el.querySelector('[data-title]')!;
    this.list = this.el.querySelector('[data-buy]')!;
    this.sellList = this.el.querySelector('[data-sell]')!;
    this.money = this.el.querySelector('.shop-money')!;
    this.msg = this.el.querySelector('.shop-msg')!;
    parent.appendChild(this.el);
    this.el.querySelector('.role-close')!.addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      let err: string | null = null;
      let done = '';
      if (b.dataset.buy) {
        const id = b.dataset.buy as ItemId;
        err = this.h.buy(id);
        done = `Куплено: ${ITEMS[id].name}.`;
      } else if (b.dataset.black !== undefined) {
        const s = ECONOMY.blackMarket.stock[Number(b.dataset.black)];
        err = this.h.buyBlack(Number(b.dataset.black));
        done = `Куплено: ${ITEMS[s.id].name}${s.qty > 1 ? ` ×${s.qty}` : ''}.`;
      } else if (b.dataset.sell) {
        const id = b.dataset.sell as ItemId;
        err = this.h.sell(id);
        done = `Продано: ${ITEMS[id].name}.`;
      } else return;
      this.msg.textContent = err ?? done;
      this.msg.classList.toggle('error', !!err);
      this.sellSig = '';
      b.blur();
    });
  }

  open(kind: ShopKind = 'cwu'): void {
    this.kind = kind;
    this.isOpen = true;
    this.el.hidden = false;
    this.msg.textContent = '';
    this.sellSig = '';
    this.el.classList.toggle('black', kind === 'black');
    if (kind === 'cwu') {
      this.title.textContent = 'МАГАЗИН ГСР';
      this.list.innerHTML = ECONOMY.shop.stock
        .map((id) => {
          const d = ITEMS[id];
          return `<div class="inv-row"><div><b>${d.name}</b><div class="inv-desc">${d.desc}</div></div><button data-buy="${id}">${d.price} ток.</button></div>`;
        })
        .join('');
    } else {
      this.title.textContent = 'ЧЁРНЫЙ РЫНОК';
      this.list.innerHTML = ECONOMY.blackMarket.stock
        .map((s, k) => {
          const d = ITEMS[s.id];
          return `<div class="inv-row"><div><b>${d.name}${s.qty > 1 ? ` ×${s.qty}` : ''}</b><div class="inv-desc">${d.desc}</div></div><button data-black="${k}">${s.price} ток.</button></div>`;
        })
        .join('');
    }
  }

  close(): void {
    this.isOpen = false;
    this.el.hidden = true;
  }

  update(p: Character, counter: { x: number; y: number } | null): void {
    if (!this.isOpen) return;
    this.money.textContent = `Токены: ${p.money}`;
    if (!counter || Math.hypot(counter.x - p.x, counter.y - p.y) > 80) {
      this.close();
      return;
    }
    // Скупка — только на чёрном рынке: что из инвентаря берут и почём.
    if (this.kind !== 'black') {
      this.sellList.hidden = true;
      return;
    }
    const sellable = p.inventory.slots.filter((s) => ECONOMY.blackMarket.sell[s.id] !== undefined);
    const sig = sellable.map((s) => `${s.id}:${s.qty}`).join(',');
    if (sig === this.sellSig) return;
    this.sellSig = sig;
    this.sellList.hidden = sellable.length === 0;
    this.sellList.innerHTML =
      '<div class="inv-sub">СКУПКА</div>' +
      sellable
        .map((s) => `<div class="inv-row"><div><b>${ITEMS[s.id].name}</b>${s.qty > 1 ? ` ×${s.qty}` : ''}</div><button data-sell="${s.id}">+${ECONOMY.blackMarket.sell[s.id]} ток.</button></div>`)
        .join('');
  }
}
