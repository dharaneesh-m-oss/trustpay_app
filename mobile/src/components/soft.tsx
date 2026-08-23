/**
 * The soft surface set.
 *
 * A small vocabulary for the quieter look the app now wears: a pale ground,
 * pure-white cards separated by wide faint shadows instead of borders, circular
 * controls, and a lot of air.
 *
 * Two rules hold it together, and most of the calm comes from obeying them:
 *
 *   1. **Depth, not lines.** A card is white on grey with a soft shadow. Adding
 *      a border as well makes it look cut out rather than raised.
 *   2. **One loud thing per screen, at most.** Colour is reserved for state
 *      that matters - a payment landed, a dispute is open. Everything else is
 *      graphite on white, which is what makes the one accent register.
 */

import React from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Txt } from './ui';

import { useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/* ------------------------------------------------------------------- card */

export function SoftCard({
  children,
  style,
  padded = true,
  depth = 'md',
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  depth?: 'sm' | 'md' | 'lg';
  onPress?: () => void;
}) {
  const { colors, radius, spacing, elevation } = useTheme();
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.015 }],
  }));

  const body = (
    <>
      {children}
    </>
  );

  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: colors.surface,
      borderRadius: radius.xxl,
      padding: padded ? spacing.xl : 0,
    },
    elevation[depth],
    style,
  ];

  if (!onPress) return <View style={base}>{body}</View>;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 120 });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: 180 });
      }}
      style={[base, animated]}
    >
      {body}
    </AnimatedPressable>
  );
}

/* --------------------------------------------------------------- controls */

/**
 * The circular button the reference leans on - a back chevron, a menu, a
 * confirm. White by default, graphite when it is the one action that matters.
 */
export function CircleButton({
  glyph,
  onPress,
  accessibilityLabel,
  size = 44,
  tone = 'surface',
  style,
  ...rest
}: PressableProps & {
  glyph: string;
  onPress?: () => void;
  accessibilityLabel: string;
  size?: number;
  tone?: 'surface' | 'solid' | 'muted';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, elevation } = useTheme();
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.06 }],
  }));

  const backgrounds = {
    surface: colors.surface,
    solid: colors.brand,
    muted: colors.surfaceMuted,
  };
  const foregrounds = {
    surface: colors.textPrimary,
    solid: colors.onBrand,
    muted: colors.textSecondary,
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withSpring(1, { damping: 18, stiffness: 320 });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { damping: 18, stiffness: 320 });
      }}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: backgrounds[tone],
        },
        tone === 'muted' ? undefined : elevation.sm,
        animated,
        style,
      ]}
      {...rest}
    >
      <Txt
        variant="body"
        style={{ color: foregrounds[tone], fontSize: size * 0.36, lineHeight: size * 0.44 }}
      >
        {glyph}
      </Txt>
    </AnimatedPressable>
  );
}

/** A small grey capsule. Used for handles, roles, counts and states. */
export function Chip({
  label,
  tone = 'neutral',
  style,
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'solid';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius, spacing } = useTheme();

  const backgrounds = {
    neutral: colors.surfaceMuted,
    success: colors.successMuted,
    warning: colors.warningMuted,
    danger: colors.dangerMuted,
    solid: colors.brand,
  };
  const foregrounds = {
    neutral: colors.textSecondary,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    solid: colors.onBrand,
  };

  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: backgrounds[tone],
          borderRadius: radius.full,
          paddingHorizontal: spacing.md,
          paddingVertical: 5,
        },
        style,
      ]}
    >
      <Txt variant="caption" style={{ color: foregrounds[tone], fontWeight: '500' }}>
        {label}
      </Txt>
    </View>
  );
}

/* ----------------------------------------------------------------- header */

/**
 * The screen header: a centred lowercase title flanked by circular controls.
 *
 * The title is set in the mono style on purpose. It reads as a label for the
 * screen rather than a headline competing with the content underneath it.
 */
export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const { colors, spacing } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.sm,
      }}
    >
      <View style={{ width: 44 }}>
        {onBack ? (
          <CircleButton glyph="‹" accessibilityLabel="Go back" onPress={onBack} />
        ) : null}
      </View>

      <Txt
        variant="mono"
        style={{ color: colors.textPrimary, flex: 1, textAlign: 'center' }}
        numberOfLines={1}
      >
        {title}
      </Txt>

      <View style={{ width: 44, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

/* --------------------------------------------------------------- identity */

/**
 * Avatar, name, handle, one line of context - the block the reference opens
 * both of its screens with.
 */
export function Identity({
  name,
  handle,
  subtitle,
  size = 72,
  badge,
  align = 'center',
}: {
  name: string;
  handle?: string;
  subtitle?: string;
  size?: number;
  badge?: { glyph: string; tone: 'success' | 'brand' | 'warning' };
  align?: 'center' | 'left';
}) {
  const { colors, spacing, elevation, typography } = useTheme();

  const initials = name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const badgeColors = {
    success: colors.success,
    brand: colors.brand,
    warning: colors.warning,
  };

  const centred = align === 'center';

  return (
    <View style={{ alignItems: centred ? 'center' : 'flex-start', gap: spacing.sm }}>
      <View>
        <View
          style={[
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            },
            elevation.md,
          ]}
        >
          <Txt
            style={{
              ...typography.h2,
              color: colors.textPrimary,
              fontSize: size * 0.32,
            }}
          >
            {initials}
          </Txt>
        </View>

        {badge ? (
          <View
            style={{
              position: 'absolute',
              right: -2,
              top: -2,
              width: size * 0.3,
              height: size * 0.3,
              borderRadius: size * 0.15,
              backgroundColor: badgeColors[badge.tone],
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2.5,
              borderColor: colors.background,
            }}
          >
            <Txt
              style={{
                color: colors.onBrand,
                fontSize: size * 0.14,
                lineHeight: size * 0.18,
              }}
            >
              {badge.glyph}
            </Txt>
          </View>
        ) : null}
      </View>

      <Txt variant="h2" style={centred ? { textAlign: 'center' } : undefined}>
        {name}
      </Txt>

      {handle ? <Chip label={handle} style={centred ? { alignSelf: 'center' } : undefined} /> : null}

      {subtitle ? (
        <Txt
          variant="caption"
          tone="secondary"
          style={{ textAlign: centred ? 'center' : 'left', maxWidth: 280 }}
        >
          {subtitle}
        </Txt>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------- data rows */

/** A muted label with its value underneath - the detail list in the reference. */
export function DetailRow({
  label,
  value,
  divider = true,
}: {
  label: string;
  value: string;
  divider?: boolean;
}) {
  const { colors, spacing } = useTheme();

  return (
    <View>
      {divider ? (
        <View
          style={{
            height: 1,
            backgroundColor: colors.border,
            marginVertical: spacing.lg,
          }}
        />
      ) : null}
      <Txt variant="caption" tone="tertiary" style={{ marginBottom: 3 }}>
        {label}
      </Txt>
      <Txt variant="bodyStrong">{value}</Txt>
    </View>
  );
}

/**
 * A circular action with its label underneath.
 *
 * Replaces the old tinted tile grid. Tiles in six colours read as a toy; a row
 * of identical circles reads as a tool, and the labels do the distinguishing.
 */
export function SoftAction({
  glyph,
  label,
  onPress,
  badge,
  emphasis = false,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  badge?: string;
  emphasis?: boolean;
}) {
  const { colors, spacing } = useTheme();

  return (
    <View style={{ alignItems: 'center', width: 72, gap: spacing.sm }}>
      <View>
        <CircleButton
          glyph={glyph}
          accessibilityLabel={label}
          onPress={onPress}
          size={54}
          tone={emphasis ? 'solid' : 'surface'}
        />
        {badge ? (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              paddingHorizontal: 5,
              backgroundColor: colors.danger,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: colors.background,
            }}
          >
            <Txt style={{ color: colors.onBrand, fontSize: 10, lineHeight: 13 }}>
              {badge}
            </Txt>
          </View>
        ) : null}
      </View>
      <Txt
        variant="caption"
        tone="secondary"
        numberOfLines={1}
        style={{ textAlign: 'center' }}
      >
        {label}
      </Txt>
    </View>
  );
}

/** A lowercase, letter-spaced section label. */
export function SoftSection({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  const { spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.md,
        paddingHorizontal: spacing.xs,
      }}
    >
      <Txt variant="overline" tone="tertiary">
        {title}
      </Txt>
      {action}
    </View>
  );
}
