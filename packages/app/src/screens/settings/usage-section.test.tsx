/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  UsageLimitPluginSnapshot,
  UsageLimitsSnapshot,
  UsageReading,
} from "@getpaseo/protocol/usage-limits/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme, hostRuntime, sessionState } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, "1.5": 6, 2: 8, 3: 12, 4: 16, 6: 24 },
    borderWidth: { 1: 1 },
    borderRadius: { base: 4, md: 6, lg: 8, xl: 12, full: 9999 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400", medium: "500" },
    iconSize: { xs: 12, sm: 14, md: 16, lg: 20 },
    opacity: { 50: 0.5 },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      accent: "#0a84ff",
      accentForeground: "#fff",
      destructive: "#c44a4a",
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
      border: "#444",
      borderAccent: "#555",
      palette: {
        white: "#fff",
        amber: { 500: "#f59e0b" },
        blue: { 300: "#93c5fd" },
        green: { 400: "#4ade80", 800: "#166534", 900: "#14532d" },
        red: { 300: "#fca5a5", 500: "#ef4444", 800: "#991b1b", 900: "#7f1d1d" },
      },
    },
  },
  hostRuntime: {
    isConnected: true,
    getUsageLimitsSnapshot: vi.fn(),
    refreshUsageLimits: vi.fn(),
  },
  sessionState: {
    supportsUsageLimits: true,
  },
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  Pressable: ({
    children,
    onPress,
    accessibilityRole,
    accessibilityLabel,
    disabled,
    testID,
  }: {
    children?:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
    onPress?: (event: React.MouseEvent) => void;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    disabled?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "div",
      {
        role: accessibilityRole,
        "aria-label": accessibilityLabel,
        "aria-disabled": disabled ? "true" : undefined,
        "data-testid": testID,
        onClick: disabled ? undefined : onPress,
      },
      typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
    ),
  ActivityIndicator: () => React.createElement("span", { "data-testid": "activity-indicator" }),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return {
    AlertTriangle: icon("AlertTriangle"),
    CheckCircle2: icon("CheckCircle2"),
    Info: icon("Info"),
    XCircle: icon("XCircle"),
  };
});

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    getUsageLimitsSnapshot: hostRuntime.getUsageLimitsSnapshot,
    refreshUsageLimits: hostRuntime.refreshUsageLimits,
  }),
  useHostRuntimeIsConnected: () => hostRuntime.isConnected,
}));

interface FakeSessionState {
  sessions: Record<string, { serverInfo?: { features?: { usageLimits?: boolean } } }>;
}

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: FakeSessionState) => unknown) =>
    selector({
      sessions: {
        "server-1": {
          serverInfo: { features: { usageLimits: sessionState.supportsUsageLimits } },
        },
      },
    }),
}));

import { UsageSection } from "./usage-section";

const NOW = Date.now();

function isoIn(ms: number): string {
  return new Date(NOW + ms).toISOString();
}

function createPlugin(
  overrides: Partial<UsageLimitPluginSnapshot> & Pick<UsageLimitPluginSnapshot, "pluginId">,
): UsageLimitPluginSnapshot {
  return {
    label: "Antigravity",
    description: "Subscription allowance",
    providerId: null,
    status: "ok",
    readings: [],
    error: null,
    fetchedAt: isoIn(0),
    ...overrides,
  };
}

const ALL_VARIANT_READINGS: UsageReading[] = [
  {
    kind: "quota",
    id: "prompts",
    label: "Prompts",
    group: null,
    unit: "tokens",
    window: { label: "5 hours", resetsAt: isoIn(3 * 60 * 60 * 1000 + 30_000) },
    used: 1_200_000,
    limit: 2_000_000,
    remaining: null,
    percent: null,
  },
  {
    kind: "balance",
    id: "balance",
    label: "Balance",
    group: null,
    unit: "usd",
    remaining: 12.34,
    total: 20,
    percentRemaining: 62,
    currency: "USD",
  },
  {
    kind: "balance",
    id: "granted",
    label: "Granted credit",
    group: null,
    unit: "usd",
    remaining: 5,
    total: null,
    percentRemaining: null,
    currency: "USD",
  },
  {
    kind: "rate",
    id: "pricing",
    label: "Pricing",
    group: null,
    state: "Off-peak",
    multiplier: 0.5,
    changesAt: isoIn(2 * 60 * 60 * 1000 + 30_000),
    detail: "Half price until morning",
  },
  {
    kind: "quota",
    id: "google-5h",
    label: "Google models",
    group: "Google",
    unit: "requests",
    window: { label: "5 hours", resetsAt: null },
    used: 1200,
    limit: 4000,
    remaining: null,
    percent: null,
  },
  {
    kind: "quota",
    id: "google-weekly",
    label: "Google models",
    group: "Google",
    unit: "requests",
    window: { label: "Weekly", resetsAt: null },
    used: 9500,
    limit: 10000,
    remaining: null,
    percent: null,
  },
];

interface RenderOptions {
  plugins?: UsageLimitPluginSnapshot[];
  supportsUsageLimits?: boolean;
  isConnected?: boolean;
}

describe("UsageSection", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    // Source .tsx compiles with the classic JSX runtime under vitest, so the
    // components under test read `React` off the global scope.
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    hostRuntime.isConnected = true;
    sessionState.supportsUsageLimits = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  async function renderSection(options: RenderOptions = {}): Promise<void> {
    const snapshot: UsageLimitsSnapshot = { plugins: options.plugins ?? [] };
    hostRuntime.isConnected = options.isConnected ?? true;
    sessionState.supportsUsageLimits = options.supportsUsageLimits ?? true;
    hostRuntime.getUsageLimitsSnapshot.mockImplementation(async () => ({
      requestId: "usage-1",
      snapshot,
    }));
    hostRuntime.refreshUsageLimits.mockImplementation(async () => ({
      requestId: "usage-2",
      snapshot,
    }));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <UsageSection serverId="server-1" />
        </QueryClientProvider>,
      );
    });
    await flushQueries();
  }

  async function flushQueries(): Promise<void> {
    for (let tick = 0; tick < 20; tick += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      if (!text().includes("Loading usage limits...")) {
        return;
      }
    }
  }

  function text(): string {
    return container?.textContent ?? "";
  }

  function countOf(needle: string): number {
    return text().split(needle).length - 1;
  }

  function testIds(id: string): HTMLElement[] {
    return Array.from(container?.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`) ?? []);
  }

  it("renders every reading variant, grouped in first-appearance order", async () => {
    await renderSection({
      plugins: [createPlugin({ pluginId: "antigravity", readings: ALL_VARIANT_READINGS })],
    });

    expect(text()).toContain("Antigravity");
    expect(text()).toContain("Subscription allowance");

    expect(text()).toContain("1.2M / 2M");
    expect(countOf("5 hours")).toBe(2);
    expect(text()).toContain("Resets in 3h");

    expect(text()).toContain("$12.34 of $20.00");
    expect(text()).toContain("62% remaining");
    expect(text()).toContain("$5.00");

    expect(text()).toContain("Off-peak");
    expect(text()).toContain("0.5×");
    expect(text()).toContain("Half price until morning");
    expect(text()).toContain("Changes in 2h");

    expect(text()).toContain("1,200 / 4,000");
    expect(text()).toContain("9,500 / 10,000");

    expect(text().indexOf("Pricing")).toBeLessThan(text().indexOf("Google"));
  });

  it("draws a bar for a balance with a percentage and none without one", async () => {
    await renderSection({
      plugins: [createPlugin({ pluginId: "antigravity", readings: ALL_VARIANT_READINGS })],
    });

    expect(testIds("usage-bar-balance")).toHaveLength(1);
    expect(testIds("usage-bar-granted")).toHaveLength(0);
    expect(testIds("usage-bar-pricing")).toHaveLength(0);
  });

  it("points at config.json when no plugins are configured", async () => {
    await renderSection({ plugins: [] });

    expect(text()).toContain(
      'No usage limit plugins configured. Add them under "usageLimits.plugins" in config.json.',
    );
  });

  it("asks the user to update the host when the feature flag is absent", async () => {
    await renderSection({ supportsUsageLimits: false });

    expect(text()).toContain("Update the host to see usage limits.");
    expect(hostRuntime.getUsageLimitsSnapshot).not.toHaveBeenCalled();
  });

  it("renders an error alert for a plugin that failed", async () => {
    await renderSection({
      plugins: [
        createPlugin({
          pluginId: "deepseek",
          label: "DeepSeek",
          description: null,
          status: "error",
          error: "401 Unauthorized",
        }),
      ],
    });

    expect(testIds("usage-plugin-error-deepseek")).toHaveLength(1);
    expect(text()).toContain("Unable to load usage");
    expect(text()).toContain("401 Unauthorized");
  });
});
