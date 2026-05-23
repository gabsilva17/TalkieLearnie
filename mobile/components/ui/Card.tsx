import { ReactNode } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";

import { palette, radii, spacing } from "@/lib/theme";

type Props = {
  children: ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
};

export function Card({ children, style, elevated = false }: Props) {
  return (
    <View style={[styles.card, elevated ? styles.elevated : null, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.neutral[200],
    padding: spacing.lg,
  },
  elevated: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
});
