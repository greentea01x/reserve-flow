export const APP_TZ = 'Asia/Bangkok' as const;

export interface PolicyDefaults {
  autoReleaseEnabled: boolean;
  bufferMinutes: number;
  checkInGraceMinutes: number;
  checkInOpensMinutesBefore: number;
  maxAdvanceDays: number;
  maxDurationMinutes: number | null;
  minDurationMinutes: number;
  reminderMinutesBefore: number;
  slotIncrementMinutes: number;
}

export const POLICY_DEFAULTS = {
  autoReleaseEnabled: true,
  bufferMinutes: 0,
  checkInGraceMinutes: 15,
  checkInOpensMinutesBefore: 15,
  maxAdvanceDays: 30,
  maxDurationMinutes: null,
  minDurationMinutes: 60,
  reminderMinutesBefore: 15,
  slotIncrementMinutes: 30,
} as const satisfies PolicyDefaults;
