/**
 * Add money by UPI.
 *
 * The flow is: enter an amount, pick an installed UPI app, pay there, come back
 * and wait for confirmation.
 *
 * That last step is the whole point of this screen. Android tells the app the
 * user returned, never whether they paid, so the return is treated as meaning
 * nothing at all. The screen polls its own server, and the balance changes only
 * when the payment provider has confirmed over a signed webhook.
 *
 * It would be easy - and wrong - to mark this successful on return and let the
 * balance catch up later. Anyone could then top up for free by opening a UPI
 * app and pressing back.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, CircleButton, ScreenHeader, SoftCard, SoftSection } from '@/components/soft';
import { Button, Field, Row, Screen, Txt } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import {
  installedUpiApps,
  openUpiApp,
  usePaymentsStatus,
  useStartTopUp,
  type PaymentIntent,
  type UpiTarget,
} from '@/lib/payments';
import { keys as walletKeys } from '@/lib/queries';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/theme';

const QUICK_AMOUNTS = ['500', '1000', '2500', '5000'];

type Phase = 'amount' | 'choose-app' | 'waiting' | 'done' | 'failed';

export default function UpiTopUp() {
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();

  const status = usePaymentsStatus();
  const start = useStartTopUp();

  const [amount, setAmount] = React.useState('');
  const [phase, setPhase] = React.useState<Phase>('amount');
  const [intent, setIntent] = React.useState<PaymentIntent | null>(null);
  const [apps, setApps] = React.useState<UpiTarget[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);

  const numeric = Number.parseFloat(amount || '0');
  const valid = Number.isFinite(numeric) && numeric > 0;

  const begin = async () => {
    setError(null);
    try {
      const created = await start.mutateAsync(numeric.toFixed(2));
      setIntent(created);

      const available = await installedUpiApps(created.upi_targets);
      // Falling back to the generic `upi://` target lets Android show its own
      // chooser when no specific app answered our probe.
      setApps(
        available.length > 0
          ? available
          : created.upi_targets.filter((target) => target.key === 'any'),
      );
      setPhase('choose-app');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not start that payment.',
      );
    }
  };

  const pay = async (target: UpiTarget) => {
    const opened = await openUpiApp(target);
    if (!opened) {
      setError(
        `${target.label} did not open. It may not be installed on this phone.`,
      );
      return;
    }
    setElapsed(0);
    setPhase('waiting');
  };

  // Poll for the provider's verdict. Nothing else can produce one.
  React.useEffect(() => {
    if (phase !== 'waiting' || !intent) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      setElapsed((value) => value + 3);
      try {
        const { data } = await api.get<{
          status: string;
          credited: boolean;
          failure_reason: string | null;
        }>(`/payments/top-up/${intent.id}`);

        if (cancelled) return;

        if (data.credited && data.status === 'SUCCEEDED') {
          setPhase('done');
          client.invalidateQueries({ queryKey: walletKeys.wallet });
          client.invalidateQueries({ queryKey: walletKeys.transactions });
        } else if (data.status === 'FAILED' || data.status === 'EXPIRED') {
          setError(data.failure_reason ?? 'That payment did not go through.');
          setPhase('failed');
        }
      } catch {
        // A dropped poll is not a failed payment. Keep waiting.
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, intent, client]);

  const disabled = status.data && !status.data.collections_enabled;

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md, gap: spacing.xl }}>
      <ScreenHeader title="add_money" onBack={() => router.back()} />

      {disabled ? (
        <SoftCard>
          <Txt variant="bodyStrong">Adding money is not switched on</Txt>
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
            {status.data?.note}
          </Txt>
        </SoftCard>
      ) : null}

      {phase === 'amount' ? (
        <>
          <SoftCard>
            <Txt variant="caption" tone="tertiary">
              Amount
            </Txt>
            <Row gap={spacing.xs} style={{ alignItems: 'baseline' }}>
              <Txt style={{ fontSize: 34, lineHeight: 44, fontWeight: '400' }}>₹</Txt>
              <Field
                label=""
                value={amount}
                onChangeText={(text) => setAmount(text.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0"
                style={{
                  fontSize: 34,
                  fontWeight: '400',
                  borderWidth: 0,
                  paddingHorizontal: 0,
                  minHeight: 46,
                  flex: 1,
                }}
              />
            </Row>

            <Row gap={spacing.sm} style={{ marginTop: spacing.lg, flexWrap: 'wrap' }}>
              {QUICK_AMOUNTS.map((value) => (
                <Chip
                  key={value}
                  label={`₹${value}`}
                  tone={amount === value ? 'solid' : 'neutral'}
                  style={{ overflow: 'hidden' }}
                />
              ))}
            </Row>
            <Row gap={spacing.sm} style={{ marginTop: spacing.sm, flexWrap: 'wrap' }}>
              {QUICK_AMOUNTS.map((value) => (
                <Button
                  key={value}
                  title={`₹${value}`}
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => setAmount(value)}
                  style={{ minHeight: 40, paddingHorizontal: spacing.lg }}
                />
              ))}
            </Row>
          </SoftCard>

          {error ? (
            <Txt variant="caption" tone="danger" style={{ textAlign: 'center' }}>
              {error}
            </Txt>
          ) : null}

          <Button
            title={start.isPending ? 'Starting…' : 'Continue'}
            loading={start.isPending}
            disabled={!valid || Boolean(disabled) || start.isPending}
            onPress={begin}
          />
        </>
      ) : null}

      {phase === 'choose-app' && intent ? (
        <>
          <SoftCard>
            <Txt variant="caption" tone="tertiary">
              Paying
            </Txt>
            <Txt style={{ fontSize: 34, lineHeight: 44, fontWeight: '400' }}>
              {formatMoney(intent.amount, intent.currency)}
            </Txt>
            <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
              Reference {intent.reference}
            </Txt>
          </SoftCard>

          <View>
            <SoftSection title="pay with" />
            <View style={{ gap: spacing.md }}>
              {apps.map((target) => (
                <SoftCard key={target.key} onPress={() => pay(target)}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt variant="bodyStrong">{target.label}</Txt>
                    <Txt variant="body" tone="secondary">
                      →
                    </Txt>
                  </Row>
                </SoftCard>
              ))}
              {apps.length === 0 ? (
                <SoftCard>
                  <Txt variant="caption" tone="secondary">
                    No UPI apps were found on this phone. Install GPay, PhonePe
                    or Paytm and try again.
                  </Txt>
                </SoftCard>
              ) : null}
            </View>
          </View>

          {error ? (
            <Txt variant="caption" tone="danger" style={{ textAlign: 'center' }}>
              {error}
            </Txt>
          ) : null}
        </>
      ) : null}

      {phase === 'waiting' ? (
        <SoftCard>
          <Txt variant="h3">Waiting for your bank</Txt>
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
            Your wallet updates when the payment is confirmed, usually within a
            few seconds. You can leave this screen — the confirmation does not
            depend on it staying open.
          </Txt>

          {elapsed > 45 ? (
            <Txt variant="caption" tone="warning" style={{ marginTop: spacing.lg }}>
              This is taking longer than usual. If money left your account it
              will still arrive; if the payment was cancelled, nothing was taken.
            </Txt>
          ) : null}

          <View style={{ marginTop: spacing.xl }}>
            <Button
              title="Back to wallet"
              variant="secondary"
              onPress={() => router.back()}
            />
          </View>
        </SoftCard>
      ) : null}

      {phase === 'done' && intent ? (
        <SoftCard>
          <Row gap={spacing.md}>
            <CircleButton
              glyph="✓"
              accessibilityLabel="Confirmed"
              tone="solid"
              onPress={() => undefined}
            />
            <View style={{ flex: 1 }}>
              <Txt variant="h3">Money added</Txt>
              <Txt variant="caption" tone="secondary">
                {formatMoney(intent.amount, intent.currency)} is in your wallet.
              </Txt>
            </View>
          </Row>
          <View style={{ marginTop: spacing.xl }}>
            <Button title="Done" onPress={() => router.back()} />
          </View>
        </SoftCard>
      ) : null}

      {phase === 'failed' ? (
        <SoftCard>
          <Txt variant="h3">That payment did not complete</Txt>
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
            {error ?? 'Nothing was taken from your account.'}
          </Txt>
          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            <Button title="Try again" onPress={() => setPhase('amount')} />
            <Button
              title="Back to wallet"
              variant="secondary"
              onPress={() => router.back()}
            />
          </View>
        </SoftCard>
      ) : null}
    </Screen>
  );
}
