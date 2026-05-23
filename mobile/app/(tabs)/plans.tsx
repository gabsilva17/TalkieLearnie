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
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { DuoButton } from "@/components/ui/DuoButton";
import { LogoMark } from "@/components/ui/LogoMark";
import { Screen } from "@/components/ui/Screen";
import {
  Plan,
  api,
  cacheKeys,
  getCached,
  setCached,
  useCached,
} from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { clearLastPlanId, setLastPlanId } from "@/lib/lastPlan";
import {
  colors,
  fonts,
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

function formatTargetLabel(iso: string): string {
  const diff = daysUntil(iso);
  if (diff < 0) return "concluído";
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return `em ${diff} dias`;
}

export default function PlansHomeScreen() {
  const router = useRouter();
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    getDeviceId().then(setDeviceId).catch(() => {});
  }, []);

  // Cache is the source of truth: mutations everywhere (this screen, the
  // detail screen, submitSession) write through it. We subscribe via useCached
  // so the list re-renders for free.
  const cacheKey = deviceId ? cacheKeys.plans(deviceId) : null;
  const plans = useCached<Plan[]>(cacheKey);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [actionPlan, setActionPlan] = useState<Plan | null>(null);
  const [renamePlan, setRenamePlan] = useState<Plan | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setError(null);
    try {
      const list = await api.getPlans(deviceId);
      setCached(cacheKeys.plans(deviceId), list, { persist: true });
      // Pre-warm detail caches so tapping a card never shows a spinner.
      for (const p of list) {
        setCached(cacheKeys.plan(p.id), p, { persist: true });
      }
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
    setRenameValue(actionPlan.prep_for);
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
    if (!trimmed || trimmed === renamePlan.prep_for) {
      cancelRename();
      return;
    }
    setRenaming(true);
    try {
      const id = await getDeviceId();
      // api.renamePlan writes the updated plan straight into the cache; the
      // useCached subscription re-renders the list for us.
      await api.renamePlan(renamePlan.id, id, trimmed);
      cancelRename();
    } catch (e) {
      Alert.alert("Erro", (e as Error).message);
    } finally {
      setRenaming(false);
    }
  }, [renamePlan, renameValue, cancelRename]);

  const startDelete = useCallback(() => {
    if (!actionPlan) return;
    const plan = actionPlan;
    setActionPlan(null);
    Alert.alert(
      "Apagar plano?",
      `Vais perder o histórico de "${plan.prep_for}". Esta acção é definitiva.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Apagar",
          style: "destructive",
          onPress: async () => {
            setBusyId(plan.id);
            try {
              const id = await getDeviceId();
              // api.deletePlan removes the row from the cached list — the
              // useCached subscription re-renders without it.
              await api.deletePlan(plan.id, id);
              await clearLastPlanId();
            } catch (e) {
              Alert.alert("Erro", (e as Error).message);
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }, [actionPlan]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Animated.View entering={FadeIn.duration(220)} style={styles.center}>
          <LogoMark size="lg" />
        </Animated.View>
      </SafeAreaView>
    );
  }

  if (error && !plans) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <DuoButton title="TENTAR DE NOVO" onPress={load} fullWidth={false} />
        </View>
      </SafeAreaView>
    );
  }

  const list = plans ?? [];

  return (
    <>
      <Screen
        scroll
        onRefresh={load}
        contentStyle={{
          paddingTop: spacing.lg,
          paddingBottom: spacing.huge,
        }}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Planos</Text>
          <Text style={styles.heroSubtitle}>
            {list.length > 0
              ? `${list.length} ${list.length === 1 ? "plano" : "planos"} a treinar`
              : "Cria o teu primeiro plano de treino."}
          </Text>
        </View>

        {list.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEyebrow}>Nada ainda</Text>
            <Text style={styles.emptyTitle}>Começa um plano</Text>
            <Text style={styles.emptyBody}>
              Diz-nos para que te queres preparar e a IA monta-te um plano diário.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {list.map((p, i) => {
              const completed = p.days.filter((d) => d.completed_at).length;
              const total = p.days.length;
              const isComplete = total > 0 && completed === total;
              const isBusy = busyId === p.id;
              return (
                <Animated.View
                  key={p.id}
                  entering={FadeInDown.duration(220).delay(i * 40)}
                >
                  <Pressable
                    onPress={() => enterPlan(p.id)}
                    onLongPress={() => openActions(p)}
                    delayLongPress={350}
                    disabled={isBusy}
                    style={({ pressed }) => [
                      styles.card,
                      pressed ? styles.cardPressed : null,
                      isBusy ? { opacity: 0.4 } : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.indicator,
                        isComplete ? styles.indicatorDone : null,
                      ]}
                    >
                      {isComplete ? (
                        <Check
                          size={16}
                          color={palette.white}
                          weight="bold"
                        />
                      ) : (
                        <Text style={styles.indicatorText}>
                          {completed}
                          <Text style={styles.indicatorTextDim}>/{total}</Text>
                        </Text>
                      )}
                    </View>

                    <View style={styles.cardContent}>
                      <Text style={styles.cardEyebrow}>
                        {formatTargetLabel(p.target_date)}
                      </Text>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {p.prep_for}
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
                        color={palette.neutral[400]}
                        weight="bold"
                        style={styles.trailingIcon}
                      />
                    )}
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        )}

        <View style={styles.ctaWrap}>
          <DuoButton
            title="NOVO PLANO"
            onPress={() => router.push("/onboarding")}
          />
        </View>
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
            <Text style={styles.sheetEyebrow}>Plano</Text>
            <Text style={styles.sheetTitle} numberOfLines={2}>
              {actionPlan?.prep_for ?? ""}
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
              <Text style={styles.sheetActionText}>Mudar o nome</Text>
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
                Apagar plano
              </Text>
            </Pressable>

            <Pressable
              onPress={closeActions}
              style={({ pressed }) => [
                styles.sheetCancel,
                pressed ? { opacity: 0.6 } : null,
              ]}
            >
              <Text style={styles.sheetCancelText}>CANCELAR</Text>
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
            <Text style={styles.sheetEyebrow}>Mudar nome</Text>
            <Text style={styles.sheetTitle}>Como queres chamar a este plano?</Text>

            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              multiline
              maxLength={200}
              placeholder="Ex.: entrevista na Acme"
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
                <Text style={styles.sheetCancelText}>CANCELAR</Text>
              </Pressable>
              <DuoButton
                title={renaming ? "A GUARDAR…" : "GUARDAR"}
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
  hero: {
    paddingBottom: spacing.xxl,
  },
  heroTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
  },
  heroSubtitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: palette.neutral[500],
    marginTop: spacing.xs,
  },
  empty: {
    paddingTop: spacing.huge,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyEyebrow: {
    ...t.eyebrow,
  },
  emptyTitle: {
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 32,
    color: colors.text,
    marginTop: spacing.xs,
  },
  emptyBody: {
    ...t.bodyMuted,
    textAlign: "center",
    maxWidth: 280,
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
