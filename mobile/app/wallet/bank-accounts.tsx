/**
 * Bank accounts for withdrawals.
 *
 * The IFSC is looked up against the live bank registry as it is typed, so the
 * branch appears under the field before anything is submitted. That turns the
 * most common failure - one wrong character in an eleven-character code - into
 * something the user sees immediately rather than a payout that bounces days
 * later.
 *
 * What the screen deliberately does not do is call an account "verified"
 * because it looks plausible. Ownership is only established by a penny drop
 * through the payment provider, so an account added without that stays PENDING
 * and says why.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, ScreenHeader, SoftCard, SoftSection } from '@/components/soft';
import { Button, Field, Row, Screen, Skeleton, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import {
  useAddBankAccount,
  useBankAccounts,
  useIfscLookup,
  usePaymentsStatus,
  type IfscLookup,
} from '@/lib/payments';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

const STATUS_TONE = {
  VERIFIED: 'success',
  PENDING: 'warning',
  REJECTED: 'danger',
  FAILED: 'danger',
} as const;

const STATUS_LABEL = {
  VERIFIED: 'verified',
  PENDING: 'not yet verified',
  REJECTED: 'rejected',
  FAILED: 'failed',
} as const;

export default function BankAccounts() {
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuth((state) => state.user);

  const accounts = useBankAccounts();
  const status = usePaymentsStatus();
  const lookup = useIfscLookup();
  const add = useAddBankAccount();

  const [holder, setHolder] = React.useState(user?.full_name ?? '');
  const [ifsc, setIfsc] = React.useState('');
  const [number, setNumber] = React.useState('');
  const [confirmNumber, setConfirmNumber] = React.useState('');
  const [branch, setBranch] = React.useState<IfscLookup | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Look the branch up as soon as the code is long enough to be one. Typing a
  // twelfth character is a typo, so there is nothing to wait for.
  React.useEffect(() => {
    const code = ifsc.trim().toUpperCase();
    setBranch(null);
    if (code.length !== 11) return;

    let cancelled = false;
    lookup
      .mutateAsync(code)
      .then((found) => {
        if (!cancelled) setBranch(found);
      })
      .catch(() => {
        // The message under the field is enough; a thrown error here would be
        // noise while someone is mid-edit.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ifsc]);

  const numbersMatch = number.length > 0 && number === confirmNumber;
  const canSubmit =
    Boolean(branch) && numbersMatch && holder.trim().length > 1 && !add.isPending;

  const submit = async () => {
    setError(null);
    try {
      await add.mutateAsync({
        account_number: number,
        ifsc: ifsc.trim().toUpperCase(),
        holder_name: holder.trim(),
      });
      setNumber('');
      setConfirmNumber('');
      setIfsc('');
      setBranch(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'That account could not be added.',
      );
    }
  };

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md, gap: spacing.xl }}>
      <ScreenHeader title="bank_accounts" onBack={() => router.back()} />

      {status.data && !status.data.payouts_enabled ? (
        <SoftCard>
          <Txt variant="bodyStrong">Withdrawals are not switched on</Txt>
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
            You can add an account, but it cannot be verified or paid out to
            until this deployment has a payout provider configured. Verification
            needs a real one-rupee transfer to the account, which is the only way
            to establish it is yours.
          </Txt>
        </SoftCard>
      ) : null}

      <View>
        <SoftSection title="your accounts" />
        {accounts.isLoading ? (
          <Skeleton height={90} />
        ) : (accounts.data?.length ?? 0) === 0 ? (
          <SoftCard>
            <Txt variant="caption" tone="secondary">
              No bank accounts yet. Add one below to withdraw your available
              balance.
            </Txt>
          </SoftCard>
        ) : (
          <View style={{ gap: spacing.md }}>
            {accounts.data!.map((account) => (
              <SoftCard key={account.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, paddingRight: spacing.md }}>
                    <Txt variant="bodyStrong">{account.bank_name}</Txt>
                    <Txt variant="caption" tone="secondary">
                      {account.branch}
                    </Txt>
                  </View>
                  <Chip
                    label={STATUS_LABEL[account.status]}
                    tone={STATUS_TONE[account.status]}
                  />
                </Row>

                <View
                  style={{
                    height: 1,
                    backgroundColor: colors.border,
                    marginVertical: spacing.lg,
                  }}
                />

                <Row style={{ justifyContent: 'space-between' }}>
                  <View>
                    <Txt variant="caption" tone="tertiary">
                      Account
                    </Txt>
                    <Txt variant="bodyStrong">•••• {account.account_last4}</Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt variant="caption" tone="tertiary">
                      IFSC
                    </Txt>
                    <Txt variant="bodyStrong">{account.ifsc}</Txt>
                  </View>
                </Row>

                {account.failure_reason ? (
                  <Txt
                    variant="caption"
                    tone="danger"
                    style={{ marginTop: spacing.md }}
                  >
                    {account.failure_reason}
                  </Txt>
                ) : null}
              </SoftCard>
            ))}
          </View>
        )}
      </View>

      <View>
        <SoftSection title="add an account" />
        <SoftCard>
          <View style={{ gap: spacing.lg }}>
            <Field
              label="Account holder name"
              value={holder}
              onChangeText={setHolder}
              autoCapitalize="words"
              hint="Exactly as your bank has it. It must be your own account."
            />

            <Field
              label="IFSC"
              value={ifsc}
              onChangeText={(text) => setIfsc(text.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={11}
              placeholder="SBIN0001234"
              error={
                ifsc.length === 11 && !branch && !lookup.isPending
                  ? 'No branch found with that IFSC.'
                  : null
              }
              hint={
                lookup.isPending
                  ? 'Checking…'
                  : branch
                    ? `${branch.bank} — ${branch.branch}, ${branch.city}`
                    : '11 characters, from your passbook or cheque book.'
              }
            />

            <Field
              label="Account number"
              value={number}
              onChangeText={(text) => setNumber(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              autoCorrect={false}
              maxLength={18}
            />

            <Field
              label="Confirm account number"
              value={confirmNumber}
              onChangeText={(text) => setConfirmNumber(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              autoCorrect={false}
              maxLength={18}
              error={
                confirmNumber.length > 0 && !numbersMatch
                  ? 'These do not match.'
                  : null
              }
              // Asked twice on purpose: a mistyped account number is not
              // recoverable once money has been sent to it.
              hint="Typed twice because a wrong digit sends money to a stranger."
            />

            {error ? (
              <Txt variant="caption" tone="danger">
                {error}
              </Txt>
            ) : null}

            <Button
              title={add.isPending ? 'Checking…' : 'Add account'}
              loading={add.isPending}
              disabled={!canSubmit}
              onPress={submit}
            />
          </View>
        </SoftCard>
      </View>

      <SoftCard depth="sm" onPress={() => router.push('/wallet/upi-accounts')}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Txt variant="bodyStrong">Withdraw to a UPI ID instead</Txt>
            <Txt variant="caption" tone="secondary">
              BHIM, GPay, PhonePe or your bank's app. Usually arrives in seconds.
            </Txt>
          </View>
          <Txt variant="body" tone="secondary">
            →
          </Txt>
        </Row>
      </SoftCard>

      <Txt
        variant="caption"
        tone="tertiary"
        style={{ textAlign: 'center', paddingHorizontal: spacing.lg }}
      >
        Your account number is encrypted before it is stored, and only the last
        four digits are ever shown.
      </Txt>
    </Screen>
  );
}
