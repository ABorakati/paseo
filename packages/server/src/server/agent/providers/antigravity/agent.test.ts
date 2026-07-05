import { EventEmitter } from "node:events";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import pino from "pino";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { AntigravityAgentClient } from "./agent.js";
import * as spawnUtils from "../../../../utils/spawn.js";
import * as fs from "node:fs";
import type { AgentSessionConfig, AgentStreamEvent } from "../../agent-sdk-types.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock("../../../../utils/spawn.js", async (importOriginal) => {
  const original = await importOriginal<typeof spawnUtils>();
  return {
    ...original,
    spawnProcess: vi.fn(),
  };
});

// Helper to create a fake child process
function createFakeChild(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;

  const stdout = new EventEmitter() as unknown as Readable;
  const stderr = new EventEmitter() as unknown as Readable;
  const stdin = {
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as Writable;

  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = stdin;
  child.kill = vi.fn();

  return child;
}

describe("AntigravityAgentClient & Session", () => {
  let logger: ReturnType<typeof pino>;

  beforeEach(() => {
    logger = pino({ level: "silent" });
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test("initializes correctly and returns catalog", async () => {
    const client = new AntigravityAgentClient(logger);

    expect(client.provider).toBe("antigravity");
    expect(client.capabilities.supportsStreaming).toBe(true);
    expect(client.capabilities.supportsSessionPersistence).toBe(false);

    const catalog = await client.fetchCatalog({ scope: "global", force: false });
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.models[0].id).toBe("default");
    expect(catalog.modes).toEqual([]);
  });

  test("resolves session creation", async () => {
    const client = new AntigravityAgentClient(logger);
    const config: AgentSessionConfig = {
      provider: "antigravity",
      cwd: "/fake/cwd",
    };

    const session = await client.createSession(config);
    expect(session.provider).toBe("antigravity");
    expect(session.id).toBeNull();

    await session.close();
  });

  test("runs startTurn and streams success chunks", async () => {
    const client = new AntigravityAgentClient(logger);
    const config: AgentSessionConfig = {
      provider: "antigravity",
      cwd: "/fake/cwd",
    };

    const session = await client.createSession(config);
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const child = createFakeChild();
    vi.mocked(spawnUtils.spawnProcess).mockReturnValue(child);

    // Mock existsSync for log checking
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const turnPromise = session.startTurn("hello context");

    // Let the event loop advance to process turn spawn
    await new Promise((resolve) => setImmediate(resolve));

    expect(spawnUtils.spawnProcess).toHaveBeenCalledWith(
      "agy",
      expect.arrayContaining(["-p", "-"]),
      expect.objectContaining({ cwd: "/fake/cwd" }),
    );

    // Write stdout data
    child.stdout.emit("data", Buffer.from("Hello "));
    child.stdout.emit("data", Buffer.from("world!"));

    // Emit process close
    child.emit("close", 0, null);

    const { turnId } = await turnPromise;
    expect(turnId).toBeDefined();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn_started",
        provider: "antigravity",
        turnId,
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "timeline",
        provider: "antigravity",
        turnId,
        item: expect.objectContaining({
          type: "assistant_message",
          text: "Hello ",
        }),
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "timeline",
        provider: "antigravity",
        turnId,
        item: expect.objectContaining({
          type: "assistant_message",
          text: "world!",
        }),
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn_completed",
        provider: "antigravity",
        turnId,
      }),
    );

    await session.close();
  });

  test("catches OAuth auth failure from stdout", async () => {
    const client = new AntigravityAgentClient(logger);
    const config: AgentSessionConfig = {
      provider: "antigravity",
      cwd: "/fake/cwd",
    };

    const session = await client.createSession(config);
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const child = createFakeChild();
    vi.mocked(spawnUtils.spawnProcess).mockReturnValue(child);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const turnPromise = session.startTurn("hello context");
    await new Promise((resolve) => setImmediate(resolve));

    // Emit OAuth URL text
    child.stdout.emit(
      "data",
      Buffer.from(
        "Authentication required. Please visit the URL to log in: https://accounts.google.com/o/oauth2/auth\n",
      ),
    );
    child.emit("close", 0, null);

    await turnPromise;

    // Check that we got turn_failed event and did NOT stream stdout
    const turnFailed = events.find((e) => e.type === "turn_failed");
    expect(turnFailed).toBeDefined();
    expect(turnFailed.error).toContain("Antigravity needs to sign in");

    const assistantMsg = events.find(
      (e) => e.type === "timeline" && e.item.type === "assistant_message",
    );
    expect(assistantMsg).toBeUndefined();

    await session.close();
  });

  test("catches quota failure from log file", async () => {
    const client = new AntigravityAgentClient(logger);
    const config: AgentSessionConfig = {
      provider: "antigravity",
      cwd: "/fake/cwd",
    };

    const session = await client.createSession(config);
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const child = createFakeChild();
    vi.mocked(spawnUtils.spawnProcess).mockReturnValue(child);

    // Mock logs reading
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      "E0626 14:00:00.000000 model_config_manager.go:42] RESOURCE_EXHAUSTED (code 429): Individual quota reached.",
    );

    const turnPromise = session.startTurn("hello context");
    await new Promise((resolve) => setImmediate(resolve));

    child.emit("close", 0, null);

    await turnPromise;

    const turnFailed = events.find((e) => e.type === "turn_failed");
    expect(turnFailed).toBeDefined();
    expect(turnFailed.error).toContain("RESOURCE_EXHAUSTED");

    await session.close();
  });
});
