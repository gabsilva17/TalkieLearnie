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
  ArrowClockwiseIcon as ArrowClockwise,
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
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "@/components/ui/Card";
import { DayCardStatus } from "@/components/ui/DayCard";
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
  const goBackOrHome = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/plans");
  };
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const [day, setDay] = useState<PlanDay | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("intro");

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  // Sample metering at 100ms (default is 500ms) for a more reactive waveform.
  const recorderState = useAudioRecorderState(recorder, 100);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [pendingResult, setPendingResult] = useState<SessionResult | null>(null);
  // Motivational sentence from Haiku, fetched in parallel with the upload so
  // the celebration flow can land on a personalized message without ever
  // looking like it's waiting on the network.
  const [pendingMotivation, setPendingMotivation] = useState<string | null>(null);
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
    setPendingMotivation(null);

    // Fire the motivation fetch in parallel with the session upload. Both
    // requests run independently; the celebration flow gates the transition
    // to the transcript phase on the session result and uses whatever
    // motivation text has arrived (or a fallback) when it gets there.
    if (plan) {
      const planId = plan.id;
      void (async () => {
        try {
          const id = await getDeviceId();
          const msg = await api.getMotivation({ device_id: id, plan_id: planId });
          if (cancelledRef.current) return;
          setPendingMotivation(msg);
        } catch {
          if (cancelledRef.current) return;
          setPendingMotivation("Estás um passo mais perto. Mais um treino feito.");
        }
      })();
    }

    try {
      const id = await getDeviceId();
      const result = await api.submitSession({
        device_id: id,
        plan_day_id: day.id,
        audio_uri: uri,
      });
      if (cancelledRef.current) return;
      // Hold the result in state — the celebration flow plays its scripted
      // choreography and only navigates to the result screen when the user
      // taps "VER FEEDBACK" on the transcript phase.
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
            onPress={() => goBackOrHome()}
            fullWidth={false}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (uploading && plan) {
    return (
      <CelebrationFlow
        plan={plan}
        day={day}
        pendingResult={pendingResult}
        motivation={pendingMotivation}
        onContinue={() => {
          if (!pendingResult) return;
          router.replace({
            pathname: `/session/${day.id}/result`,
            params: { result: JSON.stringify(pendingResult) },
          });
        }}
        onRetry={() => {
          // The just-submitted session row stays on the backend (it's the
          // simpler hackathon path), but the user re-records for the same
          // day and the next submitSession overwrites the cached value.
          // Reset everything so we can run the record → celebration loop
          // again from scratch.
          setPendingResult(null);
          setPendingMotivation(null);
          setUploading(false);
          setElapsed(0);
          setStep("question");
        }}
      />
    );
  }

  if (step === "intro") {
    return (
      <IntroStep
        day={day}
        onClose={() => goBackOrHome()}
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
// Celebration flow — a 4-act choreography that runs while the session upload
// + analysis pipeline does its thing in the background. The goal is to never
// look like "loading": each scene plays for a fixed window and the user only
// sees the transcript + "VER FEEDBACK" CTA once the result has actually
// arrived.
//
//   boa        ~2.1s  big "Boa!" with confetti + success haptic
//   rail       ~4.4s  mini day list with the just-finished day flipping
//                     from "current" (blue ring) to "done" (filled + check)
//   motivation  ≥2.4s personalized pt-PT sentence from Haiku, held with a
//                     subtle breathing pulse until pendingResult arrives
//   transcript  --    transcript card + CTA, mirrors the old final state
// ---------------------------------------------------------------------------

type CelebrationPhase = "boa" | "rail" | "motivation" | "transcript";

// Crossfade timing between scenes. Kept short and snappy (560ms) — what the
// user wants slower is the DWELL on each scene, not the wipe between them.
// Long crossfades looked sluggish; the actual pacing knob is the setTimeout
// values below.
const PHASE_FADE_MS = 560;

function CelebrationFlow({
  plan,
  day,
  pendingResult,
  motivation,
  onContinue,
  onRetry,
}: {
  plan: Plan;
  day: PlanDay;
  pendingResult: SessionResult | null;
  motivation: string | null;
  onContinue: () => void;
  onRetry: () => void;
}) {
  const [phase, setPhase] = useState<CelebrationPhase>("boa");
  // Track when the motivation phase started so we can enforce a minimum dwell
  // time before advancing — never less than ~2.4s, even if the upload has
  // already finished, so the message has time to land.
  const motivationStartRef = useRef<number | null>(null);

  // Dwell times per scene. Each scene needs enough air for the user to read
  // and feel the moment before the next one slides in. "Boa!" has to land,
  // the day rail has to play its current → done animation AND sit on the
  // result, and the motivational sentence has to be readable. Numbers tuned
  // toward "slow and confident", since the user explicitly wants the pacing
  // to feel relaxed rather than rushed.
  const BOA_DWELL_MS = 3600;
  const RAIL_DWELL_MS = 6500;
  const MOTIVATION_MIN_DWELL_MS = 3000;

  useEffect(() => {
    if (phase === "boa") {
      const t = setTimeout(() => setPhase("rail"), BOA_DWELL_MS);
      return () => clearTimeout(t);
    }
    if (phase === "rail") {
      const t = setTimeout(() => setPhase("motivation"), RAIL_DWELL_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase]);

  useEffect(() => {
    if (phase !== "motivation") return;
    motivationStartRef.current = Date.now();
  }, [phase]);

  useEffect(() => {
    if (phase !== "motivation" || !pendingResult) return;
    const startedAt = motivationStartRef.current ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, MOTIVATION_MIN_DWELL_MS - elapsed);
    const t = setTimeout(() => setPhase("transcript"), remaining);
    return () => clearTimeout(t);
  }, [phase, pendingResult]);

  // Each phase renders inside its own keyed Animated.View with absolute
  // positioning. When `phase` flips, React unmounts the old branch — but
  // Reanimated catches that and runs the exiting animation first, while the
  // new branch's entering animation runs in parallel. Result: a real
  // crossfade where both scenes are visible during the transition window,
  // instead of the instant swap we had before.
  return (
    <SafeAreaView style={styles.safe}>
      <View style={celebrationStyles.flex}>
        {phase === "boa" && (
          <Animated.View
            key="boa"
            entering={FadeIn.duration(PHASE_FADE_MS)}
            exiting={FadeOut.duration(PHASE_FADE_MS)}
            style={StyleSheet.absoluteFillObject}
          >
            <BoaPhase />
          </Animated.View>
        )}
        {phase === "rail" && (
          <Animated.View
            key="rail"
            entering={FadeIn.duration(PHASE_FADE_MS)}
            exiting={FadeOut.duration(PHASE_FADE_MS)}
            style={StyleSheet.absoluteFillObject}
          >
            <RailPhase plan={plan} dayId={day.id} />
          </Animated.View>
        )}
        {phase === "motivation" && (
          <Animated.View
            key="motivation"
            entering={FadeIn.duration(PHASE_FADE_MS)}
            exiting={FadeOut.duration(PHASE_FADE_MS)}
            style={StyleSheet.absoluteFillObject}
          >
            <MotivationPhase message={motivation} />
          </Animated.View>
        )}
        {phase === "transcript" && pendingResult && (
          <Animated.View
            key="transcript"
            entering={FadeIn.duration(PHASE_FADE_MS)}
            style={StyleSheet.absoluteFillObject}
          >
            <TranscriptPhase
              data={pendingResult}
              onContinue={onContinue}
              onRetry={onRetry}
            />
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

// --- Phase 1: "Boa!" ---------------------------------------------------------

function BoaPhase() {
  const scale = useSharedValue(0.4);
  const opacity = useSharedValue(0);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    opacity.value = withTiming(1, { duration: 440 });
    scale.value = withSpring(1, { mass: 0.9, damping: 9, stiffness: 150 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={celebrationStyles.phaseRoot}>
      <Confetti color={palette.primary[500]} />
      <Animated.Text style={[celebrationStyles.boa, aStyle]}>Boa!</Animated.Text>
      <Animated.Text
        entering={FadeInDown.duration(540).delay(500)}
        style={celebrationStyles.boaSubtitle}
      >
        Gravaste mais um treino.
      </Animated.Text>
    </View>
  );
}

// Lightweight confetti — 16 dots launched from screen center with random
// horizontal drift + gravity-style fall. Pure View animation, no extra deps.
// Same shape as the score-reveal confetti in result.tsx, scoped here so the
// celebration screen doesn't depend on result internals.

const CELEBRATION_CONFETTI_COUNT = 16;

function Confetti({ color }: { color: string }) {
  return (
    <View style={celebrationStyles.confettiLayer} pointerEvents="none">
      {Array.from({ length: CELEBRATION_CONFETTI_COUNT }).map((_, i) => (
        <ConfettiDot key={i} index={i} color={color} />
      ))}
    </View>
  );
}

function ConfettiDot({ index, color }: { index: number; color: string }) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const rot = useSharedValue(0);
  const op = useSharedValue(0);

  const seed = useMemo(() => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.78);
    const speed = 140 + Math.random() * 160;
    return {
      dx: Math.cos(angle) * speed,
      dyUp: Math.sin(angle) * speed,
      dyDown: 320 + Math.random() * 120,
      rot: Math.random() * 720 - 360,
      delay: index * 22,
      size: 6 + Math.random() * 4,
      tint: Math.random() < 0.55 ? color : palette.primary[300],
    };
  }, [index, color]);

  useEffect(() => {
    op.value = withDelay(
      seed.delay,
      withSequence(
        withTiming(1, { duration: 100 }),
        withTiming(1, { duration: 800 }),
        withTiming(0, { duration: 360 }),
      ),
    );
    tx.value = withDelay(
      seed.delay,
      withTiming(seed.dx, { duration: 1200, easing: Easing.out(Easing.quad) }),
    );
    ty.value = withDelay(
      seed.delay,
      withSequence(
        withTiming(seed.dyUp, { duration: 380, easing: Easing.out(Easing.quad) }),
        withTiming(seed.dyDown, { duration: 820, easing: Easing.in(Easing.quad) }),
      ),
    );
    rot.value = withDelay(
      seed.delay,
      withTiming(seed.rot, { duration: 1200, easing: Easing.out(Easing.cubic) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${rot.value}deg` },
    ],
    opacity: op.value,
  }));

  return (
    <Animated.View
      style={[
        celebrationStyles.confettiDot,
        { width: seed.size, height: seed.size * 1.6, backgroundColor: seed.tint },
        style,
      ]}
    />
  );
}

// --- Phase 2: day rail with current → done animation -------------------------

function RailPhase({ plan, dayId }: { plan: Plan; dayId: string }) {
  return (
    <View style={celebrationStyles.railRoot}>
      <Animated.Text
        entering={FadeInDown.duration(420).delay(80)}
        style={celebrationStyles.railEyebrow}
      >
        Plano
      </Animated.Text>
      <Animated.Text
        entering={FadeInDown.duration(480).delay(160)}
        style={celebrationStyles.railTitle}
      >
        Mais um dia feito.
      </Animated.Text>
      <View style={celebrationStyles.railList}>
        {plan.days.map((d, i) => {
          // Render the just-finished day as "current → done" (animated).
          // Other days reflect their real status. We treat the live day as
          // still-current visually until the animation flips it.
          const isHero = d.id === dayId;
          const status: DayCardStatus = isHero
            ? "current"
            : d.completed_at
              ? "done"
              : "locked";
          return (
            <Animated.View
              key={d.id}
              entering={FadeInDown.duration(380).delay(260 + i * 70)}
            >
              <RailRow
                index={d.day_index}
                title={d.theme}
                status={status}
                animateToDone={isHero}
              />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

function RailRow({
  index,
  title,
  status,
  animateToDone,
}: {
  index: number;
  title: string;
  status: DayCardStatus;
  animateToDone: boolean;
}) {
  const isDone = status === "done";
  const isCurrent = status === "current";
  const isLocked = status === "locked";

  // transition: 0 = current look (white circle, blue ring), 1 = done look
  // (filled blue + white check). Driven by interpolateColor on the indicator.
  const transition = useSharedValue(isDone ? 1 : 0);
  const bounce = useSharedValue(0);

  useEffect(() => {
    if (!animateToDone) return;
    // Hold on the "current" look briefly so the user reads "this was today's
    // day" before it ticks over.
    transition.value = withDelay(
      1500,
      withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) }),
    );
    bounce.value = withDelay(
      1800,
      withSequence(
        withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
        withTiming(0.42, { duration: 220, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) }),
      ),
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateToDone]);

  const bounceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -8 * bounce.value },
      { scale: 1 + 0.025 * bounce.value },
    ],
  }));

  const indicatorStyle = useAnimatedStyle(() => {
    const bg = interpolateColor(
      transition.value,
      [0, 1],
      [palette.white, palette.primary[500]],
    );
    return { backgroundColor: bg };
  });

  const checkStyle = useAnimatedStyle(() => ({
    opacity: transition.value,
    transform: [{ scale: 0.45 + 0.55 * transition.value }],
  }));

  return (
    <Animated.View style={bounceStyle}>
      <View
        style={[
          railStyles.card,
          isCurrent || animateToDone ? railStyles.cardCurrent : null,
          isLocked ? railStyles.cardLocked : null,
        ]}
      >
        {isLocked ? (
          <View style={[railStyles.indicator, railStyles.indicatorLocked]} />
        ) : isDone ? (
          <View style={[railStyles.indicator, railStyles.indicatorDone]}>
            <Check size={18} color={palette.white} weight="bold" />
          </View>
        ) : (
          <Animated.View
            style={[
              railStyles.indicator,
              railStyles.indicatorCurrent,
              indicatorStyle,
            ]}
          >
            <Animated.View style={checkStyle}>
              <Check size={18} color={palette.white} weight="bold" />
            </Animated.View>
          </Animated.View>
        )}
        <View style={railStyles.content}>
          <Text
            style={[
              railStyles.eyebrow,
              isCurrent || animateToDone ? railStyles.eyebrowCurrent : null,
              isLocked ? railStyles.eyebrowLocked : null,
            ]}
          >{`Dia ${index}`}</Text>
          <Text
            style={[railStyles.title, isLocked ? railStyles.titleLocked : null]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

// --- Phase 3: motivational message -----------------------------------------

function MotivationPhase({ message }: { message: string | null }) {
  // Breathing pulse: very subtle scale loop. Communicates "alive" without
  // resorting to a spinner if the upload is still in flight.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.025, {
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
        }),
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  // Wait for the model's response before showing the full sentence — if it's
  // not in yet, the fallback is already short and complete, so we still show
  // SOMETHING rather than blank space.
  const text = message ?? "Estás um passo mais perto.";

  return (
    <View style={celebrationStyles.motivationRoot}>
      <Animated.Text
        entering={FadeInDown.duration(540).delay(120)}
        style={celebrationStyles.motivationEyebrow}
      >
        Para ti
      </Animated.Text>
      <Animated.Text
        entering={FadeInDown.duration(720).delay(280)}
        style={[celebrationStyles.motivationText, pulseStyle]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

// --- Phase 4: transcript + CTA ---------------------------------------------
// Centered layout: eyebrow + title + transcript card + two stacked buttons,
// all vertically and horizontally centered. Replaces the previous Screen
// `footer` pattern because the user explicitly wanted the CTAs to live with
// the rest of the content instead of pinned to the bottom edge.

function TranscriptPhase({
  data,
  onContinue,
  onRetry,
}: {
  data: SessionResult;
  onContinue: () => void;
  onRetry: () => void;
}) {
  return (
    <View style={transcriptStyles.root}>
      <Animated.View
        entering={FadeIn.duration(620)}
        style={transcriptStyles.headerBlock}
      >
        <Text style={transcriptStyles.eyebrow}>A tua resposta</Text>
        <Text style={transcriptStyles.title}>Pronto para o feedback?</Text>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.duration(680).delay(180)}
        style={transcriptStyles.cardBlock}
      >
        <Card style={transcriptStyles.card}>
          <Text style={transcriptStyles.caption}>Transcrição</Text>
          <ScrollView
            style={transcriptStyles.scroll}
            showsVerticalScrollIndicator
          >
            <Text style={transcriptStyles.text}>{data.transcript}</Text>
          </ScrollView>
        </Card>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.duration(680).delay(340)}
        style={transcriptStyles.actions}
      >
        <DuoButton
          title="VER FEEDBACK"
          iconRight={ArrowRight}
          variant="primary"
          onPress={onContinue}
        />
        <DuoButton
          title="REPETIR"
          iconRight={ArrowClockwise}
          variant="secondary"
          onPress={onRetry}
        />
      </Animated.View>
    </View>
  );
}

const celebrationStyles = StyleSheet.create({
  flex: { flex: 1 },
  phaseRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  boa: {
    fontFamily: fonts.black,
    fontSize: 104,
    lineHeight: 112,
    color: palette.primary[600],
    textAlign: "center",
  },
  boaSubtitle: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    lineHeight: 26,
    color: palette.neutral[500],
    textAlign: "center",
    marginTop: spacing.lg,
  },
  confettiLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  confettiDot: {
    position: "absolute",
    borderRadius: 2,
  },
  railRoot: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    justifyContent: "center",
  },
  railEyebrow: {
    ...t.eyebrow,
    textAlign: "left",
  },
  railTitle: {
    fontFamily: fonts.black,
    fontSize: 32,
    lineHeight: 38,
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  railList: {
    gap: spacing.md,
  },
  motivationRoot: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  motivationEyebrow: {
    ...t.eyebrow,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  motivationText: {
    fontFamily: fonts.black,
    fontSize: 28,
    lineHeight: 38,
    color: colors.text,
    textAlign: "center",
  },
});

const transcriptStyles = StyleSheet.create({
  // Vertical+horizontal center. The phase wrapper above is absoluteFillObject
  // inside the celebration SafeAreaView, so this View owns the layout.
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  headerBlock: {
    alignItems: "center",
    gap: spacing.xs,
  },
  eyebrow: {
    ...t.eyebrow,
    textAlign: "center",
  },
  title: {
    fontFamily: fonts.black,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
    textAlign: "center",
  },
  cardBlock: {
    width: "100%",
  },
  card: {
    backgroundColor: palette.neutral[50],
    borderColor: palette.neutral[200],
    gap: spacing.md,
  },
  caption: {
    ...t.caption,
    color: palette.neutral[500],
    textAlign: "center",
  },
  scroll: {
    // Capped so the transcript card doesn't push the buttons off-screen on
    // short devices. Long takes scroll inside the card.
    maxHeight: 240,
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: palette.neutral[700],
    textAlign: "center",
  },
  actions: {
    width: "100%",
    gap: spacing.sm,
  },
});

const RAIL_INDICATOR_SIZE = 28;

const railStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.neutral[200],
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  cardCurrent: {
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[500],
    borderWidth: 2,
  },
  cardLocked: {
    opacity: 0.7,
  },
  indicator: {
    width: RAIL_INDICATOR_SIZE,
    height: RAIL_INDICATOR_SIZE,
    borderRadius: RAIL_INDICATOR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.white,
    borderWidth: 2,
    borderColor: palette.neutral[300],
  },
  indicatorCurrent: {
    backgroundColor: palette.white,
    borderColor: palette.primary[500],
  },
  indicatorDone: {
    backgroundColor: palette.primary[500],
    borderColor: palette.primary[500],
  },
  indicatorLocked: {
    backgroundColor: palette.neutral[100],
    borderColor: palette.neutral[300],
  },
  content: {
    flex: 1,
    justifyContent: "center",
  },
  eyebrow: {
    ...t.eyebrow,
    marginBottom: 4,
  },
  eyebrowCurrent: {
    color: palette.primary[600],
  },
  eyebrowLocked: {
    color: palette.neutral[400],
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 22,
    color: colors.text,
  },
  titleLocked: {
    color: palette.neutral[400],
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
