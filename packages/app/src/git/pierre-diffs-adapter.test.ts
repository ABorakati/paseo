import { describe, expect, it } from "vitest";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { parsedDiffFileToFileDiffMetadata } from "./pierre-diffs-adapter";

type DiffLineType = "add" | "remove" | "context" | "header";

function line(type: DiffLineType, content: string) {
  return { type, content };
}

function createFile(overrides: Partial<ParsedDiffFile>): ParsedDiffFile {
  return {
    path: "src/file.ts",
    isNew: false,
    isDeleted: false,
    additions: 0,
    deletions: 0,
    hunks: [],
    ...overrides,
  } as ParsedDiffFile;
}

describe("parsedDiffFileToFileDiffMetadata", () => {
  it("groups consecutive context lines and mixed remove+add runs without context between", () => {
    const file = createFile({
      hunks: [
        {
          oldStart: 1,
          oldCount: 5,
          newStart: 1,
          newCount: 4,
          lines: [
            line("context", "a"),
            line("context", "b"),
            line("remove", "old1"),
            line("remove", "old2"),
            line("add", "new1"),
            line("context", "c"),
          ],
        },
      ],
    });

    const result = parsedDiffFileToFileDiffMetadata(file);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].hunkContent).toEqual([
      { type: "context", lines: 2, additionLineIndex: 0, deletionLineIndex: 0 },
      // remove+add with no context between collapses into ONE change group
      { type: "change", deletions: 2, deletionLineIndex: 2, additions: 1, additionLineIndex: 2 },
      { type: "context", lines: 1, additionLineIndex: 3, deletionLineIndex: 4 },
    ]);
    expect(result.additionLines).toEqual(["a\n", "b\n", "new1\n", "c\n"]);
    expect(result.deletionLines).toEqual(["a\n", "b\n", "old1\n", "old2\n", "c\n"]);
  });

  it("tracks hunk additionLineIndex/deletionLineIndex relative to file-level arrays", () => {
    const file = createFile({
      hunks: [
        {
          oldStart: 1,
          oldCount: 1,
          newStart: 1,
          newCount: 2,
          lines: [line("context", "x"), line("add", "y")],
        },
        {
          oldStart: 10,
          oldCount: 2,
          newStart: 11,
          newCount: 1,
          lines: [line("remove", "p"), line("context", "q")],
        },
      ],
    });

    const result = parsedDiffFileToFileDiffMetadata(file);
    expect(result.additionLines).toEqual(["x\n", "y\n", "q\n"]);
    expect(result.deletionLines).toEqual(["x\n", "p\n", "q\n"]);

    const [first, second] = result.hunks;
    expect(first.additionLineIndex).toBe(0);
    expect(first.deletionLineIndex).toBe(0);
    expect(second.additionLineIndex).toBe(2);
    expect(second.deletionLineIndex).toBe(1);
    expect(second.hunkContent).toEqual([
      { type: "change", deletions: 1, deletionLineIndex: 1, additions: 0, additionLineIndex: 2 },
      { type: "context", lines: 1, additionLineIndex: 2, deletionLineIndex: 2 },
    ]);
  });

  it("computes collapsedBefore from the previous hunk", () => {
    const file = createFile({
      hunks: [
        {
          oldStart: 5,
          oldCount: 3,
          newStart: 5,
          newCount: 3,
          lines: [line("context", "a")],
        },
        {
          oldStart: 20,
          oldCount: 2,
          newStart: 20,
          newCount: 2,
          lines: [line("context", "b")],
        },
      ],
    });

    const result = parsedDiffFileToFileDiffMetadata(file);
    expect(result.hunks[0].collapsedBefore).toBe(4); // oldStart - 1
    expect(result.hunks[1].collapsedBefore).toBe(12); // 20 - (5 + 3)

    const newFile = createFile({
      isNew: true,
      hunks: [
        {
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 1,
          lines: [line("add", "new")],
        },
      ],
    });
    expect(parsedDiffFileToFileDiffMetadata(newFile).hunks[0].collapsedBefore).toBe(0);
  });

  it("maps isNew/isDeleted to the pierre change type", () => {
    expect(parsedDiffFileToFileDiffMetadata(createFile({ isNew: true })).type).toBe("new");
    expect(parsedDiffFileToFileDiffMetadata(createFile({ isDeleted: true })).type).toBe("deleted");
    expect(parsedDiffFileToFileDiffMetadata(createFile({})).type).toBe("change");
  });

  it("computes unified vs split line counts and cumulative starts", () => {
    const file = createFile({
      hunks: [
        {
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 1,
          // change group: 2 deletions, 1 addition -> unified 3, split 2
          lines: [line("remove", "old1"), line("remove", "old2"), line("add", "new1")],
        },
        {
          oldStart: 10,
          oldCount: 2,
          newStart: 9,
          newCount: 3,
          // context(1) + change(1 deletion, 2 additions) -> unified 4, split 3
          lines: [
            line("context", "ctx"),
            line("remove", "old3"),
            line("add", "new2"),
            line("add", "new3"),
          ],
        },
      ],
    });

    const result = parsedDiffFileToFileDiffMetadata(file);
    const [first, second] = result.hunks;
    expect(first.unifiedLineStart).toBe(0);
    expect(first.unifiedLineCount).toBe(3);
    expect(first.splitLineStart).toBe(0);
    expect(first.splitLineCount).toBe(2);
    // The 7 collapsed lines before hunk two are part of pierre's layout coordinates.
    expect(second.unifiedLineStart).toBe(10);
    expect(second.unifiedLineCount).toBe(4);
    expect(second.splitLineStart).toBe(9);
    expect(second.splitLineCount).toBe(3);
    expect(result.unifiedLineCount).toBe(14);
    expect(result.splitLineCount).toBe(12);
  });

  it("drops header lines from the file-level arrays and all counts", () => {
    const file = createFile({
      hunks: [
        {
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 2,
          lines: [
            line("header", "@@ -1,2 +1,2 @@"),
            line("context", "keep"),
            line("remove", "gone"),
            line("add", "added"),
          ],
        },
      ],
    });

    const result = parsedDiffFileToFileDiffMetadata(file);
    expect(result.additionLines).toEqual(["keep\n", "added\n"]);
    expect(result.deletionLines).toEqual(["keep\n", "gone\n"]);
    const hunk = result.hunks[0];
    expect(hunk.additionLines).toBe(1);
    expect(hunk.deletionLines).toBe(1);
    expect(hunk.unifiedLineCount).toBe(3);
    expect(hunk.splitLineCount).toBe(2);
    expect(
      hunk.hunkContent.every((content) =>
        content.type === "context"
          ? content.lines === 1
          : content.deletions === 1 && content.additions === 1,
      ),
    ).toBe(true);
  });

  it("sets name, isPartial, and per-hunk starts/counts", () => {
    const file = createFile({
      path: "src/deep/nested.ts",
      hunks: [
        {
          oldStart: 3,
          oldCount: 4,
          newStart: 3,
          newCount: 5,
          lines: [line("context", "a"), line("add", "b")],
        },
      ],
    });

    const result = parsedDiffFileToFileDiffMetadata(file);
    expect(result.name).toBe("src/deep/nested.ts");
    expect(result.isPartial).toBe(true);
    expect(result.prevName).toBeUndefined();
    expect(result.cacheKey).toBeUndefined();
    const hunk = result.hunks[0];
    expect(hunk.additionStart).toBe(3);
    expect(hunk.additionCount).toBe(5);
    expect(hunk.deletionStart).toBe(3);
    expect(hunk.deletionCount).toBe(4);
    expect(hunk.noEOFCRDeletions).toBe(false);
    expect(hunk.noEOFCRAdditions).toBe(false);
    expect(hunk.hunkContext).toBeUndefined();
    expect(hunk.hunkSpecs).toBeUndefined();
  });
});
