// Ask content rendered inside the Revolut-style circular reveal overlay.
//
// Previously lived as a tab route at app/ask; now mounts/unmounts
// each time the user opens or closes the overlay. The mount/unmount cycle
// gives us the "tab switch resets the conversation" behavior for free, so the
// old `useFocusEffect` was reduced to a plain `useEffect`.
//
// Owns its own X close button (top-right, rightmost element) and renders
// `SafeAreaView` itself since the overlay is no longer a route.

import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import {
  ArrowClockwiseIcon as ArrowClockwise,
  ArrowUpIcon as ArrowUp,
  BookmarkIcon as Bookmark,
  MicrophoneIcon as Microphone,
  WarningCircleIcon as WarningCircle,
  XIcon as X,
} from "phosphor-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { PressableScale } from "@/components/ui/PressableScale";
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

// Voice dictation cap. Ask questions tend to be short; 2 min is generous and
// matches the implicit ceiling on `AskMessage.content` (4000 chars).
const ASK_MAX_SECONDS = 120;

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function AskOverlay({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  // Voice dictation state.
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);
  const [voicePermission, setVoicePermission] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [composerMode, setComposerMode] = useState<"idle" | "recording">("idle");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelDictationRef = useRef(false);

  // Morph driver: 0 = idle composer, 1 = recording waveform. The two layers
  // sit on top of each other (one in normal flow, the other absolute) and
  // simply crossfade. Ease-in-out keeps the midpoint soft.
  const morph = useSharedValue(0);
  useEffect(() => {
    morph.value = withTiming(composerMode === "recording" ? 1 : 0, {
      duration: 320,
      easing: Easing.inOut(Easing.quad),
    });
  }, [composerMode, morph]);

  const idleStyle = useAnimatedStyle(() => ({ opacity: 1 - morph.value }));
  const recordingStyle = useAnimatedStyle(() => ({ opacity: morph.value }));

  // Mic button collapse: when the input has text (or we're transcribing), the
  // mic icon shrinks away. Keeps both buttons in the DOM so the send button
  // doesn't snap horizontally — width + opacity + scale ease together.
  const inputEmpty = input.trim().length === 0;
  const micVisible = inputEmpty && !transcribing;
  const micAnim = useSharedValue(1);
  useEffect(() => {
    micAnim.value = withTiming(micVisible ? 1 : 0, {
      duration: 160,
      easing: Easing.out(Easing.quad),
    });
  }, [micVisible, micAnim]);
  const micCollapseStyle = useAnimatedStyle(() => ({
    width: 36 * micAnim.value,
    marginRight: 4 * micAnim.value,
  }));
  const micInnerStyle = useAnimatedStyle(() => ({
    opacity: micAnim.value,
    transform: [{ scale: 0.7 + 0.3 * micAnim.value }],
  }));

  // Send button: dims+shrinks slightly when disabled (no input) so the
  // ready/not-ready transition is felt, not just a colour swap.
  const sendActive = !inputEmpty && !loading && !transcribing;
  const sendAnim = useSharedValue(sendActive ? 1 : 0);
  useEffect(() => {
    sendAnim.value = withTiming(sendActive ? 1 : 0, {
      duration: 160,
      easing: Easing.out(Easing.quad),
    });
  }, [sendActive, sendAnim]);
  const sendStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.92 + 0.08 * sendAnim.value }],
  }));

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Resolve the active plan once on mount. Closing the overlay unmounts the
  // component, so the next open will refetch — exactly the prior tab-switch
  // behavior. Hits the cache first so the context chip appears instantly.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const planId = await getLastPlanId();
        if (!planId) return;
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
  }, []);

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

  async function ensureMicPermission(): Promise<boolean> {
    if (voicePermission === true) return true;
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    setVoicePermission(granted);
    if (granted) {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    }
    return granted;
  }

  async function startDictation() {
    if (loading || transcribing || recorderState.isRecording) return;
    const granted = await ensureMicPermission();
    if (!granted) {
      Alert.alert(
        "Microfone",
        "Precisamos de permissão de microfone para ditar a pergunta.",
      );
      return;
    }
    setError(null);
    cancelDictationRef.current = false;
    setComposerMode("recording");
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await recorder.prepareToRecordAsync();
      recorder.record();
      setElapsed(0);
      tickRef.current = setInterval(() => {
        setElapsed((e) => {
          if (e + 1 >= ASK_MAX_SECONDS) {
            void stopDictation();
            return ASK_MAX_SECONDS;
          }
          return e + 1;
        });
      }, 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function stopDictation() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setComposerMode("idle");
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      await recorder.stop();
    } catch (e) {
      console.warn("stop dictation failed", e);
    }
    if (cancelDictationRef.current) return;
    const uri = recorder.uri;
    if (!uri) {
      setError("Gravação não foi guardada. Tenta de novo.");
      return;
    }
    setTranscribing(true);
    try {
      const deviceId = await getDeviceId();
      const res = await api.transcribeAsk({ device_id: deviceId, audio_uri: uri });
      const text = (res.text || "").trim();
      if (!text) {
        setError("Não consegui ouvir nada. Tenta de novo num sítio mais calmo.");
      } else {
        setInput((prev) => (prev.trim().length > 0 ? `${prev.trim()} ${text}` : text));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  }

  function cancelDictation() {
    cancelDictationRef.current = true;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    recorder.stop().catch(() => {});
    setElapsed(0);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.headerSlot} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Perguntar</Text>
        </View>
        <View style={styles.headerActions}>
          {messages.length > 0 ? (
            <Pressable
              onPress={reset}
              hitSlop={10}
              style={({ pressed }) => [
                styles.headerIconBtn,
                pressed ? { backgroundColor: palette.neutral[100] } : null,
              ]}
              accessibilityLabel="Nova conversa"
            >
              <ArrowClockwise size={20} color={palette.neutral[600]} weight="bold" />
            </Pressable>
          ) : null}
          <PressableScale
            hitSlop={12}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Fechar"
          >
            <View style={styles.headerIconBtn}>
              <X size={24} color={palette.neutral[700]} weight="regular" />
            </View>
          </PressableScale>
        </View>
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
                difíceis. Podes escrever ou tocar no microfone para ditar.
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s, i) => (
                  <Animated.View
                    key={s}
                    entering={FadeInDown.duration(220).delay(80 + i * 40)}
                  >
                    <PressableScale
                      onPress={() => send(s)}
                      style={({ pressed }) => [
                        styles.suggestion,
                        pressed ? styles.suggestionPressed : null,
                      ]}
                    >
                      <Text style={styles.suggestionText}>{s}</Text>
                    </PressableScale>
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          ) : (
            <View style={styles.messages}>
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <Animated.View
                    key={i}
                    entering={FadeInUp.duration(180)}
                    style={[styles.bubbleRow, styles.bubbleRowRight]}
                  >
                    <View style={[styles.bubble, styles.bubbleUser]}>
                      <Text style={styles.bubbleTextUser}>{m.content}</Text>
                    </View>
                  </Animated.View>
                ) : (
                  <Animated.View
                    key={i}
                    entering={FadeInUp.duration(180)}
                    style={styles.assistantBlock}
                  >
                    <Markdown style={markdownStyles}>{m.content}</Markdown>
                  </Animated.View>
                ),
              )}
              {loading ? <TypingDots /> : null}
              {error ? (
                <View style={styles.errorRow}>
                  <WarningCircle size={16} color={colors.danger} weight="fill" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>

        <View style={styles.composerWrap}>
          {/* Layer stack: idle pill in normal flow + recording pill absolute
              on top. They share the same footprint and crossfade via opacity
              when `composerMode` flips. */}
          <View style={styles.layerStack}>
            <Animated.View
              style={[styles.composerPill, idleStyle]}
              pointerEvents={composerMode === "idle" ? "auto" : "none"}
            >
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={
                  transcribing
                    ? "A transcrever…"
                    : "Escreve ou dita a tua pergunta…"
                }
                placeholderTextColor={palette.neutral[400]}
                style={styles.composerInputInner}
                multiline
                maxLength={4000}
                editable={!loading && !transcribing && composerMode === "idle"}
                onSubmitEditing={() => send(input)}
                blurOnSubmit={false}
              />

              <View style={styles.composerActions}>
                <Animated.View
                  style={[styles.micCollapseWrap, micCollapseStyle]}
                  pointerEvents={micVisible ? "auto" : "none"}
                >
                  <Animated.View style={micInnerStyle}>
                    <Pressable
                      onPress={startDictation}
                      disabled={loading || !micVisible}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.micBtn,
                        pressed ? styles.micBtnPressed : null,
                        loading ? styles.micBtnDisabled : null,
                      ]}
                      accessibilityLabel="Ditar pergunta por voz"
                    >
                      <Microphone size={18} color={palette.primary[600]} weight="bold" />
                    </Pressable>
                  </Animated.View>
                </Animated.View>

                <Animated.View style={sendStyle}>
                  <Pressable
                    onPress={() => send(input)}
                    disabled={loading || transcribing || inputEmpty}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.sendBtn,
                      !sendActive ? styles.sendBtnDisabled : null,
                      pressed && sendActive
                        ? { backgroundColor: palette.primary[700] }
                        : null,
                    ]}
                    accessibilityLabel="Enviar pergunta"
                  >
                    {loading || transcribing ? (
                      <ActivityIndicator color={palette.white} size="small" />
                    ) : (
                      <ArrowUp size={18} color={palette.white} weight="bold" />
                    )}
                  </Pressable>
                </Animated.View>
              </View>
            </Animated.View>

            <Animated.View
              style={[styles.recordingPill, styles.recordingPillAbsolute, recordingStyle]}
              pointerEvents={composerMode === "recording" ? "auto" : "none"}
            >
              <Waveform
                amplitude={meteringToAmp(recorderState.metering)}
                active={composerMode === "recording"}
              />
              <Text style={styles.recordingTimer}>{formatMmSs(elapsed)}</Text>
              <Pressable
                onPress={stopDictation}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.stopBtn,
                  pressed ? { backgroundColor: palette.primary[700] } : null,
                ]}
                accessibilityLabel="Terminar gravação e transcrever"
              >
                <View style={styles.stopSquare} />
              </Pressable>
            </Animated.View>
          </View>

          {composerMode === "recording" ? (
            <Animated.View entering={FadeIn.duration(200).delay(160)}>
              <Pressable
                onPress={cancelDictation}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  pressed ? { backgroundColor: palette.neutral[100] } : null,
                ]}
                accessibilityLabel="Cancelar gravação"
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Three-dot typing indicator while the assistant is composing a reply. Each
// dot fades 0.3 → 1 in a staggered loop so it reads as "thinking".

function TypingDots() {
  return (
    <View style={styles.typingRow}>
      <TypingDot delay={0} />
      <TypingDot delay={160} />
      <TypingDot delay={320} />
    </View>
  );
}

function TypingDot({ delay }: { delay: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    const run = () => {
      v.value = withTiming(1, { duration: 360, easing: Easing.inOut(Easing.quad) }, () => {
        v.value = withTiming(0.3, { duration: 360, easing: Easing.inOut(Easing.quad) }, () => {
          // self-restart — withRepeat would do this too but the explicit form
          // makes the delay-on-first-frame easier to reason about.
          run();
        });
      });
    };
    const id = setTimeout(run, delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.85 + v.value * 0.2 }],
  }));
  return <Animated.View style={[styles.typingDot, style]} />;
}

// ---------------------------------------------------------------------------
// Waveform: 28 bars driven by a ring buffer of recent mic amplitudes. Lives
// inside the recording pill alongside the timer and the stop button. The
// "Cancelar" link is rendered outside the clipper by the parent so it doesn't
// get cropped by the morph animation.
// ---------------------------------------------------------------------------

const WAVEFORM_BARS = 28;
const WAVEFORM_MIN_AMP = 0.08;

function meteringToAmp(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db)) return WAVEFORM_MIN_AMP;
  const norm = (db + 60) / 60;
  if (norm < WAVEFORM_MIN_AMP) return WAVEFORM_MIN_AMP;
  if (norm > 1) return 1;
  return norm;
}

// Live waveform: 28 bars driven by a ring buffer of recent mic amplitudes.
// On each `amplitude` change we shift the buffer (drop oldest, push newest)
// and ease each bar's shared value toward its target with a short withTiming.
function Waveform({ amplitude, active }: { amplitude: number; active: boolean }) {
  // 28 explicit shared values keep the hook count fixed (rules-of-hooks).
  /* eslint-disable react-hooks/rules-of-hooks */
  const bars = Array.from({ length: WAVEFORM_BARS }, () =>
    useSharedValue(WAVEFORM_MIN_AMP),
  );
  /* eslint-enable react-hooks/rules-of-hooks */
  const bufferRef = useRef<number[]>(
    Array.from({ length: WAVEFORM_BARS }, () => WAVEFORM_MIN_AMP),
  );

  useEffect(() => {
    const incoming = active ? amplitude : WAVEFORM_MIN_AMP;
    const next = [...bufferRef.current.slice(1), incoming];
    bufferRef.current = next;
    for (let i = 0; i < bars.length; i++) {
      bars[i].value = withTiming(next[i], {
        duration: 120,
        easing: Easing.out(Easing.quad),
      });
    }
    // `bars` is a fresh array each render but its contents (shared values)
    // are stable; depending on it would loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amplitude, active]);

  return (
    <View style={styles.waveform}>
      {bars.map((sv, i) => (
        <WaveBar key={i} sv={sv} />
      ))}
    </View>
  );
}

function WaveBar({ sv }: { sv: ReturnType<typeof useSharedValue<number>> }) {
  const style = useAnimatedStyle(() => {
    const min = 4;
    const max = 28;
    return { height: min + sv.value * (max - min) };
  });
  return <Animated.View style={[styles.waveBar, style]} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  headerSlot: {
    width: 40,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.text,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
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
  bubbleTextUser: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: palette.white,
  },
  assistantBlock: {
    width: "100%",
    paddingVertical: spacing.xs,
  },
  assistantLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: 2,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.primary[500],
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
  // Composer wrap — column container holding the layerStack (idle + recording
  // clippers) and an optional "Cancelar" link below. Padding matches the
  // previous composer footprint so the layout doesn't shift.
  composerWrap: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.bg,
  },
  // Stack that hosts both pills sharing the same footprint. The idle pill is
  // in normal flow; the recording pill overlays it via `recordingPillAbsolute`
  // and they crossfade via opacity.
  layerStack: {
    position: "relative",
    minHeight: 56,
    justifyContent: "center",
  },
  // Idle composer pill: rounded container that holds the TextInput and the
  // mic + send buttons together (ChatGPT-style). Buttons sit on the right and
  // align to the bottom so multi-line input grows upward.
  composerPill: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.xs,
    minHeight: 52,
    paddingLeft: spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
    backgroundColor: palette.neutral[50],
    borderColor: palette.neutral[200],
    borderWidth: 1,
    borderRadius: radii.xl,
  },
  composerInputInner: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    paddingHorizontal: 0,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  composerActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 2,
  },
  // Clipper around the mic button so it can collapse to width 0 without the
  // Pressable's own width fighting the layout. Inner Animated.View handles the
  // scale/opacity; this wrapper handles the width + margin morph.
  micCollapseWrap: {
    height: 36,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  micBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  micBtnPressed: {
    opacity: 0.6,
  },
  micBtnDisabled: {
    opacity: 0.5,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.primary[500],
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: palette.neutral[300],
  },

  // Recording pill: same footprint as the idle pill (matched width, height,
  // border radius) so the two morph cleanly into each other.
  recordingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    paddingLeft: spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[200],
    borderWidth: 1,
    borderRadius: radii.xl,
  },
  waveform: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 32,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: palette.primary[500],
  },
  recordingTimer: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    color: palette.primary[700],
    fontVariant: ["tabular-nums"],
    minWidth: 44,
    textAlign: "right",
  },
  stopBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.primary[500],
    alignItems: "center",
    justifyContent: "center",
  },
  // The square inside the round stop pill — the spec asked for a square stop
  // icon inside a pill, so we draw a plain white rounded square rather than
  // reaching for the Phosphor Stop glyph (cleaner edges at this size).
  stopSquare: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: palette.white,
  },
  // Overlays the idle pill: same edges so they morph cleanly via opacity.
  recordingPillAbsolute: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  cancelBtn: {
    alignSelf: "center",
    marginTop: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  cancelBtnText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: palette.neutral[500],
  },
});

const codeFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

// Styles passed to <Markdown />. Every text-emitting rule sets fontFamily
// explicitly — without that, Android falls back to a system face and
// **bold** renders against the system "bold" weight instead of Nunito.
const markdownStyles = {
  body: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  text: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  textgroup: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  paragraph: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginTop: 0,
    marginBottom: spacing.sm,
  },
  heading1: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.text,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  heading2: {
    fontFamily: fonts.extrabold,
    fontSize: 19,
    lineHeight: 26,
    color: colors.text,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  heading3: {
    fontFamily: fonts.bold,
    fontSize: 17,
    lineHeight: 24,
    color: colors.text,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  heading4: {
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: 2,
  },
  strong: {
    fontFamily: fonts.extrabold,
    color: colors.text,
  },
  em: {
    fontFamily: fonts.semibold,
    fontStyle: "italic" as const,
    color: colors.text,
  },
  s: {
    fontFamily: fonts.semibold,
    textDecorationLine: "line-through" as const,
    color: colors.text,
  },
  bullet_list: {
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  ordered_list: {
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  list_item: {
    marginVertical: 2,
    flexDirection: "row" as const,
  },
  bullet_list_icon: {
    fontFamily: fonts.bold,
    color: palette.primary[600],
    marginRight: 6,
    lineHeight: 22,
    fontSize: 15,
  },
  bullet_list_content: {
    flex: 1,
  },
  ordered_list_icon: {
    fontFamily: fonts.bold,
    color: palette.primary[600],
    marginRight: 6,
    lineHeight: 22,
    fontSize: 15,
  },
  ordered_list_content: {
    flex: 1,
  },
  code_inline: {
    fontFamily: codeFont,
    backgroundColor: palette.neutral[100],
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 14,
    color: colors.text,
    borderWidth: 0,
  },
  fence: {
    fontFamily: codeFont,
    backgroundColor: palette.neutral[100],
    borderRadius: radii.sm,
    padding: spacing.sm,
    fontSize: 14,
    color: colors.text,
    marginVertical: spacing.xs,
    borderWidth: 0,
  },
  code_block: {
    fontFamily: codeFont,
    backgroundColor: palette.neutral[100],
    borderRadius: radii.sm,
    padding: spacing.sm,
    fontSize: 14,
    color: colors.text,
    marginVertical: spacing.xs,
    borderWidth: 0,
  },
  blockquote: {
    backgroundColor: palette.neutral[50],
    borderLeftColor: palette.primary[400],
    borderLeftWidth: 3,
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xs,
    marginVertical: spacing.xs,
  },
  link: {
    color: palette.primary[700],
    textDecorationLine: "underline" as const,
  },
  hr: {
    backgroundColor: palette.neutral[200],
    height: 1,
    marginVertical: spacing.sm,
  },
  table: {
    borderWidth: 1,
    borderColor: palette.neutral[200],
    borderRadius: radii.sm,
    marginVertical: spacing.xs,
  },
  thead: {
    backgroundColor: palette.neutral[50],
  },
  th: {
    padding: 6,
    fontFamily: fonts.bold,
  },
  td: {
    padding: 6,
    fontFamily: fonts.semibold,
  },
};
