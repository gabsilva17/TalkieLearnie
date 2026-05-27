import { useRouter } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import { DayCard } from "@/components/ui/DayCard";
import { DayCardSkeleton } from "@/components/ui/DayCardSkeleton";
import { DuoButton } from "@/components/ui/DuoButton";
import { Screen } from "@/components/ui/Screen";
import { TopBar } from "@/components/ui/TopBar";
import { useT } from "@/lib/i18n";
import {
  getPendingPlan,
  subscribePendingPlan,
} from "@/lib/pendingPlan";
import {
  colors,
  fonts,
  palette,
  spacing,
  type as t,
} from "@/lib/theme";

// Wave timings. Tuned so a 7-day plan finishes its choreography in ~5–7s,
// which is the realistic Haiku latency window. If the API resolves earlier
// we still play the reveal stagger so the UI never snaps.
const GENERATING_STEP_MS = 700;
const REVEAL_STEP_MS = 480;
const HANDOFF_DELAY_MS = 320;

export default function PendingPlanScreen() {
  const router = useRouter();
  const { t: tr } = useT();
  const state = useSyncExternalStore(
    subscribePendingPlan,
    getPendingPlan,
    getPendingPlan,
  );

  const isIdle = state.status === "idle";
  const isReady = state.status === "ready";
  const isError = state.status === "error";
  // Fall back to a single skeleton if we somehow end up here without input —
  // it doesn't render because the idle redirect kicks in below, but having a
  // stable `n` keeps the hooks below in a fixed shape.
  const n = state.status === "idle" ? 1 : state.input.n_days;

  // If someone lands here without an active job (e.g. cold-link), bounce to
  // /plans. The store is in-memory only, so a kill-and-relaunch loses
  // context — falling through to the plans home is the safe default.
  useEffect(() => {
    if (isIdle) router.replace("/plans");
  }, [isIdle, router]);

  // Wave A: which card has reached the "generating" phase. Advances on a
  // fixed cadence regardless of API status so the screen never feels frozen.
  const [generatingFrontier, setGeneratingFrontier] = useState(0);
  useEffect(() => {
    if (generatingFrontier >= n - 1) return;
    const id = setTimeout(
      () => setGeneratingFrontier((v) => Math.min(v + 1, n - 1)),
      GENERATING_STEP_MS,
    );
    return () => clearTimeout(id);
  }, [generatingFrontier, n]);

  // Wave B: how many cards have been "revealed" with real content. Only
  // ticks once the real plan has arrived. When it reaches n we hand off to
  // /plan/[id], which mounts already populated thanks to consumePendingPlan.
  const [revealedCount, setRevealedCount] = useState(0);
  useEffect(() => {
    if (!isReady) return;
    if (revealedCount >= n) return;
    const id = setTimeout(
      () => setRevealedCount((v) => Math.min(v + 1, n)),
      REVEAL_STEP_MS,
    );
    return () => clearTimeout(id);
  }, [isReady, revealedCount, n]);

  // Hand off once all cards are revealed AND the plan is in hand. Small
  // pause so the last card has a moment to land before the screen swaps.
  const readyPlanId = state.status === "ready" ? state.plan.id : null;
  useEffect(() => {
    if (!readyPlanId) return;
    if (revealedCount < n) return;
    const id = setTimeout(
      () => router.replace(`/plan/${readyPlanId}`),
      HANDOFF_DELAY_MS,
    );
    return () => clearTimeout(id);
  }, [readyPlanId, revealedCount, n, router]);

  if (isIdle) return null;

  if (isError) {
    return (
      <Screen
        header={
          <TopBar
            title={tr("plan_pending.title")}
            subtitle={tr("plan_pending.subtitle_error")}
            onBack={() => router.replace("/plans")}
          />
        }
      >
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>{tr("plan_pending.error_title")}</Text>
          <Text style={styles.errorBody}>{state.error}</Text>
          <View style={styles.errorActions}>
            <DuoButton
              title={tr("common.retry_caps")}
              onPress={() => router.replace("/onboarding")}
            />
          </View>
        </View>
      </Screen>
    );
  }

  // Build the visible list. Indices < revealedCount are real cards (we have
  // the plan); the rest are skeletons in either idle or generating phase.
  const realDays = state.status === "ready" ? state.plan.days : [];

  return (
    <Screen
      header={
        <TopBar
          title={tr("plan_pending.title")}
          subtitle={tr("plan_pending.subtitle_preparing")}
          onBack={() => router.replace("/plans")}
        />
      }
      reserveBottomNav
      contentStyle={{ paddingTop: spacing.md }}
    >
      <Animated.View entering={FadeIn.duration(240)} style={styles.prep}>
        <Text style={styles.prepEyebrow}>{tr("plan_pending.prep_eyebrow")}</Text>
        <Text style={styles.prepText} numberOfLines={4}>
          {state.input.prep_for}
        </Text>
      </Animated.View>

      <View style={styles.dayList}>
        {Array.from({ length: n }).map((_, i) => {
          const isRevealed = i < revealedCount && realDays[i];
          const realDay = isRevealed ? realDays[i] : null;
          if (realDay) {
            return (
              <Animated.View
                key={`real-${realDay.id}`}
                entering={FadeInDown.duration(260)}
              >
                <DayCard
                  index={realDay.day_index}
                  title={realDay.theme}
                  subtitle={realDay.question}
                  status={i === 0 ? "current" : "locked"}
                />
              </Animated.View>
            );
          }
          const phase = i <= generatingFrontier ? "generating" : "idle";
          return (
            <Animated.View
              key={`skeleton-${i}`}
              entering={FadeInDown.duration(220).delay(i * 40)}
            >
              <DayCardSkeleton index={i + 1} phase={phase} />
            </Animated.View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  prep: {
    paddingBottom: spacing.huge,
  },
  prepEyebrow: {
    ...t.eyebrow,
    marginBottom: spacing.sm,
  },
  prepText: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    lineHeight: 30,
    color: palette.neutral[900],
  },
  dayList: {
    gap: spacing.md,
  },
  errorWrap: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.md,
  },
  errorTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.text,
  },
  errorBody: {
    ...t.body,
    color: colors.danger,
  },
  errorActions: {
    marginTop: spacing.xl,
  },
});
