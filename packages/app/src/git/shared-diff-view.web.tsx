import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
  type DiffLineAnnotation,
  type LineAnnotation,
} from "@pierre/diffs/react";
import type { SharedDiffViewProps } from "@/git/diff-pane";
import { DiffStat } from "@/components/diff-stat";
import { buildPierreDiffOptions } from "@/git/pierre-diff-options";
import { parsedDiffFileToFileDiffMetadata } from "@/git/pierre-diffs-adapter";
import {
  buildPierreReviewAnnotations,
  findPierreReviewTarget,
  type PierreReviewAnnotation,
} from "@/git/pierre-diff-review";
import { PierreFileTree } from "@/git/pierre-file-tree.web";
import { InlineReviewThread } from "@/review/surface";

type PierreAnnotation = DiffLineAnnotation<PierreReviewAnnotation>;

interface PressableState {
  pressed: boolean;
}
const collapseButtonPressableStyle = ({ pressed }: PressableState) => [
  styles.collapseButton,
  pressed && styles.collapseButtonPressed,
];

interface CollapseToggleProps {
  collapsed: boolean;
  itemId: string;
  onToggle: (itemId: string) => void;
}

function CollapseToggle({ collapsed, itemId, onToggle }: CollapseToggleProps): React.JSX.Element {
  const handlePress = useCallback(() => onToggle(itemId), [itemId, onToggle]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      testID={`diff-file-collapse-${itemId}`}
      style={collapseButtonPressableStyle}
    >
      <Text style={styles.collapseButtonText}>{collapsed ? "+" : "−"}</Text>
    </Pressable>
  );
}

interface PierreCodeViewProps {
  items: readonly CodeViewDiffItem<PierreReviewAnnotation>[];
  wrapLines: boolean;
  layout: "unified" | "split";
  renderHeaderMetadata: (item: CodeViewItem<PierreReviewAnnotation>) => React.ReactNode;
  renderHeaderPrefix: (item: CodeViewItem<PierreReviewAnnotation>) => React.ReactNode;
  renderAnnotation?: (
    annotation: LineAnnotation<PierreReviewAnnotation> | PierreAnnotation,
    item: CodeViewItem<PierreReviewAnnotation>,
  ) => React.ReactNode;
  onGutterUtilityClick?: (
    range: { start: number; side?: "deletions" | "additions"; end: number },
    context: { item: CodeViewItem<PierreReviewAnnotation> },
  ) => void;
  gutterUtilityEnabled: boolean;
  viewerRef: React.Ref<CodeViewHandle<PierreReviewAnnotation>>;
  // Injected by the withUnistyles wrapper below — docs/unistyles.md bans useUnistyles.
  themeType: "light" | "dark";
}

function PierreCodeView({
  themeType,
  wrapLines,
  layout,
  items,
  renderHeaderMetadata,
  renderHeaderPrefix,
  renderAnnotation,
  onGutterUtilityClick,
  gutterUtilityEnabled,
  viewerRef,
}: PierreCodeViewProps): React.JSX.Element {
  const options = useMemo(() => {
    const base = buildPierreDiffOptions({ themeType, wrapLines, layout });
    return {
      ...base,
      enableGutterUtility: gutterUtilityEnabled,
      onGutterUtilityClick,
    } as CodeViewReactOptions<PierreReviewAnnotation>;
  }, [gutterUtilityEnabled, layout, onGutterUtilityClick, themeType, wrapLines]);

  return (
    <CodeView<PierreReviewAnnotation>
      ref={viewerRef}
      items={items}
      options={options}
      renderHeaderMetadata={renderHeaderMetadata}
      renderHeaderPrefix={renderHeaderPrefix}
      renderAnnotation={renderAnnotation}
    />
  );
}

// The app has 6 unistyles themes; only "light" is light.
const ThemedPierreCodeView = withUnistyles(PierreCodeView, (_theme, rt) => ({
  themeType: rt.themeName === "light" ? ("light" as const) : ("dark" as const),
}));

type PlatformSharedDiffViewProps = SharedDiffViewProps & {
  fallback: React.ComponentType<SharedDiffViewProps>;
};
type PierreSegment =
  | { type: "diffs"; key: string; items: readonly CodeViewDiffItem<PierreReviewAnnotation>[] }
  | { type: "status"; key: string; file: SharedDiffViewProps["files"][number] };

export function SharedDiffView({
  files,
  displayPreferences,
  mode,
}: PlatformSharedDiffViewProps): React.JSX.Element {
  const { t } = useTranslation();

  const reviewActions = mode.kind === "commit" ? undefined : mode.reviewActions;
  const isTreeMode = mode.kind === "working_tree" && mode.viewMode === "tree";

  // Latest-props ref so stable callbacks read current review state.
  const reviewActionsRef = useRef(reviewActions);
  reviewActionsRef.current = reviewActions;

  const viewerRef = useRef<CodeViewHandle<PierreReviewAnnotation>>(null);
  const consumedFocusRequestRef = useRef<string | null>(null);

  const filesByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);

  const segments = useMemo<readonly PierreSegment[]>(() => {
    const result: PierreSegment[] = [];
    let diffItems: CodeViewDiffItem<PierreReviewAnnotation>[] = [];

    const flush = () => {
      if (diffItems.length > 0) {
        result.push({ type: "diffs", key: `diffs:${diffItems[0].id}`, items: diffItems });
        diffItems = [];
      }
    };

    for (const file of files) {
      if (file.status === "too_large" || file.status === "binary") {
        flush();
        result.push({ type: "status", key: `status:${file.path}`, file });
        continue;
      }

      const isExpanded =
        mode.kind === "commit" ||
        mode.expandedPaths == null ||
        mode.expandedPaths.includes(file.path);

      diffItems.push({
        id: file.path,
        type: "diff" as const,
        fileDiff: parsedDiffFileToFileDiffMetadata(file),
        collapsed: !isExpanded,
        annotations: buildPierreReviewAnnotations(file, reviewActions),
      });
    }

    flush();
    return result;
  }, [files, mode, reviewActions]);

  // Collapse state lives in the panel store (expandedPaths), so the toggle
  // only writes the store; the rebuilt items flow back through the props.
  const handleToggleCollapsed = useCallback(
    (itemId: string) => {
      if (mode.kind === "commit" || mode.expandedPaths == null) {
        return;
      }
      const isCurrentlyExpanded = mode.expandedPaths.includes(itemId);
      const next = isCurrentlyExpanded
        ? mode.expandedPaths.filter((path) => path !== itemId)
        : [...mode.expandedPaths, itemId];
      mode.onExpandedPathsChange?.(next);
    },
    [mode],
  );

  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<PierreReviewAnnotation>): React.ReactNode => {
      if (item.type !== "diff" || mode.kind === "commit") {
        return null;
      }
      return (
        <CollapseToggle
          collapsed={item.collapsed ?? false}
          itemId={item.id}
          onToggle={handleToggleCollapsed}
        />
      );
    },
    [handleToggleCollapsed, mode.kind],
  );

  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<PierreReviewAnnotation>): React.ReactNode => {
      if (item.type !== "diff") {
        return null;
      }
      const file = filesByPath.get(item.id);
      if (!file) {
        return null;
      }
      return <DiffStat additions={file.additions} deletions={file.deletions} />;
    },
    [filesByPath],
  );

  const renderAnnotation = useCallback(
    (
      annotation: LineAnnotation<PierreReviewAnnotation> | PierreAnnotation,
      item: CodeViewItem<PierreReviewAnnotation>,
    ): React.ReactNode => {
      if (item.type !== "diff" || !("side" in annotation) || annotation.metadata == null) {
        return null;
      }
      if (reviewActionsRef.current == null) {
        return null;
      }
      const { reviewTarget, thread } = annotation.metadata;
      return (
        <InlineReviewThread
          reviewTarget={reviewTarget}
          reviewActions={reviewActionsRef.current}
          height={thread.height}
          testID={`inline-review-thread-${reviewTarget.key}`}
        />
      );
    },
    [],
  );

  const handleGutterUtilityClick = useCallback(
    (
      range: { start: number; side?: "deletions" | "additions"; end: number },
      context: { item: CodeViewItem<PierreReviewAnnotation> },
    ) => {
      if (context.item.type !== "diff") {
        return;
      }
      const file = files.find((f) => f.path === context.item.id);
      if (!file) {
        return;
      }
      const target = findPierreReviewTarget(file, {
        side: range.side ?? "additions",
        lineNumber: range.start,
      });
      if (target) {
        reviewActionsRef.current?.onStartComment(target);
      }
    },
    [files],
  );

  // Scroll to the focused file when a working_tab focus request arrives.
  useEffect(() => {
    if (mode.kind !== "working_tab" || mode.focusPath == null) {
      return;
    }
    const key = `${mode.focusRequestId ?? "initial"}:${mode.focusPath}`;
    if (consumedFocusRequestRef.current === key) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      viewerRef.current?.scrollTo({ type: "item", id: mode.focusPath ?? "", align: "start" });
      consumedFocusRequestRef.current = key;
    });
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  // Tree view mode is the pierre FileTree; everything else is CodeView.
  if (isTreeMode) {
    return (
      <PierreFileTree
        files={files}
        collapsedFolders={mode.collapsedFolders}
        onCollapsedFoldersChange={mode.onCollapsedFoldersChange}
        onFilePress={mode.onFilePress}
      />
    );
  }

  return (
    <View style={styles.container}>
      {segments.map((segment) => {
        if (segment.type === "status") {
          const { file } = segment;
          return (
            <View key={segment.key} style={styles.statusMessageContainer}>
              <Text style={styles.statusMessagePath}>{file.path}</Text>
              <Text style={styles.statusMessageText}>
                {file.status === "binary"
                  ? t("workspace.git.diff.binaryFile")
                  : t("workspace.git.diff.tooLarge")}
              </Text>
            </View>
          );
        }

        return (
          <View key={segment.key} style={styles.codeViewContainer}>
            <ThemedPierreCodeView
              viewerRef={viewerRef}
              items={segment.items}
              wrapLines={displayPreferences.wrapLines}
              layout={displayPreferences.layout}
              renderHeaderMetadata={renderHeaderMetadata}
              renderHeaderPrefix={renderHeaderPrefix}
              renderAnnotation={renderAnnotation}
              onGutterUtilityClick={handleGutterUtilityClick}
              gutterUtilityEnabled={reviewActions != null}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  codeViewContainer: {
    flex: 1,
  },
  statusMessageContainer: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[4],
  },
  statusMessagePath: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    marginBottom: theme.spacing[1],
  },
  statusMessageText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontStyle: "italic",
  },
  collapseButton: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    minWidth: 24,
    alignItems: "center",
  },
  collapseButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  collapseButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm,
  },
}));
