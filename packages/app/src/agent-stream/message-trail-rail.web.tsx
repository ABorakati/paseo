import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { MessageTrailItem } from "./message-trail-items";
import type { TrailAnchorSnapshot, TrailAnchorStore } from "./message-trail-anchor";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";

export interface MessageTrailRailProps {
  items: MessageTrailItem[];
  anchor: TrailAnchorStore;
  onJumpToMessage: (id: string) => void;
}

// Geometry (px). Ticks grow rightward toward the chat; the column is centered in a
// fixed-width rail region that sits in the left gutter, just outside the centered
// content column (see resolveRailLeft).
const RAIL_WIDTH = 40;
const TICK_HEIGHT = 2;
const TICK_HEIGHT_HOVER = 4; // hovered tick reads thicker, not just longer
const TICK_BASE_WIDTH = 6;
const TICK_MAX_WIDTH = 30;
const TICK_SPACING = 10; // center-to-center
const REDUCED_MOTION_HOVER_WIDTH = 16;
const RAIL_HEIGHT_FRACTION = 0.8; // tick column capped at 80% of rail height
// Gap between the ticks' right edge and the content column's left edge.
const GAP_TO_CONTENT = 18;
// Never let the rail region's left edge get closer than this to the pane edge.
const RAIL_EDGE_MIN = 4;
// Push the tooltip up so it reads centered on the focused tick rather than starting below it.
const TOOLTIP_VERTICAL_NUDGE = 18;
const TOOLTIP_BOTTOM_CLEARANCE = 64;

// Place the rail region so the ticks' right edge sits GAP_TO_CONTENT px to the left of
// the centered content column. Returns null when the pane isn't measured yet (fall back
// to the static left:0) so the rail still paints on first frame.
function resolveRailLeft(paneWidth: number): number | null {
  if (paneWidth <= 0) {
    return null;
  }
  const contentWidth = Math.min(paneWidth, MAX_CONTENT_WIDTH);
  const gutterLeft = (paneWidth - contentWidth) / 2;
  const ticksRightEdge = gutterLeft - GAP_TO_CONTENT;
  return Math.max(RAIL_EDGE_MIN, ticksRightEdge - RAIL_WIDTH);
}

// Opacity states, quietest to loudest.
const OPACITY_REST = 0.2;
const OPACITY_VISIBLE = 0.5;
const OPACITY_CURRENT = 0.9;
const OPACITY_FOCUS = 1;

// Static rail-region layout for the raw DOM host (left edge, vertically centered, ticks
// grow rightward). Column height is dynamic and lives on the inner div's memoized style.
const RAIL_DIV_STYLE: CSSProperties = {
  position: "absolute",
  left: 0,
  top: "50%",
  transform: "translateY(-50%)",
  width: RAIL_WIDTH,
  maxHeight: `${RAIL_HEIGHT_FRACTION * 100}%`,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  justifyContent: "center",
  overflowY: "hidden",
  cursor: "pointer",
};

// Gaussian magnification. Sigma is deliberately tight (half the tick spacing) so the
// highlight focuses on the single hovered tick — a wider sigma lights up every neighbour,
// which with only a handful of ticks reads as "all of them turned white".
const SIGMA = 0.5 * TICK_SPACING;
const TWO_SIGMA_SQ = 2 * SIGMA * SIGMA;
// Below this weight the tick is effectively unmagnified; skip the write.
const MAGNIFY_ACTIVATION = 0.02;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Base opacity a tick rests at for a given anchor snapshot, before pointer focus.
function anchorOpacityFor(itemId: string, snapshot: TrailAnchorSnapshot): number {
  if (snapshot.currentId === itemId) {
    return OPACITY_CURRENT;
  }
  if (snapshot.visibleIds.includes(itemId)) {
    return OPACITY_VISIBLE;
  }
  return OPACITY_REST;
}

export function MessageTrailRail({ items, anchor, onJumpToMessage }: MessageTrailRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  // Per-tick DOM nodes, indexed parallel to `items`. Written imperatively; never React state.
  const tickRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastSnapshotRef = useRef<TrailAnchorSnapshot>(anchor.getSnapshot());
  const reducedMotionRef = useRef(prefersReducedMotion());

  // Roving tabstop + tooltip target. Focus index also drives the tooltip position/content.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [rovingIndex, setRovingIndex] = useState(0);
  // Pane size, self-measured so resizing never re-renders the (heavy) stream view. Width
  // positions the rail in the gutter; height places the tooltip against the centered ticks.
  const [paneSize, setPaneSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const count = items.length;
  const columnHeight = Math.max(0, (count - 1) * TICK_SPACING + TICK_HEIGHT);

  // Keep the refs array length in sync with items without reallocating on every render.
  if (tickRefs.current.length !== count) {
    tickRefs.current.length = count;
  }
  // Clamp roving index if the item set shrinks.
  if (rovingIndex >= count && count > 0) {
    // setState during render is allowed by React when it bails out to a re-render;
    // guard so we only do it when actually out of range.
    setRovingIndex(count - 1);
  }

  // Latest items available to imperative callbacks without re-subscribing.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Reset a single tick to its anchor-derived resting appearance.
  const resetTickStyle = useCallback((index: number, snapshot: TrailAnchorSnapshot) => {
    const node = tickRefs.current[index];
    const item = itemsRef.current[index];
    if (!node || !item) {
      return;
    }
    node.style.width = `${TICK_BASE_WIDTH}px`;
    node.style.height = `${TICK_HEIGHT}px`;
    node.style.opacity = String(anchorOpacityFor(item.id, snapshot));
  }, []);

  // Reset every tick to resting geometry/opacity (used on pointerleave and item changes).
  const resetAllTicks = useCallback(() => {
    const snapshot = lastSnapshotRef.current;
    for (let index = 0; index < itemsRef.current.length; index += 1) {
      resetTickStyle(index, snapshot);
    }
  }, [resetTickStyle]);

  // Apply Gaussian magnification centered on pointer Y (relative to the tick column).
  const applyMagnification = useCallback((pointerY: number) => {
    const snapshot = lastSnapshotRef.current;
    const list = itemsRef.current;
    const reducedMotion = reducedMotionRef.current;
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < list.length; index += 1) {
      const node = tickRefs.current[index];
      if (!node) {
        continue;
      }
      const center = index * TICK_SPACING + TICK_HEIGHT / 2;
      const distance = Math.abs(pointerY - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }

      const item = list[index];
      const baseOpacity = item ? anchorOpacityFor(item.id, snapshot) : OPACITY_REST;

      if (reducedMotion) {
        // No morphing: snap only the nearest-ish tick to a modest fixed width, keep opacity.
        const isNear = distance <= TICK_SPACING / 2;
        node.style.width = isNear ? `${REDUCED_MOTION_HOVER_WIDTH}px` : `${TICK_BASE_WIDTH}px`;
        node.style.height = isNear ? `${TICK_HEIGHT_HOVER}px` : `${TICK_HEIGHT}px`;
        node.style.opacity = String(Math.max(baseOpacity, isNear ? OPACITY_FOCUS : baseOpacity));
        continue;
      }

      const weight = Math.exp(-(distance * distance) / TWO_SIGMA_SQ);
      if (weight < MAGNIFY_ACTIVATION) {
        // Outside the tight focus window: rest geometry, anchor opacity.
        node.style.width = `${TICK_BASE_WIDTH}px`;
        node.style.height = `${TICK_HEIGHT}px`;
        node.style.opacity = String(baseOpacity);
        continue;
      }
      node.style.width = `${TICK_BASE_WIDTH + (TICK_MAX_WIDTH - TICK_BASE_WIDTH) * weight}px`;
      node.style.height = `${TICK_HEIGHT + (TICK_HEIGHT_HOVER - TICK_HEIGHT) * weight}px`;
      node.style.opacity = String(
        Math.min(OPACITY_FOCUS, baseOpacity + (OPACITY_FOCUS - baseOpacity) * weight),
      );
    }

    return nearestIndex;
  }, []);

  // Single coalesced pointermove -> one rAF -> imperative writes. Zero React state per frame.
  const pendingPointerYRef = useRef<number | null>(null);
  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }
      const column = columnRef.current;
      if (!column) {
        return;
      }
      const rect = column.getBoundingClientRect();
      pendingPointerYRef.current = event.clientY - rect.top;
      if (rafRef.current !== null) {
        return;
      }
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const pointerY = pendingPointerYRef.current;
        if (pointerY === null) {
          return;
        }
        const nearest = applyMagnification(pointerY);
        if (nearest >= 0) {
          setFocusIndex(nearest);
        }
      });
    },
    [applyMagnification],
  );

  const handlePointerLeave = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingPointerYRef.current = null;
    resetAllTicks();
    setFocusIndex(null);
  }, [resetAllTicks]);

  // Bind pointer listeners on the rail container (covers ticks + spacing hit area).
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    rail.addEventListener("pointermove", handlePointerMove);
    rail.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      rail.removeEventListener("pointermove", handlePointerMove);
      rail.removeEventListener("pointerleave", handlePointerLeave);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [handlePointerMove, handlePointerLeave]);

  // Measure the pane (the rail's grandparent container) so the rail can sit in the gutter
  // and the tooltip can track the vertically-centered ticks. Self-contained via
  // ResizeObserver so pane resizes never re-render AgentStreamView.
  useEffect(() => {
    const container = railRef.current?.parentElement?.parentElement;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      setPaneSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Subscribe to the anchor store and write opacity changes to only the affected ticks.
  useEffect(() => {
    const applySnapshot = (next: TrailAnchorSnapshot) => {
      const prev = lastSnapshotRef.current;
      lastSnapshotRef.current = next;
      // Only touch ticks whose base opacity actually changed between snapshots.
      for (let index = 0; index < itemsRef.current.length; index += 1) {
        const item = itemsRef.current[index];
        const node = tickRefs.current[index];
        if (!item || !node) {
          continue;
        }
        const before = anchorOpacityFor(item.id, prev);
        const after = anchorOpacityFor(item.id, next);
        if (before !== after) {
          // Don't override a tick the pointer is actively magnifying; the next rAF
          // will reconcile it against the fresh snapshot.
          if (pendingPointerYRef.current === null) {
            node.style.opacity = String(after);
          }
        }
      }
    };
    // Seed against the current snapshot in case it advanced before subscribe.
    applySnapshot(anchor.getSnapshot());
    return anchor.subscribe(applySnapshot);
  }, [anchor]);

  // On mount and whenever the item set changes, paint resting styles.
  useLayoutEffect(() => {
    resetAllTicks();
  }, [resetAllTicks, count]);

  const activateIndex = useCallback(
    (index: number) => {
      const item = itemsRef.current[index];
      if (item) {
        onJumpToMessage(item.id);
      }
    },
    [onJumpToMessage],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const next = Math.min(count - 1, index + 1);
          setRovingIndex(next);
          tickRefs.current[next]?.focus();
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const next = Math.max(0, index - 1);
          setRovingIndex(next);
          tickRefs.current[next]?.focus();
          break;
        }
        case "Home": {
          event.preventDefault();
          setRovingIndex(0);
          tickRefs.current[0]?.focus();
          break;
        }
        case "End": {
          event.preventDefault();
          const last = count - 1;
          setRovingIndex(last);
          tickRefs.current[last]?.focus();
          break;
        }
        case "Enter":
        case " ": {
          event.preventDefault();
          activateIndex(index);
          break;
        }
        case "Escape": {
          event.preventDefault();
          tickRefs.current[index]?.blur();
          break;
        }
        default:
          break;
      }
    },
    [activateIndex, count],
  );

  const handleTickFocus = useCallback((index: number) => {
    setFocusIndex(index);
    setRovingIndex(index);
  }, []);

  const handleTickBlur = useCallback(() => {
    setFocusIndex(null);
  }, []);

  // Stable ref registrar so each memoized tick can publish its DOM node by index without
  // an inline ref callback (which would defeat memoization and trip react-perf lint).
  const registerTickRef = useCallback((index: number, node: HTMLButtonElement | null) => {
    tickRefs.current[index] = node;
  }, []);

  // Whole-rail click: map pointer Y to nearest tick and jump.
  const handleRailClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const column = columnRef.current;
      if (!column || itemsRef.current.length === 0) {
        return;
      }
      const rect = column.getBoundingClientRect();
      const pointerY = event.clientY - rect.top;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < itemsRef.current.length; index += 1) {
        const center = index * TICK_SPACING + TICK_HEIGHT / 2;
        const distance = Math.abs(pointerY - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }
      activateIndex(nearestIndex);
    },
    [activateIndex],
  );

  const focusedItem = focusIndex !== null ? items[focusIndex] : null;
  const reducedMotion = reducedMotionRef.current;

  // The tick column is vertically centered in the pane-height rail, so the tooltip must be
  // placed against the column's real top, not the pane top (the old bug that floated it up).
  const columnTop = paneSize.height > 0 ? Math.max(0, (paneSize.height - columnHeight) / 2) : 0;
  const tooltipTop = useMemo(() => {
    if (focusIndex === null) {
      return 0;
    }
    const tickCenter = columnTop + focusIndex * TICK_SPACING + TICK_HEIGHT / 2;
    const maxTop =
      paneSize.height > 0
        ? Math.max(RAIL_EDGE_MIN, paneSize.height - TOOLTIP_BOTTOM_CLEARANCE)
        : Number.POSITIVE_INFINITY;
    return Math.min(maxTop, Math.max(RAIL_EDGE_MIN, tickCenter - TOOLTIP_VERTICAL_NUDGE));
  }, [focusIndex, columnTop, paneSize.height]);
  const tooltipStyle = useMemo(
    () => [styles.tooltip, inlineUnistylesStyle({ top: tooltipTop })],
    [tooltipTop],
  );

  // Sit the rail in the left gutter, ticks a fixed gap from the centered content column.
  const railLeft = resolveRailLeft(paneSize.width);
  const railParentStyle = useMemo(
    () =>
      railLeft === null
        ? styles.railParent
        : [styles.railParent, inlineUnistylesStyle({ left: railLeft })],
    [railLeft],
  );
  const columnStyle = useMemo<CSSProperties>(
    () => ({
      position: "relative",
      width: TICK_MAX_WIDTH,
      height: columnHeight,
      flexShrink: 0,
    }),
    [columnHeight],
  );

  return (
    <View style={railParentStyle} pointerEvents="box-none">
      <div
        ref={railRef}
        style={RAIL_DIV_STYLE}
        onClick={handleRailClick}
        role="tablist"
        aria-label="Message trail"
      >
        <div ref={columnRef} style={columnStyle}>
          {items.map((item, index) => (
            <TrailTick
              key={item.id}
              index={index}
              item={item}
              isRoving={index === rovingIndex}
              reducedMotion={reducedMotion}
              registerRef={registerTickRef}
              onKeyDown={handleKeyDown}
              onFocus={handleTickFocus}
              onBlur={handleTickBlur}
            />
          ))}
        </div>
      </div>
      {focusedItem ? (
        <View style={tooltipStyle} pointerEvents="none">
          <Text style={styles.tooltipPreview} numberOfLines={2}>
            {focusedItem.preview}
          </Text>
          {focusedItem.responsePreview ? (
            <Text style={styles.tooltipResponse} numberOfLines={2}>
              {focusedItem.responsePreview}
            </Text>
          ) : null}
          {focusedItem.attachmentCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{focusedItem.attachmentCount}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

interface TrailTickProps {
  index: number;
  item: MessageTrailItem;
  isRoving: boolean;
  reducedMotion: boolean;
  registerRef: (index: number, node: HTMLButtonElement | null) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onFocus: (index: number) => void;
  onBlur: () => void;
}

// One tick. Memoized so a scroll-driven anchor change (which never re-renders the rail)
// and pointer magnification (imperative style writes) don't churn ticks. width/opacity
// are owned imperatively by the parent via the registered ref; this only paints resting
// geometry and wires keyboard/focus.
const TrailTick = memo(function TrailTick({
  index,
  item,
  isRoving,
  reducedMotion,
  registerRef,
  onKeyDown,
  onFocus,
  onBlur,
}: TrailTickProps) {
  const handleRef = useCallback(
    (node: HTMLButtonElement | null) => registerRef(index, node),
    [registerRef, index],
  );
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, index),
    [onKeyDown, index],
  );
  const handleFocus = useCallback(() => onFocus(index), [onFocus, index]);
  const style = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      right: 0,
      top: index * TICK_SPACING,
      height: TICK_HEIGHT,
      width: TICK_BASE_WIDTH,
      padding: 0,
      border: "none",
      borderRadius: 1,
      // Themed via the Unistyles-maintained CSS variable (updates on theme change with no
      // React re-render and no per-frame JS color write). Only width/opacity are written
      // imperatively during magnification.
      backgroundColor: "var(--colors-foreground)",
      opacity: OPACITY_REST,
      cursor: "pointer",
      transitionProperty: reducedMotion ? "none" : "width, height, opacity",
      transitionDuration: reducedMotion ? "0ms" : "80ms",
    }),
    [index, reducedMotion],
  );
  return (
    <button
      type="button"
      ref={handleRef}
      tabIndex={isRoving ? 0 : -1}
      aria-label={item.preview || `Message ${item.ordinal}`}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={onBlur}
      style={style}
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  railParent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: RAIL_WIDTH,
  },
  tooltip: {
    position: "absolute",
    left: RAIL_WIDTH + theme.spacing[2],
    // A real width range: without a floor the box collapses toward the narrow rail parent
    // and the text wraps to nothing.
    minWidth: 220,
    maxWidth: 340,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    gap: theme.spacing[1],
    ...theme.shadow.sm,
  },
  tooltipPreview: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  tooltipResponse: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: theme.spacing[1],
    paddingVertical: 1,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  badgeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
