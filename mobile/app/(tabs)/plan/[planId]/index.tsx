import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { DayCard, DayCardStatus } from "@/components/ui/DayCard";
import { DuoButton } from "@/components/ui/DuoButton";
import { LogoMark } from "@/components/ui/LogoMark";
import { Screen } from "@/components/ui/Screen";
import {
  Plan,
  api,
  cacheKeys,
  setCached,
  useCached,
} from "@/lib/api";
import { localTodayISO } from "@/lib/dayDate";
import { getDeviceId } from "@/lib/deviceId";
import { clearLastPlanId, setLastPlanId } from "@/lib/lastPlan";
import {
  colors,
  fonts,
  palette,
  spacing,
  type as t,
} from "@/lib/theme";

function daysUntil(iso: string): number {
  const target = new Date(iso + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((target - today.getTime()) / 86_400_000));
}

export default function PlanDetailScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const plan = useCached<Plan>(planId ? cacheKeys.plan(planId) : null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    setError(null);
    try {
      const id = await getDeviceId();
      const p = await api.getPlan(planId, id);
      if (!p) {
        await clearLastPlanId();
        router.replace("/plans");
        return;
      }
      setCached(cacheKeys.plan(p.id), p, { persist: true });
      setLastPlanId(p.id).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  }, [planId, router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const loading = plan === undefined;

  const stats = useMemo(() => {
    if (!plan) return null;
    const completed = plan.days.filter((d) => d.completed_at).length;
    const total = plan.days.length;
    return {
      completed,
      total,
      remaining: daysUntil(plan.target_date),
    };
  }, [plan]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Animated.View entering={FadeIn.duration(220)} style={styles.center}>
          <LogoMark size="lg" />
        </Animated.View>
      </SafeAreaView>
    );
  }

  if (error && !plan) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <DuoButton title="TENTAR DE NOVO" onPress={load} fullWidth={false} />
        </View>
      </SafeAreaView>
    );
  }

  if (!plan || !stats) return null;

  const today = localTodayISO();
  const subtitle =
    stats.remaining > 0
      ? `${stats.remaining} ${stats.remaining === 1 ? "dia" : "dias"} para te preparares`
      : "O teu plano diário";

  return (
    <Screen
      scroll
      onRefresh={load}
      contentStyle={{
        paddingTop: spacing.lg,
        paddingBottom: spacing.huge,
      }}
    >
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Plano</Text>
        <Text style={styles.heroSubtitle}>{subtitle}</Text>
      </View>

      <Animated.View entering={FadeIn.duration(240)} style={styles.prep}>
        <Text style={styles.prepEyebrow}>A preparar</Text>
        <Text style={styles.prepText} numberOfLines={4}>
          {plan.prep_for}
        </Text>
      </Animated.View>

      <View style={styles.dayList}>
        {plan.days.map((day, i) => {
          const status: DayCardStatus = day.completed_at
            ? "done"
            : day.day_date === today
              ? "current"
              : "locked";
          return (
            <Animated.View
              key={day.id}
              entering={FadeInDown.duration(220).delay(i * 40)}
            >
              <DayCard
                index={day.day_index}
                title={day.theme}
                subtitle={day.question}
                status={status}
                onPress={
                  status === "locked"
                    ? undefined
                    : () =>
                        router.push(
                          day.completed_at
                            ? `/session/${day.id}/result`
                            : `/session/${day.id}`,
                        )
                }
              />
            </Animated.View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
  errorText: { ...t.body, color: colors.danger, textAlign: "center" },
  hero: {
    paddingBottom: spacing.xxl,
  },
  heroTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
  },
  heroSubtitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: palette.neutral[500],
    marginTop: spacing.xs,
  },
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
});
