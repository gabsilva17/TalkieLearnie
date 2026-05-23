import { useFocusEffect } from "expo-router";
import {
  CaretRightIcon as CaretRight,
  CheckCircleIcon as CheckCircle,
  CircleIcon as Circle,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import { DuoButton } from "@/components/ui/DuoButton";
import { Screen } from "@/components/ui/Screen";
import {
  Profile,
  ProfileAchievement,
  ProfileActivityPoint,
  api,
  cacheKeys,
  setCached,
  useCached,
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

const MONTH_NAMES_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
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

export default function ProfileScreen() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const profile = useCached<Profile>(deviceId ? cacheKeys.profile(deviceId) : null);
  const [name, setName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
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
      setCached(cacheKeys.profile(deviceId), p, { persist: true });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // First mount: deviceId resolves async, so the focus-effect run above bails.
  // Trigger load() once deviceId lands.
  useEffect(() => {
    if (deviceId) load();
  }, [deviceId, load]);

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

  if (loading) {
    return (
      <Screen>
        <Animated.View entering={FadeIn.duration(220)} style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </Animated.View>
      </Screen>
    );
  }

  if (error && !profile) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <DuoButton title="TENTAR DE NOVO" onPress={load} fullWidth={false} />
        </View>
      </Screen>
    );
  }

  if (!profile) return null;

  const last7 = profile.activity_365.slice(-7);

  return (
    <Screen
      scroll
      onRefresh={load}
      contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing.huge }}
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
          activeToday={profile.streak_active_today}
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
        <WeekStrip days={last7} onExpand={() => setHeatmapOpen(true)} />
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

      <HeatmapModal
        visible={heatmapOpen}
        days={profile.activity_365}
        onClose={() => setHeatmapOpen(false)}
      />

      <NameEditModal
        visible={nameEditOpen}
        value={draftName}
        onChangeValue={setDraftName}
        onSave={saveName}
        onCancel={() => setNameEditOpen(false)}
      />
    </Screen>
  );
}

function StreakInline({
  current,
  best,
  activeToday,
}: {
  current: number;
  best: number;
  activeToday: boolean;
}) {
  const lit = current > 0;
  const flameColor = lit ? palette.primary[600] : palette.neutral[400];
  const numberColor = lit ? palette.primary[700] : palette.neutral[600];
  return (
    <View style={styles.streakCard}>
      <View style={styles.streakCardMain}>
        <Flame size={48} color={flameColor} weight={lit ? "fill" : "bold"} />
        <Text style={[styles.streakCardNumber, { color: numberColor }]}>
          {current}
        </Text>
        <View style={styles.streakCardSpacer} />
        <View style={styles.streakCardRecord}>
          <Text style={styles.streakCardRecordLabel}>Recorde</Text>
          <Text style={styles.streakCardRecordValue}>{best}</Text>
        </View>
      </View>
      <View style={styles.streakCardBadgeRow}>
        {activeToday ? (
          <CheckCircle
            size={14}
            color={palette.primary[600]}
            weight="fill"
          />
        ) : (
          <Circle size={14} color={palette.neutral[400]} weight="bold" />
        )}
        <Text
          style={[
            styles.streakCardBadgeText,
            {
              color: activeToday ? palette.primary[700] : palette.neutral[500],
            },
          ]}
        >
          {activeToday ? "Treinaste hoje" : "Ainda não hoje"}
        </Text>
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

function StatsFlat({ profile }: { profile: Profile }) {
  const tiles: { icon: Icon; label: string; value: string }[] = [
    {
      icon: Microphone,
      label: "Sessões",
      value: String(profile.total_sessions),
    },
    {
      icon: Clock,
      label: "Minutos",
      value: profile.total_minutes.toFixed(1),
    },
    {
      icon: Gauge,
      label: "WPM médio",
      value: profile.avg_wpm == null ? "-" : profile.avg_wpm.toFixed(0),
    },
    {
      icon: Trophy,
      label: "Melhor nota",
      value: profile.best_rating == null ? "-" : `${profile.best_rating}/10`,
    },
  ];
  return (
    <View>
      <View style={styles.statsFlatGrid}>
        {tiles.map((tile) => {
          const TileIcon = tile.icon;
          return (
            <View key={tile.label} style={styles.statFlatCell}>
              <View style={styles.statFlatIconRow}>
                <TileIcon size={16} color={palette.primary[600]} weight="bold" />
                <Text style={styles.statFlatLabel}>{tile.label}</Text>
              </View>
              <Text style={styles.statFlatValue}>{tile.value}</Text>
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
        {points.map((p) => {
          const norm = (p.value - min) / span;
          const heightPct = 25 + Math.round(norm * 70);
          return (
            <View key={p.date} style={styles.chartBarWrap}>
              <View style={styles.chartBarTrack}>
                <View
                  style={[
                    styles.chartBarFill,
                    { height: `${heightPct}%` },
                  ]}
                />
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

function Achievements({ list }: { list: ProfileAchievement[] }) {
  const sorted = [...list].sort((a, b) => Number(b.earned) - Number(a.earned));
  const earnedCount = list.filter((a) => a.earned).length;
  return (
    <View>
      <Text style={styles.achievementsCount}>
        {earnedCount} de {list.length} desbloqueadas
      </Text>
      <View style={styles.achievementsGrid}>
        {sorted.map((a) => (
          <View
            key={a.id}
            style={[
              styles.achievementCard,
              !a.earned ? styles.achievementCardLocked : null,
            ]}
          >
            {a.earned ? (
              <Trophy size={20} color={palette.primary[600]} weight="fill" />
            ) : (
              <Lock size={20} color={palette.neutral[400]} weight="bold" />
            )}
            <Text
              style={[
                styles.achievementLabel,
                !a.earned ? styles.achievementLabelLocked : null,
              ]}
            >
              {a.label}
            </Text>
            <Text
              style={[
                styles.achievementDesc,
                !a.earned ? styles.achievementDescLocked : null,
              ]}
            >
              {a.description}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function HeatmapModal({
  visible,
  days,
  onClose,
}: {
  visible: boolean;
  days: ProfileActivityPoint[];
  onClose: () => void;
}) {
  const { weeks, monthLabels, totalActive } = useMemo(() => {
    if (days.length === 0) {
      return { weeks: [] as ProfileActivityPoint[][], monthLabels: [] as { col: number; label: string }[], totalActive: 0 };
    }
    // Align to weeks starting Monday. Pad the front so the first column is a full week.
    const first = new Date(days[0].date + "T00:00:00");
    const jsDow = first.getDay(); // 0 = sun .. 6 = sat
    const isoDow = (jsDow + 6) % 7; // 0 = mon .. 6 = sun
    const padFront: ProfileActivityPoint[] = Array.from({ length: isoDow }).map(
      (_, i) => ({ date: `pad-front-${i}`, sessions: -1 }),
    );
    const all = [...padFront, ...days];
    while (all.length % 7 !== 0) {
      all.push({ date: `pad-back-${all.length}`, sessions: -1 });
    }
    const weeksArr: ProfileActivityPoint[][] = [];
    for (let i = 0; i < all.length; i += 7) {
      weeksArr.push(all.slice(i, i + 7));
    }
    // Month labels: place a label on the column where a new month appears.
    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    weeksArr.forEach((wk, ci) => {
      const realCell = wk.find((c) => c.sessions !== -1);
      if (!realCell) return;
      const m = parseInt(realCell.date.slice(5, 7), 10) - 1;
      if (m !== lastMonth) {
        labels.push({ col: ci, label: MONTH_NAMES_PT[m] });
        lastMonth = m;
      }
    });
    const active = days.filter((d) => d.sessions > 0).length;
    return { weeks: weeksArr, monthLabels: labels, totalActive: active };
  }, [days]);

  const CELL = 12;
  const GAP = 3;
  const WEEK_W = CELL + GAP;

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
              {totalActive} {totalActive === 1 ? "dia ativo" : "dias ativos"}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={styles.modalCloseBtn}>
            <X size={24} color={palette.neutral[700]} weight="bold" />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.modalScrollContent}
        >
          <View>
            <View
              style={[
                styles.monthLabelRow,
                {
                  marginLeft: 20,
                  width: weeks.length * WEEK_W,
                },
              ]}
            >
              {monthLabels.map((m) => (
                <Text
                  key={`${m.col}-${m.label}`}
                  style={[
                    styles.monthLabel,
                    {
                      position: "absolute",
                      top: 0,
                      left: m.col * WEEK_W,
                      width: WEEK_W * 4,
                    },
                  ]}
                >
                  {m.label}
                </Text>
              ))}
            </View>

            <View style={{ flexDirection: "row" }}>
              <View style={styles.weekdayCol}>
                {WEEKDAY_NAMES_PT.map((w, i) => (
                  <Text
                    key={`${w}-${i}`}
                    style={[
                      styles.weekdayLabel,
                      { height: CELL, lineHeight: CELL, marginBottom: GAP },
                      i % 2 === 1 ? null : { opacity: 0 },
                    ]}
                  >
                    {w}
                  </Text>
                ))}
              </View>

              <View style={{ flexDirection: "row", gap: GAP }}>
                {weeks.map((wk, ci) => (
                  <View key={ci} style={{ gap: GAP }}>
                    {wk.map((c, ri) => (
                      <View
                        key={`${ci}-${ri}`}
                        style={{
                          width: CELL,
                          height: CELL,
                          borderRadius: 3,
                          backgroundColor:
                            c.sessions === -1
                              ? "transparent"
                              : heatmapColor(c.sessions),
                        }}
                      />
                    ))}
                  </View>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>

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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
  errorText: { ...t.body, color: colors.danger, textAlign: "center" },

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
  streakCardBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
  },
  streakCardBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 12,
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

  achievementsCount: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: palette.neutral[500],
    marginBottom: spacing.md,
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
  modalScrollContent: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  monthLabelRow: {
    height: 16,
    marginBottom: 4,
    position: "relative",
  },
  monthLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.4,
    color: palette.neutral[500],
    textTransform: "uppercase",
  },
  weekdayCol: {
    width: 18,
    marginRight: 2,
  },
  weekdayLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 9,
    color: palette.neutral[400],
    textAlign: "center",
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
