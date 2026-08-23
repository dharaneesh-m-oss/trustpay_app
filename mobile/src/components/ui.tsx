/**
 * Core UI primitives.
 *
 * Everything visual in TrustPay is built from these, so spacing, radii, hit
 * targets and disabled states stay consistent without each screen re-deciding
 * them.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  TextStyle,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { GradientButton, OrbLoader } from '@/components/uiverse';
import { HIT_SIZE, useTheme } from '@/theme';

/* -------------------------------------------------------------- typography */

type Variant = keyof ReturnType<typeof useTheme>['typography'];
type Tone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'inverse';

export function Txt({
  variant = 'body',
  tone = 'primary',
  style,
  ...rest
}: TextProps & { variant?: Variant; tone?: Tone }) {
  const { typography, colors } = useTheme();
  const toneColor: Record<Tone, string> = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    brand: colors.brand,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    inverse: colors.textInverse,
  };

  return (
    <Text
      style={[typography[variant] as TextStyle, { color: toneColor[tone] }, style]}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------- card */

export function Card({
  style,
  padded = true,
  raised = false,
  ...rest
}: ViewProps & { padded?: boolean; raised?: boolean }) {
  const { colors, radius, spacing, elevation } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: raised ? colors.surfaceRaised : colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: padded ? spacing.lg : 0,
        },
        raised ? elevation.sm : null,
        style,
      ]}
      {...rest}
    />
  );
}

/* ----------------------------------------------------------------- button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = true,
  icon,
  style,
  ...rest
}: PressableProps & {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius, spacing, typography } = useTheme();
  const pressed = useSharedValue(0);

  const isInactive = disabled || loading;

  const backgrounds: Record<ButtonVariant, string> = {
    primary: colors.brand,
    secondary: colors.surfaceMuted,
    ghost: 'transparent',
    danger: colors.danger,
  };
  const labels: Record<ButtonVariant, string> = {
    primary: colors.onBrand,
    secondary: colors.textPrimary,
    ghost: colors.brand,
    danger: '#FFFFFF',
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(1 - pressed.value * 0.02, { damping: 18 }) }],
    opacity: withTiming(isInactive ? 0.5 : 1 - pressed.value * 0.1, {
      duration: 120,
    }),
  }));

  // The primary action is the gradient pill adapted from sharp-stingray-58.
  // Routing it through here means every screen gets it without each one
  // reaching for a different component.
  if (variant === 'primary') {
    return (
      <GradientButton
        title={title}
        onPress={onPress as (() => void) | undefined}
        loading={loading}
        disabled={Boolean(disabled)}
        reflection={false}
        style={[fullWidth ? { width: '100%' } : null, style]}
      />
    );
  }

  return (
    <Animated.View style={[fullWidth ? { width: '100%' } : null, animatedStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isInactive, busy: loading }}
        disabled={isInactive}
        onPress={onPress}
        onPressIn={() => (pressed.value = 1)}
        onPressOut={() => (pressed.value = 0)}
        style={[
          {
            minHeight: 52,
            borderRadius: radius.md,
            backgroundColor: backgrounds[variant],
            borderWidth: variant === 'ghost' ? 1 : 0,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: spacing.sm,
            paddingHorizontal: spacing.xl,
          },
          style,
        ]}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator color={labels[variant]} />
        ) : (
          <>
            {icon}
            <Text
              style={[
                typography.bodyStrong as TextStyle,
                { color: labels[variant], fontSize: 16 },
              ]}
            >
              {title}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ input */

export function Field({
  label,
  error,
  hint,
  style,
  ...rest
}: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const { colors, radius, spacing, typography } = useTheme();
  const [focused, setFocused] = React.useState(false);

  return (
    <View style={{ gap: spacing.xs }}>
      <Txt variant="captionStrong" tone="secondary">
        {label}
      </Txt>
      <TextInput
        placeholderTextColor={colors.textTertiary}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          typography.body as TextStyle,
          {
            minHeight: 52,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: error
              ? colors.danger
              : focused
                ? colors.brand
                : colors.border,
            backgroundColor: colors.surface,
            color: colors.textPrimary,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" tone="tertiary">
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ badge */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: string;
}) {
  const { colors, radius, spacing, typography } = useTheme();

  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceMuted, fg: colors.textSecondary },
    brand: { bg: colors.brandMuted, fg: colors.brand },
    success: { bg: colors.successMuted, fg: colors.success },
    warning: { bg: colors.warningMuted, fg: colors.warning },
    danger: { bg: colors.dangerMuted, fg: colors.danger },
    info: { bg: colors.infoMuted, fg: colors.info },
  };

  return (
    <View
      style={{
        backgroundColor: map[tone].bg,
        borderRadius: radius.full,
        paddingHorizontal: spacing.md,
        paddingVertical: 5,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
      }}
    >
      {icon ? <Text style={{ fontSize: 11 }}>{icon}</Text> : null}
      <Text
        style={[
          typography.captionStrong as TextStyle,
          { color: map[tone].fg, fontSize: 12 },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ states */

export function Loading({ label = 'Loading' }: { label?: string }) {
  const { spacing } = useTheme();
  return (
    <View style={{ padding: spacing.huge, alignItems: 'center' }}>
      <OrbLoader size={88} label={label} />
    </View>
  );
}

/** Skeleton block for list and card placeholders. */
export function Skeleton({
  height = 16,
  width = '100%',
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius } = useTheme();
  const pulse = useSharedValue(0.5);

  React.useEffect(() => {
    pulse.value = withTiming(1, { duration: 900 });
  }, [pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { height, width, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm },
        animated,
        style,
      ]}
    />
  );
}

export function EmptyState({
  icon = '📭',
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const { spacing } = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(240)}
      style={{
        alignItems: 'center',
        paddingVertical: spacing.xxxl,
        paddingHorizontal: spacing.xl,
        gap: spacing.sm,
      }}
    >
      <Text style={{ fontSize: 40 }}>{icon}</Text>
      <Txt variant="h3" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <Txt
        variant="body"
        tone="secondary"
        style={{ textAlign: 'center', maxWidth: 300 }}
      >
        {body}
      </Txt>
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </Animated.View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  const { spacing } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: spacing.xxxl,
        paddingHorizontal: spacing.xl,
        gap: spacing.sm,
      }}
    >
      <Text style={{ fontSize: 36 }}>⚠️</Text>
      <Txt variant="h3" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
        {message}
      </Txt>
      {onRetry ? (
        <View style={{ marginTop: spacing.lg, width: 200 }}>
          <Button title="Try again" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ layout */

export function Screen({
  children,
  scroll = true,
  style,
  contentStyle,
  refreshControl,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  const { colors, spacing } = useTheme();
  const base: ViewStyle = { flex: 1, backgroundColor: colors.background };

  if (!scroll) {
    return <View style={[base, style]}>{children}</View>;
  }

  return (
    <ScrollView
      style={[base, style]}
      contentContainerStyle={[
        { padding: spacing.lg, paddingBottom: spacing.huge * 2, gap: spacing.lg },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}

export function Row({
  style,
  gap,
  ...rest
}: ViewProps & { gap?: number }) {
  const { spacing } = useTheme();
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: gap ?? spacing.md },
        style,
      ]}
      {...rest}
    />
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ height: 1, backgroundColor: colors.border }, style]} />
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  const { spacing } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', marginBottom: spacing.xs }}>
      <Txt variant="overline" tone="secondary">
        {title}
      </Txt>
      {action}
    </Row>
  );
}

/** A circular icon button with a guaranteed 44pt target. */
export function IconButton({
  glyph,
  onPress,
  accessibilityLabel,
  tone = 'neutral',
}: {
  glyph: string;
  onPress?: () => void;
  accessibilityLabel: string;
  tone?: BadgeTone;
}) {
  const { colors, radius } = useTheme();
  const backgrounds: Record<BadgeTone, string> = {
    neutral: colors.surfaceMuted,
    brand: colors.brandMuted,
    success: colors.successMuted,
    warning: colors.warningMuted,
    danger: colors.dangerMuted,
    info: colors.infoMuted,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        width: HIT_SIZE,
        height: HIT_SIZE,
        borderRadius: radius.full,
        backgroundColor: backgrounds[tone],
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 18 }}>{glyph}</Text>
    </Pressable>
  );
}
