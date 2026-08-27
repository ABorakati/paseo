export class UsageLimitEnvVarMissingError extends Error {
  constructor(readonly variableName: string) {
    super(`Environment variable ${variableName} is not set`);
    this.name = "UsageLimitEnvVarMissingError";
  }
}

export class UsageLimitSourceError extends Error {
  constructor(
    message: string,
    readonly pluginId: string,
  ) {
    super(message);
    this.name = "UsageLimitSourceError";
  }
}

export class UsageLimitPluginNotFoundError extends Error {
  constructor(readonly pluginId: string) {
    super(`No usage limit plugin named "${pluginId}"`);
    this.name = "UsageLimitPluginNotFoundError";
  }
}

export class UsageLimitPresetNotFoundError extends Error {
  constructor(
    readonly pluginId: string,
    readonly presetId: string,
  ) {
    super(`Usage limit plugin "${pluginId}" names unknown preset "${presetId}"`);
    this.name = "UsageLimitPresetNotFoundError";
  }
}
