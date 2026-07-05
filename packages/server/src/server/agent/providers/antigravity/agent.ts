import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Logger } from "pino";

import {
  type AgentCapabilityFlags,
  type AgentClient,
  type AgentFeature,
  type AgentLaunchContext,
  type AgentMode,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPersistenceHandle,
  type AgentPromptInput,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRuntimeInfo,
  type AgentSession,
  type AgentSessionConfig,
  type AgentStreamEvent,
  type FetchCatalogOptions,
  type ProviderCatalog,
} from "../../agent-sdk-types.js";
import { spawnProcess } from "../../../../utils/spawn.js";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { renderPromptAttachmentAsText } from "../../prompt-attachments.js";
import { runProviderTurn } from "../provider-runner.js";
import { getAntigravityModels } from "./models.js";

const ANTIGRAVITY_PROVIDER = "antigravity";
const ANTIGRAVITY_DEFAULT_BINARY = "agy";

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: false,
  supportsSessionListing: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

const ANTIGRAVITY_SETTINGS_PATH = join(homedir(), ".gemini", "antigravity-cli", "settings.json");

function writeAntigravityModelSelection(label: string): void {
  const settingsPath = ANTIGRAVITY_SETTINGS_PATH;
  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore corrupt JSON
    }
  }
  existing.model = label;
  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(existing, null, 2)}\n`);
  } catch {
    // ignore write errors
  }
}

function isAntigravityAuthFailureText(text: string): boolean {
  const value = String(text || "");
  if (!value.trim()) return false;
  return (
    /authentication required.*please visit/i.test(value) ||
    /authentication timed out/i.test(value) ||
    /not logged into antigravity/i.test(value) ||
    /accounts\.google\.com\/o\/oauth2\/auth.*antigravity/i.test(value)
  );
}

function convertPromptInput(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }
  const textParts: string[] = [];
  for (const block of prompt) {
    if (block.type === "text") {
      textParts.push(block.text);
      continue;
    }
    if (block.type === "image") {
      // Antigravity does not support images in print mode, skip
      continue;
    }
    textParts.push(renderPromptAttachmentAsText(block));
  }
  return textParts.join("\n\n");
}

export class AntigravityAgentClient implements AgentClient {
  readonly provider = ANTIGRAVITY_PROVIDER;
  readonly capabilities = CAPABILITIES;

  constructor(
    private readonly logger: Logger,
    private readonly runtimeSettings?: ProviderRuntimeSettings,
  ) {}

  async isAvailable(): Promise<boolean> {
    const launch = await this.resolveConfiguredLaunch();
    const availability = await checkProviderLaunchAvailable(launch);
    return availability.available;
  }

  async fetchCatalog(_options: FetchCatalogOptions): Promise<ProviderCatalog> {
    return {
      models: getAntigravityModels(),
      modes: [],
    };
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    return {
      diagnostic: "Google Antigravity provider: CLI adapter wrapper.",
    };
  }

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return new AntigravityAgentSession({
      config,
      logger: this.logger,
      runtimeSettings: this.runtimeSettings,
    });
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    _overrides?: Partial<AgentSessionConfig>,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    throw new Error("Google Antigravity provider does not support session persistence.");
  }

  private async resolveConfiguredLaunch() {
    return resolveProviderLaunch({
      commandConfig: this.runtimeSettings?.command,
      defaultBinary: ANTIGRAVITY_DEFAULT_BINARY,
    });
  }
}

class AntigravityAgentSession implements AgentSession {
  readonly provider = ANTIGRAVITY_PROVIDER;
  readonly capabilities = CAPABILITIES;
  readonly features: AgentFeature[] = [];

  private readonly config: AgentSessionConfig;
  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly history: Array<{ role: "user" | "assistant"; content: string }> = [];

  private activeTurnId: string | null = null;
  private closed = false;

  constructor(options: {
    config: AgentSessionConfig;
    logger: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
  }) {
    this.config = options.config;
    this.logger = options.logger.child({
      provider: ANTIGRAVITY_PROVIDER,
      sessionId: this.id ?? "none",
    });
    this.runtimeSettings = options.runtimeSettings;
  }

  get id(): string | null {
    // Stateless adapter, return a synthetic sessionId
    return null;
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (p, o) => this.startTurn(p, o),
      subscribe: (callback) => this.subscribe(callback),
      getSessionId: () => this.id ?? "antigravity-session",
      reduceFinalText: ({ current, item }) =>
        item.type === "assistant_message" ? `${current}${item.text}` : current,
    });
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.closed) {
      throw new Error("Session is closed");
    }
    if (this.activeTurnId) {
      throw new Error("A turn is already active");
    }

    const turnId = randomUUID();
    this.activeTurnId = turnId;

    const textPrompt = convertPromptInput(prompt);
    this.history.push({ role: "user", content: textPrompt });

    this.emit({
      type: "turn_started",
      provider: ANTIGRAVITY_PROVIDER,
      turnId,
    });

    this.emit({
      type: "timeline",
      provider: ANTIGRAVITY_PROVIDER,
      turnId,
      item: {
        type: "user_message",
        text: textPrompt,
      },
    });

    void this.executeAgy(textPrompt, turnId)
      .catch((error) => {
        this.emit({
          type: "turn_failed",
          provider: ANTIGRAVITY_PROVIDER,
          turnId,
          error: error.message || String(error),
        });
      })
      .finally(() => {
        if (this.activeTurnId === turnId) {
          this.activeTurnId = null;
        }
      });

    return { turnId };
  }

  private async executeAgy(textPrompt: string, turnId: string): Promise<void> {
    // 1. Resolve configured command & model selection
    const launch = await resolveProviderLaunch({
      commandConfig: this.runtimeSettings?.command,
      defaultBinary: ANTIGRAVITY_DEFAULT_BINARY,
    });

    const selectedModel = this.config.model;
    if (selectedModel && selectedModel !== "default") {
      writeAntigravityModelSelection(selectedModel);
    }

    // 2. Composed prompt history (Stateless context injection)
    let composedPrompt = "";
    if (this.history.length === 1) {
      composedPrompt = textPrompt;
    } else {
      const lines: string[] = [];
      for (const msg of this.history) {
        lines.push(`## ${msg.role}`);
        lines.push(msg.content);
        lines.push("");
      }
      composedPrompt = lines.join("\n").trim();
    }

    // 3. Spawning agy CLI print mode with log file redirection
    const tempLogFile = join(tmpdir(), `paseo-agy-${turnId}.log`);
    const args = [...launch.args, "-p", "--log-file", tempLogFile, "-"];

    const child = spawnProcess(launch.command, args, {
      cwd: this.config.cwd,
      envOverlay: this.runtimeSettings?.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error("Antigravity process was spawned without stdio streams");
    }

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let streamingStarted = false;
    let isAuthFailed = false;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (isAuthFailed) return;
      stdoutBuffer += text;

      if (!streamingStarted) {
        if (isAntigravityAuthFailureText(stdoutBuffer)) {
          isAuthFailed = true;
          return;
        }

        // Wait to be sure we are not facing an auth failure
        if (
          stdoutBuffer.length >= 128 ||
          stdoutBuffer.includes("\n") ||
          !/^[auwe]/i.test(stdoutBuffer)
        ) {
          streamingStarted = true;
          this.emit({
            type: "timeline",
            provider: ANTIGRAVITY_PROVIDER,
            turnId,
            item: {
              type: "assistant_message",
              text: stdoutBuffer,
            },
          });
        }
      } else {
        this.emit({
          type: "timeline",
          provider: ANTIGRAVITY_PROVIDER,
          turnId,
          item: {
            type: "assistant_message",
            text,
          },
        });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      if (!child.stdin) {
        reject(new Error("Stdin is not writable"));
        return;
      }
      child.stdin.write(composedPrompt);
      child.stdin.end();

      child.on("error", reject);

      child.on("close", (code, signal) => {
        if (!streamingStarted && !isAuthFailed && stdoutBuffer.length > 0) {
          streamingStarted = true;
          this.emit({
            type: "timeline",
            provider: ANTIGRAVITY_PROVIDER,
            turnId,
            item: {
              type: "assistant_message",
              text: stdoutBuffer,
            },
          });
        }

        let logContent = "";
        try {
          if (existsSync(tempLogFile)) {
            logContent = readFileSync(tempLogFile, "utf8");
          }
        } catch {
          // ignore
        }

        try {
          if (existsSync(tempLogFile)) {
            rmSync(tempLogFile, { force: true });
          }
        } catch {
          // ignore
        }

        const isQuota = /RESOURCE_EXHAUSTED|Individual quota reached/i.test(logContent);
        const isAuthLog =
          /not logged into antigravity|error getting token source/i.test(logContent) ||
          isAuthFailed ||
          isAntigravityAuthFailureText(stdoutBuffer);

        if (isAuthLog) {
          this.emit({
            type: "turn_failed",
            provider: ANTIGRAVITY_PROVIDER,
            turnId,
            error:
              "Antigravity needs to sign in. The agy CLI's keyring entry has expired or been cleared, and print mode cannot complete OAuth on its own.\n\nFix: open a terminal and run `agy` once — it will open Google sign-in in your browser, accept the redirect, and store the token in your system keyring. After you finish, return here and retry this chat. You only need to do this once; the keyring entry persists across both terminal and Paseo runs.",
          });
          resolve();
          return;
        }

        if (isQuota) {
          this.emit({
            type: "turn_failed",
            provider: ANTIGRAVITY_PROVIDER,
            turnId,
            error:
              'Antigravity returned "RESOURCE_EXHAUSTED: Individual quota reached" for the current model. Each Antigravity model (Gemini 3 Pro / Flash, Claude 4.6, GPT-OSS) has its own quota.\n\nFix: open `agy` in a terminal and use its Switch Model picker (the menu at the bottom of the TUI) to pick a model with available quota, then retry here. Paseo uses whatever model you pick in agy\'s TUI when the Settings model picker is left on "Default". Quotas reset automatically on Antigravity\'s schedule.',
          });
          resolve();
          return;
        }

        if (code !== 0) {
          this.emit({
            type: "turn_failed",
            provider: ANTIGRAVITY_PROVIDER,
            turnId,
            error:
              `Antigravity process exited with non-zero code ${code ?? "null"} and signal ${signal ?? "null"}.\nStderr: ${stderrBuffer}`.trim(),
          });
          resolve();
          return;
        }

        if (stdoutBuffer.trim().length === 0) {
          this.emit({
            type: "turn_failed",
            provider: ANTIGRAVITY_PROVIDER,
            turnId,
            error:
              "Antigravity returned an empty response. This may indicate an expired session — try running `agy` in a terminal to re-authenticate.",
          });
          resolve();
          return;
        }

        this.history.push({ role: "assistant", content: stdoutBuffer });

        this.emit({
          type: "turn_completed",
          provider: ANTIGRAVITY_PROVIDER,
          turnId,
        });
        resolve();
      });
    });
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    // Stateless CLI does not maintain history streams natively
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: ANTIGRAVITY_PROVIDER,
      sessionId: this.id,
      model: this.config.model ?? null,
      thinkingOptionId: null,
      modeId: null,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [];
  }

  async getCurrentMode(): Promise<string | null> {
    return null;
  }

  async setMode(_modeId: string): Promise<void> {
    throw new Error("Antigravity does not support modes.");
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(_requestId: string, _response: AgentPermissionResponse): Promise<void> {
    throw new Error("Antigravity does not support permission requests.");
  }

  describePersistence(): AgentPersistenceHandle | null {
    return null;
  }

  async interrupt(): Promise<void> {
    // Stateless run cannot be interrupted in-place easily
  }

  async close(): Promise<void> {
    this.closed = true;
    this.subscribers.clear();
  }

  private emit(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) {
      try {
        callback(event);
      } catch (err) {
        this.logger.error({ err }, "Error in subscriber callback");
      }
    }
  }
}
