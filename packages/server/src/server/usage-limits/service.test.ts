import { describe, expect, it } from "vitest";
import type { UsageLimitPluginOverrides } from "@getpaseo/protocol/usage-limits/types";
import { createUsageLimitsService } from "./service.js";
import type { UsageLimitHttpAdapter, UsageLimitCommandAdapter } from "./source.js";

const FIXED_NOW = Date.parse("2026-03-01T12:00:00Z");

function jsonAdapter(document: unknown): UsageLimitHttpAdapter {
  return async () => ({ status: 200, body: JSON.stringify(document) });
}

function createService(params: {
  overrides: UsageLimitPluginOverrides;
  http?: UsageLimitHttpAdapter;
  command?: UsageLimitCommandAdapter;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}) {
  return createUsageLimitsService({
    overrides: params.overrides,
    http: params.http ?? jsonAdapter({}),
    command: params.command ?? (async () => "{}"),
    env: params.env ?? { API_KEY: "secret" },
    now: params.now ?? (() => FIXED_NOW),
  });
}

describe("usage limits service", () => {
  it("projects a quota reading with a window and derives the consumed percentage", async () => {
    const service = createService({
      http: jsonAdapter({
        google: { used: 250, limit: 1000, resets: "2026-03-01T17:00:00Z" },
      }),
      overrides: {
        antigravity: {
          label: "Antigravity",
          source: { kind: "http", url: "https://example.test/usage" },
          readings: [
            {
              kind: "quota",
              id: "google-5h",
              label: "5 hours",
              group: "Google models",
              unit: "requests",
              window: { label: "5 hours", resetsAtPath: "google.resets" },
              usedPath: "google.used",
              limitPath: "google.limit",
            },
          ],
        },
      },
    });

    const snapshot = await service.getSnapshot();

    expect(snapshot.plugins).toEqual([
      {
        pluginId: "antigravity",
        label: "Antigravity",
        description: null,
        providerId: null,
        status: "ok",
        error: null,
        fetchedAt: "2026-03-01T12:00:00.000Z",
        readings: [
          {
            kind: "quota",
            id: "google-5h",
            label: "5 hours",
            group: "Google models",
            unit: "requests",
            window: { label: "5 hours", resetsAt: "2026-03-01T17:00:00.000Z" },
            used: 250,
            limit: 1000,
            remaining: 750,
            percent: 25,
          },
        ],
      },
    ]);
  });

  it("reads a balance from numeric strings and reports the percentage still available", async () => {
    const service = createService({
      http: jsonAdapter({
        balance_infos: [{ currency: "USD", total_balance: "12.50", granted_balance: "50.00" }],
      }),
      overrides: {
        deepseek: {
          label: "DeepSeek",
          source: { kind: "http", url: "https://example.test/balance" },
          readings: [
            {
              kind: "balance",
              id: "balance",
              label: "Balance",
              unit: "usd",
              remainingPath: "balance_infos[0].total_balance",
              totalPath: "balance_infos[0].granted_balance",
              currencyPath: "balance_infos[0].currency",
            },
          ],
        },
      },
    });

    const [plugin] = (await service.getSnapshot()).plugins;

    expect(plugin.readings).toEqual([
      {
        kind: "balance",
        id: "balance",
        label: "Balance",
        group: null,
        unit: "usd",
        remaining: 12.5,
        total: 50,
        percentRemaining: 25,
        currency: "USD",
      },
    ]);
  });

  it("resolves a peak-pricing rate from a schedule without issuing any request", async () => {
    const service = createService({
      http: async () => {
        throw new Error("a schedule-only plugin must not make a request");
      },
      overrides: {
        pricing: {
          label: "DeepSeek pricing",
          readings: [
            {
              kind: "rate",
              id: "band",
              label: "Pricing",
              resolution: {
                via: "schedule",
                schedule: {
                  timeZone: "UTC",
                  windows: [{ label: "Off-peak", start: "16:30", end: "00:30", multiplier: 0.5 }],
                  defaultLabel: "Standard",
                  defaultMultiplier: 1,
                },
              },
            },
          ],
        },
      },
    });

    const [plugin] = (await service.getSnapshot()).plugins;

    expect(plugin.status).toBe("ok");
    expect(plugin.readings).toEqual([
      {
        kind: "rate",
        id: "band",
        label: "Pricing",
        group: null,
        state: "Standard",
        multiplier: 1,
        changesAt: "2026-03-01T16:30:00.000Z",
        detail: null,
      },
    ]);
  });

  it("reports a missing environment variable instead of sending an empty credential", async () => {
    const service = createService({
      env: {},
      overrides: {
        deepseek: {
          preset: "deepseek",
        },
      },
    });

    const [plugin] = (await service.getSnapshot()).plugins;

    expect(plugin.status).toBe("error");
    expect(plugin.error).toBe(
      "Environment variable DEEPSEEK_API_KEY is not set — set it in the daemon's environment",
    );
  });

  it("reports an unknown preset as a plugin error rather than dropping the entry", async () => {
    const service = createService({
      overrides: { mystery: { preset: "does-not-exist" } },
    });

    const [plugin] = (await service.getSnapshot()).plugins;

    expect(plugin).toEqual({
      pluginId: "mystery",
      label: "mystery",
      description: null,
      providerId: null,
      status: "error",
      readings: [],
      error: 'Unknown preset "does-not-exist"',
      fetchedAt: null,
    });
  });

  it("serves a cached snapshot within the refresh interval and refetches on refresh", async () => {
    let calls = 0;
    const service = createService({
      http: async () => {
        calls += 1;
        return { status: 200, body: JSON.stringify({ used: calls }) };
      },
      overrides: {
        counter: {
          label: "Counter",
          refreshIntervalMs: 60_000,
          source: { kind: "http", url: "https://example.test/usage" },
          readings: [
            { kind: "quota", id: "used", label: "Used", unit: "requests", usedPath: "used" },
          ],
        },
      },
    });

    await service.getSnapshot();
    await service.getSnapshot();
    expect(calls).toBe(1);

    await service.refresh("counter");
    expect(calls).toBe(2);
  });

  it("parses JSON printed by a command source", async () => {
    const service = createService({
      command: async (request) => {
        expect(request.command).toEqual(["opencode", "usage", "--json"]);
        return JSON.stringify({ credits: { left: 4 } });
      },
      overrides: {
        opencode: {
          label: "OpenCode",
          source: { kind: "command", command: ["opencode", "usage", "--json"] },
          readings: [
            {
              kind: "balance",
              id: "credits",
              label: "Credits",
              unit: "credits",
              remainingPath: "credits.left",
            },
          ],
        },
      },
    });

    const [plugin] = (await service.getSnapshot()).plugins;

    expect(plugin.status).toBe("ok");
    expect(plugin.readings[0]).toMatchObject({ kind: "balance", remaining: 4 });
  });

  it("reports a non-2xx response as a plugin error", async () => {
    const service = createService({
      http: async () => ({ status: 401, body: "unauthorized" }),
      overrides: {
        broken: {
          label: "Broken",
          source: { kind: "http", url: "https://example.test/usage" },
          readings: [
            { kind: "quota", id: "used", label: "Used", unit: "requests", usedPath: "used" },
          ],
        },
      },
    });

    const [plugin] = (await service.getSnapshot()).plugins;

    expect(plugin.status).toBe("error");
    expect(plugin.error).toBe("Request failed with HTTP 401");
  });

  it("marks a disabled plugin without fetching it", async () => {
    const service = createService({
      http: async () => {
        throw new Error("a disabled plugin must not be fetched");
      },
      overrides: { deepseek: { preset: "deepseek", enabled: false } },
    });

    const [plugin] = (await service.getSnapshot()).plugins;

    expect(plugin.status).toBe("disabled");
    expect(plugin.readings).toEqual([]);
  });
});
