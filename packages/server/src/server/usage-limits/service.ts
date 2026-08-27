import type {
  UsageLimitPlugin,
  UsageLimitPluginOverrides,
  UsageLimitPluginSnapshot,
  UsageLimitsSnapshot,
} from "@getpaseo/protocol/usage-limits/types";
import { UsageLimitEnvVarMissingError, UsageLimitPluginNotFoundError } from "./errors.js";
import { projectReadings, requiresSourceDocument } from "./readings.js";
import {
  fetchHttpSource,
  readSourceDocument,
  runCommandSource,
  type UsageLimitCommandAdapter,
  type UsageLimitHttpAdapter,
} from "./source.js";
import { buildUsageLimitPluginRegistry, type UsageLimitPluginEntry } from "./registry.js";

export interface UsageLimitsService {
  getSnapshot(): Promise<UsageLimitsSnapshot>;
  refresh(pluginId?: string): Promise<UsageLimitsSnapshot>;
}

export interface CreateUsageLimitsServiceOptions {
  overrides: UsageLimitPluginOverrides;
  http?: UsageLimitHttpAdapter;
  command?: UsageLimitCommandAdapter;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

interface CacheEntry {
  snapshot: UsageLimitPluginSnapshot;
  expiresAt: number;
}

function describeError(error: unknown): string {
  if (error instanceof UsageLimitEnvVarMissingError) {
    return `${error.message} — set it in the daemon's environment`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createUsageLimitsService(
  options: CreateUsageLimitsServiceOptions,
): UsageLimitsService {
  const deps = {
    http: options.http ?? fetchHttpSource,
    command: options.command ?? runCommandSource,
    env: options.env ?? process.env,
  };
  const now = options.now ?? Date.now;

  const registry = buildUsageLimitPluginRegistry(options.overrides);
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<UsageLimitPluginSnapshot>>();

  function baseSnapshot(id: string, plugin: UsageLimitPlugin): UsageLimitPluginSnapshot {
    return {
      pluginId: id,
      label: plugin.label,
      description: plugin.description ?? null,
      providerId: plugin.providerId ?? null,
      status: "ok",
      readings: [],
      error: null,
      fetchedAt: null,
    };
  }

  async function loadPlugin(
    id: string,
    plugin: UsageLimitPlugin,
  ): Promise<UsageLimitPluginSnapshot> {
    const snapshot = baseSnapshot(id, plugin);
    const timestamp = new Date(now());
    const needsDocument = requiresSourceDocument(plugin.readings);
    try {
      if (needsDocument && !plugin.source) {
        throw new Error("Plugin reads from a response but declares no source");
      }
      const document = plugin.source
        ? await readSourceDocument(plugin.source, id, deps)
        : undefined;
      return {
        ...snapshot,
        readings: projectReadings(plugin.readings, document, timestamp),
        fetchedAt: timestamp.toISOString(),
      };
    } catch (error) {
      return {
        ...snapshot,
        status: "error",
        error: describeError(error),
        fetchedAt: timestamp.toISOString(),
      };
    }
  }

  function cachedPluginSnapshot(
    id: string,
    plugin: UsageLimitPlugin,
    force: boolean,
  ): Promise<UsageLimitPluginSnapshot> {
    const cached = cache.get(id);
    if (!force && cached && cached.expiresAt > now()) {
      return Promise.resolve(cached.snapshot);
    }
    const existing = inFlight.get(id);
    if (existing) return existing;

    const request = loadPlugin(id, plugin)
      .then((snapshot) => {
        cache.set(id, { snapshot, expiresAt: now() + plugin.refreshIntervalMs });
        return snapshot;
      })
      .finally(() => {
        if (inFlight.get(id) === request) inFlight.delete(id);
      });
    inFlight.set(id, request);
    return request;
  }

  function entrySnapshot(
    entry: UsageLimitPluginEntry,
    forcedPluginId: string | undefined,
    forceAll: boolean,
  ): Promise<UsageLimitPluginSnapshot> {
    if (entry.kind === "invalid") {
      return Promise.resolve({
        pluginId: entry.id,
        label: entry.label,
        description: null,
        providerId: null,
        status: "error",
        readings: [],
        error: entry.error,
        fetchedAt: null,
      });
    }
    if (!entry.plugin.enabled) {
      return Promise.resolve({ ...baseSnapshot(entry.id, entry.plugin), status: "disabled" });
    }
    const force = forceAll || forcedPluginId === entry.id;
    return cachedPluginSnapshot(entry.id, entry.plugin, force);
  }

  async function collect(
    forcedPluginId: string | undefined,
    forceAll: boolean,
  ): Promise<UsageLimitsSnapshot> {
    const plugins = await Promise.all(
      registry.map((entry) => entrySnapshot(entry, forcedPluginId, forceAll)),
    );
    return { plugins };
  }

  return {
    getSnapshot() {
      return collect(undefined, false);
    },
    refresh(pluginId) {
      if (pluginId !== undefined && !registry.some((entry) => entry.id === pluginId)) {
        throw new UsageLimitPluginNotFoundError(pluginId);
      }
      return collect(pluginId, pluginId === undefined);
    },
  };
}
