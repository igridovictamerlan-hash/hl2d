import type { EventBus } from '../core/EventBus';
import type { Character } from '../entities/Character';
import type { FactionId } from '../config/factions';
import { Hud } from './Hud';
import { ZoneBanner } from './ZoneBanner';
import { DevPanel, type DevPanelHost } from './DevPanel';
import { HelpBar } from './HelpBar';
import { EventLog } from './EventLog';
import { RoleMenu } from './RoleMenu';
import { CheckPanel, type CheckChoice } from './CheckPanel';
import { GAME } from '../config/game';

export interface UIHost extends DevPanelHost {
  chooseRole(faction: FactionId, rank: number): void;
  resolveCheck(target: Character, choice: CheckChoice): void;
}

/** Корень DOM-интерфейса поверх холста. */
export class UI {
  readonly hud: Hud;
  readonly banner: ZoneBanner;
  readonly dev: DevPanel;
  readonly log: EventLog;
  readonly roles: RoleMenu;
  readonly check: CheckPanel;
  private acc = 0;

  constructor(root: HTMLElement, bus: EventBus, host: UIHost) {
    this.hud = new Hud(root);
    this.banner = new ZoneBanner(root, bus);
    this.dev = new DevPanel(root, host);
    this.log = new EventLog(root, bus);
    this.check = new CheckPanel(root, bus, (t, c) => host.resolveCheck(t, c));
    new HelpBar(root);
    this.roles = new RoleMenu(root, (f, r) => host.chooseRole(f, r));
    this.dev.toggle(); // панель карты по умолчанию свёрнута — F2
    bus.on('map:loaded', ({ source }) => {
      this.dev.setMap(host.map, source === 'file' ? 'Карта загружена из файла' : undefined);
    });
  }

  update(player: Character, now: number, dt: number): void {
    this.acc += dt;
    if (this.acc < GAME.hudInterval) return;
    this.acc = 0;
    this.hud.update(player, now);
    this.dev.update();
  }
}
