// Full-screen takeover when the user closes the last remaining day of a plan.
//
// Mounted once at the root layout (sibling of the Stack). While there is a
// head entry in the plan-completion queue it covers the whole screen with a
// primary-blue takeover, a confetti shower, a medal that bounces in, a big
// "Plano completo!" headline, the plan name, a small day-count line, and a
// pt-PT motivational sentence. CTA "FECHAR" pops the queue and reveals
// whatever screen was underneath (typically the plans home, since the user
// reached this point by tapping "Voltar ao plano" on the result screen).
//
// Mirrors [[AchievementUnlockedOverlay]] in structure (queue + scrim + card
// + confetti). This one intentionally feels louder: full-bleed blue, denser
// confetti, larger headline. Don't tone it down without asking — the moment
// is supposed to feel like the climax of the whole plan.

import * as Haptics from "expo-haptics";
import { MedalIcon as Medal } from "phosphor-react-native";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { DuoButton } from "@/components/ui/DuoButton";
import { useT } from "@/lib/i18n";
import {
  dismissPlanCompleted,
  peekPlanCompleted,
  subscribePlanCompleted,
  type PlanCompletedEvent,
} from "@/lib/planCompletionQueue";
import { fonts, palette, radii, spacing } from "@/lib/theme";

function pickFromList(list: readonly string[], id: string): string {
  if (list.length === 0) return "";
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return list[hash % list.length];
}

export function PlanCompletedOverlay() {
  const current = useSyncExternalStore(
    subscribePlanCompleted,
    peekPlanCompleted,
    peekPlanCompleted,
  );

  if (!current) return null;
  return <CelebrationScreen key={current.plan_id} event={current} />;
}

function CelebrationScreen({ event }: { event: PlanCompletedEvent }) {
  const { t: tr, list } = useT();
  const bg = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const contentY = useSharedValue(24);
  const medalScale = useSharedValue(0);
  const medalRot = useSharedValue(-22);
  const ringPulse = useSharedValue(0);

  const [enteringDone, setEnteringDone] = useState(false);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );

    bg.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
    contentOpacity.value = withDelay(
      120,
      withTiming(1, { duration: 360, easing: Easing.out(Easing.quad) }),
    );
    contentY.value = withDelay(
      120,
      withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) }),
    );

    medalScale.value = withDelay(
      220,
      withSequence(
        withTiming(1.25, { duration: 420, easing: Easing.out(Easing.cubic) }),
        withTiming(0.92, { duration: 200 }),
        withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }),
      ),
    );
    medalRot.value = withDelay(
      220,
      withSequence(
        withTiming(10, { duration: 240, easing: Easing.out(Easing.quad) }),
        withTiming(-6, { duration: 180 }),
        withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) }),
      ),
    );

    ringPulse.value = withDelay(
      420,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );

    const t = setTimeout(() => setEnteringDone(true), 700);
    return () => clearTimeout(t);
    // shared values are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.plan_id]);

  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.value }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentY.value }],
  }));
  const medalStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: medalScale.value },
      { rotate: `${medalRot.value}deg` },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + ringPulse.value * 0.5,
    transform: [{ scale: 0.85 + ringPulse.value * 0.35 }],
  }));

  const motivations = list("motivations.plan_completed");
  const motivation = useMemo(
    () => pickFromList(motivations, event.plan_id),
    [motivations, event.plan_id],
  );

  return (
    <View pointerEvents="auto" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.bg, bgStyle]} />

      <ConfettiBurst />

      <Animated.View style={[styles.content, contentStyle]} pointerEvents="box-none">
        <Text style={styles.eyebrow}>{tr("plan_completed_overlay.eyebrow")}</Text>

        <View style={styles.medalWrap}>
          <Animated.View style={[styles.medalRing, ringStyle]} />
          <Animated.View style={medalStyle}>
            <Medal size={120} color={palette.white} weight="fill" />
          </Animated.View>
        </View>

        <Text style={styles.headline}>{tr("plan_completed_overlay.headline")}</Text>
        <Text style={styles.planName} numberOfLines={3}>
          {event.prep_for}
        </Text>

        <Text style={styles.daysLine}>
          {event.total_days === 1
            ? tr("plan_completed_overlay.days_one")
            : tr("plan_completed_overlay.days_many", { count: event.total_days })}
        </Text>

        <View style={styles.divider} />

        <Text style={styles.motivation}>{motivation}</Text>

        <View style={styles.buttonWrap}>
          <DuoButton
            title={tr("plan_completed_overlay.cta_close_caps")}
            variant="secondary"
            onPress={() => {
              if (!enteringDone) return;
              Haptics.selectionAsync().catch(() => {});
              dismissPlanCompleted();
            }}
          />
        </View>
      </Animated.View>
    </View>
  );
}

// Denser confetti than the achievement overlay — 48 pieces falling across the
// entire width. Each piece has its own random drift / rotation / delay so the
// shower never looks gridded.

const CONFETTI_COUNT = 48;

function ConfettiBurst() {
  const dots = useMemo(
    () => Array.from({ length: CONFETTI_COUNT }).map((_, i) => i),
    [],
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {dots.map((i) => (
        <ConfettiDot key={i} index={i} />
      ))}
    </View>
  );
}

function ConfettiDot({ index }: { index: number }) {
  const { width, height } = Dimensions.get("window");

  const seed = useMemo(() => {
    const startX = Math.random() * width;
    const drift = (Math.random() - 0.5) * 180;
    const rotEnd = Math.random() * 900 - 450;
    const size = 7 + Math.random() * 6;
    // Confetti against a primary-blue background needs lighter tints +
    // white to pop. Avoid primary[500]+ which would disappear.
    const tint =
      Math.random() < 0.45
        ? palette.white
        : Math.random() < 0.5
          ? palette.primary[100]
          : palette.primary[200];
    return {
      startX,
      drift,
      rotEnd,
      size,
      tint,
      delay: index * 28,
      duration: 1800 + Math.random() * 1100,
      endY: height + 80,
    };
  }, [index, width, height]);

  const tx = useSharedValue(0);
  const ty = useSharedValue(-60);
  const rot = useSharedValue(0);
  const op = useSharedValue(0);

  useEffect(() => {
    op.value = withDelay(
      seed.delay,
      withSequence(
        withTiming(1, { duration: 140 }),
        withTiming(1, { duration: seed.duration - 420 }),
        withTiming(0, { duration: 280 }),
      ),
    );
    ty.value = withDelay(
      seed.delay,
      withTiming(seed.endY, {
        duration: seed.duration,
        easing: Easing.in(Easing.quad),
      }),
    );
    tx.value = withDelay(
      seed.delay,
      withTiming(seed.drift, {
        duration: seed.duration,
        easing: Easing.inOut(Easing.quad),
      }),
    );
    rot.value = withDelay(
      seed.delay,
      withTiming(seed.rotEnd, {
        duration: seed.duration,
        easing: Easing.out(Easing.cubic),
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${rot.value}deg` },
    ],
    opacity: op.value,
  }));

  return (
    <Animated.View
      style={[
        styles.confetti,
        {
          left: seed.startX,
          width: seed.size,
          height: seed.size * 1.7,
          backgroundColor: seed.tint,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.primary[500],
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.huge,
  },
  eyebrow: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    letterSpacing: 1.6,
    color: palette.primary[100],
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  medalWrap: {
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  medalRing: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: palette.primary[400],
  },
  headline: {
    fontFamily: fonts.black,
    fontSize: 38,
    lineHeight: 42,
    color: palette.white,
    textAlign: "center",
  },
  planName: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    lineHeight: 26,
    color: palette.primary[100],
    textAlign: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  daysLine: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 20,
    color: palette.white,
    textAlign: "center",
    marginTop: spacing.lg,
    opacity: 0.85,
  },
  divider: {
    width: 48,
    height: 2,
    borderRadius: 1,
    backgroundColor: palette.primary[300],
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  motivation: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 24,
    color: palette.white,
    textAlign: "center",
    marginBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  buttonWrap: {
    alignSelf: "stretch",
    maxWidth: 360,
  },
  confetti: {
    position: "absolute",
    top: -60,
    borderRadius: 2,
  },
});
