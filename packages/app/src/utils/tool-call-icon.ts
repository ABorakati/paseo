import { createElement, type ComponentType } from "react";
import {
  Bot,
  Brain,
  Eye,
  MicVocal,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "lucide-react-native";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { PaseoLogo } from "@/components/icons/paseo-logo";
import { GitHubIcon } from "@/components/icons/github-icon";
import { getFileIconSvg, getNamedIconSvg } from "@/components/material-file-icons";
import { getBrandedProviderIcon } from "@/components/provider-icons";
import { classifyShellCommand } from "@/utils/shell-command-icon";
import { resolveToolCallIconName, type ToolCallIcon } from "./tool-call-icon-name";

export type ToolCallIconComponent = ComponentType<{ size?: number; color?: string }>;

const ICON_COMPONENTS: Record<ToolCallIcon, ToolCallIconComponent> = {
  wrench: Wrench,
  square_terminal: SquareTerminal,
  eye: Eye,
  pencil: Pencil,
  search: Search,
  bot: Bot,
  sparkles: Sparkles,
  brain: Brain,
  mic_vocal: MicVocal,
  paseo: PaseoLogo,
};

export function componentForToolCallIcon(name: ToolCallIcon): ToolCallIconComponent {
  return ICON_COMPONENTS[name];
}

export function resolveToolCallIcon(
  toolName: string,
  detail?: ToolCallDetail,
): ToolCallIconComponent {
  return componentForToolCallIcon(resolveToolCallIconName(toolName, detail));
}

/**
 * The visual to render for a tool-call row. Either a theme-tinted icon
 * component (the historical monochrome Lucide/brand path) or a pre-coloured
 * SVG string that renders as-is via `SvgXml`.
 */
export type ResolvedToolCallVisual =
  | { kind: "component"; Component: ToolCallIconComponent; emphasis?: ToolCallIconEmphasis }
  | { kind: "svg"; xml: string }
  // The "Thinking" row: rendered as the animated working indicator while the
  // thought is live and a calm accent brain once it settles. Carries no payload
  // — the badge owns the live/rest split via its loading state.
  | { kind: "thinking" };

/**
 * How strongly a theme-tinted component icon is coloured.
 * - `"muted"` (default): the historical behaviour — muted at rest, foreground
 *   when the row is active/hovered.
 * - `"always"`: full foreground strength regardless of active state. Used for
 *   monochrome icons that should read as black/white rather than the muted grey
 *   (e.g. the terminal icon for plain shell commands).
 */
export type ToolCallIconEmphasis = "muted" | "always";

export interface ResolveToolCallVisualInput {
  toolName: string;
  detail?: ToolCallDetail;
  provider?: string;
}

function componentVisual(
  Component: ToolCallIconComponent,
  emphasis?: ToolCallIconEmphasis,
): ResolvedToolCallVisual {
  return { kind: "component", Component, emphasis };
}

// Provider icon components require `{ size, color }`, whereas the tool-call
// icon slot passes optional props. Adapt a branded provider icon to the
// tool-call component contract, defaulting size/color the same way the badge
// and sheet already supply them.
function providerVisual(provider: string): ResolvedToolCallVisual {
  const Provider = getBrandedProviderIcon(provider);
  const ProviderToolCallIcon: ToolCallIconComponent = ({ size = 12, color = "currentColor" }) =>
    createElement(Provider, { size, color });
  ProviderToolCallIcon.displayName = `ProviderToolCallIcon(${provider})`;
  return componentVisual(ProviderToolCallIcon);
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function svgVisual(xml: string | null): ResolvedToolCallVisual | null {
  return xml ? { kind: "svg", xml } : null;
}

/**
 * Content-aware upgrade for a specific detail payload. Returns a coloured SVG
 * (or a brand/GitHub component) when the detail carries enough signal, or
 * `null` to fall through to the historical tinted-component path.
 */
function resolveDetailVisual(
  detail: ToolCallDetail,
  provider?: string,
): ResolvedToolCallVisual | null {
  switch (detail.type) {
    case "read":
    case "edit":
    case "write": {
      const filePath = detail.filePath?.trim();
      return filePath ? { kind: "svg", xml: getFileIconSvg(basename(filePath)) } : null;
    }
    case "shell": {
      const kind = classifyShellCommand(detail.command);
      if (kind === "gh") {
        // GitHub's mark is monochrome by brand; keep it theme-tinted.
        return componentVisual(GitHubIcon);
      }
      if (kind === "git") {
        return svgVisual(getNamedIconSvg("git"));
      }
      // Plain shell: a monochrome terminal at full foreground strength — reads
      // as black/white rather than the coloured material console or muted grey.
      return componentVisual(SquareTerminal, "always");
    }
    case "fetch":
      return svgVisual(getNamedIconSvg("http"));
    case "search":
      return detail.toolName === "web_search" ? svgVisual(getNamedIconSvg("http")) : null;
    case "sub_agent":
      return provider && provider.trim() ? providerVisual(provider) : null;
    default:
      return null;
  }
}

/**
 * Resolve a coloured, content-aware visual for a tool-call row, falling back
 * to the historical theme-tinted Lucide component when no richer signal is
 * available. The special cases that `resolveToolCallIconName` already handles
 * (plain_text.icon, thinking, speak, paseo tools, task) are preserved by
 * delegating to the component resolver for anything not explicitly upgraded
 * to a coloured SVG here.
 */
export function resolveToolCallVisual(input: ResolveToolCallVisualInput): ResolvedToolCallVisual {
  const { toolName, detail, provider } = input;

  // "Thinking" rows get a dedicated animated accent indicator instead of the
  // muted brain. Mirrors the condition in resolveToolCallIconName.
  if (toolName.trim().toLowerCase() === "thinking" && (!detail || detail.type === "unknown")) {
    return { kind: "thinking" };
  }

  // Preserve the plain_text.icon override ahead of any content-aware upgrade
  // so a tool that pins its own icon keeps it.
  if (detail?.type === "plain_text" && detail.icon) {
    return componentVisual(resolveToolCallIcon(toolName, detail));
  }

  if (detail) {
    const detailVisual = resolveDetailVisual(detail, provider);
    if (detailVisual) {
      return detailVisual;
    }
  }

  // task tool routes to a provider icon when we know the provider.
  if (toolName.trim().toLowerCase() === "task" && provider && provider.trim()) {
    return providerVisual(provider);
  }

  return componentVisual(resolveToolCallIcon(toolName, detail));
}
