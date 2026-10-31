import { expect, test } from '@rstest/core';
import {
  createPointerMessage,
  createPointerReleaseMessage,
  isPointerUpdate,
  toPhonePoint,
} from '../src/pointerSync';

const phoneArea = { left: 100, top: 50, width: 200, height: 400 };

test('maps pointer positions inside the phone area to normalized phone coordinates', () => {
  expect(toPhonePoint(phoneArea, 200, 250)).toEqual({ x: 0.5, y: 0.5 });
  expect(toPhonePoint(phoneArea, 100, 50)).toEqual({ x: 0, y: 0 });
  expect(toPhonePoint(phoneArea, 300, 450)).toEqual({ x: 1, y: 1 });
});

test('clamps pointer positions that leave the phone area', () => {
  expect(toPhonePoint(phoneArea, 0, 10)).toEqual({ x: 0, y: 0 });
  expect(toPhonePoint(phoneArea, 900, 9000)).toEqual({ x: 1, y: 1 });
});

test('ignores a phone area without a measurable size', () => {
  expect(toPhonePoint({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toBeNull();
  expect(toPhonePoint({ left: 0, top: 0, width: 200, height: 0 }, 10, 10)).toBeNull();
});

test('builds pointer messages within the coordinate range the relay accepts', () => {
  expect(createPointerMessage(1.4, -0.2)).toEqual({ type: 'pointer', active: true, x: 1, y: 0 });
  expect(createPointerReleaseMessage()).toEqual({ type: 'pointer', active: false, x: 0, y: 0 });
});

test('validates pointer updates coming from other devices', () => {
  expect(isPointerUpdate({ type: 'pointer', deviceId: 'phone', active: true, x: 0.2, y: 0.8 })).toBe(true);
  expect(isPointerUpdate({ type: 'pointer', deviceId: 'phone', active: false, x: 0, y: 0 })).toBe(true);
  expect(isPointerUpdate({ type: 'pointer', deviceId: 'phone', active: true, x: 1.5, y: 0.8 })).toBe(false);
  expect(isPointerUpdate({ type: 'pointer', active: true, x: 0.2, y: 0.8 })).toBe(false);
  expect(isPointerUpdate({ type: 'pointer', deviceId: 'phone', active: true, x: Number.NaN, y: 0.8 })).toBe(false);
  expect(isPointerUpdate({ type: 'text', text: '' })).toBe(false);
});
