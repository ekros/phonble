import { expect, test } from '@rstest/core';
import {
  canVibrate,
  getHandoffDirection,
  HANDOFF_ENTER_PATTERN,
  HANDOFF_LEAVE_PATTERN,
  needsUserGesture,
  vibrate,
} from '../src/haptics';

test('reports whether a vibration target is available', () => {
  expect(canVibrate(null)).toBe(false);
  expect(canVibrate({})).toBe(false);
  expect(canVibrate({ vibrate: () => true })).toBe(true);
});

test('reports whether the page still needs a user gesture', () => {
  expect(needsUserGesture(null)).toBe(false);
  expect(needsUserGesture({ vibrate: () => true })).toBe(false);
  expect(needsUserGesture({ vibrate: () => true, userActivation: null })).toBe(false);
  expect(needsUserGesture({ vibrate: () => true, userActivation: { hasBeenActive: true } })).toBe(false);
  expect(needsUserGesture({ vibrate: () => true, userActivation: { hasBeenActive: false } })).toBe(true);
});

test('sends the pattern to the target and never throws', () => {
  const patterns: (number | number[])[] = [];
  const target = {
    vibrate: (pattern: number | number[]) => {
      patterns.push(pattern);
      return true;
    },
  };

  expect(vibrate(HANDOFF_ENTER_PATTERN, target)).toBe(true);
  expect(vibrate(HANDOFF_LEAVE_PATTERN, target)).toBe(true);
  expect(patterns).toEqual([HANDOFF_ENTER_PATTERN, HANDOFF_LEAVE_PATTERN]);
  expect(vibrate(30, { vibrate: () => { throw new TypeError('unsupported pattern'); } })).toBe(false);
  expect(vibrate(30, null)).toBe(false);
});

test('uses valid alternating vibration patterns', () => {
  expect(Number.isInteger(HANDOFF_ENTER_PATTERN) && HANDOFF_ENTER_PATTERN > 0).toBe(true);
  expect(HANDOFF_LEAVE_PATTERN.length % 2).toBe(0);
  expect(HANDOFF_LEAVE_PATTERN.every((step) => Number.isInteger(step) && step >= 0)).toBe(true);
});

test('detects handoff transitions between pointers', () => {
  const laptop = { deviceId: 'laptop', active: true };

  expect(getHandoffDirection(null, laptop)).toBe('enter');
  expect(getHandoffDirection(laptop, { ...laptop, active: false })).toBe('leave');
  expect(getHandoffDirection(laptop, { deviceId: 'laptop', active: true })).toBeNull();
  expect(getHandoffDirection({ deviceId: 'laptop', active: false }, { deviceId: 'laptop', active: false })).toBeNull();
  expect(getHandoffDirection(null, { deviceId: 'laptop', active: false })).toBeNull();
  expect(getHandoffDirection(laptop, { deviceId: 'tablet', active: true })).toBe('enter');
});
