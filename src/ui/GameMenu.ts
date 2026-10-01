import { CONTROLS_GROUPS } from './HelpBar';
import { ID_CARD, INTRO } from '../config/menus';

/** Вводную о городе показываем сами один раз (дальше — пункт меню). */
function loreSeen(): boolean {
  try {
    return localStorage.getItem(INTRO.storageKey) === '1';
  } catch {
    return true;
  }
}
function markLoreSeen(): void {
  try {
    localStorage.setItem(INTRO.storageKey, '1');
  } catch {
    /* не запомним — покажем ещё раз */
  }
}
import type { PawnLook } from '../entities/PawnRenderer';
import type { WeaponId } from '../config/items';
import { drawPortrait } from './menuArt';

/** Данные удостоверения: игрок как его видит проверяющий (под личиной — личина). */
export interface IdCardInfo {
  name: string;
  cid: string;
  /** Сторона и уточнение (юнит, профессия). */
  role: string;
  detail: string;
  /** Уровень лояльности (только граждане и ТС). */
  loyalty: { name: string; color: string; points: number } | null;
  money: number;
  look: PawnLook;
  weapon: WeaponId | null;
  wanted: boolean;
  /** Документы поддельные (подпольщик под личиной). */
  forged: boolean;
  seed: number;
  clock: string;
}

export interface GameMenuHost {
  /** Есть ли что продолжать (сохранение или идущая игра). */
  canContinue(): boolean;
  continueGame(): void;
  newGame(): void;
  save(): boolean;
  changeRole(): void;
  toggleSound(): boolean;
  readonly soundMuted: boolean;
  /** Атмосфера: свет и время суток, дымок, зерно. */
  toggleLighting(): boolean;
  readonly lightingOn: boolean;
  /** Упрощена под слабую машину. */
  readonly lightingLite: boolean;
  /** Экспериментальный режим «отряд на отряд»: начать за сторону, идёт ли, выйти в город. */
  startArena(side: 'combine' | 'rebel'): void;
  readonly inArena: boolean;
  leaveArena(): void;
  /** Удостоверение игрока; роли ещё нет — null (бланк). */
  idCard(): IdCardInfo | null;
}

type Screen = 'buttons' | 'controls' | 'confirmNew' | 'arena' | 'lore';
type StampKind = keyof typeof ID_CARD.stamps;

interface Item {
  act: string;
  label: string;
  primary?: boolean;
  /** Переключатель: отмечен ли и подпись значения. */
  on?: boolean;
  value?: string;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Штрихкод по строке (детерминированно): полосы 1–3 px, SVG. */
function barcode(code: string, w = 220, h = 34): string {
  let s = 2166136261;
  for (const ch of code) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  const bars: string[] = [];
  let x = 0;
  let k = 0;
  while (x < w - 4) {
    s = Math.imul(s ^ (s >>> 13), 1274126177) ^ k++;
    const bw = 1 + (Math.abs(s) % 3);
    const gap = 1 + (Math.abs(s >> 5) % 3);
    bars.push(`<rect x="${x}" width="${bw}" height="${h}"/>`);
    x += bw + gap;
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${bars.join('')}</svg>`;
}

/**
 * Меню игры — бумажное удостоверение гражданина на столе под лампой (лист меню M4). Главное (при
 * запуске и «Выйти в главное меню»): продолжить, новая регистрация, учения, памятка, звук, атмосфера.
 * Пауза (Esc в игре): вернуться, сохранить, сменить роль, памятка, звук, атмосфера, выйти. Слева — фото
 * своей пешки (как на карте, с оружием в руках), CID, статус, лояльность, токены, подпись, штрихкод;
 * печать — «допущен», «ожидает регистрации», «в розыске», на подтверждении новой игры — «аннулировать?».
 * Пункты — графы с квадратиком (наведение — крестик карандашом), 1–9 и ↑/↓ — выбрать. Пока меню
 * открыто, мир стоит.
 */
export class GameMenu {
  private readonly el: HTMLElement;
  private card!: HTMLElement;
  private mode: 'main' | 'pause' = 'main';
  private screen: Screen = 'buttons';
  private note = '';
  private noteOk = true;
  private stamp: StampKind | null = null;

  constructor(parent: HTMLElement, private readonly host: GameMenuHost) {
    this.el = document.createElement('div');
    this.el.className = 'game-menu';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (b?.dataset.act) this.act(b.dataset.act);
    });
    this.el.addEventListener('mouseover', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.idc-item');
      if (b && document.activeElement !== b) b.focus({ preventScroll: true });
    });
    // Перехват до управления игрой: цифры и стрелки в меню не должны уходить персонажу.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('resize', () => this.isOpen && this.paintPhoto());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  get isMain(): boolean {
    return this.isOpen && this.mode === 'main';
  }

  open(mode: 'main' | 'pause'): void {
    this.mode = mode;
    this.screen = 'buttons';
    // Первый запуск — сначала вводная о городе (листок поверх удостоверения).
    if (mode === 'main' && !loreSeen()) this.screen = 'lore';
    this.note = '';
    this.stamp = null;
    this.el.hidden = false;
    this.el.classList.toggle('main', mode === 'main');
    this.build();
  }

  close(): void {
    this.el.hidden = true;
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  /** Esc внутри меню: из памятки и подтверждения — назад, в паузе — продолжить. */
  back(): void {
    if (this.screen !== 'buttons') {
      this.screen = 'buttons';
      this.render();
    } else if (this.mode === 'pause') this.close();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen || e.code === 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
    const items = [...this.el.querySelectorAll<HTMLButtonElement>('.idc-item')];
    if (!items.length) return;
    const k = items.indexOf(document.activeElement as HTMLButtonElement);
    const n = items.length;
    const confirm = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      const d = e.code === 'ArrowDown' ? 1 : -1;
      items[k < 0 ? (d > 0 ? 0 : n - 1) : (k + d + n) % n].focus();
      e.preventDefault();
    } else if (/^(Digit|Numpad)[1-9]$/.test(e.code)) {
      items[Number(e.code.slice(-1)) - 1]?.click();
      e.preventDefault();
    } else if (confirm && k < 0) {
      items[0].click();
      e.preventDefault();
    } else if (!confirm) return;
    // Enter/пробел на пункте — его собственный клик; игре клавиши меню не отдаём.
    e.stopPropagation();
  }

  private act(a: string): void {
    const h = this.host;
    switch (a) {
      case 'continue':
        this.close();
        h.continueGame();
        return;
      case 'new':
        // Подтверждение — своим экраном: window.confirm в песочнице (опубликованная страница) сразу
        // возвращает «нет», и кнопка молча не работала.
        if (h.canContinue()) {
          this.screen = 'confirmNew';
          break;
        }
        this.close();
        h.newGame();
        return;
      case 'newYes':
        this.close();
        h.newGame();
        return;
      case 'save':
        this.noteOk = h.save();
        this.note = this.noteOk ? 'Внесено в реестр: игра сохранена.' : 'Не внесено: роль не выбрана или хранилище недоступно.';
        break;
      case 'role':
        this.close();
        h.changeRole();
        return;
      case 'lore':
        this.screen = 'lore';
        break;
      case 'sound':
        h.toggleSound();
        break;
      case 'light':
        h.toggleLighting();
        break;
      case 'controls':
        this.screen = 'controls';
        break;
      case 'arena':
        this.screen = 'arena';
        break;
      case 'arenaCombine':
      case 'arenaRebel':
        this.close();
        h.startArena(a === 'arenaCombine' ? 'combine' : 'rebel');
        return;
      case 'leaveArena':
        this.close();
        h.leaveArena();
        return;
      case 'back':
        this.screen = 'buttons';
        break;
      case 'exit':
        h.save();
        this.open('main');
        return;
    }
    this.render(a);
  }

  /** Каркас: стол, удостоверение (левая колонка — один раз за открытие, с анимацией). */
  private build(): void {
    const info = this.host.idCard();
    const main = this.mode === 'main';
    const P = ID_CARD.photo;
    const photo = info
      ? `<canvas class="idc-photo-cv" style="width:${P.width}px;height:${P.height}px"></canvas>`
      : '<span class="idc-nophoto">ФОТО<br>3 × 4</span>';
    const dash = '<span class="idc-blank"></span>';
    const loyalty = info?.loyalty
      ? `<span style="color:${info.loyalty.color}" class="idc-ink">${esc(info.loyalty.name)}</span> <small>(${info.loyalty.points})</small>`
      : info ? '<small>не учитывается</small>' : dash;
    const cid = info?.cid ?? '';
    this.el.innerHTML = `
      ${main ? '<div class="gm-desk" aria-hidden="true"><i class="gm-lamp"></i><i class="gm-ring"></i><i class="gm-sheet a"></i><i class="gm-sheet b"></i><i class="gm-pen"></i><i class="gm-clip-loose"></i></div>' : ''}
      <article class="idc${info ? '' : ' blank'}" role="dialog" aria-label="${main ? 'Главное меню' : 'Пауза'}">
        <i class="idc-crease" aria-hidden="true"></i><i class="idc-dogear" aria-hidden="true"></i><i class="idc-watermark" aria-hidden="true">ВР</i>
        <section class="idc-left">
          <div class="idc-photo${info?.wanted ? ' wanted' : ''}">
            <i class="idc-scale" aria-hidden="true"><b>190</b><b>180</b><b>170</b><b>160</b></i>
            ${photo}
            <i class="idc-clip" aria-hidden="true"></i>
            <i class="idc-seal" aria-hidden="true">НАДЗОР<br>ВР</i>
          </div>
          <dl class="idc-fields">
            <dt>CID</dt><dd>${info ? `#${esc(cid)}${info.forged ? '<span class="idc-pencil">липа</span>' : ''}` : dash}</dd>
            <dt>Статус</dt><dd class="${info?.wanted ? 'idc-red' : ''}">${info ? esc(info.wanted ? 'В РОЗЫСКЕ' : info.role.toUpperCase()) : dash}</dd>
            <dt>Служба</dt><dd>${info?.detail ? esc(info.detail) : info ? '<small>—</small>' : dash}</dd>
            <dt>Лояльн.</dt><dd>${loyalty}</dd>
            <dt>Токены</dt><dd>${info ? info.money : dash}</dd>
          </dl>
          <div class="idc-sign"><span class="idc-sig">${info ? esc(info.name) : ''}</span><small>подпись владельца</small></div>
          <div class="idc-bar">${barcode(cid || 'BLANK')}</div>
          <div class="idc-serial">СЕРИЯ ${info ? String(info.seed % 1000).padStart(3, '0') : '———'} · № ${cid ? esc(cid.padStart(6, '0')) : '——————'}</div>
        </section>
        <section class="idc-right"></section>
      </article>
      <div class="idc-memo" hidden></div>`;
    this.card = this.el.querySelector('.idc')!;
    this.render();
    this.paintPhoto();
  }

  private paintPhoto(): void {
    const cv = this.el.querySelector<HTMLCanvasElement>('.idc-photo-cv');
    const info = this.host.idCard();
    if (!cv || !info) return;
    const P = ID_CARD.photo;
    drawPortrait(cv, info.look, info.weapon, P.scale, P.ground, 'S');
  }

  /** Правая колонка, памятка и печать — по экрану; focusAct — какой пункт оставить в фокусе. */
  private render(focusAct?: string): void {
    const h = this.host;
    const info = h.idCard();
    const main = this.mode === 'main';
    const right = this.card.querySelector<HTMLElement>('.idc-right')!;
    const memo = this.el.querySelector<HTMLElement>('.idc-memo')!;
    const head = `<header class="idc-top"><span class="idc-city">ВЕРХНЕРЕЧЬЕ</span><span class="idc-form">${main ? ID_CARD.form : ID_CARD.pauseForm}</span></header>
      <div class="idc-name"><span>Фамилия, имя</span><b>${info ? esc(info.name) : '<span class="idc-blank wide"></span>'}</b>${info ? `<small>${esc(info.clock)}</small>` : ''}</div>`;
    const L = ID_CARD.labels;
    let heading = main ? ID_CARD.heading : ID_CARD.pauseHeading;
    let text = '';
    let items: Item[];
    const sheet = this.screen === 'controls' || this.screen === 'lore';
    memo.hidden = !sheet;
    if (this.screen === 'lore') {
      markLoreSeen();
      memo.innerHTML = `<header><b>${INTRO.title}</b><span>${INTRO.sub}</span></header>
        <div class="idc-lore">${INTRO.text.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
        <div class="idc-lore-who">${INTRO.who.map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>
        <nav class="idc-menu"><button type="button" class="idc-item primary" data-act="back"><span class="box"></span><span class="lbl">${INTRO.ok}</span><kbd>1</kbd></button></nav>`;
      items = [{ act: 'back', label: INTRO.ok, primary: true }];
      heading = 'ВВОДНАЯ ПРИЛОЖЕНА · ОЗНАКОМЬТЕСЬ';
    } else if (this.screen === 'controls') {
      memo.innerHTML = `<header><b>${ID_CARD.controlsTitle}</b><span>приложение к форме 17</span></header>
        <div class="idc-memo-cols">${CONTROLS_GROUPS.map(([title, rows]) => `<section><h4>${esc(title)}</h4>${rows.map(([k, v]) => `<div><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('')}</section>`).join('')}</div>
        <nav class="idc-menu"><button type="button" class="idc-item primary" data-act="back"><span class="box"></span><span class="lbl">${L.back}</span><kbd>1</kbd></button></nav>`;
      items = [{ act: 'back', label: L.back, primary: true }];
      heading = 'ПАМЯТКА ПРИЛОЖЕНА · ОЗНАКОМЬТЕСЬ';
    } else if (this.screen === 'confirmNew') {
      text = ID_CARD.confirmNew;
      heading = 'АННУЛИРОВАНИЕ УДОСТОВЕРЕНИЯ';
      items = [{ act: 'newYes', label: L.newYes, primary: true }, { act: 'back', label: L.newNo }];
    } else if (this.screen === 'arena') {
      text = ID_CARD.arenaText;
      heading = 'НАПРАВЛЕНИЕ НА УЧЕНИЯ';
      items = [{ act: 'arenaRebel', label: L.arenaRebel, primary: true }, { act: 'arenaCombine', label: L.arenaCombine }, { act: 'back', label: L.back }];
    } else {
      const sound: Item = { act: 'sound', label: L.sound, on: !h.soundMuted, value: h.soundMuted ? 'ВЫКЛ' : 'ВКЛ' };
      const light: Item = { act: 'light', label: L.light, on: h.lightingOn, value: h.lightingOn ? (h.lightingLite ? L.lightLite.toUpperCase() : 'ВКЛ') : 'ВЫКЛ' };
      items = main
        ? [
            { act: 'continue', label: h.canContinue() ? L.continue : L.register, primary: true },
            ...(h.canContinue() ? [{ act: 'new', label: L.newGame }] : []),
            { act: 'lore', label: INTRO.item },
            { act: 'arena', label: L.arena },
            { act: 'controls', label: L.controls },
            sound,
            light,
          ]
        : h.inArena
          ? [{ act: 'continue', label: L.resume, primary: true }, { act: 'controls', label: L.controls }, sound, light, { act: 'leaveArena', label: L.leaveArena }]
          : [
              { act: 'continue', label: L.resume, primary: true },
              { act: 'save', label: L.save },
              { act: 'role', label: L.role },
              { act: 'controls', label: L.controls },
              sound,
              light,
              { act: 'exit', label: L.exit },
            ];
    }
    const nav = sheet
      ? `<p class="idc-text">Листок лежит поверх удостоверения. Esc или пункт на листке — вернуться.</p>`
      : `<nav class="idc-menu">${items.map((it, i) => `<button type="button" class="idc-item${it.primary ? ' primary' : ''}${it.on ? ' on' : ''}" data-act="${it.act}"${it.on !== undefined ? ` aria-pressed="${it.on}"` : ''}><span class="box"></span><span class="lbl">${esc(it.label)}</span>${it.value ? `<span class="val">${esc(it.value)}</span>` : ''}<kbd>${i + 1}</kbd></button>`).join('')}</nav>`;
    const note = this.note ? `<div class="idc-note ${this.noteOk ? 'ok' : 'err'}">${esc(this.note)}</div>` : '<div class="idc-note"></div>';
    right.innerHTML = `${head}<div class="idc-heading">${heading}</div>${text ? `<p class="idc-text">${esc(text)}</p>` : ''}${nav}${note}
      <footer class="idc-warn">${ID_CARD.warning}<br><span>${main ? ID_CARD.foot : ID_CARD.pauseFoot}</span></footer>`;
    this.setStamp(this.screen === 'confirmNew' ? 'void' : !info ? 'blank' : info.wanted ? 'wanted' : 'ok');
    const scope = sheet ? memo : right;
    const target = (focusAct && scope.querySelector<HTMLButtonElement>(`[data-act="${focusAct}"]`)) || scope.querySelector<HTMLButtonElement>('.idc-item');
    target?.focus({ preventScroll: true });
  }

  /** Печать: новая — с ударом (анимация), та же — без изменений. */
  private setStamp(kind: StampKind): void {
    if (this.stamp === kind) return;
    this.stamp = kind;
    this.card.querySelector('.idc-stamp')?.remove();
    const s = ID_CARD.stamps[kind];
    const el = document.createElement('div');
    el.className = `idc-stamp ${kind}`;
    el.style.setProperty('--stamp', s.color);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<b>${s.text}</b><small>${s.sub}</small>`;
    this.card.appendChild(el);
  }
}
