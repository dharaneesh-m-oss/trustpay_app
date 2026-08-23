/**
 * The balance lock UI: a PIN sheet, and the hook screens use to reveal money.
 *
 * The flow, in the order a person meets it:
 *   1. Tap a masked balance.
 *   2. Face ID / fingerprint prompt, if the device has one enrolled.
 *   3. If they dismiss it, or the device has no biometrics, the PIN sheet.
 *   4. First time ever, the PIN sheet asks them to choose one (twice).
 *
 * Nothing here reads a balance. It only decides whether the screen may.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { Row, Txt } from '@/components/ui';
import { PIN_LENGTH, setPin, verifyPin, type LockCapability } from '@/lib/balance-lock';
import { useBalanceLock } from '@/store/balance-lock';
import { useTheme } from '@/theme';

/* ───────────────────────────────────────────────────────────────── the hook */

type Reveal = {
  unlocked: boolean;
  checking: boolean;
  /** What the device can do, so screens can name the right unlock method. */
  capability: LockCapability | null;
  /** Call from a tap handler to reveal the balance. */
  reveal: () => void;
  /** Re-hide immediately. */
  hide: () => void;
  /** Render this near the balance so the PIN sheet has somewhere to live. */
  sheet: React.ReactNode;
};

export function useBalanceReveal(): Reveal {
  const {
    unlocked,
    checking,
    capability,
    requestUnlock,
    refreshCapability,
    lock,
    markUnlocked,
  } = useBalanceLock();

  const [mode, setMode] = useState<'closed' | 'enter' | 'create'>('closed');

  useEffect(() => {
    refreshCapability();
  }, [refreshCapability]);

  const reveal = useCallback(async () => {
    const outcome = await requestUnlock();
    if (outcome.status === 'needs-pin') setMode('enter');
    else if (outcome.status === 'needs-pin-setup') setMode('create');
  }, [requestUnlock]);

  const sheet = (
    <PinSheet
      mode={mode}
      onClose={() => setMode('closed')}
      onSuccess={() => {
        setMode('closed');
        markUnlocked();
      }}
    />
  );

  return {
    unlocked,
    checking,
    capability,
    reveal: () => {
      if (unlocked) lock();
      else void reveal();
    },
    hide: lock,
    sheet,
  };
}

/* ────────────────────────────────────────────────────────────── the PIN sheet */

function PinSheet({
  mode,
  onClose,
  onSuccess,
}: {
  mode: 'closed' | 'enter' | 'create';
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { colors, spacing, radius, typography } = useTheme();

  const [entry, setEntry] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  const reset = () => {
    setEntry('');
    setConfirmation(null);
    setError(null);
  };

  useEffect(() => {
    if (mode === 'closed') reset();
  }, [mode]);

  const wrong = (message: string) => {
    setError(message);
    setEntry('');
    shake.value = withSequence(
      withTiming(-9, { duration: 55 }),
      withTiming(9, { duration: 55 }),
      withTiming(-6, { duration: 55 }),
      withTiming(0, { duration: 55 }),
    );
  };

  const submit = useCallback(
    async (pin: string) => {
      if (mode === 'enter') {
        if (await verifyPin(pin)) {
          onSuccess();
        } else {
          wrong('That PIN is not correct.');
        }
        return;
      }

      // Creating: first pass captures, second pass must match.
      if (confirmation === null) {
        setConfirmation(pin);
        setEntry('');
        setError(null);
        return;
      }

      if (confirmation === pin) {
        await setPin(pin);
        onSuccess();
      } else {
        setConfirmation(null);
        wrong('Those did not match. Start again.');
      }
    },
    [mode, confirmation, onSuccess],
  );

  const press = (key: string) => {
    setError(null);
    if (key === '⌫') {
      setEntry((current) => current.slice(0, -1));
      return;
    }
    const next = (entry + key).slice(0, PIN_LENGTH);
    setEntry(next);
    if (next.length === PIN_LENGTH) {
      // Let the last dot paint before the sheet reacts.
      setTimeout(() => void submit(next), 120);
    }
  };

  const title =
    mode === 'create'
      ? confirmation === null
        ? 'Choose a PIN'
        : 'Confirm your PIN'
      : 'Enter your PIN';

  const subtitle =
    mode === 'create'
      ? confirmation === null
        ? `${PIN_LENGTH} digits. You will need it to see your balance.`
        : 'Enter the same PIN again.'
      : 'This shows your balance on this device.';

  return (
    <Modal
      visible={mode !== 'closed'}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
      >
        <Animated.View
          entering={FadeInDown.duration(240)}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xxl,
            borderTopRightRadius: radius.xxl,
            padding: spacing.xl,
            paddingBottom: spacing.huge,
            gap: spacing.xl,
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: radius.full,
              backgroundColor: colors.borderStrong,
              alignSelf: 'center',
            }}
          />

          <View style={{ alignItems: 'center', gap: spacing.xs }}>
            <Text style={{ fontSize: 30 }}>🔒</Text>
            <Txt variant="h2">{title}</Txt>
            <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              {subtitle}
            </Txt>
          </View>

          {/* Dots */}
          <Animated.View style={shakeStyle}>
            <Row gap={spacing.lg} style={{ justifyContent: 'center' }}>
              {Array.from({ length: PIN_LENGTH }).map((_, index) => {
                const filled = index < entry.length;
                return (
                  <View
                    key={index}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: radius.full,
                      borderWidth: 2,
                      borderColor: error
                        ? colors.danger
                        : filled
                          ? colors.brand
                          : colors.borderStrong,
                      backgroundColor: filled
                        ? error
                          ? colors.danger
                          : colors.brand
                        : 'transparent',
                    }}
                  />
                );
              })}
            </Row>
          </Animated.View>

          {error ? (
            <Animated.View entering={FadeIn.duration(180)}>
              <Txt variant="caption" tone="danger" style={{ textAlign: 'center' }}>
                {error}
              </Txt>
            </Animated.View>
          ) : null}

          {/* Keypad */}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: spacing.sm,
              justifyContent: 'center',
            }}
          >
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(
              (key, index) =>
                key === '' ? (
                  <View key={`spacer-${index}`} style={{ width: '30%', height: 58 }} />
                ) : (
                  <Pressable
                    key={key}
                    onPress={() => press(key)}
                    accessibilityRole="button"
                    accessibilityLabel={key === '⌫' ? 'Delete' : key}
                    style={({ pressed }) => ({
                      width: '30%',
                      height: 58,
                      borderRadius: radius.lg,
                      backgroundColor: pressed
                        ? colors.surfaceMuted
                        : colors.background,
                      alignItems: 'center',
                      justifyContent: 'center',
                    })}
                  >
                    <Text
                      style={{
                        ...typography.h2,
                        color: colors.textPrimary,
                        fontWeight: '600',
                      }}
                    >
                      {key}
                    </Text>
                  </Pressable>
                ),
            )}
          </View>

          <Txt
            variant="captionStrong"
            tone="secondary"
            style={{ textAlign: 'center' }}
            accessibilityRole="button"
            onPress={onClose}
          >
            Cancel
          </Txt>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────── the masked amount */

/**
 * Renders a balance, or dots plus a hint, depending on the lock.
 *
 * Everything that shows money goes through this, so no screen can accidentally
 * render an amount the person has not unlocked.
 */
export function LockedAmount({
  value,
  unlocked,
  checking,
  onPress,
  style,
  maskedStyle,
  mask = '••••••',
}: {
  value: string;
  unlocked: boolean;
  checking?: boolean;
  onPress?: () => void;
  style?: object;
  maskedStyle?: object;
  mask?: string;
}) {
  const content = unlocked ? (
    <Animated.Text entering={FadeIn.duration(260)} style={style}>
      {value}
    </Animated.Text>
  ) : (
    <Text style={[style, maskedStyle]}>{checking ? '· · ·' : mask}</Text>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={unlocked ? 'Hide balance' : 'Show balance'}
      accessibilityState={{ expanded: unlocked }}
    >
      {content}
    </Pressable>
  );
}
