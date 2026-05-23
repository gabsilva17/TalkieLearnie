// Revolut-style circular reveal overlay.
//
// Mounted once at the root layout (sibling of the other overlays). When the
// reveal queue has a head entry, this overlay animates a circle from the
// trigger's measured origin out to cover the whole screen, with the modal
// content sitting inside the expanding circle. Closing reverses the
// animation and dismisses the queue head so the overlay unmounts.
//
// The actual content per `kind` lives in `components/screens/AskOverlay.tsx`
// and `components/screens/ProfileOverlay.tsx`; this file only owns the
// animation wrapper.

import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  BackHandler,
  Dimensions,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AskOverlay } from "@/components/screens/AskOverlay";
import { ProfileOverlay } from "@/components/screens/ProfileOverlay";
import {
  dismissReveal,
  peekReveal,
  subscribeReveal,
  type RevealEntry,
  type RevealKind,
} from "@/lib/revealOverlay";
import { colors } from "@/lib/theme";

export function RevealOverlay() {
  const current = useSyncExternalStore(subscribeReveal, peekReveal, peekReveal);
  if (!current) return null;
  return (
    <Reveal
      key={`${current.kind}-${current.originX}-${current.originY}`}
      entry={current}
    />
  );
}

function Reveal({ entry }: { entry: RevealEntry }) {
  const { width: screenW, height: screenH } = Dimensions.get("window");

  // Radius needed for the circle to fully cover every pixel from the origin,
  // plus a small safety margin so the edge of the circle never reveals a
  // sliver of the screen underneath at the end of the animation.
  const maxRadius = useMemo(() => {
    const dx = Math.max(entry.originX, screenW - entry.originX);
    const dy = Math.max(entry.originY, screenH - entry.originY);
    return Math.hypot(dx, dy) + 32;
  }, [entry.originX, entry.originY, screenW, screenH]);

  const progress = useSharedValue(0);
  const closingRef = useRef(false);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: 360,
      easing: Easing.out(Easing.cubic),
    });
    Haptics.selectionAsync().catch(() => {});
    // shared value is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.kind, entry.originX, entry.originY]);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    Haptics.selectionAsync().catch(() => {});
    progress.value = withTiming(
      0,
      { duration: 280, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(dismissReveal)();
        }
      },
    );
  };

  // Android hardware back closes the overlay.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
    // close uses a ref guard; safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: progress.value }],
  }));

  return (
    <Animated.View
      style={StyleSheet.absoluteFillObject}
      pointerEvents="auto"
    >
      <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents="none" />

      <Animated.View
        style={[
          styles.circle,
          {
            width: maxRadius * 2,
            height: maxRadius * 2,
            borderRadius: maxRadius,
            left: entry.originX - maxRadius,
            top: entry.originY - maxRadius,
          },
          circleStyle,
        ]}
      >
        {/*
          The circle scales as a whole, so the content scales with it — that
          is the intended Revolut "burst" look. Position the content layer so
          its top-left maps to the screen's top-left at the final scale, then
          fill it with screen-sized children.
        */}
        <View
          style={{
            position: "absolute",
            left: maxRadius - entry.originX,
            top: maxRadius - entry.originY,
            width: screenW,
            height: screenH,
          }}
        >
          <RevealContent kind={entry.kind} onClose={close} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function RevealContent({
  kind,
  onClose,
}: {
  kind: RevealKind;
  onClose: () => void;
}) {
  if (kind === "ask") return <AskOverlay onClose={onClose} />;
  return <ProfileOverlay onClose={onClose} />;
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
  },
  circle: {
    position: "absolute",
    backgroundColor: colors.bg,
    overflow: "hidden",
  },
});
