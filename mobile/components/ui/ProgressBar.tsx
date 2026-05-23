import { StyleSheet, View } from "react-native";

import { palette, radii } from "@/lib/theme";

type Props = {
  value: number; // 0..1
  height?: number;
  color?: string;
  trackColor?: string;
};

export function ProgressBar({
  value,
  height = 6,
  color = palette.primary[500],
  trackColor = palette.neutral[100],
}: Props) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      style={[
        styles.track,
        { height, borderRadius: radii.pill, backgroundColor: trackColor },
      ]}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${pct * 100}%`,
            backgroundColor: color,
            borderRadius: radii.pill,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: "100%", overflow: "hidden" },
  fill: { height: "100%" },
});
