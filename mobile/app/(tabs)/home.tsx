/**
 * Home.
 *
 * Deliberately not a balance screen. Money lives in the wallet, behind the
 * unlock; opening the app in public should not put a number on screen that
 * whoever is standing beside you can read. So home answers the other question
 * a person opens this app to ask: what needs me, and what moved.
 *
 * The order follows demand on attention - things waiting on the user first,
 * then the actions they reach for most, then work in progress, then history.
 * Recent activity shows what happened and when, but not how much; the amount is
 * one tap away in the wallet, where it is unlocked deliberately.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from './_layout';

import { ProjectCard } from '@/components/product';
import { EngineBadge } from '@/components/rich';
import {
  Chip,
  CircleButton,
  SoftAction,
  SoftCard,
  SoftSection,
} from '@/components/soft';
import {
  Button,
  EmptyState,
  ErrorState,
  Row,
  Screen,
  Skeleton,
  Txt,
} from '@/components/ui';
import {
  useAiStatus,
  useNotifications,
  useProjects,
  useTransactions,
  useTrustScore,
} from '@/lib/queries';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

/** "3d ago" beats a timestamp nobody reads. */
function ago(iso: string): string {
  const seconds = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return Math.floor(minutes) + 'm ago';
  const hours = minutes / 60;
  if (hours < 24) return Math.floor(hours) + 'h ago';
  const days = hours / 24;
  if (days < 7) return Math.floor(days) + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

const ACTIVITY_GLYPH: Record<string, string> = {
  TOP_UP: '↓',
  WITHDRAWAL: '↑',
  MILESTONE_FUNDING: '◈',
  PAYMENT_RELEASE: '✓',
  REFUND: '↩',
  FEE: '%',
};

export default function Home() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuth((state) => state.user);

  const projects = useProjects();
  const transactions = useTransactions(6);
  const trustScore = useTrustScore();
  const notifications = useNotifications();
  const aiStatus = useAiStatus();

  const refreshing = projects.isRefetching || transactions.isRefetching;

  const refreshAll = () => {
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

  const unread = notifications.data?.unread ?? 0;
  const firstName = user?.full_name.split(' ')[0] ?? 'there';
  const completed = items.reduce(
    (total, project) => total + project.milestones_completed,
    0,
  );

  if (projects.isError) {
    return (
      <Screen>
        <ErrorState
          title="Unable to load your projects"
          message={projects.error.message}
          onRetry={() => projects.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen
      contentStyle={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
        gap: spacing.xxl,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refreshAll} />
      }
    >
      {/* ------------------------------------------------------------ header */}
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ gap: 2 }}>
          <Txt variant="caption" tone="tertiary">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Txt>
          <Txt variant="h1">{firstName}</Txt>
        </View>

        <Row gap={spacing.sm}>
          <CircleButton
            glyph="✦"
            accessibilityLabel="Ask the TrustPay assistant"
            onPress={() => router.push('/assistant')}
          />
          <View>
            <CircleButton
              glyph="◔"
              accessibilityLabel={
                'Notifications' + (unread ? ', ' + unread + ' unread' : '')
              }
              onPress={() => router.push('/(tabs)/activity')}
            />
            {unread ? (
              <View
                style={{
                  position: 'absolute',
                  top: -1,
                  right: -1,
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 5,
                  borderRadius: 9,
                  backgroundColor: colors.danger,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: colors.background,
                }}
              >
                <Txt style={{ color: colors.onBrand, fontSize: 10, lineHeight: 13 }}>
                  {Math.min(unread, 9)}
                </Txt>
              </View>
            ) : null}
          </View>
        </Row>
      </Row>

      {/* --------------------------------------------------- waiting on you */}
      {needsYou.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(260)} style={{ gap: spacing.md }}>
          <SoftSection title="waiting on you" />
          {needsYou.map((project) => (
            <SoftCard key={project.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {project.title}
                  </Txt>
                  <Txt variant="caption" tone="secondary">
                    {project.client?.full_name} invited you
                  </Txt>
                </View>
                <Chip label="review" tone="warning" />
              </Row>
              <View style={{ marginTop: spacing.lg }}>
                <Button
                  title="Review invitation"
                  onPress={() => router.push('/project/' + project.id)}
                />
              </View>
            </SoftCard>
          ))}
        </Animated.View>
      ) : null}

      {/* ----------------------------------------------------------- actions */}
      <View>
        <SoftSection title="shortcuts" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.xs }}
        >
          <SoftAction
            glyph="＋"
            label="Add money"
            emphasis
            onPress={() => router.push('/wallet/add-money')}
          />
          <SoftAction
            glyph="◫"
            label="New project"
            onPress={() => router.push('/project/create')}
          />
          <SoftAction
            glyph="↑"
            label="Withdraw"
            onPress={() => router.push('/wallet/withdraw')}
          />
          <SoftAction
            glyph="⚖"
            label="Disputes"
            onPress={() => router.push('/dispute/list')}
          />
          <SoftAction
            glyph="◷"
            label="Activity"
            badge={unread ? String(Math.min(unread, 9)) : undefined}
            onPress={() => router.push('/(tabs)/activity')}
          />
          <SoftAction
            glyph="₹"
            label="Wallet"
            onPress={() => router.push('/(tabs)/wallet')}
          />
        </ScrollView>
      </View>

      {/* ------------------------------------------------------ standing card */}
      <SoftCard onPress={() => router.push('/trust-score')}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="caption" tone="tertiary">
              Trust Score
            </Txt>
            {trustScore.isLoading || !trustScore.data ? (
              <Skeleton height={44} width="45%" />
            ) : (
              <Row gap={spacing.sm} style={{ alignItems: 'baseline' }}>
                <Txt style={{ fontSize: 40, lineHeight: 48, fontWeight: '400' }}>
                  {trustScore.data.score}
                </Txt>
                <Txt variant="caption" tone="secondary">
                  {trustScore.data.band_label}
                </Txt>
              </Row>
            )}
          </View>
          <EngineBadge engine={aiStatus.data?.engine} model={aiStatus.data?.model} />
        </Row>

        <View
          style={{
            flexDirection: 'row',
            marginTop: spacing.lg,
            borderRadius: radius.lg,
            backgroundColor: colors.surfaceMuted,
            paddingVertical: spacing.md,
          }}
        >
          {[
            { label: 'active', value: String(active.length) },
            { label: 'completed', value: String(completed) },
            { label: 'projects', value: String(items.length) },
          ].map((stat, index) => (
            <View
              key={stat.label}
              style={{
                flex: 1,
                alignItems: 'center',
                borderLeftWidth: index === 0 ? 0 : 1,
                borderLeftColor: colors.border,
              }}
            >
              <Txt variant="h3">{stat.value}</Txt>
              <Txt variant="caption" tone="tertiary">
                {stat.label}
              </Txt>
            </View>
          ))}
        </View>
      </SoftCard>

      {/* ---------------------------------------------------------- projects */}
      <View>
        <SoftSection
          title="in progress"
          action={
            items.length > 0 ? (
              <Txt
                variant="caption"
                tone="secondary"
                accessibilityRole="button"
                onPress={() => router.push('/(tabs)/projects')}
              >
                See all
              </Txt>
            ) : null
          }
        />

        {projects.isLoading ? (
          <Skeleton height={150} />
        ) : active.length === 0 ? (
          <SoftCard>
            <EmptyState
              icon="◫"
              title="Nothing in progress"
              body="Create a project, agree the milestones, and protect the first payment. You can invite someone even if they are not on TrustPay yet."
              action={
                <Button
                  title="Create a project"
                  fullWidth={false}
                  onPress={() => router.push('/project/create')}
                />
              }
            />
          </SoftCard>
        ) : (
          <View style={{ gap: spacing.lg }}>
            {active.slice(0, 3).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </View>
        )}
      </View>

      {/* ---------------------------------------------------------- activity */}
      <View>
        <SoftSection
          title="recent"
          action={
            <Txt
              variant="caption"
              tone="secondary"
              accessibilityRole="button"
              onPress={() => router.push('/(tabs)/wallet')}
            >
              See all
            </Txt>
          }
        />
        <SoftCard>
          {transactions.isLoading ? (
            <View style={{ gap: spacing.md }}>
              <Skeleton height={38} />
              <Skeleton height={38} />
            </View>
          ) : (transactions.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon="◷"
              title="Nothing yet"
              body="Once money moves, it shows up here."
            />
          ) : (
            transactions.data!.items.map((transaction, index) => (
              <View key={transaction.id}>
                {index > 0 ? (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: colors.border,
                      marginVertical: spacing.lg,
                    }}
                  />
                ) : null}
                <Row gap={spacing.md}>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      backgroundColor: colors.surfaceMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Txt variant="body" tone="secondary">
                      {ACTIVITY_GLYPH[transaction.transaction_type] ?? '•'}
                    </Txt>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {transaction.description}
                    </Txt>
                    {/* No amount here on purpose - see the note at the top. */}
                    <Txt variant="caption" tone="tertiary">
                      {ago(transaction.created_at)}
                    </Txt>
                  </View>
                </Row>
              </View>
            ))
          )}
        </SoftCard>
      </View>

      <Txt
        variant="caption"
        tone="tertiary"
        style={{ textAlign: 'center', paddingHorizontal: spacing.xxl }}
      >
        Balances live in your wallet, behind your fingerprint or PIN.
      </Txt>
    </Screen>
  );
}
