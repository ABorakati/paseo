import type { UsageLimitSource } from "@getpaseo/protocol/usage-limits/types";
import { execCommand } from "../../utils/spawn.js";
import { UsageLimitSourceError } from "./errors.js";
import { interpolateEnv, interpolateEnvDeep } from "./interpolate.js";

const REQUEST_TIMEOUT_MS = 20_000;

export interface UsageLimitHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string | null;
}

export interface UsageLimitHttpResponse {
  status: number;
  body: string;
}

export type UsageLimitHttpAdapter = (
  request: UsageLimitHttpRequest,
  signal: AbortSignal,
) => Promise<UsageLimitHttpResponse>;

export interface UsageLimitCommandRequest {
  command: string[];
  cwd: string | undefined;
}

export type UsageLimitCommandAdapter = (request: UsageLimitCommandRequest) => Promise<string>;

export const fetchHttpSource: UsageLimitHttpAdapter = async (request, signal) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal,
  });
  return { status: response.status, body: await response.text() };
};

export const runCommandSource: UsageLimitCommandAdapter = async (request) => {
  const [command, ...args] = request.command;
  const result = await execCommand(command, args, {
    cwd: request.cwd,
    timeout: REQUEST_TIMEOUT_MS,
  });
  return result.stdout;
};

export interface UsageLimitSourceDeps {
  http: UsageLimitHttpAdapter;
  command: UsageLimitCommandAdapter;
  env: NodeJS.ProcessEnv;
}

function parseJsonDocument(raw: string, pluginId: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new UsageLimitSourceError("Source did not return valid JSON", pluginId);
  }
}

async function readHttpDocument(
  source: Extract<UsageLimitSource, { kind: "http" }>,
  pluginId: string,
  deps: UsageLimitSourceDeps,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await deps.http(
      {
        url: interpolateEnv(source.url, deps.env),
        method: source.method,
        headers: interpolateEnvDeep(source.headers, deps.env),
        body: source.body === undefined ? null : JSON.stringify(source.body),
      },
      controller.signal,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new UsageLimitSourceError(`Request failed with HTTP ${response.status}`, pluginId);
    }
    return parseJsonDocument(response.body, pluginId);
  } finally {
    clearTimeout(timer);
  }
}

async function readCommandDocument(
  source: Extract<UsageLimitSource, { kind: "command" }>,
  pluginId: string,
  deps: UsageLimitSourceDeps,
): Promise<unknown> {
  const command = interpolateEnvDeep(source.command, deps.env);
  const stdout = await deps.command({ command, cwd: source.cwd });
  return parseJsonDocument(stdout, pluginId);
}

export function readSourceDocument(
  source: UsageLimitSource,
  pluginId: string,
  deps: UsageLimitSourceDeps,
): Promise<unknown> {
  if (source.kind === "http") {
    return readHttpDocument(source, pluginId, deps);
  }
  return readCommandDocument(source, pluginId, deps);
}
