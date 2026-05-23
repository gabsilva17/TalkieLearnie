import { ReactNode } from "react";
import { Pressable, PressableProps, StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// Subtle press-scale wrapper. Defaults to 0.98 — noticeable but not bouncy.
// Pressable still passes `pressed` through to function-form `style` / `children`,
// so existing dim-on-press recipes keep working alongside the scale.

type Props = Omit<PressableProps, "style"> & {
  scale?: number;
  duration?: number;
  containerStyle?: StyleProp<ViewStyle>;
  style?:
    | StyleProp<ViewStyle>
    | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  children?:
    | ReactNode
    | ((state: { pressed: boolean }) => ReactNode);
};

export function PressableScale({
  scale = 0.98,
  duration = 110,
  containerStyle,
  style,
  children,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: Props) {
  const sv = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sv.value }],
  }));

  return (
    <Animated.View style={[aStyle, containerStyle]}>
      <Pressable
        {...rest}
        disabled={disabled}
        onPressIn={(e) => {
          if (!disabled) {
            sv.value = withTiming(scale, {
              duration,
              easing: Easing.out(Easing.quad),
            });
          }
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          sv.value = withTiming(1, {
            duration: duration + 60,
            easing: Easing.out(Easing.quad),
          });
          onPressOut?.(e);
        }}
        style={style as PressableProps["style"]}
      >
        {children as PressableProps["children"]}
      </Pressable>
    </Animated.View>
  );
}
