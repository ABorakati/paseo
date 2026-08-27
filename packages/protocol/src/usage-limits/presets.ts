import type { UsageLimitPlugin } from "./types.js";

/**
 * Built-in plugin definitions. A preset is nothing more than a pre-filled
 * `UsageLimitPlugin` — a user enables one by naming it in config.json and
 * supplying credentials, and can override any field on top of it.
 *
 * Only endpoints backed by published, stable provider documentation live here.
 * Everything else belongs in the user's own config; see docs/usage-limits.md
 * for worked templates.
 */
export const USAGE_LIMIT_PRESETS: Record<string, UsageLimitPlugin> = {
  deepseek: {
    label: "DeepSeek",
    description: "Prepaid API balance",
    providerId: "deepseek",
    enabled: true,
    refreshIntervalMs: 300_000,
    source: {
      kind: "http",
      url: "https://api.deepseek.com/user/balance",
      method: "GET",
      headers: { Authorization: "Bearer ${DEEPSEEK_API_KEY}" },
    },
    readings: [
      {
        kind: "balance",
        id: "balance",
        label: "Balance",
        unit: "usd",
        remainingPath: "balance_infos[0].total_balance",
        currencyPath: "balance_infos[0].currency",
      },
      {
        kind: "balance",
        id: "granted",
        label: "Granted credit",
        unit: "usd",
        remainingPath: "balance_infos[0].granted_balance",
        currencyPath: "balance_infos[0].currency",
      },
    ],
  },
  openrouter: {
    label: "OpenRouter",
    description: "Credit usage for the current API key",
    providerId: "openrouter",
    enabled: true,
    refreshIntervalMs: 300_000,
    source: {
      kind: "http",
      url: "https://openrouter.ai/api/v1/key",
      method: "GET",
      headers: { Authorization: "Bearer ${OPENROUTER_API_KEY}" },
    },
    readings: [
      {
        kind: "quota",
        id: "credits",
        label: "Credits",
        unit: "usd",
        usedPath: "data.usage",
        limitPath: "data.limit",
      },
    ],
  },
};

export function getUsageLimitPreset(presetId: string): UsageLimitPlugin | undefined {
  return USAGE_LIMIT_PRESETS[presetId];
}

export const USAGE_LIMIT_PRESET_IDS = Object.keys(USAGE_LIMIT_PRESETS);
