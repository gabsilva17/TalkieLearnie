import { useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { LogoMark } from "@/components/ui/LogoMark";
import { Screen } from "@/components/ui/Screen";
import { Plan, api, cacheKeys, getCached, setCached } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { clearLastPlanId, getLastPlanId } from "@/lib/lastPlan";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await getDeviceId();
        const lastId = await getLastPlanId();

        // Fast path: cache hydrated from disk lets us route immediately, before
        // any network round-trip. The fetched data still flows through the
        // detail screen's SWR loop.
        if (lastId) {
          const cachedPlan = getCached<Plan>(cacheKeys.plan(lastId));
          if (cachedPlan) {
            router.replace(`/plan/${lastId}`);
            return;
          }
        }
        const cachedList = getCached<Plan[]>(cacheKeys.plans(id));
        if (cachedList) {
          router.replace(cachedList.length > 0 ? "/plans" : "/onboarding");
          return;
        }

        // Cold start: fall back to network.
        if (lastId) {
          const plan = await api.getPlan(lastId, id);
          if (cancelled) return;
          if (plan) {
            setCached(cacheKeys.plan(plan.id), plan, { persist: true });
            router.replace(`/plan/${plan.id}`);
            return;
          }
          await clearLastPlanId();
        }
        const plans = await api.getPlans(id);
        if (cancelled) return;
        setCached(cacheKeys.plans(id), plans, { persist: true });
        for (const p of plans) {
          setCached(cacheKeys.plan(p.id), p, { persist: true });
        }
        router.replace(plans.length > 0 ? "/plans" : "/onboarding");
      } catch (err) {
        if (cancelled) return;
        console.warn("boot routing failed", err);
        router.replace("/onboarding");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <Screen>
      <Animated.View
        entering={FadeIn.duration(240)}
        style={styles.container}
      >
        <LogoMark size="lg" />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
