import type { EventBus } from '../core/EventBus';
import type { Character } from '../entities/Character';
import type { FactionId, DivisionId } from '../config/factions';
import type { ItemId, WeaponId } from '../config/items';
import type { EconomySystem } from '../systems/EconomySystem';
import type { CombatSystem } from '../systems/CombatSystem';
import { Hud } from './Hud';
import { ZoneBanner } from './ZoneBanner';
import { DevPanel, type DevPanelHost } from './DevPanel';
import { HelpBar } from './HelpBar';
import { EventLog } from './EventLog';
import { RoleMenu } from './RoleMenu';
import { CheckPanel, type CheckChoice } from './CheckPanel';
import { InventoryPanel } from './InventoryPanel';
import { ShopPanel } from './ShopPanel';
import { AlertBar } from './AlertBar';
import { DeathScreen } from './DeathScreen';
import { GunfireAudio } from './GunfireAudio';
import { GAME } from '../config/game';
import { WEAPONS, type FireMode } from '../config/items';

const FIRE_MODE: Record<FireMode, string> = { semi: 'одиночный', auto: 'авто', pump: 'помпа', melee: 'удар' };

export interface UIHost extends DevPanelHost {
  readonly economy: EconomySystem;
  readonly combat: CombatSystem;
  chooseRole(faction: FactionId, rank: number, division: DivisionId | null): void;
  resolveCheck(target: Character, choice: CheckChoice): void;
  useItem(id: ItemId): void;
  equipItem(id: WeaponId | null): void;
  buyItem(id: ItemId): string | null;
  buyBlack(k: number): string | null;
  sellItem(id: ItemId): string | null;
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
  readonly inventory: InventoryPanel;
  readonly shop: ShopPanel;
  readonly alert: AlertBar;
  readonly death: DeathScreen;
  readonly audio = new GunfireAudio();
  private hudHeight = 0;
  private acc = 0;

  constructor(root: HTMLElement, bus: EventBus, private readonly host: UIHost) {
    this.hud = new Hud(root);
    this.banner = new ZoneBanner(root, bus);
    this.dev = new DevPanel(root, host);
    this.log = new EventLog(root, bus);
    this.check = new CheckPanel(root, bus, (t, c) => host.resolveCheck(t, c));
    this.inventory = new InventoryPanel(root, host);
    this.shop = new ShopPanel(root, { buy: (id) => host.buyItem(id), buyBlack: (k) => host.buyBlack(k), sell: (id) => host.sellItem(id) });
    this.alert = new AlertBar(root, bus);
    this.death = new DeathScreen(root);
    new HelpBar(root);
    this.roles = new RoleMenu(root, (f, r, d) => host.chooseRole(f, r, d));
    this.dev.toggle(); // панель карты по умолчанию свёрнута — F2
    bus.on('announce', ({ text }) => this.banner.show(text));
    bus.on('map:loaded', ({ source }) => {
      this.alert.reset();
      this.shop.close();
      this.dev.setMap(host.map, source === 'file' ? 'Карта загружена из файла' : undefined);
    });
  }

  update(player: Character, now: number, dt: number): void {
    const map = this.host.map;
    const level = map.levelAt(player.x, player.y);
    this.audio.update(this.host.combat.shots, player, this.host.combat.now, (x, y) => map.levelAt(x, y) === level);
    this.acc += dt;
    if (this.acc < GAME.hudInterval) return;
    this.acc = 0;
    const { economy, combat } = this.host;
    let weapon = '';
    if (player.weapon) {
      const w = WEAPONS[player.weapon];
      if (w.mode === 'melee') weapon = `${w.name} · удар ЛКМ, оглушает`;
      else {
        const ammo = combat.reloading(player) ? 'перезарядка…' : `${player.mag} / ${combat.reserveAmmo(player)}`;
        const aim = player.aiming ? ` · прицел ${Math.round(player.aim * 100)}%` : '';
        weapon = `${w.name} [${FIRE_MODE[w.mode]}]: ${ammo} · ±${combat.spreadOf(player, w).toFixed(1)}°${aim}`;
      }
    }
    let ration: string;
    if (economy.open) {
      const i = economy.queue.indexOf(player);
      const where = economy.hasBeenServed(player) ? 'вы получили' : i >= 0 ? `вы ${i + 1}-й в очереди` : `в очереди ${economy.queue.length}`;
      ration = `Раздача рационов открыта (${mmss(economy.timer)}) · ${where}`;
    } else ration = `Раздача рационов через ${mmss(economy.timer)}`;
    this.hud.update(player, now, weapon, ration);
    // Журнал событий — над HUD, какой бы высоты тот ни был.
    const h = this.hud.el.offsetHeight;
    if (h !== this.hudHeight) {
      this.hudHeight = h;
      this.log.el.style.bottom = `${h + 28}px`;
    }
    this.inventory.update(player);
    this.shop.update(player, this.shop.kind === 'black' ? this.host.blackMarketCounter : economy.shopCounter);
    this.death.update(player, combat.now);
    this.dev.update();
  }
}
