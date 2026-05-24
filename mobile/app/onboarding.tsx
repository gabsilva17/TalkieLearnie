import * as DocumentPicker from "expo-document-picker";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import {
  CalendarBlankIcon as CalendarBlank,
  CaretLeftIcon as CaretLeft,
  CaretRightIcon as CaretRight,
  CheckIcon as Check,
  FilePdfIcon as FilePdf,
  MicrophoneIcon as Microphone,
  PaperclipIcon as Paperclip,
  XIcon as X,
} from "phosphor-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { DuoButton } from "@/components/ui/DuoButton";
import { Screen } from "@/components/ui/Screen";
import { FocusMode, api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { startPendingPlan } from "@/lib/pendingPlan";
import { colors, fonts, palette, radii, spacing, type as t } from "@/lib/theme";

const MAX_PLAN_DAYS = 7;

function daysUntilLocalMidnight(d: Date): number {
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

const MONTH_NAMES_FULL_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const WEEKDAY_NAMES_PT = ["S", "T", "Q", "Q", "S", "S", "D"];

function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatLongMonthDay(d: Date): string {
  return d.toLocaleDateString("pt-PT", { day: "numeric", month: "long" });
}

function stripTime(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameYMD(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

type Step = 0 | 1 | 2 | 3;
const TOTAL = 4;

// Mirror the backend cap (FastAPI also enforces 32 MB).
const MAX_PDF_BYTES = 32 * 1024 * 1024;

// Voice dictation cap. Onboarding answers tend to be short; 2 min matches the
// AskOverlay ceiling.
const VOICE_MAX_SECONDS = 120;

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const WAVEFORM_BARS = 28;
const WAVEFORM_MIN_AMP = 0.08;

function meteringToAmp(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db)) return WAVEFORM_MIN_AMP;
  const norm = (db + 60) / 60;
  if (norm < WAVEFORM_MIN_AMP) return WAVEFORM_MIN_AMP;
  if (norm > 1) return 1;
  return norm;
}

const PROMPTS: Record<Step, string> = {
  0: "Olá! Para que te queres preparar?",
  1: "Quando é o grande dia?",
  2: "E quem te vai estar a ouvir?",
  3: "Tens material para partilhar?",
};

const SUBTITLES: Record<Step, string | null> = {
  0: "Pitch, entrevista, conversa difícil. Diz-nos em poucas palavras.",
  1: null,
  2: "Quanto mais souberes sobre eles, melhor preparamos o plano.",
  3: "Adiciona um deck, briefing ou notas para um plano mais afinado. (opcional)",
};

type FieldKey = "prep" | "audience" | "extra";

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [prepFor, setPrepFor] = useState("");
  const [audience, setAudience] = useState("");
  const [targetDate, setTargetDate] = useState<Date>(tomorrow());
  const [extraText, setExtraText] = useState("");
  const [pdf, setPdf] = useState<{ uri: string; name: string; size: number } | null>(null);
  const [focusMode, setFocusMode] = useState<FocusMode>("communication");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<FieldKey | null>(null);
  // Brief "✓" badge that pops up between steps when the user taps CONTINUAR.
  // Three-phase choreography so the check is *fully* off-screen before we
  // swap the step underneath:
  //   "in"   — overlay + check entering / holding
  //   "out"  — check shrinking + fading away (overlay backdrop still up so
  //            the old field stays masked)
  //   "idle" — step has been advanced, overlay's own FadeOut reveals the new
  //            field underneath.
  type ConfirmPhase = "idle" | "in" | "out";
  const [confirmPhase, setConfirmPhase] = useState<ConfirmPhase>("idle");
  const confirming = confirmPhase !== "idle";
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CONFIRM_HOLD_MS = 460;
  const CONFIRM_EXIT_MS = 240;

  // Voice dictation state — mirrors the AskOverlay pattern: a mic inside each
  // text field. Hold-to-talk: press and hold to record, release to transcribe
  // via POST /ask/transcribe and append to the field. Only one field is on
  // screen at a time so a single recorder + morph value is enough.
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);
  const [recordingField, setRecordingField] = useState<FieldKey | null>(null);
  const [voicePermission, setVoicePermission] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
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
  const isRecording = recordingField !== null;

  const trimmedPrep = prepFor.trim();
  const trimmedAud = audience.trim();
  const trimmedExtra = extraText.trim();
  const hasExtraContext = trimmedExtra.length > 0 || pdf !== null;
  const canContinue =
    !isRecording &&
    !transcribing &&
    ((step === 0 && trimmedPrep.length > 3) ||
      (step === 1 && targetDate.getTime() >= new Date().setHours(0, 0, 0, 0)) ||
      (step === 2 && trimmedAud.length > 3) ||
      step === 3);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const id = await getDeviceId();
      const targetISO = isoDate(targetDate);
      // Server caps the plan at MAX_PLAN_DAYS regardless of how far out the
      // user picks; mirror that here so the pending screen renders the right
      // number of skeleton cards before the API resolves.
      const nDays = Math.min(
        MAX_PLAN_DAYS,
        Math.max(1, daysUntilLocalMidnight(targetDate)),
      );
      startPendingPlan({
        device_id: id,
        prep_for: trimmedPrep,
        target_date: targetISO,
        audience_info: trimmedAud,
        n_days: nDays,
        extra_text: hasExtraContext ? trimmedExtra || null : null,
        pdf_uri: pdf ? pdf.uri : null,
        pdf_name: pdf ? pdf.name : null,
        focus_mode: hasExtraContext ? focusMode : null,
      });
      router.replace("/plan/pending");
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  function next() {
    if (!canContinue || confirming) return;
    if (step < 3) {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      // Phase 1: enter + hold.
      setConfirmPhase("in");
      confirmTimerRef.current = setTimeout(() => {
        // Phase 2: tell the check to animate out (backdrop stays so the old
        // field is still hidden).
        setConfirmPhase("out");
        confirmTimerRef.current = setTimeout(() => {
          // Phase 3: check is gone — swap the step and let the backdrop
          // FadeOut reveal the new field.
          setStep(((step + 1) as Step));
          setConfirmPhase("idle");
          confirmTimerRef.current = null;
        }, CONFIRM_EXIT_MS);
      }, CONFIRM_HOLD_MS);
    } else {
      submit();
    }
  }

  function back() {
    if (step === 0) {
      if (router.canGoBack()) router.back();
      else router.replace("/plans");
      return;
    }
    setStep(((step - 1) as Step));
  }

  async function pickPdf() {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const size = asset.size ?? 0;
      if (size > MAX_PDF_BYTES) {
        setError("O PDF é demasiado grande (máximo 32 MB).");
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setPdf({ uri: asset.uri, name: asset.name, size });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function removePdf() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPdf(null);
  }

  // Single focus driver — at any step only one field is rendered, so a single
  // 0→1 shared value can colour-shift whichever input is on screen.
  const focusAnim = useSharedValue(0);
  useEffect(() => {
    focusAnim.value = withTiming(focusedField !== null ? 1 : 0, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
  }, [focusedField, focusAnim]);
  const animatedBorder = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusAnim.value,
      [0, 1],
      [palette.neutral[200], palette.primary[500]],
    ),
  }));

  // Morph driver: idle field ↔ recording pill. Same opacity crossfade as in
  // AskOverlay — both layers share footprint, `pointerEvents` flips with mode.
  const morph = useSharedValue(0);
  useEffect(() => {
    morph.value = withTiming(isRecording ? 1 : 0, {
      duration: 320,
      easing: Easing.inOut(Easing.quad),
    });
  }, [isRecording, morph]);
  const idleStyle = useAnimatedStyle(() => ({ opacity: 1 - morph.value }));
  const recordingStyle = useAnimatedStyle(() => ({ opacity: morph.value }));

  // Button exit/entry driver. While the check badge is on screen the CTA
  // shrinks and fades out so the moment reads as a single confirmation
  // beat (input + button vanish together), then eases back into place for
  // the next step.
  const buttonOpacity = useSharedValue(1);
  const buttonScale = useSharedValue(1);
  useEffect(() => {
    if (confirming) {
      buttonOpacity.value = withTiming(0, {
        duration: 200,
        easing: Easing.out(Easing.quad),
      });
      buttonScale.value = withTiming(0.92, {
        duration: 200,
        easing: Easing.out(Easing.quad),
      });
    } else {
      buttonOpacity.value = withTiming(1, {
        duration: 260,
        easing: Easing.out(Easing.cubic),
      });
      buttonScale.value = withTiming(1, {
        duration: 260,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [confirming, buttonOpacity, buttonScale]);
  const buttonStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
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

  async function startDictation(field: FieldKey) {
    if (isRecording || transcribing || recordingIntentRef.current) return;
    recordingIntentRef.current = true;
    recordingStartRef.current = Date.now();
    const granted = await ensureMicPermission();
    if (!granted) {
      recordingIntentRef.current = false;
      Alert.alert(
        "Microfone",
        "Precisamos de permissão de microfone para ditar a resposta.",
      );
      return;
    }
    if (!recordingIntentRef.current) {
      // User released while we were asking for permission.
      return;
    }
    setError(null);
    setRecordingField(field);
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
        setRecordingField(null);
        return;
      }
      recorder.record();
      recordingActiveRef.current = true;
      setElapsed(0);
      tickRef.current = setInterval(() => {
        setElapsed((e) => {
          if (e + 1 >= VOICE_MAX_SECONDS) {
            void stopDictation();
            return VOICE_MAX_SECONDS;
          }
          return e + 1;
        });
      }, 1000);
    } catch (e) {
      // Best-effort recovery so the user can try again without remounting.
      try { await recorder.stop(); } catch {}
      recordingActiveRef.current = false;
      recordingIntentRef.current = false;
      setError((e as Error).message);
      setRecordingField(null);
    }
  }

  async function stopDictation() {
    const field = recordingField;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const wasActive = recordingActiveRef.current;
    const heldFor = Date.now() - recordingStartRef.current;
    recordingActiveRef.current = false;
    recordingIntentRef.current = false;
    setRecordingField(null);
    if (!wasActive || !field) {
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
      // Accidental tap on the mic — the user expects to *hold* to record.
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
      } else if (field === "prep") {
        setPrepFor((prev) =>
          prev.trim().length > 0 ? `${prev.trim()} ${text}` : text,
        );
      } else if (field === "audience") {
        setAudience((prev) =>
          prev.trim().length > 0 ? `${prev.trim()} ${text}` : text,
        );
      } else {
        setExtraText((prev) =>
          prev.trim().length > 0 ? `${prev.trim()} ${text}` : text,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <Screen scroll keyboardAware>
      <View style={styles.headerRow}>
        <Pressable onPress={back} hitSlop={12} style={styles.backBtn}>
          <X size={28} color={palette.neutral[400]} weight="bold" />
        </Pressable>
      </View>

      <View style={styles.centerBlock}>
        <View style={styles.stepHeader}>
          <Text style={styles.eyebrow}>{`Passo ${step + 1} de ${TOTAL}`}</Text>
          <Text style={styles.question}>{PROMPTS[step]}</Text>
          {SUBTITLES[step] ? (
            <Text style={styles.subtitle}>{SUBTITLES[step]}</Text>
          ) : null}
        </View>

        <View style={styles.fieldShell}>
          {step === 0 ? (
            <View style={styles.field}>
              <VoiceField
                value={prepFor}
                onChangeText={setPrepFor}
                placeholder="Ex.: pitch de hackathon, entrevista de emprego..."
                autoFocus
                onFocus={() => setFocusedField("prep")}
                onBlur={() => setFocusedField(null)}
                animatedBorder={animatedBorder}
                recording={recordingField === "prep"}
                transcribing={transcribing}
                meteringDb={recorderState.metering}
                elapsed={elapsed}
                onStartRecord={() => startDictation("prep")}
                onStopRecord={stopDictation}
                idleStyle={idleStyle}
                recordingStyle={recordingStyle}
              />
            </View>
          ) : null}

          {step === 1 ? (
            <Animated.View
              entering={FadeIn.duration(180)}
              style={styles.field}
            >
              <CalendarPicker
                value={targetDate}
                onChange={setTargetDate}
                min={tomorrow()}
              />
            </Animated.View>
          ) : null}

          {step === 2 ? (
            <View style={styles.field}>
              <VoiceField
                value={audience}
                onChangeText={setAudience}
                placeholder="Ex.: júri não técnico, investidor série A, manager directo..."
                autoFocus
                onFocus={() => setFocusedField("audience")}
                onBlur={() => setFocusedField(null)}
                animatedBorder={animatedBorder}
                recording={recordingField === "audience"}
                transcribing={transcribing}
                meteringDb={recorderState.metering}
                elapsed={elapsed}
                onStartRecord={() => startDictation("audience")}
                onStopRecord={stopDictation}
                idleStyle={idleStyle}
                recordingStyle={recordingStyle}
              />
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.fieldStep4}>
              <VoiceField
                value={extraText}
                onChangeText={setExtraText}
                placeholder="Ex.: notas do briefing, perguntas frequentes, números-chave..."
                onFocus={() => setFocusedField("extra")}
                onBlur={() => setFocusedField(null)}
                animatedBorder={animatedBorder}
                recording={recordingField === "extra"}
                transcribing={transcribing}
                meteringDb={recorderState.metering}
                elapsed={elapsed}
                onStartRecord={() => startDictation("extra")}
                onStopRecord={stopDictation}
                idleStyle={idleStyle}
                recordingStyle={recordingStyle}
              />

              <PdfAttachment pdf={pdf} onPick={pickPdf} onRemove={removePdf} />

              {hasExtraContext ? (
                <Animated.View
                  entering={FadeIn.duration(220)}
                  exiting={FadeOut.duration(160)}
                >
                  <FocusToggle value={focusMode} onChange={setFocusMode} />
                </Animated.View>
              ) : null}
            </View>
          ) : null}

          {confirming ? (
            <Animated.View
              pointerEvents="none"
              style={styles.confirmOverlay}
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(220)}
            >
              <View style={styles.confirmBackdrop} />
              <ConfirmCheckBadge exiting={confirmPhase === "out"} />
            </Animated.View>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Animated.View
          style={[styles.buttonWrap, buttonStyle]}
          pointerEvents={confirming ? "none" : "auto"}
        >
          <DuoButton
            title={step < 3 ? "CONTINUAR" : "GERAR O MEU PLANO"}
            onPress={next}
            disabled={!canContinue || confirming}
            loading={submitting}
          />
        </Animated.View>

        {step === 3 ? (
          <Text style={styles.hint}>A IA prepara as sessões em 10–20 segundos.</Text>
        ) : null}
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Brief confirmation badge that masks the field area between steps. Primary
// circle pops in with a spring, a soft ring ripples outward behind it, and a
// white check inside finishes the moment. The whole overlay then fades out as
// the next step's content slides into view.
// ---------------------------------------------------------------------------

function ConfirmCheckBadge({ exiting }: { exiting: boolean }) {
  const ringScale = useSharedValue(0.55);
  const ringOpacity = useSharedValue(0.55);
  const circleScale = useSharedValue(0.3);
  const circleOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0);
  const checkOpacity = useSharedValue(0);

  useEffect(() => {
    // Ring ripples outward and fades — gives the moment a halo.
    ringScale.value = withTiming(1.85, {
      duration: 720,
      easing: Easing.out(Easing.cubic),
    });
    ringOpacity.value = withTiming(0, {
      duration: 720,
      easing: Easing.out(Easing.cubic),
    });
    // Disk springs in, check icon lands a beat later so the eye sees the
    // circle first then the tick.
    circleScale.value = withSpring(1, {
      mass: 0.5,
      damping: 11,
      stiffness: 180,
    });
    circleOpacity.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
    checkScale.value = withDelay(
      90,
      withTiming(1, {
        duration: 260,
        easing: Easing.out(Easing.back(1.6)),
      }),
    );
    checkOpacity.value = withDelay(
      90,
      withTiming(1, {
        duration: 200,
        easing: Easing.out(Easing.quad),
      }),
    );
  }, [
    ringScale,
    ringOpacity,
    circleScale,
    circleOpacity,
    checkScale,
    checkOpacity,
  ]);

  useEffect(() => {
    if (!exiting) return;
    // Check shrinks + fades first, then the circle follows. Both finish
    // within ~240ms so the parent can swap the step right after.
    checkScale.value = withTiming(0, {
      duration: 160,
      easing: Easing.in(Easing.cubic),
    });
    checkOpacity.value = withTiming(0, {
      duration: 140,
      easing: Easing.in(Easing.quad),
    });
    circleScale.value = withDelay(
      60,
      withTiming(0.4, {
        duration: 220,
        easing: Easing.in(Easing.cubic),
      }),
    );
    circleOpacity.value = withDelay(
      60,
      withTiming(0, {
        duration: 220,
        easing: Easing.in(Easing.quad),
      }),
    );
  }, [exiting, checkScale, checkOpacity, circleScale, circleOpacity]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));
  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
    opacity: circleOpacity.value,
  }));
  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkOpacity.value,
  }));

  return (
    <View style={styles.confirmCheckWrap}>
      <Animated.View style={[styles.confirmCheckRing, ringStyle]} />
      <Animated.View style={[styles.confirmCheckCircle, circleStyle]}>
        <Animated.View style={checkStyle}>
          <Check size={36} color={palette.white} weight="bold" />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function CalendarPicker({
  value,
  onChange,
  min,
}: {
  value: Date;
  onChange: (d: Date) => void;
  min: Date;
}) {
  const [view, setView] = useState({
    year: value.getFullYear(),
    month: value.getMonth(),
  });

  const todayStripped = stripTime(new Date());
  const minStripped = stripTime(min);

  const rows = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const jsDow = first.getDay();
    const isoDow = (jsDow + 6) % 7;
    const total = daysInMonth(view.year, view.month);

    type Cell = { day: number | null };
    const cells: Cell[] = [];
    for (let i = 0; i < isoDow; i++) cells.push({ day: null });
    for (let d = 1; d <= total; d++) cells.push({ day: d });
    while (cells.length % 7 !== 0) cells.push({ day: null });
    const out: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [view]);

  const canGoBack = useMemo(() => {
    const py = view.month === 0 ? view.year - 1 : view.year;
    const pm = view.month === 0 ? 11 : view.month - 1;
    const lastDay = new Date(py, pm, daysInMonth(py, pm));
    return stripTime(lastDay).getTime() >= minStripped.getTime();
  }, [view, minStripped]);

  function step(delta: -1 | 1) {
    setView((v) => {
      let m = v.month + delta;
      let y = v.year;
      if (m < 0) { m = 11; y -= 1; }
      if (m > 11) { m = 0; y += 1; }
      return { year: y, month: m };
    });
  }

  return (
    <View style={styles.calRoot}>
      <View style={styles.calNavRow}>
        <Pressable
          onPress={() => step(-1)}
          disabled={!canGoBack}
          hitSlop={10}
          style={[styles.calNavBtn, !canGoBack && styles.calNavBtnDisabled]}
        >
          <CaretLeft
            size={18}
            color={canGoBack ? palette.neutral[700] : palette.neutral[300]}
            weight="bold"
          />
        </Pressable>
        <Text style={styles.calNavTitle}>
          <Text style={styles.calNavMonth}>
            {MONTH_NAMES_FULL_PT[view.month]}
          </Text>
          <Text style={styles.calNavYear}> {view.year}</Text>
        </Text>
        <Pressable
          onPress={() => step(1)}
          hitSlop={10}
          style={styles.calNavBtn}
        >
          <CaretRight size={18} color={palette.neutral[700]} weight="bold" />
        </Pressable>
      </View>

      <View style={styles.calWeekHeader}>
        {WEEKDAY_NAMES_PT.map((w, i) => (
          <Text key={i} style={styles.calWeekHeaderText}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.calGrid}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.calRow}>
            {row.map((c, ci) => {
              if (c.day === null) {
                return <View key={ci} style={styles.calCellWrap} />;
              }
              const date = new Date(view.year, view.month, c.day);
              const disabled =
                stripTime(date).getTime() < minStripped.getTime();
              const selected = sameYMD(date, value);
              const isToday = sameYMD(date, todayStripped);
              return (
                <View key={ci} style={styles.calCellWrap}>
                  <Pressable
                    onPress={() => {
                      if (!disabled) onChange(date);
                    }}
                    disabled={disabled}
                    style={({ pressed }) => [
                      styles.calCell,
                      selected && styles.calCellSelected,
                      !selected && isToday && styles.calCellToday,
                      pressed && !disabled && !selected && styles.calCellPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.calCellNum,
                        selected && styles.calCellNumSelected,
                        disabled && styles.calCellNumDisabled,
                      ]}
                    >
                      {c.day}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.calSelectedRow}>
        <CalendarBlank size={16} color={palette.primary[600]} weight="bold" />
        <Text style={styles.calSelectedLabel}>Seleccionado:</Text>
        <Text style={styles.calSelectedValue}>
          {formatLongMonthDay(value)}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Voice-enabled text field. Multiline textarea with a hold-to-talk mic icon
// in the bottom-right corner (Instagram-style). While recording, a primary-
// tinted pill overlays the whole field with a live waveform, mm:ss timer, and
// a non-interactive mic indicator showing the user's finger is committed.
// ---------------------------------------------------------------------------

type AnimatedStyle = ReturnType<typeof useAnimatedStyle>;

function VoiceField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  onFocus,
  onBlur,
  animatedBorder,
  recording,
  transcribing,
  meteringDb,
  elapsed,
  onStartRecord,
  onStopRecord,
  idleStyle,
  recordingStyle,
}: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  animatedBorder: AnimatedStyle;
  recording: boolean;
  transcribing: boolean;
  meteringDb: number | undefined;
  elapsed: number;
  onStartRecord: () => void;
  onStopRecord: () => void;
  idleStyle: AnimatedStyle;
  recordingStyle: AnimatedStyle;
}) {
  return (
    <View>
      <View style={styles.voiceLayerStack}>
        <Animated.View style={idleStyle} pointerEvents="auto">
          <View style={styles.inputWrap}>
            <AnimatedTextInput
              style={[styles.input, styles.inputWithMic, animatedBorder]}
              placeholder={transcribing ? "A transcrever…" : placeholder}
              placeholderTextColor={palette.neutral[400]}
              value={value}
              onChangeText={onChangeText}
              multiline
              autoFocus={autoFocus}
              editable={!transcribing}
              onFocus={onFocus}
              onBlur={onBlur}
            />
            <View style={styles.inlineMicSlot} pointerEvents="box-none">
              {transcribing ? (
                <View style={styles.inlineMicBtn}>
                  <ActivityIndicator size="small" color={palette.primary[600]} />
                </View>
              ) : (
                <Pressable
                  onPressIn={onStartRecord}
                  onPressOut={onStopRecord}
                  hitSlop={8}
                  accessibilityLabel="Manter premido para ditar a resposta"
                  style={({ pressed }) => [
                    styles.inlineMicBtn,
                    pressed ? styles.inlineMicBtnPressed : null,
                  ]}
                >
                  <Microphone size={20} color={palette.primary[600]} weight="bold" />
                </Pressable>
              )}
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={[styles.recordingPillAbsolute, styles.recordingPill, recordingStyle]}
          pointerEvents="none"
        >
          <Waveform amplitude={meteringToAmp(meteringDb)} active={recording} />
          <Text style={styles.recordingTimer}>{formatMmSs(elapsed)}</Text>
          <View style={styles.recordingMicIndicator}>
            <Microphone size={18} color={palette.white} weight="bold" />
          </View>
        </Animated.View>
      </View>

      {recording ? (
        <Animated.View entering={FadeIn.duration(200).delay(120)}>
          <Text style={styles.holdHint}>Solta para enviar</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

// Live waveform: 28 bars driven by a ring buffer of recent mic amplitudes.
// Same shape as the one in AskOverlay; kept inline so onboarding remains a
// single-file flow.
function Waveform({ amplitude, active }: { amplitude: number; active: boolean }) {
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

// ---------------------------------------------------------------------------
// PDF attachment slot. Idle: tappable card with a paperclip icon prompting
// the user to attach. Filled: muted card with the filename and an X to remove.
// ---------------------------------------------------------------------------

function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function PdfAttachment({
  pdf,
  onPick,
  onRemove,
}: {
  pdf: { uri: string; name: string; size: number } | null;
  onPick: () => void;
  onRemove: () => void;
}) {
  if (pdf) {
    return (
      <View style={styles.pdfAttached}>
        <View style={styles.pdfIconWrap}>
          <FilePdf size={20} color={palette.primary[600]} weight="fill" />
        </View>
        <View style={styles.pdfTextWrap}>
          <Text style={styles.pdfName} numberOfLines={1}>
            {pdf.name}
          </Text>
          {pdf.size ? (
            <Text style={styles.pdfMeta}>{formatBytes(pdf.size)}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          style={({ pressed }) => [
            styles.pdfRemoveBtn,
            pressed && styles.pdfRemoveBtnPressed,
          ]}
          accessibilityLabel="Remover PDF"
        >
          <X size={16} color={palette.neutral[500]} weight="bold" />
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPick}
      style={({ pressed }) => [
        styles.pdfPicker,
        pressed && styles.pdfPickerPressed,
      ]}
    >
      <Paperclip size={18} color={palette.primary[600]} weight="bold" />
      <Text style={styles.pdfPickerText}>Anexar PDF</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Focus toggle: three mutually-exclusive pills. Default is "communication" so
// the existing app behaviour is preserved unless the user actively shifts.
// ---------------------------------------------------------------------------

const FOCUS_OPTIONS: { value: FocusMode; label: string }[] = [
  { value: "communication", label: "Comunicação" },
  { value: "technical", label: "Técnico" },
  { value: "both", label: "Ambos" },
];

function FocusToggle({
  value,
  onChange,
}: {
  value: FocusMode;
  onChange: (m: FocusMode) => void;
}) {
  return (
    <View style={styles.focusWrap}>
      <Text style={styles.focusTitle}>Onde queres treinar mais?</Text>
      <Text style={styles.focusSubtitle}>
        O plano vai dar mais peso a esta dimensão.
      </Text>
      <View style={styles.focusSegment}>
        {FOCUS_OPTIONS.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChange(opt.value);
              }}
              style={({ pressed }) => [
                styles.focusSegmentItem,
                selected && styles.focusSegmentItemSelected,
                pressed && !selected && styles.focusSegmentItemPressed,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.focusSegmentText,
                  selected && styles.focusSegmentTextSelected,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  centerBlock: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: spacing.md,
  },
  stepHeader: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  buttonWrap: {
    marginTop: spacing.lg,
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.primary[600],
  },
  question: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.text,
    marginTop: spacing.md,
  },
  subtitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: palette.neutral[500],
    marginTop: spacing.sm,
  },
  field: { gap: spacing.sm, marginBottom: spacing.lg },
  // Step 4 has three stacked widgets (textarea, PDF slot, focus toggle), so
  // it needs more breathing room than the single-input steps.
  fieldStep4: { gap: spacing.lg, marginBottom: spacing.lg },
  // Relative container for the active step's field area. Anchors the absolute
  // confirm overlay so its backdrop matches the field's exact footprint.
  fieldShell: { position: "relative" },
  confirmOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
  },
  confirmCheckWrap: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCheckRing: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: palette.primary[200],
  },
  confirmCheckCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: palette.primary[500],
    alignItems: "center",
    justifyContent: "center",
    shadowColor: palette.primary[500],
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  input: {
    backgroundColor: palette.neutral[50],
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    minHeight: 88,
    textAlignVertical: "top",
  },
  calRoot: {
    paddingTop: spacing.sm,
  },
  calNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.lg,
  },
  calNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.neutral[100],
  },
  calNavBtnDisabled: {
    backgroundColor: palette.neutral[50],
  },
  calNavTitle: {
    flex: 1,
    textAlign: "center",
  },
  calNavMonth: {
    fontFamily: fonts.black,
    fontSize: 18,
    color: colors.text,
    textTransform: "capitalize",
  },
  calNavYear: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    color: palette.neutral[500],
    fontVariant: ["tabular-nums"],
  },
  calWeekHeader: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  calWeekHeaderText: {
    flex: 1,
    textAlign: "center",
    fontFamily: fonts.extrabold,
    fontSize: 11,
    color: palette.neutral[400],
    letterSpacing: 0.5,
  },
  calGrid: {
    gap: 6,
  },
  calRow: {
    flexDirection: "row",
    gap: 6,
  },
  calCellWrap: {
    flex: 1,
    aspectRatio: 1,
  },
  calCell: {
    flex: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.neutral[50],
  },
  calCellPressed: {
    backgroundColor: palette.primary[100],
  },
  calCellSelected: {
    backgroundColor: palette.primary[500],
  },
  calCellToday: {
    borderWidth: 2,
    borderColor: palette.primary[300],
  },
  calCellNum: {
    fontFamily: fonts.extrabold,
    fontSize: 15,
    color: palette.neutral[700],
    fontVariant: ["tabular-nums"],
  },
  calCellNumSelected: {
    color: palette.white,
  },
  calCellNumDisabled: {
    color: palette.neutral[300],
  },
  calSelectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.neutral[100],
  },
  calSelectedLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: palette.neutral[500],
    marginLeft: 2,
  },
  calSelectedValue: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
    color: colors.text,
    textTransform: "capitalize",
  },
  error: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  hint: {
    ...t.small,
    textAlign: "center",
    marginTop: spacing.md,
  },
  voiceLayerStack: {
    position: "relative",
  },
  inputWrap: {
    position: "relative",
  },
  // Reserve right-side room inside the textarea so text never slides under the
  // mic affordance (44 button + 12 breathing room).
  inputWithMic: {
    paddingRight: 56,
  },
  inlineMicSlot: {
    position: "absolute",
    right: 8,
    bottom: 8,
  },
  inlineMicBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[200],
    borderWidth: 1,
  },
  inlineMicBtnPressed: {
    backgroundColor: palette.primary[100],
  },
  recordingPillAbsolute: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  recordingPill: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: 8,
    paddingTop: spacing.md,
    paddingBottom: 8,
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[200],
    borderWidth: 1,
    borderRadius: radii.lg,
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
    paddingBottom: 10,
  },
  // Non-interactive circle anchored to the same bottom-right slot as the idle
  // mic button, so the user's finger stays "on" the mic across the morph.
  recordingMicIndicator: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.primary[500],
    alignItems: "center",
    justifyContent: "center",
  },
  holdHint: {
    alignSelf: "center",
    marginTop: 6,
    fontFamily: fonts.bold,
    fontSize: 12,
    color: palette.primary[600],
  },
  pdfPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: palette.primary[300],
    backgroundColor: palette.primary[50],
  },
  pdfPickerPressed: {
    backgroundColor: palette.primary[100],
  },
  pdfPickerText: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
    color: palette.primary[700],
  },
  pdfAttached: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.neutral[200],
    backgroundColor: palette.neutral[50],
  },
  pdfIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.primary[100],
    alignItems: "center",
    justifyContent: "center",
  },
  pdfTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  pdfName: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
    color: colors.text,
  },
  pdfMeta: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: palette.neutral[500],
    marginTop: 1,
  },
  pdfRemoveBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.neutral[100],
  },
  pdfRemoveBtnPressed: {
    backgroundColor: palette.neutral[200],
  },
  focusWrap: {
    gap: spacing.xs,
  },
  focusTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  focusSubtitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.neutral[500],
    marginBottom: spacing.sm,
  },
  // Segmented control: pill-shaped container with neutral fill, three equal
  // segments. The selected segment pops with primary fill + white text; the
  // others sit transparent on the container background.
  focusSegment: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 999,
    backgroundColor: palette.neutral[100],
  },
  focusSegmentItem: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  focusSegmentItemPressed: {
    backgroundColor: palette.neutral[200],
  },
  focusSegmentItemSelected: {
    backgroundColor: palette.primary[500],
    shadowColor: palette.primary[700],
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  focusSegmentText: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    color: palette.neutral[700],
  },
  focusSegmentTextSelected: {
    color: palette.white,
  },
});
