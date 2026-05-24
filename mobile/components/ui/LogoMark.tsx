import { useEffect } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { fonts, palette } from "@/lib/theme";

type Props = {
  size?: "sm" | "md" | "lg";
  style?: ViewStyle;
};

const SIZES = {
  sm: 32,
  md: 44,
  lg: 56,
} as const;

// Wordmark "Talkie" in primary blue with a gentle breathing pulse, used
// in place of an ActivityIndicator during page transitions.
export function LogoMark({ size = "md", style }: Props) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.55, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
  }));

  return (
    <View style={[styles.wrap, style]}>
      <Animated.Text
        style={[
          styles.wordmark,
          { fontSize: SIZES[size] },
          animatedStyle,
        ]}
      >
        Talkie
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    fontFamily: fonts.extrabold,
    letterSpacing: -0.5,
    color: palette.primary[600],
  },
});
