import { useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { LogoMark } from "@/components/ui/LogoMark";
import { Screen } from "@/components/ui/Screen";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await getDeviceId();
        const plans = await api.getPlans(id);
        if (cancelled) return;
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
