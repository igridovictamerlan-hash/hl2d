import type { Character } from '../entities/Character';
import type { PawnLook } from '../entities/PawnRenderer';
import { drawPawn } from '../entities/PawnRenderer';
import { FACTIONS, CP_DIVISIONS, rankOf } from '../config/factions';
import { PROFESSIONS, DEFAULT_PROFESSION } from '../config/professions';
import { WEAPONS, type WeaponId, type GrenadeId } from '../config/items';
import { hasLoyalty, loyaltyTier } from '../systems/Loyalty';
import { SUPPRESS } from '../config/tactics';
import { HUD } from '../config/hud';
import { drawGunIcon, iconUrl } from './icons';

/** Что показать о руках игрока (собирает UI). */
export interface HudInfo {
  look: PawnLook;
  weapon: WeaponId | null;
  mag: number;
  reserve: number;
  reloading: boolean;
  grenade: GrenadeId | null;
  grenades: number;
  /** Раздача рационов, склад — мелкой строкой. */
  ration: string;
  /** До готовности клича главы восстания, с (-1 — не глава). */
  rally: number;
  /** Ориентировка по игроку (Suspects.playerStatus): значок «ищут», текст — в подсказке; null — не ищут. */
  suspect: string | null;
  /** Кровь на одежде (bloodyUntil по часам закона). */
  bloody: boolean;
}

/** Значок состояния (S1); hint — подсказка при наведении (полный текст). */
interface Status {
  icon: string;
  label: string;
  key?: string;
  tone: 'red' | 'amber' | 'blue' | 'dark';
  blink?: boolean;
  hint?: string;
}

/**
 * HUD (A3): круглый портрет своей пешки, внешнее кольцо — здоровье, внутреннее — сытость; цифры —
 * пока значение меняется или низкое. Над портретом — значки состояний (кровь, нога, прижат…), справа —
 * имя, роль, токены, часы и оружие в руках (иконка, магазин, запас, граната). DOM обновляется, только
 * если что-то изменилось.
 */
export class Hud {
  readonly el: HTMLElement;
  private readonly ring: HTMLCanvasElement;
  private readonly gun: HTMLCanvasElement;
  private readonly statusEl: HTMLElement;
  private readonly name: HTMLElement;
  private readonly role: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly gunBox: HTMLElement;
  private readonly mag: HTMLElement;
  private readonly res: HTMLElement;
  private readonly nade: HTMLElement;
  private readonly lawEl: HTMLElement;
  private readonly rationEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private lastRing = '';
  private lastGun = '';
  private lastStatus = '';
  private lastText = '';
  private lastClock = '';
  /** Последние значения и когда менялись (цифры у кольца видны showFor с). */
  private hp = -1;
  private food = -1;
  private hpAt = -99;
  private foodAt = -99;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-ration" data-ration></div>
      <div class="hud-law" data-law></div>
      <div class="hud-status" data-status></div>
      <div class="hud-main">
        <canvas class="hud-ring" data-ring></canvas>
        <div class="hud-side">
          <div class="hud-name" data-name></div>
          <div class="hud-role" data-role></div>
          <div class="hud-meta"><span data-meta></span><span class="hud-clock" data-clock></span></div>
          <div class="hud-gun" data-gunbox><canvas data-gun></canvas><div class="hud-ammo"><b data-mag></b><span data-res></span></div><div class="hud-nade" data-nade></div></div>
        </div>
      </div>
`;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(k: string) => this.el.querySelector<T>(`[data-${k}]`)!;
    this.ring = q<HTMLCanvasElement>('ring');
    this.gun = q<HTMLCanvasElement>('gun');
    this.statusEl = q('status');
    this.name = q('name');
    this.role = q('role');
    this.meta = q('meta');
    this.gunBox = q('gunbox');
    this.mag = q('mag');
    this.res = q('res');
    this.nade = q('nade');
    this.lawEl = q('law');
    this.rationEl = q('ration');
    this.clockEl = q('clock');
    const R = HUD.ring;
    this.ring.style.width = this.ring.style.height = `${R.size}px`;
    this.gun.style.width = `${HUD.weapon.len}px`;
    this.gun.style.height = `${HUD.weapon.maxH}px`;
  }

  /** Часы и время суток. */
  setClock(text: string): void {
    if (text === this.lastClock) return;
    this.lastClock = text;
    this.clockEl.textContent = text;
  }

  update(p: Character, now: number, info: HudInfo): void {
    this.updateRing(p, now, info.look);
    this.updateStatus(p, now, info);
    this.updateGun(info);
    this.updateText(p, now, info);
  }

  private updateRing(p: Character, now: number, look: PawnLook): void {
    const R = HUD.ring;
    const hp = p.alive ? Math.max(0, Math.ceil(p.health)) : 0;
    const food = Math.max(0, Math.ceil(p.hunger));
    if (hp !== this.hp) {
      if (this.hp >= 0) this.hpAt = now;
      this.hp = hp;
    }
    if (food !== this.food) {
      if (this.food >= 0) this.foodAt = now;
      this.food = food;
    }
    const hpF = p.maxHealth > 0 ? hp / p.maxHealth : 0;
    const foodF = food / 100;
    const hpLow = hpF <= R.low;
    const foodLow = foodF <= R.low;
    const showHp = hpLow || now - this.hpAt < R.showFor;
    const showFood = foodLow || now - this.foodAt < R.showFor;
    const key = `${hp}|${p.maxHealth}|${food}|${showHp}|${showFood}|${look.faction}|${look.rank}|${look.color}|${look.seed}|${look.profession}|${look.band}`;
    this.ring.classList.toggle('pulse', hpLow && p.alive);
    if (key === this.lastRing) return;
    this.lastRing = key;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(R.size * dpr);
    if (this.ring.width !== px) this.ring.width = this.ring.height = px;
    const ctx = this.ring.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, R.size, R.size);
    const c = R.size / 2;
    const C = R.colors;
    ctx.fillStyle = C.back;
    ctx.beginPath();
    ctx.arc(c, c, R.outer + R.outerWidth / 2 + 2, 0, Math.PI * 2);
    ctx.fill();
    const arc = (r: number, w: number, v: number, col: string) => {
      ctx.lineCap = 'round';
      ctx.lineWidth = w;
      ctx.strokeStyle = C.track;
      ctx.beginPath();
      ctx.arc(c, c, r, R.start, R.start + R.sweep);
      ctx.stroke();
      if (v <= 0) return;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(c, c, r, R.start, R.start + R.sweep * Math.min(1, v));
      ctx.stroke();
    };
    arc(R.outer, R.outerWidth, hpF, hpLow ? C.hpLow : C.hp);
    arc(R.inner, R.innerWidth, foodF, foodLow ? C.foodLow : C.food);
    // Портрет: пешка лицом к нам, видна голова и плечи.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, R.portrait, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = C.portrait;
    ctx.fillRect(0, 0, R.size, R.size);
    drawPawn(ctx, look, c, c + R.pawnY - 12, R.pawnScale, 'S');
    ctx.restore();
    // Цифры в разрыве колец снизу.
    ctx.font = '700 11px "Segoe UI", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.numOutline;
    const num = (s: string, x: number, col: string, align: CanvasTextAlign) => {
      ctx.textAlign = align;
      ctx.strokeText(s, x, R.size - 9);
      ctx.fillStyle = col;
      ctx.fillText(s, x, R.size - 9);
    };
    if (showHp) num(String(hp), c - 5, hpLow ? C.hpLow : C.hpText, 'right');
    if (showFood) num(String(food), c + 5, foodLow ? C.foodLow : C.foodText, 'left');
  }

  private updateStatus(p: Character, now: number, info: HudInfo): void {
    const list = statusOf(p, now, info);
    const key = list.map((s) => `${s.icon}|${s.label}|${s.blink ? '!' : ''}|${s.hint ?? ''}`).join(',');
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.statusEl.replaceChildren(
      ...list.map((s) => {
        const d = document.createElement('div');
        d.className = `hud-st st-${s.tone}${s.blink ? ' blink' : ''}`;
        if (s.hint) d.title = s.hint;
        const img = document.createElement('img');
        img.src = iconUrl(s.icon, HUD.status.icon * 2);
        img.width = img.height = HUD.status.icon;
        d.appendChild(img);
        if (s.key) {
          const k = document.createElement('b');
          k.textContent = s.key;
          d.appendChild(k);
        }
        const l = document.createElement('span');
        l.textContent = s.label;
        d.appendChild(l);
        return d;
      }),
    );
  }

  private updateGun(info: HudInfo): void {
    const W = HUD.weapon;
    const w = info.weapon ? WEAPONS[info.weapon] : null;
    const key = `${info.weapon}|${info.mag}|${info.reserve}|${info.reloading}|${info.grenade}|${info.grenades}`;
    if (key === this.lastGun) return;
    const weaponChanged = key.split('|')[0] !== this.lastGun.split('|')[0];
    this.lastGun = key;
    this.gunBox.hidden = !w && !info.grenade;
    if (weaponChanged) {
      const dpr = window.devicePixelRatio || 1;
      this.gun.width = Math.round(W.len * dpr);
      this.gun.height = Math.round(W.maxH * dpr);
      const ctx = this.gun.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W.len, W.maxH);
      if (info.weapon) drawGunIcon(ctx, info.weapon, W.len / 2, W.maxH / 2, W.len - 4, { maxH: W.maxH - 4 });
    }
    this.gun.hidden = !w;
    if (!w) {
      this.mag.textContent = '';
      this.res.textContent = '';
    } else if (w.mode === 'melee') {
      this.mag.textContent = '';
      this.res.textContent = w.class === 'blade' ? 'в спину — сильнее' : 'оглушает';
    } else if (info.reloading) {
      this.mag.textContent = '…';
      this.res.textContent = 'перезарядка';
    } else {
      this.mag.textContent = String(info.mag);
      this.res.textContent = `/ ${info.reserve}`;
    }
    this.mag.classList.toggle('empty', !!w?.ammo && info.mag === 0 && !info.reloading);
    if (info.grenade) {
      this.nade.replaceChildren();
      const img = document.createElement('img');
      img.src = iconUrl(info.grenade, W.grenade * 2);
      img.width = img.height = W.grenade;
      const n = document.createElement('span');
      n.textContent = `×${info.grenades}`;
      this.nade.append(img, n);
      this.nade.hidden = false;
    } else this.nade.hidden = true;
  }

  private updateText(p: Character, now: number, info: HudInfo): void {
    const law = lawStatus(p, now);
    const busy = busyStatus(p, now);
    const key = `${p.name}|${p.faction}|${p.rank}|${p.division}|${p.cid}|${p.profession}|${p.disguised}|${p.money}|${p.loyalty}|${law}|${busy}|${info.ration}|${info.rally > 0 ? Math.ceil(info.rally) : info.rally}`;
    if (key === this.lastText) return;
    this.lastText = key;
    this.name.textContent = p.name;
    const f = FACTIONS[p.faction];
    const r = rankOf(p.faction, p.rank);
    const div = p.division && p.faction === 'cp' ? ` · ${CP_DIVISIONS[p.division].short}` : '';
    const prof = p.profession ? PROFESSIONS[p.profession] : null;
    const pname = prof && prof.id !== DEFAULT_PROFESSION[p.faction] && prof.name !== r?.name ? ` · ${prof.name}` : '';
    const cd = p.profession === 'rebel_leader' && p.faction === 'rebel' ? info.rally : -1;
    const rally = cd < 0 ? '' : cd > 0 ? ` · клич через ${Math.ceil(cd)} с` : ' · клич готов (G)';
    this.role.textContent = r ? `${r.name}${div}${pname}${rally}` : `${prof && pname ? prof.name : f.role} · CID #${p.cid}`;
    this.role.style.color = r ? r.color : f.label;
    let meta = `◉ ${p.money}`;
    if (hasLoyalty(p)) meta += ` · ${loyaltyTier(p).name} (${p.loyalty})`;
    this.meta.textContent = `${meta} · `;
    const chip = [law, busy].filter(Boolean).join(' · ');
    this.lawEl.textContent = chip;
    this.lawEl.hidden = chip === '';
    this.rationEl.textContent = info.ration;
    this.rationEl.hidden = info.ration === '';
  }
}

/** Значки состояний игрока (S1). */
function statusOf(p: Character, now: number, info: HudInfo): Status[] {
  if (!p.alive) return [];
  const out: Status[] = [];
  if (p.bandageUntil > now) out.push({ icon: 'bandage', label: 'перевязка', tone: 'dark' });
  else if (p.bleed > 0) out.push({ icon: 'drop', label: `кровь −${p.bleed.toFixed(1)}`, key: 'B', tone: 'red', blink: true });
  if (p.limpUntil > now) out.push({ icon: 'leg', label: 'нога', tone: 'dark' });
  if (p.armUntil > now) out.push({ icon: 'arm', label: 'рука', tone: 'dark' });
  if (p.suppress >= SUPPRESS.pinned) out.push({ icon: 'suppress', label: 'прижат', tone: 'amber' });
  if (p.crouch) out.push({ icon: 'crouch', label: 'присел', key: 'C', tone: 'dark' });
  if (p.hunger <= HUD.ring.low * 100) out.push({ icon: 'hunger', label: p.hunger <= 0 ? 'голод!' : 'голоден', tone: 'amber', blink: p.hunger <= 0 });
  // Розыск и «ищут» не дублируют друг друга: в розыске одна плашка, приметы — в подсказке.
  if (p.law.wanted) out.push({ icon: 'wanted', label: 'розыск', tone: 'red', hint: info.suspect ?? undefined });
  else if (info.suspect) out.push({ icon: 'search', label: 'ищут', tone: 'amber', hint: info.suspect });
  if (info.bloody) out.push({ icon: 'bloody_shirt', label: 'в крови', tone: 'red', hint: 'Кровь на одежде: по ней узнают в ориентировке. Новая одежда на корпус (плащ, бронежилет) её снимает.' });
  if (p.disguised || p.cover) out.push({ icon: 'mask', label: 'личина', tone: 'blue' });
  return out;
}

/** Чем игрок занят (текстом — тащит раненого, поднимает, тяжело ранен). */
function busyStatus(p: Character, now: number): string {
  if (!p.alive) return '';
  if (p.downed) return `тяжело ранен · ${Math.max(0, Math.ceil(p.downedUntil - now))} с`;
  if (p.dragging) return `тащите ${p.dragging.name} · X — отпустить`;
  if (p.reviveUntil > now) return p.reviveArrest ? 'задержание…' : 'поднимаете раненого…';
  return '';
}

/** Строка «что со мной сейчас» для игрока. */
function lawStatus(p: Character, now: number): string {
  const l = p.law;
  switch (l.phase) {
    case 'ordered': return `${l.handler?.name ?? 'ВС'}: стоять на месте!`;
    case 'checking': return 'Проверка документов…';
    case 'fleeing': return 'Вы в бегах — ВС преследует!';
    // Повстанцев ведут в тюрьму Протектората (свои могут отбить раньше срока).
    case 'cuffed': return p.faction === 'rebel' ? 'Задержаны. Конвой в тюрьму' : 'Задержаны. Конвой в КПЗ';
    case 'entering': return 'Вас заводят в камеру';
    case 'jailed': return `${p.faction === 'rebel' ? 'Тюрьма (ждите своих)' : 'КПЗ'}: ещё ${Math.max(0, Math.ceil(l.jailUntil - now))} с`;
    case 'releasing': return 'Свободны';
  }
  return '';
}
