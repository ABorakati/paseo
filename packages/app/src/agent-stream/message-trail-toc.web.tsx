import { useCallback, useMemo, useRef, useState } from "react";
import { View, Pressable, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ListTree } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import type { MessageTrailItem } from "./message-trail-items";

export interface MessageTrailTocProps {
  items: MessageTrailItem[];
  onJumpToMessage: (id: string) => void;
}

const ThemedListIcon = withUnistyles(ListTree);
const iconRestMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconActiveMapping = (theme: Theme) => ({ color: theme.colors.foreground });

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// Floating table of contents shown in place of the tick rail when the pane is too narrow.
// A small bottom-left button opens a searchable list of the conversation's user messages;
// picking one scrolls the chat to it.
export function MessageTrailToc({ items, onJumpToMessage }: MessageTrailTocProps) {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const allOptions = useMemo<ComboboxOption[]>(
    () => items.map((item) => ({ id: item.id, label: item.preview || `Message ${item.ordinal}` })),
    [items],
  );
  const options = useMemo<ComboboxOption[]>(() => {
    const query = normalize(searchQuery);
    if (!query) {
      return allOptions;
    }
    return allOptions.filter((option) => option.label.toLowerCase().includes(query));
  }, [allOptions, searchQuery]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setSearchQuery("");
    }
  }, []);

  const handleToggle = useCallback(() => setOpen((previous) => !previous), []);

  const handleSelect = useCallback(
    (id: string) => {
      onJumpToMessage(id);
      handleOpenChange(false);
    },
    [onJumpToMessage, handleOpenChange],
  );

  const header = useMemo<SheetHeader>(
    () => ({
      title: "Jump to message",
      search: {
        onChange: setSearchQuery,
        placeholder: "Search messages",
        testID: "message-trail-toc-search",
      },
    }),
    [],
  );

  const buttonStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType) => [
      styles.button,
      hovered && styles.buttonHovered,
      (pressed || open) && styles.buttonPressed,
    ],
    [open],
  );

  return (
    <>
      <View style={styles.floating} pointerEvents="box-none">
        <Pressable
          ref={anchorRef}
          collapsable={false}
          style={buttonStyle}
          onPress={handleToggle}
          accessibilityRole="button"
          accessibilityLabel="Jump to message"
          testID="message-trail-toc"
        >
          <ThemedListIcon size={18} uniProps={open ? iconActiveMapping : iconRestMapping} />
        </Pressable>
      </View>
      <Combobox
        options={options}
        value=""
        onSelect={handleSelect}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement="top-start"
        desktopMinWidth={280}
        header={header}
        emptyText="No matching messages"
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  floating: {
    position: "absolute",
    left: theme.spacing[3],
    bottom: theme.spacing[4],
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.sm,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface3,
  },
  buttonPressed: {
    backgroundColor: theme.colors.surface0,
  },
}));
