import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import {
  CaretRightIcon as CaretRight,
  CheckIcon as Check,
  PencilSimpleIcon as PencilSimple,
  TrashIcon as Trash,
} from "phosphor-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { DuoButton } from "@/components/ui/DuoButton";
import { LogoMark } from "@/components/ui/LogoMark";
import { PressableScale } from "@/components/ui/PressableScale";
import { Screen } from "@/components/ui/Screen";
import { TopBar } from "@/components/ui/TopBar";
import { Plan, api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { useT } from "@/lib/i18n";
import { clearLastPlanId, setLastPlanId } from "@/lib/lastPlan";
import {
  colors,
  fonts,
  hairline,
  palette,
  radii,
  spacing,
  type as t,
} from "@/lib/theme";

function daysUntil(iso: string): number {
  const target = new Date(iso + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

function ArchiveToggle({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t: tr } = useT();
  const rot = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    rot.value = withTiming(open ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.quad),
    });
  }, [open, rot]);
  const caretStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value * 90}deg` }],
  }));
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.archiveToggle,
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Animated.View style={caretStyle}>
        <CaretRight size={14} color={palette.neutral[500]} weight="bold" />
      </Animated.View>
      <Text style={styles.archiveToggleText}>
        {tr("plans.archived_label", { count })}
      </Text>
    </Pressable>
  );
}

function PlanIndicator({
  completed,
  total,
  isComplete,
}: {
  completed: number;
  total: number;
  isComplete: boolean;
}) {
  return (
    <View
      style={[
        styles.indicator,
        isComplete ? styles.indicatorDone : null,
      ]}
    >
      {isComplete ? (
        <Check size={16} color={palette.white} weight="bold" />
      ) : (
        <Text style={styles.indicatorText}>
          {completed}
          <Text style={styles.indicatorTextDim}>/{total}</Text>
        </Text>
      )}
    </View>
  );
}

export default function PlansHomeScreen() {
  const router = useRouter();
  const { t: tr } = useT();
  const [deviceId, setDeviceId] = useState<string | null>(null);

  function formatTargetLabel(iso: string): string {
    const diff = daysUntil(iso);
    if (diff < 0) return tr("plans.target_done");
    if (diff === 0) return tr("plans.target_today");
    if (diff === 1) return tr("plans.target_tomorrow");
    return tr("plans.target_in_days", { count: diff });
  }

  useEffect(() => {
    getDeviceId().then(setDeviceId).catch(() => {});
  }, []);

  const [plans, setPlans] = useState<Plan[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [actionPlan, setActionPlan] = useState<Plan | null>(null);
  const [renamePlan, setRenamePlan] = useState<Plan | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  // Archived plans live behind a collapsed accordion so completed work is
  // visually quiet by default. Default collapsed: the home should always lead
  // with what still needs training.
  const [archiveOpen, setArchiveOpen] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setError(null);
    try {
      const list = await api.getPlans(deviceId);
      setPlans(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // useFocusEffect only fires on focus events. On the very first mount,
  // deviceId is still resolving — once it lands, kick off load() ourselves.
  useEffect(() => {
    if (deviceId) load();
  }, [deviceId, load]);

  // Only render the spinner when we have nothing to show. After the first
  // populated render, focus refetches happen silently in the background.
  const loading = plans === undefined;

  const enterPlan = useCallback(
    (planId: string) => {
      setLastPlanId(planId).catch(() => {});
      router.push(`/plan/${planId}`);
    },
    [router],
  );

  const openActions = useCallback((plan: Plan) => {
    setActionPlan(plan);
  }, []);

  const closeActions = useCallback(() => {
    setActionPlan(null);
  }, []);

  const startRename = useCallback(() => {
    if (!actionPlan) return;
    setRenameValue(actionPlan.name ?? actionPlan.prep_for);
    setRenamePlan(actionPlan);
    setActionPlan(null);
  }, [actionPlan]);

  const cancelRename = useCallback(() => {
    setRenamePlan(null);
    setRenameValue("");
  }, []);

  const submitRename = useCallback(async () => {
    if (!renamePlan) return;
    const trimmed = renameValue.trim();
    const current = renamePlan.name ?? renamePlan.prep_for;
    if (!trimmed || trimmed === current) {
      cancelRename();
      return;
    }
    setRenaming(true);
    try {
      const id = await getDeviceId();
      const updated = await api.renamePlan(renamePlan.id, id, trimmed);
      setPlans((prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev,
      );
      cancelRename();
    } catch (e) {
      Alert.alert(tr("common.error"), (e as Error).message);
    } finally {
      setRenaming(false);
    }
  }, [renamePlan, renameValue, cancelRename, tr]);

  const startDelete = useCallback(() => {
    if (!actionPlan) return;
    const plan = actionPlan;
    setActionPlan(null);
    Alert.alert(
      tr("plans.delete_confirm_title"),
      tr("plans.delete_confirm_body", { name: plan.name ?? plan.prep_for }),
      [
        { text: tr("common.cancel"), style: "cancel" },
        {
          text: tr("common.delete_caps"),
          style: "destructive",
          onPress: async () => {
            setBusyId(plan.id);
            try {
              const id = await getDeviceId();
              await api.deletePlan(plan.id, id);
              setPlans((prev) =>
                prev ? prev.filter((p) => p.id !== plan.id) : prev,
              );
              await clearLastPlanId();
            } catch (e) {
              Alert.alert(tr("common.error"), (e as Error).message);
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }, [actionPlan, tr]);

  if (error && !plans) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <TopBar title={tr("plans.title")} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <DuoButton title={tr("common.retry_caps")} onPress={load} fullWidth={false} />
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <TopBar title={tr("plans.title")} />
        <Animated.View entering={FadeIn.duration(220)} style={styles.center}>
          <LogoMark size="lg" />
        </Animated.View>
      </SafeAreaView>
    );
  }

  const list = plans ?? [];
  // A plan is "archived" once every day is done. Empty-day plans count as
  // active (they're brand new and the user hasn't even seen the rail yet).
  const isArchivedPlan = (p: Plan) =>
    p.days.length > 0 && p.days.every((d) => d.completed_at);
  const activePlans = list.filter((p) => !isArchivedPlan(p));
  const archivedPlans = list.filter(isArchivedPlan);

  const renderPlanCard = (p: Plan, i: number, variant: "active" | "archived") => {
    const completed = p.days.filter((d) => d.completed_at).length;
    const total = p.days.length;
    const isComplete = total > 0 && completed === total;
    const isBusy = busyId === p.id;
    const archived = variant === "archived";
    return (
      <Animated.View
        key={p.id}
        entering={FadeInDown.duration(220).delay(i * 40)}
      >
        <PressableScale
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            enterPlan(p.id);
          }}
          onLongPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
              () => {},
            );
            openActions(p);
          }}
          delayLongPress={350}
          disabled={isBusy}
          style={({ pressed }) => [
            styles.card,
            archived ? styles.cardArchived : null,
            pressed ? styles.cardPressed : null,
            isBusy ? { opacity: 0.4 } : null,
          ]}
        >
          <PlanIndicator
            completed={completed}
            total={total}
            isComplete={isComplete}
          />

          <View style={styles.cardContent}>
            <Text
              style={[
                styles.cardEyebrow,
                archived ? styles.cardEyebrowArchived : null,
              ]}
            >
              {archived
                ? tr("plans.eyebrow_archived")
                : formatTargetLabel(p.target_date)}
            </Text>
            <Text
              style={[
                styles.cardTitle,
                archived ? styles.cardTitleArchived : null,
              ]}
              numberOfLines={2}
            >
              {p.name ?? p.prep_for}
            </Text>
          </View>

          {isBusy ? (
            <ActivityIndicator
              color={palette.neutral[400]}
              size="small"
              style={styles.trailingIcon}
            />
          ) : (
            <CaretRight
              size={20}
              color={archived ? palette.neutral[300] : palette.neutral[400]}
              weight="bold"
              style={styles.trailingIcon}
            />
          )}
        </PressableScale>
      </Animated.View>
    );
  };

  const subtitle =
    activePlans.length > 0
      ? activePlans.length === 1
        ? tr("plans.subtitle_one")
        : tr("plans.subtitle_many", { count: activePlans.length })
      : list.length > 0
        ? tr("plans.subtitle_all_done")
        : tr("plans.subtitle_first_time");

  return (
    <>
      <Screen
        scroll
        onRefresh={load}
        header={<TopBar title={tr("plans.title")} subtitle={subtitle} />}
        reserveBottomNav
        contentStyle={{
          paddingTop: spacing.md,
        }}
      >
        {activePlans.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.empty}>
              {list.length === 0 ? (
                <Text style={styles.emptyTitle}>
                  {tr("plans.empty_title_first")}{" "}
                  <Text style={styles.emptyTitleAccent}>
                    {tr("plans.empty_title_first_accent")}
                  </Text>
                </Text>
              ) : (
                <Text style={styles.emptyTitle}>{tr("plans.empty_title_after")}</Text>
              )}
              <Text style={styles.emptyBody}>
                {list.length === 0
                  ? tr("plans.empty_body_first")
                  : tr("plans.empty_body_after")}
              </Text>
              {list.length === 0 ? (
                <View style={styles.featureList}>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureNum}>01</Text>
                    <Text style={styles.featureLabel}>{tr("plans.feature_1")}</Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureNum}>02</Text>
                    <Text style={styles.featureLabel}>{tr("plans.feature_2")}</Text>
                  </View>
                  <View style={styles.featureItem}>
                    <Text style={styles.featureNum}>03</Text>
                    <Text style={styles.featureLabel}>{tr("plans.feature_3")}</Text>
                  </View>
                </View>
              ) : null}
              <View style={styles.emptyCta}>
                <DuoButton
                  title={tr("plans.new_plan_caps")}
                  onPress={() => router.push("/onboarding")}
                />
              </View>
            </View>
            {archivedPlans.length > 0 ? (
              <View style={styles.archiveSection}>
                <ArchiveToggle
                  count={archivedPlans.length}
                  open={archiveOpen}
                  onToggle={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setArchiveOpen((v) => !v);
                  }}
                />
                {archiveOpen ? (
                  <Animated.View
                    entering={FadeIn.duration(220)}
                    style={styles.archiveList}
                  >
                    {archivedPlans.map((p, i) =>
                      renderPlanCard(p, i, "archived"),
                    )}
                  </Animated.View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.list}>
              {activePlans.map((p, i) => renderPlanCard(p, i, "active"))}
            </View>
            <View style={styles.ctaWrap}>
              <DuoButton
                title={tr("plans.new_plan_caps")}
                onPress={() => router.push("/onboarding")}
              />
            </View>
            {archivedPlans.length > 0 ? (
              <View style={styles.archiveSection}>
                <ArchiveToggle
                  count={archivedPlans.length}
                  open={archiveOpen}
                  onToggle={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setArchiveOpen((v) => !v);
                  }}
                />
                {archiveOpen ? (
                  <Animated.View
                    entering={FadeIn.duration(220)}
                    style={styles.archiveList}
                  >
                    {archivedPlans.map((p, i) =>
                      renderPlanCard(p, i, "archived"),
                    )}
                  </Animated.View>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </Screen>

      <Modal
        visible={actionPlan !== null}
        transparent
        animationType="fade"
        onRequestClose={closeActions}
      >
        <Pressable style={styles.backdrop} onPress={closeActions}>
          <Pressable
            style={styles.sheet}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.sheetEyebrow}>{tr("plans.sheet_eyebrow_plan")}</Text>
            <Text style={styles.sheetTitle} numberOfLines={2}>
              {actionPlan ? (actionPlan.name ?? actionPlan.prep_for) : ""}
            </Text>

            <Pressable
              onPress={startRename}
              style={({ pressed }) => [
                styles.sheetAction,
                pressed ? styles.sheetActionPressed : null,
              ]}
            >
              <PencilSimple
                size={20}
                color={palette.primary[600]}
                weight="bold"
              />
              <Text style={styles.sheetActionText}>{tr("plans.sheet_action_rename")}</Text>
            </Pressable>

            <Pressable
              onPress={startDelete}
              style={({ pressed }) => [
                styles.sheetAction,
                pressed ? styles.sheetActionPressed : null,
              ]}
            >
              <Trash
                size={20}
                color={colors.danger}
                weight="bold"
              />
              <Text style={[styles.sheetActionText, styles.sheetActionDanger]}>
                {tr("plans.sheet_action_delete")}
              </Text>
            </Pressable>

            <Pressable
              onPress={closeActions}
              style={({ pressed }) => [
                styles.sheetCancel,
                pressed ? { opacity: 0.6 } : null,
              ]}
            >
              <Text style={styles.sheetCancelText}>{tr("common.cancel_caps")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={renamePlan !== null}
        transparent
        animationType="fade"
        onRequestClose={cancelRename}
      >
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.backdropFill} onPress={cancelRename} />
          <View style={styles.sheet}>
            <Text style={styles.sheetEyebrow}>{tr("plans.rename_eyebrow")}</Text>
            <Text style={styles.sheetTitle}>{tr("plans.rename_title")}</Text>

            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              multiline
              maxLength={200}
              placeholder={tr("plans.rename_placeholder")}
              placeholderTextColor={palette.neutral[400]}
              style={styles.renameInput}
              editable={!renaming}
            />

            <View style={styles.renameActions}>
              <Pressable
                onPress={cancelRename}
                disabled={renaming}
                style={({ pressed }) => [
                  styles.sheetCancel,
                  styles.renameCancel,
                  pressed ? { opacity: 0.6 } : null,
                ]}
              >
                <Text style={styles.sheetCancelText}>{tr("common.cancel_caps")}</Text>
              </Pressable>
              <DuoButton
                title={renaming ? tr("common.saving_caps") : tr("common.save_caps")}
                onPress={submitRename}
                disabled={renaming || !renameValue.trim()}
                fullWidth={false}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
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
  emptyWrap: {
    flexGrow: 1,
    justifyContent: "center",
  },
  empty: {
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontFamily: fonts.black,
    fontSize: 32,
    lineHeight: 38,
    color: colors.text,
    textAlign: "center",
  },
  emptyTitleAccent: {
    color: palette.primary[600],
  },
  emptyBody: {
    ...t.bodyMuted,
    textAlign: "center",
    maxWidth: 300,
    marginTop: spacing.xs,
  },
  featureList: {
    alignSelf: "stretch",
    marginTop: spacing.xxl,
    borderTopWidth: hairline,
    borderTopColor: palette.neutral[200],
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
    borderBottomColor: palette.neutral[200],
  },
  featureNum: {
    fontFamily: fonts.black,
    fontSize: 18,
    lineHeight: 22,
    color: palette.primary[500],
    fontVariant: ["tabular-nums"],
    width: 32,
  },
  featureLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    flex: 1,
  },
  emptyCta: {
    marginTop: spacing.xl,
    alignSelf: "stretch",
  },
  list: {
    gap: spacing.md,
  },
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
  cardPressed: {
    opacity: 0.85,
  },
  indicator: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.white,
    borderWidth: 2,
    borderColor: palette.primary[500],
  },
  indicatorDone: {
    backgroundColor: palette.primary[500],
    borderColor: palette.primary[500],
  },
  indicatorText: {
    fontFamily: fonts.extrabold,
    fontSize: 12,
    color: palette.primary[600],
    fontVariant: ["tabular-nums"],
  },
  indicatorTextDim: {
    fontFamily: fonts.extrabold,
    color: palette.neutral[400],
  },
  cardContent: {
    flex: 1,
    justifyContent: "center",
  },
  cardEyebrow: {
    ...t.eyebrow,
    marginBottom: 4,
  },
  cardTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 22,
    color: colors.text,
  },
  trailingIcon: {
    marginLeft: spacing.xs,
  },
  ctaWrap: {
    paddingTop: spacing.huge,
  },
  cardArchived: {
    backgroundColor: palette.neutral[50],
    borderColor: palette.neutral[100],
  },
  cardEyebrowArchived: {
    color: palette.neutral[400],
  },
  cardTitleArchived: {
    color: palette.neutral[500],
  },
  archiveSection: {
    marginTop: spacing.xl,
  },
  archiveToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    alignSelf: "flex-start",
  },
  archiveToggleText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: palette.neutral[500],
  },
  archiveList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: palette.white,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  sheetEyebrow: {
    ...t.eyebrow,
  },
  sheetTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sheetAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.neutral[50],
  },
  sheetActionPressed: {
    backgroundColor: palette.neutral[100],
  },
  sheetActionText: {
    fontFamily: fonts.extrabold,
    fontSize: 15,
    color: colors.text,
  },
  sheetActionDanger: {
    color: colors.danger,
  },
  sheetCancel: {
    alignItems: "center",
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  sheetCancelText: {
    fontFamily: fonts.extrabold,
    fontSize: 12,
    letterSpacing: 1.8,
    color: palette.neutral[500],
  },
  renameInput: {
    minHeight: 80,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: palette.neutral[200],
    borderRadius: radii.md,
    padding: spacing.md,
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    backgroundColor: palette.neutral[50],
    textAlignVertical: "top",
  },
  renameActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  renameCancel: {
    marginTop: 0,
    paddingHorizontal: spacing.md,
  },
});
