/**
 * Add money.
 *
 * A numeric keypad rather than a text field, because that is what entering an
 * amount feels like in every payments app people already use — and because it
 * makes a decimal-string amount easy to build without a keyboard that can
 * produce nonsense.
 */

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Amount } from '@/components/product';
import { Card, Row, Txt } from '@/components/ui';
import { SlideActionButton } from '@/components/uiverse';
import { ApiError } from '@/lib/api';
import { useTopUp, useWallet } from '@/lib/queries';
import { useTheme } from '@/theme';

const PRESETS = ['500', '1000', '5000', '25000'];

export default function AddMoney() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const wallet = useWallet();
  const topUp = useTopUp();
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Held as paise so the amount never passes through a float.
  const amount = digitsToAmount(digits);
  const currency = wallet.data?.currency ?? 'INR';

  const press = (key: string) => {
    setError(null);
    if (key === '⌫') {
      setDigits((current) => current.slice(0, -1));
    } else if (digits.length < 9) {
      setDigits((current) => (current === '0' ? key : current + key));
    }
  };

  const submit = async () => {
    setError(null);
    try {
      await topUp.mutateAsync(amount);
      router.back();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'That did not go through.',
      );
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top + spacing.lg,
        paddingBottom: insets.bottom + spacing.lg,
        paddingHorizontal: spacing.xl,
        gap: spacing.lg,
      }}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h2">Add money</Txt>
        <Txt
          variant="body"
          tone="secondary"
          accessibilityRole="button"
          onPress={() => router.back()}
        >
          Cancel
        </Txt>
      </Row>

      <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
        <Amount value={amount} currency={currency} size="display" />
        <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
          {wallet.data?.demo_mode
            ? 'Simulated deposit — no real money moves'
            : 'Added to your available balance'}
        </Txt>
      </View>

      <Row gap={spacing.sm}>
        {PRESETS.map((preset) => (
          <Pressable
            key={preset}
            onPress={() => setDigits(String(Number(preset) * 100))}
            accessibilityRole="button"
            style={{
              flex: 1,
              paddingVertical: spacing.md,
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              alignItems: 'center',
            }}
          >
            <Txt variant="captionStrong">₹{Number(preset).toLocaleString('en-IN')}</Txt>
          </Pressable>
        ))}
      </Row>

      {error ? (
        <Card style={{ backgroundColor: colors.dangerMuted, borderColor: colors.danger }}>
          <Txt variant="caption" tone="danger">
            {error}
          </Txt>
        </Card>
      ) : null}

      <View style={{ flex: 1, justifyContent: 'flex-end', gap: spacing.lg }}>
        <Keypad onPress={press} />
        <SlideActionButton
          label="Add money"
          glyph="＋"
          tone="brand"
          onPress={submit}
          loading={topUp.isPending}
          disabled={Number(digits || '0') <= 0}
        />
      </View>
    </View>
  );
}

/** "12345" (paise) → "123.45" */
export function digitsToAmount(digits: string): string {
  const paise = Number(digits || '0');
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

export function Keypad({ onPress }: { onPress: (key: string) => void }) {
  const { colors, spacing, radius, typography } = useTheme();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'];

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {keys.map((key) => (
        <Pressable
          key={key}
          onPress={() => onPress(key)}
          accessibilityRole="button"
          accessibilityLabel={key === '⌫' ? 'Delete' : key}
          style={({ pressed }) => ({
            width: '31.5%',
            height: 56,
            borderRadius: radius.md,
            backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          <Txt style={{ ...typography.h2, fontWeight: '600' }}>{key}</Txt>
        </Pressable>
      ))}
    </View>
  );
}
