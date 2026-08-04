import { useMemo, type ReactElement } from "react";
import { CodeView, type CodeViewDiffItem, type CodeViewReactOptions } from "@pierre/diffs/react";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { withUnistyles } from "react-native-unistyles";
import { buildPierreDiffOptions } from "@/git/pierre-diff-options";
import { parsedDiffFileToFileDiffMetadata } from "@/git/pierre-diffs-adapter";

interface DemoCodeViewProps {
  items: readonly CodeViewDiffItem[];
  // Injected by the withUnistyles wrapper below — docs/unistyles.md bans useUnistyles.
  themeType: "light" | "dark";
}

function DemoCodeView({ items, themeType }: DemoCodeViewProps): ReactElement {
  const options = useMemo(
    // CodeViewReactOptions narrows hunkSeparators ('custom' is vanilla-only);
    // buildPierreDiffOptions always emits 'line-info', so the cast is safe.
    () =>
      buildPierreDiffOptions({
        themeType,
        wrapLines: true,
        layout: "unified",
      }) as CodeViewReactOptions,
    [themeType],
  );
  return <CodeView items={items} options={options} />;
}

// The app has 6 unistyles themes; only "light" is light.
const ThemedDemoCodeView = withUnistyles(DemoCodeView, (_theme, rt) => ({
  themeType: rt.themeName === "light" ? ("light" as const) : ("dark" as const),
}));

export default function PierreChangesDemo({ files }: { files: ParsedDiffFile[] }): ReactElement {
  const items = useMemo<readonly CodeViewDiffItem[]>(
    () =>
      files.map((f) => ({
        id: f.path,
        type: "diff" as const,
        fileDiff: parsedDiffFileToFileDiffMetadata(f),
      })),
    [files],
  );
  return <ThemedDemoCodeView items={items} />;
}
