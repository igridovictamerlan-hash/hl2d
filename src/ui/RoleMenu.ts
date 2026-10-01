import { FACTIONS, cpUnit, cpGroup, type FactionId, type DivisionId } from '../config/factions';
import { PROFESSIONS, DEFAULT_PROFESSION, professionsOf, type ProfessionId } from '../config/professions';
import { ROLE_MENU, type RoleCardDef } from '../config/menus';
import { drawPortrait, previewLook, previewWeapon } from './menuArt';
import type { PawnDir } from '../entities/PawnRenderer';

/** Поворот пешки под мышью: по часовой — лицом, правым боком, спиной, левым боком. */
const TURN: PawnDir[] = ['S', 'W', 'N', 'E'];

/** Имя персонажа для меню роли: текущее и новое случайное (задаёт Game). */
export interface RoleNames {
  current(): string;
  suggest(): string;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/**
 * Выбор роли — «карточки сторон» (лист меню R1): при старте и у терминала найма. Карточка стороны —
 * живая пешка той же отрисовкой, что в игре (меняется с профессией и юнитом), сложность, чем
 * заняться, где появляетесь. Выбранная карточка шире: профессии (ГО — юнит с описанием), их умения.
 * Внизу — имя (у ГО позывной назначается), «другое имя», новая игра и «Играть за …».
 * Клавиши: 1–5 и ←/→ — сторона, Enter — играть, Esc — закрыть (если роль уже есть).
 */
export class RoleMenu {
  private readonly el: HTMLElement;
  private readonly cardsEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly nameInput: HTMLInputElement;
  private readonly diceBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly factions: FactionId[];
  private selected: FactionId;
  /** Выбор внутри стороны: юнит ГО и профессия каждой стороны. */
  private readonly rank: Partial<Record<FactionId, number>> = {};
  private readonly prof: Partial<Record<FactionId, ProfessionId>> = {};
  private armed = false;
  /** Карточка под мышью — её пешка поворачивается. */
  private turnId: FactionId | null = null;
  private turn = 0;
  private turnTimer = 0;
  private armTimer = 0;
  isOpen = false;
  /** Меню роли под другим окном (главное меню поверх) — клавиши не трогает. */
  blocked: () => boolean = () => false;

  constructor(
    parent: HTMLElement,
    private readonly onChoose: (faction: FactionId, rank: number, division: DivisionId | null, profession: ProfessionId | null, name: string | null) => void,
    private readonly onNewGame: () => void = () => {},
    private readonly names: RoleNames = { current: () => '', suggest: () => '' },
  ) {
    this.factions = ROLE_MENU.order.filter((id) => FACTIONS[id]?.selectable);
    this.selected = ROLE_MENU.initial;
    for (const id of this.factions) {
      const list = professionsOf(id, true);
      const def = DEFAULT_PROFESSION[id];
      this.prof[id] = list.find((p) => p.id === def)?.id ?? list[0]?.id;
      if (id === 'cp') this.rank[id] = 0;
    }
    this.el = document.createElement('div');
    this.el.className = 'role-menu';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="rm-box" role="dialog" aria-label="Выбор роли">
        <header class="rm-head">
          <h2 class="rm-title">${ROLE_MENU.title}</h2>
          <span class="rm-hint">${ROLE_MENU.hint}</span>
          <button class="rm-close" aria-label="Закрыть (Esc)">×</button>
        </header>
        <div class="rm-cards"></div>
        <footer class="rm-foot">
          <label class="rm-name">Имя <input maxlength="${ROLE_MENU.nameMax}" spellcheck="false" autocomplete="off"></label>
          <button class="rm-dice" type="button">Другое имя</button>
          <button class="rm-new" type="button" data-new>${ROLE_MENU.newGame}</button>
          <button class="rm-play" type="button" data-play></button>
        </footer>
      </div>`;
    parent.appendChild(this.el);
    this.cardsEl = this.el.querySelector('.rm-cards')!;
    this.closeBtn = this.el.querySelector('.rm-close')!;
    this.nameInput = this.el.querySelector('.rm-name input')!;
    this.diceBtn = this.el.querySelector('.rm-dice')!;
    this.playBtn = this.el.querySelector('[data-play]')!;
    this.newBtn = this.el.querySelector('[data-new]')!;
    this.closeBtn.addEventListener('click', () => this.close());
    this.diceBtn.addEventListener('click', () => {
      const n = this.names.suggest();
      if (n) this.nameInput.value = n;
    });
    this.playBtn.addEventListener('click', () => this.play());
    this.newBtn.addEventListener('click', () => this.newGame());
    this.cardsEl.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const card = t.closest<HTMLElement>('[data-card]');
      const chip = t.closest<HTMLElement>('[data-prof]');
      if (chip && card) {
        this.prof[card.dataset.card as FactionId] = chip.dataset.prof as ProfessionId;
        this.render();
        return;
      }
      if (t.closest('select')) return;
      if (card) this.select(card.dataset.card as FactionId);
    });
    this.cardsEl.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      if (sel.dataset.rank === undefined) return;
      this.rank[sel.dataset.rank as FactionId] = Number(sel.value);
      this.render();
    });
    // Перехват до управления игрой: цифры и стрелки выбора не должны уходить персонажу.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    this.cardsEl.addEventListener('mouseover', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-card]')?.dataset.card as FactionId | undefined;
      if (id && id !== this.turnId) this.startTurn(id);
    });
    this.cardsEl.addEventListener('mouseleave', () => this.stopTurn());
    window.addEventListener('resize', () => this.isOpen && this.paint());
  }

  /** first — стартовый выбор: закрыть без выбора нельзя. */
  open(first = false): void {
    this.isOpen = true;
    this.el.hidden = false;
    this.closeBtn.hidden = first;
    this.nameInput.value = this.names.current() || this.names.suggest();
    this.render();
    this.playBtn.focus({ preventScroll: true });
  }

  close(): void {
    this.isOpen = false;
    this.el.hidden = true;
    this.stopTurn();
  }

  private startTurn(id: FactionId): void {
    this.stopTurn();
    this.turnId = id;
    this.turnTimer = window.setInterval(() => {
      this.turn = (this.turn + 1) % TURN.length;
      this.paint(id);
    }, ROLE_MENU.turnMs);
  }

  private stopTurn(): void {
    window.clearInterval(this.turnTimer);
    const id = this.turnId;
    this.turnId = null;
    this.turn = 0;
    if (id && this.isOpen) this.paint(id);
  }

  private select(id: FactionId): void {
    if (this.selected === id) return;
    this.selected = id;
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen || this.blocked() || e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = document.activeElement === this.nameInput;
    if (e.code === 'Escape') {
      if (!this.closeBtn.hidden) this.close();
      return;
    }
    const active = document.activeElement;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // Enter на своей кнопке (чип, «другое имя») — её клик; иначе — играть.
      if (!(active instanceof HTMLButtonElement && active !== this.playBtn && this.el.contains(active))) {
        e.preventDefault();
        this.play();
      }
      e.stopPropagation();
      return;
    }
    if (typing || active instanceof HTMLSelectElement) {
      e.stopPropagation();
      return;
    }
    const k = this.factions.indexOf(this.selected);
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      const d = e.code === 'ArrowRight' ? 1 : -1;
      this.select(this.factions[(k + d + this.factions.length) % this.factions.length]);
    } else if (digit && Number(digit[1]) <= this.factions.length) this.select(this.factions[Number(digit[1]) - 1]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private play(): void {
    const id = this.selected;
    const rank = this.rank[id] ?? 0;
    const prof = this.prof[id] ?? null;
    const name = id === 'cp' ? null : this.nameInput.value.trim().slice(0, ROLE_MENU.nameMax) || null;
    this.close();
    this.onChoose(id, rank, id === 'cp' ? cpGroup(rank) : null, prof, name);
  }

  /** Новая игра — подтверждение вторым нажатием (window.confirm в песочнице не работает). */
  private newGame(): void {
    window.clearTimeout(this.armTimer);
    if (!this.armed) {
      this.armed = true;
      this.newBtn.textContent = ROLE_MENU.newGameArmed;
      this.newBtn.classList.add('armed');
      this.armTimer = window.setTimeout(() => {
        this.armed = false;
        this.newBtn.textContent = ROLE_MENU.newGame;
        this.newBtn.classList.remove('armed');
      }, ROLE_MENU.armMs);
      return;
    }
    this.armed = false;
    this.newBtn.textContent = ROLE_MENU.newGame;
    this.newBtn.classList.remove('armed');
    this.close();
    this.onNewGame();
  }

  private render(): void {
    const sel = this.selected;
    this.cardsEl.style.gridTemplateColumns = this.factions.map((id) => (id === sel ? `minmax(0, ${ROLE_MENU.selectedSpan}fr)` : 'minmax(0, 1fr)')).join(' ');
    this.cardsEl.innerHTML = this.factions.map((id, k) => this.cardHtml(id, k, id === sel)).join('');
    const cp = sel === 'cp';
    this.nameInput.disabled = cp;
    this.diceBtn.disabled = cp;
    this.nameInput.placeholder = cp ? ROLE_MENU.cpName : '';
    if (cp) this.nameInput.value = '';
    else if (!this.nameInput.value) this.nameInput.value = this.names.current() || this.names.suggest();
    this.playBtn.textContent = `ИГРАТЬ ЗА ${ROLE_MENU.playAs[sel] ?? FACTIONS[sel].role.toUpperCase()}`;
    this.playBtn.style.setProperty('--rm-accent', this.def(sel).accent);
    this.paint();
  }

  private def(id: FactionId): RoleCardDef {
    return ROLE_MENU.cards[id] ?? { title: FACTIONS[id].plural, difficulty: 1, tagline: FACTIONS[id].description, activities: [], spawn: '', backdrop: '#2a231d', accent: '#c9bba6' };
  }

  /** Пешки на карточках — в холсты (после разметки); only — одну карточку. */
  private paint(only?: FactionId): void {
    const P = ROLE_MENU.portrait;
    this.cardsEl.querySelectorAll<HTMLCanvasElement>(only ? `canvas[data-portrait="${only}"]` : 'canvas[data-portrait]').forEach((cv) => {
      const id = cv.dataset.portrait as FactionId;
      const rank = this.rank[id] ?? 0;
      const prof = this.prof[id] ?? null;
      const sel = id === this.selected;
      const seed = 17 + this.factions.indexOf(id) * 131 + (prof ? prof.length * 7 : 0);
      drawPortrait(cv, previewLook(id, rank, prof, seed), previewWeapon(id, rank, prof), sel ? P.selectedScale : P.scale, P.ground, id === this.turnId ? TURN[this.turn] : 'S');
    });
  }

  private cardHtml(id: FactionId, k: number, sel: boolean): string {
    const d = this.def(id);
    const dots = [1, 2, 3].map((n) => `<i class="${n <= d.difficulty ? 'on' : ''}"></i>`).join('');
    const profs = professionsOf(id, true);
    const curProf = this.prof[id];
    let body: string;
    if (!sel) {
      const chips = profs.length > 1 ? `<div class="rm-chips">${profs.slice(0, 5).map((p) => `<span>${esc(shortName(p.name))}</span>`).join('')}${profs.length > 5 ? `<span>+${profs.length - 5}</span>` : ''}</div>` : '';
      body = `<ul class="rm-acts">${d.activities.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>${chips}`;
    } else {
      const opts: string[] = [];
      if (id === 'cp') {
        const r = this.rank[id] ?? 0;
        opts.push(`<label class="rm-field">Юнит<select data-rank="cp">${(FACTIONS.cp.ranks ?? []).map((u, i) => `<option value="${i}"${i === r ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
          <p class="rm-unit">${esc(cpUnit(r).desc)}</p>`);
      }
      if (profs.length > 1) {
        opts.push(`<div class="rm-field">Профессия<div class="rm-chips pick">${profs
          .map((p) => `<button type="button" data-prof="${p.id}" class="${p.id === curProf ? 'on' : ''}" aria-pressed="${p.id === curProf}">${esc(shortName(p.name))}</button>`)
          .join('')}</div></div>`);
      }
      const p = curProf ? PROFESSIONS[curProf] : null;
      const perks = p ? `<div class="rm-perks"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span><ul>${p.perks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
      body = opts.join('') + perks;
    }
    return `<div class="rm-card${sel ? ' sel' : ''}" data-card="${id}" style="--rm-accent:${d.accent};--rm-back:${d.backdrop}">
        ${sel ? '<span class="rm-badge">ВЫБРАНО</span>' : ''}
        <button type="button" class="rm-hit" aria-pressed="${sel}" aria-label="${esc(d.title)}">
          <span class="rm-portrait"><canvas data-portrait="${id}"></canvas><kbd>${k + 1}</kbd></span>
          <span class="rm-name-line">${esc(d.title)}</span>
          <span class="rm-diff">Сложность <span class="dots">${dots}</span></span>
          <span class="rm-tag">${esc(d.tagline)}</span>
          <span class="rm-spawn">Появление: ${esc(d.spawn)}</span>
        </button>
        <div class="rm-body">${body}</div>
      </div>`;
  }
}

/** Короткое имя профессии на чипе: без хвоста «ГСР». */
function shortName(n: string): string {
  return n.replace(/\s+ГСР$/, '').replace(' склада', '');
}
