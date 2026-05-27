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
  CircleNotchIcon as CircleNotch,
  FlameIcon as Flame,
  HeartIcon as Heart,
  MicrophoneSlashIcon as MicrophoneSlash,
  XIcon as X,
} from "phosphor-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
import { Plan, PlanDay, SessionResult, api } from "@/lib/api";
import { localTodayISO } from "@/lib/dayDate";
import { getDeviceId } from "@/lib/deviceId";
import { useT } from "@/lib/i18n";
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
  const { t: tr } = useT();
  const goBackOrHome = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/plans");
  };
  const { dayId, retry } = useLocalSearchParams<{
    dayId: string;
    retry?: string;
  }>();
  const isRetry = retry === "1";
  const [day, setDay] = useState<PlanDay | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // In retry mode we surface the prior session's main improvement tip on the
  // intro screen so the user records with a clear focus. Null until the
  // previous session is fetched (or if there isn't one for some reason).
  const [focusTip, setFocusTip] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("intro");

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  // Sample metering at 100ms (default is 500ms) for a more reactive waveform.
  const recorderState = useAudioRecorderState(recorder, 100);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  // When the backend rejects the recording (422: too short or empty
  // transcript) we park the pt-PT explanation here and render TooShortStep
  // instead of bouncing through the generic error block.
  const [tooShort, setTooShort] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<SessionResult | null>(null);
  // Motivational sentence from Haiku, fetched in parallel with the upload so
  // the celebration flow can land on a personalized message without ever
  // looking like it's waiting on the network.
  const [pendingMotivation, setPendingMotivation] = useState<string | null>(null);
  // Reanalysis is fired when the user edits the transcript and taps VER
  // FEEDBACK. The thanks phase waits for `reanalyzeReady === true` before it
  // advances, so the user always sees feedback that matches what they wrote.
  // On failure we set `reanalyzeReady` anyway and keep the original result.
  const [reanalyzeReady, setReanalyzeReady] = useState(false);
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
      // Retry mode lets the user re-record a day they already completed
      // *today*. The day_date guard still applies (you can't retry past
      // days), but completed_at is no longer a redirect to the result.
      if (!isRetry && match.day.completed_at) {
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
        const plans = await api.getPlans(id);
        if (plans.length === 0) {
          router.replace("/onboarding");
          return;
        }
        const match = findInPlans(plans);
        if (!match) {
          setError(tr("session.not_found"));
          setLoading(false);
          return;
        }
        applyMatch(match);
        if (isRetry) {
          // Load the previous attempt's feedback to surface a focus tip on
          // the intro screen. Best-effort: if the fetch fails, the intro
          // just renders without the tip.
          try {
            const prev = await api.getSessionForDay(match.day.id);
            const fb = prev?.feedback;
            const tip =
              (fb?.suggestions?.[0] || fb?.weaknesses?.[0] || "").trim();
            if (tip) setFocusTip(tip);
          } catch {
            // ignored
          }
        }
      } catch (e) {
        setError((e as Error).message);
        setLoading(false);
      }
    })();
  }, [dayId, isRetry, router]);

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
      Alert.alert(
        tr("session.mic_permission_title"),
        tr("session.mic_permission_body"),
      );
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
      setError(tr("session.save_failed"));
      return;
    }

    // Fast-fail too-short recordings locally — same 5s threshold the backend
    // uses (MIN_SESSION_DURATION_S). Catches the obvious case (user taps
    // TERMINADO after a handful of seconds) without an upload round-trip, so
    // the celebration choreography never starts on something we know is going
    // to be rejected. Backend 422 stays as a safety net for the rare edge
    // case where elapsed >= 5 but Whisper returns an empty transcript.
    if (elapsed < 5) {
      setTooShort(tr("session.too_short_local"));
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
      const planLang = plan.language;
      void (async () => {
        try {
          const id = await getDeviceId();
          const msg = await api.getMotivation({
            device_id: id,
            plan_id: planId,
            lang: planLang,
          });
          if (cancelledRef.current) return;
          setPendingMotivation(msg);
        } catch {
          if (cancelledRef.current) return;
          setPendingMotivation(tr("session.motivation_fetch_fallback"));
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
      const err = e as Error & { tooShort?: boolean };
      if (err.tooShort) {
        setTooShort(err.message);
      } else {
        setError(err.message);
      }
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
          <Text style={styles.errorText}>{error ?? tr("session.unavailable")}</Text>
          <DuoButton
            title={tr("common.back_caps")}
            variant="secondary"
            onPress={() => goBackOrHome()}
            fullWidth={false}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (tooShort) {
    return (
      <TooShortStep
        message={tooShort}
        onRetry={() => {
          setTooShort(null);
          setPendingResult(null);
          setPendingMotivation(null);
          setReanalyzeReady(false);
          setElapsed(0);
          setStep("question");
        }}
        onClose={() => goBackOrHome()}
      />
    );
  }

  if (uploading && plan) {
    return (
      <CelebrationFlow
        plan={plan}
        day={day}
        pendingResult={pendingResult}
        motivation={pendingMotivation}
        reanalyzeReady={reanalyzeReady}
        onEdited={(editedTranscript) => {
          // User actually changed the transcript before tapping VER FEEDBACK.
          // Kick off a real reanalysis: backend re-runs Sonnet (and the text
          // metrics) against the corrected text, while the thanks phase plays
          // its animation. The thanks-phase gate (`reanalyzeReady`) is what
          // releases the navigation once the new feedback is in hand.
          if (!pendingResult) return;
          setReanalyzeReady(false);
          void (async () => {
            try {
              const id = await getDeviceId();
              const updated = await api.reanalyzeSession({
                device_id: id,
                session_id: pendingResult.id,
                transcript: editedTranscript,
              });
              if (cancelledRef.current) return;
              setPendingResult(updated);
            } catch (e) {
              console.warn("reanalyze failed", e);
            } finally {
              if (!cancelledRef.current) setReanalyzeReady(true);
            }
          })();
        }}
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
          setReanalyzeReady(false);
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
        focusTip={isRetry ? focusTip : null}
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
        // X on the record screen cancels the take instead of submitting it:
        // stop the recorder if it's running (no upload, no Whisper call) and
        // bounce back to the plan. Tapping X mid-recording was uploading by
        // accident before. There's no "submit" semantics on this control.
        if (tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
        if (recorderState.isRecording) {
          recorder.stop().catch((e) => console.warn("stop failed", e));
        }
        goBackOrHome();
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
// We never want a misleading "Boa!" on a recording that's going to be
// rejected, so duration checks happen up-front: the parent `stopAndUpload`
// short-circuits locally when `elapsed < 5` (the same threshold the backend
// uses) and renders `TooShortStep` instead of mounting this flow at all.
// The backend 422 stays as a safety net for the rare empty-transcript edge
// case (5s+ of silence / unintelligible noise) — if that fires mid-Boa,
// the parent still swaps in TooShortStep.
//
//   boa        ~2.1s  big "Boa!" with confetti + success haptic
//   rail       ~4.4s  mini day list with the just-finished day flipping
//                     from "current" (blue ring) to "done" (filled + check)
//   motivation  ≥2.4s personalized pt-PT sentence from Haiku, held with a
//                     subtle breathing pulse until pendingResult arrives
//   transcript  --    transcript card + CTA, mirrors the old final state
// ---------------------------------------------------------------------------

type CelebrationPhase =
  | "boa"
  | "rail"
  | "motivation"
  | "transcript"
  | "thanks"
  | "reformulating";

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
  reanalyzeReady,
  onEdited,
  onContinue,
  onRetry,
}: {
  plan: Plan;
  day: PlanDay;
  pendingResult: SessionResult | null;
  motivation: string | null;
  reanalyzeReady: boolean;
  onEdited: (editedTranscript: string) => void;
  onContinue: () => void;
  onRetry: () => void;
}) {
  const [phase, setPhase] = useState<CelebrationPhase>("boa");
  // Track when the motivation phase started so we can enforce a minimum dwell
  // time before advancing — never less than ~2.4s, even if the upload has
  // already finished, so the message has time to land.
  const motivationStartRef = useRef<number | null>(null);
  // Same pattern for reformulating: hold a minimum dwell so the loading copy
  // doesn't flash past if Sonnet returns fast, then wait for reanalyzeReady
  // before navigating.
  const reformulatingStartRef = useRef<number | null>(null);

  // Dwell times per scene. Each scene needs enough air for the user to read
  // and feel the moment before the next one slides in. "Boa!" has to land,
  // the day rail has to play its current → done animation AND sit on the
  // result, and the motivational sentence has to be readable. Numbers tuned
  // toward "slow and confident", since the user explicitly wants the pacing
  // to feel relaxed rather than rushed.
  const BOA_DWELL_MS = 3600;
  const RAIL_DWELL_MS = 6500;
  const MOTIVATION_MIN_DWELL_MS = 3000;
  // Thanks is a fixed beat: thank the user for the correction, then hand off
  // to the reformulating loader. No gate here — the network gate lives on
  // the reformulating scene that follows.
  const THANKS_DWELL_MS = 2500;
  // Minimum air for the "a reformular o feedback" loader. Sonnet re-analysis
  // often comes back faster than this; we don't want it to flicker past.
  const REFORMULATING_MIN_DWELL_MS = 1800;

  // onContinue is recreated on every parent render — read it through a ref so
  // the reformulating timer doesn't restart on unrelated re-renders.
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  useEffect(() => {
    if (phase === "boa") {
      const t = setTimeout(() => setPhase("rail"), BOA_DWELL_MS);
      return () => clearTimeout(t);
    }
    if (phase === "rail") {
      const t = setTimeout(() => setPhase("motivation"), RAIL_DWELL_MS);
      return () => clearTimeout(t);
    }
    if (phase === "thanks") {
      const t = setTimeout(
        () => setPhase("reformulating"),
        THANKS_DWELL_MS,
      );
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

  // Reformulating gate: enter after the thanks beat, wait for BOTH the min
  // dwell AND reanalyzeReady before navigating to /result. If Sonnet takes
  // a while, the dwell is already satisfied and we just wait on the network;
  // if it's instant, we still hold the loader until the min dwell so the
  // user actually reads the "a reformular" copy.
  useEffect(() => {
    if (phase !== "reformulating") return;
    reformulatingStartRef.current = Date.now();
  }, [phase]);

  useEffect(() => {
    if (phase !== "reformulating" || !reanalyzeReady) return;
    const startedAt = reformulatingStartRef.current ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, REFORMULATING_MIN_DWELL_MS - elapsed);
    const t = setTimeout(() => onContinueRef.current(), remaining);
    return () => clearTimeout(t);
  }, [phase, reanalyzeReady]);

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
            exiting={FadeOut.duration(PHASE_FADE_MS)}
            style={StyleSheet.absoluteFillObject}
          >
            <TranscriptPhase
              data={pendingResult}
              onContinue={(wasEdited, editedTranscript) => {
                if (wasEdited) {
                  onEdited(editedTranscript);
                  setPhase("thanks");
                } else {
                  onContinue();
                }
              }}
              onRetry={onRetry}
            />
          </Animated.View>
        )}
        {phase === "thanks" && (
          <Animated.View
            key="thanks"
            entering={FadeIn.duration(PHASE_FADE_MS)}
            exiting={FadeOut.duration(PHASE_FADE_MS)}
            style={StyleSheet.absoluteFillObject}
          >
            <ThanksPhase />
          </Animated.View>
        )}
        {phase === "reformulating" && (
          <Animated.View
            key="reformulating"
            entering={FadeIn.duration(PHASE_FADE_MS)}
            style={StyleSheet.absoluteFillObject}
          >
            <ReformulatingPhase />
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

// --- Phase 1: "Boa!" ---------------------------------------------------------

function BoaPhase() {
  const { t: tr } = useT();
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
      <Animated.Text style={[celebrationStyles.boa, aStyle]}>
        {tr("session.boa_title")}
      </Animated.Text>
      <Animated.Text
        entering={FadeInDown.duration(540).delay(500)}
        style={celebrationStyles.boaSubtitle}
      >
        {tr("session.boa_subtitle")}
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
  const { t: tr } = useT();
  return (
    <View style={celebrationStyles.railRoot}>
      <Animated.Text
        entering={FadeInDown.duration(420).delay(80)}
        style={celebrationStyles.railEyebrow}
      >
        {tr("session.rail_eyebrow")}
      </Animated.Text>
      <Animated.Text
        entering={FadeInDown.duration(480).delay(160)}
        style={celebrationStyles.railTitle}
      >
        {tr("session.rail_title")}
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
  const { t: tr } = useT();
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
          >{tr("session.rail_day", { index })}</Text>
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
  const { t: tr } = useT();
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
  const text = message ?? tr("session.motivation_fallback");

  return (
    <View style={celebrationStyles.motivationRoot}>
      <Animated.Text
        entering={FadeInDown.duration(540).delay(120)}
        style={celebrationStyles.motivationEyebrow}
      >
        {tr("session.motivation_eyebrow")}
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
  onContinue: (wasEdited: boolean, editedTranscript: string) => void;
  onRetry: () => void;
}) {
  const { t: tr } = useT();
  // The transcript card is now an editable surface. When the user touches up
  // a Whisper mistake we route them through the thank-you phase before the
  // result while the backend re-runs Sonnet against the corrected text.
  const original = data.transcript;
  const [text, setText] = useState(original);
  const trimmed = text.trim();
  const wasEdited = trimmed.length > 0 && trimmed !== original.trim();

  return (
    <KeyboardAvoidingView
      style={transcriptStyles.kav}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={transcriptStyles.root}>
        <Animated.View
          entering={FadeIn.duration(620)}
          style={transcriptStyles.headerBlock}
        >
          <Text style={transcriptStyles.eyebrow}>{tr("session.transcript_eyebrow")}</Text>
          <Text style={transcriptStyles.title}>{tr("session.transcript_title")}</Text>
          <Text style={transcriptStyles.hint}>{tr("session.transcript_hint")}</Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(680).delay(180)}
          style={transcriptStyles.cardBlock}
        >
          <Card style={transcriptStyles.card}>
            <Text style={transcriptStyles.caption}>{tr("session.transcript_caption")}</Text>
            <TextInput
              style={transcriptStyles.input}
              value={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
              scrollEnabled
              selectionColor={palette.primary[500]}
              placeholder=""
              accessibilityLabel={tr("session.transcript_a11y")}
            />
          </Card>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(680).delay(340)}
          style={transcriptStyles.actions}
        >
          <DuoButton
            title={tr("session.cta_see_feedback_caps")}
            iconRight={ArrowRight}
            variant="primary"
            onPress={() => onContinue(wasEdited, trimmed)}
          />
          <DuoButton
            title={tr("session.cta_repeat_caps")}
            iconRight={ArrowClockwise}
            variant="secondary"
            onPress={onRetry}
          />
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

// --- Phase 5: thanks for the correction ------------------------------------
// Only mounts when the user actually changed the transcript text. Plays for
// a fixed window (THANKS_DWELL_MS) and then the CelebrationFlow advances to
// the result screen on the user's behalf.

function ThanksPhase() {
  const { t: tr } = useT();
  const scale = useSharedValue(0.4);
  const opacity = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    opacity.value = withTiming(1, { duration: 440 });
    scale.value = withSpring(1, { mass: 0.9, damping: 9, stiffness: 150 });
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iconStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value * pulse.value }],
  }));

  return (
    <View style={celebrationStyles.phaseRoot}>
      <Animated.View style={iconStyle}>
        <Heart size={92} color={palette.primary[500]} weight="fill" />
      </Animated.View>
      <Animated.Text
        entering={FadeInDown.duration(540).delay(180)}
        style={celebrationStyles.thanksTitle}
      >
        {tr("session.thanks_title")}
      </Animated.Text>
      <Animated.Text
        entering={FadeInDown.duration(540).delay(320)}
        style={celebrationStyles.thanksBody}
      >
        {tr("session.thanks_body")}
      </Animated.Text>
    </View>
  );
}

// --- Phase 6: reformulating the feedback -----------------------------------
// Holds the screen while POST /sessions/{id}/reanalyze is in flight. Spinner
// + "A reformular o feedback inicial..." copy. The CelebrationFlow gate
// waits for both the min dwell AND `reanalyzeReady` before advancing.

function ReformulatingPhase() {
  const { t: tr } = useT();
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1100, easing: Easing.linear }),
      -1,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={celebrationStyles.phaseRoot}>
      <Animated.View style={spinnerStyle}>
        <CircleNotch size={64} color={palette.primary[500]} weight="bold" />
      </Animated.View>
      <Animated.Text
        entering={FadeInDown.duration(540).delay(120)}
        style={celebrationStyles.reformulatingTitle}
      >
        {tr("session.reformulating_title")}
      </Animated.Text>
      <Animated.Text
        entering={FadeInDown.duration(540).delay(260)}
        style={celebrationStyles.reformulatingBody}
      >
        {tr("session.reformulating_body")}
      </Animated.Text>
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
  thanksTitle: {
    fontFamily: fonts.black,
    fontSize: 28,
    lineHeight: 36,
    color: colors.text,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  thanksBody: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 24,
    color: palette.neutral[600],
    textAlign: "center",
    marginTop: spacing.md,
    maxWidth: 320,
  },
  reformulatingTitle: {
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 34,
    color: colors.text,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  reformulatingBody: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: palette.neutral[500],
    textAlign: "center",
    marginTop: spacing.sm,
    maxWidth: 300,
  },
});

const transcriptStyles = StyleSheet.create({
  // KeyboardAvoidingView wrapper so the editable TextInput stays visible when
  // the on-screen keyboard pops up.
  kav: {
    flex: 1,
  },
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
  hint: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.neutral[500],
    textAlign: "center",
    marginTop: spacing.xs,
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
  input: {
    // Same look as the previous read-only transcript text, just editable.
    // Capped height + internal scroll keeps long takes from pushing the
    // buttons off-screen on short devices.
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: palette.neutral[700],
    textAlign: "center",
    maxHeight: 240,
    padding: 0,
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
  const { t: tr } = useT();
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

  // The countdown's root has already washed to primary[500] by the time we
  // mount, so the root colour cut is invisible. We just need the foreground
  // (X, caption, timer, waveform, button) to ease in instead of popping.
  return (
    <View style={[recordStyles.root, { paddingTop: insets.top }]}>
      <Animated.View
        entering={FadeIn.duration(360).delay(80)}
        style={recordStyles.topBar}
      >
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityLabel={tr("session.record_close_a11y")}
        >
          <X size={28} color={palette.primary[100]} weight="bold" />
        </Pressable>
      </Animated.View>

      <Animated.View
        entering={FadeIn.duration(520).delay(140)}
        style={recordStyles.center}
      >
        <Text style={recordStyles.caption}>
          {isRecording ? tr("session.record_recording") : tr("session.record_preparing")}
        </Text>
        <Text style={recordStyles.timer}>
          {formatMmSs(elapsed)}
          <Text style={recordStyles.timerCap}>{`  /  ${formatMmSs(MAX_SECONDS)}`}</Text>
        </Text>

        <Waveform amplitude={dbToAmplitude(metering)} active={isRecording} />

        {hasPermission === false ? (
          <Text style={recordStyles.permWarn}>
            {tr("session.record_perm_warning")}
          </Text>
        ) : null}
      </Animated.View>

      <Animated.View
        entering={FadeIn.duration(360).delay(260)}
        style={[
          recordStyles.footer,
          { paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        <DuoButton
          title={tr("session.cta_finished_caps")}
          iconRight={Check}
          variant="secondary"
          onPress={onFinish}
        />
      </Animated.View>
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
// Step: too short / empty transcript
// Renders when the backend returns 422 on submit (recording <5s or Whisper
// returned no text). The pt-PT message comes from the server so the reason is
// explicit. Tapping REPETIR drops the user back at the question step so they
// can run the whole record loop again with the existing day.
// ---------------------------------------------------------------------------

function TooShortStep({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t: tr } = useT();
  const footer = (
    <DuoButton
      title={tr("session.cta_repeat_caps")}
      iconRight={ArrowClockwise}
      variant="primary"
      onPress={onRetry}
    />
  );

  return (
    <Screen footer={footer}>
      <View style={styles.stepHeader}>
        <Pressable onPress={onClose} hitSlop={12}>
          <X size={28} color={palette.neutral[400]} weight="bold" />
        </Pressable>
      </View>

      <Animated.View
        key="too-short"
        entering={FadeIn.duration(260)}
        style={styles.tooShortBody}
      >
        <Animated.View entering={FadeInDown.duration(380).delay(60)}>
          <MicrophoneSlash
            size={72}
            color={palette.primary[500]}
            weight="duotone"
          />
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.duration(380).delay(140)}
          style={styles.tooShortTitle}
        >
          {tr("session.too_short_title")}
        </Animated.Text>

        <Animated.Text
          entering={FadeInDown.duration(380).delay(220)}
          style={styles.tooShortMessage}
        >
          {message}
        </Animated.Text>
      </Animated.View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Step: intro
// ---------------------------------------------------------------------------

function IntroStep({
  day,
  focusTip,
  onClose,
  onContinue,
}: {
  day: PlanDay;
  focusTip: string | null;
  onClose: () => void;
  onContinue: () => void;
}) {
  const { t: tr } = useT();
  const isRetry = focusTip !== null;
  return (
    <Screen bg={palette.primary[500]}>
      <View style={styles.stepHeader}>
        <Pressable onPress={onClose} hitSlop={12}>
          <X size={28} color={palette.primary[100]} weight="bold" />
        </Pressable>
      </View>

      <Animated.View
        key="intro"
        entering={FadeIn.duration(260)}
        style={styles.introBody}
      >
        <Animated.View entering={FadeInDown.duration(360).delay(60)}>
          <Pill
            label={
              isRetry
                ? tr("session.intro_pill_retry")
                : tr("session.intro_pill_day", { index: day.day_index })
            }
            variant="info"
            icon={isRetry ? ArrowClockwise : Flame}
            iconWeight="fill"
          />
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.duration(380).delay(140)}
          style={styles.introTitleOnBlue}
        >
          {day.theme}
        </Animated.Text>

        <Animated.Text
          entering={FadeInDown.duration(380).delay(220)}
          style={styles.introSubtitleOnBlue}
        >
          {isRetry
            ? tr("session.intro_subtitle_retry")
            : tr("session.intro_subtitle_today")}
        </Animated.Text>

        {focusTip ? (
          <Animated.View
            entering={FadeInDown.duration(420).delay(280)}
            style={styles.focusTipWrap}
          >
            <Card style={styles.focusTipCardOnBlue}>
              <Text style={styles.focusTipEyebrow}>
                {tr("session.focus_tip_eyebrow")}
              </Text>
              <Text style={styles.focusTipText}>{focusTip}</Text>
            </Card>
          </Animated.View>
        ) : null}

        <Animated.View
          entering={FadeInDown.duration(380).delay(focusTip ? 360 : 300)}
          style={styles.introCta}
        >
          <DuoButton
            title={tr("common.continue_caps")}
            iconRight={ArrowRight}
            variant="secondary"
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
  const { t: tr } = useT();
  const footer = (
    <DuoButton
      title={tr("session.cta_ready_caps")}
      iconRight={ArrowRight}
      variant="primary"
      onPress={onReady}
    />
  );

  return (
    <Screen footer={footer} scroll>
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

  // Bleeds the background from primary[50] (idle countdown) to primary[500]
  // (record screen) during the VAI! beat. The next step's root is also
  // primary[500], so by the time it mounts the colour already matches and
  // there's no visible cut. 0 = light, 1 = deep blue.
  const blueFill = useSharedValue(0);

  useEffect(() => {
    // Haptic on each label change.
    if (index < labels.length - 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      // Start the blue wash exactly as VAI! lands. Easing.out so it rushes
      // into deep blue early and then settles, instead of a linear ramp.
      blueFill.value = withTiming(1, {
        duration: 620,
        easing: Easing.out(Easing.cubic),
      });
    }

    // Hold VAI! a touch longer than the digits so the wash has time to fully
    // land before RecordStep takes over.
    const dwell = index === labels.length - 1 ? 1100 : 900;
    const timer = setTimeout(() => {
      if (index < labels.length - 1) {
        setIndex((i) => i + 1);
      } else {
        onDone();
      }
    }, dwell);

    return () => clearTimeout(timer);
    // labels is a stable literal; intentionally only depend on index/onDone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, onDone]);

  const current = labels[index];
  const isGo = index === labels.length - 1;

  const rootAStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      blueFill.value,
      [0, 1],
      [palette.primary[50], palette.primary[500]],
    ),
  }));

  const backArrowAStyle = useAnimatedStyle(() => ({
    opacity: 1 - blueFill.value,
  }));

  // The VAI! glyph rides the same blue wash: starts primary[700] and lands on
  // white so it stays legible against the deep blue background.
  const goNumberAStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      blueFill.value,
      [0, 1],
      [palette.primary[700], palette.white],
    ),
  }));

  return (
    <Animated.View
      style={[styles.countdownRoot, rootAStyle, { paddingTop: insets.top }]}
    >
      <Animated.View
        style={[
          styles.stepHeader,
          { paddingHorizontal: spacing.xl },
          backArrowAStyle,
        ]}
      >
        <Pressable onPress={onBack} hitSlop={12} disabled={isGo}>
          <ArrowLeft
            size={26}
            color={isGo ? palette.primary[200] : palette.primary[400]}
            weight="bold"
          />
        </Pressable>
      </Animated.View>

      <View style={styles.countdownCenter}>
        <Animated.Text
          key={current}
          entering={ZoomIn.duration(280)}
          exiting={FadeOut.duration(160)}
          style={[
            styles.countdownNumber,
            isGo && styles.countdownGo,
            isGo ? goNumberAStyle : null,
          ]}
        >
          {current}
        </Animated.Text>
      </View>
    </Animated.View>
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
  introTitleOnBlue: {
    fontFamily: fonts.black,
    fontSize: 32,
    lineHeight: 38,
    color: palette.white,
  },
  introSubtitle: {
    ...t.bodyMuted,
    fontSize: 16,
    lineHeight: 22,
  },
  introSubtitleOnBlue: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: palette.primary[100],
  },
  introCta: {
    marginTop: spacing.md,
  },
  focusTipWrap: {
    marginTop: spacing.md,
  },
  focusTipCard: {
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[200],
    gap: spacing.xs,
  },
  focusTipCardOnBlue: {
    backgroundColor: palette.white,
    borderColor: palette.primary[200],
    gap: spacing.xs,
  },
  focusTipEyebrow: {
    ...t.eyebrow,
  },
  focusTipText: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: palette.neutral[800],
  },

  // Too-short / empty-transcript step
  tooShortBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.huge,
  },
  tooShortTitle: {
    fontFamily: fonts.black,
    fontSize: 32,
    lineHeight: 38,
    color: colors.text,
    textAlign: "center",
  },
  tooShortMessage: {
    ...t.bodyMuted,
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 340,
  },

  // Question step
  questionStepBody: {
    flexGrow: 1,
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
