/**
 * Home.
 *
 * Answers, in order, the four questions someone opens a payments app to ask:
 * what can I spend, what is being held, what needs me right now, and what just
 * happened. Anything that needs a decision is surfaced as an action card near
 * the top; everything else is one tap away.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from './_layout';

import { useBalanceReveal } from '@/components/BalanceLock';
import { LogoMark } from '@/components/Logo';
import { ProjectCard, TransactionRow } from '@/components/product';
import {
  ActionGrid,
  Avatar,
  BalanceHeader,
  EngineBadge,
  InsightCarousel,
  PeopleRow,
  StatStrip,
} from '@/components/rich';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  IconButton,
  Row,
  Screen,
  SectionHeader,
  Skeleton,
  Txt,
} from '@/components/ui';
import { formatCompact } from '@/lib/money';
import {
  useAiStatus,
  useNotifications,
  useProjects,
  useTransactions,
  useTrustScore,
  useWallet,
} from '@/lib/queries';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function Home() {
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuth((state) => state.user);

  const wallet = useWallet();
  const projects = useProjects();
  const transactions = useTransactions(5);
  const trustScore = useTrustScore();
  const notifications = useNotifications();
  const aiStatus = useAiStatus();
  const lock = useBalanceReveal();

  const refreshing =
    wallet.isRefetching || projects.isRefetching || transactions.isRefetching;

  const refreshAll = () => {
    wallet.refetch();
    projects.refetch();
    transactions.refetch();
    trustScore.refetch();
    notifications.refetch();
  };

  const items = projects.data?.items ?? [];
  const active = items.filter((project) =>
    ['ACTIVE', 'UNDER_DISPUTE'].includes(project.status),
  );

  // Things genuinely waiting on this person, which is what the screen leads with.
  const needsYou = items.filter(
    (project) =>
      project.status === 'AWAITING_ACCEPTANCE' && project.your_role === 'RECEIVER',
  );

  const counterparties = items
    .map((project) =>
      project.your_role === 'CLIENT' ? project.receiver : project.client,
    )
    .filter((party): party is { id: string; full_name: string } => Boolean(party))
    .filter(
      (party, index, all) => all.findIndex((other) => other.id === party.id) === index,
    )
    .slice(0, 8);

  const unread = notifications.data?.unread ?? 0;
  const firstName = user?.full_name.split(' ')[0] ?? 'there';

  if (wallet.isError) {
    return (
      <Screen>
        <ErrorState
          title="Unable to load your wallet"
          message={wallet.error.message}
          onRetry={() => wallet.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen
      contentStyle={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refreshAll} />
      }
    >
      {/* Header */}
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={spacing.sm}>
          <Avatar name={user?.full_name ?? 'You'} size={38} />
          <View>
            <Txt variant="caption" tone="secondary">
              Welcome back
            </Txt>
            <Txt variant="h3">{firstName}</Txt>
          </View>
        </Row>
        <Row gap={spacing.sm}>
          <IconButton
            glyph="✦"
            accessibilityLabel="Ask the TrustPay assistant"
            tone="brand"
            onPress={() => router.push('/assistant')}
          />
          <IconButton
            glyph="◔"
            accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`}
            tone={unread ? 'danger' : 'neutral'}
            onPress={() => router.push('/(tabs)/activity')}
          />
        </Row>
      </Row>

      {/* Balance */}
      {wallet.isLoading || !wallet.data ? (
        <Card>
          <Skeleton height={20} width="45%" />
          <View style={{ height: spacing.md }} />
          <Skeleton height={42} width="70%" />
          <View style={{ height: spacing.lg }} />
          <Skeleton height={56} />
        </Card>
      ) : (
        <BalanceHeader
          available={wallet.data.available}
          protectedAmount={wallet.data.protected}
          pending={wallet.data.pending_settlement}
          currency={wallet.data.currency}
          demoMode={wallet.data.demo_mode}
          trustScore={trustScore.data?.score}
          onPressTrust={() => router.push('/trust-score')}
          unlocked={lock.unlocked}
          checking={lock.checking}
          onToggleBalance={lock.reveal}
        />
      )}

      {/* Actions */}
      <ActionGrid
        actions={[
          {
            key: 'add',
            label: 'Add money',
            glyph: '＋',
            onPress: () => router.push('/wallet/add-money'),
          },
          {
            key: 'project',
            label: 'New project',
            glyph: '◫',
            onPress: () => router.push('/project/create'),
          },
          {
            key: 'withdraw',
            label: 'Withdraw',
            glyph: '↑',
            onPress: () => router.push('/wallet/withdraw'),
            tone: 'neutral',
          },
          {
            key: 'trust',
            label: 'Trust Score',
            glyph: '✦',
            onPress: () => router.push('/trust-score'),
            tone: 'success',
          },
          {
            key: 'disputes',
            label: 'Disputes',
            glyph: '⚖',
            onPress: () => router.push('/dispute/list'),
            tone: 'warning',
          },
          {
            key: 'activity',
            label: 'Activity',
            glyph: '◷',
            onPress: () => router.push('/(tabs)/activity'),
            tone: 'info',
            badge: unread ? String(Math.min(unread, 9)) : undefined,
          },
          {
            key: 'assistant',
            label: 'Assistant',
            glyph: '✦',
            onPress: () => router.push('/assistant'),
            tone: 'brand',
          },
          {
            key: 'wallet',
            label: 'Statement',
            glyph: '₹',
            onPress: () => router.push('/(tabs)/wallet'),
            tone: 'neutral',
          },
        ]}
      />

      {/* Waiting on you */}
      {needsYou.length > 0 ? (
        <Animated.View entering={FadeIn.duration(240)} style={{ gap: spacing.md }}>
          <SectionHeader title="Waiting on you" />
          {needsYou.map((project) => (
            <Card
              key={project.id}
              style={{ borderColor: colors.brand, borderWidth: 1.5 }}
            >
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {project.title}
                  </Txt>
                  <Txt variant="caption" tone="secondary">
                    {project.client.full_name} invited you
                  </Txt>
                </View>
                <Badge label="Review" tone="brand" />
              </Row>
              <View style={{ marginTop: spacing.md }}>
                <Button
                  title="Review invitation"
                  onPress={() => router.push(`/project/${project.id}`)}
                />
              </View>
            </Card>
          ))}
        </Animated.View>
      ) : null}

      {/* Portfolio at a glance */}
      {wallet.data ? (
        <StatStrip
          items={[
            {
              label: 'Active',
              value: String(active.length),
              tone: 'brand',
            },
            {
              label: 'Protected',
              value: lock.unlocked
                ? formatCompact(wallet.data.protected, wallet.data.currency)
                : '••••',
              tone: 'primary',
            },
            {
              label: 'Trust',
              value: trustScore.data ? String(trustScore.data.score) : '—',
              tone: 'success',
            },
          ]}
        />
      ) : null}

      {/* People */}
      {counterparties.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <SectionHeader title="People you work with" />
          <PeopleRow
            people={counterparties.map((party) => ({
              id: party.id,
              name: party.full_name,
            }))}
            onPress={() => router.push('/(tabs)/projects')}
            onAdd={() => router.push('/project/create')}
          />
        </View>
      ) : null}

      {/* AI insights */}
      {trustScore.data ? (
        <View style={{ gap: spacing.xs }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="overline" tone="secondary">
              TrustPay intelligence
            </Txt>
            <EngineBadge
              engine={aiStatus.data?.engine}
              model={aiStatus.data?.model}
            />
          </Row>
          <InsightCarousel
            items={[
              {
                key: 'score',
                title: `Trust Score ${trustScore.data.score}`,
                body:
                  trustScore.data.risk_reasons[0] ??
                  trustScore.data.positive_reasons[0] ??
                  'Nothing on your account needs attention.',
                tone: trustScore.data.risk_reasons.length ? 'warning' : 'success',
                onPress: () => router.push('/trust-score'),
              },
              {
                key: 'protected',
                title: 'How protection works',
                body: 'Money you commit to a milestone leaves your spendable balance and is released only when you approve the work.',
                tone: 'brand',
              },
              {
                key: 'cancel',
                title: 'Cancellation protection',
                body: 'A cancellation needs the receiver to enter a code sent to them. You cannot pull protected funds back on your own.',
                tone: 'info',
              },
            ]}
          />
        </View>
      ) : null}

      {/* Active projects */}
      <View style={{ gap: spacing.md }}>
        <SectionHeader
          title="Active projects"
          action={
            items.length > 0 ? (
              <Txt
                variant="captionStrong"
                tone="brand"
                accessibilityRole="button"
                onPress={() => router.push('/(tabs)/projects')}
              >
                See all
              </Txt>
            ) : null
          }
        />

        {projects.isLoading ? (
          <Skeleton height={140} />
        ) : active.length === 0 ? (
          <Card>
            <EmptyState
              icon="◫"
              title="No active projects"
              body="Create a project, agree the milestones, and protect the first payment. You can invite someone even if they are not on TrustPay yet."
              action={
                <Button
                  title="Create a project"
                  fullWidth={false}
                  onPress={() => router.push('/project/create')}
                />
              }
            />
          </Card>
        ) : (
          active
            .slice(0, 3)
            .map((project) => <ProjectCard key={project.id} project={project} />)
        )}
      </View>

      {/* Recent activity */}
      <View style={{ gap: spacing.xs }}>
        <SectionHeader
          title="Recent activity"
          action={
            <Txt
              variant="captionStrong"
              tone="brand"
              accessibilityRole="button"
              onPress={() => router.push('/(tabs)/wallet')}
            >
              See all
            </Txt>
          }
        />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          {transactions.isLoading ? (
            <View style={{ paddingVertical: spacing.lg, gap: spacing.md }}>
              <Skeleton height={40} />
              <Skeleton height={40} />
            </View>
          ) : (transactions.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon="₹"
              title="No transactions yet"
              body="Add money to your wallet to get started."
              action={
                <Button
                  title="Add money"
                  fullWidth={false}
                  onPress={() => router.push('/wallet/add-money')}
                />
              }
            />
          ) : (
            transactions.data!.items.map((transaction, index) => (
              <View key={transaction.id}>
                {index > 0 ? <Divider /> : null}
                <TransactionRow transaction={transaction} />
              </View>
            ))
          )}
        </Card>
      </View>

      <Txt
        variant="caption"
        tone="tertiary"
        style={{ textAlign: 'center', marginTop: spacing.sm }}
      >
        TrustPay is not a bank. In demo mode all funds are simulated.
      </Txt>

      {lock.sheet}
    </Screen>
  );
}
