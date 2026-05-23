import { useFocusEffect } from "expo-router";
import {
  ArrowClockwiseIcon as ArrowClockwise,
  ArrowUpIcon as ArrowUp,
  BookmarkIcon as Bookmark,
  WarningCircleIcon as WarningCircle,
} from "phosphor-react-native";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { Plan, api, cacheKeys, getCached, setCached } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { getLastPlanId } from "@/lib/lastPlan";
import {
  colors,
  fonts,
  palette,
  radii,
  spacing,
  type as t,
} from "@/lib/theme";

type ChatMessage = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Como começo um pitch forte?",
  "Dicas para controlar os nervos.",
];

export default function AskScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const planId = await getLastPlanId();
          if (!planId) return;
          // Hit the cache first so the context chip appears instantly.
          const cached = getCached<Plan>(cacheKeys.plan(planId));
          if (cached && !cancelled) setActivePlan(cached);
          const deviceId = await getDeviceId();
          const plan = await api.getPlan(planId, deviceId);
          if (cancelled) return;
          if (plan) {
            setCached(cacheKeys.plan(plan.id), plan, { persist: true });
            setActivePlan(plan);
          }
        } catch {
          // best-effort context — silent
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      setError(null);
      setInput("");
      const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
      setMessages(next);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      setLoading(true);
      try {
        const deviceId = await getDeviceId();
        const res = await api.ask({
          device_id: deviceId,
          plan_id: activePlan?.id ?? null,
          messages: next,
        });
        setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [activePlan?.id, loading, messages],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Perguntar</Text>
          <Text style={styles.headerSubtitle}>
            Tira dúvidas sobre como te preparares.
          </Text>
        </View>
        {messages.length > 0 ? (
          <Pressable
            onPress={reset}
            hitSlop={10}
            style={({ pressed }) => [
              styles.resetBtn,
              pressed ? { backgroundColor: palette.neutral[100] } : null,
            ]}
            accessibilityLabel="Nova conversa"
          >
            <ArrowClockwise size={20} color={palette.neutral[600]} weight="bold" />
          </Pressable>
        ) : null}
      </View>

      {activePlan ? (
        <Animated.View entering={FadeIn.duration(200)} style={styles.contextChip}>
          <Bookmark size={12} color={palette.primary[700]} weight="fill" />
          <Text style={styles.contextChipText} numberOfLines={1}>
            A usar contexto: {activePlan.prep_for}
          </Text>
        </Animated.View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <Animated.View entering={FadeIn.duration(220)} style={styles.welcome}>
              <Text style={styles.welcomeEyebrow}>Perguntar</Text>
              <Text style={styles.welcomeTitle}>Em que te posso ajudar?</Text>
              <Text style={styles.welcomeBody}>
                Tira dúvidas sobre comunicação, entrevistas, pitches ou perguntas
                difíceis.
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s, i) => (
                  <Animated.View
                    key={s}
                    entering={FadeInDown.duration(220).delay(80 + i * 40)}
                  >
                    <Pressable
                      onPress={() => send(s)}
                      style={({ pressed }) => [
                        styles.suggestion,
                        pressed ? styles.suggestionPressed : null,
                      ]}
                    >
                      <Text style={styles.suggestionText}>{s}</Text>
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          ) : (
            <View style={styles.messages}>
              {messages.map((m, i) => (
                <Animated.View
                  key={i}
                  entering={FadeInUp.duration(180)}
                  style={[
                    styles.bubbleRow,
                    m.role === "user" ? styles.bubbleRowRight : styles.bubbleRowLeft,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant,
                    ]}
                  >
                    <Text
                      style={
                        m.role === "user"
                          ? styles.bubbleTextUser
                          : styles.bubbleTextAssistant
                      }
                    >
                      {m.content}
                    </Text>
                  </View>
                </Animated.View>
              ))}
              {loading ? (
                <View style={[styles.bubbleRow, styles.bubbleRowLeft]}>
                  <View style={[styles.bubble, styles.bubbleAssistant]}>
                    <ActivityIndicator color={palette.primary[600]} size="small" />
                  </View>
                </View>
              ) : null}
              {error ? (
                <View style={styles.errorRow}>
                  <WarningCircle size={16} color={colors.danger} weight="fill" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Escreve a tua pergunta…"
            placeholderTextColor={palette.neutral[400]}
            style={styles.composerInput}
            multiline
            maxLength={4000}
            editable={!loading}
            onSubmitEditing={() => send(input)}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={() => send(input)}
            disabled={loading || input.trim().length === 0}
            style={({ pressed }) => [
              styles.sendBtn,
              input.trim().length === 0 || loading
                ? styles.sendBtnDisabled
                : null,
              pressed && input.trim().length > 0 && !loading
                ? { backgroundColor: palette.primary[700] }
                : null,
            ]}
            accessibilityLabel="Enviar pergunta"
          >
            {loading ? (
              <ActivityIndicator color={palette.white} size="small" />
            ) : (
              <ArrowUp size={20} color={palette.white} weight="bold" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  headerTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
  },
  headerSubtitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: palette.neutral[500],
    marginTop: spacing.xs,
  },
  resetBtn: {
    padding: spacing.sm,
    borderRadius: radii.pill,
  },
  contextChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[200],
    borderWidth: 1,
    borderRadius: radii.pill,
    maxWidth: "90%",
  },
  contextChipText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: palette.primary[700],
    letterSpacing: 0.2,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  welcome: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: spacing.huge,
  },
  welcomeEyebrow: {
    ...t.eyebrow,
  },
  welcomeTitle: {
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 32,
    color: colors.text,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  welcomeBody: {
    ...t.bodyMuted,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
    maxWidth: 300,
  },
  suggestions: {
    alignSelf: "stretch",
    gap: spacing.md,
  },
  suggestion: {
    backgroundColor: palette.white,
    borderColor: palette.neutral[200],
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  suggestionPressed: {
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[200],
  },
  suggestionText: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    textAlign: "center",
  },
  messages: {
    gap: spacing.sm,
  },
  bubbleRow: {
    flexDirection: "row",
    width: "100%",
  },
  bubbleRowLeft: { justifyContent: "flex-start" },
  bubbleRowRight: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "85%",
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  bubbleUser: {
    backgroundColor: palette.primary[500],
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: palette.neutral[100],
    borderBottomLeftRadius: 4,
  },
  bubbleTextUser: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: palette.white,
  },
  bubbleTextAssistant: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  errorText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.danger,
    flex: 1,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.bg,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    backgroundColor: palette.neutral[50],
    borderColor: palette.neutral[200],
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.primary[500],
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: palette.neutral[300],
  },
});
