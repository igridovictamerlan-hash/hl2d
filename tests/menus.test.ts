import { describe, expect, it } from 'vitest';
import { ROLE_MENU, ID_CARD } from '../src/config/menus';
import { FACTIONS, cpUnit, rebelUnitOf, type FactionId } from '../src/config/factions';
import { professionsOf, PROFESSIONS } from '../src/config/professions';
import { KITS, WEAPONS } from '../src/config/items';
import { previewLook, previewWeapon } from '../src/ui/menuArt';

describe('меню: карточки сторон и удостоверение', () => {
  const selectable = (Object.keys(FACTIONS) as FactionId[]).filter((id) => FACTIONS[id].selectable);

  it('у каждой доступной стороны есть карточка, надпись «играть за» и место в порядке', () => {
    for (const id of selectable) {
      const card = ROLE_MENU.cards[id];
      expect(card, id).toBeTruthy();
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(3);
      expect(card.activities.length).toBeGreaterThan(0);
      expect(ROLE_MENU.playAs[id], id).toBeTruthy();
      expect(ROLE_MENU.order).toContain(id);
    }
    expect(selectable).toContain(ROLE_MENU.initial);
  });

  it('образец на карточке держит лучший ствол своего набора', () => {
    // ВС — по юниту: у сержанта (PCU.01) — MP7, у рекрута — пистолет.
    for (let r = 0; r < (FACTIONS.cp.ranks?.length ?? 0); r++) {
      const w = previewWeapon('cp', r, null);
      const kit = KITS[cpUnit(r).kit].map(([id]) => id);
      if (w) expect(kit).toContain(w);
    }
    expect(WEAPONS[previewWeapon('cp', 3, null)!].class).toBe('smg');
    // У каждой профессии — ствол из её набора (или никакого).
    for (const id of selectable) {
      for (const p of professionsOf(id, true)) {
        const w = previewWeapon(id, 0, p.id);
        const kit = KITS[PROFESSIONS[p.id].kit ?? id] ?? [];
        if (w) expect(kit.map(([k]) => k), `${id}/${p.id}`).toContain(w);
      }
    }
    expect(previewWeapon('citizen', 0, 'citizen')).toBeNull();
  });

  it('юнит сопротивления на образце — по профессии', () => {
    const look = previewLook('rebel', 0, 'rebel_leader', 5);
    expect(look.rank).toBe(rebelUnitOf('rebel_leader')!.rank);
    expect(look.faction).toBe('rebel');
  });

  it('у удостоверения есть все печати и подписи пунктов', () => {
    for (const k of ['ok', 'blank', 'wanted', 'void'] as const) expect(ID_CARD.stamps[k].text).toBeTruthy();
    for (const v of Object.values(ID_CARD.labels)) expect(v.length).toBeGreaterThan(0);
  });
});
