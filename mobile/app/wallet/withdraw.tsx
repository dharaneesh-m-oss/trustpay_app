import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Amount } from '@/components/product';
import { Card, Row, Txt } from '@/components/ui';
import { SlideActionButton } from '@/components/uiverse';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { usePaymentsStatus } from '@/lib/payments';
import { useWallet, useWithdraw } from '@/lib/queries';
import { useTheme } from '@/theme';

import { Keypad, digitsToAmount } from './add-money';

export default function Withdraw() {
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const wallet = useWallet();
  const withdraw = useWithdraw();
  const payments = usePaymentsStatus();
  const live = payments.data?.payouts_enabled ?? false;
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);

  const amount = digitsToAmount(digits);
  const currency = wallet.data?.currency ?? 'INR';
  const available = wallet.data?.available ?? '0.00';

  // Compared as paise integers — comparing decimal strings as numbers is how
  // rounding bugs get into a "can you afford this?" check.
  const exceedsBalance =
    Number(digits || '0') > Math.round(Number(available.replace(/,/g, '')) * 100);

  const submit = async () => {
    setError(null);

    // A real payout needs a destination and a provider. The simulated path
    // exists only where there is neither.
    if (live) {
      router.replace({ pathname: '/wallet/payout', params: { amount } });
      return;
    }

    try {
      await withdraw.mutateAsync(amount);
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
        <Txt variant="h2">Withdraw</Txt>
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
        <Amount
          value={amount}
          currency={currency}
          size="display"
          tone={exceedsBalance ? 'danger' : 'primary'}
        />
        <Txt
          variant="caption"
          tone={exceedsBalance ? 'danger' : 'tertiary'}
          style={{ marginTop: spacing.sm }}
        >
          {exceedsBalance
            ? 'More than your available balance'
            : `${formatMoney(available, currency)} available`}
        </Txt>
      </View>

      <Card>
        <Txt variant="caption" tone="secondary">
          Only available funds can be withdrawn. Money protected against a milestone
          stays there until the work is approved or the milestone is cancelled.
        </Txt>
      </Card>

      {error ? (
        <Card style={{ backgroundColor: colors.dangerMuted, borderColor: colors.danger }}>
          <Txt variant="caption" tone="danger">
            {error}
          </Txt>
        </Card>
      ) : null}

      <View style={{ flex: 1, justifyContent: 'flex-end', gap: spacing.lg }}>
        <Keypad
          onPress={(key) => {
            setError(null);
            if (key === '⌫') setDigits((current) => current.slice(0, -1));
            else if (digits.length < 9)
              setDigits((current) => (current === '0' ? key : current + key));
          }}
        />
        <SlideActionButton
          label="Withdraw"
          glyph="↑"
          tone="dark"
          onPress={submit}
          loading={withdraw.isPending}
          disabled={Number(digits || '0') <= 0 || exceedsBalance}
        />
      </View>
    </View>
  );
}
