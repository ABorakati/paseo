/**
 * Reads a value out of a parsed JSON document using dot/bracket path syntax:
 * `data.usage`, `balance_infos[0].total_balance`.
 *
 * Providers are inconsistent about whether numbers arrive as numbers or as
 * strings ("110.00"), so `readNumberAtPath` coerces. A path that does not
 * resolve is `null` — a missing field is a normal outcome, not a failure.
 */

const SEGMENT_PATTERN = /[^.[\]]+/g;

function parsePath(path: string): string[] {
  return path.match(SEGMENT_PATTERN) ?? [];
}

export function readAtPath(document: unknown, path: string): unknown {
  let current = document;
  for (const segment of parsePath(path)) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return null;
  }
  return current ?? null;
}

export function readNumberAtPath(document: unknown, path: string): number | null {
  const value = readAtPath(document, path);
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Providers express reset times as ISO strings, epoch seconds, or epoch
 * milliseconds. Normalize all three to an ISO string.
 */
export function readTimestampAtPath(document: unknown, path: string): string | null {
  const value = readAtPath(document, path);
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const EPOCH_SECONDS_CEILING = 1e11;
  const millis = value < EPOCH_SECONDS_CEILING ? value * 1000 : value;
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
