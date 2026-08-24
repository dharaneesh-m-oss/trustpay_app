/**
 * UPI IDs for withdrawals.
 *
 * The other half of `bank-accounts`, and for most people the half they can
 * actually recall: a VPA is `name@bank`, where an account number and IFSC have
 * to be copied off a passbook.
 *
 * There is no "BHIM API" to integrate here, and nothing on this screen pretends
 * otherwise. BHIM, GPay, PhonePe and a bank's own app are all just UPI clients
 * — a UPI ID created in any of them is the same address, reachable the same
 * way. What makes a payout to one possible is the payment provider, not the
 * wallet the user happens to prefer.
 *
 * The same honesty rule as bank accounts: a VPA that parses is not a VPA that
 * exists, and one that exists is not one that belongs to this person. Only the
 * provider's directory lookup settles either, so without it the ID stays
 * pending and says so.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, ScreenHeader, SoftCard, SoftSection } from '@/components/soft';
import { Button, Field, Row, Screen, Skeleton, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import {
  useAddUpiAccount,
  usePaymentsStatus,
  useUpiAccounts,
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

/** The handles people actually have, to make the format obvious in the hint. */
const COMMON_HANDLES = ['@okhdfcbank', '@ybl', '@paytm', '@upi', '@okaxis'];

// Mirrors the server's rule; the server remains the one that decides.
const VPA_SHAPE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$/;

export default function UpiAccounts() {
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuth((state) => state.user);

  const accounts = useUpiAccounts();
  const status = usePaymentsStatus();
  const add = useAddUpiAccount();

  const [vpa, setVpa] = React.useState('');
  const [holder, setHolder] = React.useState(user?.full_name ?? '');
  const [error, setError] = React.useState<string | null>(null);

  const trimmed = vpa.trim().toLowerCase();
  const wellFormed = VPA_SHAPE.test(trimmed);
  const canSubmit = wellFormed && holder.trim().length > 1 && !add.isPending;

  const submit = async () => {
    setError(null);
    try {
      await add.mutateAsync({ vpa: trimmed, holder_name: holder.trim() });
      setVpa('');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'That UPI ID could not be added.',
      );
    }
  };

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md, gap: spacing.xl }}>
      <ScreenHeader title="upi_ids" onBack={() => router.back()} />

      {status.data && !status.data.payouts_enabled ? (
        <SoftCard>
          <Txt variant="bodyStrong">Withdrawals are not switched on</Txt>
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
            You can save a UPI ID, but it cannot be verified or paid out to until
            this deployment has a payout provider. Verification asks the UPI
            directory who the ID belongs to, which needs that account.
          </Txt>
        </SoftCard>
      ) : null}

      <View>
        <SoftSection title="your upi ids" />
        {accounts.isLoading ? (
          <Skeleton height={84} />
        ) : (accounts.data?.length ?? 0) === 0 ? (
          <SoftCard>
            <Txt variant="caption" tone="secondary">
              No UPI IDs yet. Add the one you use in BHIM, GPay, PhonePe or your
              bank's app to withdraw straight to it.
            </Txt>
          </SoftCard>
        ) : (
          <View style={{ gap: spacing.md }}>
            {accounts.data!.map((account) => (
              <SoftCard key={account.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, paddingRight: spacing.md }}>
                    <Txt variant="bodyStrong">{account.vpa}</Txt>
                    <Txt variant="caption" tone="secondary">
                      {account.holder_name}
                    </Txt>
                  </View>
                  <Chip
                    label={STATUS_LABEL[account.status]}
                    tone={STATUS_TONE[account.status]}
                  />
                </Row>

                {account.failure_reason ? (
                  <Txt
                    variant="caption"
                    tone={account.status === 'REJECTED' ? 'danger' : 'secondary'}
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
        <SoftSection title="add a upi id" />
        <SoftCard>
          <View style={{ gap: spacing.lg }}>
            <Field
              label="UPI ID"
              value={vpa}
              onChangeText={setVpa}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="yourname@okhdfcbank"
              error={
                vpa.length > 3 && !wellFormed
                  ? 'UPI IDs look like name@bank.'
                  : null
              }
              hint={`Common handles: ${COMMON_HANDLES.join(', ')}`}
            />

            <Field
              label="Name on the UPI ID"
              value={holder}
              onChangeText={setHolder}
              autoCapitalize="words"
              hint="Must be your own UPI ID — payouts only go to accounts in your name."
            />

            {error ? (
              <Txt variant="caption" tone="danger">
                {error}
              </Txt>
            ) : null}

            <Button
              title={add.isPending ? 'Checking…' : 'Add UPI ID'}
              loading={add.isPending}
              disabled={!canSubmit}
              onPress={submit}
            />
          </View>
        </SoftCard>
      </View>

      <SoftCard>
        <Txt variant="captionStrong" tone="secondary">
          Where to find yours
        </Txt>
        <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
          Open BHIM, GPay, PhonePe or your bank's app and look for "UPI ID" or
          "VPA" on your profile. Any of them works here — they are all addresses
          on the same network, so it does not matter which app created it.
        </Txt>
      </SoftCard>

      <Txt
        variant="caption"
        tone="tertiary"
        style={{ textAlign: 'center', paddingHorizontal: spacing.lg }}
      >
        Withdrawals to UPI usually arrive in seconds; to a bank account, in a few
        minutes.
      </Txt>
    </Screen>
  );
}
