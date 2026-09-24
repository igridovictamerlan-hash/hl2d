export type FactionId = 'citizen' | 'cp' | 'cwu' | 'rebel' | 'ota' | 'admin';

export interface FactionDef {
  id: FactionId;
  /** Название роли над кружком. */
  role: string;
  plural: string;
  color: string;
  outline: string;
  /** Цвет подписи роли. */
  label: string;
  /** Кто кому уступает дорогу в узком проходе: больше — главнее. */
  yieldPriority: number;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  citizen: {
    id: 'citizen', role: 'Гражданин', plural: 'Граждане',
    color: '#9a9ea4', outline: '#4a4d52', label: '#b9bdc2', yieldPriority: 1,
  },
  cwu: {
    id: 'cwu', role: 'ГСР', plural: 'Гражданский союз рабочих',
    color: '#e0bd3c', outline: '#7a6417', label: '#f0d26a', yieldPriority: 2,
  },
  rebel: {
    id: 'rebel', role: 'Повстанец', plural: 'Повстанцы',
    color: '#e27a2c', outline: '#7a3a0f', label: '#f29a55', yieldPriority: 1,
  },
  cp: {
    id: 'cp', role: 'ГО', plural: 'Гражданская оборона',
    color: '#3f7fd8', outline: '#1b3d6e', label: '#7fb0f2', yieldPriority: 4,
  },
  ota: {
    id: 'ota', role: 'OTA', plural: 'Солдаты Альянса',
    color: '#1f3269', outline: '#0b1430', label: '#6f86c9', yieldPriority: 5,
  },
  admin: {
    id: 'admin', role: 'Администратор', plural: 'Администрация',
    color: '#f2f2f2', outline: '#8a8a8a', label: '#ffffff', yieldPriority: 6,
  },
};
