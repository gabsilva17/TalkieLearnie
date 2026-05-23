// Bottom navigation bar — three slots: Planos (left), Perguntar (center,
// raised primary-blue FAB), Perfil (right). Plans is a real route push;
// Perguntar and Perfil open the existing circular reveal overlay (measured
// from each button's on-screen center, mirroring the previous TopBar
// triggers).
//
// The center Ask button is rendered as an absolutely-positioned sibling of
// the bar row and protrudes ASK_RAISE pixels above the bar's top edge —
// classic Duolingo-ish FAB look. The bar handles its own bottom safe-area
// inset.
//
// Mounting: the bar is rendered ONCE at the root layout (sibling of
// `<Stack>` in `app/_layout.tsx` → `PersistentBottomNav`) and gated by
// pathname. Living outside the Stack is what keeps it stable across the
// `/plans` ↔ `/plan/[id]` fade — only the screen content fades, the bar
// doesn't. Screens that should sit above the bar declare
// `reserveBottomNav` on their `Screen` so content doesn't slip behind it.
// `BAR_HEIGHT` is exported so `Screen` can size that reserved padding.

import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import {
  ChatsIcon as Chats,
  ListChecksIcon as ListChecks,
  UserCircleIcon as UserCircle,
} from "phosphor-react-native";
import type { Icon } from "phosphor-react-native";
import { ReactNode, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressableScale } from "@/components/ui/PressableScale";
import { openReveal, type RevealKind } from "@/lib/revealOverlay";
import { colors, fonts, palette, spacing } from "@/lib/theme";

export type BottomNavProps = {
  active?: "plans" | null;
};

const ASK_SIZE = 72;
const ASK_RAISE = 30;
export const BAR_HEIGHT = 76;
const SIDE_ICON_SIZE = 30;

export function BottomNav({ active = "plans" }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        <SideButton
          label="Planos"
          Icon={ListChecks}
          active={active === "plans"}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            router.push("/plans");
          }}
        />

        <View style={styles.centerColumn}>
          <View style={styles.centerSpacer} />
          <Text style={styles.askLabel}>Perguntar</Text>
        </View>

        <RevealSideButton kind="profile" label="Perfil" Icon={UserCircle} />
      </View>

      <View style={styles.floatRow} pointerEvents="box-none">
        <AskButton />
      </View>
    </View>
  );
}

function SideButton({
  label,
  Icon,
  active,
  onPress,
}: {
  label: string;
  Icon: Icon;
  active: boolean;
  onPress: () => void;
}) {
  const color = active ? palette.primary[600] : palette.neutral[500];
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={styles.sideWrap}
      style={styles.side}
    >
      <Icon
        size={SIDE_ICON_SIZE}
        color={color}
        weight={active ? "bold" : "regular"}
      />
      <Text style={[styles.sideLabel, { color }]}>{label}</Text>
    </PressableScale>
  );
}

function RevealSideButton({
  kind,
  label,
  Icon,
}: {
  kind: RevealKind;
  label: string;
  Icon: Icon;
}): ReactNode {
  const anchorRef = useRef<View>(null);
  const handlePress = () => {
    Haptics.selectionAsync().catch(() => {});
    const node = anchorRef.current;
    if (!node) return;
    node.measureInWindow((x, y, w, h) => {
      openReveal({ kind, originX: x + w / 2, originY: y + h / 2 });
    });
  };
  return (
    <PressableScale
      onPress={handlePress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={styles.sideWrap}
      style={styles.side}
    >
      <View ref={anchorRef} collapsable={false} style={styles.sideInner}>
        <Icon
          size={SIDE_ICON_SIZE}
          color={palette.neutral[500]}
          weight="regular"
        />
        <Text style={[styles.sideLabel, { color: palette.neutral[500] }]}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

function AskButton() {
  const anchorRef = useRef<View>(null);
  const handlePress = () => {
    Haptics.selectionAsync().catch(() => {});
    const node = anchorRef.current;
    if (!node) return;
    node.measureInWindow((x, y, w, h) => {
      openReveal({ kind: "ask", originX: x + w / 2, originY: y + h / 2 });
    });
  };
  return (
    <PressableScale
      onPress={handlePress}
      hitSlop={12}
      scale={0.94}
      accessibilityRole="button"
      accessibilityLabel="Perguntar"
    >
      <View ref={anchorRef} collapsable={false} style={styles.askButton}>
        <Chats size={36} color={palette.white} weight="fill" />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: palette.neutral[200],
    overflow: "visible",
  },
  bar: {
    height: BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  sideWrap: {
    flex: 1,
  },
  side: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: spacing.xs,
  },
  sideInner: {
    alignItems: "center",
    gap: 4,
  },
  sideLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    lineHeight: 16,
  },
  // Holds the Ask FAB's footprint above and the "Perguntar" label below.
  // The label is anchored to the bottom of the bar so it sits at roughly
  // the same baseline as the Planos / Perfil labels — visual symmetry while
  // the FAB itself is absolutely positioned and raised in `floatRow`.
  centerColumn: {
    width: ASK_SIZE,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: spacing.sm,
  },
  centerSpacer: {
    flex: 1,
  },
  askLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    lineHeight: 16,
    color: palette.primary[600],
  },
  floatRow: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -ASK_RAISE,
    alignItems: "center",
  },
  askButton: {
    width: ASK_SIZE,
    height: ASK_SIZE,
    borderRadius: ASK_SIZE / 2,
    backgroundColor: palette.primary[500],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.bg,
    ...Platform.select({
      ios: {
        shadowColor: palette.primary[700],
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: {
        elevation: 8,
      },
    }),
  },
});
