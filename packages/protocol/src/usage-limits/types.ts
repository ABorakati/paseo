import { z } from "zod";

/**
 * A usage-limit plugin describes, declaratively, how to read quota state out of
 * some provider: where to get a JSON document (HTTP endpoint or local command),
 * and which paths inside that document carry the used/limit/reset values.
 *
 * Everything is data so a user can add a provider Paseo has never heard of —
 * an Antigravity subscription, a DeepSeek balance, an OpenCode Zen key — by
 * editing config.json instead of shipping code.
 *
 * Providers do not all measure the same thing, so a plugin reports a list of
 * readings in one of three shapes:
 *   - `quota`   — used against a ceiling inside a resetting window (Antigravity's
 *                 5-hour and weekly buckets, per model family).
 *   - `balance` — money or credits left, optionally against a starting total so
 *                 a percentage is meaningful (DeepSeek, OpenRouter).
 *   - `rate`    — which pricing band is in force right now (peak vs off-peak)
 *                 and when it changes.
 */

export const USAGE_LIMIT_PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const UsageLimitUnitSchema = z.enum(["tokens", "requests", "credits", "usd", "percent"]);

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const UsageLimitHttpSourceSchema = z.object({
  kind: z.literal("http"),
  url: z.string().min(1),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string(), z.string()).default({}),
  /** JSON request body, serialized as-is. Only meaningful for POST. */
  body: z.unknown().optional(),
});

export const UsageLimitCommandSourceSchema = z.object({
  kind: z.literal("command"),
  /** argv; the command must print a single JSON document on stdout. */
  command: z.array(z.string().min(1)).min(1),
  cwd: z.string().min(1).optional(),
});

export const UsageLimitSourceSchema = z.discriminatedUnion("kind", [
  UsageLimitHttpSourceSchema,
  UsageLimitCommandSourceSchema,
]);

// ---------------------------------------------------------------------------
// Reading mappings (config side)
// ---------------------------------------------------------------------------

/** Names the resetting window a quota belongs to: "5 hours", "Weekly". */
export const UsageWindowMappingSchema = z.object({
  label: z.string().min(1),
  resetsAtPath: z.string().min(1).optional(),
});

const UsageReadingCommonSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /**
   * Groups readings inside one plugin — Antigravity reports separate buckets
   * for Google and non-Google models, and each has its own windows.
   */
  group: z.string().min(1).optional(),
});

export const UsageQuotaMappingSchema = UsageReadingCommonSchema.extend({
  kind: z.literal("quota"),
  unit: UsageLimitUnitSchema,
  window: UsageWindowMappingSchema.optional(),
  usedPath: z.string().min(1).optional(),
  limitPath: z.string().min(1).optional(),
  remainingPath: z.string().min(1).optional(),
  percentPath: z.string().min(1).optional(),
});

export const UsageBalanceMappingSchema = UsageReadingCommonSchema.extend({
  kind: z.literal("balance"),
  unit: UsageLimitUnitSchema,
  remainingPath: z.string().min(1).optional(),
  /** Starting balance, so a percentage remaining can be shown. */
  totalPath: z.string().min(1).optional(),
  percentRemainingPath: z.string().min(1).optional(),
  currencyPath: z.string().min(1).optional(),
});

/** One band in a peak/off-peak pricing schedule. Times are `HH:MM` wall clock. */
export const UsageRateWindowSchema = z.object({
  label: z.string().min(1),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  multiplier: z.number().positive().optional(),
  detail: z.string().min(1).optional(),
});

export const UsageRateScheduleSchema = z.object({
  /** IANA zone the `start`/`end` times are expressed in. */
  timeZone: z.string().min(1).default("UTC"),
  windows: z.array(UsageRateWindowSchema).min(1),
  /** Applies whenever no window is active. */
  defaultLabel: z.string().min(1).default("Standard"),
  defaultMultiplier: z.number().positive().default(1),
});

export const UsageRateResolutionSchema = z.discriminatedUnion("via", [
  z.object({ via: z.literal("schedule"), schedule: UsageRateScheduleSchema }),
  z.object({
    via: z.literal("response"),
    statePath: z.string().min(1),
    multiplierPath: z.string().min(1).optional(),
    changesAtPath: z.string().min(1).optional(),
    detailPath: z.string().min(1).optional(),
  }),
]);

export const UsageRateMappingSchema = UsageReadingCommonSchema.extend({
  kind: z.literal("rate"),
  resolution: UsageRateResolutionSchema,
});

export const UsageReadingMappingSchema = z.discriminatedUnion("kind", [
  UsageQuotaMappingSchema,
  UsageBalanceMappingSchema,
  UsageRateMappingSchema,
]);

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export const UsageLimitPluginSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  /** Links this plugin to an `agents.providers` entry so the UI can share its icon. */
  providerId: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  refreshIntervalMs: z.number().int().min(30_000).max(86_400_000).default(300_000),
  /** Omit when every reading is schedule-driven and needs no request. */
  source: UsageLimitSourceSchema.optional(),
  readings: z.array(UsageReadingMappingSchema).min(1),
});

/**
 * config.json shape. A user entry either defines a plugin outright, or names a
 * built-in preset with `preset` and overrides only what it needs (usually just
 * the credentials in `headers`).
 */
export const UsageLimitPluginOverrideSchema = z.object({
  preset: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  refreshIntervalMs: z.number().int().min(30_000).max(86_400_000).optional(),
  source: UsageLimitSourceSchema.optional(),
  readings: z.array(UsageReadingMappingSchema).min(1).optional(),
});

export const UsageLimitPluginOverridesSchema = z
  .record(z.string(), UsageLimitPluginOverrideSchema)
  .superRefine((overrides, ctx) => {
    for (const [id, override] of Object.entries(overrides)) {
      if (!USAGE_LIMIT_PLUGIN_ID_PATTERN.test(id)) {
        ctx.addIssue({
          code: "custom",
          path: [id],
          message: `Usage limit plugin id "${id}" must be lowercase alphanumeric with hyphens`,
        });
        continue;
      }
      if (override.preset) continue;
      if (!override.label) {
        ctx.addIssue({
          code: "custom",
          path: [id],
          message: `Usage limit plugin "${id}" needs either "preset" or "label"`,
        });
      }
      if (!override.readings) {
        ctx.addIssue({
          code: "custom",
          path: [id],
          message: `Usage limit plugin "${id}" needs either "preset" or "readings"`,
        });
      }
    }
  });

export const UsageLimitsConfigSchema = z.object({
  plugins: UsageLimitPluginOverridesSchema.default({}),
});

// ---------------------------------------------------------------------------
// Resolved readings (wire side)
// ---------------------------------------------------------------------------

export const UsageWindowSchema = z.object({
  label: z.string(),
  resetsAt: z.string().nullable(),
});

const UsageReadingCommonOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  group: z.string().nullable(),
});

export const UsageQuotaReadingSchema = UsageReadingCommonOutputSchema.extend({
  kind: z.literal("quota"),
  unit: UsageLimitUnitSchema,
  window: UsageWindowSchema.nullable(),
  used: z.number().nullable(),
  limit: z.number().nullable(),
  remaining: z.number().nullable(),
  /** 0-100 consumed, from `percentPath` or derived from whichever pair resolved. */
  percent: z.number().nullable(),
});

export const UsageBalanceReadingSchema = UsageReadingCommonOutputSchema.extend({
  kind: z.literal("balance"),
  unit: UsageLimitUnitSchema,
  remaining: z.number().nullable(),
  total: z.number().nullable(),
  /**
   * 0-100 of the starting balance still available. Named apart from a quota's
   * `percent` because it runs the other way: a quota's percent is consumption,
   * so it climbs toward trouble, while this one drains toward it.
   */
  percentRemaining: z.number().nullable(),
  currency: z.string().nullable(),
});

export const UsageRateReadingSchema = UsageReadingCommonOutputSchema.extend({
  kind: z.literal("rate"),
  state: z.string(),
  multiplier: z.number().nullable(),
  changesAt: z.string().nullable(),
  detail: z.string().nullable(),
});

export const UsageReadingSchema = z.discriminatedUnion("kind", [
  UsageQuotaReadingSchema,
  UsageBalanceReadingSchema,
  UsageRateReadingSchema,
]);

export const UsageLimitPluginStatusSchema = z.enum(["ok", "error", "disabled"]);

export const UsageLimitPluginSnapshotSchema = z.object({
  pluginId: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  providerId: z.string().nullable(),
  status: UsageLimitPluginStatusSchema,
  readings: z.array(UsageReadingSchema),
  error: z.string().nullable(),
  fetchedAt: z.string().nullable(),
});

export const UsageLimitsSnapshotSchema = z.object({
  plugins: z.array(UsageLimitPluginSnapshotSchema),
});

export type UsageLimitUnit = z.infer<typeof UsageLimitUnitSchema>;
export type UsageLimitSource = z.infer<typeof UsageLimitSourceSchema>;
export type UsageWindowMapping = z.infer<typeof UsageWindowMappingSchema>;
export type UsageQuotaMapping = z.infer<typeof UsageQuotaMappingSchema>;
export type UsageBalanceMapping = z.infer<typeof UsageBalanceMappingSchema>;
export type UsageRateWindow = z.infer<typeof UsageRateWindowSchema>;
export type UsageRateSchedule = z.infer<typeof UsageRateScheduleSchema>;
export type UsageRateMapping = z.infer<typeof UsageRateMappingSchema>;
export type UsageReadingMapping = z.infer<typeof UsageReadingMappingSchema>;
export type UsageLimitPlugin = z.infer<typeof UsageLimitPluginSchema>;
export type UsageLimitPluginOverride = z.infer<typeof UsageLimitPluginOverrideSchema>;
export type UsageLimitPluginOverrides = z.infer<typeof UsageLimitPluginOverridesSchema>;
export type UsageLimitsConfig = z.infer<typeof UsageLimitsConfigSchema>;
export type UsageWindow = z.infer<typeof UsageWindowSchema>;
export type UsageQuotaReading = z.infer<typeof UsageQuotaReadingSchema>;
export type UsageBalanceReading = z.infer<typeof UsageBalanceReadingSchema>;
export type UsageRateReading = z.infer<typeof UsageRateReadingSchema>;
export type UsageReading = z.infer<typeof UsageReadingSchema>;
export type UsageLimitPluginStatus = z.infer<typeof UsageLimitPluginStatusSchema>;
export type UsageLimitPluginSnapshot = z.infer<typeof UsageLimitPluginSnapshotSchema>;
export type UsageLimitsSnapshot = z.infer<typeof UsageLimitsSnapshotSchema>;
