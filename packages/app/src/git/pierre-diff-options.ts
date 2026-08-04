import type { BaseDiffOptions } from "@pierre/diffs";

export function buildPierreDiffOptions(input: {
  themeType: "light" | "dark";
  wrapLines: boolean;
  layout: "unified" | "split";
}): BaseDiffOptions {
  const { themeType, wrapLines, layout } = input;
  return {
    themeType,
    theme: themeType === "dark" ? "github-dark-default" : "github-light-default",
    diffStyle: layout,
    overflow: wrapLines ? "wrap" : "scroll",
    diffIndicators: "bars",
    hunkSeparators: "line-info",
    expandUnchanged: false,
  };
}
