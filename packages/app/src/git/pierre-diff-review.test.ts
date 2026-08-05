// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";

const { getInlineReviewThreadState } = vi.hoisted(() => ({
  getInlineReviewThreadState: vi.fn(),
}));
vi.mock("@/review", () => ({
  getInlineReviewThreadState,
}));

import {
  buildPierreReviewAnnotations,
  findPierreReviewTarget,
  type PierreReviewThread,
} from "./pierre-diff-review";

type DiffLineType = "add" | "remove" | "context";

function line(type: DiffLineType, content: string) {
  return { type, content };
}

const file: ParsedDiffFile = {
  path: "src/file.ts",
  isNew: false,
  isDeleted: false,
  additions: 2,
  deletions: 1,
  hunks: [
    {
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 3,
      lines: [line("context", "keep"), line("remove", "gone"), line("add", "fresh")],
    },
  ],
} as ParsedDiffFile;

const EMPTY_THREAD: PierreReviewThread = {
  comments: [],
  hasEditor: false,
  editingCommentId: null,
  height: 72,
};

describe("pierre-diff-review", () => {
  it("maps a pierre additions side/line back to the paseo review target", () => {
    const target = findPierreReviewTarget(file, { side: "additions", lineNumber: 2 });
    expect(target).not.toBeNull();
    expect(target?.side).toBe("new");
    expect(target?.lineNumber).toBe(2);
    expect(target?.filePath).toBe("src/file.ts");
  });

  it("maps a pierre deletions side/line back to the paseo review target", () => {
    const target = findPierreReviewTarget(file, { side: "deletions", lineNumber: 2 });
    expect(target).not.toBeNull();
    expect(target?.side).toBe("old");
    expect(target?.lineNumber).toBe(2);
  });

  it("returns null for line numbers outside the hunk", () => {
    expect(findPierreReviewTarget(file, { side: "additions", lineNumber: 99 })).toBeNull();
  });

  it("builds no annotations without review actions", () => {
    expect(buildPierreReviewAnnotations(file, undefined)).toEqual([]);
  });

  it("builds an annotation only for targets with an existing thread", () => {
    getInlineReviewThreadState.mockImplementation((input) =>
      input.reviewTarget?.lineNumber === 2 && input.reviewTarget?.side === "new"
        ? EMPTY_THREAD
        : null,
    );

    const annotations = buildPierreReviewAnnotations(file, {} as never);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].side).toBe("additions");
    expect(annotations[0].lineNumber).toBe(2);
    expect(annotations[0].metadata.reviewTarget.lineNumber).toBe(2);
  });

  it("places a deletions-side thread on the deletions side", () => {
    getInlineReviewThreadState.mockImplementation((input) =>
      input.reviewTarget?.side === "old" && input.reviewTarget?.lineNumber === 2
        ? EMPTY_THREAD
        : null,
    );

    const annotations = buildPierreReviewAnnotations(file, {} as never);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].side).toBe("deletions");
    expect(annotations[0].lineNumber).toBe(2);
  });

  it("skips lines without a thread", () => {
    getInlineReviewThreadState.mockReturnValue(null);
    expect(buildPierreReviewAnnotations(file, {} as never)).toEqual([]);
  });
});
