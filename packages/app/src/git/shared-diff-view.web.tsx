import { useCallback, useMemo, type ComponentType, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import type { SharedDiffViewProps } from "@/git/diff-pane";
import { DiffStat } from "@/components/diff-stat";
import { buildPierreDiffOptions } from "@/git/pierre-diff-options";
import { parsedDiffFileToFileDiffMetadata } from "@/git/pierre-diffs-adapter";

interface PierreCodeViewProps {
  items: readonly CodeViewDiffItem[];
  wrapLines: boolean;
  layout: "unified" | "split";
  renderHeaderMetadata: (item: CodeViewItem) => ReactNode;
  // Injected by the withUnistyles wrapper below — docs/unistyles.md bans useUnistyles.
  themeType: "light" | "dark";
}

function PierreCodeView({
  themeType,
  wrapLines,
  layout,
  items,
  renderHeaderMetadata,
}: PierreCodeViewProps): ReactElement {
  const options = useMemo(
    // CodeViewReactOptions narrows hunkSeparators ('custom' is vanilla-only);
    // buildPierreDiffOptions always emits 'line-info', so the cast is safe.
    () => buildPierreDiffOptions({ themeType, wrapLines, layout }) as CodeViewReactOptions,
    [themeType, wrapLines, layout],
  );
  return <CodeView items={items} options={options} renderHeaderMetadata={renderHeaderMetadata} />;
}

// The app has 6 unistyles themes; only "light" is light.
const ThemedPierreCodeView = withUnistyles(PierreCodeView, (_theme, rt) => ({
  themeType: rt.themeName === "light" ? ("light" as const) : ("dark" as const),
}));

type PlatformSharedDiffViewProps = SharedDiffViewProps & {
  fallback: ComponentType<SharedDiffViewProps>;
};
type PierreSegment =
  | { type: "diffs"; key: string; items: readonly CodeViewDiffItem[] }
  | { type: "status"; key: string; file: SharedDiffViewProps["files"][number] };

export function SharedDiffView({
  files,
  displayPreferences,
  mode,
  fallback: RNSharedDiffView,
}: PlatformSharedDiffViewProps): ReactElement {
  const { t } = useTranslation();

  // Not ported to pierre in Phase 1: tree mode, inline review, and focused-scroll requests.
  const shouldFallbackToRN =
    (mode.kind === "working_tree" && (mode.viewMode === "tree" || mode.reviewActions != null)) ||
    (mode.kind === "working_tab" && (mode.reviewActions != null || mode.focusPath != null));

  const filesByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const segments = useMemo<readonly PierreSegment[]>(() => {
    const result: PierreSegment[] = [];
    let diffItems: CodeViewDiffItem[] = [];

    for (const file of files) {
      if (file.status === "too_large" || file.status === "binary") {
        if (diffItems.length > 0) {
          result.push({ type: "diffs", key: `diffs:${diffItems[0].id}`, items: diffItems });
          diffItems = [];
        }
        result.push({ type: "status", key: `status:${file.path}`, file });
        continue;
      }

      diffItems.push({
        id: file.path,
        type: "diff" as const,
        fileDiff: parsedDiffFileToFileDiffMetadata(file),
      });
    }

    if (diffItems.length > 0) {
      result.push({ type: "diffs", key: `diffs:${diffItems[0].id}`, items: diffItems });
    }
    return result;
  }, [files]);

  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem): ReactNode => {
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

  if (shouldFallbackToRN) {
    return <RNSharedDiffView files={files} displayPreferences={displayPreferences} mode={mode} />;
  }

  return (
    <View style={styles.container}>
      {segments.map((segment) => {
        if (segment.type === "status") {
          const { file } = segment;
          return (
            // Status body mirrors diff-pane.tsx (statusMessageContainer/statusMessageText);
            // that block is not exported, so it is replicated here with the same i18n keys.
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
              items={segment.items}
              wrapLines={displayPreferences.wrapLines}
              layout={displayPreferences.layout}
              renderHeaderMetadata={renderHeaderMetadata}
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
}));
