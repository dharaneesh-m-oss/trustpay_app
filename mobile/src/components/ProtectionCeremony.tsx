/**
 * The moment funds become protected.
 *
 * Section 43 calls this one of the most important emotional moments in the app,
 * and it is right: the client has just committed money they cannot spend, on a
 * promise. The animation walks the three states — funding, verifying, protected
 * — so the commitment feels deliberate and finished rather than instantaneous
 * and unremarked.
 *
 * It is short, it cannot be got stuck in, and tapping anywhere dismisses it.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Txt } from '@/components/ui';
import { useTheme } from '@/theme';

const STEPS = ['Funding', 'Verifying', 'Protected'] as const;

export function ProtectionCeremony({
  amount,
  onDone,
}: {
  amount: string;
  onDone: () => void;
}) {
  const { colors, spacing, radius } = useTheme();
  const [step, setStep] = useState(0);

  const shieldScale = useSharedValue(0.6);
  const shieldOpacity = useSharedValue(0);
  const ringScale = useSharedValue(0.8);

  useEffect(() => {
    shieldOpacity.value = withTiming(1, { duration: 260 });
    shieldScale.value = withSequence(
      withTiming(1.06, { duration: 320, easing: Easing.out(Easing.cubic) }),
      withSpring(1, { damping: 12 }),
    );
    ringScale.value = withDelay(
      420,
      withTiming(1.35, { duration: 780, easing: Easing.out(Easing.quad) }),
    );

    const first = setTimeout(() => setStep(1), 520);
    const second = setTimeout(() => setStep(2), 1080);
    // Auto-dismiss: nobody should have to tap through a confirmation twice.
    const close = setTimeout(onDone, 2400);

    return () => {
      clearTimeout(first);
      clearTimeout(second);
      clearTimeout(close);
    };
  }, [shieldOpacity, shieldScale, ringScale, onDone]);

  const shieldStyle = useAnimatedStyle(() => ({
    opacity: shieldOpacity.value,
    transform: [{ scale: shieldScale.value }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: 1 - (ringScale.value - 0.8) / 0.75,
  }));

  return (
    <Modal transparent animationType="fade" onRequestClose={onDone}>
      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={{
          flex: 1,
          backgroundColor: colors.overlay,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
        }}
      >
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(160)}
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.xxl,
            padding: spacing.xxxl,
            alignItems: 'center',
            gap: spacing.lg,
            width: '100%',
            maxWidth: 340,
          }}
        >
          <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  width: 96,
                  height: 96,
                  borderRadius: radius.full,
                  borderWidth: 2,
                  borderColor: colors.brand,
                },
                ringStyle,
              ]}
            />
            <Animated.View
              style={[
                {
                  width: 72,
                  height: 72,
                  borderRadius: radius.full,
                  backgroundColor: colors.brandMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                shieldStyle,
              ]}
            >
              <Txt variant="h1">🛡️</Txt>
            </Animated.View>
          </View>

          <View style={{ alignItems: 'center', gap: spacing.xs }}>
            <Txt variant="overline" tone="brand">
              {STEPS[step]}
            </Txt>
            <Txt variant="display" style={{ fontSize: 30 }}>
              {amount}
            </Txt>
          </View>

          {step === 2 ? (
            <Animated.View entering={FadeIn.duration(240)} style={{ alignItems: 'center' }}>
              <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
                These funds are held for this milestone. They are released when you
                approve the submitted work.
              </Txt>
            </Animated.View>
          ) : null}

          {/* Progress rail */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {STEPS.map((label, index) => (
              <View
                key={label}
                style={{
                  width: index === step ? 20 : 7,
                  height: 4,
                  borderRadius: radius.full,
                  backgroundColor: index <= step ? colors.brand : colors.border,
                }}
              />
            ))}
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
