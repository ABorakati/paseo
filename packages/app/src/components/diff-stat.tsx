import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";

interface DiffStatProps {
  additions: number;
  deletions: number;
  testID?: string;
  /** Vivid diff-palette colors (diffAddition/diffDeletion) for diff contexts;
   * the muted status palette is the default everywhere else. */
  variant?: "muted" | "vivid";
}

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatDiffCount(value: number): string {
  return compactFormatter.format(value).toLowerCase();
}

export function DiffStat({ additions, deletions, testID, variant = "muted" }: DiffStatProps) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={variant === "vivid" ? styles.additionsVivid : styles.additions}>
        +{formatDiffCount(additions)}
      </Text>
      <Text style={variant === "vivid" ? styles.deletionsVivid : styles.deletions}>
        -{formatDiffCount(deletions)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 20,
    gap: 4,
    flexShrink: 0,
  },
  additions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusMutedSuccess,
  },
  deletions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusMutedDanger,
  },
  additionsVivid: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffAddition,
  },
  deletionsVivid: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffDeletion,
  },
}));
