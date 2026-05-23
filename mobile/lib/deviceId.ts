import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

const KEY = "device_id";
let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  let v = await AsyncStorage.getItem(KEY);
  if (!v) {
    v = Crypto.randomUUID();
    await AsyncStorage.setItem(KEY, v);
  }
  cached = v;
  return v;
}

export async function resetDeviceId(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  cached = null;
}
