import './ui/styles.css';
import { Game } from './core/Game';
import { AI } from './config/ai';
import { fetchMap } from './world/mapIO';

/**
 * Точка входа. Параметры адреса:
 *   ?seed=123   — сгенерировать карту по seed (записывается автоматически)
 *   ?map=city1  — загрузить public/maps/city1.json
 *   ?npcs=40    — число NPC-граждан
 *   ?debug=1    — сразу включить отладку ИИ
 * Без ?seed и ?map игра продолжается из сохранения в браузере (если есть).
 */
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const loading = document.getElementById('loading');

const npcs = params.has('npcs') ? Math.max(0, Math.min(200, Number(params.get('npcs')) || 0)) : AI.citizens;
const game = new Game(canvas, uiRoot, { npcs });
// Для отладки из консоли браузера.
(window as unknown as { game: Game }).game = game;

async function boot(): Promise<void> {
  const mapName = params.get('map');
  try {
    // Без явного seed/карты — продолжаем сохранённую игру, если она есть.
    // (seed в адресе, совпадающий с сохранением, — это та же игра после перезагрузки).
    const saved = mapName ? null : Game.readSave();
    const save = saved && (!params.has('seed') || Number(params.get('seed')) === saved.seed) ? saved : null;
    if (mapName) game.loadMap(await fetchMap(`${import.meta.env.BASE_URL}maps/${mapName}.json`));
    else if (save) game.resume(save);
    else game.regenerate(params.has('seed') ? Math.abs(Math.floor(Number(params.get('seed')))) || 0 : undefined);
  } catch (e) {
    console.error(e);
    game.regenerate();
    game.ui.dev.message(`Не удалось загрузить карту: ${(e as Error).message}`, true);
  }
  if (params.has('debug')) game.debug.enabled = true;
  // Главное меню поверх уже созданного города (он живёт за ним, пока меню открыто — на паузе).
  game.ui.menu.open('main');
  loading?.remove();
  canvas.focus();
  game.loop.start();
}

void boot();
