import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Index() {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pingBackend = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_URL}/health`);
      const data = (await res.json()) as { status: string };
      setStatus(data.status);
    } catch (err) {
      setStatus(`error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>AI Communication Coach</Text>
        <Pressable
          onPress={pingBackend}
          disabled={loading}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Ping backend</Text>
          )}
        </Pressable>
        {status && <Text style={styles.status}>{status}</Text>}
        <Text style={styles.hint}>API: {API_URL}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b0d12" },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  button: {
    backgroundColor: "#4f46e5",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    minWidth: 180,
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  status: { color: "#22c55e", fontSize: 18, fontWeight: "600" },
  hint: { color: "#6b7280", fontSize: 12 },
});
