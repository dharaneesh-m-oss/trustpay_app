/**
 * Uiverse-derived components, rebuilt for React Native.
 *
 * Each of these takes its shape and motion from a specific Uiverse component,
 * recoloured to the TrustPay palette. Where the original relied on CSS that
 * React Native does not have, the note on the component says what was
 * substituted — so nobody later mistakes an approximation for the original.
 *
 * The single biggest change across all of them: **the originals animate on
 * `:hover`, which does not exist on a phone.** Every hover state here becomes a
 * press state, which is the honest mobile equivalent.
 */

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleProp,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  type SharedValue,
  Easing,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Polygon, Stop } from 'react-native-svg';

import { elevation, glow, gradients, radius, spacing, typography, useTheme } from '@/theme';

/* ═══════════════════════════════════════════════════════════════════════════
   1. PRIMARY / LOGIN BUTTON
   Source: SmookyDev/sharp-stingray-58

   The original is a gradient pill with a wave SVG rolling across it, a CSS
   box-reflect underneath, and two stacked labels that swap on hover.

   Substitutions: `-webkit-box-reflect` has no RN equivalent, so the reflection
   is a mirrored gradient strip below the button. The wave is a real SVG that
   drifts continuously rather than only on hover — on a phone there is no hover
   to trigger it, and a permanently static wave would look like a bug.
   ═══════════════════════════════════════════════════════════════════════════ */

export function GradientButton({
  title,
  subtitle,
  onPress,
  loading = false,
  disabled = false,
  colors: colorsProp,
  reflection = true,
  style,
}: {
  title: string;
  /** The second label. Shown small above the title, as in the original. */
  subtitle?: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  colors?: readonly string[];
  reflection?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const pressed = useSharedValue(0);
  const drift = useSharedValue(0);

  const stops = (colorsProp ?? gradients.primary) as unknown as string[];
  const inactive = disabled || loading;

  React.useEffect(() => {
    drift.value = withRepeat(
      withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [drift]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(1 - pressed.value * 0.03, { damping: 16 }) }],
    opacity: withTiming(inactive ? 0.55 : 1, { duration: 140 }),
  }));

  const waveStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drift.value, [0, 1], [-24, 24]) },
      { translateY: interpolate(drift.value, [0, 1], [2, -2]) },
    ],
  }));

  return (
    <View style={style}>
      <Animated.View style={containerStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: inactive, busy: loading }}
          disabled={inactive}
          onPress={onPress}
          onPressIn={() => (pressed.value = 1)}
          onPressOut={() => (pressed.value = 0)}
        >
          <LinearGradient
            colors={stops as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              minHeight: 56,
              borderRadius: radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              paddingHorizontal: spacing.xxl,
              ...glow(stops[0], 0.45, 20),
            }}
          >
            {/* The rolling wave from the original. */}
            <Animated.View
              style={[
                { position: 'absolute', left: 0, right: 0, bottom: -6, opacity: 0.35 },
                waveStyle,
              ]}
              pointerEvents="none"
            >
              <Svg width="130%" height={44} viewBox="0 0 1440 320">
                <Path
                  fill="#FFFFFF"
                  d="M0,224L60,213.3C120,203,240,181,360,181.3C480,181,600,203,720,213.3C840,224,960,224,1080,208C1200,192,1320,160,1380,144L1440,128L1440,320L0,320Z"
                />
              </Svg>
            </Animated.View>

            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <View style={{ alignItems: 'center' }}>
                {subtitle ? (
                  <Text
                    style={{
                      ...typography.overline,
                      color: 'rgba(255,255,255,0.75)',
                      fontSize: 9,
                    }}
                  >
                    {subtitle}
                  </Text>
                ) : null}
                <Text
                  style={{
                    ...typography.h3,
                    color: '#FFFFFF',
                    letterSpacing: 1.6,
                    textTransform: 'uppercase',
                  }}
                >
                  {title}
                </Text>
              </View>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>

      {/* Stand-in for -webkit-box-reflect. */}
      {reflection && !inactive ? (
        <LinearGradient
          colors={[`${stops[0]}55`, 'transparent']}
          style={{
            height: 14,
            marginTop: 2,
            marginHorizontal: spacing.xxl,
            borderBottomLeftRadius: radius.full,
            borderBottomRightRadius: radius.full,
          }}
          pointerEvents="none"
        />
      ) : null}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LOADER
   Source: andrew-manzyk/young-walrus-64

   The original is an amber orb whose glow comes from blurred polygons rotating
   behind an SVG mask, with `filter: contrast()` hardening the blur into
   liquid-looking blobs and `hue-rotate` cycling the colour.

   Substitutions: RN has no `mask`, `filter: blur/contrast`, or `hue-rotate`.
   The liquid effect is rebuilt as three translucent gradient lobes rotating at
   different speeds inside a clipped circle, under a soft rim — the same
   impression (a warm, slowly churning orb) reached a different way.
   ═══════════════════════════════════════════════════════════════════════════ */

export function OrbLoader({ size = 96, label }: { size?: number; label?: string }) {
  const { colors } = useTheme();

  const spinA = useSharedValue(0);
  const spinB = useSharedValue(0);
  const spinC = useSharedValue(0);
  const breathe = useSharedValue(0);

  React.useEffect(() => {
    spinA.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1);
    spinB.value = withRepeat(withTiming(1, { duration: 1900, easing: Easing.linear }), -1);
    spinC.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.linear }), -1);
    breathe.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [spinA, spinB, spinC, breathe]);

  const lobe = (value: SharedValue<number>, reverse = false) =>
    useAnimatedStyle(() => ({
      transform: [
        { rotate: `${(reverse ? -1 : 1) * value.value * 360}deg` },
        { scale: interpolate(breathe.value, [0, 1], [0.92, 1.06]) },
      ],
    }));

  const lobeA = lobe(spinA);
  const lobeB = lobe(spinB, true);
  const lobeC = lobe(spinC);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(breathe.value, [0, 1], [0.55, 0.9]),
    transform: [{ scale: interpolate(breathe.value, [0, 1], [0.96, 1.04]) }],
  }));

  return (
    <View style={{ alignItems: 'center', gap: spacing.lg }}>
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            ...glow('#FFBF48', 0.6, 26),
          },
          glowStyle,
        ]}
      >
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: 'hidden',
            backgroundColor: '#FFF3DC',
            borderWidth: 1,
            borderColor: '#FFD79A',
          }}
        >
          {[
            { style: lobeA, colors: ['#FFBF48', '#FFBF4700'] as const, offset: -size * 0.2 },
            { style: lobeB, colors: ['#BE4A1D', '#BE4A1D00'] as const, offset: size * 0.18 },
            { style: lobeC, colors: ['#FF9A3C', '#FF9A3C00'] as const, offset: 0 },
          ].map((item, index) => (
            <Animated.View
              key={index}
              style={[
                {
                  position: 'absolute',
                  width: size * 1.1,
                  height: size * 1.1,
                  left: size * -0.05,
                  top: size * -0.05 + item.offset,
                },
                item.style,
              ]}
            >
              <LinearGradient
                colors={item.colors}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={{
                  flex: 1,
                  borderRadius: size * 0.55,
                  opacity: 0.85,
                }}
              />
            </Animated.View>
          ))}

          {/* Inner rim, from the original's inset shadows. */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: size / 2,
              borderWidth: 2,
              borderColor: 'rgba(255,255,255,0.45)',
            }}
          />
        </View>
      </Animated.View>

      {label ? (
        <Text style={{ ...typography.caption, color: colors.textSecondary }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. ACTION BUTTON — Add money / Withdraw
   Source: Peary74/kind-cougar-54

   The original: a dark pill where, on hover, the icon slides right and grows
   while the label fades out.

   Substitution: hover → press. Holding the button slides the icon and fades the
   label, which reads as the action committing.
   ═══════════════════════════════════════════════════════════════════════════ */

export function SlideActionButton({
  label,
  glyph,
  onPress,
  tone = 'dark',
  loading = false,
  disabled = false,
  style,
}: {
  label: string;
  glyph: string;
  onPress?: () => void;
  tone?: 'dark' | 'brand' | 'mint' | 'light';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const pressed = useSharedValue(0);
  const inactive = disabled || loading;

  const palettes = {
    dark: { bg: '#212121', fg: '#FFFFFF', icon: 'rgb(155,153,153)' },
    brand: { bg: colors.brand, fg: '#FFFFFF', icon: 'rgba(255,255,255,0.75)' },
    mint: { bg: colors.success, fg: '#FFFFFF', icon: 'rgba(255,255,255,0.8)' },
    light: { bg: colors.surfaceMuted, fg: colors.textPrimary, icon: colors.textSecondary },
  } as const;
  const scheme = palettes[tone];

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(1 - pressed.value * 0.05, { damping: 15 }) }],
    opacity: withTiming(inactive ? 0.5 : 1, { duration: 140 }),
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: withTiming(pressed.value * 18, { duration: 260 }) },
      { scale: withTiming(1 + pressed.value * 0.25, { duration: 260 }) },
    ],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: withTiming(1 - pressed.value, { duration: 220 }),
  }));

  return (
    <Animated.View style={[containerStyle, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPress={onPress}
        onPressIn={() => (pressed.value = 1)}
        onPressOut={() => (pressed.value = 0)}
        style={{
          minHeight: 52,
          borderRadius: radius.lg,
          backgroundColor: scheme.bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.lg,
          gap: spacing.sm,
        }}
      >
        {loading ? (
          <ActivityIndicator color={scheme.fg} />
        ) : (
          <>
            <Animated.Text style={[{ fontSize: 19, color: scheme.icon }, iconStyle]}>
              {glyph}
            </Animated.Text>
            <Animated.Text
              style={[
                { ...typography.bodyStrong, color: scheme.fg, fontWeight: '800' },
                labelStyle,
              ]}
              numberOfLines={1}
            >
              {label}
            </Animated.Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. FLOATING GLASS TAB BAR
   Source: mymiamo/yellow-rattlesnake-26

   The original is a floating translucent pill with `backdrop-filter: blur(12px)
   saturate(180%)`, an inner highlight ring, and a pill highlight on the active
   item.

   Substitution: `backdrop-filter` becomes expo-blur's BlurView, which is the
   real native equivalent. On Android the blur is cheaper and less pronounced,
   so a tinted fill sits underneath to keep the contrast identical.
   ═══════════════════════════════════════════════════════════════════════════ */

export function GlassTabBar({
  items,
  activeKey,
  onSelect,
  bottomInset = 0,
}: {
  items: { key: string; label: string; glyph: string; badge?: number }[];
  activeKey: string;
  onSelect: (key: string) => void;
  bottomInset?: number;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        left: spacing.md,
        right: spacing.md,
        bottom: bottomInset + spacing.md,
        borderRadius: radius.full,
        overflow: 'hidden',
        ...elevation.lg,
      }}
    >
      <BlurView
        intensity={Platform.OS === 'android' ? 40 : 60}
        tint="light"
        style={{
          flexDirection: 'row',
          padding: 6,
          gap: 4,
          backgroundColor: 'rgba(255,255,255,0.72)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.9)',
        }}
      >
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelect(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 0,
                paddingVertical: 9,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active
                  ? '#16181C'
                  : pressed
                    ? 'rgba(0,0,0,0.05)'
                    : 'transparent',
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <View>
                <Text
                  style={{
                    fontSize: 17,
                    lineHeight: 20,
                    color: active ? '#FFFFFF' : '#8A8A8A',
                  }}
                >
                  {item.glyph}
                </Text>
                {item.badge ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -3,
                      right: -8,
                      minWidth: 15,
                      height: 15,
                      paddingHorizontal: 3,
                      borderRadius: radius.full,
                      backgroundColor: '#E10600',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '800' }}>
                      {item.badge > 9 ? '9+' : item.badge}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={{
                  fontSize: 10.5,
                  fontWeight: '600',
                  marginTop: 3,
                  color: active ? '#FFFFFF' : '#8A8A8A',
                }}
                numberOfLines={1}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. 3D PROJECT CARD
   Source: Smit-Prajapati/smart-liger-5

   The original is a mint→green gradient card with `transform-style: preserve-3d`,
   a frosted glass panel whose top-right corner is rounded to 100%, and four
   translucent circles stacked at increasing z-depth.

   Substitution: RN cannot do preserve-3d layering, so depth is conveyed with
   scale, opacity and offset instead. The distinctive giant top-right radius and
   the circle stack are reproduced exactly.
   ═══════════════════════════════════════════════════════════════════════════ */

export function GlassProjectCard({
  title,
  subtitle,
  badge,
  footer,
  onPress,
  colors: colorsProp,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  footer?: React.ReactNode;
  onPress?: () => void;
  colors?: readonly string[];
  children?: React.ReactNode;
}) {
  const pressed = useSharedValue(0);
  const stops = (colorsProp ?? gradients.project) as unknown as string[];

  const animated = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(1 - pressed.value * 0.02, { damping: 18 }) },
      { translateY: withTiming(pressed.value * 2, { duration: 160 }) },
    ],
  }));

  return (
    <Animated.View style={animated}>
      <Pressable
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        onPressIn={() => (pressed.value = 1)}
        onPressOut={() => (pressed.value = 0)}
      >
        <LinearGradient
          colors={stops as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: radius.card,
            padding: 8,
            ...glow(stops[1] ?? stops[0], 0.35, 20),
          }}
        >
          {/* Circle stack, from the original's .logo .circle1-4 */}
          <View
            style={{ position: 'absolute', right: 0, top: 0 }}
            pointerEvents="none"
          >
            {[
              { size: 150, offset: 8, opacity: 0.16 },
              { size: 120, offset: 12, opacity: 0.2 },
              { size: 92, offset: 20, opacity: 0.26 },
              { size: 64, offset: 30, opacity: 0.34 },
            ].map((circle) => (
              <View
                key={circle.size}
                style={{
                  position: 'absolute',
                  right: circle.offset,
                  top: circle.offset,
                  width: circle.size,
                  height: circle.size,
                  borderRadius: circle.size / 2,
                  backgroundColor: `rgba(255,255,255,${circle.opacity})`,
                }}
              />
            ))}
          </View>

          {/* The frosted panel with the oversized top-right corner. */}
          <View
            style={{
              backgroundColor: 'rgba(255,255,255,0.78)',
              borderRadius: radius.card,
              borderTopRightRadius: 110,
              borderLeftWidth: 1,
              borderBottomWidth: 1,
              borderColor: 'rgba(255,255,255,0.9)',
              padding: spacing.xl,
              paddingTop: spacing.xxl,
              minHeight: 150,
              gap: spacing.sm,
            }}
          >
            {badge ? (
              <Text
                style={{
                  ...typography.overline,
                  color: '#00894D',
                  fontSize: 10,
                }}
              >
                {badge}
              </Text>
            ) : null}

            <Text
              style={{ ...typography.h2, color: '#00894D', paddingRight: 70 }}
              numberOfLines={2}
            >
              {title}
            </Text>

            {subtitle ? (
              <Text
                style={{
                  ...typography.caption,
                  color: 'rgba(0,137,78,0.76)',
                  paddingRight: 60,
                }}
                numberOfLines={2}
              >
                {subtitle}
              </Text>
            ) : null}

            {children}

            {footer ? <View style={{ marginTop: spacing.sm }}>{footer}</View> : null}
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. TRUST SCORE STAR
   Source: Javierrocadev/wonderful-bobcat-57

   The original is an eight-point star built from two squares rotated 45° to each
   other, spinning on a loop, with a large numeral in front.

   Kept faithfully: two overlaid rotated squares, one rotation animation, the
   score in front. Recoloured from #efd510/#e10600 to the score's risk band, so
   the colour carries meaning rather than being decorative.
   ═══════════════════════════════════════════════════════════════════════════ */

export function TrustStar({
  score,
  size = 160,
  band,
}: {
  score: number;
  size?: number;
  band?: 'high' | 'mid' | 'low';
}) {
  const { colors } = useTheme();
  const spin = useSharedValue(0);
  const pop = useSharedValue(0);

  React.useEffect(() => {
    // The original's `rot` keyframes: 0 → 340deg → 0, over 3s, forever.
    spin.value = withRepeat(
      withSequence(
        withTiming(340, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    pop.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.back(1.6)) });
  }, [spin, pop]);

  const resolvedBand =
    band ?? (score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low');

  const starColor = {
    high: '#08E260',
    mid: '#FFBF48',
    low: '#F58B8B',
  }[resolvedBand];

  const numberColor = {
    high: '#00894D',
    mid: '#BE4A1D',
    low: '#E10600',
  }[resolvedBand];

  const squareSize = size * 0.62;

  const squareA = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));
  const squareB = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value + 45}deg` }],
  }));
  const numberStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
    opacity: pop.value,
  }));

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {[squareA, squareB].map((style, index) => (
        <Animated.View
          key={index}
          style={[
            {
              position: 'absolute',
              width: squareSize,
              height: squareSize,
              backgroundColor: starColor,
              borderRadius: 12,
              opacity: index === 0 ? 0.95 : 0.75,
              ...glow(starColor, 0.5, 24),
            },
            style,
          ]}
        />
      ))}

      <Animated.View style={[{ alignItems: 'center' }, numberStyle]}>
        <Text
          style={{
            ...typography.display,
            fontSize: size * 0.3,
            color: numberColor,
            fontWeight: '900',
          }}
        >
          {score}
        </Text>
        <Text
          style={{
            ...typography.caption,
            color: numberColor,
            fontWeight: '700',
            opacity: 0.8,
          }}
        >
          / 100
        </Text>
      </Animated.View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. ASSISTANT CARD
   Source: MuhammadHasann/hot-liger-0

   The original is a mint→purple→pink gradient card that tilts in 3D toward
   whichever of fifteen invisible hover zones the cursor is over.

   Substitution: there is no cursor on a phone, so the fifteen-zone tilt is
   replaced by a gentle press-scale. The gradient and proportions are kept.
   ═══════════════════════════════════════════════════════════════════════════ */

export function AssistantCard({
  title,
  body,
  onPress,
  glyph = '✦',
}: {
  title: string;
  body: string;
  onPress?: () => void;
  glyph?: string;
}) {
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(1 - pressed.value * 0.025, { damping: 16 }) },
      { rotateZ: `${pressed.value * 0.6}deg` },
    ],
  }));

  return (
    <Animated.View style={animated}>
      <Pressable
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        onPressIn={() => (pressed.value = 1)}
        onPressOut={() => (pressed.value = 0)}
      >
        <LinearGradient
          colors={gradients.assistant as unknown as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: radius.lg,
            padding: spacing.xl,
            gap: spacing.sm,
            ...glow('#D58FEB', 0.4, 20),
          }}
        >
          <Text style={{ fontSize: 26 }}>{glyph}</Text>
          <Text style={{ ...typography.h3, color: '#1F1F1F' }} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={{ ...typography.caption, color: 'rgba(31,31,31,0.72)' }}
            numberOfLines={3}
          >
            {body}
          </Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. TRANSACTION ROW
   Source: chase2k25/fluffy-stingray-80

   The original is a wide row with a coloured left panel holding a small card
   graphic that animates into an ATM slot on hover.

   Substitution: hover → press. The coloured left panel, the miniature card with
   its magnetic stripe, and the coloured glow are kept; the ATM animation is
   reduced to a lift, because a full ATM sequence inside a list row would be
   noise on a statement people scan.
   ═══════════════════════════════════════════════════════════════════════════ */

export function SlotTransactionRow({
  title,
  subtitle,
  amount,
  direction,
  glyph,
  onPress,
}: {
  title: string;
  subtitle: string;
  amount: string;
  direction: 'CREDIT' | 'DEBIT' | 'INTERNAL';
  glyph: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const pressed = useSharedValue(0);

  const panel =
    direction === 'CREDIT'
      ? colors.success
      : direction === 'INTERNAL'
        ? colors.brand
        : '#3B82F6';

  const animated = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(1 + pressed.value * 0.015, { damping: 18 }) },
      { translateY: withTiming(-pressed.value * 2, { duration: 160 }) },
    ],
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: withTiming(-pressed.value * 7, { duration: 260 }) },
      { rotate: `${pressed.value * -6}deg` },
    ],
  }));

  return (
    <Animated.View style={animated}>
      <Pressable
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        onPressIn={() => (pressed.value = 1)}
        onPressOut={() => (pressed.value = 0)}
        style={{
          flexDirection: 'row',
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
          minHeight: 72,
        }}
      >
        {/* Coloured left panel with the miniature card. */}
        <View
          style={{
            width: 76,
            backgroundColor: panel,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Animated.View
            style={[
              {
                width: 44,
                height: 30,
                borderRadius: 6,
                backgroundColor: 'rgba(255,255,255,0.85)',
                paddingTop: 5,
                alignItems: 'center',
                ...glow('#000000', 0.18, 6),
              },
              cardStyle,
            ]}
          >
            <View
              style={{
                width: 38,
                height: 8,
                borderRadius: 2,
                backgroundColor: panel,
                opacity: 0.55,
              }}
            />
            <Text style={{ fontSize: 9, marginTop: 2 }}>{glyph}</Text>
          </Animated.View>
        </View>

        <View
          style={{
            flex: 1,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            justifyContent: 'center',
            gap: 2,
          }}
        >
          <Text style={{ ...typography.bodyStrong, color: colors.textPrimary }} numberOfLines={1}>
            {title}
          </Text>
          <Text style={{ ...typography.caption, color: colors.textSecondary }} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>

        <View style={{ justifyContent: 'center', paddingRight: spacing.lg }}>
          <Text
            style={{
              ...typography.bodyStrong,
              color:
                direction === 'CREDIT'
                  ? colors.success
                  : direction === 'INTERNAL'
                    ? colors.brand
                    : colors.textPrimary,
            }}
          >
            {amount}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. WALLET CARD STACK
   Source: byllzz/rude-bat-50 (pocket + fanning cards)
           nazar-gavrylyk/weak-treefrog-3 (balance header, card list)

   The original fans a stack of payment cards out of a wallet pocket on hover
   and reveals a masked balance behind an eye toggle.

   Substitution: hover → an explicit tap, which is better here anyway — hiding a
   balance behind a hover is not something a phone can express, and a deliberate
   tap to reveal is the interaction people already know from banking apps.
   ═══════════════════════════════════════════════════════════════════════════ */

export type StackCard = {
  key: string;
  label: string;
  value: string;
  color: string;
  textColor?: string;
};

export function WalletCardStack({
  cards,
  expanded,
  onToggle,
}: {
  cards: StackCard[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Collapse cards' : 'Expand cards'}
      accessibilityState={{ expanded }}
      style={{
        height: expanded ? 96 + cards.length * 74 : 96 + cards.length * 26,
        justifyContent: 'flex-end',
      }}
    >
      {cards.map((card, index) => {
        // Collapsed: a tight overlapping stack. Expanded: fanned into a list.
        const offset = expanded
          ? (cards.length - 1 - index) * 74
          : (cards.length - 1 - index) * 26;
        const tilt = expanded ? 0 : (index - (cards.length - 1) / 2) * 1.5;

        return (
          <Animated.View
            key={card.key}
            entering={FadeIn.delay(index * 80).duration(320)}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: offset,
              zIndex: index,
              transform: [{ rotate: `${tilt}deg` }],
            }}
          >
            <View
              style={{
                height: 96,
                borderRadius: radius.lg,
                backgroundColor: card.color,
                padding: spacing.lg,
                justifyContent: 'space-between',
                ...glow(card.color, 0.35, 14),
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    ...typography.overline,
                    color: card.textColor ?? '#FFFFFF',
                    opacity: 0.85,
                  }}
                >
                  {card.label}
                </Text>
                {/* The chip from the original card face. */}
                <View
                  style={{
                    width: 30,
                    height: 22,
                    borderRadius: 4,
                    backgroundColor: 'rgba(255,255,255,0.25)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.35)',
                  }}
                />
              </View>

              <Text
                style={{
                  ...typography.h2,
                  color: card.textColor ?? '#FFFFFF',
                }}
              >
                {card.value}
              </Text>
            </View>
          </Animated.View>
        );
      })}
    </Pressable>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. BALANCE HEADER — wallet
   Source: nazar-gavrylyk/weak-treefrog-3

   A white card with a rounded icon chip, a muted title above a bold balance,
   and a circular control on the right. Kept close to the original; the control
   toggles visibility rather than collapsing the card.
   ═══════════════════════════════════════════════════════════════════════════ */

export function WalletHeaderCard({
  title,
  balance,
  glyph = '👛',
  hidden,
  onToggleHidden,
  footer,
}: {
  title: string;
  balance: string;
  glyph?: string;
  hidden?: boolean;
  onToggleHidden?: () => void;
  footer?: React.ReactNode;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.xl,
        borderWidth: 2,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: spacing.lg,
          borderBottomWidth: footer ? 2 : 0,
          borderBottomColor: colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              padding: spacing.md,
              borderRadius: radius.lg,
              backgroundColor: colors.surfaceMuted,
            }}
          >
            <Text style={{ fontSize: 20 }}>{glyph}</Text>
          </View>
          <View>
            <Text style={{ ...typography.captionStrong, color: colors.textSecondary }}>
              {title}
            </Text>
            <Text style={{ ...typography.h2, color: colors.textPrimary }}>
              {hidden ? '••••••' : balance}
            </Text>
          </View>
        </View>

        {onToggleHidden ? (
          <Pressable
            onPress={onToggleHidden}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              borderRadius: radius.full,
              borderWidth: 2,
              borderColor: colors.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
            })}
          >
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>
              {hidden ? '🙈' : '👁'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {footer ? <View style={{ padding: spacing.lg }}>{footer}</View> : null}
    </View>
  );
}
