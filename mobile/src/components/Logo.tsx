/**
 * The TrustPay mark.
 *
 * Two forms moving toward each other and interlocking — the two parties to an
 * agreement, and the moment the connection between them becomes secure. The
 * negative space between them holds a vertical bar: the protected money sitting
 * between the two sides, held by neither until the conditions are met.
 *
 * Deliberately not a shield or a padlock. Those say "we locked it"; this says
 * "you two agreed, and it is held".
 */

import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/theme';

export function LogoMark({
  size = 40,
  color,
  accent,
}: {
  size?: number;
  color?: string;
  accent?: string;
}) {
  const { colors } = useTheme();
  const primary = color ?? colors.brand;
  const secondary = accent ?? colors.textPrimary;

  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Defs>
        <LinearGradient id="tp-a" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={primary} />
          <Stop offset="1" stopColor={primary} stopOpacity="0.75" />
        </LinearGradient>
      </Defs>

      {/* Left party: an open bracket reaching right. */}
      <Path
        d="M18 6 C10 6 5 11 5 19 L5 29 C5 37 10 42 18 42"
        stroke="url(#tp-a)"
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />

      {/* Right party: the mirror, reaching back. */}
      <Path
        d="M30 6 C38 6 43 11 43 19 L43 29 C43 37 38 42 30 42"
        stroke={secondary}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
        opacity={0.9}
      />

      {/* The protected amount held between them. */}
      <Rect x="21" y="15" width="6" height="18" rx="3" fill={primary} />
    </Svg>
  );
}

export function LogoLockup({
  size = 32,
  showTagline = false,
}: {
  size?: number;
  showTagline?: boolean;
}) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <LogoMark size={size} />
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text
            style={{
              ...typography.h2,
              color: colors.textPrimary,
              fontSize: size * 0.62,
              letterSpacing: -0.6,
            }}
          >
            Trust
          </Text>
          <Text
            style={{
              ...typography.h2,
              color: colors.brand,
              fontSize: size * 0.62,
              letterSpacing: -0.6,
            }}
          >
            Pay
          </Text>
        </View>
        {showTagline ? (
          <Text
            style={{
              ...typography.caption,
              color: colors.textSecondary,
              letterSpacing: 1.4,
              fontSize: 10,
              textTransform: 'uppercase',
            }}
          >
            Trust. Protected.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The animated ring used on the splash and while a payment is being protected. */
export function LogoPulse({ size = 96 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96" fill="none">
      <Circle
        cx="48"
        cy="48"
        r="44"
        stroke={colors.brand}
        strokeWidth={2}
        opacity={0.25}
      />
      <Circle
        cx="48"
        cy="48"
        r="36"
        stroke={colors.brand}
        strokeWidth={1}
        opacity={0.15}
      />
    </Svg>
  );
}
