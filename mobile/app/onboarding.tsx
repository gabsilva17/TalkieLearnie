import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import {
  CalendarBlankIcon as CalendarBlank,
  XIcon as X,
} from "phosphor-react-native";
import { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { DuoButton } from "@/components/ui/DuoButton";
import { Screen } from "@/components/ui/Screen";
import { api } from "@/lib/api";
import { getDeviceId } from "@/lib/deviceId";
import { setLastPlanId } from "@/lib/lastPlan";
import { colors, fonts, palette, radii, spacing, type as t } from "@/lib/theme";

function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDatePt(d: Date): string {
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "long", year: "numeric" });
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

type Step = 0 | 1 | 2;
const TOTAL = 3;

const PROMPTS: Record<Step, string> = {
  0: "Olá! Para que te queres preparar?",
  1: "Quando é o grande dia?",
  2: "E quem te vai estar a ouvir?",
};

const SUBTITLES: Record<Step, string | null> = {
  0: "Pitch, entrevista, conversa difícil. Diz-nos em poucas palavras.",
  1: null,
  2: "Quanto mais souberes sobre eles, melhor preparamos o plano.",
};

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [prepFor, setPrepFor] = useState("");
  const [audience, setAudience] = useState("");
  const [targetDate, setTargetDate] = useState<Date>(tomorrow());
  const [showPicker, setShowPicker] = useState(Platform.OS === "ios");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<"prep" | "audience" | "date" | null>(null);

  const trimmedPrep = prepFor.trim();
  const trimmedAud = audience.trim();
  const canContinue =
    (step === 0 && trimmedPrep.length > 3) ||
    (step === 1 && targetDate.getTime() >= new Date().setHours(0, 0, 0, 0)) ||
    (step === 2 && trimmedAud.length > 3);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const id = await getDeviceId();
      const plan = await api.createPlan({
        device_id: id,
        prep_for: trimmedPrep,
        target_date: isoDate(targetDate),
        audience_info: trimmedAud,
      });
      await setLastPlanId(plan.id);
      router.replace(`/plan/${plan.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    if (!canContinue) return;
    if (step < 2) {
      setStep(((step + 1) as Step));
    } else {
      submit();
    }
  }

  function back() {
    if (step === 0) {
      router.back();
      return;
    }
    setStep(((step - 1) as Step));
  }

  function onDateChange(_: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === "android") setShowPicker(false);
    if (d) setTargetDate(d);
  }

  const inputStyle = (focused: boolean) => [
    styles.input,
    { borderColor: focused ? palette.primary[500] : palette.neutral[200] },
  ];

  return (
    <Screen scroll keyboardAware>
      <View style={styles.headerRow}>
        <Pressable onPress={back} hitSlop={12} style={styles.backBtn}>
          <X size={28} color={palette.neutral[400]} weight="bold" />
        </Pressable>
      </View>

      <View style={styles.centerBlock}>
        <View style={styles.stepHeader}>
          <Text style={styles.eyebrow}>{`Passo ${step + 1} de ${TOTAL}`}</Text>
          <Text style={styles.question}>{PROMPTS[step]}</Text>
          {SUBTITLES[step] ? (
            <Text style={styles.subtitle}>{SUBTITLES[step]}</Text>
          ) : null}
        </View>

        {step === 0 ? (
          <View style={styles.field}>
            <TextInput
              style={inputStyle(focusedField === "prep")}
              placeholder="Ex.: pitch de hackathon, entrevista de emprego..."
              placeholderTextColor={palette.neutral[400]}
              value={prepFor}
              onChangeText={setPrepFor}
              multiline
              autoFocus
              onFocus={() => setFocusedField("prep")}
              onBlur={() => setFocusedField(null)}
            />
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.field}>
            {Platform.OS === "android" ? (
              <Pressable
                style={inputStyle(focusedField === "date")}
                onPress={() => {
                  setFocusedField("date");
                  setShowPicker(true);
                }}
              >
                <View style={styles.dateRow}>
                  <CalendarBlank size={20} color={palette.neutral[600]} weight="bold" />
                  <Text style={styles.dateText}>{formatDatePt(targetDate)}</Text>
                </View>
              </Pressable>
            ) : null}
            {showPicker ? (
              <View style={styles.pickerWrap}>
                <DateTimePicker
                  value={targetDate}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  minimumDate={tomorrow()}
                  onChange={onDateChange}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.field}>
            <TextInput
              style={inputStyle(focusedField === "audience")}
              placeholder="Ex.: júri não técnico, investidor série A, manager directo..."
              placeholderTextColor={palette.neutral[400]}
              value={audience}
              onChangeText={setAudience}
              multiline
              autoFocus
              onFocus={() => setFocusedField("audience")}
              onBlur={() => setFocusedField(null)}
            />
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.buttonWrap}>
          <DuoButton
            title={step < 2 ? "CONTINUAR" : "GERAR O MEU PLANO"}
            onPress={next}
            disabled={!canContinue}
            loading={submitting}
          />
        </View>

        {step === 2 ? (
          <Text style={styles.hint}>A IA prepara as sessões em 10–20 segundos.</Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  centerBlock: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: spacing.md,
  },
  stepHeader: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  buttonWrap: {
    marginTop: spacing.lg,
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: palette.primary[600],
  },
  question: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.text,
    marginTop: spacing.md,
  },
  subtitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: palette.neutral[500],
    marginTop: spacing.sm,
  },
  field: { gap: spacing.sm, marginBottom: spacing.lg },
  input: {
    backgroundColor: palette.neutral[50],
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    minHeight: 88,
    textAlignVertical: "top",
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 60,
  },
  dateText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.text,
  },
  pickerWrap: { alignItems: "center" },
  error: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  hint: {
    ...t.small,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
