import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, ChevronDown, ChevronRight, Pencil } from "lucide-react-native";
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
import { buildPierreDiffUnsafeCss } from "@/git/pierre-diff-theme.web";
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
const activePencilColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const ThemedCheck = withUnistyles(Check);
const checkColorMapping = (theme: Theme) => ({ color: theme.colors.statusMutedSuccess });
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const chevronColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

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
const saveButtonPressableStyle = ({ pressed }: PressableState) => [
  styles.saveButton,
  pressed && styles.saveButtonPressed,
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
      accessibilityLabel={collapsed ? "Expand file" : "Collapse file"}
      onPress={handlePress}
      testID={`diff-file-collapse-${itemId}`}
      style={collapseButtonPressableStyle}
    >
      {collapsed ? (
        <ThemedChevronRight size={14} uniProps={chevronColorMapping} />
      ) : (
        <ThemedChevronDown size={14} uniProps={chevronColorMapping} />
      )}
    </Pressable>
  );
}

interface EditToggleProps {
  itemId: string;
  label: string;
  active: boolean;
  onToggle: (itemId: string) => void;
}

function EditToggle({ itemId, label, active, onToggle }: EditToggleProps): React.JSX.Element {
  const handlePress = useCallback(() => onToggle(itemId), [itemId, onToggle]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handlePress}
      testID={`diff-file-edit-${itemId}`}
      style={editButtonPressableStyle}
    >
      <ThemedPencil size={14} uniProps={active ? activePencilColorMapping : pencilColorMapping} />
    </Pressable>
  );
}

interface SaveButtonProps {
  itemId: string;
  label: string;
  onSave: (itemId: string) => void;
}

function SaveButton({ itemId, label, onSave }: SaveButtonProps): React.JSX.Element {
  const handlePress = useCallback(() => onSave(itemId), [itemId, onSave]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handlePress}
      testID={`diff-file-save-${itemId}`}
      style={saveButtonPressableStyle}
    >
      <ThemedCheck size={14} uniProps={checkColorMapping} />
    </Pressable>
  );
}

// The diffs-container host sizes itself from this style; without an explicit
// flex fill it collapses to 0 height inside the flex column and the
// virtualizer renders nothing.
const CODE_VIEW_HOST_STYLE = {
  flex: 1,
  minHeight: 0,
  // The CodeView root is the scroll container; without overflow-y it stays
  // overflow:visible and the diff content overflows the pane instead of
  // scrolling (the diffshub sets these via Tailwind className).
  overflowY: "auto" as const,
  overflowX: "clip" as const,
  overscrollBehaviorY: "contain" as const,
} as const;

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
  onItemEditChange?: (item: CodeViewItem<PierreReviewAnnotation>, file: FileContents) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onDoubleClick?: (event: MouseEvent) => void;
  loadDiffFiles?: (
    fileDiff: import("@pierre/diffs").FileDiffMetadata,
  ) => Promise<import("@pierre/diffs").FileDiffLoadedFiles | null>;
  gutterUtilityEnabled: boolean;
  viewerRef: React.Ref<CodeViewHandle<PierreReviewAnnotation>>;
  // Injected by the withUnistyles wrapper below — docs/unistyles.md bans useUnistyles.
  themeType: "light" | "dark";
  theme: Theme;
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
  onItemEditChange,
  onItemEditComplete,
  onKeyDown,
  onDoubleClick,
  loadDiffFiles,
  gutterUtilityEnabled,
  viewerRef,
  theme,
}: PierreCodeViewProps): React.JSX.Element {
  const options = useMemo(() => {
    const base = buildPierreDiffOptions({ themeType, wrapLines, layout });
    return {
      ...base,
      enableGutterUtility: gutterUtilityEnabled,
      onGutterUtilityClick,
      loadDiffFiles,
      // Pins the file header while scrolling and restyles the whole diff
      // surface from the paseo theme (pierre's stickyHeaders option breaks
      // the virtualizer in this layout, and its github shiki chrome clashes
      // with the app themes).
      unsafeCSS: buildPierreDiffUnsafeCss(theme),
    } as CodeViewReactOptions<PierreReviewAnnotation>;
  }, [
    gutterUtilityEnabled,
    layout,
    loadDiffFiles,
    onGutterUtilityClick,
    theme,
    themeType,
    wrapLines,
  ]);

  // The CodeView root is the scroll container; double-click to start editing
  // and ctrl/cmd+s to save both need to be caught at this level so they work
  // regardless of where the pointer/focus is inside the content.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setHostRef = useCallback((node: HTMLDivElement | null) => {
    hostRef.current = node;
  }, []);
  useEffect(() => {
    const host = hostRef.current;
    if (host == null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => onKeyDown?.(event);
    const handleDoubleClick = (event: MouseEvent) => onDoubleClick?.(event);
    host.addEventListener("keydown", handleKeyDown);
    host.addEventListener("dblclick", handleDoubleClick);
    return () => {
      host.removeEventListener("keydown", handleKeyDown);
      host.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [onDoubleClick, onKeyDown]);

  return (
    <CodeView<PierreReviewAnnotation>
      ref={viewerRef}
      items={items}
      options={options}
      containerRef={setHostRef}
      renderHeaderMetadata={renderHeaderMetadata}
      renderHeaderPrefix={renderHeaderPrefix}
      renderAnnotation={renderAnnotation}
      onItemEditChange={onItemEditChange}
      onItemEditComplete={onItemEditComplete}
      style={CODE_VIEW_HOST_STYLE}
    />
  );
}

// The app has 6 unistyles themes; only "light" is light.
const ThemedPierreCodeView = withUnistyles(PierreCodeView, (theme, rt) => ({
  themeType: rt.themeName === "light" ? ("light" as const) : ("dark" as const),
  theme,
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

  // Files with unsaved edits (dirty dot) and the latest FileContents per
  // editing item, so Ctrl+S / the save button can write without a live
  // editor handle.
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(() => new Set());
  const dirtyPathsRef = useRef(dirtyPaths);
  dirtyPathsRef.current = dirtyPaths;
  const latestContentsRef = useRef(new Map<string, FileContents>());

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
      return <DiffStat additions={file.additions} deletions={file.deletions} variant="vivid" />;
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
          active={editPaths.has(item.id)}
          onToggle={handleToggleEdit}
        />
      );
    },
    [editPaths, filesByPath, handleToggleEdit, t],
  );

  const handleItemEditChange = useCallback(
    (item: CodeViewItem<PierreReviewAnnotation>, file: FileContents) => {
      latestContentsRef.current.set(item.id, file);
      setDirtyPaths((current) => {
        if (current.has(item.id)) {
          return current;
        }
        const next = new Set(current);
        next.add(item.id);
        return next;
      });
    },
    [],
  );

  // Shared write: optimistic-concurrency check via a fresh read, then the
  // write. The daemon retries repo-relative paths at the git worktree root.
  // Returns whether the write landed.
  const writeFileContents = useCallback(
    async (itemId: string, file: FileContents): Promise<boolean> => {
      const ctx = editContextRef.current;
      const c = clientRef.current;
      if (!ctx || !c) {
        return false;
      }
      const read = await c.readFile(ctx.cwd, itemId).catch(() => null);
      const result = await c
        .writeFile({
          cwd: ctx.cwd,
          path: itemId,
          content: file.contents,
          expectedModifiedAt: read?.modifiedAt ?? "",
          expectedRevision: read?.revision,
        })
        .catch(() => ({ status: "error" as const, error: "write failed" }));
      if (result.status === "conflict" && result.version?.status === "missing") {
        // The diff paths are repo-relative; the daemon retries writes at the
        // git worktree root when the target is missing at the request cwd, so
        // this only fires when the file does not exist anywhere in the repo.
        toast.show(t("workspace.git.diff.saveError"));
        return false;
      }
      if (result.status === "conflict") {
        toast.show(t("workspace.git.diff.saveConflict"));
        return false;
      }
      if (result.status === "error") {
        toast.show(t("workspace.git.diff.saveError"));
        return false;
      }
      toast.show(t("workspace.git.diff.saved"));
      return true;
    },
    [t, toast],
  );

  // Save without leaving edit mode (Ctrl+S / save button): keeps the session
  // open and clears the dirty dot on success.
  const handleSaveItem = useCallback(
    (itemId: string) => {
      const file = latestContentsRef.current.get(itemId);
      if (!file) {
        return;
      }
      void writeFileContents(itemId, file).then((saved) => {
        if (saved) {
          setDirtyPaths((current) => {
            if (!current.has(itemId)) {
              return current;
            }
            const next = new Set(current);
            next.delete(itemId);
            return next;
          });
        }
        return saved;
      });
    },
    [writeFileContents],
  );

  // Ctrl/Cmd+S saves every editing file with unsaved changes; the browser's
  // default "save page" is suppressed.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      if (editPathsRef.current.size === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      for (const itemId of editPathsRef.current) {
        if (dirtyPathsRef.current.has(itemId)) {
          handleSaveItem(itemId);
        }
      }
    },
    [handleSaveItem],
  );

  // Double-click on a file's code area starts editing (only added files are
  // editable until the daemon can serve the old side of modified files).
  const handleDoubleClick = useCallback(
    (event: MouseEvent) => {
      if (editContextRef.current == null) {
        return;
      }
      // Header clicks (collapse toggle, stat, buttons) never start editing.
      if (
        event
          .composedPath()
          .some((el) => el instanceof HTMLElement && el.hasAttribute("data-diffs-header"))
      ) {
        return;
      }
      const container = event
        .composedPath()
        .find((el) => el instanceof HTMLElement && el.tagName === "DIFFS-CONTAINER");
      if (!(container instanceof HTMLElement)) {
        return;
      }
      const viewer = viewerRef.current?.getInstance() as
        | {
            items?: Array<{ item?: { id?: string }; element?: HTMLElement | null }>;
          }
        | undefined;
      const record = viewer?.items?.find((entry) => entry.element === container);
      const itemId = record?.item?.id;
      if (!itemId || editPathsRef.current.has(itemId)) {
        return;
      }
      const file = filesRef.current.find((f) => f.path === itemId);
      if (!file?.isNew) {
        return;
      }
      handleToggleEdit(itemId);
    },
    [handleToggleEdit],
  );

  const handleItemEditComplete = useCallback(
    (item: CodeViewItem<PierreReviewAnnotation>, file: FileContents) => {
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
      setDirtyPaths((current) => {
        if (!current.has(item.id)) {
          return current;
        }
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      latestContentsRef.current.delete(item.id);
      void writeFileContents(item.id, file);
    },
    [writeFileContents],
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
    (item: CodeViewItem<PierreReviewAnnotation>): React.ReactNode => {
      const editing = editPaths.has(item.id);
      const dirty = dirtyPaths.has(item.id);
      return (
        <View style={styles.headerMetaRow}>
          {renderHeaderMetadata(item)}
          {editing && dirty ? (
            <View
              style={styles.dirtyDot}
              testID={`diff-file-dirty-${item.id}`}
              accessibilityLabel={t("workspace.git.diff.unsavedChanges")}
            />
          ) : null}
          {editing && dirty ? (
            <SaveButton
              itemId={item.id}
              label={t("workspace.git.diff.saveFile")}
              onSave={handleSaveItem}
            />
          ) : null}
          {renderEditToggle(item)}
        </View>
      );
    },
    [dirtyPaths, editPaths, handleSaveItem, renderEditToggle, renderHeaderMetadata, t],
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
                onItemEditChange={handleItemEditChange}
                onItemEditComplete={handleItemEditComplete}
                onKeyDown={handleKeyDown}
                onDoubleClick={handleDoubleClick}
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
  saveButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  saveButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusWarning,
  },
}));
