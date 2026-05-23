import * as Haptics from "expo-haptics";
import type { Icon, IconWeight } from "phosphor-react-native";
import { ReactNode } from "react";
import {
  ActivityIndicator,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";

import { palette, radii, type as t } from "@/lib/theme";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "lg";

const DEPTH = 2;

type VariantTokens = {
  base: string;
  lip: string;
  text: string;
  border?: string;
  borderWidth?: number;
  showLip: boolean;
};

const VARIANTS: Record<Variant, VariantTokens> = {
  primary: {
    base: palette.primary[500],
    lip: palette.primary[700],
    text: palette.white,
    showLip: true,
  },
  secondary: {
    base: palette.neutral[50],
    lip: palette.neutral[200],
    text: palette.neutral[800],
    border: palette.neutral[200],
    borderWidth: 1,
    showLip: true,
  },
  danger: {
    base: palette.danger,
    lip: "#9F1239",
    text: palette.white,
    showLip: true,
  },
  ghost: {
    base: "transparent",
    lip: "transparent",
    text: palette.primary[600],
    showLip: false,
  },
};

type Props = {
  title: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  icon?: Icon;
  iconRight?: Icon;
  iconWeight?: IconWeight;
  fullWidth?: boolean;
  style?: ViewStyle;
  children?: ReactNode;
};

export function DuoButton({
  title,
  onPress,
  variant = "primary",
  size = "lg",
  disabled,
  loading,
  icon: IconLeft,
  iconRight: IconRight,
  iconWeight = "bold",
  fullWidth = true,
  style,
  children,
}: Props) {
  const cfg = VARIANTS[variant];
  const isDisabled = !!(disabled || loading);

  const baseColor = isDisabled ? palette.neutral[100] : cfg.base;
  const lipColor = isDisabled ? palette.neutral[200] : cfg.lip;
  const textColor = isDisabled ? palette.neutral[400] : cfg.text;
  const borderColor = isDisabled ? palette.neutral[200] : cfg.border;
  const borderWidth = cfg.borderWidth ?? 0;
  const showLip = cfg.showLip;

  return (
    <View
      style={[
        styles.outer,
        showLip ? { paddingBottom: DEPTH } : null,
        fullWidth ? { alignSelf: "stretch" } : null,
        style,
      ]}
    >
      {showLip ? (
        <View
          style={[
            styles.shadowLip,
            { backgroundColor: lipColor, borderRadius: radii.lg, top: DEPTH },
          ]}
        />
      ) : null}
      <Pressable
        disabled={isDisabled}
        onPress={(e) => {
          if (isDisabled) return;
          Haptics.selectionAsync().catch(() => {});
          onPress?.(e);
        }}
        style={({ pressed }) => [
          styles.inner,
          size === "md" ? styles.innerMd : styles.innerLg,
          {
            backgroundColor: baseColor,
            borderColor: borderColor ?? "transparent",
            borderWidth,
            transform: [
              { translateY: pressed && !isDisabled && showLip ? DEPTH : 0 },
            ],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <View style={styles.contentRow}>
            {IconLeft ? <IconLeft size={20} color={textColor} weight={iconWeight} /> : null}
            <Text style={[t.button, { color: textColor }]} numberOfLines={1}>
              {title}
            </Text>
            {IconRight ? <IconRight size={20} color={textColor} weight={iconWeight} /> : null}
            {children}
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: "relative",
  },
  shadowLip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  inner: {
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  innerLg: { paddingVertical: 16, paddingHorizontal: 20 },
  innerMd: { paddingVertical: 12, paddingHorizontal: 16 },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
