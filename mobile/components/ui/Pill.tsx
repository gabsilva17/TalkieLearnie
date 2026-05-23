import type { Icon, IconWeight } from "phosphor-react-native";
import { StyleSheet, Text, View, ViewStyle } from "react-native";

import { palette, radii, type as t } from "@/lib/theme";

export type PillVariant = "default" | "info" | "success" | "danger";

type Props = {
  label: string;
  variant?: PillVariant;
  icon?: Icon;
  iconWeight?: IconWeight;
  size?: "sm" | "md";
  style?: ViewStyle;
};

const VARIANTS: Record<PillVariant, { bg: string; fg: string }> = {
  default: { bg: palette.neutral[100], fg: palette.neutral[700] },
  info: { bg: palette.primary[50], fg: palette.primary[700] },
  success: { bg: palette.primary[100], fg: palette.primary[700] },
  danger: { bg: "#FEE2E2", fg: palette.danger },
};

export function Pill({
  label,
  variant = "default",
  icon: IconCmp,
  iconWeight = "bold",
  size = "md",
  style,
}: Props) {
  const { bg, fg } = VARIANTS[variant];

  return (
    <View
      style={[
        styles.pill,
        size === "sm" ? styles.pillSm : styles.pillMd,
        { backgroundColor: bg },
        style,
      ]}
    >
      {IconCmp ? (
        <IconCmp size={size === "sm" ? 11 : 13} color={fg} weight={iconWeight} />
      ) : null}
      <Text style={[t.caption, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radii.pill,
  },
  pillMd: { paddingHorizontal: 10, paddingVertical: 5 },
  pillSm: { paddingHorizontal: 8, paddingVertical: 3 },
});
