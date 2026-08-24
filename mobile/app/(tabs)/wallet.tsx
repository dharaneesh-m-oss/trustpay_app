/**
 * Wallet.
 *
 * Section 8's three balances shown as three separate figures. The point of the
 * screen is that "available" and "protected" are different kinds of money, so
 * they are never added together into one reassuring total without being broken
 * back down.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from './_layout';

import { Amount, formatDateTime } from '@/components/product';
import { SlideActionButton, SlotTransactionRow } from '@/components/uiverse';
import { PocketWallet } from '@/components/PocketWallet';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Row,
  Screen,
  SectionHeader,
  Skeleton,
  Txt,
} from '@/components/ui';
import { formatMoney, formatSigned } from '@/lib/money';
import { useTransactions, useWallet } from '@/lib/queries';
import { useTheme } from '@/theme';

export default function WalletScreen() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const wallet = useWallet();
  const transactions = useTransactions(50);



  if (wallet.isError) {
    return (
      <Screen>
        <ErrorState message={wallet.error.message} onRetry={() => wallet.refetch()} />
      </Screen>
    );
  }

  const currency = wallet.data?.currency ?? 'INR';

  return (
    <Screen
      contentStyle={{
        paddingTop: insets.top + spacing.md,
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
      }}
      refreshControl={
        <RefreshControl
          refreshing={wallet.isRefetching}
          onRefresh={() => {
            wallet.refetch();
            transactions.refetch();
          }}
        />
      }
    >
      <Txt variant="h1">Wallet</Txt>

      {wallet.isLoading || !wallet.data ? (
        <Card>
          <Skeleton height={44} width="60%" />
        </Card>
      ) : (
        <>
          {/* The wallet itself — byllzz/rude-bat-50, gated on biometrics. */}
          <PocketWallet />

          <Row gap={spacing.sm}>
            <SlideActionButton
              label="Add money"
              glyph="＋"
              tone="brand"
              style={{ flex: 1 }}
              onPress={() => router.push('/wallet/add-money')}
            />
            <SlideActionButton
              label="Withdraw"
              glyph="↑"
              tone="dark"
              style={{ flex: 1 }}
              onPress={() => router.push('/wallet/withdraw')}
            />
          </Row>

          <Card>
            <Txt variant="captionStrong" tone="secondary">
              Where withdrawals go
            </Txt>
            <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
              Add a bank account or a UPI ID once, and withdrawals go straight to
              it.
            </Txt>
            <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
              <Button
                title="Bank accounts"
                variant="secondary"
                fullWidth={false}
                style={{ flex: 1 }}
                onPress={() => router.push('/wallet/bank-accounts')}
              />
              <Button
                title="UPI IDs"
                variant="secondary"
                fullWidth={false}
                style={{ flex: 1 }}
                onPress={() => router.push('/wallet/upi-accounts')}
              />
            </Row>
          </Card>

          <Card>
            <Txt variant="captionStrong" tone="secondary">
              Why the three are separate
            </Txt>
            <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
              Only available funds can be spent or withdrawn. Protected money is
              committed to a milestone and is released when you approve the work, or
              returned if the milestone is cancelled.
            </Txt>
          </Card>

          {wallet.data.demo_mode ? (
            <View
              style={{
                backgroundColor: colors.warningMuted,
                borderRadius: radius.md,
                padding: spacing.md,
              }}
            >
              <Txt variant="caption" tone="warning">
                Demo mode — these are simulated funds. TrustPay is not a bank and no
                real money moves.
              </Txt>
            </View>
          ) : null}
        </>
      )}

      <View style={{ gap: spacing.xs }}>
        <SectionHeader title="All transactions" />
        {transactions.isLoading ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </View>
        ) : (transactions.data?.items.length ?? 0) === 0 ? (
          <Card>
            <EmptyState
              icon="₹"
              title="Nothing here yet"
              body="Your transactions will appear here once money starts moving."
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {transactions.data!.items.map((transaction) => (
              <SlotTransactionRow
                key={transaction.id}
                title={transaction.description}
                subtitle={formatDateTime(transaction.created_at)}
                direction={transaction.direction_for_user}
                glyph={transaction.direction_for_user === 'CREDIT' ? '↓' : '↑'}
                amount={
                  transaction.direction_for_user === 'INTERNAL'
                    ? formatMoney(transaction.amount, transaction.currency)
                    : formatSigned(transaction.net_effect, transaction.currency)
                }
              />
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
