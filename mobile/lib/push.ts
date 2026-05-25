import Constants from "expo-constants";
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

// Expo Go (SDK 53+) cannot receive remote push. We detect it via
// `Constants.appOwnership === 'expo'`; dev builds and standalone are `null`.
const IS_EXPO_GO = Constants.appOwnership === "expo";

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

async function registerExpoPushToken(deviceId: string): Promise<boolean> {
  // Expo Go on SDK 53+ cannot mint a push token — calling this would throw.
  // Bail early so the caller can start the polling fallback.
  if (IS_EXPO_GO) return false;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
  if (!projectId) {
    if (__DEV__) console.warn("no eas projectId in app config; skipping push token");
    return false;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return false;
    await api.registerPushToken({
      device_id: deviceId,
      token,
      platform: Platform.OS,
    });
    if (__DEV__) console.log("expo push token registered:", token);
    return true;
  } catch (err) {
    if (__DEV__) console.warn("expo push token registration failed", err);
    return false;
  }
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

  let sub: { remove: () => void } | null = null;

  (async () => {
    const granted = await ensurePermission();
    if (!granted || cancelled) return;

    // Try real push first. On dev builds + standalone this registers an Expo
    // push token with the backend, and the admin/push endpoint will route
    // notifications through Expo Push API directly (background + killed-app
    // delivery). If we register successfully, the foreground polling loop
    // would double-fire on the same device, so we skip it.
    const registered = await registerExpoPushToken(deviceId);
    if (cancelled) return;
    if (registered) return;

    // Fallback: Expo Go / simulators / failed token mint. Polling drives
    // local notifications while foregrounded.
    if (AppState.currentState === "active") start();
    sub = AppState.addEventListener("change", onAppStateChange);
  })();

  return () => {
    cancelled = true;
    stop();
    sub?.remove();
  };
}
