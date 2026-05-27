// Reusable header strip used by the plans home + plan detail screens.
//
// Plain title + subtitle header. Optional back arrow on the left. Chat and
// profile no longer live here — they moved to the bottom nav (see
// `BottomNav`), which launches the same circular reveal overlay.
//
// The component does NOT manage safe-area insets — parent screens handle
// that (via `Screen` or `SafeAreaView`). TopBar is a plain row.

import * as Haptics from "expo-haptics";
import { CaretLeftIcon as CaretLeft } from "phosphor-react-native";
import { StyleSheet, Text, View } from "react-native";

import { PressableScale } from "@/components/ui/PressableScale";
import { useT } from "@/lib/i18n";
import { colors, fonts, palette, spacing } from "@/lib/theme";

export type TopBarProps = {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
};

export function TopBar({ title, subtitle, onBack }: TopBarProps) {
  const { t } = useT();
  return (
    <View style={styles.row}>
      {onBack ? (
        <PressableScale
          hitSlop={12}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onBack();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.back")}
        >
          <View style={styles.iconButton}>
            <CaretLeft
              size={24}
              weight="regular"
              color={palette.neutral[600]}
            />
          </View>
        </PressableScale>
      ) : null}

      <View
        style={[styles.titleBlock, onBack ? styles.titleBlockWithBack : null]}
      >
        {title ? (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    backgroundColor: colors.bg,
  },
  titleBlock: {
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
  },
  titleBlockWithBack: {
    marginLeft: spacing.xs,
  },
  title: {
    fontFamily: fonts.black,
    fontSize: 34,
    lineHeight: 40,
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontFamily: fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: palette.neutral[500],
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
});
