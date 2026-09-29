import type { ArsenalSystem } from '../systems/Arsenal';
import type { ProfessionId } from '../config/professions';
import type { EventBus } from '../core/EventBus';
import type { Character } from '../entities/Character';
import type { FactionId, DivisionId } from '../config/factions';
import type { ItemId, WeaponId, GrenadeId } from '../config/items';
import type { EconomySystem } from '../systems/EconomySystem';
import type { CombatSystem } from '../systems/CombatSystem';
import { Hud } from './Hud';
import type { PawnLook } from '../entities/PawnRenderer';
import { ZoneBanner } from './ZoneBanner';
import { DevPanel, type DevPanelHost } from './DevPanel';
import { HelpBar } from './HelpBar';
import { EventLog } from './EventLog';
import { RoleMenu } from './RoleMenu';
import { CheckPanel, type CheckChoice } from './CheckPanel';
import { CodePanel } from './CodePanel';
import { InventoryPanel } from './InventoryPanel';
import { ShopPanel } from './ShopPanel';
import { AlertBar } from './AlertBar';
import { DeathScreen } from './DeathScreen';
import { GunfireAudio } from './GunfireAudio';
import { CaptureBar } from './CaptureBar';
import { ChatBox } from './ChatBox';
import { MapView, type MapViewHost } from './MapView';
import { GameMenu, type GameMenuHost } from './GameMenu';
import type { WarSystem, AlertCode } from '../systems/WarSystem';
import { GAME } from '../config/game';
import { GRENADE_KINDS } from '../systems/CombatSystem';
import type { SquadArena } from '../systems/SquadArena';
import { ArenaBar } from './ArenaBar';


export interface UIHost extends DevPanelHost, MapViewHost, GameMenuHost {
  /** Часы и время суток («19:40 · вечер»). */
  readonly clock: string;
  /** Внешность пешки (портрет HUD, инвентарь). */
  pawnLook(c: Character): PawnLook;
  /** Где горит огонь (бочки, костры — треск рядом) и насколько темно (0..1) — для звукового фона. */
  readonly fireSpots: readonly { x: number; y: number }[];
  readonly darkness: number;
  readonly economy: EconomySystem;
  readonly combat: CombatSystem;
  readonly war: WarSystem;
  /** Склад Альянса (запасы, борт) — для строки HUD. */
  readonly arsenal: ArsenalSystem | null;
  /** Режим «отряд на отряд» (null — обычная игра). */
  readonly arena: SquadArena | null;
  chooseRole(faction: FactionId, rank: number, division: DivisionId | null, profession: ProfessionId | null): void;
  resolveCheck(target: Character, choice: CheckChoice): void;
  /** Терминал кодов тревоги: игрок выбрал код. */
  setAlertCode(code: AlertCode): void;
  useItem(id: ItemId): void;
  equipItem(id: WeaponId | null): void;
  chooseGrenade(id: GrenadeId): void;
  buyItem(id: ItemId): string | null;
  buyBlack(k: number): string | null;
  blackInStock(k: number): boolean;
  shopPrice(id: ItemId): number | undefined;
  sellItem(id: ItemId): string | null;
  /** Сообщение или команда чата от игрока. */
  say(text: string): void;

  /** Вернуть фокус игре (после чата). */
  focusGame(): void;
  /** Прилавок чёрного рынка (px) — магазин закрывается, если отойти. */
  readonly blackMarketCounter: { x: number; y: number } | null;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Корень DOM-интерфейса поверх холста. */
export class UI {
  readonly hud: Hud;
  readonly banner: ZoneBanner;
  readonly dev: DevPanel;
  readonly log: EventLog;
  readonly roles: RoleMenu;
  readonly check: CheckPanel;
  readonly code: CodePanel;
  readonly inventory: InventoryPanel;
  readonly shop: ShopPanel;
  readonly alert: AlertBar;
  readonly death: DeathScreen;
  readonly audio = new GunfireAudio();
  readonly capture: CaptureBar;
  readonly arenaBar: ArenaBar;
  readonly chat: ChatBox;
  readonly mapView: MapView;
  readonly menu: GameMenu;
  private readonly pauseEl: HTMLElement;
  private hudHeight = 0;
  private acc = 0;

  constructor(root: HTMLElement, bus: EventBus, private readonly host: UIHost) {
    this.hud = new Hud(root);
    this.banner = new ZoneBanner(root, bus);
    this.banner.turf = (id) => host.gangs?.turfOf(id)?.def.name ?? null;
    this.dev = new DevPanel(root, host);
    this.log = new EventLog(root, bus);
    this.check = new CheckPanel(root, bus, (t, c) => host.resolveCheck(t, c));
    this.code = new CodePanel(root, () => host.war, (c) => host.setAlertCode(c));
    this.inventory = new InventoryPanel(root, host);
    this.capture = new CaptureBar(root);
    this.arenaBar = new ArenaBar(root);
    this.mapView = new MapView(root);
    this.menu = new GameMenu(root, host);
    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'pause-overlay';
    this.pauseEl.hidden = true;
    this.pauseEl.innerHTML = '<div>ПАУЗА</div><small>P — продолжить · игра сохраняется автоматически</small>';
    root.appendChild(this.pauseEl);
    this.chat = new ChatBox(root, (t) => host.say(t), () => host.focusGame());
    this.shop = new ShopPanel(root, { price: (id) => host.shopPrice(id), buy: (id) => host.buyItem(id), buyBlack: (k) => host.buyBlack(k), blackInStock: (k) => host.blackInStock(k), sell: (id) => host.sellItem(id) });
    this.alert = new AlertBar(root, bus);
    this.death = new DeathScreen(root);
    new HelpBar(root);
    this.roles = new RoleMenu(root, (f, r, d, p) => host.chooseRole(f, r, d, p), () => host.newGame());
    this.dev.toggle(); // панель карты по умолчанию свёрнута — F2
    bus.on('announce', ({ text }) => this.banner.show(text));
    bus.on('map:loaded', ({ source }) => {
      this.alert.reset();
      this.shop.close();
      this.capture.reset();
      this.dev.setMap(host.map, source === 'file' ? 'Карта загружена из файла' : undefined);
    });
  }

  setPaused(on: boolean): void {
    this.pauseEl.hidden = !on;
  }

  update(player: Character, now: number, dt: number): void {
    const map = this.host.map;
    const level = map.levelAt(player.x, player.y);
    this.audio.update(this.host.combat.shots, player, this.host.combat.now, (x, y) => map.levelAt(x, y) === level, this.host.combat.fx);
    this.audio.ambient(player, this.host.fireSpots, this.host.darkness, level === 'sewer', dt, this.host.arsenal?.shipView() ?? null);
    this.acc += dt;
    if (this.acc < GAME.hudInterval) return;
    this.acc = 0;
    const { economy, combat } = this.host;
    // Гранаты: выбранная (T) и сколько её.
    const nades = GRENADE_KINDS.filter((g) => player.inventory.has(g));
    const grenade = nades.length ? (nades.includes(player.grenadeKind) ? player.grenadeKind : nades[0]) : null;
    let ration: string;
    if (this.host.arena) ration = '';
    else if (economy.open) {
      const i = economy.queue.indexOf(player);
      const where = economy.hasBeenServed(player) ? 'вы получили' : i >= 0 ? `вы ${i + 1}-й в очереди` : `в очереди ${economy.queue.length}`;
      ration = `Раздача рационов открыта (${mmss(economy.timer)}) · ${where}`;
    } else ration = `Раздача рационов через ${mmss(economy.timer)}`;
    // Склад Альянса: ГО и рабочим склада — запасы и когда борт.
    const ars = this.host.arsenal;
    if (!this.host.arena && ars?.present && (player.faction === 'cp' || player.profession === 'loader' || player.profession === 'armorer')) {
      const st = ars.stock;
      const ship = ars.ship.phase !== 'none' ? 'борт над крыльцом' : ars.beaconBroken ? 'маяк сломан — борт не сядет' : this.host.war.code === 'red' ? 'рейсы отменены' : `борт через ${mmss(ars.flightIn)}`;
      ration += `\nСклад: патроны ${st.ammo} ящ. · гранаты ${st.grenades} ящ. · стволы ${st.weapons} (+${st.parts} в консервации) · ${ship}${ars.closed ? ' · выдача закрыта' : ''}`;
      if (player.faction === 'cp' && ars.points.length) {
        ration += `\nПункты боепитания: ${ars.points.map((p) => `${p.name.split(' ').pop()} ${p.kits}${p.convoy ? ' (конвой)' : ''}`).join(' · ')}`;
      }
    }
    this.hud.update(player, now, {
      look: this.host.pawnLook(player),
      weapon: player.weapon,
      mag: player.mag,
      reserve: combat.reserveAmmo(player),
      reloading: combat.reloading(player),
      grenade,
      grenades: grenade ? player.inventory.count(grenade) : 0,
      ration,
      rally: this.host.war.command.rallyCooldown,
    });
    this.hud.setClock(this.host.clock);
    // Журнал событий — над HUD, какой бы высоты тот ни был.
    const h = this.hud.el.offsetHeight;
    if (h !== this.hudHeight) {
      this.hudHeight = h;
      this.log.el.style.bottom = `${h + 28}px`;
    }
    this.inventory.update(player, combat, this.host.pawnLook(player));
    if (this.host.arena) this.arenaBar.update(this.host.arena);
    else {
      this.arenaBar.update(null);
      this.capture.update(this.host.war);
    }
    this.mapView.update(this.host, GAME.hudInterval);
    this.shop.update(player, this.shop.kind === 'black' ? this.host.blackMarketCounter : this.shop.kind === 'street' ? this.shop.street?.front ?? null : economy.shopCounter);
    const arena = this.host.arena;
    this.death.update(player, combat.now, this.host.war.code === 'red', arena ? `Отряд на отряд: вернётесь в бой в следующем раунде (живы: ${arena.alive(arena.playerSide)} из вашего отряда)` : null);
    this.dev.update();
  }
}
