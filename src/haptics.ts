export type VibrationPattern = number | number[];
export type VibrationTarget = {
  vibrate?: (pattern: VibrationPattern) => boolean;
  userActivation?: { hasBeenActive?: boolean } | null;
};

export const HANDOFF_ENTER_PATTERN = 30;
export const HANDOFF_LEAVE_PATTERN = [10, 40, 10, 40];

const getDefaultVibrationTarget = (): VibrationTarget | null =>
  typeof navigator === 'undefined' ? null : (navigator as unknown as VibrationTarget);

export const canVibrate = (target: VibrationTarget | null = getDefaultVibrationTarget()) =>
  typeof target?.vibrate === 'function';

// The Vibration API is gated on sticky activation: until the page is tapped or keyed,
// browsers return false and skip the vibration entirely.
export const needsUserGesture = (target: VibrationTarget | null = getDefaultVibrationTarget()) =>
  target?.userActivation?.hasBeenActive === false;

export const vibrate = (
  pattern: VibrationPattern,
  target: VibrationTarget | null = getDefaultVibrationTarget(),
): boolean => {
  if (!target?.vibrate) return false;
  try {
    return target.vibrate(pattern);
  } catch {
    return false;
  }
};

export type HandoffPointer = { deviceId: string; active: boolean };
export type HandoffDirection = 'enter' | 'leave';

export const getHandoffDirection = (
  previous: HandoffPointer | null,
  next: HandoffPointer,
): HandoffDirection | null => {
  if (next.active) return previous?.active && previous.deviceId === next.deviceId ? null : 'enter';
  return previous?.active && previous.deviceId === next.deviceId ? 'leave' : null;
};
