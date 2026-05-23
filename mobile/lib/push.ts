import * as Notifications from "expo-notifications";
import { AppState, AppStateStatus, Platform } from "react-native";

import { api } from "./api";

// Foreground banners — important for the demo where the user sees the
// notification land while they're using the app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const POLL_INTERVAL_MS = 5000;
let permissionAsked = false;

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Lembretes diários",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#7c9cff",
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") return true;
  if (permissionAsked) return false;
  permissionAsked = true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === "granted";
}

async function drainPending(deviceId: string) {
  const pending = await api.getPendingPushes(deviceId);
  for (const row of pending) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: row.title,
        body: row.body,
        sound: "default",
        data: { type: "daily_reminder", id: row.id },
      },
      trigger: null, // immediate
    });
    // Ack so we don't re-fire next poll. Best-effort: if it fails the row
    // stays and we'll re-fire next tick, which is the right behaviour anyway.
    try {
      await api.ackPendingPush(row.id);
    } catch (err) {
      console.warn("ack push failed", err);
    }
  }
}

export function startPushPolling(deviceId: string): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (cancelled) return;
    try {
      await drainPending(deviceId);
    } catch (err) {
      // Silent — backend may be offline (Expo Go on flaky LAN); we'll retry.
      if (__DEV__) console.warn("push poll failed", err);
    }
  };

  const start = () => {
    if (timer) return;
    tick();
    timer = setInterval(tick, POLL_INTERVAL_MS);
  };

  const stop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  const onAppStateChange = (state: AppStateStatus) => {
    if (state === "active") start();
    else stop();
  };

  (async () => {
    const granted = await ensurePermission();
    if (!granted || cancelled) return;
    if (AppState.currentState === "active") start();
  })();

  const sub = AppState.addEventListener("change", onAppStateChange);

  return () => {
    cancelled = true;
    stop();
    sub.remove();
  };
}
