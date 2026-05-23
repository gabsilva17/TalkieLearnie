import { Tabs } from "expo-router";
import {
  CardsIcon as Cards,
  ChatsCircleIcon as ChatsCircle,
  UserCircleIcon as UserCircle,
} from "phosphor-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, palette } from "@/lib/theme";

function AskBubble({ focused }: { focused: boolean }) {
  return (
    <View style={styles.askIconHost} pointerEvents="none">
      <View style={[styles.askBubble, focused && styles.askBubbleFocused]}>
        <ChatsCircle
          size={26}
          color={palette.white}
          weight={focused ? "fill" : "bold"}
        />
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: "fade",
        tabBarActiveTintColor: palette.primary[600],
        tabBarInactiveTintColor: palette.neutral[400],
        tabBarLabelStyle: {
          fontFamily: fonts.extrabold,
          fontSize: 11,
          letterSpacing: 0.3,
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: palette.neutral[200],
          borderTopWidth: 1,
          height: 60 + bottomInset,
          paddingTop: 6,
          paddingBottom: bottomInset,
          // Allow the ask bubble to protrude above the bar.
          overflow: "visible",
        },
      }}
    >
      <Tabs.Screen
        name="plans"
        options={{
          title: "Planos",
          tabBarIcon: ({ color, size, focused }) => (
            <Cards size={size} color={color} weight={focused ? "fill" : "bold"} />
          ),
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{
          title: "Perguntar",
          tabBarLabelStyle: {
            fontFamily: fonts.extrabold,
            fontSize: 11,
            letterSpacing: 0.3,
            marginTop: 2,
            color: palette.primary[600],
          },
          tabBarIcon: ({ focused }) => <AskBubble focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color, size, focused }) => (
            <UserCircle size={size} color={color} weight={focused ? "fill" : "bold"} />
          ),
        }}
      />
      <Tabs.Screen
        name="plan/[planId]/index"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

const BUBBLE_SIZE = 56;
const ICON_HOST_SIZE = 28;
// Lift must stay <= (BUBBLE_SIZE - ICON_HOST_SIZE) / 2 so the visual icon
// (rendered at the bubble's center) remains inside the tab cell's tap zone.
const BUBBLE_LIFT = 12;

const styles = StyleSheet.create({
  // Same footprint as the other tabs' icons so the label stays at its natural
  // position. The bubble is absolutely positioned and overflows this host.
  askIconHost: {
    width: ICON_HOST_SIZE,
    height: ICON_HOST_SIZE,
  },
  askBubble: {
    position: "absolute",
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    top: -((BUBBLE_SIZE - ICON_HOST_SIZE) / 2) - BUBBLE_LIFT,
    left: -((BUBBLE_SIZE - ICON_HOST_SIZE) / 2),
    backgroundColor: palette.primary[500],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.bg,
    shadowColor: palette.primary[700],
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  askBubbleFocused: {
    backgroundColor: palette.primary[600],
  },
});
