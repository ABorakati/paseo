import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { describe, expect, it, vi } from "vitest";

// The visual resolver statically imports icon components (Lucide, GitHub, the
// Paseo logo, and provider icons) that transitively pull in `react-native`'s
// Flow source through `react-native-svg`/`lucide-react-native`, which the node
// test environment cannot parse. Stub those component modules so the pure
// presentation + visual-resolution logic can run here. The coloured file/git/
// console/http SVGs come from the pure `material-file-icons` module (no stub
// needed), so the svg-vs-component decisions below are still exercised for real.
vi.mock("lucide-react-native", () => {
  const Stub = () => null;
  return {
    Bot: Stub,
    Brain: Stub,
    Eye: Stub,
    MicVocal: Stub,
    Pencil: Stub,
    Search: Stub,
    Sparkles: Stub,
    SquareTerminal: Stub,
    Wrench: Stub,
    CheckSquare: Stub,
  };
});
vi.mock("@/components/icons/paseo-logo", () => ({ PaseoLogo: () => null }));
vi.mock("@/components/icons/github-icon", () => ({ GitHubIcon: () => null }));
vi.mock("@/components/provider-icons", () => ({
  getBrandedProviderIcon: () => () => null,
}));

import { buildToolCallPresentation, type ToolCallPresentationIcon } from "./presentation";

const fakeIcons = {
  brain: (() => null) as ToolCallPresentationIcon,
  eye: (() => null) as ToolCallPresentationIcon,
  wrench: (() => null) as ToolCallPresentationIcon,
};

function fakeResolveIcon(
  toolName: string,
  detail: ToolCallDetail | undefined,
): ToolCallPresentationIcon {
  if (detail?.type === "plan") {
    return fakeIcons.brain;
  }
  if (detail?.type === "read") {
    return fakeIcons.eye;
  }
  if (toolName === "exec_command") {
    return fakeIcons.wrench;
  }
  return fakeIcons.wrench;
}

describe("tool-call presentation", () => {
  it("builds badge, detail, icon, and file-open policy in one model", () => {
    const presentation = buildToolCallPresentation({
      toolName: "read_file",
      status: "completed",
      error: null,
      cwd: "/tmp/repo",
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
        content: "console.log('hi');",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Read",
      summary: "src/index.ts",
      icon: fakeIcons.eye,
      isLoadingDetails: false,
      hasDetails: true,
      canOpenDetails: true,
      openFilePath: "/tmp/repo/src/index.ts",
      isPlan: false,
    });
  });

  it("resolves a coloured file-icon svg for edits with a file path", () => {
    const presentation = buildToolCallPresentation({
      toolName: "edit_file",
      status: "completed",
      error: null,
      detail: {
        type: "edit",
        filePath: "/tmp/repo/src/app.ts",
        oldString: "a",
        newString: "b",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation.iconVisual.kind).toBe("svg");
    if (presentation.iconVisual.kind === "svg") {
      // TypeScript file icon uses the typescript brand color.
      expect(presentation.iconVisual.xml).toContain("<svg");
    }
  });

  it("uses a git svg for git shell commands and console svg for plain shell", () => {
    const gitPresentation = buildToolCallPresentation({
      toolName: "exec_command",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "git status" },
      resolveIcon: fakeResolveIcon,
    });
    const shellPresentation = buildToolCallPresentation({
      toolName: "exec_command",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "ls -la" },
      resolveIcon: fakeResolveIcon,
    });

    expect(gitPresentation.iconVisual.kind).toBe("svg");
    expect(shellPresentation.iconVisual.kind).toBe("svg");
    if (gitPresentation.iconVisual.kind === "svg" && shellPresentation.iconVisual.kind === "svg") {
      // The git and console icons are distinct coloured marks.
      expect(gitPresentation.iconVisual.xml).not.toBe(shellPresentation.iconVisual.xml);
    }
  });

  it("falls back to the tinted component visual when no richer detail exists", () => {
    const presentation = buildToolCallPresentation({
      toolName: "some_unknown_tool",
      status: "completed",
      error: null,
      detail: { type: "unknown", input: null, output: null },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation.iconVisual.kind).toBe("component");
  });

  it("marks running calls without meaningful detail as loading details", () => {
    const presentation = buildToolCallPresentation({
      toolName: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: {},
        output: null,
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Exec Command",
      icon: fakeIcons.wrench,
      isLoadingDetails: true,
      hasDetails: false,
      canOpenDetails: true,
      openFilePath: null,
      isPlan: false,
    });
  });

  it("keeps plan calls out of the expandable badge path", () => {
    const presentation = buildToolCallPresentation({
      toolName: "ExitPlanMode",
      status: "completed",
      error: null,
      detail: {
        type: "plan",
        text: "1. Do the thing",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation.isPlan).toBe(true);
    expect(presentation.icon).toBe(fakeIcons.brain);
  });
});
