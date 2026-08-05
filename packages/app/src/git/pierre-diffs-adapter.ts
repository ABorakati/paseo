import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import type { ChangeContent, ContextContent, FileDiffMetadata, Hunk } from "@pierre/diffs";

/**
 * Converts a paseo `ParsedDiffFile` into a pierre `FileDiffMetadata`.
 *
 * The paseo protocol ships line-level hunks (`add`/`remove`/`context`/`header`),
 * while pierre expects grouped hunk content plus file-level `additionLines` /
 * `deletionLines` arrays that hunk indices point into. Pure function: no React,
 * no I/O.
 */
export function parsedDiffFileToFileDiffMetadata(file: ParsedDiffFile): FileDiffMetadata {
  const additionLines: string[] = [];
  const deletionLines: string[] = [];
  const hunks: Hunk[] = [];
  let unifiedLineTotal = 0;
  let splitLineTotal = 0;

  for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
    const hunk = file.hunks[hunkIndex];
    const hunkContent: (ContextContent | ChangeContent)[] = [];
    const hunkAdditionLineIndex = additionLines.length;
    const hunkDeletionLineIndex = deletionLines.length;
    let hunkAdditionCount = 0;
    let hunkDeletionCount = 0;

    // Pending (unflushed) group state. A context line closes any open change
    // group; an add/remove line closes any open context group.
    let contextCount = 0;
    let contextAdditionLineIndex = 0;
    let contextDeletionLineIndex = 0;
    let changeAdditions = 0;
    let changeDeletions = 0;
    let changeAdditionLineIndex = 0;
    let changeDeletionLineIndex = 0;

    const flushContext = () => {
      if (contextCount === 0) return;
      hunkContent.push({
        type: "context",
        lines: contextCount,
        additionLineIndex: contextAdditionLineIndex,
        deletionLineIndex: contextDeletionLineIndex,
      });
      contextCount = 0;
    };

    const flushChange = () => {
      if (changeAdditions === 0 && changeDeletions === 0) return;
      hunkContent.push({
        type: "change",
        deletions: changeDeletions,
        deletionLineIndex: changeDeletionLineIndex,
        additions: changeAdditions,
        additionLineIndex: changeAdditionLineIndex,
      });
      changeAdditions = 0;
      changeDeletions = 0;
    };

    for (const line of hunk.lines) {
      // Pierre concatenates these entries before Shiki highlighting; every
      // entry must retain its line break or all hunk lines collapse into one.
      const lineContent = line.content.endsWith("\n") ? line.content : `${line.content}\n`;
      switch (line.type) {
        case "header":
          // Dropped: goes into neither file-level array nor any group.
          break;
        case "context": {
          flushChange();
          if (contextCount === 0) {
            contextAdditionLineIndex = additionLines.length;
            contextDeletionLineIndex = deletionLines.length;
          }
          contextCount++;
          additionLines.push(lineContent);
          deletionLines.push(lineContent);
          break;
        }
        case "add": {
          flushContext();
          if (changeAdditions === 0 && changeDeletions === 0) {
            changeAdditionLineIndex = additionLines.length;
            changeDeletionLineIndex = deletionLines.length;
          }
          changeAdditions++;
          hunkAdditionCount++;
          additionLines.push(lineContent);
          break;
        }
        case "remove": {
          flushContext();
          if (changeAdditions === 0 && changeDeletions === 0) {
            changeAdditionLineIndex = additionLines.length;
            changeDeletionLineIndex = deletionLines.length;
          }
          changeDeletions++;
          hunkDeletionCount++;
          deletionLines.push(lineContent);
          break;
        }
      }
    }
    flushContext();
    flushChange();

    let unifiedLineCount = 0;
    let splitLineCount = 0;
    for (const content of hunkContent) {
      if (content.type === "context") {
        unifiedLineCount += content.lines;
        splitLineCount += content.lines;
      } else {
        unifiedLineCount += content.deletions + content.additions;
        splitLineCount += Math.max(content.deletions, content.additions);
      }
    }

    const previous = file.hunks[hunkIndex - 1];
    const collapsedBefore = Math.max(
      0,
      hunkIndex === 0 ? hunk.oldStart - 1 : hunk.oldStart - (previous.oldStart + previous.oldCount),
    );

    unifiedLineTotal += collapsedBefore;
    splitLineTotal += collapsedBefore;

    hunks.push({
      collapsedBefore,
      additionStart: hunk.newStart,
      additionCount: hunk.newCount,
      additionLines: hunkAdditionCount,
      additionLineIndex: hunkAdditionLineIndex,
      deletionStart: hunk.oldStart,
      deletionCount: hunk.oldCount,
      deletionLines: hunkDeletionCount,
      deletionLineIndex: hunkDeletionLineIndex,
      hunkContent,
      splitLineStart: splitLineTotal,
      splitLineCount,
      unifiedLineStart: unifiedLineTotal,
      unifiedLineCount,
      noEOFCRDeletions: false,
      noEOFCRAdditions: false,
    });

    unifiedLineTotal += unifiedLineCount;
    splitLineTotal += splitLineCount;
  }

  let type: FileDiffMetadata["type"] = "change";
  if (file.isNew) {
    type = "new";
  } else if (file.isDeleted) {
    type = "deleted";
  }

  // A new or deleted file's diff is complete: one side is empty and the hunks
  // carry every line of the other side, so the addition/deletion arrays below
  // are the full file. Marking it partial would hide those sides from pierre's
  // editor (canHydrateDiff excludes new/deleted, so a partial new-file diff
  // can never be hydrated and stays uneditable). Modified diffs stay partial
  // until the daemon can serve full file contents.
  const isPartial = type === "change";

  return {
    name: file.path,
    type,
    hunks,
    splitLineCount: splitLineTotal,
    unifiedLineCount: unifiedLineTotal,
    isPartial,
    deletionLines,
    additionLines,
  };
}
