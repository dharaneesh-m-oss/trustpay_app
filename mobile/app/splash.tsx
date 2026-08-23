/**
 * Splash.
 *
 * The animation is the logo's meaning acted out: two forms travel toward each
 * other, meet, and the protected amount appears between them. It runs once, in
 * a little under a second and a half, and then gets out of the way — a splash
 * that outstays its welcome is just a delay.
 */

import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Txt } from '@/components/ui';
import { OrbLoader } from '@/components/uiverse';
import { useTheme } from '@/theme';

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const { colors, spacing } = useTheme();

  const leftX = useSharedValue(-70);
  const rightX = useSharedValue(70);
  const barScale = useSharedValue(0);
  const wordmark = useSharedValue(0);
  const tagline = useSharedValue(0);

  useEffect(() => {
    // 1–2. The two parties move in.
    leftX.value = withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) });
    rightX.value = withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) });

    // 3. The connection forms and the protected amount appears between them.
    barScale.value = withDelay(560, withSpring(1, { damping: 12, stiffness: 160 }));

    // 4–5. Name, then tagline.
    wordmark.value = withDelay(720, withTiming(1, { duration: 340 }));
    tagline.value = withDelay(
      950,
      withSequence(
        withTiming(1, { duration: 340 }),
        // Hand control back only after the sequence has actually finished.
        withDelay(
          260,
          withTiming(1, { duration: 1 }, (finished) => {
            if (finished) runOnJS(onDone)();
          }),
        ),
      ),
    );
  }, [leftX, rightX, barScale, wordmark, tagline, onDone]);

  const leftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: leftX.value }],
    opacity: 1 - Math.abs(leftX.value) / 90,
  }));
  const rightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: rightX.value }],
    opacity: 1 - Math.abs(rightX.value) / 90,
  }));
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: barScale.value }],
    opacity: barScale.value,
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmark.value,
    transform: [{ translateY: (1 - wordmark.value) * 10 }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: tagline.value }));

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xxl,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: 64,
          gap: 10,
        }}
      >
        <Animated.View
          style={[
            {
              width: 22,
              height: 52,
              borderTopLeftRadius: 26,
              borderBottomLeftRadius: 26,
              borderWidth: 5,
              borderRightWidth: 0,
              borderColor: colors.brand,
            },
            leftStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              width: 7,
              height: 30,
              borderRadius: 4,
              backgroundColor: colors.brand,
            },
            barStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              width: 22,
              height: 52,
              borderTopRightRadius: 26,
              borderBottomRightRadius: 26,
              borderWidth: 5,
              borderLeftWidth: 0,
              borderColor: colors.textPrimary,
            },
            rightStyle,
          ]}
        />
      </View>

      <View style={{ alignItems: 'center', gap: spacing.lg }}>
        <Animated.View style={wordmarkStyle}>
          <OrbLoader size={64} />
        </Animated.View>
        <Animated.View style={wordmarkStyle}>
          <Txt variant="h1" style={{ letterSpacing: 2 }}>
            TRUSTPAY
          </Txt>
        </Animated.View>
        <Animated.View style={taglineStyle}>
          <Txt variant="caption" tone="secondary" style={{ letterSpacing: 2 }}>
            TRUST. PROTECTED.
          </Txt>
        </Animated.View>
      </View>
    </View>
  );
}
