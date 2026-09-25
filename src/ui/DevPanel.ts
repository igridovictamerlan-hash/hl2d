import type { GameMap } from '../world/GameMap';
import type { Character } from '../entities/Character';
import { T } from '../world/tiles';
import { analyzeMap, hatchLinks } from '../world/mapStats';
import { downloadMap, pickMapFile } from '../world/mapIO';

/** Что панель карты умеет делать с игрой. */
export interface DevPanelHost {
  readonly map: GameMap;
  readonly player: Character;
  regenerate(seed?: number): void;
  loadMap(map: GameMap): void;
  readonly fps: number;
  readonly npcCount: number;
}

const PREVIEW_COLORS: Record<number, [number, number, number]> = {
  [T.WALL]: [22, 25, 28],
  [T.METAL]: [38, 62, 92],
  [T.FLOOR]: [112, 108, 98],
  [T.STREET]: [78, 84, 92],
  [T.PLAZA]: [168, 150, 110],
  [T.INTERIOR]: [110, 86, 64],
  [T.ARCH]: [150, 110, 70],
  [T.DOOR]: [190, 120, 60],
  [T.GATE]: [220, 180, 60],
  [T.COURTYARD]: [96, 118, 80],
  [T.BUNKER]: [130, 136, 140],
  [T.WASTE]: [120, 100, 60],
  [T.BARRIER]: [60, 60, 60],
  [T.SEWER]: [70, 78, 60],
  [T.SEWER_WATER]: [40, 90, 70],
  [T.SEWER_WALL]: [16, 14, 12],
};

/**
 * Панель карты (F2) — инструмент разработчика для этапа 1: перегенерация по seed,
 * сохранение/загрузка JSON, метрики генератора и схема карты целиком.
 */
export class DevPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly info: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly seedInput: HTMLInputElement;
  private readonly preview: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private previewMap: GameMap | null = null;

  constructor(parent: HTMLElement, private readonly host: DevPanelHost) {
    this.el = document.createElement('div');
    this.el.className = 'dev panel';
    this.el.innerHTML = `
      <div class="dev-head"><span>ГЕНЕРАТОР</span><span class="dev-key">F2</span></div>
      <div class="dev-body">
        <div class="dev-row">
          <input class="dev-seed" type="number" min="0" placeholder="seed" />
          <button data-act="seed" title="Сгенерировать по введённому seed">По seed</button>
          <button data-act="new" title="Новая случайная карта">Новая</button>
        </div>
        <div class="dev-row">
          <button data-act="save" title="Скачать карту в JSON">Сохранить JSON</button>
          <button data-act="load" title="Загрузить карту из JSON">Загрузить JSON</button>
        </div>
        <div class="dev-preview"><canvas class="dev-map"></canvas><canvas class="dev-map dev-map-over"></canvas></div>
        <div class="dev-pos"></div>
        <div class="dev-stats"></div>
        <div class="dev-info"></div>
      </div>`;
    parent.appendChild(this.el);
    this.body = this.el.querySelector('.dev-body')!;
    this.stats = this.el.querySelector('.dev-stats')!;
    this.info = this.el.querySelector('.dev-info')!;
    this.pos = this.el.querySelector('.dev-pos')!;
    this.seedInput = this.el.querySelector('.dev-seed')!;
    const canvases = this.el.querySelectorAll<HTMLCanvasElement>('.dev-map');
    this.preview = canvases[0];
    this.overlay = canvases[1];
    this.el.querySelector('.dev-head')!.addEventListener('click', () => this.toggle());
    this.el.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        this.act(b.dataset.act!);
        b.blur();
      }),
    );
    this.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.act('seed');
      e.stopPropagation();
    });
  }

  toggle(): void {
    this.body.classList.toggle('hidden');
  }

  message(text: string, error = false): void {
    this.info.textContent = text;
    this.info.classList.toggle('error', error);
  }

  private async act(what: string): Promise<void> {
    try {
      if (what === 'new') this.host.regenerate();
      else if (what === 'seed') {
        const seed = Number(this.seedInput.value);
        if (!Number.isFinite(seed) || this.seedInput.value === '') throw new Error('Введите число seed');
        this.host.regenerate(Math.floor(Math.abs(seed)));
      } else if (what === 'save') {
        downloadMap(this.host.map);
        this.message('Карта сохранена. Положите файл в public/maps/ и откройте ?map=имя');
      } else if (what === 'load') {
        this.host.loadMap(await pickMapFile());
      }
    } catch (e) {
      this.message((e as Error).message, true);
    }
  }

  /** Вызывается при смене карты. */
  setMap(map: GameMap, genMsg?: string): void {
    this.seedInput.value = String(map.seed);
    const s = map.stats;
    const check = analyzeMap(map.tiles, map.width, map.height, hatchLinks(map));
    const ts = map.tileSize;
    const rows: [string, string][] = [
      ['Карта', map.name],
      ['Размер', `${map.width}×${map.height} тайлов (${map.width * ts}×${map.height * ts} px)`],
      ['Застройка', `${(check.buildingRatio * 100).toFixed(1)}%`],
      ['Прямой участок', `≤ ${check.longestAlleyRun} тайлов (${check.longestAlleyRun * ts} px)`],
      ['Связность', check.components === 1 && check.unreachableTiles === 0 ? 'OK, 1 компонента' : `компонент: ${check.components}, недостижимых тайлов: ${check.unreachableTiles}`],
    ];
    if (s) {
      rows.push(
        ['Магистралей', String(s.avenues)],
        ['Тупиков', String(s.deadEnds)],
        ['Узких проходов', String(s.chokepoints)],
        ['Дворов-колодцев', String(s.courtyards)],
        ['Подъездов / арок', `${s.passages} / ${s.arches}`],
        ['Исправлено связности', `тоннелей ${s.tunnels}, засыпано ${s.fragmentsFilled}`],
        ['Генерация', `${s.genMs} мс, попытка ${s.attempt + 1}`],
      );
    }
    this.stats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join('');
    this.message(genMsg ?? '');
    this.drawPreview(map);
  }

  private drawPreview(map: GameMap): void {
    this.previewMap = map;
    for (const c of [this.preview, this.overlay]) {
      c.width = map.width;
      c.height = map.height;
    }
    const ctx = this.preview.getContext('2d')!;
    const img = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.tiles.length; i++) {
      const [r, g, b] = PREVIEW_COLORS[map.tiles[i]] ?? [255, 0, 255];
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Частые обновления: позиция игрока на схеме, FPS. */
  update(): void {
    const map = this.previewMap;
    if (!map || this.body.classList.contains('hidden')) return;
    const ctx = this.overlay.getContext('2d')!;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const p = this.host.player;
    const tx = p.x / map.tileSize;
    const ty = p.y / map.tileSize;
    ctx.strokeStyle = '#ffd36b';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx - 19, ty - 13, 38, 26);
    ctx.fillStyle = '#ffd36b';
    ctx.fillRect(tx - 1.5, ty - 1.5, 3, 3);
    const zone = map.zoneAtWorld(p.x, p.y);
    this.pos.textContent = `тайл ${Math.floor(tx)},${Math.floor(ty)} · ${zone?.name ?? '—'} · NPC ${this.host.npcCount} · ${this.host.fps.toFixed(0)} FPS`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
