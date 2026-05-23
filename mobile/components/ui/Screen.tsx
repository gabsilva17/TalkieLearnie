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

import { BAR_HEIGHT } from "@/components/ui/BottomNav";
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
  /** Optional content pinned below the top safe-area inset and above the scroll/non-scroll body (e.g. TopBar). Does not scroll and stays above the keyboard. */
  header?: ReactNode;
  /** When true, reserve bottom padding equal to the persistent BottomNav's footprint (bar height + safe-area inset + breathing room). The bar itself is rendered persistently at the root layout, not inside Screen — so it doesn't fade with Stack transitions. */
  reserveBottomNav?: boolean;
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
  header,
  reserveBottomNav,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const horizontal = padded ? { paddingHorizontal: spacing.xl } : null;

  // When there's a footer, footer owns the bottom inset. When the persistent
  // root-level BottomNav is reserved, leave room for its bar + safe-area +
  // breathing room. Otherwise content owns the inset directly.
  const contentBottomPad = footer
    ? 0
    : reserveBottomNav
      ? BAR_HEIGHT + insets.bottom + spacing.huge
      : insets.bottom + spacing.md;

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
      {header}
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
