export type PointerMessage = { type: 'pointer'; active: boolean; x: number; y: number };
export type PointerUpdate = PointerMessage & { deviceId: string };

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
const roundUnit = (value: number) => Math.round(value * 1000) / 1000;

export const isPointerUpdate = (value: unknown): value is PointerUpdate => {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  return (
    update.type === 'pointer' &&
    typeof update.deviceId === 'string' &&
    typeof update.active === 'boolean' &&
    typeof update.x === 'number' &&
    typeof update.y === 'number' &&
    Number.isFinite(update.x) &&
    Number.isFinite(update.y) &&
    update.x >= 0 &&
    update.x <= 1 &&
    update.y >= 0 &&
    update.y <= 1
  );
};

export const createPointerMessage = (x: number, y: number): PointerMessage => ({
  type: 'pointer',
  active: true,
  x: roundUnit(clampUnit(x)),
  y: roundUnit(clampUnit(y)),
});

export const createPointerReleaseMessage = (): PointerMessage => ({ type: 'pointer', active: false, x: 0, y: 0 });

type PointerArea = { left: number; top: number; width: number; height: number };

export const toPhonePoint = (area: PointerArea, clientX: number, clientY: number) => {
  if (!(area.width > 0) || !(area.height > 0)) return null;
  return {
    x: roundUnit(clampUnit((clientX - area.left) / area.width)),
    y: roundUnit(clampUnit((clientY - area.top) / area.height)),
  };
};
