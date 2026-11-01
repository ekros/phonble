export type PhoneVisibility = 'visible' | 'hidden';
export type PhoneOrientation = 'portrait' | 'landscape';

export type PhoneBattery = {
  level: number;
  charging: boolean;
  chargingTime: number | null;
  dischargingTime: number | null;
};

export type PhoneNetwork = {
  online: boolean;
  effectiveType: string | null;
  saveData: boolean | null;
  rtt: number | null;
  downlink: number | null;
};

export type PhoneScreen = {
  width: number;
  height: number;
  dpr: number;
  orientation: PhoneOrientation;
};

export type PhoneDevice = {
  model: string | null;
  platformVersion: string | null;
  cores: number | null;
  memoryGb: number | null;
};

export type PhoneStatus = {
  type: 'phone-status';
  updatedAt: number;
  visibility: PhoneVisibility;
  lastInteractionAt: number;
  battery: PhoneBattery | null;
  network: PhoneNetwork;
  screen: PhoneScreen;
  device: PhoneDevice;
};

export type PhoneStatusUpdate = PhoneStatus & { deviceId: string };

// A phone that stops reporting (screen off, app suspended) keeps its last snapshot, so the
// reader needs a deadline after which the values are shown as stale instead of current.
export const PHONE_STATUS_STALE_MS = 45_000;
export const PHONE_STATUS_HEARTBEAT_MS = 30_000;
export const PHONE_STATUS_MIN_INTERVAL_MS = 5_000;

export type PhoneStatusScheduler = {
  setTimeout: (handler: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type EventTargetLike = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type BatteryManagerLike = {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

type NetworkConnectionLike = Partial<EventTargetLike> & {
  effectiveType?: string;
  saveData?: boolean;
  rtt?: number;
  downlink?: number;
};

type NavigatorLike = {
  onLine?: boolean;
  connection?: NetworkConnectionLike | null;
  getBattery?: () => Promise<BatteryManagerLike> | BatteryManagerLike;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  userAgentData?: {
    getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platformVersion?: string }>;
  } | null;
};

type ScreenLike = {
  width?: number;
  height?: number;
  orientation?: (Partial<EventTargetLike> & { type?: string }) | null;
};

type WindowLike = Partial<EventTargetLike> & {
  devicePixelRatio?: number;
  innerWidth?: number;
  innerHeight?: number;
};

type DocumentLike = Partial<EventTargetLike> & { visibilityState?: string };

export type PhoneStatusEnvironment = {
  navigator: NavigatorLike;
  document: DocumentLike;
  window: WindowLike;
  screen: ScreenLike;
  now: () => number;
  scheduler: PhoneStatusScheduler;
};

type GlobalScopeLike = {
  navigator?: NavigatorLike;
  document?: DocumentLike;
  screen?: ScreenLike;
  setTimeout?: (handler: () => void, delayMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  devicePixelRatio?: number;
  innerWidth?: number;
  innerHeight?: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

const getGlobalScope = (): GlobalScopeLike | null =>
  typeof globalThis === 'undefined' ? null : (globalThis as unknown as GlobalScopeLike);

export const createPhoneStatusEnvironment = (
  overrides: Partial<PhoneStatusEnvironment> = {},
): PhoneStatusEnvironment => {
  const scope = getGlobalScope();
  return {
    navigator: overrides.navigator ?? scope?.navigator ?? {},
    document: overrides.document ?? scope?.document ?? { visibilityState: 'visible' },
    window: overrides.window ?? scope ?? {},
    screen: overrides.screen ?? scope?.screen ?? {},
    now: overrides.now ?? (() => Date.now()),
    scheduler: overrides.scheduler ?? {
      setTimeout: (handler, delayMs) => scope?.setTimeout?.(handler, delayMs),
      clearTimeout: (handle) => scope?.clearTimeout?.(handle),
    },
  };
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const toOptionalNonNegative = (value: unknown) =>
  isFiniteNumber(value) && value >= 0 ? round(value, 3) : null;

const toOptionalText = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
};

const toOptionalPositive = (value: unknown, max: number) =>
  isFiniteNumber(value) && value > 0 && value <= max ? round(value, 3) : null;

export const normalizeBattery = (manager: BatteryManagerLike | null | undefined): PhoneBattery | null => {
  if (!manager || !isFiniteNumber(manager.level)) return null;
  return {
    level: round(clampUnit(manager.level), 3),
    charging: manager.charging === true,
    chargingTime: toOptionalNonNegative(manager.chargingTime),
    dischargingTime: toOptionalNonNegative(manager.dischargingTime),
  };
};

export const getNetworkStatus = (navigator: NavigatorLike): PhoneNetwork => {
  const connection = navigator.connection ?? null;
  return {
    online: navigator.onLine !== false,
    effectiveType: toOptionalText(connection?.effectiveType, 16),
    saveData: typeof connection?.saveData === 'boolean' ? connection.saveData : null,
    rtt: toOptionalNonNegative(connection?.rtt),
    downlink: toOptionalNonNegative(connection?.downlink),
  };
};

export const getScreenStatus = (environment: PhoneStatusEnvironment): PhoneScreen => {
  const width = toOptionalPositive(environment.screen.width, 20_000) ?? toOptionalPositive(environment.window.innerWidth, 20_000);
  const height = toOptionalPositive(environment.screen.height, 20_000) ?? toOptionalPositive(environment.window.innerHeight, 20_000);
  const dpr = toOptionalPositive(environment.window.devicePixelRatio, 10) ?? 1;
  const orientationType = environment.screen.orientation?.type;
  const orientation: PhoneOrientation =
    typeof orientationType === 'string' && orientationType.startsWith('portrait')
      ? 'portrait'
      : typeof orientationType === 'string' && orientationType.startsWith('landscape')
        ? 'landscape'
        : (height ?? 0) >= (width ?? 0)
          ? 'portrait'
          : 'landscape';
  return {
    // A status snapshot must always be self-consistent, so degenerate viewports still report 1px.
    width: Math.max(1, Math.round(width ?? 1)),
    height: Math.max(1, Math.round(height ?? 1)),
    dpr,
    orientation,
  };
};

export const getDeviceStatus = (
  navigator: NavigatorLike,
  highEntropy: { model?: string; platformVersion?: string } | null = null,
): PhoneDevice => {
  const cores = toOptionalPositive(navigator.hardwareConcurrency, 1024);
  return {
    model: toOptionalText(highEntropy?.model, 64),
    platformVersion: toOptionalText(highEntropy?.platformVersion, 32),
    cores: cores === null ? null : Math.round(cores),
    memoryGb: toOptionalPositive(navigator.deviceMemory, 4096),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isOptionalFinite = (value: unknown) => value === null || isFiniteNumber(value);
const isOptionalText = (value: unknown, maxLength: number) =>
  value === null || (typeof value === 'string' && value.length <= maxLength);

const isBatteryUpdate = (value: unknown) => {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.level) &&
    value.level >= 0 &&
    value.level <= 1 &&
    typeof value.charging === 'boolean' &&
    isOptionalFinite(value.chargingTime) &&
    isOptionalFinite(value.dischargingTime)
  );
};

const isNetworkUpdate = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    typeof value.online === 'boolean' &&
    isOptionalText(value.effectiveType, 16) &&
    (value.saveData === null || typeof value.saveData === 'boolean') &&
    isOptionalFinite(value.rtt) &&
    isOptionalFinite(value.downlink)
  );
};

const isScreenUpdate = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    value.width <= 20_000 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    value.height <= 20_000 &&
    isFiniteNumber(value.dpr) &&
    value.dpr > 0 &&
    value.dpr <= 10 &&
    (value.orientation === 'portrait' || value.orientation === 'landscape')
  );
};

const isDeviceUpdate = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    isOptionalText(value.model, 64) &&
    isOptionalText(value.platformVersion, 32) &&
    (value.cores === null || (isFiniteNumber(value.cores) && value.cores > 0)) &&
    (value.memoryGb === null || (isFiniteNumber(value.memoryGb) && value.memoryGb > 0))
  );
};

export const isPhoneStatusUpdate = (value: unknown): value is PhoneStatusUpdate => {
  if (!isRecord(value)) return false;
  return (
    value.type === 'phone-status' &&
    typeof value.deviceId === 'string' &&
    value.deviceId.length > 0 &&
    isFiniteNumber(value.updatedAt) &&
    value.updatedAt > 0 &&
    (value.visibility === 'visible' || value.visibility === 'hidden') &&
    isFiniteNumber(value.lastInteractionAt) &&
    isBatteryUpdate(value.battery) &&
    isNetworkUpdate(value.network) &&
    isScreenUpdate(value.screen) &&
    isDeviceUpdate(value.device)
  );
};

const networkLabels: Record<string, string> = {
  'slow-2g': 'Very slow',
  '2g': '2G',
  '3g': '3G',
  '4g': '4G',
};

export const formatBatteryLevel = (battery: PhoneBattery | null) =>
  battery ? `${Math.round(battery.level * 100)}%` : 'No battery data';

export const describePhoneNetwork = (network: PhoneNetwork) => {
  if (!network.online) return 'Offline';
  if (!network.effectiveType) return 'Online';
  return networkLabels[network.effectiveType.toLowerCase()] ?? network.effectiveType.toUpperCase();
};

export const formatPhoneStatusAge = (updatedAt: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};

export const isPhoneStatusStale = (updatedAt: number, now: number) =>
  now - updatedAt > PHONE_STATUS_STALE_MS;

const readStatus = (
  environment: PhoneStatusEnvironment,
  battery: BatteryManagerLike | null,
  highEntropy: { model?: string; platformVersion?: string } | null,
  lastInteractionAt: number,
): PhoneStatus => ({
  type: 'phone-status',
  updatedAt: environment.now(),
  visibility: environment.document.visibilityState === 'hidden' ? 'hidden' : 'visible',
  lastInteractionAt,
  battery: normalizeBattery(battery),
  network: getNetworkStatus(environment.navigator),
  screen: getScreenStatus(environment),
  device: getDeviceStatus(environment.navigator, highEntropy),
});

// Sends an immediate snapshot, then one update per change and a heartbeat while the page is
// visible. Returns a stop function that detaches every listener and timer.
export const startPhoneStatusReporting = (
  send: (status: PhoneStatus) => void,
  overrides: Partial<PhoneStatusEnvironment> = {},
) => {
  const environment = createPhoneStatusEnvironment(overrides);
  const { navigator, document, window, screen, scheduler } = environment;
  let stopped = false;
  let battery: BatteryManagerLike | null = null;
  let highEntropy: { model?: string; platformVersion?: string } | null = null;
  let lastInteractionAt = environment.now();
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let trailingTimer: unknown = null;
  let heartbeatTimer: unknown = null;

  const clearTrailing = () => {
    if (trailingTimer === null) return;
    scheduler.clearTimeout(trailingTimer);
    trailingTimer = null;
  };

  const emit = () => {
    lastSentAt = environment.now();
    send(readStatus(environment, battery, highEntropy, lastInteractionAt));
  };

  const flush = () => {
    if (stopped) return;
    const elapsed = environment.now() - lastSentAt;
    if (elapsed >= PHONE_STATUS_MIN_INTERVAL_MS) {
      clearTrailing();
      emit();
      return;
    }
    if (trailingTimer !== null) return;
    trailingTimer = scheduler.setTimeout(() => {
      trailingTimer = null;
      if (!stopped) emit();
    }, PHONE_STATUS_MIN_INTERVAL_MS - elapsed);
  };

  const scheduleHeartbeat = () => {
    heartbeatTimer = scheduler.setTimeout(() => {
      heartbeatTimer = null;
      if (stopped) return;
      // While the page is hidden the phone is asleep: keep the last snapshot (which already
      // says "hidden") and let it age so the reader can show it as stale.
      if (document.visibilityState !== 'hidden') emit();
      scheduleHeartbeat();
    }, PHONE_STATUS_HEARTBEAT_MS);
  };

  const noteInteraction = () => {
    lastInteractionAt = environment.now();
  };

  const onVisibilityChange = () => flush();
  const onNetworkChange = () => flush();
  const onResize = () => flush();

  document.addEventListener?.('visibilitychange', onVisibilityChange);
  window.addEventListener?.('online', onNetworkChange);
  window.addEventListener?.('offline', onNetworkChange);
  window.addEventListener?.('resize', onResize);
  window.addEventListener?.('orientationchange', onResize);
  window.addEventListener?.('pointerdown', noteInteraction);
  window.addEventListener?.('keydown', noteInteraction);
  window.addEventListener?.('touchstart', noteInteraction);
  navigator.connection?.addEventListener?.('change', onNetworkChange);
  screen.orientation?.addEventListener?.('change', onResize);

  const batteryPromise = navigator.getBattery?.();
  if (batteryPromise && typeof (batteryPromise as Promise<BatteryManagerLike>).then === 'function') {
    (batteryPromise as Promise<BatteryManagerLike>)
      .then((manager) => {
        if (stopped) return;
        battery = manager;
        manager.addEventListener?.('levelchange', flush);
        manager.addEventListener?.('chargingchange', flush);
        flush();
      })
      .catch(() => {
        // Browsers without a working battery service just keep battery: null.
      });
  }

  const userAgentData = navigator.userAgentData;
  if (userAgentData?.getHighEntropyValues) {
    userAgentData
      .getHighEntropyValues(['model', 'platformVersion'])
      .then((values) => {
        if (stopped) return;
        highEntropy = { model: values?.model, platformVersion: values?.platformVersion };
        flush();
      })
      .catch(() => {
        // High-entropy hints are optional; the panel falls back to what it already knows.
      });
  }

  flush();
  scheduleHeartbeat();

  return () => {
    stopped = true;
    clearTrailing();
    if (heartbeatTimer !== null) {
      scheduler.clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
    document.removeEventListener?.('visibilitychange', onVisibilityChange);
    window.removeEventListener?.('online', onNetworkChange);
    window.removeEventListener?.('offline', onNetworkChange);
    window.removeEventListener?.('resize', onResize);
    window.removeEventListener?.('orientationchange', onResize);
    window.removeEventListener?.('pointerdown', noteInteraction);
    window.removeEventListener?.('keydown', noteInteraction);
    window.removeEventListener?.('touchstart', noteInteraction);
    navigator.connection?.removeEventListener?.('change', onNetworkChange);
    screen.orientation?.removeEventListener?.('change', onResize);
    battery?.removeEventListener?.('levelchange', flush);
    battery?.removeEventListener?.('chargingchange', flush);
    battery = null;
    highEntropy = null;
  };
};
