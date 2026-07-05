import { describe, it, expect } from "vitest";
import { classifyShellCommand } from "./shell-command-icon";

describe("classifyShellCommand", () => {
  it.each([
    ["git status", "git"],
    ["git", "git"],
    ["git log | head", "git"],
    ["FOO=1 git push", "git"],
    ["cd packages/app && git diff", "git"],
  ])("classifies %s as git", (command, expected) => {
    expect(classifyShellCommand(command)).toBe(expected);
  });

  it.each([["gh pr view 12", "gh"]])("classifies %s as gh", (command, expected) => {
    expect(classifyShellCommand(command)).toBe(expected);
  });

  it.each([
    ["ls -la", "other"],
    ["npm test", "other"],
    ["", "other"],
    ["   ", "other"],
    ["github-foo", "other"],
  ])("classifies %s as other", (command, expected) => {
    expect(classifyShellCommand(command)).toBe(expected);
  });
});
