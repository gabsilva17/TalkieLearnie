import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "user_name";
const DEFAULT_NAME = "Gabriel";
let cached: string | null = null;

export async function getUserName(): Promise<string> {
  if (cached) return cached;
  const v = await AsyncStorage.getItem(KEY);
  cached = v && v.trim().length > 0 ? v : DEFAULT_NAME;
  return cached;
}

export async function setUserName(name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  await AsyncStorage.setItem(KEY, clean);
  cached = clean;
}
