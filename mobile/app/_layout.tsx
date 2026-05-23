import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  useFonts,
} from "@expo-google-fonts/nunito";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { IconContext } from "phosphor-react-native";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ensureCacheHydrated } from "@/lib/cache";
import { getDeviceId } from "@/lib/deviceId";
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
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="session/[dayId]/index" options={{ headerShown: false }} />
        <Stack.Screen name="session/[dayId]/result" options={{ headerShown: false }} />
      </Stack>
      </IconContext.Provider>
    </SafeAreaProvider>
  );
}
