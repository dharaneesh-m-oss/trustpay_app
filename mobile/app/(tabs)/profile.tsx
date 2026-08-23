import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from './_layout';

import { TrustScoreCard } from '@/components/product';
import {
  Button,
  Card,
  Divider,
  Row,
  Screen,
  SectionHeader,
  Txt,
} from '@/components/ui';
import { useTrustScore } from '@/lib/queries';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function Profile() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const user = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);
  const trustScore = useTrustScore();

  const initials = (user?.full_name ?? '?')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Screen contentStyle={{
        paddingTop: insets.top + spacing.md,
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
      }}>
      <Txt variant="h1">Profile</Txt>

      <Card>
        <Row gap={spacing.lg}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.full,
              backgroundColor: colors.brandMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt variant="h3" tone="brand">
              {initials}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="h3">{user?.full_name}</Txt>
            <Txt variant="caption" tone="secondary">
              {user?.email}
            </Txt>
            {user?.phone ? (
              <Txt variant="caption" tone="tertiary">
                {user.phone}
              </Txt>
            ) : null}
          </View>
        </Row>
      </Card>

      {trustScore.data ? (
        <TrustScoreCard
          data={trustScore.data}
          compact
          onPress={() => router.push('/trust-score')}
        />
      ) : null}

      <View style={{ gap: spacing.xs }}>
        <SectionHeader title="TrustPay" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <MenuRow
            glyph="✦"
            label="Ask the assistant"
            onPress={() => router.push('/assistant')}
          />
          <Divider />
          <MenuRow
            glyph="⚖"
            label="Disputes"
            onPress={() => router.push('/dispute/list')}
          />
          <Divider />
          <MenuRow
            glyph="✦"
            label="Trust Score & AI analysis"
            onPress={() => router.push('/trust-score')}
          />
        </Card>
      </View>

      <Card>
        <Txt variant="captionStrong" tone="secondary">
          About TrustPay
        </Txt>
        <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.xs }}>
          TrustPay is not a bank, a licensed payment institution, or a custodian of
          funds. In demo mode every amount is simulated and no real money moves.
        </Txt>
      </Card>

      <Button
        title="Sign out"
        variant="secondary"
        onPress={async () => {
          await signOut();
          router.replace('/(auth)/sign-in');
        }}
      />
      <View style={{ height: spacing.xxxl }} />
    </Screen>
  );
}

function MenuRow({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  const { spacing } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Row style={{ paddingVertical: spacing.lg, justifyContent: 'space-between' }}>
        <Row gap={spacing.md}>
          <Txt variant="body">{glyph}</Txt>
          <Txt variant="body">{label}</Txt>
        </Row>
        <Txt variant="body" tone="tertiary">
          ›
        </Txt>
      </Row>
    </Pressable>
  );
}
