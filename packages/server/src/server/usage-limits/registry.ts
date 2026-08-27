import {
  UsageLimitPluginSchema,
  type UsageLimitPlugin,
  type UsageLimitPluginOverride,
  type UsageLimitPluginOverrides,
} from "@getpaseo/protocol/usage-limits/types";
import { getUsageLimitPreset } from "@getpaseo/protocol/usage-limits/presets";

/**
 * A config entry either resolves into a complete plugin or it doesn't. An entry
 * that names a missing preset, or that a user has half-filled, becomes an
 * `invalid` entry so the UI can show why instead of the plugin vanishing.
 */
export type UsageLimitPluginEntry =
  | { kind: "resolved"; id: string; plugin: UsageLimitPlugin }
  | { kind: "invalid"; id: string; label: string; error: string };

function mergeOverrideOntoPreset(
  preset: UsageLimitPlugin,
  override: UsageLimitPluginOverride,
): UsageLimitPlugin {
  return {
    ...preset,
    ...(override.label === undefined ? {} : { label: override.label }),
    ...(override.description === undefined ? {} : { description: override.description }),
    ...(override.providerId === undefined ? {} : { providerId: override.providerId }),
    ...(override.enabled === undefined ? {} : { enabled: override.enabled }),
    ...(override.refreshIntervalMs === undefined
      ? {}
      : { refreshIntervalMs: override.refreshIntervalMs }),
    ...(override.source === undefined ? {} : { source: override.source }),
    ...(override.readings === undefined ? {} : { readings: override.readings }),
  };
}

function resolveEntry(id: string, override: UsageLimitPluginOverride): UsageLimitPluginEntry {
  if (override.preset) {
    const preset = getUsageLimitPreset(override.preset);
    if (!preset) {
      return {
        kind: "invalid",
        id,
        label: override.label ?? id,
        error: `Unknown preset "${override.preset}"`,
      };
    }
    return { kind: "resolved", id, plugin: mergeOverrideOntoPreset(preset, override) };
  }

  const parsed = UsageLimitPluginSchema.safeParse(override);
  if (!parsed.success) {
    return {
      kind: "invalid",
      id,
      label: override.label ?? id,
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  return { kind: "resolved", id, plugin: parsed.data };
}

export function buildUsageLimitPluginRegistry(
  overrides: UsageLimitPluginOverrides,
): UsageLimitPluginEntry[] {
  const entries = Object.entries(overrides).map(([id, override]) => resolveEntry(id, override));
  return entries.sort((left, right) => left.id.localeCompare(right.id));
}
