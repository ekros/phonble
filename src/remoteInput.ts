export type RemoteInputKind = 'click' | 'scroll';

export type RemoteInputMessage =
  | { type: 'input'; kind: 'click'; x: number; y: number }
  | { type: 'input'; kind: 'scroll'; x: number; y: number; dy: number };

export type RemoteInputUpdate = RemoteInputMessage & { deviceId: string };

export const MAX_SCROLL_STEP = 600;

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
const roundUnit = (value: number) => Math.round(value * 1000) / 1000;
const clampScrollStep = (value: number) => Math.min(MAX_SCROLL_STEP, Math.max(-MAX_SCROLL_STEP, value));
const scrollOverflowPattern = /(auto|scroll|overlay)/;

const isUnitCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export const isRemoteInputUpdate = (value: unknown): value is RemoteInputUpdate => {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  if (update.type !== 'input' || typeof update.deviceId !== 'string') return false;
  if (!isUnitCoordinate(update.x) || !isUnitCoordinate(update.y)) return false;
  if (update.kind === 'click') return true;
  if (update.kind !== 'scroll') return false;
  return typeof update.dy === 'number' && Number.isFinite(update.dy) && Math.abs(update.dy) <= MAX_SCROLL_STEP;
};

export const createClickInput = (x: number, y: number): RemoteInputMessage => ({
  type: 'input',
  kind: 'click',
  x: roundUnit(clampUnit(x)),
  y: roundUnit(clampUnit(y)),
});

export const createScrollInput = (x: number, y: number, dy: number): RemoteInputMessage => ({
  type: 'input',
  kind: 'scroll',
  x: roundUnit(clampUnit(x)),
  y: roundUnit(clampUnit(y)),
  dy: Math.round(clampScrollStep(Number.isFinite(dy) ? dy : 0)),
});

export type RemoteInputEnvironment = {
  document: Document;
  view: { innerWidth: number; innerHeight: number };
};

let applyingRemoteInput = false;

export const isApplyingRemoteInput = () => applyingRemoteInput;

export const resolveRemoteTarget = (x: number, y: number, environment: RemoteInputEnvironment) => {
  const clientX = Math.round(clampUnit(x) * environment.view.innerWidth);
  const clientY = Math.round(clampUnit(y) * environment.view.innerHeight);
  return environment.document.elementFromPoint?.(clientX, clientY) ?? null;
};

const isScrollableContainer = (element: Element) => {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  const scrollsVertically = scrollOverflowPattern.test(style.overflowY) && element.scrollHeight > element.clientHeight;
  const scrollsHorizontally = scrollOverflowPattern.test(style.overflowX) && element.scrollWidth > element.clientWidth;
  return scrollsVertically || scrollsHorizontally;
};

export const findScrollContainer = (element: Element | null, document: Document) => {
  let current = element;
  while (current) {
    if (isScrollableContainer(current)) return current;
    current = current.parentElement;
  }
  return document.scrollingElement ?? document.documentElement ?? null;
};

const dispatchClick = (target: Element, clientX: number, clientY: number) => {
  const view = target.ownerDocument.defaultView;
  if (!view) return false;
  const PointerEventConstructor = view.PointerEvent ?? view.MouseEvent;
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    view,
  };
  target.dispatchEvent(new PointerEventConstructor('pointerdown', { ...base, buttons: 1 }));
  target.dispatchEvent(new view.MouseEvent('mousedown', { ...base, buttons: 1 }));
  target.dispatchEvent(new PointerEventConstructor('pointerup', { ...base, buttons: 0 }));
  target.dispatchEvent(new view.MouseEvent('mouseup', { ...base, buttons: 0 }));
  if (typeof (target as HTMLElement).click === 'function') (target as HTMLElement).click();
  else target.dispatchEvent(new view.MouseEvent('click', { ...base, buttons: 0 }));
  return true;
};

const scrollContainer = (container: Element, dy: number) => {
  if (typeof (container as HTMLElement).scrollBy === 'function') {
    (container as HTMLElement).scrollBy({ top: dy });
    return;
  }
  (container as HTMLElement).scrollTop += dy;
};

export const applyRemoteInput = (update: RemoteInputUpdate, environment?: RemoteInputEnvironment) => {
  if (!isRemoteInputUpdate(update)) return false;
  const resolved =
    environment ?? (typeof document === 'undefined' ? null : { document, view: window });
  if (!resolved) return false;

  const target = resolveRemoteTarget(update.x, update.y, resolved);
  applyingRemoteInput = true;
  try {
    if (update.kind === 'scroll') {
      const container = findScrollContainer(target, resolved.document);
      if (!container) return false;
      scrollContainer(container, clampScrollStep(update.dy));
      return true;
    }
    if (!target) return false;
    return dispatchClick(
      target,
      Math.round(update.x * resolved.view.innerWidth),
      Math.round(update.y * resolved.view.innerHeight),
    );
  } finally {
    applyingRemoteInput = false;
  }
};
