import { useEffect } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Brain } from "lucide-react-native";

const BREATHE_DURATION_MS = 1150;
const REST_OPACITY = 0.5;
const REST_SCALE = 0.95;

/**
 * The indicator shown on "Thinking" stream rows. A Lucide brain that gently
 * breathes (opacity, with a whisper of scale) while the thought is live and
 * rests at full strength once it settles — deliberately quiet, per the design
 * language. Colour is supplied by the caller via `color` (typically wrapped in
 * `withUnistyles` so it tracks the theme's accent), the same injection pattern
 * `SyncedLoader` uses.
 *
 * Uses Reanimated the way `SyncedLoader` does, so it is safe cross-platform —
 * this is a self-contained value animation, not a layout entering/exiting one
 * (the Android caveat).
 */
export function ThinkingIndicator({
  size = 12,
  active = false,
  color = "currentColor",
}: {
  size?: number;
  active?: boolean;
  color?: string;
}) {
  // 1 → full/at-rest, 0 → dimmed trough of the breath. Rests at 1 when idle.
  const progress = useSharedValue(1);

  useEffect(() => {
    if (active) {
      progress.value = withRepeat(
        withTiming(0, { duration: BREATHE_DURATION_MS, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(progress);
      progress.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) });
    }
    return () => cancelAnimation(progress);
  }, [active, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: REST_OPACITY + progress.value * (1 - REST_OPACITY),
    transform: [{ scale: REST_SCALE + progress.value * (1 - REST_SCALE) }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Brain size={size} color={color} />
    </Animated.View>
  );
}
