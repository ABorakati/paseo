import type {
  UsageBalanceMapping,
  UsageBalanceReading,
  UsageQuotaMapping,
  UsageQuotaReading,
  UsageRateMapping,
  UsageRateReading,
  UsageRateSchedule,
  UsageReading,
  UsageReadingMapping,
  UsageWindow,
} from "@getpaseo/protocol/usage-limits/types";
import { readNumberAtPath, readAtPath, readTimestampAtPath } from "./json-path.js";

const MINUTES_PER_DAY = 24 * 60;

function clampPercent(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function readPercent(document: unknown, path: string | undefined): number | null {
  if (!path) return null;
  const value = readNumberAtPath(document, path);
  return value === null ? null : clampPercent(value);
}

function resolveWindow(mapping: UsageQuotaMapping, document: unknown): UsageWindow | null {
  if (!mapping.window) return null;
  const resetsAt = mapping.window.resetsAtPath
    ? readTimestampAtPath(document, mapping.window.resetsAtPath)
    : null;
  return { label: mapping.window.label, resetsAt };
}

interface QuotaAmounts {
  used: number | null;
  limit: number | null;
  remaining: number | null;
}

function completeQuotaAmounts(amounts: QuotaAmounts): QuotaAmounts {
  const { used, limit, remaining } = amounts;
  if (limit !== null && used !== null && remaining === null) {
    return { used, limit, remaining: limit - used };
  }
  if (limit !== null && remaining !== null && used === null) {
    return { used: limit - remaining, limit, remaining };
  }
  if (used !== null && remaining !== null && limit === null) {
    return { used, limit: used + remaining, remaining };
  }
  return amounts;
}

function deriveQuotaPercent(amounts: QuotaAmounts): number | null {
  const { used, limit } = amounts;
  if (used === null || limit === null || limit <= 0) return null;
  return clampPercent((used / limit) * 100);
}

function projectQuota(mapping: UsageQuotaMapping, document: unknown): UsageQuotaReading {
  const read = completeQuotaAmounts({
    used: mapping.usedPath ? readNumberAtPath(document, mapping.usedPath) : null,
    limit: mapping.limitPath ? readNumberAtPath(document, mapping.limitPath) : null,
    remaining: mapping.remainingPath ? readNumberAtPath(document, mapping.remainingPath) : null,
  });
  const explicitPercent = readPercent(document, mapping.percentPath);
  return {
    kind: "quota",
    id: mapping.id,
    label: mapping.label,
    group: mapping.group ?? null,
    unit: mapping.unit,
    window: resolveWindow(mapping, document),
    used: read.used,
    limit: read.limit,
    remaining: read.remaining,
    percent: explicitPercent ?? deriveQuotaPercent(read),
  };
}

function projectBalance(mapping: UsageBalanceMapping, document: unknown): UsageBalanceReading {
  const remaining = mapping.remainingPath
    ? readNumberAtPath(document, mapping.remainingPath)
    : null;
  const total = mapping.totalPath ? readNumberAtPath(document, mapping.totalPath) : null;
  const explicitPercent = readPercent(document, mapping.percentRemainingPath);
  const derivedPercent =
    remaining !== null && total !== null && total > 0
      ? clampPercent((remaining / total) * 100)
      : null;
  const currency = mapping.currencyPath ? readAtPath(document, mapping.currencyPath) : null;
  return {
    kind: "balance",
    id: mapping.id,
    label: mapping.label,
    group: mapping.group ?? null,
    unit: mapping.unit,
    remaining,
    total,
    percentRemaining: explicitPercent ?? derivedPercent,
    currency: typeof currency === "string" ? currency : null,
  };
}

function parseWallClock(value: string): number {
  const [hours, minutes] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function wallClockMinutes(now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "0";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "0";
  return Number(hour) * 60 + Number(minute);
}

function isWithin(startMinutes: number, endMinutes: number, nowMinutes: number): boolean {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function minutesUntilNextBoundary(schedule: UsageRateSchedule, nowMinutes: number): number {
  const boundaries = schedule.windows.flatMap((window) => [
    parseWallClock(window.start),
    parseWallClock(window.end),
  ]);
  const distances = boundaries.map((boundary) => {
    const delta = boundary - nowMinutes;
    return delta > 0 ? delta : delta + MINUTES_PER_DAY;
  });
  return Math.min(...distances);
}

interface ActiveRateBand {
  state: string;
  multiplier: number | null;
  detail: string | null;
}

function resolveActiveBand(schedule: UsageRateSchedule, nowMinutes: number): ActiveRateBand {
  const active = schedule.windows.find((window) =>
    isWithin(parseWallClock(window.start), parseWallClock(window.end), nowMinutes),
  );
  if (!active) {
    return {
      state: schedule.defaultLabel,
      multiplier: schedule.defaultMultiplier,
      detail: null,
    };
  }
  return {
    state: active.label,
    multiplier: active.multiplier ?? schedule.defaultMultiplier,
    detail: active.detail ?? null,
  };
}

function projectRate(mapping: UsageRateMapping, document: unknown, now: Date): UsageRateReading {
  const common = {
    kind: "rate",
    id: mapping.id,
    label: mapping.label,
    group: mapping.group ?? null,
  } as const;

  if (mapping.resolution.via === "schedule") {
    const { schedule } = mapping.resolution;
    const nowMinutes = wallClockMinutes(now, schedule.timeZone);
    const band = resolveActiveBand(schedule, nowMinutes);
    const changesAt = new Date(
      now.getTime() + minutesUntilNextBoundary(schedule, nowMinutes) * 60_000,
    );
    return { ...common, ...band, changesAt: changesAt.toISOString() };
  }

  const { statePath, multiplierPath, changesAtPath, detailPath } = mapping.resolution;
  const state = readAtPath(document, statePath);
  const detail = detailPath ? readAtPath(document, detailPath) : null;
  return {
    ...common,
    state: typeof state === "string" ? state : String(state ?? "Unknown"),
    multiplier: multiplierPath ? readNumberAtPath(document, multiplierPath) : null,
    changesAt: changesAtPath ? readTimestampAtPath(document, changesAtPath) : null,
    detail: typeof detail === "string" ? detail : null,
  };
}

export function projectReadings(
  mappings: UsageReadingMapping[],
  document: unknown,
  now: Date,
): UsageReading[] {
  return mappings.map((mapping) => {
    switch (mapping.kind) {
      case "quota":
        return projectQuota(mapping, document);
      case "balance":
        return projectBalance(mapping, document);
      case "rate":
        return projectRate(mapping, document, now);
    }
  });
}

/** A plugin whose readings are all schedule-driven never needs a request. */
export function requiresSourceDocument(mappings: UsageReadingMapping[]): boolean {
  return mappings.some(
    (mapping) => mapping.kind !== "rate" || mapping.resolution.via === "response",
  );
}
