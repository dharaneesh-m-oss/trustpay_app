/**
 * Choose where a withdrawal goes.
 *
 * Only verified destinations are selectable. An unverified one is still listed,
 * greyed, with the reason underneath — hiding it would leave someone wondering
 * where the account they just added went, and enabling it would send money
 * somewhere nobody has confirmed belongs to them.
 *
 * The debit happens the moment this is submitted, before the bank confirms
 * anything. That is deliberate and lives in the service layer: holding the
 * balance until settlement would leave a window in which the same money looks
 * spendable twice.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, ScreenHeader, SoftCard, SoftSection } from '@/components/soft';
import { Button, Row, Screen, Skeleton, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import {
  useBankAccounts,
  usePaymentsStatus,
  useRequestPayout,
  useUpiAccounts,
} from '@/lib/payments';
import { useTheme } from '@/theme';

type Choice =
  | { kind: 'bank'; id: string }
  | { kind: 'upi'; id: string };

export default function Payout() {
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ amount?: string }>();

  const amount = params.amount ?? '0';

  const banks = useBankAccounts();
  const upis = useUpiAccounts();
  const status = usePaymentsStatus();
  const request = useRequestPayout();

  const [choice, setChoice] = React.useState<Choice | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const verifiedBanks = (banks.data ?? []).filter((a) => a.status === 'VERIFIED');
  const verifiedUpis = (upis.data ?? []).filter((a) => a.status === 'VERIFIED');
  const nothingUsable =
    !banks.isLoading &&
    !upis.isLoading &&
    verifiedBanks.length === 0 &&
    verifiedUpis.length === 0;

  // Preselect the only sensible option rather than making someone tap it.
  React.useEffect(() => {
    if (choice) return;
    const bank = verifiedBanks.find((a) => a.is_default) ?? verifiedBanks[0];
    const upi = verifiedUpis.find((a) => a.is_default) ?? verifiedUpis[0];
    if (bank) setChoice({ kind: 'bank', id: bank.id });
    else if (upi) setChoice({ kind: 'upi', id: upi.id });
  }, [banks.data, upis.data, choice, verifiedBanks, verifiedUpis]);

  const submit = async () => {
    if (!choice) return;
    setError(null);
    try {
      await request.mutateAsync(
        choice.kind === 'bank'
          ? { amount, bank_account_id: choice.id }
          : { amount, upi_account_id: choice.id },
      );
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'That withdrawal could not be started.',
      );
    }
  };

  const row = (
    key: string,
    kind: Choice['kind'],
    id: string,
    title: string,
    subtitle: string,
    usable: boolean,
    reason: string | null,
  ) => {
    const selected = choice?.kind === kind && choice.id === id;
    return (
      <SoftCard
        key={key}
        depth={selected ? 'lg' : 'sm'}
        onPress={usable ? () => setChoice({ kind, id }) : undefined}
        style={
          selected
            ? { borderWidth: 1.5, borderColor: colors.brand }
            : usable
              ? undefined
              : { opacity: 0.55 }
        }
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Txt variant="bodyStrong">{title}</Txt>
            <Txt variant="caption" tone="secondary">
              {subtitle}
            </Txt>
          </View>
          {usable ? (
            selected ? (
              <Chip label="selected" tone="solid" />
            ) : null
          ) : (
            <Chip label="unverified" tone="warning" />
          )}
        </Row>
        {reason ? (
          <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
            {reason}
          </Txt>
        ) : null}
      </SoftCard>
    );
  };

  if (done) {
    return (
      <Screen contentStyle={{ paddingTop: insets.top + spacing.md, gap: spacing.xl }}>
        <ScreenHeader title="withdrawal" />
        <SoftCard>
          <Txt variant="h3">Withdrawal started</Txt>
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
            {formatMoney(amount, 'INR')} is on its way
            {choice?.kind === 'upi'
              ? '. UPI usually arrives within seconds.'
              : '. Bank transfers usually take a few minutes.'}{' '}
            It has already left your available balance, and returns there
            automatically if the bank rejects it.
          </Txt>
          <View style={{ marginTop: spacing.xl }}>
            <Button title="Done" onPress={() => router.replace('/(tabs)/wallet')} />
          </View>
        </SoftCard>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md, gap: spacing.xl }}>
      <ScreenHeader title="withdraw_to" onBack={() => router.back()} />

      <SoftCard>
        <Txt variant="caption" tone="tertiary">
          Withdrawing
        </Txt>
        <Txt style={{ fontSize: 38, lineHeight: 46, fontWeight: '400' }}>
          {formatMoney(amount, 'INR')}
        </Txt>
        {status.data ? (
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
            Minimum {formatMoney(status.data.minimum_payout, 'INR')} · daily limit{' '}
            {formatMoney(status.data.daily_payout_limit, 'INR')}
          </Txt>
        ) : null}
      </SoftCard>

      {banks.isLoading || upis.isLoading ? (
        <Skeleton height={90} />
      ) : nothingUsable ? (
        <SoftCard>
          <Txt variant="bodyStrong">No verified destination yet</Txt>
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
            Add a bank account or a UPI ID and have it verified before
            withdrawing.
          </Txt>
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <Button
              title="Add a bank account"
              onPress={() => router.replace('/wallet/bank-accounts')}
            />
            <Button
              title="Add a UPI ID"
              variant="secondary"
              onPress={() => router.replace('/wallet/upi-accounts')}
            />
          </View>
        </SoftCard>
      ) : (
        <>
          {(banks.data?.length ?? 0) > 0 ? (
            <View>
              <SoftSection title="bank accounts" />
              <View style={{ gap: spacing.md }}>
                {banks.data!.map((account) =>
                  row(
                    account.id,
                    'bank',
                    account.id,
                    account.bank_name,
                    `•••• ${account.account_last4} · ${account.ifsc}`,
                    account.status === 'VERIFIED',
                    account.status === 'VERIFIED' ? null : account.failure_reason,
                  ),
                )}
              </View>
            </View>
          ) : null}

          {(upis.data?.length ?? 0) > 0 ? (
            <View>
              <SoftSection title="upi ids" />
              <View style={{ gap: spacing.md }}>
                {upis.data!.map((account) =>
                  row(
                    account.id,
                    'upi',
                    account.id,
                    account.vpa,
                    account.holder_name,
                    account.status === 'VERIFIED',
                    account.status === 'VERIFIED' ? null : account.failure_reason,
                  ),
                )}
              </View>
            </View>
          ) : null}

          {error ? (
            <Txt variant="caption" tone="danger" style={{ textAlign: 'center' }}>
              {error}
            </Txt>
          ) : null}

          <Button
            title={request.isPending ? 'Starting…' : 'Withdraw'}
            loading={request.isPending}
            disabled={!choice || request.isPending}
            onPress={submit}
          />
        </>
      )}
    </Screen>
  );
}
