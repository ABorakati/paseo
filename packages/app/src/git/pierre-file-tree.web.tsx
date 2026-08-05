import { useCallback, useEffect, useMemo, useRef } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type {
  FileTreeDirectoryHandle,
  FileTreeOptions,
  FileTreeRowDecoration,
  FileTreeRowDecorationContext,
  GitStatusEntry,
  TreeThemeInput,
} from "@pierre/trees";
import { themeToTreeStyles } from "@pierre/trees";
import { withUnistyles } from "react-native-unistyles";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { formatDiffCount } from "@/components/diff-stat";
import { buildDiffTree, collectDirPaths, compressSingleChildChains } from "@/git/diff-tree";

export interface PierreFileTreeProps {
  files: ParsedDiffFile[];
  /** Directory paths that are collapsed (persisted across sessions). */
  collapsedFolders: readonly string[];
  onCollapsedFoldersChange?: (paths: string[]) => void;
  onFilePress?: (path: string) => void;
  // Injected by the withUnistyles wrapper below.
  statColors: { additions: string; deletions: string };
  treeStyle: Record<string, string>;
}

interface FileStats {
  additions: number;
  deletions: number;
}

const EMPTY_STATS: FileStats = { additions: 0, deletions: 0 };

function getDirAggregates(files: ParsedDiffFile[]): ReadonlyMap<string, FileStats> {
  const tree = compressSingleChildChains(buildDiffTree(files));
  const map = new Map<string, FileStats>();
  for (const dirPath of collectDirPaths(tree)) {
    let additions = 0;
    let deletions = 0;
    const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
    for (const file of files) {
      if (file.path.startsWith(prefix)) {
        additions += file.additions;
        deletions += file.deletions;
      }
    }
    map.set(dirPath, { additions, deletions });
  }
  return map;
}

function getStatsForPath(
  files: readonly ParsedDiffFile[],
  dirAggregates: ReadonlyMap<string, FileStats>,
  path: string,
): FileStats {
  const aggregate = dirAggregates.get(path);
  if (aggregate) {
    return aggregate;
  }
  const file = files.find((f) => f.path === path);
  return file ? { additions: file.additions, deletions: file.deletions } : EMPTY_STATS;
}

/**
 * Web-only replacement for the hand-rolled changes tree, backed by
 * `@pierre/trees` FileTree. Native keeps the RN implementation.
 *
 * The paseo tree state model survives unchanged: `collapsedFolders` is read
 * on mount, and directory collapse/expand is written back through
 * `onCollapsedFoldersChange` so the panel store keeps working across
 * flat/tree toggles and app restarts.
 */
function getDirectoryHandle(
  model: ReturnType<typeof useFileTree>["model"],
  path: string,
): FileTreeDirectoryHandle | null {
  const item = model.getItem(path);
  return item != null && item.isDirectory() ? (item as FileTreeDirectoryHandle) : null;
}

function PierreFileTree({
  files,
  collapsedFolders,
  onCollapsedFoldersChange,
  onFilePress,
  statColors,
  treeStyle,
}: PierreFileTreeProps): React.JSX.Element {
  const filePaths = useMemo(() => files.map((f) => f.path), [files]);

  const gitStatus = useMemo<GitStatusEntry[]>(() => {
    const entries: GitStatusEntry[] = [];
    for (const file of files) {
      let status: GitStatusEntry["status"];
      if (file.isNew) {
        status = "added";
      } else if (file.isDeleted) {
        status = "deleted";
      } else {
        status = "modified";
      }
      entries.push({ path: file.path, status });
    }
    return entries;
  }, [files]);

  const dirAggregates = useMemo(() => getDirAggregates(files), [files]);

  // Latest-props refs so stable model callbacks always read current state.
  const filesRef = useRef(files);
  filesRef.current = files;
  const dirAggregatesRef = useRef(dirAggregates);
  dirAggregatesRef.current = dirAggregates;
  const onFilePressRef = useRef(onFilePress);
  onFilePressRef.current = onFilePress;
  const onCollapsedFoldersChangeRef = useRef(onCollapsedFoldersChange);
  onCollapsedFoldersChangeRef.current = onCollapsedFoldersChange;
  const statColorsRef = useRef(statColors);
  statColorsRef.current = statColors;

  const handleSelectionChange = useCallback((selectedPaths: readonly string[]) => {
    if (selectedPaths.length !== 1) {
      return;
    }
    onFilePressRef.current?.(selectedPaths[0]);
  }, []);

  const renderRowDecoration = useCallback(
    (context: FileTreeRowDecorationContext): FileTreeRowDecoration | null => {
      const { row } = context;
      const stats = getStatsForPath(filesRef.current, dirAggregatesRef.current, row.path);
      if (stats.additions === 0 && stats.deletions === 0) {
        return null;
      }
      const colors = statColorsRef.current;
      return {
        text: `+${formatDiffCount(stats.additions)} -${formatDiffCount(stats.deletions)}`,
        parts: [
          { text: `+${formatDiffCount(stats.additions)}`, color: colors.additions },
          { text: ` -${formatDiffCount(stats.deletions)}`, color: colors.deletions },
        ],
      };
    },
    [],
  );

  // The FileTree model is created once and ignores later option changes, so
  // every initial-expansion decision derives from mount-time props. Rebuilt on
  // either input change and fed to resetPaths so refreshes keep collapse state.
  const initialExpandedPaths = useMemo(() => {
    const tree = compressSingleChildChains(buildDiffTree(files));
    const collapsed = new Set(collapsedFolders);
    return collectDirPaths(tree).filter((path) => !collapsed.has(path));
  }, [collapsedFolders, files]);

  const { model } = useFileTree({
    paths: filePaths,
    gitStatus,
    initialExpandedPaths,
    sort: "default",
    onSelectionChange: handleSelectionChange,
    renderRowDecoration,
    itemHeight: 22,
    overscan: 8,
  } satisfies FileTreeOptions);

  // Write directory collapse state back into the panel store on model changes
  // (folder toggles, path resets). Reads collapsed state directly from the
  // model handles so the store always mirrors what the user sees. Guarded by
  // a last-emitted snapshot: programmatic resets re-report the same set, and
  // firing the store setter on every mutation would loop parent state back
  // into this component.
  const lastEmittedCollapsedRef = useRef<readonly string[] | null>(null);
  const syncCollapsedFolders = useCallback(() => {
    const tree = compressSingleChildChains(buildDiffTree(filesRef.current));
    const collapsed: string[] = [];
    for (const dirPath of collectDirPaths(tree)) {
      const dir = getDirectoryHandle(model, dirPath);
      if (dir != null && !dir.isExpanded()) {
        collapsed.push(dirPath);
      }
    }
    const previous = lastEmittedCollapsedRef.current;
    const sameAsPrevious =
      previous != null &&
      previous.length === collapsed.length &&
      previous.every((path, index) => path === collapsed[index]);
    if (!sameAsPrevious) {
      lastEmittedCollapsedRef.current = collapsed;
      onCollapsedFoldersChangeRef.current?.(collapsed);
    }
  }, [model]);

  // Re-apply any folder paseo wants collapsed. Runs on mount and whenever the
  // persisted state changes; the initial-expanded-paths set already excluded
  // them on the first build.
  useEffect(() => {
    for (const dirPath of collapsedFolders) {
      const dir = getDirectoryHandle(model, dirPath);
      if (dir != null && dir.isExpanded()) {
        dir.collapse();
      }
    }
    syncCollapsedFolders();
  }, [collapsedFolders, model, syncCollapsedFolders]);

  useEffect(
    () => model.onMutation("*", () => syncCollapsedFolders()),
    [model, syncCollapsedFolders],
  );

  const resetExpandedPathsRef = useRef(initialExpandedPaths);
  resetExpandedPathsRef.current = initialExpandedPaths;
  useEffect(() => {
    // New file list: rebuild the model, preserving folder collapse state.
    // Depends only on the path list — expansion state is read from the ref so
    // persisted-collapse updates never trigger a reset (which would loop).
    model.resetPaths(filePaths, {
      initialExpandedPaths: resetExpandedPathsRef.current,
    });
  }, [model, filePaths]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [model, gitStatus]);

  return <FileTree model={model} style={treeStyle} />;
}

// The tree is themed via unistyles: the wrapper resolves the paseo theme into
// the tree's --trees-theme-* custom properties (themeToTreeStyles consumes a
// VS Code-shaped token set) and forwards the DiffStat decoration colors.
const ThemedPierreFileTree = withUnistyles(PierreFileTree, (theme, runtime) => ({
  statColors: {
    additions: theme.colors.diffAddition,
    deletions: theme.colors.diffDeletion,
  },
  treeStyle: themeToTreeStyles(buildTreeThemeInput(theme, runtime.themeName === "light")),
}));

function buildTreeThemeInput(
  theme: {
    colors: {
      surface1: string;
      surface2?: string;
      surfaceSidebar?: string;
      foregroundMuted: string;
      border: string;
      accent: string;
      accentForeground: string;
      statusMutedSuccess: string;
      statusMutedDanger: string;
      statusMutedWarning: string;
    };
  },
  isLight: boolean,
): TreeThemeInput {
  return {
    type: isLight ? "light" : "dark",
    colors: {
      "sideBar.background": theme.colors.surfaceSidebar ?? theme.colors.surface1,
      "sideBar.foreground": theme.colors.foregroundMuted,
      "sideBar.border": theme.colors.border,
      "list.activeSelectionBackground": theme.colors.accent,
      "list.activeSelectionForeground": theme.colors.accentForeground,
      "list.hoverBackground": theme.colors.surface2 ?? theme.colors.surface1,
      "list.focusOutline": theme.colors.border,
      "gitDecoration.addedResourceForeground": theme.colors.statusMutedSuccess,
      "gitDecoration.modifiedResourceForeground": theme.colors.statusMutedWarning,
      "gitDecoration.deletedResourceForeground": theme.colors.statusMutedDanger,
    },
  };
}

export { ThemedPierreFileTree as PierreFileTree };
