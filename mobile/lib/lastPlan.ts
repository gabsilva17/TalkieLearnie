import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "last_plan_id";

export async function getLastPlanId(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function setLastPlanId(id: string): Promise<void> {
  await AsyncStorage.setItem(KEY, id);
}

export async function clearLastPlanId(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
