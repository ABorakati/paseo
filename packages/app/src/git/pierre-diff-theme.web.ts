import type { Theme } from "@/styles/theme";

/**
 * pierre's own `stickyHeaders` option breaks the virtualizer in this layout,
 * so the file header is pinned with the same `[data-diffs-header]` rule
 * pierre applies for it. The theme vars are emitted into the `unsafe` CSS
 * layer, which outranks pierre's `rendered` layer, so the whole diff surface
 * (background, foreground, added/deleted/modified accents) follows the active
 * paseo theme instead of pierre's default github-dark/github-light chrome.
 */
export function buildPierreDiffUnsafeCss(theme: Theme): string {
  const { colors } = theme;
  return [
    "[data-diffs-header] {",
    "  position: sticky;",
    "  top: 0;",
    "  z-index: 1;",
    "  background-color: var(--diffs-bg);",
    "}",
    // pierre renders its own +/- counts in the header; the app's DiffStat
    // renders them themed (and now vivid), so hide the duplicates.
    "[data-additions-count], [data-deletions-count] { display: none; }",
    ":host {",
    `  --diffs-bg: ${colors.surface0};`,
    `  --diffs-fg: ${colors.foreground};`,
    `  --diffs-addition-color: ${colors.diffAddition};`,
    `  --diffs-deletion-color: ${colors.diffDeletion};`,
    `  --diffs-modified-color: ${colors.palette.blue[500]};`,
    // pierre's theme stylesheet paints the host directly with the shiki
    // theme's background; the unsafe layer outranks it, so paint it back
    // from the paseo palette.
    `  background-color: ${colors.surface0};`,
    "}",
  ].join("\n");
}
