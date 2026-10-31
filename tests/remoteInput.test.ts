import { afterEach, expect, test } from '@rstest/core';
import {
  applyRemoteInput,
  createClickInput,
  createScrollInput,
  findScrollContainer,
  isApplyingRemoteInput,
  isRemoteInputUpdate,
  MAX_SCROLL_STEP,
} from '../src/remoteInput';

const environment = { document, view: { innerWidth: 1000, innerHeight: 500 } };
const originalElementFromPoint = document.elementFromPoint;

const pointAt = (element: Element | null) => {
  document.elementFromPoint = () => element;
};

afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
  document.body.innerHTML = '';
});

test('builds click and scroll messages the relay accepts', () => {
  expect(createClickInput(1.4, -0.2)).toEqual({ type: 'input', kind: 'click', x: 1, y: 0 });
  expect(createScrollInput(0.5, 2, 5000)).toEqual({ type: 'input', kind: 'scroll', x: 0.5, y: 1, dy: MAX_SCROLL_STEP });
  expect(createScrollInput(0.5, 0.5, -5000)).toEqual({ type: 'input', kind: 'scroll', x: 0.5, y: 0.5, dy: -MAX_SCROLL_STEP });
  expect(createScrollInput(0.25, 0.75, Number.NaN)).toEqual({ type: 'input', kind: 'scroll', x: 0.25, y: 0.75, dy: 0 });
});

test('validates input updates coming from other devices', () => {
  expect(isRemoteInputUpdate({ type: 'input', deviceId: 'phone', kind: 'click', x: 0.2, y: 0.8 })).toBe(true);
  expect(isRemoteInputUpdate({ type: 'input', deviceId: 'phone', kind: 'scroll', x: 0.2, y: 0.8, dy: 120 })).toBe(true);
  expect(isRemoteInputUpdate({ type: 'input', deviceId: 'phone', kind: 'scroll', x: 0.2, y: 0.8 })).toBe(false);
  expect(isRemoteInputUpdate({ type: 'input', deviceId: 'phone', kind: 'scroll', x: 0.2, y: 0.8, dy: MAX_SCROLL_STEP + 1 })).toBe(false);
  expect(isRemoteInputUpdate({ type: 'input', deviceId: 'phone', kind: 'keypress', x: 0.2, y: 0.8 })).toBe(false);
  expect(isRemoteInputUpdate({ type: 'input', deviceId: 'phone', kind: 'click', x: 1.2, y: 0.8 })).toBe(false);
  expect(isRemoteInputUpdate({ type: 'input', kind: 'click', x: 0.2, y: 0.8 })).toBe(false);
  expect(isRemoteInputUpdate({ type: 'pointer', deviceId: 'phone', active: true, x: 0.2, y: 0.8 })).toBe(false);
});

test('replays a remote click on the element under the point', () => {
  const button = document.createElement('button');
  document.body.append(button);
  pointAt(button);
  const received: string[] = [];
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    button.addEventListener(type, () => received.push(type));
  }
  let flagDuringClick = false;
  button.addEventListener('click', () => {
    flagDuringClick = isApplyingRemoteInput();
  });

  expect(applyRemoteInput({ type: 'input', kind: 'click', x: 0.5, y: 0.5, deviceId: 'desktop' }, environment)).toBe(true);
  expect(received).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  expect(flagDuringClick).toBe(true);
  expect(isApplyingRemoteInput()).toBe(false);
});

test('ignores remote clicks that do not land on an element', () => {
  pointAt(null);
  expect(applyRemoteInput({ type: 'input', kind: 'click', x: 0.5, y: 0.5, deviceId: 'desktop' }, environment)).toBe(false);
});

test('scrolls the nearest scrollable ancestor of the remote point', () => {
  const container = document.createElement('div');
  container.style.overflowY = 'auto';
  Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(container, 'scrollHeight', { value: 1200, configurable: true });
  const child = document.createElement('span');
  container.append(child);
  document.body.append(container);
  const calls: ScrollToOptions[] = [];
  container.scrollBy = ((options: ScrollToOptions) => calls.push(options)) as typeof container.scrollBy;
  pointAt(child);

  expect(applyRemoteInput({ type: 'input', kind: 'scroll', x: 0.1, y: 0.1, dy: 180, deviceId: 'desktop' }, environment)).toBe(true);
  expect(calls).toEqual([{ top: 180 }]);
});

test('falls back to the document scroller when nothing else scrolls', () => {
  const child = document.createElement('span');
  document.body.append(child);
  expect(findScrollContainer(child, document)).toBe(document.scrollingElement ?? document.documentElement);
});
