// Full-screen takeover when the user activates today's streak (first session
// of a new local day). Same queue + pending pattern as
// [[PlanCompletedOverlay]] but with a different visual vocabulary: the moment
// is the **fire turning on**, so we lean into a dark night-sky background and
// a warm flame that ignites from nothing into a living, pulsing fire.
//
// Tactical break from the strict primary-blue palette: the streak metaphor
// universally reads as warm fire. Containing the warm tones inside this one
// overlay keeps the rest of the app on-brand while letting the moment land.
//
// Choreography:
//   1. Background fades from transparent → dark navy.
//   2. Three "spark" dots flicker briefly where the flame will be.
//   3. The Flame icon scales up from 0 with a slight rotation wobble.
//   4. A warm radial glow pulses indefinitely under the flame.
//   5. Streak count and copy fade in from below.
//   6. Confetti shower (white + warm-tinted) drifts down behind it all.

import * as Haptics from "expo-haptics";
import { FlameIcon as Flame } from "phosphor-react-native";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { DuoButton } from "@/components/ui/DuoButton";
import { localTodayISO } from "@/lib/dayDate";
import {
  dismissStreakUnlock,
  peekStreakUnlock,
  subscribeStreakUnlock,
  writeLastStreakCelebrationDate,
  type StreakUnlockedEvent,
} from "@/lib/streakCelebration";
import { fonts, palette, spacing } from "@/lib/theme";

// Warm fire palette — confined to this file so the global theme stays strict.
const FIRE = {
  bg: "#0B1220",          // near-black navy, the "night" the fire lights up
  bgTop: "#1A2538",       // slight gradient feel via radial-ish overlay
  glow: "#F59E0B",        // amber radial glow under the flame
  glowSoft: "#FB923C",    // softer orange tint for the outer halo
  flame: "#FB923C",       // primary flame fill
  flameHot: "#FBBF24",    // hot spot at flame base
  spark: "#FCD34D",       // bright yellow sparks
  textWarm: "#FCD34D",    // accent text (streak count subtitle)
  textMuted: "#94A3B8",   // body text on dark bg
} as const;

const PT_MOTIVATIONS = [
  "Mais um dia em chamas. Continua.",
  "Aceitaste o desafio de hoje. Bom trabalho.",
  "O hábito está a pegar. Não pares agora.",
  "Cada dia conta. E este, ficou no bolso.",
  "Treino consistente, resultados garantidos.",
  "Dia somado. Estás a construir algo.",
  "Mantém a chama acesa. Amanhã também.",
];

function pickMotivation(seed: number): string {
  const idx = Math.abs(seed) % PT_MOTIVATIONS.length;
  return PT_MOTIVATIONS[idx];
}

export function StreakUnlockedOverlay() {
  const current = useSyncExternalStore(
    subscribeStreakUnlock,
    peekStreakUnlock,
    peekStreakUnlock,
  );

  if (!current) return null;
  return (
    <CelebrationScreen
      key={`streak-${current.streak_current}`}
      event={current}
    />
  );
}

function CelebrationScreen({ event }: { event: StreakUnlockedEvent }) {
  const bg = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const contentY = useSharedValue(28);

  // Flame ignition: starts invisible + tiny, then bursts to full size with a
  // small rotation wobble so it reads as a flame catching, not a static icon.
  const flameScale = useSharedValue(0);
  const flameRot = useSharedValue(-12);
  const flameY = useSharedValue(8);

  // Pulsing radial glow under the flame — drives both the outer halo and the
  // inner hot core. Loops forever so the fire feels alive while the overlay
  // is up.
  const glow = useSharedValue(0);

  // Three sparks flicker in before the main flame ignites.
  const spark1 = useSharedValue(0);
  const spark2 = useSharedValue(0);
  const spark3 = useSharedValue(0);

  const [enteringDone, setEnteringDone] = useState(false);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );

    bg.value = withTiming(1, {
      duration: 380,
      easing: Easing.out(Easing.cubic),
    });

    // Sparks: quick on/off pops, staggered, before the flame catches.
    spark1.value = withDelay(
      180,
      withSequence(
        withTiming(1, { duration: 90 }),
        withTiming(0, { duration: 220 }),
      ),
    );
    spark2.value = withDelay(
      260,
      withSequence(
        withTiming(1, { duration: 90 }),
        withTiming(0, { duration: 240 }),
      ),
    );
    spark3.value = withDelay(
      340,
      withSequence(
        withTiming(1, { duration: 90 }),
        withTiming(0, { duration: 260 }),
      ),
    );

    // Flame catches around 420ms — after the last spark fades.
    flameScale.value = withDelay(
      420,
      withSequence(
        withTiming(1.25, {
          duration: 460,
          easing: Easing.out(Easing.cubic),
        }),
        withTiming(0.94, { duration: 200 }),
        withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
      ),
    );
    flameRot.value = withDelay(
      420,
      withSequence(
        withTiming(8, { duration: 240 }),
        withTiming(-4, { duration: 200 }),
        withTiming(0, { duration: 240 }),
      ),
    );
    flameY.value = withDelay(
      420,
      withTiming(0, { duration: 540, easing: Easing.out(Easing.cubic) }),
    );

    // Glow starts as soon as the flame is visible and breathes forever.
    glow.value = withDelay(
      520,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.35, {
            duration: 900,
            easing: Easing.inOut(Easing.quad),
          }),
        ),
        -1,
        false,
      ),
    );

    // Copy slides up behind the flame.
    contentOpacity.value = withDelay(
      640,
      withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) }),
    );
    contentY.value = withDelay(
      640,
      withTiming(0, { duration: 480, easing: Easing.out(Easing.cubic) }),
    );

    // CTA disabled until the ignition has had time to land.
    const t = setTimeout(() => setEnteringDone(true), 1100);
    return () => clearTimeout(t);
    // shared values are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.streak_current]);

  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.value }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentY.value }],
  }));
  const flameStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: flameY.value },
      { scale: flameScale.value },
      { rotate: `${flameRot.value}deg` },
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + glow.value * 0.42,
    transform: [{ scale: 0.85 + glow.value * 0.35 }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    opacity: 0.32 + glow.value * 0.55,
    transform: [{ scale: 0.7 + glow.value * 0.25 }],
  }));
  const sparkStyle1 = useAnimatedStyle(() => ({
    opacity: spark1.value,
    transform: [{ scale: 0.4 + spark1.value * 0.8 }],
  }));
  const sparkStyle2 = useAnimatedStyle(() => ({
    opacity: spark2.value,
    transform: [{ scale: 0.4 + spark2.value * 0.8 }],
  }));
  const sparkStyle3 = useAnimatedStyle(() => ({
    opacity: spark3.value,
    transform: [{ scale: 0.4 + spark3.value * 0.8 }],
  }));

  const motivation = useMemo(
    () => pickMotivation(event.streak_current * 7 + event.streak_best),
    [event.streak_current, event.streak_best],
  );

  const dayWord = event.streak_current === 1 ? "dia" : "dias";

  return (
    <View pointerEvents="auto" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.bg, bgStyle]} />
      <Animated.View style={[styles.bgTop, bgStyle]} />

      <ConfettiBurst />

      <View style={styles.content} pointerEvents="box-none">
        <View style={styles.flameStage}>
          {/* Outer pulsing halo */}
          <Animated.View style={[styles.halo, haloStyle]} />
          {/* Inner hot core */}
          <Animated.View style={[styles.core, coreStyle]} />
          {/* Sparks that flicker before the flame catches */}
          <Animated.View
            style={[styles.spark, styles.sparkA, sparkStyle1]}
          />
          <Animated.View
            style={[styles.spark, styles.sparkB, sparkStyle2]}
          />
          <Animated.View
            style={[styles.spark, styles.sparkC, sparkStyle3]}
          />
          {/* The flame itself */}
          <Animated.View style={flameStyle}>
            <Flame size={160} color={FIRE.flame} weight="fill" />
          </Animated.View>
          {/* Hot inner flame for depth — same shape, smaller, brighter, sitting
              on top of the main flame. */}
          <Animated.View style={[styles.flameHotWrap, flameStyle]}>
            <Flame size={88} color={FIRE.flameHot} weight="fill" />
          </Animated.View>
        </View>

        <Animated.View style={[styles.copy, contentStyle]} pointerEvents="box-none">
          <Text style={styles.eyebrow}>Streak ativado</Text>
          <Text style={styles.headline}>Estás em chamas!</Text>

          <View style={styles.countWrap}>
            <Text style={styles.countValue}>{event.streak_current}</Text>
            <Text style={styles.countUnit}>{dayWord} seguidos</Text>
          </View>

          {event.is_new_best ? (
            <Text style={styles.newBest}>Novo recorde pessoal</Text>
          ) : null}

          <Text style={styles.motivation}>{motivation}</Text>

          <View style={styles.buttonWrap}>
            <DuoButton
              title="CONTINUAR"
              variant="primary"
              onPress={() => {
                if (!enteringDone) return;
                Haptics.selectionAsync().catch(() => {});
                // Write the once-per-day gate only after the user has
                // actually seen and dismissed the celebration. submitSession
                // used to write this pre-emptively before enqueuing, which
                // silently locked the user out if anything stopped the
                // overlay from surfacing (race condition, app kill, prior
                // buggy version). Writing here means a missed celebration
                // always retries on the next session.
                void writeLastStreakCelebrationDate(localTodayISO());
                dismissStreakUnlock();
              }}
            />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

// Confetti shower tuned for a dark background. 36 pieces using white + the
// warm fire tints so they pop against the navy.

const CONFETTI_COUNT = 36;

function ConfettiBurst() {
  const dots = useMemo(
    () => Array.from({ length: CONFETTI_COUNT }).map((_, i) => i),
    [],
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {dots.map((i) => (
        <ConfettiDot key={i} index={i} />
      ))}
    </View>
  );
}

function ConfettiDot({ index }: { index: number }) {
  const { width, height } = Dimensions.get("window");

  const seed = useMemo(() => {
    const startX = Math.random() * width;
    const drift = (Math.random() - 0.5) * 160;
    const rotEnd = Math.random() * 720 - 360;
    const size = 6 + Math.random() * 5;
    const r = Math.random();
    const tint =
      r < 0.4
        ? palette.white
        : r < 0.7
          ? FIRE.flame
          : r < 0.88
            ? FIRE.flameHot
            : FIRE.spark;
    return {
      startX,
      drift,
      rotEnd,
      size,
      tint,
      delay: 600 + index * 28,
      duration: 1800 + Math.random() * 1100,
      endY: height + 80,
    };
  }, [index, width, height]);

  const tx = useSharedValue(0);
  const ty = useSharedValue(-60);
  const rot = useSharedValue(0);
  const op = useSharedValue(0);

  useEffect(() => {
    op.value = withDelay(
      seed.delay,
      withSequence(
        withTiming(1, { duration: 140 }),
        withTiming(1, { duration: seed.duration - 420 }),
        withTiming(0, { duration: 280 }),
      ),
    );
    ty.value = withDelay(
      seed.delay,
      withTiming(seed.endY, {
        duration: seed.duration,
        easing: Easing.in(Easing.quad),
      }),
    );
    tx.value = withDelay(
      seed.delay,
      withTiming(seed.drift, {
        duration: seed.duration,
        easing: Easing.inOut(Easing.quad),
      }),
    );
    rot.value = withDelay(
      seed.delay,
      withTiming(seed.rotEnd, {
        duration: seed.duration,
        easing: Easing.out(Easing.cubic),
      }),
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
        styles.confetti,
        {
          left: seed.startX,
          width: seed.size,
          height: seed.size * 1.6,
          backgroundColor: seed.tint,
        },
        style,
      ]}
    />
  );
}

const FLAME_STAGE = 240;

const styles = StyleSheet.create({
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: FIRE.bg,
  },
  // A soft upper-screen tint to give the night a touch of depth without a
  // gradient dependency.
  bgTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 320,
    backgroundColor: FIRE.bgTop,
    opacity: 0.55,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.huge,
  },

  flameStage: {
    width: FLAME_STAGE,
    height: FLAME_STAGE,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xxl,
  },
  halo: {
    position: "absolute",
    width: FLAME_STAGE,
    height: FLAME_STAGE,
    borderRadius: FLAME_STAGE / 2,
    backgroundColor: FIRE.glowSoft,
  },
  core: {
    position: "absolute",
    width: FLAME_STAGE * 0.55,
    height: FLAME_STAGE * 0.55,
    borderRadius: (FLAME_STAGE * 0.55) / 2,
    backgroundColor: FIRE.glow,
  },
  flameHotWrap: {
    position: "absolute",
    // Hot core sits over the lower-center of the main flame.
    bottom: FLAME_STAGE / 2 - 60,
  },

  spark: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: FIRE.spark,
  },
  // Three spark positions around the flame base.
  sparkA: { top: FLAME_STAGE * 0.32, left: FLAME_STAGE * 0.22 },
  sparkB: { top: FLAME_STAGE * 0.48, right: FLAME_STAGE * 0.18 },
  sparkC: { top: FLAME_STAGE * 0.62, left: FLAME_STAGE * 0.42 },

  copy: {
    alignItems: "center",
    alignSelf: "stretch",
  },
  eyebrow: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    letterSpacing: 1.6,
    color: FIRE.textWarm,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  headline: {
    fontFamily: fonts.black,
    fontSize: 36,
    lineHeight: 40,
    color: palette.white,
    textAlign: "center",
  },
  countWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  countValue: {
    fontFamily: fonts.black,
    fontSize: 72,
    lineHeight: 76,
    color: palette.white,
    includeFontPadding: false,
  },
  countUnit: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 22,
    color: FIRE.textWarm,
  },
  newBest: {
    fontFamily: fonts.bold,
    fontSize: 13,
    letterSpacing: 1.2,
    color: FIRE.spark,
    textTransform: "uppercase",
    marginTop: spacing.sm,
  },
  motivation: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: FIRE.textMuted,
    textAlign: "center",
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  buttonWrap: {
    alignSelf: "stretch",
    maxWidth: 360,
  },
  confetti: {
    position: "absolute",
    top: -60,
    borderRadius: 2,
  },
});
