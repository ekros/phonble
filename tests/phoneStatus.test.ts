import { expect, test } from '@rstest/core';
import {
  createPhoneStatusEnvironment,
  describePhoneNetwork,
  formatBatteryLevel,
  formatPhoneStatusAge,
  getNetworkStatus,
  getScreenStatus,
  isPhoneStatusStale,
  isPhoneStatusUpdate,
  normalizeBattery,
  PHONE_STATUS_HEARTBEAT_MS,
  PHONE_STATUS_MIN_INTERVAL_MS,
  PHONE_STATUS_STALE_MS,
  startPhoneStatusReporting,
} from '../src/phoneStatus';
import type { PhoneStatus, PhoneStatusEnvironment, PhoneStatusScheduler } from '../src/phoneStatus';

type NavigatorStub = NonNullable<Partial<PhoneStatusEnvironment>['navigator']>;

const createTarget = () => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) {
      const registered = listeners.get(type) ?? new Set<() => void>();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listenerCount() {
      let total = 0;
      for (const registered of listeners.values()) total += registered.size;
      return total;
    },
  };
};

const createClock = () => {
  let now = 10_000;
  let sequence = 0;
  const timers = new Map<number, { at: number; handler: () => void }>();
  const scheduler: PhoneStatusScheduler = {
    setTimeout: (handler, delayMs) => {
      sequence += 1;
      timers.set(sequence, { at: now + delayMs, handler });
      return sequence;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  return {
    scheduler,
    advance(elapsed: number) {
      now += elapsed;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((left, right) => left[1].at - right[1].at);
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        timer.handler();
      }
    },
    now: () => now,
    pendingTimers: () => timers.size,
  };
};

const startReporter = (options: {
  navigator?: NavigatorStub;
  visibility?: string;
  orientation?: string;
} = {}) => {
  const clock = createClock();
  const documentTarget = Object.assign(createTarget(), {
    visibilityState: options.visibility ?? 'visible',
  });
  const view = Object.assign(createTarget(), {
    devicePixelRatio: 3,
    innerWidth: 390,
    innerHeight: 844,
  });
  const orientation = Object.assign(createTarget(), { type: options.orientation ?? 'portrait-primary' });
  const sent: PhoneStatus[] = [];
  const stop = startPhoneStatusReporting((status) => sent.push(status), {
    navigator: options.navigator ?? {},
    document: documentTarget,
    window: view,
    screen: { width: 390, height: 844, orientation },
    now: clock.now,
    scheduler: clock.scheduler,
  });
  return { sent, stop, clock, documentTarget, view };
};

const validStatus = {
  type: 'phone-status',
  updatedAt: 1_000,
  visibility: 'visible',
  lastInteractionAt: 900,
  battery: { level: 0.5, charging: false, chargingTime: null, dischargingTime: 1200 },
  network: { online: true, effectiveType: '4g', saveData: false, rtt: 50, downlink: 5 },
  screen: { width: 390, height: 844, dpr: 3, orientation: 'portrait' },
  device: { model: 'Pixel 7', platformVersion: '14.0.0', cores: 8, memoryGb: 4 },
};

test('normalizes a battery manager into a clamped snapshot', () => {
  expect(normalizeBattery({
    level: 0.6237,
    charging: true,
    chargingTime: Number.POSITIVE_INFINITY,
    dischargingTime: 3600,
  })).toEqual({ level: 0.624, charging: true, chargingTime: null, dischargingTime: 3600 });

  expect(normalizeBattery({
    level: 1.8,
    charging: false,
    chargingTime: 0,
    dischargingTime: 0,
  })).toEqual({ level: 1, charging: false, chargingTime: 0, dischargingTime: 0 });

  expect(normalizeBattery(null)).toBeNull();
});

test('reads network state with and without the Network Information API', () => {
  expect(getNetworkStatus({ onLine: true, connection: { effectiveType: '3g', saveData: true, rtt: 150, downlink: 1.4 } }))
    .toEqual({ online: true, effectiveType: '3g', saveData: true, rtt: 150, downlink: 1.4 });

  expect(getNetworkStatus({ onLine: false })).toEqual({
    online: false,
    effectiveType: null,
    saveData: null,
    rtt: null,
    downlink: null,
  });
});

test('derives orientation from the screen orientation type or the aspect ratio', () => {
  const fromType = createPhoneStatusEnvironment({
    screen: { width: 390, height: 844, orientation: { type: 'landscape-secondary' } },
    window: { devicePixelRatio: 2.5 },
  });
  expect(getScreenStatus(fromType)).toEqual({ width: 390, height: 844, dpr: 2.5, orientation: 'landscape' });

  const fromRatio = createPhoneStatusEnvironment({ screen: { width: 1080, height: 1920 } });
  expect(getScreenStatus(fromRatio)).toEqual({ width: 1080, height: 1920, dpr: 1, orientation: 'portrait' });
});

test('validates phone status updates relayed by the server', () => {
  expect(isPhoneStatusUpdate({ ...validStatus, deviceId: 'phone-1' })).toBe(true);
  expect(isPhoneStatusUpdate({ ...validStatus, deviceId: 'phone-1', visibility: 'sleeping' })).toBe(false);
  expect(isPhoneStatusUpdate({ ...validStatus, deviceId: '' })).toBe(false);
  expect(isPhoneStatusUpdate({
    ...validStatus,
    deviceId: 'phone-1',
    battery: { level: 1.4, charging: true, chargingTime: null, dischargingTime: null },
  })).toBe(false);
  expect(isPhoneStatusUpdate({
    ...validStatus,
    deviceId: 'phone-1',
    screen: { ...validStatus.screen, width: 0 },
  })).toBe(false);
  expect(isPhoneStatusUpdate({ deviceId: 'phone-1' })).toBe(false);
});

test('sends an initial snapshot and throttles bursts of changes', () => {
  const reporter = startReporter();

  expect(reporter.sent).toHaveLength(1);
  expect(reporter.sent[0]).toMatchObject({
    type: 'phone-status',
    visibility: 'visible',
    battery: null,
    network: { online: true },
    screen: { width: 390, height: 844, dpr: 3, orientation: 'portrait' },
  });

  reporter.documentTarget.dispatch('visibilitychange');
  expect(reporter.sent).toHaveLength(1);

  reporter.clock.advance(PHONE_STATUS_MIN_INTERVAL_MS);
  expect(reporter.sent).toHaveLength(2);

  reporter.stop();
});

test('emits a heartbeat while visible and pauses it while the page is hidden', () => {
  const reporter = startReporter();

  reporter.clock.advance(PHONE_STATUS_HEARTBEAT_MS);
  expect(reporter.sent).toHaveLength(2);

  reporter.documentTarget.visibilityState = 'hidden';
  reporter.documentTarget.dispatch('visibilitychange');
  reporter.clock.advance(PHONE_STATUS_MIN_INTERVAL_MS);
  expect(reporter.sent[reporter.sent.length - 1].visibility).toBe('hidden');

  const sentWhileHidden = reporter.sent.length;
  reporter.clock.advance(PHONE_STATUS_HEARTBEAT_MS * 3);
  expect(reporter.sent).toHaveLength(sentWhileHidden);

  reporter.stop();
});

test('reports battery changes once the battery manager resolves', async () => {
  const battery = Object.assign(createTarget(), {
    level: 0.42,
    charging: true,
    chargingTime: 900,
    dischargingTime: Number.POSITIVE_INFINITY,
  });
  const reporter = startReporter({ navigator: { getBattery: () => Promise.resolve(battery) } });

  await Promise.resolve();
  await Promise.resolve();
  expect(reporter.sent).toHaveLength(1);
  expect(reporter.sent[0].battery).toBeNull();

  reporter.clock.advance(PHONE_STATUS_MIN_INTERVAL_MS);
  expect(reporter.sent[1].battery).toEqual({
    level: 0.42,
    charging: true,
    chargingTime: 900,
    dischargingTime: null,
  });

  battery.level = 0.2;
  battery.dispatch('levelchange');
  reporter.clock.advance(PHONE_STATUS_MIN_INTERVAL_MS);
  expect(reporter.sent[2].battery?.level).toBe(0.2);

  reporter.stop();
  expect(battery.listenerCount()).toBe(0);
});

test('adds high-entropy device hints when the browser exposes them', async () => {
  const reporter = startReporter({
    navigator: {
      hardwareConcurrency: 8,
      deviceMemory: 4,
      userAgentData: {
        getHighEntropyValues: () => Promise.resolve({ model: 'Pixel 7', platformVersion: '14.0.0' }),
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();
  reporter.clock.advance(PHONE_STATUS_MIN_INTERVAL_MS);

  expect(reporter.sent[1].device).toEqual({
    model: 'Pixel 7',
    platformVersion: '14.0.0',
    cores: 8,
    memoryGb: 4,
  });

  reporter.stop();
});

test('tracks the last interaction and detaches everything on cleanup', () => {
  const reporter = startReporter();
  const firstInteraction = reporter.sent[0].lastInteractionAt;

  reporter.clock.advance(1_000);
  reporter.view.dispatch('pointerdown');
  reporter.view.dispatch('resize');
  reporter.clock.advance(PHONE_STATUS_MIN_INTERVAL_MS);

  expect(reporter.sent[1].lastInteractionAt).toBe(firstInteraction + 1_000);

  reporter.stop();
  expect(reporter.view.listenerCount()).toBe(0);
  expect(reporter.documentTarget.listenerCount()).toBe(0);
  expect(reporter.clock.pendingTimers()).toBe(0);

  reporter.clock.advance(PHONE_STATUS_HEARTBEAT_MS * 3);
  expect(reporter.sent).toHaveLength(2);
});

test('formats battery, network and status age for the phone panel', () => {
  expect(formatBatteryLevel({ level: 0.78, charging: false, chargingTime: null, dischargingTime: null })).toBe('78%');
  expect(formatBatteryLevel(null)).toBe('No battery data');

  expect(describePhoneNetwork({ online: false, effectiveType: null, saveData: null, rtt: null, downlink: null })).toBe('Offline');
  expect(describePhoneNetwork({ online: true, effectiveType: '4g', saveData: null, rtt: null, downlink: null })).toBe('4G');
  expect(describePhoneNetwork({ online: true, effectiveType: 'slow-2g', saveData: null, rtt: null, downlink: null })).toBe('Very slow');

  expect(formatPhoneStatusAge(1_000, 1_300)).toBe('just now');
  expect(formatPhoneStatusAge(1_000, 13_000)).toBe('12s ago');
  expect(formatPhoneStatusAge(1_000, 121_000)).toBe('2m ago');
  expect(formatPhoneStatusAge(1_000, 3_601_000)).toBe('1h ago');

  expect(isPhoneStatusStale(1_000, 1_000 + PHONE_STATUS_STALE_MS)).toBe(false);
  expect(isPhoneStatusStale(1_000, 1_001 + PHONE_STATUS_STALE_MS)).toBe(true);
});
