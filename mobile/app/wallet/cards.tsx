/**
 * Wallet — the card pocket, full page.
 *
 * The pocket itself lives in `components/PocketWallet` because the Wallet tab
 * shows the same thing; this page is that component plus the explanations that
 * would not fit inside a tab.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PocketWallet } from '@/components/PocketWallet';
import { Card, Row, Screen, Txt } from '@/components/ui';
import { useTheme } from '@/theme';

export default function WalletCards() {
  const router = useRouter();
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt
          variant="body"
          tone="secondary"
          accessibilityRole="button"
          onPress={() => router.back()}
        >
          ‹ Back
        </Txt>
        <Txt variant="overline" tone="secondary">
          Your wallet
        </Txt>
      </Row>

      <PocketWallet />

      <Card>
        <Txt variant="captionStrong" tone="secondary">
          Why your balance is hidden
        </Txt>
        <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
          Amounts stay masked until you unlock them with a fingerprint, Face ID or
          your PIN. They re-lock after a minute, and immediately if you leave the
          app. This protects the screen, not the account — sign out if you are
          handing the phone to someone else.
        </Txt>
      </Card>

      <Card>
        <Txt variant="captionStrong" tone="secondary">
          Why three cards
        </Txt>
        <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
          These are not three accounts — they are the three states your money can
          be in. Only Available can be spent or withdrawn. Protected is committed
          to a milestone and is released when you approve the work, or returned if
          the milestone is cancelled. Tap a card to see its amount.
        </Txt>
      </Card>
    </Screen>
  );
}
