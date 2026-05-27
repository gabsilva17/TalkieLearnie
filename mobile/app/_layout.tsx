import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AchievementUnlockedOverlay } from "@/components/ui/AchievementUnlockedOverlay";
import { BottomNav, type BottomNavProps } from "@/components/ui/BottomNav";
import { PlanCompletedOverlay } from "@/components/ui/PlanCompletedOverlay";
import { RevealOverlay } from "@/components/ui/RevealOverlay";
import { StreakUnlockedOverlay } from "@/components/ui/StreakUnlockedOverlay";
import { getDeviceId } from "@/lib/deviceId";
import { warmLanguage } from "@/lib/locale";
import { startPushPolling } from "@/lib/push";
import { colors, fonts, palette } from "@/lib/theme";

// One-time warm of the language store from AsyncStorage so the first
// rendered screen reads the user's saved language instead of the default.
// Fire-and-forget; if it fails the in-memory default ('pt') sticks.
void warmLanguage();

SplashScreen.preventAutoHideAsync().catch(() => {});

// One-time sweep of legacy AsyncStorage keys from older builds. We previously
// persisted (a) a stale-while-revalidate cache under `swr:*`, (b) an earned
// achievement baseline, and (c) a streak celebration gate. All three were
// removed in favour of fetching from the server, so any leftover entries on
// existing installs would just take up space. Fire-and-forget; failure is
// silent.
const LEGACY_KEYS = new Set([
  "earned_achievement_ids_v1",
  "last_streak_celebration_date_v1",
  "last_streak_celebration_date_v2",
]);
(async () => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter(
      (k) => k.startsWith("swr:") || LEGACY_KEYS.has(k),
    );
    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  } catch {
    // ignore
  }
})();

export default function RootLayout() {
  const router = useRouter();
  const [loaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

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

  if (!loaded) return null;

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
        <Stack.Screen name="plan/pending" options={{ headerShown: false }} />
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
