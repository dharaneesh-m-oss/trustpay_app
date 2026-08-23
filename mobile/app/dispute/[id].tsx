/**
 * Dispute thread.
 *
 * Both statements, the evidence, and — on request — the AI summary. The summary
 * is presented as an aid to whoever reviews the case, never as a verdict, and
 * the screen says so where it cannot be missed.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateTime } from '@/components/product';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeader,
  Txt,
} from '@/components/ui';
import { useDispute, useDisputeAiSummary } from '@/lib/queries';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function DisputeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuth((state) => state.user);

  const dispute = useDispute(id);
  const summarise = useDisputeAiSummary(id);

  if (dispute.isLoading) {
    return (
      <Screen>
        <Loading label="Loading dispute" />
      </Screen>
    );
  }

  if (dispute.isError || !dispute.data) {
    return (
      <Screen>
        <ErrorState
          message={dispute.error?.message ?? 'Something went wrong.'}
          onRetry={() => dispute.refetch()}
        />
      </Screen>
    );
  }

  const data = dispute.data;
  const summary = data.ai_summary as Record<string, any> | null;
  const isResolved = data.status === 'RESOLVED' || data.status === 'CLOSED';

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
        <Badge
          label={data.status.replace(/_/g, ' ').toLowerCase()}
          tone={isResolved ? 'success' : 'danger'}
        />
      </Row>

      <Txt variant="h1">Dispute</Txt>

      <Card>
        <Txt variant="overline" tone="secondary">
          Reason
        </Txt>
        <Txt variant="bodyStrong" style={{ marginTop: spacing.xs }}>
          {data.reason.replace(/_/g, ' ').toLowerCase()}
        </Txt>
        <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
          Raised {formatDateTime(data.created_at)}
        </Txt>
      </Card>

      {/* Outcome */}
      {isResolved && data.outcome ? (
        <Card
          style={{ backgroundColor: colors.successMuted, borderColor: colors.success }}
        >
          <Txt variant="overline" tone="secondary">
            Resolution
          </Txt>
          <Txt variant="bodyStrong" style={{ marginTop: spacing.xs }}>
            {data.outcome.replace(/_/g, ' ').toLowerCase()}
          </Txt>
          {data.resolution_note ? (
            <Txt variant="body" style={{ marginTop: spacing.sm }}>
              {data.resolution_note}
            </Txt>
          ) : null}
          <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
            Decided by a TrustPay reviewer.
          </Txt>
        </Card>
      ) : null}

      {/* AI summary */}
      <View style={{ gap: spacing.xs }}>
        <SectionHeader title="AI summary" />
        {summary ? (
          <Card style={{ borderLeftWidth: 3, borderLeftColor: colors.brand }}>
            <SummaryRow label="Main disagreement" value={summary.main_disagreement} />
            <Divider style={{ marginVertical: spacing.md }} />
            <SummaryRow label="Client's position" value={summary.client_position} />
            <Divider style={{ marginVertical: spacing.md }} />
            <SummaryRow label="Receiver's position" value={summary.receiver_position} />
            <Divider style={{ marginVertical: spacing.md }} />
            <SummaryRow label="Evidence" value={summary.evidence_summary} />
            <Divider style={{ marginVertical: spacing.md }} />
            <SummaryRow label="Milestone" value={summary.relevant_milestone} />

            {Array.isArray(summary.timeline) && summary.timeline.length > 0 ? (
              <>
                <Divider style={{ marginVertical: spacing.md }} />
                <Txt variant="captionStrong" tone="secondary">
                  Timeline
                </Txt>
                <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                  {summary.timeline.map((entry: string) => (
                    <Txt key={entry} variant="caption">
                      • {entry}
                    </Txt>
                  ))}
                </View>
              </>
            ) : null}

            <View
              style={{
                marginTop: spacing.lg,
                padding: spacing.md,
                backgroundColor: colors.warningMuted,
                borderRadius: radius.md,
              }}
            >
              <Txt variant="caption" tone="warning">
                {summary.disclaimer}
              </Txt>
            </View>
          </Card>
        ) : (
          <Card>
            <Txt variant="body" tone="secondary">
              Generate a neutral summary of both sides. It does not decide anything —
              a TrustPay reviewer does that.
            </Txt>
            <View style={{ marginTop: spacing.lg }}>
              <Button
                title="Generate AI summary"
                variant="secondary"
                loading={summarise.isPending}
                onPress={() => summarise.mutate()}
              />
            </View>
          </Card>
        )}
      </View>

      {/* Statements */}
      <View style={{ gap: spacing.xs }}>
        <SectionHeader title={`Statements (${data.messages.length})`} />
        <View style={{ gap: spacing.md }}>
          {data.messages.map((message) => {
            const mine = message.author_id === user?.id;
            return (
              <Card
                key={message.id}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: mine ? colors.brand : colors.border,
                }}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt variant="captionStrong" tone={mine ? 'brand' : 'secondary'}>
                    {mine ? 'You' : message.author_role.toLowerCase()}
                  </Txt>
                  <Txt variant="caption" tone="tertiary">
                    {formatDateTime(message.created_at)}
                  </Txt>
                </Row>
                <Txt variant="body" style={{ marginTop: spacing.sm }}>
                  {message.body}
                </Txt>
              </Card>
            );
          })}
        </View>
      </View>
    </Screen>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  const { spacing } = useTheme();
  return (
    <View>
      <Txt variant="captionStrong" tone="secondary">
        {label}
      </Txt>
      <Txt variant="body" style={{ marginTop: spacing.xxs }}>
        {value ?? '—'}
      </Txt>
    </View>
  );
}
