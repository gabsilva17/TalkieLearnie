import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  useFonts,
} from "@expo-google-fonts/nunito";
import * as Notifications from "expo-notifications";
import { Stack, usePathname, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { IconContext } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AchievementUnlockedOverlay } from "@/components/ui/AchievementUnlockedOverlay";
import { BottomNav, type BottomNavProps } from "@/components/ui/BottomNav";
import { PlanCompletedOverlay } from "@/components/ui/PlanCompletedOverlay";
import { RevealOverlay } from "@/components/ui/RevealOverlay";
import { StreakUnlockedOverlay } from "@/components/ui/StreakUnlockedOverlay";
import { api, cacheKeys, setCached } from "@/lib/api";
import { ensureCacheHydrated } from "@/lib/cache";
import { getDeviceId } from "@/lib/deviceId";
import { writeEarnedAchievementIds } from "@/lib/earnedAchievements";
import { startPushPolling } from "@/lib/push";
import { colors, fonts, palette } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Kick off cache hydration as soon as the module loads so the boot router can
// often skip the spinner entirely on warm cold-starts.
const hydration = ensureCacheHydrated();

export default function RootLayout() {
  const router = useRouter();
  const [loaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    hydration.then(() => setHydrated(true)).catch(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (loaded && hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, hydrated]);

  // Background profile pre-warm so the Perfil tab never hits an empty-cache
  // spinner. Runs once on app boot; Perfil's own useFocusEffect still refetches
  // when the user actually visits the tab, so this is purely an opportunistic
  // populate. Silent on failure.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await getDeviceId();
        if (cancelled) return;
        const p = await api.getProfile(id);
        if (cancelled) return;
        setCached(cacheKeys.profile(id), p, { persist: true });
        // Seed the achievement-unlock baseline so submitSession can diff
        // against it. Without this, a brand-new install could falsely
        // celebrate every prior-server-side achievement on the very next
        // submit. With it, the baseline always reflects the most recent
        // server truth.
        await writeEarnedAchievementIds(p.achievements);

        // Note: we deliberately do NOT seed the streak-celebration date
        // here. An earlier version did, to defend against the edge case
        // where the device already has today's session in the DB but
        // AsyncStorage is empty (fresh install, cache wipe, mid-day install
        // of this feature). That seed silently locked out the celebration
        // on the very first session under the new code, which is exactly
        // the moment the user expects to see it. The remaining failure mode
        // — one spurious celebration when AsyncStorage gets cleared while
        // the streak is already lit — is harmless (it's a celebratory
        // moment, not a destructive one). The IIFE in submitSession writes
        // today to the gate when a real celebration fires; that gate write
        // is the only source of truth.
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let stopPolling: (() => void) | null = null;
    (async () => {
      try {
        const id = await getDeviceId();
        stopPolling = startPushPolling(id);
      } catch (err) {
        console.warn("push polling failed to start", err);
      }
    })();

    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      // Tap on a daily reminder → boot router resumes the last visited plan, or shows the list.
      router.navigate("/");
    });
    return () => {
      sub.remove();
      stopPolling?.();
    };
  }, [router]);

  if (!loaded || !hydrated) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <IconContext.Provider value={{ weight: "bold" }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          headerTintColor: palette.neutral[700],
          headerTitleStyle: { fontFamily: fonts.extrabold, fontSize: 16 },
          headerBackTitle: "",
          contentStyle: { backgroundColor: colors.bg },
          animation: "fade",
          animationDuration: 220,
          gestureEnabled: true,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="plans" options={{ headerShown: false }} />
        <Stack.Screen name="plan/[planId]/index" options={{ headerShown: false }} />
        <Stack.Screen name="session/[dayId]/index" options={{ headerShown: false }} />
        <Stack.Screen name="session/[dayId]/result" options={{ headerShown: false }} />
      </Stack>
      {/*
        Persistent BottomNav lives outside the Stack so it doesn't fade with
        Stack transitions — `/plans` ↔ `/plan/[id]` is a smooth crossfade of
        the screen content only, while the bar stays stable. The bar
        unmounts cleanly when navigating to a route that shouldn't show it
        (onboarding, session, result).
      */}
      <PersistentBottomNav />
      {/*
        Order matters: later-mounted siblings paint on top in RN. From bottom
        to top: Achievement (smallest moment) → StreakUnlock (daily ritual)
        → PlanCompleted (rare climax) → Reveal (user-driven, always on top).
        The user dismisses the top one first, so a session that closes a
        plan on a freshly-activated streak day plays:
        PlanCompleted → StreakUnlock → Achievement → /plans.
        RevealOverlay sits on top of all passive celebrations.
      */}
      <AchievementUnlockedOverlay />
      <StreakUnlockedOverlay />
      <PlanCompletedOverlay />
      <RevealOverlay />
      </IconContext.Provider>
    </SafeAreaProvider>
  );
}

function PersistentBottomNav() {
  const pathname = usePathname();
  const show = pathname === "/plans" || pathname.startsWith("/plan/");
  if (!show) return null;
  const active: BottomNavProps["active"] =
    pathname === "/plans" ? "plans" : null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={styles.bottomNavSlot}>
        <BottomNav active={active} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNavSlot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
