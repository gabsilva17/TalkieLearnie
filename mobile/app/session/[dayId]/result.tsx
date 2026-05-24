import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowCircleRightIcon as ArrowCircleRight,
  ArrowClockwiseIcon as ArrowClockwise,
  CaretDownIcon as CaretDown,
  CheckCircleIcon as CheckCircle,
  type Icon,
  InfoIcon as Info,
  PauseIcon as Pause,
  PlayIcon as Play,
  XIcon as X,
} from "phosphor-react-native";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
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
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { DuoButton } from "@/components/ui/DuoButton";
import { LogoMark } from "@/components/ui/LogoMark";
import { Screen } from "@/components/ui/Screen";
import {
  flushPendingAchievements,
  setAchievementsResultScreenActive,
} from "@/lib/achievementsQueue";
import { flushPendingPlanCompleted } from "@/lib/planCompletionQueue";
import {
  flushPendingStreakUnlock,
  setStreakResultScreenActive,
} from "@/lib/streakCelebration";
import { FillerHit, SessionResult, api } from "@/lib/api";
import {
  band,
  colors,
  fonts,
  hairline,
  palette,
  radii,
  spacing,
  type as t,
} from "@/lib/theme";

function wpmIsGood(wpm: number): boolean {
  return wpm >= 120 && wpm <= 160;
}

function fillerIsGood(count: number): boolean {
  return count <= 3;
}

function pacingIsGood(v: number): boolean {
  return v >= 0.15 && v <= 0.35;
}

function wpmLabel(wpm: number): string {
  if (wpm < 90) return "Muito lento";
  if (wpm < 120) return "Lento";
  if (wpm <= 160) return "Ideal";
  if (wpm <= 200) return "Rápido";
  return "Atropelado";
}

function fillerLabel(count: number): string {
  if (count === 0) return "Perfeito";
  if (count <= 3) return "Aceitável";
  return "A reduzir";
}

function pacingLabel(v: number): string {
  if (v < 0.15) return "Monotónico";
  if (v <= 0.35) return "Saudável";
  return "Errático";
}

function motivationalMessage(rating: number): string {
  if (rating >= 8) return "Excelente. Continua assim.";
  if (rating >= 5) return "Bom progresso. Estás no caminho certo.";
  return "Vamos treinar mais. Cada tentativa conta.";
}

const TOTAL_PAGES = 6;

function formatMmSs(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00";
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type SeekRequest = { time: number; n: number };

export default function SessionResultScreen() {
  const router = useRouter();
  const { dayId, result } = useLocalSearchParams<{ dayId: string; result?: string }>();

  const inlineData = useMemo<SessionResult | null>(() => {
    if (!result) return null;
    try {
      return JSON.parse(result) as SessionResult;
    } catch {
      return null;
    }
  }, [result]);

  const [fetched, setFetched] = useState<SessionResult | null>(null);
  const [loading, setLoading] = useState(!inlineData);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [done, setDone] = useState(false);

  // All three celebration queues use the same "pending until result
  // unmounts" pattern: achievements + plan-completion + streak-activation
  // sit in a pending buffer during the post-record flow and only surface
  // once result.tsx unmounts. That keeps the cards from painting over the
  // CelebrationFlow or the rating reveal — they always appear over /plans.
  //
  // For achievements + streak, the gate is actually CLOSED earlier — by
  // submitSession itself, synchronously, before its background profile-
  // refresh IIFE starts. We mirror that here on mount so revisits of a past
  // result page (where submitSession never ran) also suppress any enqueue
  // that might happen mid-view. On unmount we open the gate, which
  // auto-promotes pending → live queue; the explicit flush calls below are
  // therefore redundant for streak/achievements but cheap and kept for
  // readability + to flush plan completion (which has no gate).
  useEffect(() => {
    setAchievementsResultScreenActive(true);
    setStreakResultScreenActive(true);
    return () => {
      setAchievementsResultScreenActive(false);
      setStreakResultScreenActive(false);
      flushPendingAchievements();
      flushPendingPlanCompleted();
      flushPendingStreakUnlock();
    };
  }, []);

  useEffect(() => {
    if (inlineData || !dayId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getSessionForDay(dayId);
        if (cancelled) return;
        if (!s) {
          setFetchError("Ainda não há resultado para este dia.");
        } else {
          setFetched(s);
        }
      } catch (e) {
        if (!cancelled) setFetchError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inlineData, dayId]);

  const data = inlineData ?? fetched;

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

  if (!data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{fetchError ?? "Resultado indisponível."}</Text>
          <DuoButton
            title="VOLTAR AO PLANO"
            variant="secondary"
            onPress={() => router.replace("/")}
            fullWidth={false}
          />
        </View>
      </SafeAreaView>
    );
  }

  const { feedback } = data;
  const firstVisit = inlineData !== null;

  if (firstVisit && !done) {
    return (
      <FirstVisitPager
        data={data}
        pageIndex={pageIndex}
        onAdvance={() => {
          if (pageIndex >= TOTAL_PAGES - 1) {
            setDone(true);
          } else {
            setPageIndex((i) => i + 1);
          }
        }}
        onClose={() => router.replace("/")}
      />
    );
  }

  const footer = (
    <View style={styles.footerStack}>
      <DuoButton
        title="VOLTAR AO PLANO"
        variant="primary"
        onPress={() => router.replace("/")}
      />
      <DuoButton
        title="REPETIR PARA MELHORAR"
        iconRight={ArrowClockwise}
        variant="secondary"
        onPress={() =>
          router.replace({
            pathname: `/session/${dayId}`,
            params: { retry: "1" },
          })
        }
      />
    </View>
  );

  // Animate the full view as a single soft fade-in only the first time
  // the stitched composition is shown (firstVisit && done). Revisits: no animation.
  const FullViewContainer = firstVisit ? Animated.View : View;
  const fullViewProps = firstVisit ? { entering: FadeIn.duration(400) } : {};

  const ratingBand = band(data.rating);
  const motivation = motivationalMessage(data.rating);

  return (
    <Screen scroll footer={footer}>
      <FullViewContainer {...fullViewProps}>
        <View style={styles.topBar}>
          <Text style={styles.eyebrow}>Resultado</Text>
          <Pressable
            onPress={() => router.replace("/")}
            hitSlop={16}
            accessibilityLabel="Fechar"
          >
            <X size={24} color={palette.neutral[400]} weight="regular" />
          </Pressable>
        </View>
        <Hairline />

        <View style={styles.scoreBlock}>
          <View style={styles.scoreRow}>
            <Text style={[styles.score, { color: ratingBand.color }]}>{data.rating}</Text>
            <Text style={styles.scoreMax}>/ 10</Text>
          </View>
          <Text style={[styles.scoreLabel, { color: ratingBand.color }]}>
            {ratingBand.label}
          </Text>
          <Text style={styles.motivation}>{motivation}</Text>
        </View>
        <Hairline />

        <Block title="Resumo">
          <Text style={styles.bodyText}>{feedback.summary}</Text>
        </Block>
        <Hairline />

        <View style={styles.metricsRow}>
          <MetricCol
            eyebrow="Velocidade"
            value={Math.round(data.wpm).toString()}
            bandLabel={wpmLabel(data.wpm)}
            good={wpmIsGood(data.wpm)}
          />
          <MetricCol
            eyebrow="Filler words"
            value={String(data.filler_count)}
            bandLabel={fillerLabel(data.filler_count)}
            good={fillerIsGood(data.filler_count)}
          />
          <MetricCol
            eyebrow="Variação"
            value={data.pacing_variation.toFixed(2)}
            bandLabel={pacingLabel(data.pacing_variation)}
            good={pacingIsGood(data.pacing_variation)}
          />
        </View>
        <Hairline />

        <NumberedBlock title="Pontos fortes" items={feedback.strengths} />
        <NumberedBlock title="A melhorar" items={feedback.weaknesses} />
        <NumberedBlock title="Próximo treino" items={feedback.suggestions} />

        <Block title="Avaliação">
          <View style={styles.judgeList}>
            <JudgeRow label="Adequação à audiência" text={feedback.audience_fit} />
            <JudgeRow label="Concisão" text={feedback.conciseness} />
            <JudgeRow label="Foco" text={feedback.dispersion} />
          </View>
        </Block>
        <Hairline />

        <ReplayBlock data={data} />
      </FullViewContainer>
    </Screen>
  );
}

function Hairline() {
  return <View style={styles.hairline} />;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={styles.eyebrow}>{title}</Text>
      <View style={styles.blockBody}>{children}</View>
    </View>
  );
}

function NumberedBlock({ title, items }: { title: string; items: string[] }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  return (
    <>
      <View style={styles.block}>
        <Text style={styles.eyebrow}>{title}</Text>
        <View style={styles.numList}>
          {list.map((it, i) => (
            <View key={i} style={styles.numRow}>
              <Text style={styles.numIndex}>{String(i + 1).padStart(2, "0")}</Text>
              <Text style={styles.numText}>{it}</Text>
            </View>
          ))}
        </View>
      </View>
      <Hairline />
    </>
  );
}

function JudgeRow({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.judgeRowItem}>
      <Text style={styles.judgeLabel}>{label}</Text>
      <Text style={styles.judgeText}>{text}</Text>
    </View>
  );
}

function MetricCol({
  eyebrow,
  value,
  bandLabel,
  good,
}: {
  eyebrow: string;
  value: string;
  bandLabel: string;
  good: boolean;
}) {
  const valueColor = good ? palette.primary[700] : palette.neutral[800];
  const bandColor = good ? palette.primary[600] : palette.neutral[500];
  return (
    <View style={styles.metricCol}>
      <Text style={styles.metricEyebrow}>{eyebrow}</Text>
      <Text style={[styles.metricValue, { color: valueColor }]}>{value}</Text>
      <Text style={[styles.metricBand, { color: bandColor }]} numberOfLines={1}>
        {bandLabel}
      </Text>
    </View>
  );
}

function ReplayBlock({ data }: { data: SessionResult }) {
  const [seek, setSeek] = useState<SeekRequest | null>(null);
  const handleFillerTap = (hit: FillerHit) => {
    setSeek((prev) => ({ time: hit.start, n: (prev?.n ?? 0) + 1 }));
  };

  return (
    <View style={styles.block}>
      <View style={styles.transcriptHead}>
        <Text style={styles.eyebrow}>Transcrição</Text>
        <Text style={styles.transcriptMeta}>
          {formatMmSs(data.audio_duration_s)} · {Math.round(data.wpm)} WPM
        </Text>
      </View>

      {data.audio_url ? (
        <AudioPlayer
          uri={data.audio_url}
          duration={data.audio_duration_s}
          seekRequest={seek}
        />
      ) : null}

      <Text style={styles.transcript}>{`“${data.transcript}”`}</Text>

      {data.filler_timestamps?.length ? (
        <View style={styles.fillerSection}>
          <Text style={styles.fillerHeading}>
            Filler words ({data.filler_timestamps.length}) · toca para ouvir
          </Text>
          <View style={styles.fillerWrap}>
            {data.filler_timestamps.map((hit, i) => (
              <Pressable
                key={`${hit.start}-${i}`}
                onPress={() => handleFillerTap(hit)}
                style={({ pressed }) => [
                  styles.fillerItem,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.fillerTime}>{formatMmSs(hit.start)}</Text>
                <Text style={styles.fillerDot}>·</Text>
                <Text style={styles.fillerToken}>{hit.token}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function FirstVisitPager({
  data,
  pageIndex,
  onAdvance,
  onClose,
}: {
  data: SessionResult;
  pageIndex: number;
  onAdvance: () => void;
  onClose: () => void;
}) {
  const { feedback } = data;
  const ratingBand = band(data.rating);
  const motivation = motivationalMessage(data.rating);
  const isLast = pageIndex >= TOTAL_PAGES - 1;

  const counter = `${pageIndex + 1}/${TOTAL_PAGES}`;

  const footer = (
    <DuoButton
      title={isLast ? "VER TUDO" : "CONTINUAR"}
      variant="primary"
      onPress={onAdvance}
    />
  );

  return (
    <Screen footer={footer}>
      <View style={styles.headerRow}>
        <Pressable onPress={onClose} hitSlop={12}>
          <X size={28} color={palette.neutral[400]} weight="bold" />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={[t.caption, { color: palette.neutral[500] }]}>{counter}</Text>
      </View>

      <ScrollablePage key={pageIndex}>
       <Animated.View
        entering={FadeInDown.duration(360)}
        style={styles.pageBody}
      >
        {pageIndex === 0 ? (
          <ScoreReveal
            rating={data.rating}
            bandColor={ratingBand.color}
            bandLabel={ratingBand.label}
            motivation={motivation}
          />
        ) : null}

        {pageIndex === 1 ? (
          <View style={styles.pg2_root}>
            <View style={{ flex: 1 }} />
            <View style={styles.pg2_inner}>
              <Text style={styles.pg2_quoteOpen}>{"“"}</Text>
              <Text style={styles.pg2_summary}>{feedback.summary}</Text>
              <View style={styles.pg2_quoteCloseWrap}>
                <Text style={styles.pg2_quoteClose}>{"“"}</Text>
              </View>
            </View>
            <View style={{ flex: 1 }} />
          </View>
        ) : null}

        {pageIndex === 2 ? (
          <View style={styles.pg3_root}>
            <View style={{ flex: 1 }} />
            <MetricRow
              eyebrow="Velocidade"
              value={Math.round(data.wpm).toString()}
              unit="palavras/min"
              band={wpmLabel(data.wpm)}
              good={wpmIsGood(data.wpm)}
            />
            <View style={styles.pg3_divider} />
            <MetricRow
              eyebrow="Filler words"
              value={String(data.filler_count)}
              unit={data.top_filler ? `"${data.top_filler}"` : "filler words"}
              band={fillerLabel(data.filler_count)}
              good={fillerIsGood(data.filler_count)}
            />
            <View style={styles.pg3_divider} />
            <MetricRow
              eyebrow="Variação"
              value={data.pacing_variation.toFixed(2)}
              unit="ritmo"
              band={pacingLabel(data.pacing_variation)}
              good={pacingIsGood(data.pacing_variation)}
            />
            <View style={{ flex: 1 }} />
          </View>
        ) : null}

        {pageIndex === 3 ? (
          <ListPage
            title="Pontos fortes"
            subtitle="O que correu mesmo bem hoje."
            items={feedback.strengths}
            icon={CheckCircle}
          />
        ) : null}

        {pageIndex === 4 ? (
          <ListPage
            title="A melhorar"
            subtitle="Onde focar na próxima tentativa."
            items={feedback.weaknesses}
            icon={Info}
          />
        ) : null}

        {pageIndex === 5 ? (
          <ListPage
            title="Próximo treino"
            subtitle="Leva isto para a próxima sessão."
            items={feedback.suggestions}
            icon={ArrowCircleRight}
          />
        ) : null}
       </Animated.View>
      </ScrollablePage>
    </Screen>
  );
}

function ScrollablePage({ children }: { children: ReactNode }) {
  const [contentH, setContentH] = useState(0);
  const [layoutH, setLayoutH] = useState(0);
  const [atBottom, setAtBottom] = useState(true);

  const hasOverflow = contentH > layoutH + 1;
  const showHint = hasOverflow && !atBottom;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const reachedBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 8;
    setAtBottom(reachedBottom);
  };

  return (
    <View style={styles.scrollWrap}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollGrow}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => setLayoutH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => {
          setContentH(h);
          setAtBottom(h <= layoutH + 1);
        }}
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        {children}
      </ScrollView>
      {showHint ? <ScrollHint /> : null}
    </View>
  );
}

function ScrollHint() {
  const offset = useSharedValue(0);
  useEffect(() => {
    offset.value = withRepeat(withTiming(6, { duration: 700 }), -1, true);
  }, [offset]);
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));
  return (
    <Animated.View
      style={[styles.scrollHint, aStyle]}
      pointerEvents="none"
    >
      <View style={styles.scrollHintChip}>
        <CaretDown size={20} color={palette.primary[700]} weight="bold" />
      </View>
    </Animated.View>
  );
}

function MetricRow({
  eyebrow,
  value,
  unit,
  band: bandLabel,
  good,
}: {
  eyebrow: string;
  value: string;
  unit: string;
  band: string;
  good: boolean;
}) {
  const valueColor = good ? palette.primary[600] : palette.neutral[600];
  const chipBg = good ? palette.primary[100] : palette.neutral[100];
  return (
    <View style={styles.pg3_row}>
      <View style={styles.pg3_left}>
        <Text style={[t.caption, { color: palette.neutral[500] }]}>
          {eyebrow}
        </Text>
        <View style={styles.pg3_valueRow}>
          <Text style={[styles.pg3_value, { color: valueColor }]}>{value}</Text>
          <Text style={styles.pg3_unit}>{unit}</Text>
        </View>
      </View>
      <View style={[styles.pg3_chip, { backgroundColor: chipBg }]}>
        <Text style={[styles.pg3_chipText, { color: valueColor }]}>
          {bandLabel}
        </Text>
      </View>
    </View>
  );
}

function ListPage({
  title,
  subtitle,
  items,
  icon: IconCmp,
}: {
  title: string;
  subtitle: string;
  items: string[];
  icon: Icon;
}) {
  return (
    <View style={styles.pgList_root}>
      <Text style={styles.pgList_title}>{title}</Text>
      <Text style={styles.pgList_subtitle}>{subtitle}</Text>
      <View style={styles.pgList_items}>
        {(Array.isArray(items) ? items : []).map((it, i) => (
          <View key={i} style={styles.pgList_row}>
            <View style={styles.pgList_chip}>
              <IconCmp size={26} color={palette.primary[700]} weight="fill" />
            </View>
            <Text style={styles.pgList_text}>{it}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Score reveal: ring scales in, the rating counts up 0 → N over ~900ms with
// tick haptics for game-show feel. On high ratings (≥ 8) a confetti burst
// punctuates the moment.
// ---------------------------------------------------------------------------

function ScoreReveal({
  rating,
  bandColor,
  bandLabel,
  motivation,
}: {
  rating: number;
  bandColor: string;
  bandLabel: string;
  motivation: string;
}) {
  const ringScale = useSharedValue(0.6);
  const ringOpacity = useSharedValue(0);
  const [display, setDisplay] = useState(0);

  // Refs keep the count-up running exactly once even if the component re-mounts.
  const ranRef = useRef(false);
  const celebrate = rating >= 8;

  useEffect(() => {
    // Ring entrance — spring-ish via timing with overshoot is jarring on text.
    // A simple ease-out scale + fade reads as "settling in" without bounce.
    ringScale.value = withTiming(1, {
      duration: 460,
      easing: Easing.out(Easing.cubic),
    });
    ringOpacity.value = withTiming(1, { duration: 320 });

    if (ranRef.current) return;
    ranRef.current = true;

    const duration = 900;
    const start = Date.now() + 220; // hold on 0 briefly before counting
    let lastTick = -1;
    let frame: ReturnType<typeof setTimeout> | null = null;
    const step = () => {
      const t = Math.min(1, Math.max(0, (Date.now() - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(eased * rating);
      if (v !== lastTick) {
        lastTick = v;
        setDisplay(v);
        if (v > 0 && v < rating) {
          // Light tactile tick on each integer the counter passes through.
          Haptics.selectionAsync().catch(() => {});
        }
      }
      if (t < 1) {
        frame = setTimeout(step, 32);
      } else {
        setDisplay(rating);
        // Land with a stronger haptic to punctuate the reveal.
        Haptics.notificationAsync(
          celebrate
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning,
        ).catch(() => {});
      }
    };
    const startTimer = setTimeout(step, 0);
    return () => {
      clearTimeout(startTimer);
      if (frame) clearTimeout(frame);
    };
    // ringScale / ringOpacity are stable shared values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rating, celebrate]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  return (
    <View style={styles.pg1_root}>
      <View style={{ flex: 1 }} />
      <Animated.View style={[styles.pg1_ringWrap, ringStyle]}>
        <View style={[styles.pg1_ring, { borderColor: bandColor }]}>
          <View style={styles.pg1_ringInner}>
            <Text style={[styles.pg1_value, { color: bandColor }]}>
              {display}
            </Text>
            <Text style={styles.pg1_max}>/10</Text>
          </View>
        </View>
        <Text style={[styles.pg1_label, { color: bandColor }]}>{bandLabel}</Text>
      </Animated.View>
      <View style={{ flex: 1 }} />
      <Text style={styles.pg1_motivation}>{motivation}</Text>
      {celebrate ? <ConfettiBurst color={bandColor} /> : null}
    </View>
  );
}

// Lightweight confetti — 18 absolutely-positioned dots launched from screen
// center with a small angular spread, each with its own randomized horizontal
// drift and gravity-style fall. Pure View animation, no extra deps.

const CONFETTI_COUNT = 22;

function ConfettiBurst({ color }: { color: string }) {
  return (
    <View style={confettiStyles.layer} pointerEvents="none">
      {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
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

  // Per-dot random seed — recomputed only once per mount to avoid identical
  // dots stacking and to keep each burst visually unique.
  const seed = useMemo(() => {
    // Spread across a 140° fan above center; horizontal drift biased by side.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.78);
    const speed = 160 + Math.random() * 180;
    return {
      dx: Math.cos(angle) * speed,
      dyUp: Math.sin(angle) * speed,
      dyDown: 360 + Math.random() * 120,
      rot: (Math.random() * 720 - 360) * 1,
      delay: index * 18,
      size: 6 + Math.random() * 4,
      // Mix of primary blue and white-on-blue for variety without breaking the
      // strict palette.
      tint: Math.random() < 0.55 ? color : palette.primary[300],
    };
  }, [index, color]);

  useEffect(() => {
    op.value = withDelay(
      seed.delay,
      withSequence(
        withTiming(1, { duration: 80 }),
        withTiming(1, { duration: 700 }),
        withTiming(0, { duration: 320 }),
      ),
    );
    // Up phase: shoot outward, then gravity pulls them down past the ring.
    tx.value = withDelay(
      seed.delay,
      withTiming(seed.dx, { duration: 1100, easing: Easing.out(Easing.quad) }),
    );
    ty.value = withDelay(
      seed.delay,
      withSequence(
        withTiming(seed.dyUp, { duration: 380, easing: Easing.out(Easing.quad) }),
        withTiming(seed.dyDown, { duration: 760, easing: Easing.in(Easing.quad) }),
      ),
    );
    rot.value = withDelay(
      seed.delay,
      withTiming(seed.rot, { duration: 1100, easing: Easing.out(Easing.cubic) }),
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
        confettiStyles.dot,
        { width: seed.size, height: seed.size * 1.6, backgroundColor: seed.tint },
        style,
      ]}
    />
  );
}

const confettiStyles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    borderRadius: 2,
  },
});

function AudioPlayer({
  uri,
  duration,
  seekRequest,
}: {
  uri: string;
  duration: number;
  seekRequest: SeekRequest | null;
}) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!seekRequest) return;
    (async () => {
      try {
        await player.seekTo(seekRequest.time);
        player.play();
      } catch (e) {
        console.warn("seek failed", e);
      }
    })();
  }, [seekRequest, player]);

  const playing = status?.playing ?? false;
  const current = status?.currentTime ?? 0;
  const total = status?.duration && status.duration > 0 ? status.duration : duration;
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;

  const toggle = () => {
    if (playing) player.pause();
    else player.play();
  };

  return (
    <View style={styles.playerRow}>
      <Pressable
        onPress={toggle}
        style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.6 }]}
        accessibilityLabel={playing ? "Pausar" : "Reproduzir"}
      >
        {playing ? (
          <Pause size={14} color={palette.neutral[700]} weight="bold" />
        ) : (
          <Play size={14} color={palette.neutral[700]} weight="bold" />
        )}
      </Pressable>
      <View style={styles.playerRight}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
        </View>
        <Text style={styles.playerTime}>
          {formatMmSs(current)} / {formatMmSs(total)}
        </Text>
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
  footerStack: {
    gap: spacing.sm,
  },
  errorText: { ...t.body, color: colors.danger, textAlign: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  pageBody: {
    flex: 1,
  },
  flex: { flex: 1 },
  scrollWrap: { flex: 1 },
  scrollGrow: { flexGrow: 1 },
  scrollHint: {
    position: "absolute",
    bottom: spacing.sm,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  scrollHintChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.primary[100],
    alignItems: "center",
    justifyContent: "center",
  },
  // ---- Editorial primitives (landed view) ----
  hairline: {
    height: hairline,
    backgroundColor: colors.rule,
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.primary[600],
  },
  bodyText: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: palette.neutral[800],
  },
  block: {
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  blockBody: {
    gap: spacing.md,
  },

  // Top bar (landed)
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },

  // Score block (landed)
  scoreBlock: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    gap: spacing.xs,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  score: {
    fontFamily: fonts.black,
    fontSize: 96,
    lineHeight: 100,
    includeFontPadding: false,
  },
  scoreMax: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: palette.neutral[400],
  },
  scoreLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    marginTop: spacing.sm,
  },
  motivation: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: palette.neutral[500],
    textAlign: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },

  // Metric row (landed)
  metricsRow: {
    flexDirection: "row",
    paddingVertical: spacing.xl,
  },
  metricCol: {
    flex: 1,
    alignItems: "center",
    gap: spacing.sm,
  },
  metricEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.primary[600],
  },
  metricValue: {
    fontFamily: fonts.black,
    fontSize: 32,
    lineHeight: 36,
    includeFontPadding: false,
  },
  metricBand: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
  },

  // Numbered list (landed)
  numList: {
    gap: spacing.lg,
  },
  numRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  numIndex: {
    fontFamily: fonts.black,
    fontSize: 16,
    lineHeight: 24,
    color: palette.primary[600],
    width: 28,
    fontVariant: ["tabular-nums"],
  },
  numText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: palette.neutral[800],
  },

  // Judge block (landed)
  judgeList: {
    gap: spacing.lg,
  },
  judgeRowItem: {
    gap: spacing.xs,
  },
  judgeLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.primary[600],
  },
  judgeText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: palette.neutral[700],
  },

  // Transcript / replay (landed)
  transcriptHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  transcriptMeta: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: palette.neutral[400],
  },
  transcript: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 24,
    color: palette.neutral[700],
    fontStyle: "italic",
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.neutral[300],
    alignItems: "center",
    justifyContent: "center",
  },
  playerRight: { flex: 1, gap: 6 },
  progressTrack: {
    height: 2,
    backgroundColor: palette.neutral[200],
    overflow: "hidden",
  },
  progressFill: { height: 2, backgroundColor: palette.primary[600] },
  playerTime: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: palette.neutral[500],
    fontVariant: ["tabular-nums"],
  },

  // Fillers (inline, no chips, no icon)
  fillerSection: { gap: spacing.sm },
  fillerHeading: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.primary[600],
  },
  fillerWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.sm,
    columnGap: spacing.lg,
  },
  fillerItem: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  fillerTime: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: palette.primary[700],
    fontVariant: ["tabular-nums"],
  },
  fillerDot: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: palette.neutral[400],
  },
  fillerToken: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: palette.neutral[700],
    textDecorationLine: "underline",
    textDecorationColor: palette.neutral[300],
  },

  // ----- Pager: Page 1 (RESULTADO) -----
  pg1_root: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  pg1_ringWrap: {
    alignItems: "center",
    gap: spacing.lg,
  },
  pg1_ring: {
    width: 240,
    height: 240,
    borderRadius: 999,
    borderWidth: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.white,
  },
  pg1_ringInner: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  pg1_value: {
    fontFamily: fonts.black,
    fontSize: 120,
    lineHeight: 130,
    includeFontPadding: false,
  },
  pg1_max: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: palette.neutral[400],
    marginLeft: 4,
  },
  pg1_label: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    lineHeight: 26,
    textAlign: "center",
  },
  pg1_motivation: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    lineHeight: 24,
    color: palette.neutral[600],
    textAlign: "center",
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xxl,
  },

  // ----- Pager: Page 2 (RESUMO) -----
  pg2_root: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  pg2_inner: {
    paddingHorizontal: spacing.md,
  },
  pg2_quoteOpen: {
    fontFamily: fonts.black,
    fontSize: 96,
    lineHeight: 96,
    color: palette.primary[200],
    marginBottom: -spacing.xl,
  },
  pg2_summary: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 32,
    color: palette.neutral[800],
    paddingHorizontal: spacing.sm,
  },
  pg2_quoteCloseWrap: {
    alignItems: "flex-end",
    marginTop: -spacing.lg,
  },
  pg2_quoteClose: {
    fontFamily: fonts.black,
    fontSize: 64,
    lineHeight: 64,
    color: palette.primary[100],
    transform: [{ rotate: "180deg" }],
  },

  // ----- Pager: Page 3 (MÉTRICAS) -----
  pg3_root: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  pg3_row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  pg3_left: {
    flex: 1,
    gap: spacing.sm,
  },
  pg3_valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  pg3_value: {
    fontFamily: fonts.black,
    fontSize: 56,
    lineHeight: 60,
    includeFontPadding: false,
  },
  pg3_unit: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: palette.neutral[500],
    flexShrink: 1,
  },
  pg3_chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  pg3_chipText: {
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  pg3_divider: {
    height: 1,
    backgroundColor: palette.neutral[200],
  },

  // ----- Pager: Pages 4 / 5 / 6 (LIST) -----
  pgList_root: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  pgList_title: {
    fontFamily: fonts.black,
    fontSize: 32,
    lineHeight: 38,
    color: palette.primary[700],
  },
  pgList_subtitle: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: palette.neutral[500],
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  pgList_items: {
    gap: spacing.lg,
  },
  pgList_row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  pgList_chip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.primary[100],
    alignItems: "center",
    justifyContent: "center",
  },
  pgList_text: {
    flexShrink: 1,
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 24,
    color: palette.neutral[800],
    paddingTop: spacing.sm,
  },
});
