import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Pencil } from "lucide-react-native";
import {
  CodeView,
  EditProvider,
  type CodeViewDiffItem,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
  type CreateEditor,
  type DiffLineAnnotation,
  type FileContents,
  type LineAnnotation,
} from "@pierre/diffs/react";
import { Editor } from "@pierre/diffs/edit";
import { preloadHighlighter } from "@pierre/diffs";
import { UnistylesRuntime } from "react-native-unistyles";
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
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";

type PierreAnnotation = DiffLineAnnotation<PierreReviewAnnotation>;
const ThemedPencil = withUnistyles(Pencil);
const pencilColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Extension → shiki language for pre-warming the editor's main-thread
// highlighter (the diff render uses the worker pool; the editor loads its own
// shared highlighter on first edit, which is slow unless pre-warmed).
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shell",
  sql: "sql",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? "text";
}

interface PressableState {
  pressed: boolean;
}
const collapseButtonPressableStyle = ({ pressed }: PressableState) => [
  styles.collapseButton,
  pressed && styles.collapseButtonPressed,
];
const editButtonPressableStyle = ({ pressed }: PressableState) => [
  styles.editButton,
  pressed && styles.editButtonPressed,
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

interface EditToggleProps {
  itemId: string;
  label: string;
  onToggle: (itemId: string) => void;
}

function EditToggle({ itemId, label, onToggle }: EditToggleProps): React.JSX.Element {
  const handlePress = useCallback(() => onToggle(itemId), [itemId, onToggle]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handlePress}
      testID={`diff-file-edit-${itemId}`}
      style={editButtonPressableStyle}
    >
      <ThemedPencil size={14} uniProps={pencilColorMapping} />
    </Pressable>
  );
}

// The diffs-container host sizes itself from this style; without an explicit
// flex fill it collapses to 0 height inside the flex column and the
// virtualizer renders nothing.
const CODE_VIEW_HOST_STYLE = { flex: 1, minHeight: 0 } as const;

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
  onItemEditComplete?: (item: CodeViewItem<PierreReviewAnnotation>, file: FileContents) => void;
  loadDiffFiles?: (
    fileDiff: import("@pierre/diffs").FileDiffMetadata,
  ) => Promise<import("@pierre/diffs").FileDiffLoadedFiles | null>;
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
  onItemEditComplete,
  loadDiffFiles,
  gutterUtilityEnabled,
  viewerRef,
}: PierreCodeViewProps): React.JSX.Element {
  const options = useMemo(() => {
    const base = buildPierreDiffOptions({ themeType, wrapLines, layout });
    return {
      ...base,
      enableGutterUtility: gutterUtilityEnabled,
      onGutterUtilityClick,
      loadDiffFiles,
    } as CodeViewReactOptions<PierreReviewAnnotation>;
  }, [gutterUtilityEnabled, layout, loadDiffFiles, onGutterUtilityClick, themeType, wrapLines]);

  return (
    <CodeView<PierreReviewAnnotation>
      ref={viewerRef}
      items={items}
      options={options}
      renderHeaderMetadata={renderHeaderMetadata}
      renderHeaderPrefix={renderHeaderPrefix}
      renderAnnotation={renderAnnotation}
      onItemEditComplete={onItemEditComplete}
      style={CODE_VIEW_HOST_STYLE}
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
  editContext,
}: PlatformSharedDiffViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();

  const reviewActions = mode.kind === "commit" ? undefined : mode.reviewActions;
  const isTreeMode = mode.kind === "working_tree" && mode.viewMode === "tree";
  const client = useHostRuntimeClient(editContext?.serverId ?? "");

  // Latest-props refs so stable callbacks read current state.
  const filesRef = useRef(files);
  filesRef.current = files;
  const reviewActionsRef = useRef(reviewActions);
  reviewActionsRef.current = reviewActions;
  const editContextRef = useRef(editContext);
  editContextRef.current = editContext;
  const clientRef = useRef(client);
  clientRef.current = client;

  const viewerRef = useRef<CodeViewHandle<PierreReviewAnnotation>>(null);
  const consumedFocusRequestRef = useRef<string | null>(null);

  const filesByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);

  const [editPaths, setEditPaths] = useState<ReadonlySet<string>>(() => new Set());
  const editPathsRef = useRef(editPaths);
  editPathsRef.current = editPaths;

  // Pre-warm the editor's main-thread shared highlighter so the first edit
  // session mounts quickly (the diff render highlights on the worker pool;
  // the editor's own highlighter loads lazily and can take seconds).
  // preloadHighlighter merges additively, so re-running with new languages is
  // cheap after the first load.
  useEffect(() => {
    if (files.length === 0) {
      return;
    }
    const themeName =
      UnistylesRuntime.themeName === "light" ? "github-light-default" : "github-dark-default";
    const langs = [...new Set(files.map((file) => languageForPath(file.path)))];
    void preloadHighlighter({ themes: [themeName], langs }).catch(() => {});
  }, [files]);
  // CodeView reconciles items only when their `version` changes
  // (syncItemRecord early-returns on equal versions), so every rebuild that
  // can alter item content must carry a fresh version.
  const [renderVersion, setRenderVersion] = useState(0);
  useEffect(() => {
    setRenderVersion((version) => version + 1);
  }, [editPaths, files, mode, reviewActions]);

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
        edit: editPaths.has(file.path),
        version: renderVersion,
        annotations: buildPierreReviewAnnotations(file, reviewActions),
      });
    }

    flush();
    return result;
  }, [editPaths, files, mode, renderVersion, reviewActions]);

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

  // Hydrates full file contents for the editor. Only added files can be
  // hydrated today: the daemon's `fs.file.read` returns the working-tree
  // (new) side, and there is no `git show <rev>:<path>` RPC to fetch the
  // old side for modified files yet. Modified/deleted diffs return null so
  // pierre keeps them partial and read-only.
  const loadDiffFiles = useCallback(
    async (
      fileDiff: import("@pierre/diffs").FileDiffMetadata,
    ): Promise<import("@pierre/diffs").FileDiffLoadedFiles | null> => {
      const ctx = editContextRef.current;
      const c = clientRef.current;
      const file = filesRef.current.find((f) => f.path === fileDiff.name);
      if (!ctx || !c || !file?.isNew) {
        return null;
      }
      const read = await c.readFile(ctx.cwd, file.path).catch(() => null);
      if (!read || read.kind !== "text") {
        return null;
      }
      return {
        oldFile: { name: file.path, contents: "" },
        newFile: {
          name: file.path,
          contents: new TextDecoder().decode(read.bytes),
        },
      };
    },
    [],
  );

  const handleToggleEdit = useCallback((itemId: string) => {
    if (editContextRef.current == null) {
      return;
    }
    // Clearing the CodeView selection before the items rebuild prevents
    // pierre's InteractionManager from re-rendering a selection against the
    // post-edit re-rendered rows (gutter/content child mismatch crash).
    viewerRef.current?.clearSelectedLines();
    const wasEditing = editPathsRef.current.has(itemId);
    setEditPaths((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
    if (!wasEditing) {
      // pierre's attach-time editor sync is deferred behind an async
      // highlighter load; a subsequent items rebuild can recycle the
      // container before that promise resolves and the editable surface
      // never renders. Poll: re-sync until the surface is actually mounted.
      let attempts = 0;
      const syncUntilMounted = () => {
        attempts += 1;
        if (attempts > 12) {
          return;
        }
        const viewer = viewerRef.current?.getInstance() as
          | {
              items?: Array<{
                item?: { id?: string };
                instance?: { syncRenderViewToEditor(): void; fileContainer?: HTMLElement | null };
              }>;
            }
          | undefined;
        const record = viewer?.items?.find((entry) => entry.item?.id === itemId);
        const instance = record?.instance;
        const surfaceMounted =
          instance?.fileContainer?.shadowRoot?.querySelector(
            "[contenteditable], [data-editor-overlay]",
          ) != null;
        if (surfaceMounted) {
          return;
        }
        instance?.syncRenderViewToEditor();
        setTimeout(syncUntilMounted, 800);
      };
      setTimeout(syncUntilMounted, 400);
    }
  }, []);

  const renderEditToggle = useCallback(
    (item: CodeViewItem<PierreReviewAnnotation>): React.ReactNode => {
      if (item.type !== "diff" || editContextRef.current == null) {
        return null;
      }
      // Only added files are editable until the daemon can serve the old
      // side for modified files.
      const file = filesByPath.get(item.id);
      if (!file?.isNew) {
        return null;
      }
      return (
        <EditToggle
          itemId={item.id}
          label={t("workspace.git.diff.editFile")}
          onToggle={handleToggleEdit}
        />
      );
    },
    [filesByPath, handleToggleEdit, t],
  );

  const handleItemEditComplete = useCallback(
    (item: CodeViewItem<PierreReviewAnnotation>, file: FileContents) => {
      const ctx = editContextRef.current;
      const c = clientRef.current;
      if (!ctx || !c) {
        return;
      }
      // Turn the item back to read-only immediately; the refreshed working
      // diff replaces the item content once the daemon applies the write.
      setEditPaths((current) => {
        if (!current.has(item.id)) {
          return current;
        }
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      void (async () => {
        // Fetch the current version so the daemon's optimistic-concurrency
        // check catches edits that landed while the file was being edited.
        const read = await c.readFile(ctx.cwd, item.id).catch(() => null);
        const result = await c
          .writeFile({
            cwd: ctx.cwd,
            path: item.id,
            content: file.contents,
            expectedModifiedAt: read?.modifiedAt ?? "",
            expectedRevision: read?.revision,
          })
          .catch(() => ({ status: "error" as const, error: "write failed" }));
        if (result.status === "conflict" && result.version?.status === "missing") {
          // The diff paths are repo-relative; a subdir-rooted workspace cannot
          // resolve them for writes (pre-existing app-wide limitation).
          toast.show(t("workspace.git.diff.saveError"));
        } else if (result.status === "conflict") {
          toast.show(t("workspace.git.diff.saveConflict"));
        } else if (result.status === "error") {
          toast.show(t("workspace.git.diff.saveError"));
        } else {
          toast.show(t("workspace.git.diff.saved"));
        }
      })();
    },
    [t, toast],
  );

  const createEditor = useMemo<CreateEditor<PierreReviewAnnotation>>(
    () => (options) => new Editor(options),
    [],
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

  const renderItemHeaderMetadata = useCallback(
    (item: CodeViewItem<PierreReviewAnnotation>): React.ReactNode => (
      <View style={styles.headerMetaRow}>
        {renderHeaderMetadata(item)}
        {renderEditToggle(item)}
      </View>
    ),
    [renderEditToggle, renderHeaderMetadata],
  );

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
    <EditProvider createEditor={createEditor}>
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
                renderHeaderMetadata={renderItemHeaderMetadata}
                renderHeaderPrefix={renderHeaderPrefix}
                renderAnnotation={renderAnnotation}
                onGutterUtilityClick={handleGutterUtilityClick}
                onItemEditComplete={handleItemEditComplete}
                loadDiffFiles={loadDiffFiles}
                gutterUtilityEnabled={reviewActions != null}
              />
            </View>
          );
        })}
      </View>
    </EditProvider>
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
  headerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
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
  editButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  editButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
}));
