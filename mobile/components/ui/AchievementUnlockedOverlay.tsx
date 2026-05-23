// Full-screen celebration overlay that drains the achievements queue.
//
// Mounted once at the root layout. While there is a head entry in the queue,
// it animates a primary-blue scrim + bouncing trophy + label + description +
// motivational copy + CONTINUAR button. Tapping CONTINUAR pops the entry; if
// another one is waiting (multi-unlock session), the next one slides in.

import * as Haptics from "expo-haptics";
import { TrophyIcon as Trophy } from "phosphor-react-native";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
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
import type { ProfileAchievement } from "@/lib/api";
import {
  dismissAchievement,
  peekAchievement,
  subscribeAchievements,
} from "@/lib/achievementsQueue";
import { colors, fonts, palette, radii, spacing } from "@/lib/theme";

const PT_MOTIVATIONS = [
  "Mais um passo. Continua a treinar.",
  "Isso é trabalho consistente. Não pares.",
  "A prática diária está a dar frutos.",
  "Estás a construir um hábito. Mantém o ritmo.",
  "Vai com tudo para a próxima sessão.",
  "Pequenas vitórias, grande caminho.",
  "Estás cada vez mais à vontade. Continua.",
];

function pickMotivation(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PT_MOTIVATIONS[hash % PT_MOTIVATIONS.length];
}

export function AchievementUnlockedOverlay() {
  const current = useSyncExternalStore(
    subscribeAchievements,
    peekAchievement,
    peekAchievement,
  );

  if (!current) return null;
  return <CelebrationCard key={current.id} achievement={current} />;
}

function CelebrationCard({ achievement }: { achievement: ProfileAchievement }) {
  const scrim = useSharedValue(0);
  const cardScale = useSharedValue(0.7);
  const cardOpacity = useSharedValue(0);
  const trophyScale = useSharedValue(0);
  const trophyRot = useSharedValue(-18);
  const glow = useSharedValue(0);

  const [enteringDone, setEnteringDone] = useState(false);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );

    scrim.value = withTiming(1, { duration: 280 });
    cardOpacity.value = withTiming(1, { duration: 320 });
    cardScale.value = withSequence(
      withTiming(1.06, { duration: 380, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
    );

    trophyScale.value = withDelay(
      180,
      withSequence(
        withTiming(1.2, { duration: 380, easing: Easing.out(Easing.cubic) }),
        withTiming(0.94, { duration: 180 }),
        withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
      ),
    );
    trophyRot.value = withDelay(
      180,
      withSequence(
        withTiming(8, { duration: 220, easing: Easing.out(Easing.quad) }),
        withTiming(-4, { duration: 160 }),
        withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) }),
      ),
    );

    glow.value = withDelay(
      300,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );

    const t = setTimeout(() => setEnteringDone(true), 520);
    return () => clearTimeout(t);
    // shared values are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achievement.id]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));
  const trophyStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: trophyScale.value },
      { rotate: `${trophyRot.value}deg` },
    ],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + glow.value * 0.55,
    transform: [{ scale: 0.9 + glow.value * 0.18 }],
  }));

  const motivation = useMemo(
    () => pickMotivation(achievement.id),
    [achievement.id],
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents="auto" />

      <ConfettiBurst />

      <View style={styles.center} pointerEvents="box-none">
        <Animated.View style={[styles.card, cardStyle]}>
          <Text style={styles.eyebrow}>Conquista desbloqueada</Text>

          <View style={styles.trophyWrap}>
            <Animated.View style={[styles.trophyGlow, glowStyle]} />
            <Animated.View style={trophyStyle}>
              <Trophy
                size={84}
                color={palette.primary[600]}
                weight="fill"
              />
            </Animated.View>
          </View>

          <Text style={styles.label}>{achievement.label}</Text>
          <Text style={styles.desc}>{achievement.description}</Text>

          <View style={styles.divider} />

          <Text style={styles.motivation}>{motivation}</Text>

          <View style={styles.buttonWrap}>
            <DuoButton
              title="CONTINUAR"
              variant="primary"
              onPress={() => {
                if (!enteringDone) return;
                Haptics.selectionAsync().catch(() => {});
                dismissAchievement();
              }}
            />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

// Confetti shower behind the card. Same idea as the result-screen burst but
// spawned across the top edge of the screen so it falls past the celebration
// card. 28 dots, each with randomized drift / rotation / delay.

const CONFETTI_COUNT = 28;

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
    const drift = (Math.random() - 0.5) * 140;
    const rotEnd = (Math.random() * 720 - 360) * 1;
    const size = 6 + Math.random() * 5;
    const tint =
      Math.random() < 0.5
        ? palette.primary[400]
        : Math.random() < 0.5
          ? palette.primary[600]
          : palette.primary[200];
    return {
      startX,
      drift,
      rotEnd,
      size,
      tint,
      delay: index * 36,
      duration: 1500 + Math.random() * 900,
      endY: height + 60,
    };
  }, [index, width, height]);

  const tx = useSharedValue(0);
  const ty = useSharedValue(-40);
  const rot = useSharedValue(0);
  const op = useSharedValue(0);

  useEffect(() => {
    op.value = withDelay(
      seed.delay,
      withSequence(
        withTiming(1, { duration: 120 }),
        withTiming(1, { duration: seed.duration - 360 }),
        withTiming(0, { duration: 240 }),
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

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: palette.white,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.primary[200],
  },
  eyebrow: {
    fontFamily: fonts.extrabold,
    fontSize: 12,
    letterSpacing: 1,
    color: palette.primary[600],
    textTransform: "uppercase",
  },
  trophyWrap: {
    width: 140,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  trophyGlow: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: palette.primary[100],
  },
  label: {
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 30,
    color: colors.text,
    textAlign: "center",
  },
  desc: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: palette.neutral[500],
    textAlign: "center",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  divider: {
    width: 40,
    height: 2,
    borderRadius: 1,
    backgroundColor: palette.primary[200],
    marginVertical: spacing.lg,
  },
  motivation: {
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 22,
    color: palette.primary[700],
    textAlign: "center",
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  buttonWrap: {
    alignSelf: "stretch",
  },
  confetti: {
    position: "absolute",
    top: -40,
    borderRadius: 2,
  },
});
