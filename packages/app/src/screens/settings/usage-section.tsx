import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  UsageBalanceReading,
  UsageLimitPluginSnapshot,
  UsageLimitUnit,
  UsageQuotaReading,
  UsageRateReading,
  UsageReading,
} from "@getpaseo/protocol/usage-limits/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useUsageLimits } from "@/hooks/use-usage-limits";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { formatDuration } from "@/utils/time";

const EMPTY_HINT =
  'No usage limit plugins configured. Add them under "usageLimits.plugins" in config.json.';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

function formatCompactCount(value: number, divisor: number, suffix: string): string {
  const scaled = value / divisor;
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${rounded}${suffix}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return formatCompactCount(value, 1_000_000, "M");
  }
  if (value >= 1_000) {
    return formatCompactCount(value, 1_000, "K");
  }
  return Math.round(value).toString();
}

function formatUsageAmount(value: number, unit: UsageLimitUnit): string {
  if (unit === "usd") {
    return `$${value.toFixed(2)}`;
  }
  if (unit === "tokens") {
    return formatTokens(value);
  }
  if (unit === "percent") {
    return `${Math.round(value)}%`;
  }
  return Math.round(value).toLocaleString("en-US");
}

function formatBalanceAmount(value: number, unit: UsageLimitUnit, currency: string | null): string {
  if (!currency) {
    return formatUsageAmount(value, unit);
  }
  const code = currency.toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code];
  if (symbol) {
    return `${symbol}${value.toFixed(2)}`;
  }
  return `${value.toFixed(2)} ${code}`;
}

function formatQuotaValue(reading: UsageQuotaReading): string {
  if (reading.used !== null && reading.limit !== null) {
    const used = formatUsageAmount(reading.used, reading.unit);
    const total = formatUsageAmount(reading.limit, reading.unit);
    return `${used} / ${total}`;
  }
  if (reading.remaining !== null) {
    return `${formatUsageAmount(reading.remaining, reading.unit)} left`;
  }
  if (reading.used !== null) {
    return formatUsageAmount(reading.used, reading.unit);
  }
  if (reading.percent !== null) {
    return `${Math.round(reading.percent)}% used`;
  }
  return "Unknown";
}

function formatBalanceValue(reading: UsageBalanceReading): string {
  if (reading.remaining !== null && reading.total !== null) {
    const remaining = formatBalanceAmount(reading.remaining, reading.unit, reading.currency);
    const total = formatBalanceAmount(reading.total, reading.unit, reading.currency);
    return `${remaining} of ${total}`;
  }
  if (reading.remaining !== null) {
    return formatBalanceAmount(reading.remaining, reading.unit, reading.currency);
  }
  if (reading.total !== null) {
    return formatBalanceAmount(reading.total, reading.unit, reading.currency);
  }
  return "Unknown";
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function resolveQuotaPercent(reading: UsageQuotaReading): number | null {
  if (reading.percent !== null) {
    return clampPercent(reading.percent);
  }
  if (reading.used !== null && reading.limit !== null && reading.limit > 0) {
    return clampPercent((reading.used / reading.limit) * 100);
  }
  return null;
}

function formatRelativeHint(prefix: string, timestamp: string | null): string | null {
  if (!timestamp) {
    return null;
  }
  const targetMs = Date.parse(timestamp);
  if (Number.isNaN(targetMs)) {
    return null;
  }
  const remainingMs = targetMs - Date.now();
  if (remainingMs <= 0) {
    return null;
  }
  return `${prefix} ${formatDuration(remainingMs)}`;
}

function usageBarFillStyle(usedPercent: number) {
  if (usedPercent > 90) {
    return styles.barCritical;
  }
  if (usedPercent >= 70) {
    return styles.barWarning;
  }
  return styles.barNormal;
}

interface UsageBarProps {
  /** How much of the track to paint, 0-100. */
  fillPercent: number;
  /** How much of the allowance is consumed, 0-100. Drives the bar color. */
  usedPercent: number;
  testID: string;
}

function UsageBar({ fillPercent, usedPercent, testID }: UsageBarProps) {
  const fillStyle = useMemo(
    () => [
      usageBarFillStyle(usedPercent),
      inlineUnistylesStyle({ width: `${fillPercent}%` as const }),
    ],
    [fillPercent, usedPercent],
  );
  return (
    <View style={styles.barTrack} testID={testID}>
      <View style={fillStyle} />
    </View>
  );
}

interface ReadingRowProps {
  reading: UsageReading;
  showBorder: boolean;
}

function ReadingRowShell({
  showBorder,
  testID,
  children,
}: {
  showBorder: boolean;
  testID: string;
  children: ReactNode;
}) {
  return (
    <View style={showBorder ? BORDERED_READING_ROW : READING_ROW} testID={testID}>
      {children}
    </View>
  );
}

function QuotaRow({ reading, showBorder }: { reading: UsageQuotaReading; showBorder: boolean }) {
  const percent = resolveQuotaPercent(reading);
  const resetHint = formatRelativeHint("Resets in", reading.window?.resetsAt ?? null);
  return (
    <ReadingRowShell showBorder={showBorder} testID={`usage-reading-${reading.id}`}>
      <View style={styles.readingHeader}>
        <View style={styles.readingTitle}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {reading.label}
          </Text>
          {reading.window ? <Text style={styles.qualifier}>{reading.window.label}</Text> : null}
        </View>
        <Text style={styles.readingValue}>{formatQuotaValue(reading)}</Text>
      </View>
      <UsageBar
        fillPercent={percent ?? 0}
        usedPercent={percent ?? 0}
        testID={`usage-bar-${reading.id}`}
      />
      {resetHint ? <Text style={styles.hintText}>{resetHint}</Text> : null}
    </ReadingRowShell>
  );
}

function BalanceRow({
  reading,
  showBorder,
}: {
  reading: UsageBalanceReading;
  showBorder: boolean;
}) {
  const remainingPercent =
    reading.percentRemaining === null ? null : clampPercent(reading.percentRemaining);
  return (
    <ReadingRowShell showBorder={showBorder} testID={`usage-reading-${reading.id}`}>
      <View style={styles.readingHeader}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {reading.label}
        </Text>
        <Text style={styles.readingValue}>{formatBalanceValue(reading)}</Text>
      </View>
      {remainingPercent === null ? null : (
        <UsageBar
          fillPercent={remainingPercent}
          usedPercent={100 - remainingPercent}
          testID={`usage-bar-${reading.id}`}
        />
      )}
      {remainingPercent === null ? null : (
        <Text style={styles.hintText}>{`${Math.round(remainingPercent)}% remaining`}</Text>
      )}
    </ReadingRowShell>
  );
}

function RateRow({ reading, showBorder }: { reading: UsageRateReading; showBorder: boolean }) {
  const changesHint = formatRelativeHint("Changes in", reading.changesAt);
  return (
    <ReadingRowShell showBorder={showBorder} testID={`usage-reading-${reading.id}`}>
      <View style={styles.readingHeader}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {reading.label}
        </Text>
        <View style={styles.rateTrailing}>
          <StatusBadge label={reading.state} />
          {reading.multiplier === null ? null : (
            <Text style={styles.readingValue}>{`${reading.multiplier}×`}</Text>
          )}
        </View>
      </View>
      {reading.detail ? <Text style={styles.hintText}>{reading.detail}</Text> : null}
      {changesHint ? <Text style={styles.hintText}>{changesHint}</Text> : null}
    </ReadingRowShell>
  );
}

function ReadingRow({ reading, showBorder }: ReadingRowProps) {
  if (reading.kind === "quota") {
    return <QuotaRow reading={reading} showBorder={showBorder} />;
  }
  if (reading.kind === "balance") {
    return <BalanceRow reading={reading} showBorder={showBorder} />;
  }
  return <RateRow reading={reading} showBorder={showBorder} />;
}

interface ReadingGroup {
  key: string;
  label: string | null;
  readings: UsageReading[];
}

/**
 * Ungrouped readings lead, then each `group` in first-appearance order. The
 * server emits readings in config order; nothing else re-sorts them.
 */
function groupReadings(readings: UsageReading[]): ReadingGroup[] {
  const ungrouped: UsageReading[] = [];
  const labelled: ReadingGroup[] = [];
  const byLabel = new Map<string, ReadingGroup>();

  for (const reading of readings) {
    if (reading.group === null) {
      ungrouped.push(reading);
      continue;
    }
    const existing = byLabel.get(reading.group);
    if (existing) {
      existing.readings.push(reading);
      continue;
    }
    const group: ReadingGroup = {
      key: reading.group,
      label: reading.group,
      readings: [reading],
    };
    byLabel.set(reading.group, group);
    labelled.push(group);
  }

  if (ungrouped.length === 0) {
    return labelled;
  }
  return [{ key: "ungrouped", label: null, readings: ungrouped }, ...labelled];
}

function HintRow({ hint, showBorder }: { hint: string; showBorder: boolean }) {
  return (
    <View style={showBorder ? BORDERED_HINT_ROW : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={styles.hintText}>{hint}</Text>
      </View>
    </View>
  );
}

function HintCard({ hint }: { hint: string }) {
  return (
    <View style={settingsStyles.card}>
      <HintRow hint={hint} showBorder={false} />
    </View>
  );
}

function PluginReadings({ readings }: { readings: UsageReading[] }) {
  return (
    <>
      {groupReadings(readings).map((group) => (
        <View key={group.key}>
          {group.label ? (
            <View style={GROUP_HEADER_ROW}>
              <Text style={styles.groupLabel}>{group.label}</Text>
            </View>
          ) : null}
          {group.readings.map((reading, index) => (
            <ReadingRow
              key={reading.id}
              reading={reading}
              showBorder={group.label === null || index > 0}
            />
          ))}
        </View>
      ))}
    </>
  );
}

function PluginBody({ plugin }: { plugin: UsageLimitPluginSnapshot }) {
  if (plugin.status === "error") {
    return (
      <View style={ALERT_ROW}>
        <Alert
          variant="error"
          title="Unable to load usage"
          description={plugin.error ?? "The host did not report a reason."}
          testID={`usage-plugin-error-${plugin.pluginId}`}
        />
      </View>
    );
  }
  if (plugin.status === "disabled") {
    return <HintRow hint="Disabled in config.json" showBorder />;
  }
  if (plugin.readings.length === 0) {
    return <HintRow hint="No readings reported" showBorder />;
  }
  return <PluginReadings readings={plugin.readings} />;
}

function PluginCard({ plugin }: { plugin: UsageLimitPluginSnapshot }) {
  return (
    <View style={settingsStyles.card} testID={`usage-plugin-${plugin.pluginId}`}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{plugin.label}</Text>
          {plugin.description ? (
            <Text style={settingsStyles.rowHint}>{plugin.description}</Text>
          ) : null}
        </View>
      </View>
      <PluginBody plugin={plugin} />
    </View>
  );
}

interface UsageContentProps {
  isConnected: boolean;
  isUnsupported: boolean;
  isLoading: boolean;
  plugins: UsageLimitPluginSnapshot[] | null;
}

function UsageContent({ isConnected, isUnsupported, isLoading, plugins }: UsageContentProps) {
  if (!isConnected) {
    return <HintCard hint="Connect to a host to see usage limits" />;
  }
  if (isUnsupported) {
    return <HintCard hint="Update the host to see usage limits." />;
  }
  if (plugins === null) {
    return (
      <HintCard hint={isLoading ? "Loading usage limits..." : "Could not load usage limits"} />
    );
  }
  if (plugins.length === 0) {
    return <HintCard hint={EMPTY_HINT} />;
  }
  return (
    <>
      {plugins.map((plugin) => (
        <PluginCard key={plugin.pluginId} plugin={plugin} />
      ))}
    </>
  );
}

export function UsageSection({ serverId }: { serverId: string | null }) {
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const { snapshot, isLoading, isUnsupported, refresh } = useUsageLimits(serverId);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const canRefresh = isConnected && !isUnsupported;
  const refreshAction = useMemo(
    () =>
      canRefresh ? (
        <Button variant="ghost" size="sm" onPress={handleRefresh} testID="usage-refresh">
          Refresh
        </Button>
      ) : null,
    [canRefresh, handleRefresh],
  );

  return (
    <SettingsSection title="Usage limits" trailing={refreshAction}>
      <UsageContent
        isConnected={isConnected}
        isUnsupported={isUnsupported}
        isLoading={isLoading}
        plugins={snapshot?.plugins ?? null}
      />
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  hintText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  readingRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[2],
  },
  readingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  readingTitle: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  readingValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  qualifier: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  rateTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  groupHeader: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  barTrack: {
    height: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  barNormal: {
    height: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  barWarning: {
    height: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.amber[500],
  },
  barCritical: {
    height: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.destructive,
  },
  alertSlot: {
    padding: theme.spacing[4],
  },
}));

const READING_ROW = [settingsStyles.row, styles.readingRow];
const BORDERED_READING_ROW = [settingsStyles.row, styles.readingRow, settingsStyles.rowBorder];
const BORDERED_HINT_ROW = [settingsStyles.row, settingsStyles.rowBorder];
const GROUP_HEADER_ROW = [styles.groupHeader, settingsStyles.rowBorder];
const ALERT_ROW = [styles.alertSlot, settingsStyles.rowBorder];
