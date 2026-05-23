// Design tokens. Strict palette: light-blue + white + neutral greys + red (errors only).
// Use everywhere — no hard-coded hex/sizes in screens.

import { StyleSheet } from "react-native";

const primary = {
  50: "#F0F9FF",
  100: "#E0F2FE",
  200: "#BAE6FD",
  300: "#7DD3FC",
  400: "#38BDF8",
  500: "#0EA5E9", // main brand
  600: "#0284C7",
  700: "#0369A1",
} as const;

const neutral = {
  50: "#F8FAFC",
  100: "#F1F5F9",
  200: "#E2E8F0",
  300: "#CBD5E1",
  400: "#94A3B8",
  500: "#64748B",
  600: "#475569",
  700: "#334155",
  800: "#1E293B",
  900: "#0F172A",
} as const;

const danger = "#E11D48";

export const palette = {
  primary,
  neutral,
  danger,
  white: "#FFFFFF",
} as const;

export const colors = {
  bg: "#FFFFFF",
  text: neutral[800],
  muted: neutral[500],
  border: neutral[200],
  rule: neutral[200],
  primary: primary[500],
  primaryDark: primary[700],
  primaryTint: primary[50],
  danger,
} as const;

// Editorial hairline rule width — use StyleSheet.hairlineWidth so it renders
// as the thinnest possible line on the device (usually <1px on hi-dpi).
export const hairline = StyleSheet.hairlineWidth;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
  mega: 72,
} as const;

export const fonts = {
  regular: "Nunito_400Regular",
  semibold: "Nunito_600SemiBold",
  bold: "Nunito_700Bold",
  extrabold: "Nunito_800ExtraBold",
  black: "Nunito_900Black",
} as const;

export const type = {
  display: { fontFamily: fonts.black, fontSize: 32, lineHeight: 38, color: colors.text },
  h1: { fontFamily: fonts.extrabold, fontSize: 24, lineHeight: 30, color: colors.text },
  h2: { fontFamily: fonts.extrabold, fontSize: 20, lineHeight: 26, color: colors.text },
  h3: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: colors.text },
  body: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.text },
  bodyRegular: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.text },
  bodyMuted: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.muted },
  small: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.muted },
  // Sentence-case labels — no uppercase, no letter-spacing. Primary blue
  // differentiates them from body text without resorting to tracked uppercase.
  caption: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: primary[600],
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: primary[600],
  },
  // Editorial display headline — bigger, blacker, tighter line-height.
  displayBig: {
    fontFamily: fonts.black,
    fontSize: 40,
    lineHeight: 44,
    color: colors.text,
  },
  button: {
    fontFamily: fonts.extrabold,
    fontSize: 16,
    letterSpacing: 0.4,
    color: "#FFFFFF",
  },
} as const;

export function band(value: number): { label: string; color: string } {
  if (value >= 8) return { label: "Excelente", color: primary[700] };
  if (value >= 5) return { label: "Bom progresso", color: primary[600] };
  return { label: "A treinar", color: primary[500] };
}
