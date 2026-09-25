import { FACTIONS, CP_DIVISIONS, type FactionId, type DivisionId } from '../config/factions';

/**
 * Выбор роли: при старте и у терминала найма на площади. У ГО и повстанцев — выбор ранга
 * (от него зависит цвет кружка).
 */
export class RoleMenu {
  private readonly el: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly onChoose: (faction: FactionId, rank: number, division: DivisionId | null) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'role-menu';
    this.el.hidden = true;
    const cards = (Object.keys(FACTIONS) as FactionId[])
      .filter((id) => FACTIONS[id].selectable)
      .map((id) => {
        const f = FACTIONS[id];
        const ranks = f.ranks
          ? `<label class="role-rank">Ранг <select id="rank-${id}">${f.ranks
              .map((r, i) => `<option value="${i}">${r.name}</option>`)
              .join('')}</select></label>`
          : '';
        const divisions =
          id === 'cp'
            ? `<label class="role-rank">Отряд <select id="division-cp">${Object.values(CP_DIVISIONS)
                .map((d) => `<option value="${d.id}">${d.short} — ${d.name}</option>`)
                .join('')}</select></label><p class="role-div-desc">${CP_DIVISIONS.union.desc}</p>`
            : '';
        return `<div class="role-card" data-role="${id}">
            <div class="role-top"><span class="role-dot" style="background:${f.color};border-color:${f.outline}"></span><b>${f.plural}</b></div>
            <p>${f.description}</p>
            ${ranks}
            ${divisions}
            <button data-pick="${id}">Играть за: ${f.role}</button>
          </div>`;
      })
      .join('');
    this.el.innerHTML = `<div class="role-box panel-like">
        <div class="role-head"><span>ВЫБОР РОЛИ</span><button class="role-close" title="Закрыть (Esc)">×</button></div>
        <div class="role-cards">${cards}</div>
        <div class="role-foot">Сменить роль можно у терминала найма на площади раздачи (клавиша E).</div>
      </div>`;
    parent.appendChild(this.el);
    this.closeBtn = this.el.querySelector('.role-close')!;
    this.closeBtn.addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLButtonElement>('button[data-pick]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.pick as FactionId;
        const sel = this.el.querySelector<HTMLSelectElement>(`#rank-${id}`);
        const div = this.el.querySelector<HTMLSelectElement>(`#division-${id}`);
        this.close();
        this.onChoose(id, sel ? Number(sel.value) : 0, div ? (div.value as DivisionId) : null);
      }),
    );
    // Смена ранга сразу красит кружок на карточке.
    const divSel = this.el.querySelector<HTMLSelectElement>('#division-cp');
    divSel?.addEventListener('change', () => {
      this.el.querySelector('.role-div-desc')!.textContent = CP_DIVISIONS[divSel.value as DivisionId].desc;
    });
    this.el.querySelectorAll<HTMLSelectElement>('select[id^="rank-"]').forEach((sel) =>
      sel.addEventListener('change', () => {
        const id = sel.id.replace('rank-', '') as FactionId;
        const r = FACTIONS[id].ranks![Number(sel.value)];
        const dot = this.el.querySelector<HTMLElement>(`[data-role="${id}"] .role-dot`)!;
        dot.style.background = r.color;
        dot.style.borderColor = r.outline;
      }),
    );
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Escape' && !this.closeBtn.hidden) this.close();
    });
  }

  /** first — стартовый выбор: закрыть без выбора нельзя. */
  open(first = false): void {
    this.isOpen = true;
    this.el.hidden = false;
    this.closeBtn.hidden = first;
  }

  close(): void {
    this.isOpen = false;
    this.el.hidden = true;
  }
}
