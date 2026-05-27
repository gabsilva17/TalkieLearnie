import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useT } from "@/lib/i18n";
import { palette, radii, spacing, type as t } from "@/lib/theme";

export type DayCardSkeletonPhase = "idle" | "generating";

export type DayCardSkeletonProps = {
  index: number;
  phase: DayCardSkeletonPhase;
};

const INDICATOR_SIZE = 28;
const DOT_CYCLE_MS = 1100;
const DOT_PEAK_MS = 360;

function TypingDot({ offset }: { offset: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(
      offset,
      withRepeat(
        withSequence(
          withTiming(1, { duration: DOT_PEAK_MS, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: DOT_PEAK_MS, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: DOT_CYCLE_MS - DOT_PEAK_MS * 2 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(v);
  }, [v, offset]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + v.value * 0.65,
    transform: [{ scale: 0.85 + v.value * 0.25 }],
  }));
  return <Animated.View style={[styles.dot, style]} />;
}

function ShimmerBar({ width }: { width: number | string }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(v);
  }, [v]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + v.value * 0.4,
  }));
  return (
    <Animated.View
      style={[styles.shimmer, { width: width as number }, style]}
    />
  );
}

export function DayCardSkeleton({ index, phase }: DayCardSkeletonProps) {
  const { t: tr } = useT();
  const isIdle = phase === "idle";
  const wrap = useSharedValue(isIdle ? 0 : 1);
  useEffect(() => {
    wrap.value = withTiming(isIdle ? 0 : 1, {
      duration: 260,
      easing: Easing.out(Easing.quad),
    });
  }, [isIdle, wrap]);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + wrap.value * 0.45,
  }));

  return (
    <Animated.View style={[styles.card, !isIdle ? styles.cardActive : null, cardStyle]}>
      <View
        style={[
          styles.indicator,
          !isIdle ? styles.indicatorActive : null,
        ]}
      />

      <View style={styles.content}>
        <Text
          style={[styles.eyebrow, isIdle ? styles.eyebrowIdle : null]}
        >{tr("common.day_label", { index })}</Text>
        {isIdle ? (
          <View style={styles.idleRow}>
            <View style={[styles.idleBar, { width: 160 }]} />
            <View style={[styles.idleBar, styles.idleBarSub, { width: 220 }]} />
          </View>
        ) : (
          <View style={styles.activeRow}>
            <View style={styles.dotsRow}>
              <TypingDot offset={0} />
              <TypingDot offset={180} />
              <TypingDot offset={360} />
            </View>
            <ShimmerBar width={200} />
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.neutral[200],
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  cardActive: {
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[500],
    borderWidth: 2,
    paddingVertical: spacing.lg - 1,
    paddingHorizontal: spacing.lg - 1,
  },
  indicator: {
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
    borderRadius: INDICATOR_SIZE / 2,
    backgroundColor: palette.neutral[100],
    borderWidth: 2,
    borderColor: palette.neutral[300],
  },
  indicatorActive: {
    backgroundColor: palette.white,
    borderColor: palette.primary[500],
  },
  content: {
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
  },
  eyebrow: {
    ...t.eyebrow,
    marginBottom: 6,
  },
  eyebrowIdle: {
    color: palette.neutral[400],
  },
  idleRow: {
    gap: 6,
  },
  idleBar: {
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.neutral[200],
  },
  idleBarSub: {
    height: 10,
    backgroundColor: palette.neutral[100],
  },
  activeRow: {
    gap: 8,
    minHeight: 22,
    justifyContent: "center",
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.primary[500],
  },
  shimmer: {
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.primary[100],
  },
});

