import type { EventBus } from '../core/EventBus';
import type { Character } from '../entities/Character';
import { Hud } from './Hud';
import { ZoneBanner } from './ZoneBanner';
import { DevPanel, type DevPanelHost } from './DevPanel';
import { HelpBar } from './HelpBar';
import { GAME } from '../config/game';

/** Корень DOM-интерфейса поверх холста. */
export class UI {
  readonly hud: Hud;
  readonly banner: ZoneBanner;
  readonly dev: DevPanel;
  private acc = 0;

  constructor(root: HTMLElement, bus: EventBus, host: DevPanelHost) {
    this.hud = new Hud(root);
    this.banner = new ZoneBanner(root, bus);
    this.dev = new DevPanel(root, host);
    new HelpBar(root);
    bus.on('map:loaded', ({ source }) => {
      this.dev.setMap(host.map, source === 'file' ? 'Карта загружена из файла' : undefined);
    });
  }

  update(player: Character, dt: number): void {
    this.acc += dt;
    if (this.acc < GAME.hudInterval) return;
    this.acc = 0;
    this.hud.update(player);
    this.dev.update();
  }
}
