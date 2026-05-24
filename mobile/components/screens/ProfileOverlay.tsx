// Profile content rendered inside the Revolut-style circular reveal overlay.
//
// Previously lived as a tab route at app/profile; now mounts and
// unmounts each time the user opens / closes the overlay. The `useFocusEffect`
// that used to refetch on tab focus is collapsed into a plain `useEffect` so
// every open hits the network for fresh totals.
//
// Owns its own X close button (top-right) and replaces the previous `Screen`
// wrapper with `SafeAreaView` + a `ScrollView` carrying a `RefreshControl`.

import * as Haptics from "expo-haptics";
import {
  CaretLeftIcon as CaretLeft,
  CaretRightIcon as CaretRight,
  ClockIcon as Clock,
  FlameIcon as Flame,
  GaugeIcon as Gauge,
  type Icon,
  LockIcon as Lock,
  MicrophoneIcon as Microphone,
  PencilSimpleIcon as PencilSimple,
  TrophyIcon as Trophy,
  WarningCircleIcon as WarningCircle,
  XIcon as X,
} from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ZoomIn,
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
import { PressableScale } from "@/components/ui/PressableScale";
import {
  Profile,
  ProfileAchievement,
  ProfileActivityPoint,
  api,
} from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import {
  colors,
  fonts,
  palette,
  radii,
  spacing,
  type as t,
} from "@/lib/theme";
import { getUserName, setUserName } from "@/lib/userName";

const MONTH_NAMES_FULL_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const WEEKDAY_NAMES_PT = ["S", "T", "Q", "Q", "S", "S", "D"]; // seg..dom

function heatmapColor(sessions: number): string {
  if (sessions <= 0) return palette.neutral[100];
  if (sessions === 1) return palette.primary[200];
  if (sessions === 2) return palette.primary[400];
  return palette.primary[600];
}

function shortWeekday(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const names = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  return names[d.getDay()];
}

function dayOfMonth(iso: string): string {
  return String(parseInt(iso.slice(8, 10), 10));
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
}

export function ProfileOverlay({ onClose }: { onClose: () => void }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [name, setName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [nameEditOpen, setNameEditOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    Promise.all([getDeviceId(), getUserName()])
      .then(([id, n]) => {
        setDeviceId(id);
        setName(n);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setError(null);
    try {
      const p = await api.getProfile(deviceId);
      setProfile(p);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [deviceId]);

  // Open = mount. Fire the load once deviceId is ready so the user sees fresh
  // numbers every time the overlay surfaces.
  useEffect(() => {
    if (deviceId) load();
  }, [deviceId, load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const loading = profile === undefined;

  async function saveName() {
    const clean = draftName.trim();
    if (!clean) {
      setNameEditOpen(false);
      return;
    }
    await setUserName(clean);
    setName(clean);
    setNameEditOpen(false);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.closeRow}>
        <PressableScale
          hitSlop={12}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        >
          <View style={styles.closeBtn}>
            <X size={24} color={palette.neutral[700]} weight="regular" />
          </View>
        </PressableScale>
      </View>

      {error && !profile ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <DuoButton title="TENTAR DE NOVO" onPress={load} fullWidth={false} />
        </View>
      ) : loading ? (
        <Animated.View entering={FadeIn.duration(220)} style={styles.center}>
          <LogoMark size="lg" />
        </Animated.View>
      ) : !profile ? null : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={palette.white}
            />
          }
        >
          <Animated.View entering={FadeInDown.duration(220)}>
            <Pressable
              onPress={() => {
                setDraftName(name);
                setNameEditOpen(true);
              }}
              hitSlop={8}
              style={styles.greetRow}
            >
              <Text
                style={styles.greetLine}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                <Text style={styles.greetHello}>Olá, </Text>
                <Text style={styles.greetName}>{name}</Text>
              </Text>
              <PencilSimple size={18} color={palette.neutral[400]} weight="bold" />
            </Pressable>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(240).delay(40)}>
            <Text style={styles.sectionTitle}>Dias consecutivos</Text>
            <StreakInline
              current={profile.streak_current}
              best={profile.streak_best}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(240).delay(100)}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitleInline}>Últimos 7 dias</Text>
              <Pressable
                onPress={() => setHeatmapOpen(true)}
                hitSlop={8}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>Ver tudo</Text>
                <CaretRight size={14} color={palette.primary[600]} weight="bold" />
              </Pressable>
            </View>
            <WeekStrip
              days={profile.activity_365.slice(-7)}
              onExpand={() => setHeatmapOpen(true)}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(240).delay(160)}>
            <Text style={styles.sectionTitle}>Estatísticas</Text>
            <StatsFlat profile={profile} />
          </Animated.View>

          {profile.wpm_trend.length > 1 ? (
            <Animated.View entering={FadeInDown.duration(240).delay(220)}>
              <Text style={styles.sectionTitle}>Ritmo de fala (WPM)</Text>
              <BarChart
                points={profile.wpm_trend.map((p) => ({ date: p.date, value: p.wpm }))}
              />
            </Animated.View>
          ) : null}

          <Animated.View entering={FadeInDown.duration(240).delay(280)}>
            <Text style={styles.sectionTitle}>Conquistas</Text>
            <Achievements list={profile.achievements} />
          </Animated.View>
        </ScrollView>
      )}

      {profile ? (
        <HeatmapModal
          visible={heatmapOpen}
          days={profile.activity_365}
          onClose={() => setHeatmapOpen(false)}
        />
      ) : null}

      <NameEditModal
        visible={nameEditOpen}
        value={draftName}
        onChangeValue={setDraftName}
        onSave={saveName}
        onCancel={() => setNameEditOpen(false)}
      />
    </SafeAreaView>
  );
}

function StreakInline({
  current,
  best,
}: {
  current: number;
  best: number;
}) {
  const lit = current > 0;
  const flameColor = lit ? palette.primary[600] : palette.neutral[400];
  const numberColor = lit ? palette.primary[700] : palette.neutral[600];

  // Living flame: a slow scale + opacity loop while the streak is lit. Stays
  // static when the streak is broken so the user senses the difference.
  const breath = useSharedValue(0);
  useEffect(() => {
    if (!lit) {
      breath.value = withTiming(0, { duration: 200 });
      return;
    }
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [lit, breath]);

  // One-shot bump when the streak value increases (typically after submitting
  // a session). Skips the initial mount so a fresh open doesn't trigger.
  const bump = useSharedValue(0);
  const prevCurrent = useRef<number | null>(null);
  useEffect(() => {
    if (prevCurrent.current !== null && current > prevCurrent.current) {
      bump.value = withSequence(
        withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 360, easing: Easing.out(Easing.quad) }),
      );
    }
    prevCurrent.current = current;
  }, [current, bump]);

  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.08 + bump.value * 0.12 }],
    opacity: 0.85 + breath.value * 0.15,
  }));

  // The streak number gets the same heartbeat so the whole hero feels alive.
  // The bump adds a discrete lift + grow when `current` increments.
  const numberStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -4 * bump.value },
      { scale: 1 + breath.value * 0.025 + bump.value * 0.08 },
    ],
  }));

  return (
    <View style={styles.streakCard}>
      <View style={styles.streakCardMain}>
        <Animated.View style={flameStyle}>
          <Flame size={48} color={flameColor} weight={lit ? "fill" : "bold"} />
        </Animated.View>
        <Animated.Text
          style={[styles.streakCardNumber, { color: numberColor }, numberStyle]}
        >
          {current}
        </Animated.Text>
        <View style={styles.streakCardSpacer} />
        <View style={styles.streakCardRecord}>
          <Text style={styles.streakCardRecordLabel}>Recorde</Text>
          <Text style={styles.streakCardRecordValue}>{best}</Text>
        </View>
      </View>
    </View>
  );
}

function WeekStrip({
  days,
  onExpand,
}: {
  days: ProfileActivityPoint[];
  onExpand: () => void;
}) {
  return (
    <Pressable onPress={onExpand} style={styles.weekStripRow}>
      {days.map((d) => (
        <View key={d.date} style={styles.weekStripCol}>
          <Text style={styles.weekStripWeekday}>{shortWeekday(d.date)}</Text>
          <View
            style={[
              styles.weekStripCell,
              { backgroundColor: heatmapColor(d.sessions) },
            ]}
          >
            <Text
              style={[
                styles.weekStripNum,
                {
                  color:
                    d.sessions > 0 ? palette.white : palette.neutral[400],
                },
              ]}
            >
              {dayOfMonth(d.date)}
            </Text>
          </View>
        </View>
      ))}
    </Pressable>
  );
}

type StatTile = {
  icon: Icon;
  label: string;
  target: number | null;
  decimals: number;
  suffix?: string;
};

function StatsFlat({ profile }: { profile: Profile }) {
  const tiles: StatTile[] = [
    {
      icon: Microphone,
      label: "Sessões",
      target: profile.total_sessions,
      decimals: 0,
    },
    {
      icon: Clock,
      label: "Minutos",
      target: profile.total_minutes,
      decimals: 1,
    },
    {
      icon: Gauge,
      label: "WPM médio",
      target: profile.avg_wpm,
      decimals: 0,
    },
    {
      icon: Trophy,
      label: "Melhor nota",
      target: profile.best_rating,
      decimals: 0,
      suffix: "/10",
    },
  ];
  return (
    <View>
      <View style={styles.statsFlatGrid}>
        {tiles.map((tile, i) => {
          const TileIcon = tile.icon;
          return (
            <View key={tile.label} style={styles.statFlatCell}>
              <View style={styles.statFlatIconRow}>
                <TileIcon size={16} color={palette.primary[600]} weight="bold" />
                <Text style={styles.statFlatLabel}>{tile.label}</Text>
              </View>
              <CountUpText
                target={tile.target}
                decimals={tile.decimals}
                suffix={tile.suffix}
                delay={120 + i * 80}
                style={styles.statFlatValue}
              />
            </View>
          );
        })}
      </View>
      {profile.top_filler ? (
        <View style={styles.fillerInline}>
          <WarningCircle size={16} color={palette.neutral[500]} weight="bold" />
          <Text style={styles.fillerInlineText}>
            Muleta mais comum:{" "}
            <Text style={styles.fillerStrong}>"{profile.top_filler}"</Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Counts up from 0 → target over ~900ms with ease-out. Null / undefined / zero
// targets render the dash placeholder immediately and never tick. The counter
// only runs once per mount of a given target so re-renders don't re-trigger it.
function CountUpText({
  target,
  decimals,
  suffix,
  delay = 0,
  style,
}: {
  target: number | null | undefined;
  decimals: number;
  suffix?: string;
  delay?: number;
  style: any;
}) {
  const empty = target == null;
  const final = empty ? 0 : target;
  const [display, setDisplay] = useState<string>(empty ? "-" : "0");

  // Ref guarantees we count up exactly once per mount even under StrictMode.
  const ranRef = useRef(false);

  useEffect(() => {
    if (empty) return;
    if (ranRef.current) return;
    ranRef.current = true;
    const duration = 900;
    const start = Date.now();
    let frame: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const v = eased * final;
      setDisplay(v.toFixed(decimals));
      if (t < 1) {
        frame = setTimeout(tick, 32);
      } else {
        setDisplay(final.toFixed(decimals));
      }
    };
    const startTimer = setTimeout(tick, delay);
    return () => {
      clearTimeout(startTimer);
      if (frame) clearTimeout(frame);
    };
  }, [empty, final, decimals, delay]);

  return (
    <Text style={style}>
      {empty ? "-" : display}
      {!empty && suffix ? suffix : ""}
    </Text>
  );
}

function BarChart({ points }: { points: { date: string; value: number }[] }) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  const span = Math.max(1, max - min);
  return (
    <View>
      <View style={styles.chartHeader}>
        <Text style={styles.chartLabel}>mín {min.toFixed(0)}</Text>
        <Text style={styles.chartLabel}>máx {max.toFixed(0)}</Text>
      </View>
      <View style={styles.chartRow}>
        {points.map((p, i) => {
          const norm = (p.value - min) / span;
          const heightPct = 25 + Math.round(norm * 70);
          return (
            <View key={p.date} style={styles.chartBarWrap}>
              <View style={styles.chartBarTrack}>
                <ChartBarFill heightPct={heightPct} delay={i * 30} />
              </View>
              <Text style={styles.chartBarLabel} numberOfLines={1}>
                {formatShortDate(p.date)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// One bar — grows from 0% to its target height on mount with a slight stagger
// driven by `delay`. Cubic ease-out so the tops settle softly.
function ChartBarFill({ heightPct, delay }: { heightPct: number; delay: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, {
        duration: 620,
        easing: Easing.out(Easing.cubic),
      }),
    );
    // intentionally one-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const aStyle = useAnimatedStyle(() => ({
    height: `${heightPct * progress.value}%`,
  }));
  return <Animated.View style={[styles.chartBarFill, aStyle]} />;
}

function Achievements({ list }: { list: ProfileAchievement[] }) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(
    () => [...list].sort((a, b) => Number(b.earned) - Number(a.earned)),
    [list],
  );
  const earnedCount = list.filter((a) => a.earned).length;
  const total = list.length;

  return (
    <View>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.achievementsSummary,
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={styles.achievementsSummaryIcon}>
          <Trophy size={22} color={palette.primary[600]} weight="fill" />
        </View>
        <View style={styles.achievementsSummaryText}>
          <Text style={styles.achievementsSummaryCount}>
            {earnedCount}
            <Text style={styles.achievementsSummaryCountTotal}> / {total}</Text>
          </Text>
          <Text style={styles.achievementsSummaryLabel}>
            {earnedCount === 1 ? "conquista desbloqueada" : "conquistas desbloqueadas"}
          </Text>
        </View>
        <View style={styles.achievementsSummaryCta}>
          <Text style={styles.linkText}>Ver mais</Text>
          <CaretRight size={14} color={palette.primary[600]} weight="bold" />
        </View>
      </Pressable>

      <AchievementsModal
        visible={open}
        list={sorted}
        earnedCount={earnedCount}
        total={total}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

function AchievementsModal({
  visible,
  list,
  earnedCount,
  total,
  onClose,
}: {
  visible: boolean;
  list: ProfileAchievement[];
  earnedCount: number;
  total: number;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>Conquistas</Text>
            <Text style={styles.modalSubtitle}>
              {earnedCount} de {total} desbloqueadas
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={styles.modalCloseBtn}>
            <X size={24} color={palette.neutral[700]} weight="bold" />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.achievementsModalContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.achievementsGrid}>
            {list.map((a, i) => (
              <AchievementCard key={a.id} achievement={a} index={i} />
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function AchievementCard({
  achievement,
  index,
}: {
  achievement: ProfileAchievement;
  index: number;
}) {
  const earned = achievement.earned;
  const press = useSharedValue(0);
  // Earned cards get a continuous, very soft glow loop so they read as "alive"
  // next to the locked ones. Locked cards stay static.
  const glow = useSharedValue(0);
  useEffect(() => {
    if (!earned) return;
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [earned, glow]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.04 + (earned ? glow.value * 0.01 : 0) }],
  }));

  // Earned trophies subtly pulse so the eye lands on them first.
  const trophyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + glow.value * 0.08 }],
  }));

  return (
    <Animated.View
      entering={
        earned
          ? ZoomIn.duration(360).delay(80 + index * 40)
          : FadeIn.duration(260).delay(80 + index * 40)
      }
      style={[
        styles.achievementCard,
        !earned ? styles.achievementCardLocked : null,
        cardStyle,
      ]}
    >
      <Pressable
        onPressIn={() => {
          press.value = withTiming(1, { duration: 120 });
          Haptics.selectionAsync().catch(() => {});
        }}
        onPressOut={() => {
          press.value = withTiming(0, { duration: 180 });
        }}
        style={styles.achievementInner}
      >
        {earned ? (
          <Animated.View style={trophyStyle}>
            <Trophy size={20} color={palette.primary[600]} weight="fill" />
          </Animated.View>
        ) : (
          <Lock size={20} color={palette.neutral[400]} weight="bold" />
        )}
        <Text
          style={[
            styles.achievementLabel,
            !earned ? styles.achievementLabelLocked : null,
          ]}
        >
          {achievement.label}
        </Text>
        <Text
          style={[
            styles.achievementDesc,
            !earned ? styles.achievementDescLocked : null,
          ]}
        >
          {achievement.description}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

type MonthBucket = {
  key: string; // YYYY-MM
  year: number;
  month: number; // 0-indexed
  days: ProfileActivityPoint[];
  active: number;
};

function HeatmapModal({
  visible,
  days,
  onClose,
}: {
  visible: boolean;
  days: ProfileActivityPoint[];
  onClose: () => void;
}) {
  const { months, totalActive } = useMemo(() => {
    if (days.length === 0) {
      return { months: [] as MonthBucket[], totalActive: 0 };
    }
    const byMonth = new Map<string, ProfileActivityPoint[]>();
    days.forEach((d) => {
      const k = d.date.slice(0, 7);
      const arr = byMonth.get(k);
      if (arr) arr.push(d);
      else byMonth.set(k, [d]);
    });
    const sortedKeys = Array.from(byMonth.keys()).sort();
    const monthsArr: MonthBucket[] = sortedKeys.map((key) => {
      const list = byMonth.get(key)!;
      return {
        key,
        year: parseInt(key.slice(0, 4), 10),
        month: parseInt(key.slice(5, 7), 10) - 1,
        days: list,
        active: list.filter((d) => d.sessions > 0).length,
      };
    });
    const total = days.filter((d) => d.sessions > 0).length;
    return { months: monthsArr, totalActive: total };
  }, [days]);

  const [index, setIndex] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const initRef = useRef(false);

  // When the modal opens, jump to the most recent month (last bucket).
  // The flag guards against re-jumping when the user navigates while open.
  useEffect(() => {
    if (!visible) {
      initRef.current = false;
      return;
    }
    if (initRef.current || pageWidth === 0 || months.length === 0) return;
    initRef.current = true;
    const target = months.length - 1;
    setIndex(target);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: target * pageWidth, animated: false });
    });
  }, [visible, pageWidth, months.length]);

  function gotoIndex(i: number) {
    const clamped = Math.max(0, Math.min(months.length - 1, i));
    if (clamped === index) return;
    setIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * pageWidth, animated: true });
  }

  const current = months[index];
  const atStart = index === 0;
  const atEnd = index === months.length - 1;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>Atividade · 12 meses</Text>
            <Text style={styles.modalSubtitle}>
              {totalActive} {totalActive === 1 ? "dia ativo" : "dias ativos"} no total
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={styles.modalCloseBtn}>
            <X size={24} color={palette.neutral[700]} weight="bold" />
          </Pressable>
        </View>

        <View style={styles.monthNavRow}>
          <Pressable
            onPress={() => gotoIndex(index - 1)}
            disabled={atStart}
            hitSlop={12}
            style={[styles.monthNavBtn, atStart ? styles.monthNavBtnDisabled : null]}
          >
            <CaretLeft
              size={20}
              color={atStart ? palette.neutral[300] : palette.neutral[700]}
              weight="bold"
            />
          </Pressable>
          <View style={styles.monthNavCenter}>
            <Text style={styles.monthNavMonth}>
              {current ? MONTH_NAMES_FULL_PT[current.month] : ""}
            </Text>
            <Text style={styles.monthNavYear}>{current?.year ?? ""}</Text>
          </View>
          <Pressable
            onPress={() => gotoIndex(index + 1)}
            disabled={atEnd}
            hitSlop={12}
            style={[styles.monthNavBtn, atEnd ? styles.monthNavBtnDisabled : null]}
          >
            <CaretRight
              size={20}
              color={atEnd ? palette.neutral[300] : palette.neutral[700]}
              weight="bold"
            />
          </Pressable>
        </View>

        <View
          style={styles.pagerWrap}
          onLayout={(e) => setPageWidth(e.nativeEvent.layout.width)}
        >
          {pageWidth > 0 ? (
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const i = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
                if (i !== index) setIndex(i);
              }}
            >
              {months.map((m) => (
                <View key={m.key} style={{ width: pageWidth }}>
                  <MonthCalendar month={m} />
                </View>
              ))}
            </ScrollView>
          ) : null}
        </View>

        <View style={styles.modalLegend}>
          <Text style={styles.heatmapLegendText}>menos</Text>
          {[0, 1, 2, 3].map((n) => (
            <View
              key={n}
              style={[styles.heatmapLegendCell, { backgroundColor: heatmapColor(n) }]}
            />
          ))}
          <Text style={styles.heatmapLegendText}>mais</Text>
        </View>
      </View>
    </Modal>
  );
}

function MonthCalendar({ month }: { month: MonthBucket }) {
  const rows = useMemo(() => {
    const firstDate = new Date(month.year, month.month, 1);
    const jsDow = firstDate.getDay();
    const isoDow = (jsDow + 6) % 7;
    const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();

    const map = new Map<number, number>();
    month.days.forEach((d) => {
      const day = parseInt(d.date.slice(8, 10), 10);
      map.set(day, d.sessions);
    });

    type Cell = { day: number | null; sessions: number; hasData: boolean };
    const cells: Cell[] = [];
    for (let i = 0; i < isoDow; i++) {
      cells.push({ day: null, sessions: 0, hasData: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const sessions = map.get(d);
      cells.push({
        day: d,
        sessions: sessions ?? 0,
        hasData: sessions !== undefined,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: null, sessions: 0, hasData: false });
    }
    const rowsArr: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rowsArr.push(cells.slice(i, i + 7));
    }
    return rowsArr;
  }, [month]);

  const now = new Date();
  const todayDay =
    month.year === now.getFullYear() && month.month === now.getMonth()
      ? now.getDate()
      : -1;

  return (
    <View style={styles.calRoot}>
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
            {row.map((c, ci) => (
              <View key={ci} style={styles.calCellWrap}>
                {c.day !== null ? (
                  <View
                    style={[
                      styles.calCell,
                      {
                        backgroundColor: c.hasData
                          ? heatmapColor(c.sessions)
                          : palette.neutral[50],
                      },
                      c.day === todayDay ? styles.calCellToday : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.calCellNum,
                        {
                          color:
                            c.sessions > 0
                              ? palette.white
                              : c.hasData
                                ? palette.neutral[500]
                                : palette.neutral[400],
                        },
                      ]}
                    >
                      {c.day}
                    </Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ))}
      </View>

      <Text style={styles.calFootnote}>
        {month.active} {month.active === 1 ? "dia ativo" : "dias ativos"} neste mês
      </Text>
    </View>
  );
}

function NameEditModal({
  visible,
  value,
  onChangeValue,
  onSave,
  onCancel,
}: {
  visible: boolean;
  value: string;
  onChangeValue: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.nameModalBackdrop} onPress={onCancel}>
        <Pressable style={styles.nameModalCard} onPress={() => { /* swallow */ }}>
          <Text style={styles.nameModalTitle}>Como te chamas?</Text>
          <TextInput
            value={value}
            onChangeText={onChangeValue}
            autoFocus
            maxLength={32}
            placeholder="O teu nome"
            placeholderTextColor={palette.neutral[400]}
            style={styles.nameModalInput}
            returnKeyType="done"
            onSubmitEditing={onSave}
          />
          <View style={styles.nameModalActions}>
            <Pressable onPress={onCancel} hitSlop={8} style={styles.nameModalCancel}>
              <Text style={styles.nameModalCancelText}>Cancelar</Text>
            </Pressable>
            <DuoButton title="GUARDAR" onPress={onSave} fullWidth={false} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  closeRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
  errorText: { ...t.body, color: colors.danger, textAlign: "center" },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
  },

  greetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  greetLine: {
    flexShrink: 1,
  },
  greetHello: {
    fontFamily: fonts.bold,
    fontSize: 36,
    lineHeight: 42,
    color: colors.text,
  },
  greetName: {
    fontFamily: fonts.black,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.5,
    color: colors.text,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
    letterSpacing: 0.4,
    color: palette.neutral[500],
    textTransform: "uppercase",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitleInline: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
    letterSpacing: 0.4,
    color: palette.neutral[500],
    textTransform: "uppercase",
  },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  linkText: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    color: palette.primary[600],
  },

  streakCard: {
    backgroundColor: palette.primary[50],
    borderColor: palette.primary[200],
    borderWidth: 1,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  streakCardMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  streakCardNumber: {
    fontFamily: fonts.black,
    fontSize: 52,
    lineHeight: 56,
    letterSpacing: -1.5,
    fontVariant: ["tabular-nums"],
  },
  streakCardSpacer: { flex: 1 },
  streakCardRecord: {
    alignItems: "flex-end",
  },
  streakCardRecordLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    color: palette.primary[600],
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  streakCardRecordValue: {
    fontFamily: fonts.black,
    fontSize: 22,
    lineHeight: 26,
    color: palette.primary[700],
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  weekStripRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  weekStripCol: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  weekStripWeekday: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.6,
    color: palette.neutral[400],
    textTransform: "uppercase",
  },
  weekStripCell: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  weekStripNum: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
  },

  statsFlatGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xl,
    columnGap: spacing.md,
  },
  statFlatCell: {
    flexBasis: "47%",
    flexGrow: 1,
    gap: 4,
  },
  statFlatIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statFlatLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: palette.neutral[500],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statFlatValue: {
    fontFamily: fonts.black,
    fontSize: 30,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  fillerInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  fillerInlineText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: palette.neutral[600],
  },
  fillerStrong: { fontFamily: fonts.extrabold, color: colors.text },

  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  chartLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: palette.neutral[500],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    height: 120,
  },
  chartBarWrap: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  chartBarTrack: {
    width: "100%",
    height: 96,
    backgroundColor: palette.neutral[100],
    borderRadius: 4,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  chartBarFill: {
    width: "100%",
    backgroundColor: palette.primary[500],
    borderRadius: 4,
  },
  chartBarLabel: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    color: palette.neutral[500],
  },

  achievementsSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.primary[200],
    backgroundColor: palette.primary[50],
  },
  achievementsSummaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primary[100],
  },
  achievementsSummaryText: {
    flex: 1,
  },
  achievementsSummaryCount: {
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 30,
    color: palette.primary[700],
    fontVariant: ["tabular-nums"],
  },
  achievementsSummaryCountTotal: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: palette.neutral[400],
  },
  achievementsSummaryLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: palette.neutral[600],
    marginTop: 2,
  },
  achievementsSummaryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  achievementsModalContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.huge,
  },
  achievementsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  achievementCard: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: palette.white,
    borderColor: palette.primary[200],
    borderWidth: 1,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  achievementInner: {
    padding: spacing.md,
    gap: 4,
  },
  achievementCardLocked: {
    backgroundColor: palette.neutral[50],
    borderColor: palette.neutral[200],
  },
  achievementLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    color: colors.text,
    marginTop: 4,
  },
  achievementLabelLocked: { color: palette.neutral[500] },
  achievementDesc: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    color: palette.neutral[600],
  },
  achievementDescLocked: { color: palette.neutral[400] },

  modalRoot: {
    flex: 1,
    backgroundColor: palette.white,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  modalTitle: {
    fontFamily: fonts.black,
    fontSize: 22,
    color: colors.text,
  },
  modalSubtitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: palette.neutral[500],
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.neutral[100],
  },
  monthNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  monthNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.neutral[100],
  },
  monthNavBtnDisabled: {
    backgroundColor: palette.neutral[50],
  },
  monthNavCenter: {
    flex: 1,
    alignItems: "center",
  },
  monthNavMonth: {
    fontFamily: fonts.black,
    fontSize: 18,
    color: colors.text,
    textTransform: "capitalize",
  },
  monthNavYear: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: palette.neutral[500],
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  pagerWrap: {
    flex: 1,
  },
  calRoot: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
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
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  calCellToday: {
    borderWidth: 2,
    borderColor: palette.primary[700],
  },
  calCellNum: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  calFootnote: {
    marginTop: spacing.xl,
    textAlign: "center",
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: palette.neutral[500],
  },
  modalLegend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  heatmapLegendText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: palette.neutral[500],
  },
  heatmapLegendCell: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },

  nameModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  nameModalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: palette.white,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  nameModalTitle: {
    fontFamily: fonts.black,
    fontSize: 20,
    color: colors.text,
  },
  nameModalInput: {
    backgroundColor: palette.neutral[50],
    borderWidth: 1,
    borderColor: palette.neutral[200],
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.text,
  },
  nameModalActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  nameModalCancel: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  nameModalCancelText: {
    fontFamily: fonts.extrabold,
    fontSize: 14,
    color: palette.neutral[500],
  },
});
