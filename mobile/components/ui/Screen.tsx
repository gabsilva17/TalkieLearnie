import { ReactNode, useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, palette, spacing } from "@/lib/theme";

type ScreenProps = {
  children: ReactNode;
  bg?: string;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
  keyboardAware?: boolean;
  contentStyle?: ViewStyle;
  onRefresh?: () => void | Promise<unknown>;
};

export function Screen({
  children,
  bg = colors.bg,
  scroll = false,
  padded = true,
  footer,
  keyboardAware = false,
  contentStyle,
  onRefresh,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const horizontal = padded ? { paddingHorizontal: spacing.xl } : null;

  // When there's no footer, content owns the bottom inset.
  const contentBottomPad = footer ? 0 : insets.bottom + spacing.md;

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const refreshControl =
    scroll && onRefresh ? (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor={colors.primary}
        colors={[colors.primary]}
        progressBackgroundColor={palette.white}
      />
    ) : undefined;

  const inner = scroll ? (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContent,
        horizontal,
        { paddingBottom: contentBottomPad },
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.flex,
        horizontal,
        { paddingBottom: contentBottomPad },
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  const body = keyboardAware ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {inner}
      {footer ? (
        <View
          style={[
            styles.footer,
            {
              paddingBottom: insets.bottom + spacing.md,
              backgroundColor: bg,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  ) : (
    <>
      {inner}
      {footer ? (
        <View
          style={[
            styles.footer,
            {
              paddingBottom: insets.bottom + spacing.md,
              backgroundColor: bg,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </>
  );

  return (
    <View
      style={[
        styles.flex,
        {
          paddingTop: insets.top,
          backgroundColor: bg,
        },
      ]}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
});
