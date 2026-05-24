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
  CaretDownIcon as CaretDown,
  CheckIcon as Check,
  MicrophoneIcon as Microphone,
  WarningCircleIcon as WarningCircle,
  XIcon as X,
} from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { PressableScale } from "@/components/ui/PressableScale";
import { Plan, api } from "@/lib/api";
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
  // Active (non-archived) plans available as context. The Ask flow only
  // surfaces plans the user is still training — archived ones would just
  // pollute the picker.
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const activePlan = useMemo(
    () => availablePlans.find((p) => p.id === activePlanId) ?? null,
    [availablePlans, activePlanId],
  );

  // Voice dictation state. Hold-to-talk: onPressIn starts, onPressOut commits
  // (transcribe + drop into the input). Anything shorter than MIN_HOLD_MS is
  // treated as an accidental tap — no transcription, no error.
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);
  const [voicePermission, setVoicePermission] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [composerMode, setComposerMode] = useState<"idle" | "recording">("idle");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const recordingActiveRef = useRef(false);
  // Tracks the user's intent to be holding the mic. Flipped true on press
  // and false on release. Checked at every async resumption point inside
  // startDictation so a fast tap-and-release before `prepareToRecordAsync`
  // resolves doesn't leak a silent recording in the background (the bug
  // that made the next press appear to do nothing).
  const recordingIntentRef = useRef(false);
  const MIN_HOLD_MS = 400;

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

  // Fetch every available plan once on mount so the user can switch context
  // mid-conversation when more than one plan is in progress. The overlay
  // unmounts on close, so the next open refetches — same lifecycle as before.
  // Active plans only (those with at least one day still incomplete or empty);
  // archived plans would clutter the picker without adding signal.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const deviceId = await getDeviceId();
        const [plans, lastId] = await Promise.all([
          api.getPlans(deviceId),
          getLastPlanId(),
        ]);
        if (cancelled) return;
        const active = plans.filter(
          (p) => p.days.length === 0 || p.days.some((d) => !d.completed_at),
        );
        setAvailablePlans(active);
        if (active.length === 0) {
          setActivePlanId(null);
          return;
        }
        const preferred = lastId && active.find((p) => p.id === lastId);
        setActivePlanId(preferred ? preferred.id : active[0].id);
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
          plan_id: activePlanId,
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
    [activePlanId, loading, messages],
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
    if (loading || transcribing || recordingIntentRef.current) return;
    recordingIntentRef.current = true;
    recordingStartRef.current = Date.now();
    const granted = await ensureMicPermission();
    if (!granted) {
      recordingIntentRef.current = false;
      Alert.alert(
        "Microfone",
        "Precisamos de permissão de microfone para ditar a pergunta.",
      );
      return;
    }
    if (!recordingIntentRef.current) {
      // User released while we were asking for permission.
      return;
    }
    setError(null);
    setComposerMode("recording");
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      try {
        await recorder.prepareToRecordAsync();
      } catch {
        // Recorder is stuck in a prepared state from a prior tap-and-release
        // race (the next prepareToRecordAsync always rejects until we flush
        // it). Try to recycle and retry once.
        try { await recorder.stop(); } catch {}
        await recorder.prepareToRecordAsync();
      }
      if (!recordingIntentRef.current) {
        // User released during prepare. We MUST flush the prepared recorder,
        // otherwise the next prepareToRecordAsync rejects with
        // "AudioRecorder.prepareToRecordAsync has been rejected" and the mic
        // is dead until the screen unmounts. record() + stop() recycles it.
        try {
          recorder.record();
          await recorder.stop();
        } catch {}
        setComposerMode("idle");
        return;
      }
      recorder.record();
      recordingActiveRef.current = true;
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
      // Best-effort recovery so the user can try again without remounting.
      try { await recorder.stop(); } catch {}
      recordingActiveRef.current = false;
      recordingIntentRef.current = false;
      setComposerMode("idle");
      setError((e as Error).message);
    }
  }

  async function stopDictation() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const wasActive = recordingActiveRef.current;
    const heldFor = Date.now() - recordingStartRef.current;
    recordingActiveRef.current = false;
    recordingIntentRef.current = false;
    setComposerMode("idle");
    if (!wasActive) {
      // Recording never started (permission denied / prepareToRecord still
      // running when finger lifted). Nothing to stop, nothing to transcribe.
      return;
    }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      await recorder.stop();
    } catch (e) {
      console.warn("stop dictation failed", e);
    }
    if (heldFor < MIN_HOLD_MS) {
      // Accidental tap on the mic. Stay silent — the "hold to talk" affordance
      // (mic icon + hint while recording) already teaches the pattern.
      return;
    }
    const uri = recorder.uri;
    if (!uri) {
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
        <Animated.View entering={FadeIn.duration(200)} style={styles.contextChipWrap}>
          <Pressable
            onPress={() => {
              if (availablePlans.length <= 1) return;
              Haptics.selectionAsync().catch(() => {});
              setPickerOpen(true);
            }}
            disabled={availablePlans.length <= 1}
            style={({ pressed }) => [
              styles.contextChip,
              pressed && availablePlans.length > 1
                ? styles.contextChipPressed
                : null,
            ]}
            accessibilityRole={availablePlans.length > 1 ? "button" : "text"}
            accessibilityLabel={
              availablePlans.length > 1
                ? `Contexto: ${activePlan.prep_for}. Toca para trocar de plano.`
                : `Contexto: ${activePlan.prep_for}`
            }
          >
            <View style={styles.contextChipBody}>
              <Text style={styles.contextChipEyebrow}>Contexto</Text>
              <Text style={styles.contextChipText} numberOfLines={1}>
                {activePlan.prep_for}
              </Text>
            </View>
            {availablePlans.length > 1 ? (
              <View style={styles.contextChipCaret}>
                <CaretDown
                  size={14}
                  color={palette.primary[700]}
                  weight="bold"
                />
              </View>
            ) : null}
          </Pressable>
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
              <Text style={styles.welcomeTitle}>Em que te posso ajudar?</Text>
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
              pointerEvents="auto"
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
                      onPressIn={startDictation}
                      onPressOut={stopDictation}
                      disabled={loading || !micVisible}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.micBtn,
                        pressed ? styles.micBtnPressed : null,
                        loading ? styles.micBtnDisabled : null,
                      ]}
                      accessibilityLabel="Manter premido para ditar a pergunta"
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
              pointerEvents="none"
            >
              <Waveform
                amplitude={meteringToAmp(recorderState.metering)}
                active={composerMode === "recording"}
              />
              <Text style={styles.recordingTimer}>{formatMmSs(elapsed)}</Text>
              <View style={styles.recordingMicIndicator}>
                <Microphone size={18} color={palette.white} weight="bold" />
              </View>
            </Animated.View>
          </View>

          {composerMode === "recording" ? (
            <Animated.View entering={FadeIn.duration(200).delay(120)}>
              <Text style={styles.holdHint}>Solta para enviar</Text>
            </Animated.View>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setPickerOpen(false)}
        >
          <Pressable
            style={styles.pickerSheet}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.pickerEyebrow}>Contexto</Text>
            <Text style={styles.pickerTitle}>Sobre que plano queres falar?</Text>

            <View style={styles.pickerList}>
              {availablePlans.map((p) => {
                const isSelected = p.id === activePlanId;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setActivePlanId(p.id);
                      setPickerOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.pickerOption,
                      isSelected ? styles.pickerOptionSelected : null,
                      pressed ? styles.pickerOptionPressed : null,
                    ]}
                  >
                    <View style={styles.pickerOptionBody}>
                      <Text
                        style={[
                          styles.pickerOptionTitle,
                          isSelected ? styles.pickerOptionTitleSelected : null,
                        ]}
                        numberOfLines={2}
                      >
                        {p.prep_for}
                      </Text>
                    </View>
                    {isSelected ? (
                      <View style={styles.pickerOptionCheck}>
                        <Check
                          size={16}
                          color={palette.white}
                          weight="bold"
                        />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={() => setPickerOpen(false)}
              style={({ pressed }) => [
                styles.pickerCancel,
                pressed ? { opacity: 0.6 } : null,
              ]}
            >
              <Text style={styles.pickerCancelText}>CANCELAR</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
    // Reanimated 4 strictly workletizes withTiming completion callbacks, so
    // the previous self-restarting JS closure crashed with "run is not a
    // function" on the UI thread. withRepeat(withSequence(...)) keeps the
    // loop entirely in worklet land.
    v.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 360, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.3, { duration: 360, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
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
    paddingTop: spacing.xl,
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
  contextChipWrap: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  contextChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[200],
    borderWidth: 1,
    borderRadius: radii.pill,
  },
  contextChipPressed: {
    backgroundColor: palette.primary[100],
    borderColor: palette.primary[300],
  },
  contextChipBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  contextChipEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: palette.primary[600],
    letterSpacing: 0.2,
  },
  contextChipText: {
    flex: 1,
    fontFamily: fonts.extrabold,
    fontSize: 13,
    color: palette.primary[700],
  },
  contextChipCaret: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
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
  welcomeTitle: {
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 32,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.xxl,
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
  // Non-interactive circle where the user's finger is during a hold. Same
  // footprint as the old stop button so the recording pill stays balanced.
  recordingMicIndicator: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.primary[500],
    alignItems: "center",
    justifyContent: "center",
  },
  // Overlays the idle pill: same edges so they morph cleanly via opacity.
  recordingPillAbsolute: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  holdHint: {
    alignSelf: "center",
    marginTop: 6,
    fontFamily: fonts.bold,
    fontSize: 12,
    color: palette.primary[600],
  },

  // Plan-context picker. Same backdrop + sheet pattern as the long-press
  // action sheet on /plans so the affordances feel consistent.
  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  pickerSheet: {
    backgroundColor: palette.white,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  pickerEyebrow: {
    ...t.eyebrow,
  },
  pickerTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pickerList: {
    gap: spacing.sm,
  },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.neutral[50],
    borderWidth: 1,
    borderColor: palette.neutral[100],
  },
  pickerOptionPressed: {
    backgroundColor: palette.neutral[100],
  },
  pickerOptionSelected: {
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[300],
  },
  pickerOptionBody: {
    flex: 1,
  },
  pickerOptionTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  pickerOptionTitleSelected: {
    color: palette.primary[700],
  },
  pickerOptionCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: palette.primary[500],
    alignItems: "center",
    justifyContent: "center",
  },
  pickerCancel: {
    alignItems: "center",
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  pickerCancelText: {
    fontFamily: fonts.extrabold,
    fontSize: 12,
    letterSpacing: 1.8,
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
