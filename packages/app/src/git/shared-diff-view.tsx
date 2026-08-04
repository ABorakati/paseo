import type { ComponentType, ReactElement } from "react";
import type { SharedDiffViewProps } from "@/git/diff-pane";

export type PlatformSharedDiffViewProps = SharedDiffViewProps & {
  fallback: ComponentType<SharedDiffViewProps>;
};

// Default (native) platform variant: render the existing RN implementation
// injected by the caller. Injection avoids a diff-pane <-> platform-module cycle.
export function SharedDiffView({
  fallback: RNSharedDiffView,
  ...props
}: PlatformSharedDiffViewProps): ReactElement {
  return <RNSharedDiffView {...props} />;
}
