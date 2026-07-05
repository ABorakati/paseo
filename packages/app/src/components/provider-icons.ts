import { Bot, PackagePlus } from "lucide-react-native";
import { createElement, type ComponentType } from "react";
import { SvgXml } from "react-native-svg";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { CopilotIcon } from "@/components/icons/copilot-icon";
import { MiniMaxIcon } from "@/components/icons/minimax-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OmpIcon } from "@/components/icons/omp-icon";
import { PiIcon } from "@/components/icons/pi-icon";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { resolveProviderIconName } from "@/components/provider-icon-name";

export interface ProviderIconProps {
  size: number;
  color: string;
}

export type ProviderIconComponent = ComponentType<ProviderIconProps>;

const BUILTIN_PROVIDER_ICONS: Record<string, ProviderIconComponent> = {
  claude: ClaudeIcon as unknown as ProviderIconComponent,
  codex: CodexIcon as unknown as ProviderIconComponent,
  copilot: CopilotIcon as unknown as ProviderIconComponent,
  kiro: PackagePlus,
  minimax: MiniMaxIcon as unknown as ProviderIconComponent,
  omp: OmpIcon as unknown as ProviderIconComponent,
  opencode: OpenCodeIcon as unknown as ProviderIconComponent,
  pi: PiIcon as unknown as ProviderIconComponent,
};

const CATALOG_ICON_SVGS = new Map(
  ACP_PROVIDER_CATALOG.flatMap((entry) => (entry.iconSvg ? [[entry.id, entry.iconSvg]] : [])),
);

const catalogIconComponents = new Map<string, ProviderIconComponent>();

function createCatalogIcon(provider: string, iconSvg: string): ProviderIconComponent {
  const CatalogProviderIcon: ProviderIconComponent = ({ size, color }) =>
    createElement(SvgXml, {
      xml: iconSvg,
      width: size,
      height: size,
      color,
    });
  CatalogProviderIcon.displayName = `CatalogProviderIcon(${provider})`;
  return CatalogProviderIcon;
}

function getCatalogProviderIcon(provider: string): ProviderIconComponent {
  const cached = catalogIconComponents.get(provider);
  if (cached) {
    return cached;
  }
  const iconSvg = CATALOG_ICON_SVGS.get(provider);
  if (!iconSvg) {
    return Bot;
  }
  const icon = createCatalogIcon(provider, iconSvg);
  catalogIconComponents.set(provider, icon);
  return icon;
}

export function getProviderIcon(provider: string): ProviderIconComponent {
  const name = resolveProviderIconName(provider);
  if (name.kind === "builtin") {
    return BUILTIN_PROVIDER_ICONS[name.id];
  }
  if (name.kind === "catalog") {
    return getCatalogProviderIcon(name.id);
  }
  return Bot;
}

// Brand colors for providers whose mark has a real, both-theme-safe brand
// color. Anthropic's clay/orange (claude) and MiniMax's red both read
// cleanly on light and dark surfaces, so those providers render in brand
// color everywhere instead of theme-muted foreground.
//
// Everything else here is a monochrome logomark (codex, opencode, copilot,
// pi, omp) or a generic Lucide fallback (kiro) with no brand color baked
// into the shape — those stay theme-tinted so they don't vanish in dark
// mode. ACP catalog icons render from `currentColor` SVG strings and are
// intentionally excluded for the same reason.
const PROVIDER_BRAND_COLORS: Record<string, string> = {
  claude: "#D97757",
  minimax: "#F23F5D",
};

const brandedProviderIconCache = new Map<string, ProviderIconComponent>();

function normalizeProviderId(provider: string | null | undefined): string {
  return (provider ?? "").trim().toLowerCase();
}

function createBrandedProviderIcon(provider: string, normalizedId: string): ProviderIconComponent {
  const BrandedProviderIcon: ProviderIconComponent = ({ size, color }) => {
    const Icon = getProviderIcon(provider);
    const brandColor = PROVIDER_BRAND_COLORS[normalizedId] ?? color;
    return createElement(Icon, { size, color: brandColor });
  };
  BrandedProviderIcon.displayName = `BrandedProviderIcon(${provider})`;
  return BrandedProviderIcon;
}

/**
 * Drop-in replacement for `getProviderIcon` that renders providers with a
 * real brand color (see `PROVIDER_BRAND_COLORS`) in that color everywhere,
 * and falls back to the caller-supplied `color` (typically a theme-muted
 * foreground) for every other provider. Same `{size, color}` component
 * signature as `getProviderIcon`, memoised per provider id.
 */
export function getBrandedProviderIcon(provider: string | null | undefined): ProviderIconComponent {
  const normalizedId = normalizeProviderId(provider);
  const cacheKey = provider ?? "";
  const cached = brandedProviderIconCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const icon = createBrandedProviderIcon(provider ?? "", normalizedId);
  brandedProviderIconCache.set(cacheKey, icon);
  return icon;
}
