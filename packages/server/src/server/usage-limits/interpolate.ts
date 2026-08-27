import { UsageLimitEnvVarMissingError } from "./errors.js";

const ENV_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Expands `${VAR}` against the daemon's environment so API keys stay out of
 * config.json. An unset variable throws rather than expanding to an empty
 * string — silently sending an empty credential produces a confusing 401
 * instead of a legible "set DEEPSEEK_API_KEY".
 */
export function interpolateEnv(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(ENV_REFERENCE_PATTERN, (_match, variableName: string) => {
    const resolved = env[variableName];
    if (resolved === undefined || resolved === "") {
      throw new UsageLimitEnvVarMissingError(variableName);
    }
    return resolved;
  });
}

export function interpolateEnvDeep<T>(value: T, env: NodeJS.ProcessEnv): T {
  if (typeof value === "string") {
    return interpolateEnv(value, env) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => interpolateEnvDeep(entry, env)) as T;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const interpolated = entries.map(([key, entry]) => [key, interpolateEnvDeep(entry, env)]);
    return Object.fromEntries(interpolated) as T;
  }
  return value;
}
