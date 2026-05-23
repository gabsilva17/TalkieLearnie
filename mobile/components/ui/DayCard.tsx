import {
  CaretRightIcon as CaretRight,
  CheckIcon as Check,
  LockIcon as Lock,
} from "phosphor-react-native";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { colors, fonts, palette, radii, spacing, type as t } from "@/lib/theme";

export type DayCardStatus = "done" | "current" | "locked";

export type DayCardProps = {
  index: number;
  title: string;
  subtitle?: string;
  status: DayCardStatus;
  onPress?: () => void;
};

const INDICATOR_SIZE = 28;

export function DayCard({
  index,
  title,
  subtitle,
  status,
  onPress,
}: DayCardProps) {
  const isLocked = status === "locked";
  const isCurrent = status === "current";
  const isDone = status === "done";
  const interactive = !!onPress && !isLocked;

  const bounce = useSharedValue(0);

  useEffect(() => {
    if (isCurrent) {
      const easeOut = Easing.out(Easing.quad);
      const easeIn = Easing.in(Easing.quad);
      bounce.value = withDelay(
        420,
        withSequence(
          withTiming(1, { duration: 260, easing: easeOut }),
          withTiming(0, { duration: 320, easing: easeIn }),
          withTiming(0.45, { duration: 220, easing: easeOut }),
          withTiming(0, { duration: 260, easing: easeIn }),
        ),
      );
    }
  }, [isCurrent, bounce]);

  const bounceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -6 * bounce.value },
      { scale: 1 + 0.02 * bounce.value },
    ],
  }));

  return (
    <Animated.View style={bounceStyle}>
      <Pressable
        disabled={!interactive}
        onPress={interactive ? onPress : undefined}
        style={({ pressed }) => [
          styles.card,
          isCurrent ? styles.cardCurrent : null,
          isLocked ? styles.cardLocked : null,
          pressed && interactive ? styles.cardPressed : null,
        ]}
      >
        <View
          style={[
            styles.indicator,
            isDone ? styles.indicatorDone : null,
            isCurrent ? styles.indicatorCurrent : null,
            isLocked ? styles.indicatorLocked : null,
          ]}
        >
          {isDone ? (
            <Check size={18} color={palette.white} weight="bold" />
          ) : null}
        </View>

        <View style={styles.content}>
          <Text
            style={[
              styles.eyebrow,
              isCurrent ? styles.eyebrowCurrent : null,
              isLocked ? styles.eyebrowLocked : null,
            ]}
          >{`Dia ${index}`}</Text>
          <Text
            style={[styles.title, isLocked ? styles.titleLocked : null]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                isLocked ? styles.subtitleLocked : null,
              ]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        {isLocked ? (
          <Lock
            size={16}
            color={palette.neutral[400]}
            weight="fill"
            style={styles.trailingIcon}
          />
        ) : (
          <CaretRight
            size={20}
            color={isCurrent ? palette.primary[600] : palette.neutral[400]}
            weight="bold"
            style={styles.trailingIcon}
          />
        )}
      </Pressable>
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
  cardCurrent: {
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[500],
    borderWidth: 2,
  },
  cardLocked: {
    opacity: 0.7,
  },
  cardPressed: {
    opacity: 0.85,
  },
  indicator: {
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
    borderRadius: INDICATOR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.white,
    borderWidth: 2,
    borderColor: palette.neutral[300],
  },
  indicatorCurrent: {
    backgroundColor: palette.white,
    borderColor: palette.primary[500],
  },
  indicatorDone: {
    backgroundColor: palette.primary[500],
    borderColor: palette.primary[500],
  },
  indicatorLocked: {
    backgroundColor: palette.neutral[100],
    borderColor: palette.neutral[300],
  },
  content: {
    flex: 1,
    justifyContent: "center",
  },
  eyebrow: {
    ...t.eyebrow,
    marginBottom: 4,
  },
  eyebrowCurrent: {
    color: palette.primary[600],
  },
  eyebrowLocked: {
    color: palette.neutral[400],
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 22,
    color: colors.text,
  },
  titleLocked: {
    color: palette.neutral[400],
  },
  subtitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.neutral[500],
    marginTop: 2,
  },
  subtitleLocked: {
    color: palette.neutral[400],
  },
  trailingIcon: {
    marginLeft: spacing.xs,
  },
});
