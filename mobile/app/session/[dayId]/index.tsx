import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CheckIcon as Check,
  FlameIcon as Flame,
  XIcon as X,
} from "phosphor-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInRight,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "@/components/ui/Card";
import { DuoButton } from "@/components/ui/DuoButton";
import { LogoMark } from "@/components/ui/LogoMark";
import { Pill } from "@/components/ui/Pill";
import { Screen } from "@/components/ui/Screen";
import { Plan, PlanDay, SessionResult, api, cacheKeys, getCached } from "@/lib/api";
import { localTodayISO } from "@/lib/dayDate";
import { getDeviceId } from "@/lib/deviceId";
import {
  colors,
  fonts,
  palette,
  radii,
  spacing,
  type as t,
} from "@/lib/theme";

const MAX_SECONDS = 300; // 5 min

// Enable metering on top of the HIGH_QUALITY preset so we can drive the live
// waveform from `recorderState.metering` (dBFS). The preset omits this flag.
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

// Number of bars in the live waveform. 16 keeps the code readable and the
// shared-value count modest while still giving a clear scrolling effect.
const WAVEFORM_BARS = 16;
const WAVEFORM_MIN_AMP = 0.06; // idle floor so the line never fully flattens

// Map dBFS (~ -160 silent, 0 max) to 0..1. The floor is -60 dB which is a
// reasonable "very quiet speech" threshold for phone mics.
function dbToAmplitude(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db)) return WAVEFORM_MIN_AMP;
  const norm = (db + 60) / 60;
  if (norm < WAVEFORM_MIN_AMP) return WAVEFORM_MIN_AMP;
  if (norm > 1) return 1;
  return norm;
}

type Step = "intro" | "question" | "countdown" | "record";

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function SessionRecord() {
  const router = useRouter();
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const [day, setDay] = useState<PlanDay | null>(null);
  const [_plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("intro");

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  // Sample metering at 100ms (default is 500ms) for a more reactive waveform.
  const recorderState = useAudioRecorderState(recorder, 100);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [pendingResult, setPendingResult] = useState<SessionResult | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  // Failsafe: if the component unmounts mid-upload, suppress further setState.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    function findInPlans(plans: Plan[]): { plan: Plan; day: PlanDay } | null {
      for (const candidate of plans) {
        const d = candidate.days.find((x) => x.id === dayId);
        if (d) return { plan: candidate, day: d };
      }
      return null;
    }

    function applyMatch(match: { plan: Plan; day: PlanDay }): boolean {
      if (match.day.completed_at) {
        router.replace(`/session/${match.day.id}/result`);
        return true;
      }
      if (match.day.day_date !== localTodayISO()) {
        router.replace(`/plan/${match.plan.id}`);
        return true;
      }
      setPlan(match.plan);
      setDay(match.day);
      setLoading(false);
      return true;
    }

    (async () => {
      try {
        const id = await getDeviceId();

        // Fast path: scan cached plans (the home screen pre-warms them).
        const cachedList = getCached<Plan[]>(cacheKeys.plans(id));
        if (cachedList) {
          const match = findInPlans(cachedList);
          if (match) {
            if (applyMatch(match)) return;
          }
        }

        const plans = await api.getPlans(id);
        if (plans.length === 0) {
          router.replace("/onboarding");
          return;
        }
        const match = findInPlans(plans);
        if (!match) {
          setError("Sessão não encontrada.");
          setLoading(false);
          return;
        }
        applyMatch(match);
      } catch (e) {
        setError((e as Error).message);
        setLoading(false);
      }
    })();
  }, [dayId, router]);

  useEffect(() => {
    (async () => {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      setHasPermission(granted);
      if (granted) {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Once a recording starts, lock the step to "record" no matter what.
  useEffect(() => {
    if (recorderState.isRecording && step !== "record") {
      setStep("record");
    }
  }, [recorderState.isRecording, step]);

  async function startRecording() {
    if (!hasPermission) {
      Alert.alert("Microfone", "Precisamos de permissão de microfone para gravar.");
      return;
    }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await recorder.prepareToRecordAsync();
      recorder.record();
      setElapsed(0);
      tickRef.current = setInterval(() => {
        setElapsed((e) => {
          if (e + 1 >= MAX_SECONDS) {
            void stopAndUpload();
            return MAX_SECONDS;
          }
          return e + 1;
        });
      }, 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function stopAndUpload() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (!day) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      await recorder.stop();
    } catch (e) {
      console.warn("stop failed", e);
    }
    const uri = recorder.uri;
    if (!uri) {
      setError("Gravação não foi guardada. Tenta de novo.");
      return;
    }
    setUploading(true);
    try {
      const id = await getDeviceId();
      const result = await api.submitSession({
        device_id: id,
        plan_day_id: day.id,
        audio_uri: uri,
      });
      if (cancelledRef.current) return;
      // Hold the result in state — the uploading screen will fill its progress
      // bar to 100%, reveal the transcript, and only navigate when the user
      // taps "VER FEEDBACK".
      setPendingResult(result);
    } catch (e) {
      if (cancelledRef.current) return;
      setError((e as Error).message);
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Animated.View
          entering={FadeIn.duration(220)}
          style={styles.center}
        >
          <LogoMark size="lg" />
        </Animated.View>
      </SafeAreaView>
    );
  }

  if (error || !day) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? "Sessão indisponível"}</Text>
          <DuoButton
            title="VOLTAR"
            variant="secondary"
            onPress={() => router.back()}
            fullWidth={false}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (uploading) {
    return (
      <UploadingScreen
        pendingResult={pendingResult}
        onContinue={() => {
          if (!pendingResult || !day) return;
          router.replace({
            pathname: `/session/${day.id}/result`,
            params: { result: JSON.stringify(pendingResult) },
          });
        }}
      />
    );
  }

  if (step === "intro") {
    return (
      <IntroStep
        day={day}
        onClose={() => router.back()}
        onContinue={() => setStep("question")}
      />
    );
  }

  if (step === "question") {
    return (
      <QuestionStep
        day={day}
        onBack={() => setStep("intro")}
        onReady={() => setStep("countdown")}
      />
    );
  }

  if (step === "countdown") {
    return (
      <CountdownStep
        onBack={() => setStep("question")}
        onDone={() => setStep("record")}
      />
    );
  }

  // step === "record" — blue full-bleed recording screen with live waveform.
  return (
    <RecordStep
      isRecording={recorderState.isRecording}
      metering={recorderState.metering}
      elapsed={elapsed}
      hasPermission={hasPermission}
      onClose={() => {
        if (recorderState.isRecording) {
          void stopAndUpload();
        } else {
          setStep("question");
        }
      }}
      onAutoStart={startRecording}
      onFinish={stopAndUpload}
    />
  );
}

// ---------------------------------------------------------------------------
// Uploading screen: optimistic celebration + animated loading bar.
// The bar is intentionally faster than the real backend: it sprints to ~60%
// in 1.5s, eases to ~92% over 8s, then crawls toward 99% — so the user feels
// "quase!" almost immediately and the transcript card fades in mid-animation
// (the server response usually arrives somewhere in the crawl phase). When
// pendingResult arrives we just push the bar to 100% in 400ms and the
// "VER FEEDBACK" CTA appears.
// ---------------------------------------------------------------------------

const UPLOADING_SUBTITLES = [
  "Gravaste a tua resposta. Já estamos a ouvir.",
  "Boa entrega! A processar...",
  "Excelente. Vamos analisar a tua resposta.",
  "Já está. Estamos a afinar o feedback para ti.",
] as const;

function UploadingScreen({
  pendingResult,
  onContinue,
}: {
  pendingResult: SessionResult | null;
  onContinue: () => void;
}) {
  // Pick a subtitle once per mount — no rotation while the user waits.
  const subtitle = useMemo(
    () =>
      UPLOADING_SUBTITLES[
        Math.floor(Math.random() * UPLOADING_SUBTITLES.length)
      ],
    [],
  );

  // Progress is a 0..1 shared value driving the bar's width. The two-phase
  // animation is implemented by chaining withTiming calls: first to 0.92 with
  // a long ease-out curve (~28s), then — once the result arrives — to 1.0 in
  // 400ms so the bar visibly "completes" before the CTA appears.
  const progress = useSharedValue(0);

  useEffect(() => {
    // Optimistic sprint → ease → crawl. Faster than the real backend so the
    // user gets the "almost there" feeling within seconds, and the transcript
    // card appears mid-animation rather than after the bar finishes.
    progress.value = withSequence(
      withTiming(0.6, { duration: 1500, easing: Easing.out(Easing.cubic) }),
      withTiming(0.92, { duration: 8000, easing: Easing.out(Easing.quad) }),
      withTiming(0.99, { duration: 30000, easing: Easing.linear }),
    );
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pendingResult) {
      progress.value = withTiming(1, {
        duration: 400,
        easing: Easing.out(Easing.cubic),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingResult]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const ready = pendingResult !== null;

  const footer = ready ? (
    <Animated.View entering={FadeInDown.duration(360)}>
      <DuoButton
        title="VER FEEDBACK"
        iconRight={ArrowRight}
        variant="primary"
        onPress={onContinue}
      />
    </Animated.View>
  ) : null;

  return (
    <Screen
      footer={footer}
      scroll={ready}
      contentStyle={ready ? undefined : { justifyContent: "center" }}
    >
      <Animated.View
        entering={FadeIn.duration(220)}
        style={uploadingStyles.headerBlock}
      >
        <Text style={uploadingStyles.celebration}>Boa!</Text>
        <Text style={uploadingStyles.subtitle}>{subtitle}</Text>
      </Animated.View>

      <View style={uploadingStyles.barBlock}>
        <View style={uploadingStyles.barTrack}>
          <Animated.View style={[uploadingStyles.barFill, barStyle]} />
        </View>
        <Text style={uploadingStyles.barCaption}>
          {ready ? "Pronto." : "A processar..."}
        </Text>
      </View>

      {ready && pendingResult ? (
        <Animated.View entering={FadeInDown.duration(360)}>
          <Card style={uploadingStyles.transcriptCard}>
            <Text style={uploadingStyles.transcriptCaption}>Transcrição</Text>
            <ScrollView
              style={uploadingStyles.transcriptScroll}
              showsVerticalScrollIndicator
            >
              <Text style={uploadingStyles.transcriptText}>
                {pendingResult.transcript}
              </Text>
            </ScrollView>
          </Card>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const uploadingStyles = StyleSheet.create({
  headerBlock: {
    paddingBottom: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  celebration: {
    fontFamily: fonts.black,
    fontSize: 64,
    lineHeight: 72,
    color: palette.primary[600],
    textAlign: "center",
  },
  subtitle: {
    ...t.body,
    color: palette.neutral[600],
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  barBlock: {
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  barTrack: {
    height: 14,
    width: "100%",
    backgroundColor: palette.primary[100],
    borderRadius: radii.pill,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    backgroundColor: palette.primary[500],
    borderRadius: radii.pill,
  },
  barCaption: {
    ...t.caption,
    color: palette.primary[600],
    textAlign: "center",
    marginTop: spacing.xs,
  },
  transcriptCard: {
    backgroundColor: palette.neutral[50],
    borderColor: palette.neutral[200],
    gap: spacing.md,
    marginTop: spacing.md,
  },
  transcriptCaption: {
    ...t.caption,
    color: palette.neutral[500],
  },
  // ~Half the screen for the scroll area. 320 is a comfortable cap that fits
  // even on smaller phones while leaving room for the celebration block and
  // the footer CTA.
  transcriptScroll: {
    maxHeight: 320,
  },
  transcriptText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: palette.neutral[700],
  },
});

// ---------------------------------------------------------------------------
// Step: record (blue, full-bleed, live waveform)
// ---------------------------------------------------------------------------

function RecordStep({
  isRecording,
  metering,
  elapsed,
  hasPermission,
  onClose,
  onAutoStart,
  onFinish,
}: {
  isRecording: boolean;
  metering: number | undefined;
  elapsed: number;
  hasPermission: boolean | null;
  onClose: () => void;
  onAutoStart: () => void;
  onFinish: () => void;
}) {
  const insets = useSafeAreaInsets();

  // Kick off recording exactly once when the step mounts — the countdown was
  // the "Go" signal, no extra tap required.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    onAutoStart();
    // onAutoStart is intentionally captured once; we don't want to re-trigger
    // recording if the callback identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[recordStyles.root, { paddingTop: insets.top }]}>
      <View style={recordStyles.topBar}>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityLabel="Fechar gravação"
        >
          <X size={28} color={palette.primary[100]} weight="bold" />
        </Pressable>
      </View>

      <View style={recordStyles.center}>
        <Text style={recordStyles.caption}>
          {isRecording ? "A gravar" : "A preparar…"}
        </Text>
        <Text style={recordStyles.timer}>
          {formatMmSs(elapsed)}
          <Text style={recordStyles.timerCap}>{`  /  ${formatMmSs(MAX_SECONDS)}`}</Text>
        </Text>

        <Waveform amplitude={dbToAmplitude(metering)} active={isRecording} />

        {hasPermission === false ? (
          <Text style={recordStyles.permWarn}>
            Sem permissão de microfone. Activa nas Definições do telemóvel.
          </Text>
        ) : null}
      </View>

      <View
        style={[
          recordStyles.footer,
          { paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        <DuoButton
          title="TERMINADO"
          iconRight={Check}
          variant="secondary"
          onPress={onFinish}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Live waveform: 16 vertical bars driven by a ring buffer of recent amplitudes.
// On each `amplitude` change we shift the buffer (drop oldest, push newest)
// and ease each bar's shared value toward its target with a short withTiming.
// ---------------------------------------------------------------------------

function Waveform({
  amplitude,
  active,
}: {
  amplitude: number;
  active: boolean;
}) {
  // 16 explicit shared values (one per bar). Reduced from 24 to keep the hook
  // surface tidy — the visual difference is negligible at this width and the
  // shorter list is much easier to read than a loop-of-hooks with disable
  // comments.
  const b0 = useSharedValue(WAVEFORM_MIN_AMP);
  const b1 = useSharedValue(WAVEFORM_MIN_AMP);
  const b2 = useSharedValue(WAVEFORM_MIN_AMP);
  const b3 = useSharedValue(WAVEFORM_MIN_AMP);
  const b4 = useSharedValue(WAVEFORM_MIN_AMP);
  const b5 = useSharedValue(WAVEFORM_MIN_AMP);
  const b6 = useSharedValue(WAVEFORM_MIN_AMP);
  const b7 = useSharedValue(WAVEFORM_MIN_AMP);
  const b8 = useSharedValue(WAVEFORM_MIN_AMP);
  const b9 = useSharedValue(WAVEFORM_MIN_AMP);
  const b10 = useSharedValue(WAVEFORM_MIN_AMP);
  const b11 = useSharedValue(WAVEFORM_MIN_AMP);
  const b12 = useSharedValue(WAVEFORM_MIN_AMP);
  const b13 = useSharedValue(WAVEFORM_MIN_AMP);
  const b14 = useSharedValue(WAVEFORM_MIN_AMP);
  const b15 = useSharedValue(WAVEFORM_MIN_AMP);
  const bars = [
    b0, b1, b2, b3, b4, b5, b6, b7,
    b8, b9, b10, b11, b12, b13, b14, b15,
  ];

  const bufferRef = useRef<number[]>(
    Array.from({ length: WAVEFORM_BARS }, () => WAVEFORM_MIN_AMP),
  );

  useEffect(() => {
    // Shift in the newest amplitude. When not recording, fall back to the idle
    // floor so the line settles instead of freezing on a loud value.
    const incoming = active ? amplitude : WAVEFORM_MIN_AMP;
    const next = [...bufferRef.current.slice(1), incoming];
    bufferRef.current = next;
    for (let i = 0; i < bars.length; i++) {
      bars[i].value = withTiming(next[i], {
        duration: 80,
        easing: Easing.out(Easing.quad),
      });
    }
    // `bars` is a fresh array on every render but its contents (shared values)
    // are stable; depending on it would re-run the effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amplitude, active]);

  return (
    <View style={recordStyles.waveform}>
      {bars.map((sv, i) => (
        <WaveBar key={i} sv={sv} />
      ))}
    </View>
  );
}

function WaveBar({
  sv,
}: {
  sv: ReturnType<typeof useSharedValue<number>>;
}) {
  const style = useAnimatedStyle(() => {
    const min = 6;
    const max = 96;
    return {
      height: min + sv.value * (max - min),
    };
  });
  return <Animated.View style={[recordStyles.waveBar, style]} />;
}

// ---------------------------------------------------------------------------
// Step: intro
// ---------------------------------------------------------------------------

function IntroStep({
  day,
  onClose,
  onContinue,
}: {
  day: PlanDay;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <Screen>
      <View style={styles.stepHeader}>
        <Pressable onPress={onClose} hitSlop={12}>
          <X size={28} color={palette.neutral[400]} weight="bold" />
        </Pressable>
      </View>

      <Animated.View
        key="intro"
        entering={FadeIn.duration(260)}
        style={styles.introBody}
      >
        <Animated.View entering={FadeInDown.duration(360).delay(60)}>
          <Pill
            label={`Dia ${day.day_index}`}
            variant="info"
            icon={Flame}
            iconWeight="fill"
          />
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.duration(380).delay(140)}
          style={styles.introTitle}
        >
          {day.theme}
        </Animated.Text>

        <Animated.Text
          entering={FadeInDown.duration(380).delay(220)}
          style={styles.introSubtitle}
        >
          Treino de hoje. Respira fundo, vamos lá.
        </Animated.Text>

        <Animated.View
          entering={FadeInDown.duration(380).delay(300)}
          style={styles.introCta}
        >
          <DuoButton
            title="CONTINUAR"
            iconRight={ArrowRight}
            variant="primary"
            onPress={onContinue}
          />
        </Animated.View>
      </Animated.View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Step: question
// ---------------------------------------------------------------------------

function QuestionStep({
  day,
  onBack,
  onReady,
}: {
  day: PlanDay;
  onBack: () => void;
  onReady: () => void;
}) {
  const footer = (
    <DuoButton
      title="PRONTO?"
      iconRight={ArrowRight}
      variant="primary"
      onPress={onReady}
    />
  );

  return (
    <Screen footer={footer}>
      <View style={styles.stepHeader}>
        <Pressable onPress={onBack} hitSlop={12}>
          <ArrowLeft size={26} color={palette.neutral[500]} weight="bold" />
        </Pressable>
      </View>

      <Animated.View
        key="question"
        entering={SlideInRight.duration(260)}
        style={styles.questionStepBody}
      >
        <Animated.Text
          entering={FadeIn.duration(280).delay(80)}
          style={styles.questionEyebrowBig}
        >
          {day.theme}
        </Animated.Text>

        <Animated.Text
          entering={FadeInDown.duration(420).delay(160)}
          style={styles.questionStepText}
        >
          {day.question}
        </Animated.Text>
      </Animated.View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Step: countdown
// ---------------------------------------------------------------------------

function CountdownStep({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Sequence: 3 -> 2 -> 1 -> VAI! -> onDone
  const [index, setIndex] = useState(0);
  const labels = ["3", "2", "1", "VAI!"] as const;

  useEffect(() => {
    // Haptic on each label change.
    if (index < labels.length - 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
    }

    const timer = setTimeout(() => {
      if (index < labels.length - 1) {
        setIndex((i) => i + 1);
      } else {
        onDone();
      }
    }, 1000);

    return () => clearTimeout(timer);
    // labels is a stable literal; intentionally only depend on index/onDone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, onDone]);

  const current = labels[index];
  const isGo = index === labels.length - 1;

  return (
    <View style={[styles.countdownRoot, { paddingTop: insets.top }]}>
      <View style={[styles.stepHeader, { paddingHorizontal: spacing.xl }]}>
        <Pressable onPress={onBack} hitSlop={12} disabled={isGo}>
          <ArrowLeft
            size={26}
            color={isGo ? palette.primary[200] : palette.primary[400]}
            weight="bold"
          />
        </Pressable>
      </View>

      <View style={styles.countdownCenter}>
        <Animated.Text
          key={current}
          entering={ZoomIn.duration(280)}
          exiting={FadeOut.duration(160)}
          style={[
            styles.countdownNumber,
            isGo && styles.countdownGo,
          ]}
        >
          {current}
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
  errorText: { ...t.body, color: colors.danger, textAlign: "center" },
  // Step header (close / back row, reused across intro/question/countdown).
  // Horizontal padding is provided by <Screen padded /> — don't double-pad.
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },

  // Intro step
  introBody: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.lg,
  },
  introTitle: {
    fontFamily: fonts.black,
    fontSize: 32,
    lineHeight: 38,
    color: colors.text,
  },
  introSubtitle: {
    ...t.bodyMuted,
    fontSize: 16,
    lineHeight: 22,
  },
  introCta: {
    marginTop: spacing.md,
  },

  // Question step
  questionStepBody: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.lg,
    paddingBottom: spacing.huge,
  },
  questionEyebrowBig: {
    ...t.caption,
    color: palette.primary[600],
    textAlign: "center",
  },
  questionStepText: {
    fontFamily: fonts.extrabold,
    fontSize: 26,
    lineHeight: 34,
    color: colors.text,
    textAlign: "center",
  },

  // Countdown step
  countdownRoot: {
    flex: 1,
    backgroundColor: palette.primary[50],
  },
  countdownCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  countdownNumber: {
    fontFamily: fonts.black,
    fontSize: 140,
    lineHeight: 160,
    color: palette.primary[600],
    textAlign: "center",
  },
  countdownGo: {
    color: palette.primary[700],
    fontSize: 96,
    lineHeight: 110,
    letterSpacing: 2,
  },
});

// Styles isolated to the record step so the legacy `styles` block stays clean.
const recordStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.primary[500],
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  caption: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.white,
  },
  timer: {
    fontFamily: fonts.black,
    fontSize: 56,
    lineHeight: 64,
    color: palette.white,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  timerCap: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 24,
    color: palette.primary[100],
    letterSpacing: 0.5,
  },
  waveform: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 120,
    width: "100%",
    marginTop: spacing.md,
  },
  waveBar: {
    width: 6,
    borderRadius: 3,
    backgroundColor: palette.white,
    opacity: 0.9,
  },
  permWarn: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.white,
    textAlign: "center",
    opacity: 0.9,
    marginTop: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
});
