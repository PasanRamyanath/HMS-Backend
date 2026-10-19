/**
 * @hms/core - Time-of-Day Menu & Catalog Availability Schedule Evaluator.
 *
 * Implements Step 227 (Phase 10.02) of the Sri Lanka HMS Architecture Plan:
 * Evaluates whether a menu catalog category or item is currently orderable in
 * Sri Lanka Standard Time (SLST / Asia/Colombo, UTC+05:30).
 *
 * Features:
 * 1. Zero external runtime NPM dependencies (pure Node.js standard library & Intl API).
 * 2. Deterministic Result<T, DomainError> error propagation.
 * 3. High-precision Sri Lanka timezone resolution (`Asia/Colombo`).
 * 4. Supports:
 *    - All-day categories (e.g. "00:00" to "23:59" or undefined window).
 *    - Daytime operating windows (e.g. Breakfast "06:30" to "10:30", Lunch "11:30" to "15:30").
 *    - Cross-midnight / overnight operating windows (e.g. Night Bar / Supper "18:00" to "02:00", Late Night Bites "22:30" to "05:00").
 *    - Specific days of the week filter (0 = Sunday, 1 = Monday, ..., 6 = Saturday).
 * 5. Returns structured evaluation details including current time in SLST, next opening time, and remaining open minutes.
 */

import { SRI_LANKA_TIMEZONE } from "./format.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export interface MenuTimeWindow {
  /** 24-hour start time in "HH:mm" format (e.g., "06:30"). */
  readonly startTime: string;
  /** 24-hour end time in "HH:mm" format (e.g., "10:30" or "02:00" for overnight). */
  readonly endTime: string;
  /**
   * Optional days of the week when this window is active.
   * 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday.
   * If omitted or empty, active all 7 days of the week.
   */
  readonly daysOfWeek?: ReadonlyArray<number> | undefined;
}

export interface CategoryScheduleConfig {
  readonly categoryId: string;
  /** Master on/off toggle for this category. */
  readonly isActive: boolean;
  /** Optional time-of-day availability window. If undefined, available 24/7. */
  readonly availableWindow?: MenuTimeWindow | undefined;
  /** Optional human-readable category name for error / message composition. */
  readonly name?: string | undefined;
}

export interface ScheduleEvaluationResult {
  readonly isAvailable: boolean;
  readonly categoryId: string;
  /** Evaluated time in Asia/Colombo "HH:mm" 24-hour format. */
  readonly currentSlTime: string;
  /** Day of week in Asia/Colombo (0=Sun..6=Sat). */
  readonly currentSlDayOfWeek: number;
  /** Status code: AVAILABLE, CLOSED_WINDOW, INACTIVE, DAY_EXCLUDED, INVALID_WINDOW. */
  readonly status: "AVAILABLE" | "CLOSED_WINDOW" | "INACTIVE" | "DAY_EXCLUDED" | "ALL_DAY";
  /** Human-readable explanation. */
  readonly reason: string;
  /** Formatted schedule summary string (e.g. "06:30 – 10:30 (SLST)"). */
  readonly scheduleLabel: string;
  /** Approximate minutes until window closes (undefined if not open or 24/7). */
  readonly minutesUntilClose?: number | undefined;
}

// ============================================================================
// Internal Helpers
// ============================================================================

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validates a "HH:mm" string.
 */
export function isValidTimeString(time: string): boolean {
  return TIME_REGEX.test(time.trim());
}

/**
 * Converts "HH:mm" to integer minutes from midnight (0 to 1439).
 */
export function parseMenuTimeToMinutes(time: string): number {
  const parts = time.trim().split(":");
  const hours = Number.parseInt(parts[0] ?? "0", 10);
  const minutes = Number.parseInt(parts[1] ?? "0", 10);
  return hours * 60 + minutes;
}

/**
 * Extracts the current Asia/Colombo (SLST) time as minutes from midnight and day of week.
 */
export function getSriLankaCurrentTimeComponents(referenceDate: Date = new Date()): {
  readonly minutesFromMidnight: number;
  readonly timeString: string;
  readonly dayOfWeek: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SRI_LANKA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(referenceDate);

  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minStr = parts.find((p) => p.type === "minute")?.value ?? "00";
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const dayOfWeek = weekdayMap[weekdayStr] ?? 0;
  const hours = Number.parseInt(hourStr, 10);
  const minutes = Number.parseInt(minStr, 10);
  const minutesFromMidnight = hours * 60 + minutes;
  const timeString = `${hourStr.padStart(2, "0")}:${minStr.padStart(2, "0")}`;

  return { minutesFromMidnight, timeString, dayOfWeek };
}

interface WindowEvaluationInput {
  readonly categoryId: string;
  readonly currentMinutes: number;
  readonly currentSlTime: string;
  readonly currentSlDayOfWeek: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly startTimeStr: string;
  readonly endTimeStr: string;
  readonly scheduleLabel: string;
}

function evaluateDaytimeWindow(input: WindowEvaluationInput): ScheduleEvaluationResult {
  const isOpen =
    input.currentMinutes >= input.startMinutes && input.currentMinutes <= input.endMinutes;
  if (isOpen) {
    return {
      isAvailable: true,
      categoryId: input.categoryId,
      currentSlTime: input.currentSlTime,
      currentSlDayOfWeek: input.currentSlDayOfWeek,
      status: "AVAILABLE",
      reason: `Available now until ${input.endTimeStr}`,
      scheduleLabel: input.scheduleLabel,
      minutesUntilClose: input.endMinutes - input.currentMinutes,
    };
  }

  return {
    isAvailable: false,
    categoryId: input.categoryId,
    currentSlTime: input.currentSlTime,
    currentSlDayOfWeek: input.currentSlDayOfWeek,
    status: "CLOSED_WINDOW",
    reason: `Outside service hours (opens at ${input.startTimeStr})`,
    scheduleLabel: input.scheduleLabel,
  };
}

function evaluateOvernightWindow(input: WindowEvaluationInput): ScheduleEvaluationResult {
  const isOvernightOpen =
    input.currentMinutes >= input.startMinutes || input.currentMinutes <= input.endMinutes;

  if (isOvernightOpen) {
    const minutesUntilClose =
      input.currentMinutes >= input.startMinutes
        ? 1440 - input.currentMinutes + input.endMinutes
        : input.endMinutes - input.currentMinutes;

    return {
      isAvailable: true,
      categoryId: input.categoryId,
      currentSlTime: input.currentSlTime,
      currentSlDayOfWeek: input.currentSlDayOfWeek,
      status: "AVAILABLE",
      reason: `Available now until ${input.endTimeStr} (Overnight)`,
      scheduleLabel: input.scheduleLabel,
      minutesUntilClose,
    };
  }

  return {
    isAvailable: false,
    categoryId: input.categoryId,
    currentSlTime: input.currentSlTime,
    currentSlDayOfWeek: input.currentSlDayOfWeek,
    status: "CLOSED_WINDOW",
    reason: `Outside overnight service hours (opens at ${input.startTimeStr})`,
    scheduleLabel: input.scheduleLabel,
  };
}

// ============================================================================
// Core Function: isCategoryAvailableNow
// ============================================================================

/**
 * Evaluates whether a menu category is available for orders at the given reference time.
 * Evaluated strictly in the Asia/Colombo (UTC+05:30) timezone.
 */
export function isCategoryAvailableNow(
  config: CategoryScheduleConfig,
  referenceDate: Date = new Date(),
): Result<ScheduleEvaluationResult, DomainError> {
  if (!config.categoryId || config.categoryId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Category ID is required for schedule evaluation");
  }

  const { minutesFromMidnight, timeString, dayOfWeek } =
    getSriLankaCurrentTimeComponents(referenceDate);

  // 1. Check Master Inactive Flag
  if (!config.isActive) {
    return ok({
      isAvailable: false,
      categoryId: config.categoryId,
      currentSlTime: timeString,
      currentSlDayOfWeek: dayOfWeek,
      status: "INACTIVE",
      reason: `Category '${config.name ?? config.categoryId}' is marked inactive`,
      scheduleLabel: "Inactive",
    });
  }

  // 2. Check If Window is Undefined (All-Day 24/7)
  const window = config.availableWindow;
  if (!window) {
    return ok({
      isAvailable: true,
      categoryId: config.categoryId,
      currentSlTime: timeString,
      currentSlDayOfWeek: dayOfWeek,
      status: "ALL_DAY",
      reason: "Available 24 hours daily",
      scheduleLabel: "24 Hours All-Day",
    });
  }

  // 3. Validate Time Window Format
  if (!isValidTimeString(window.startTime) || !isValidTimeString(window.endTime)) {
    return domainErr(
      "VALIDATION_FAILED",
      `Invalid time window format: startTime='${window.startTime}', endTime='${window.endTime}'. Expected 'HH:mm'.`,
    );
  }

  const scheduleLabel = `${window.startTime} – ${window.endTime} (SLST)`;

  // 4. Check Day of Week Filter
  if (window.daysOfWeek && window.daysOfWeek.length > 0 && !window.daysOfWeek.includes(dayOfWeek)) {
    return ok({
      isAvailable: false,
      categoryId: config.categoryId,
      currentSlTime: timeString,
      currentSlDayOfWeek: dayOfWeek,
      status: "DAY_EXCLUDED",
      reason: "Category is not scheduled on this day of the week",
      scheduleLabel,
    });
  }

  const startMinutes = parseMenuTimeToMinutes(window.startTime);
  const endMinutes = parseMenuTimeToMinutes(window.endTime);

  const evalInput: WindowEvaluationInput = {
    categoryId: config.categoryId,
    currentMinutes: minutesFromMidnight,
    currentSlTime: timeString,
    currentSlDayOfWeek: dayOfWeek,
    startMinutes,
    endMinutes,
    startTimeStr: window.startTime,
    endTimeStr: window.endTime,
    scheduleLabel,
  };

  // 5. Evaluate Normal Window vs Cross-Midnight Window
  if (startMinutes <= endMinutes) {
    return ok(evaluateDaytimeWindow(evalInput));
  }

  return ok(evaluateOvernightWindow(evalInput));
}
