/**
 * Project detail.
 *
 * The milestone timeline is the centre of this screen: where the money is, what
 * has been paid, and what has to happen next. The AI agreement review sits
 * above it, because it is most useful before anyone funds anything.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AIInsightCard,
  Amount,
  MilestoneTimelineItem,
  formatDate,
} from '@/components/product';
import { EngineBadge } from '@/components/rich';
import {
  Badge,
  Button,
  Card,
  Field,
  Divider,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeader,
  Txt,
} from '@/components/ui';
import {
  useInviteReceiver,
  useProject,
  useProjectAnalysis,
  useRespondToInvitation,
} from '@/lib/queries';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

const RISK_TONE = { LOW: 'success', MEDIUM: 'warning', HIGH: 'danger' } as const;

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuth((state) => state.user);

  const project = useProject(id);
  const analysis = useProjectAnalysis(id, Boolean(project.data));
  const respond = useRespondToInvitation(id);
  const invite = useInviteReceiver(id);
  const [inviteEmail, setInviteEmail] = useState('');

  if (project.isLoading) {
    return (
      <Screen>
        <Loading label="Loading project" />
      </Screen>
    );
  }

  if (project.isError || !project.data) {
    return (
      <Screen>
        <ErrorState
          title="Unable to load project"
          message={project.error?.message ?? 'Something went wrong.'}
          onRetry={() => project.refetch()}
        />
      </Screen>
    );
  }

  const data = project.data;
  const isReceiver = data.your_role === 'RECEIVER';
  const awaitingMyAcceptance =
    data.status === 'AWAITING_ACCEPTANCE' && isReceiver;

  const counterparty =
    data.your_role === 'CLIENT' ? data.receiver : data.client;

  return (
    <Screen
      contentStyle={{ paddingTop: insets.top + spacing.md }}
      refreshControl={
        <RefreshControl
          refreshing={project.isRefetching}
          onRefresh={() => project.refetch()}
        />
      }
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt
          variant="body"
          tone="secondary"
          accessibilityRole="button"
          onPress={() => router.back()}
        >
          ‹ Back
        </Txt>
        <Badge label={data.status.replace(/_/g, ' ').toLowerCase()} tone="brand" />
      </Row>

      <View style={{ gap: spacing.xs }}>
        <Txt variant="h1">{data.title}</Txt>
        <Txt variant="body" tone="secondary">
          {data.description}
        </Txt>
      </View>

      {/* Money summary */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Txt variant="overline" tone="secondary">
              Protected
            </Txt>
            <Amount
              value={data.protected_amount}
              currency={data.currency}
              size="h1"
              tone={data.protected_amount === '0.00' ? 'secondary' : 'brand'}
            />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt variant="overline" tone="secondary">
              Released
            </Txt>
            <Amount
              value={data.released_amount}
              currency={data.currency}
              size="h1"
              tone={data.released_amount === '0.00' ? 'secondary' : 'success'}
            />
          </View>
        </Row>

        <Divider style={{ marginVertical: spacing.lg }} />

        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Txt variant="caption" tone="tertiary">
              {data.your_role === 'CLIENT' ? 'Receiver' : 'Client'}
            </Txt>
            <Txt variant="bodyStrong">
              {counterparty?.full_name ?? 'Not invited yet'}
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt variant="caption" tone="tertiary">
              Total value
            </Txt>
            <Amount value={data.total_amount} currency={data.currency} size="body" />
          </View>
        </Row>

        {data.end_date ? (
          <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.md }}>
            Agreed completion: {formatDate(data.end_date)}
          </Txt>
        ) : null}
      </Card>

      {/* Invitation response */}
      {awaitingMyAcceptance ? (
        <Card style={{ borderColor: colors.brand, borderWidth: 1.5 }}>
          <Txt variant="h3">You have been invited</Txt>
          <Txt variant="body" tone="secondary" style={{ marginTop: spacing.xs }}>
            Accepting fixes these terms. The title, total and milestone amounts
            cannot change afterwards.
          </Txt>
          <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Accept"
                loading={respond.isPending}
                onPress={() => respond.mutate(true)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Decline"
                variant="secondary"
                onPress={() => respond.mutate(false)}
              />
            </View>
          </Row>
        </Card>
      ) : null}

      {/* Waiting on someone who has not joined yet */}
      {data.invited_receiver_email ? (
        <Card style={{ borderColor: colors.info, borderWidth: 1 }}>
          <Row gap={spacing.sm}>
            <Txt variant="body">✉</Txt>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">Invitation sent</Txt>
              <Txt variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                {data.invited_receiver_email} does not have a TrustPay account yet.
                The invitation is waiting for them — it appears the moment they sign
                up, and the project starts when they accept.
              </Txt>
            </View>
          </Row>
        </Card>
      ) : null}

      {/* A draft has nobody to work with yet */}
      {data.status === 'DRAFT' && data.your_role === 'CLIENT' ? (
        <Card style={{ borderColor: colors.warning, borderWidth: 1 }}>
          <Txt variant="h3">Invite the receiver</Txt>
          <Txt variant="body" tone="secondary" style={{ marginTop: spacing.xs }}>
            This project cannot be funded until someone accepts it. They do not need
            a TrustPay account yet — we will hold the invitation for them.
          </Txt>
          <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
            <Field
              label="Their email"
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="them@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              error={invite.isError ? (invite.error as Error).message : undefined}
            />
            <Button
              title="Send invitation"
              loading={invite.isPending}
              disabled={!inviteEmail.includes('@')}
              onPress={() => invite.mutate(inviteEmail.trim())}
            />
          </View>
        </Card>
      ) : null}

      {/* AI agreement analysis */}
      {analysis.data ? (
        <View style={{ gap: spacing.xs }}>
          <Row style={{ justifyContent: 'flex-end' }}>
            <EngineBadge
              engine={analysis.data.engine}
              model={analysis.data.model}
            />
          </Row>
          <AIInsightCard
          title={`AI agreement review — ${analysis.data.risk_level.toLowerCase()} risk`}
          body={analysis.data.summary}
          tone={RISK_TONE[analysis.data.risk_level] ?? 'brand'}
          footer={
            analysis.data.findings.length > 0
              ? `${analysis.data.findings.length} thing(s) worth tightening. Tap to read.`
              : 'Nothing flagged.'
          }
            onPress={() => router.push(`/project/analysis?id=${id}`)}
          />
        </View>
      ) : null}

      {/* Milestone timeline */}
      <View style={{ gap: spacing.md }}>
        <SectionHeader
          title={`Milestones — ${data.milestones_completed} of ${data.milestones_total} paid`}
        />
        <Card>
          {data.milestones.map((milestone, index) => (
            <MilestoneTimelineItem
              key={milestone.id}
              milestone={milestone}
              isLast={index === data.milestones.length - 1}
              onPress={() => router.push(`/milestone/${milestone.id}`)}
            />
          ))}
        </Card>
      </View>
    </Screen>
  );
}
