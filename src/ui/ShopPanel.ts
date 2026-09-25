import type { Character } from '../entities/Character';
import { ITEMS, type ItemId } from '../config/items';
import { ECONOMY } from '../config/economy';

/** Магазин ГСР (E у прилавка). Закрывается, если отойти. */
export class ShopPanel {
  private readonly el: HTMLElement;
  private readonly money: HTMLElement;
  private readonly msg: HTMLElement;
  isOpen = false;

  constructor(parent: HTMLElement, private readonly onBuy: (id: ItemId) => string | null) {
    this.el = document.createElement('div');
    this.el.className = 'shop panel';
    this.el.hidden = true;
    const rows = ECONOMY.shop.stock
      .map((id) => {
        const d = ITEMS[id];
        return `<div class="inv-row"><div><b>${d.name}</b><div class="inv-desc">${d.desc}</div></div><button data-buy="${id}">${d.price} ток.</button></div>`;
      })
      .join('');
    this.el.innerHTML = `<div class="inv-head"><span>МАГАЗИН ГСР</span><button class="role-close" title="Закрыть">×</button></div>
      <div class="shop-money"></div><div class="inv-list">${rows}</div><div class="shop-msg"></div>`;
    this.money = this.el.querySelector('.shop-money')!;
    this.msg = this.el.querySelector('.shop-msg')!;
    parent.appendChild(this.el);
    this.el.querySelector('.role-close')!.addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLButtonElement>('button[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.buy as ItemId;
        const err = this.onBuy(id);
        this.msg.textContent = err ?? `Куплено: ${ITEMS[id].name}.`;
        this.msg.classList.toggle('error', !!err);
        b.blur();
      }),
    );
  }

  open(): void {
    this.isOpen = true;
    this.el.hidden = false;
    this.msg.textContent = '';
  }

  close(): void {
    this.isOpen = false;
    this.el.hidden = true;
  }

  update(p: Character, counter: { x: number; y: number } | null): void {
    if (!this.isOpen) return;
    this.money.textContent = `Токены: ${p.money}`;
    if (!counter || Math.hypot(counter.x - p.x, counter.y - p.y) > 80) this.close();
  }
}
