import type { DiffLineAnnotation } from "@pierre/diffs";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import {
  getInlineReviewThreadState,
  type InlineReviewActions,
  type ReviewDraftComment,
} from "@/review";
import { buildNumberedDiffHunks, type ReviewableDiffTarget } from "@/utils/diff-layout";

/** The inline-review content currently visible for one annotated target. */
export interface PierreReviewThread {
  comments: ReviewDraftComment[];
  hasEditor: boolean;
  editingCommentId: string | null;
  height: number;
}

/** Review data attached to a Pierre diff-line annotation. */
export interface PierreReviewAnnotation {
  reviewTarget: ReviewableDiffTarget;
  thread: PierreReviewThread;
}

/** A Pierre diff position that can be resolved to an existing review target. */
export type PierreReviewPosition = Pick<DiffLineAnnotation, "side" | "lineNumber">;

/**
 * Resolves a Pierre side/line pair to the canonical target used by inline review actions.
 */
export function findPierreReviewTarget(
  file: ParsedDiffFile,
  position: PierreReviewPosition,
): ReviewableDiffTarget | null {
  const reviewSide = position.side === "deletions" ? "old" : "new";
  for (const hunk of buildNumberedDiffHunks(file)) {
    for (const line of hunk.lines) {
      const cell = reviewSide === "old" ? line.oldCell : line.newCell;
      if (cell?.lineNumber === position.lineNumber) {
        return cell;
      }
    }
  }
  return null;
}

/**
 * Builds only the line annotations that have persisted comments or an active draft editor.
 */
export function buildPierreReviewAnnotations(
  file: ParsedDiffFile,
  reviewActions: InlineReviewActions | undefined,
): DiffLineAnnotation<PierreReviewAnnotation>[] {
  if (!reviewActions) {
    return [];
  }

  const annotations: DiffLineAnnotation<PierreReviewAnnotation>[] = [];
  for (const hunk of buildNumberedDiffHunks(file)) {
    for (const line of hunk.lines) {
      for (const cell of [line.oldCell, line.newCell]) {
        if (!cell) {
          continue;
        }

        const thread = getInlineReviewThreadState({
          reviewTarget: cell,
          reviewActions,
        });
        if (!thread) {
          continue;
        }

        annotations.push({
          side: cell.side === "old" ? "deletions" : "additions",
          lineNumber: cell.lineNumber,
          metadata: {
            reviewTarget: cell,
            thread,
          },
        });
      }
    }
  }

  return annotations;
}
