/**
 * Trust Score detail.
 *
 * Section 21 and 22: the number alone is not acceptable. This shows the score,
 * the band, the confidence, the reasons in plain language — and, below that,
 * the model's own accuracy and what it was trained on, so someone who wants to
 * check the working can.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrustScoreCard } from '@/components/product';
import { EngineBadge } from '@/components/rich';
import { TrustStar } from '@/components/uiverse';
import {
  Badge,
  Card,
  Divider,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeader,
  Txt,
} from '@/components/ui';
import { useTrustExplanation } from '@/lib/queries';
import { useTheme } from '@/theme';

const FEATURE_LABELS: Record<string, string> = {
  account_age_days: 'Account history',
  transaction_count: 'Transaction volume',
  transaction_frequency_per_week: 'Activity pattern',
  avg_transaction_amount: 'Typical transaction size',
  amount_deviation: 'Consistency of amounts',
  cancellation_rate: 'Cancellation behaviour',
  dispute_rate: 'Dispute history',
  successful_project_rate: 'Completed projects',
  milestone_clarity: 'Clarity of milestone terms',
  payment_consistency: 'Payment behaviour',
};

export default function TrustScoreScreen() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const explanation = useTrustExplanation();

  if (explanation.isLoading) {
    return (
      <Screen>
        <Loading label="Calculating your Trust Score" />
      </Screen>
    );
  }

  if (explanation.isError || !explanation.data) {
    return (
      <Screen>
        <ErrorState
          message={explanation.error?.message ?? 'Something went wrong.'}
          onRetry={() => explanation.refetch()}
        />
      </Screen>
    );
  }

  const data = explanation.data;

  // Rank by how much each feature actually moved the score.
  const ranked = Object.entries(data.contributions)
    .filter(([, value]) => Math.abs(value) > 0.02)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 6);

  const maxMagnitude = Math.max(...ranked.map(([, value]) => Math.abs(value)), 0.1);

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md }}>
      <Txt
        variant="body"
        tone="secondary"
        accessibilityRole="button"
        onPress={() => router.back()}
      >
        ‹ Back
      </Txt>

      {/* Hero gauge */}
      <Card>
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          <TrustStar score={data.score} size={190} />
          <Badge
            label={data.band_label}
            tone={
              data.score >= 75 ? 'success' : data.score >= 50 ? 'warning' : 'danger'
            }
          />
          <Txt variant="caption" tone="tertiary">
            Confidence: {data.confidence.toLowerCase()}
            {data.delta !== null && data.delta !== 0
              ? `  ·  ${data.delta > 0 ? '▲' : '▼'} ${Math.abs(data.delta)} since last check`
              : ''}
          </Txt>
        </View>

        {data.narrative ? (
          <View
            style={{
              marginTop: spacing.lg,
              padding: spacing.lg,
              backgroundColor: colors.brandMuted,
              borderRadius: radius.md,
              gap: spacing.sm,
            }}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={spacing.xs}>
                <Txt variant="caption">✦</Txt>
                <Txt variant="overline" tone="secondary">
                  What this means
                </Txt>
              </Row>
              <EngineBadge engine="claude" model={data.model_info.model_version} />
            </Row>
            <Txt variant="body">{data.narrative}</Txt>
          </View>
        ) : null}
      </Card>

      <TrustScoreCard data={data} />

      {/* Per-feature contributions */}
      <View style={{ gap: spacing.xs }}>
        <SectionHeader title="What moved your score" />
        <Card>
          <Txt variant="caption" tone="secondary" style={{ marginBottom: spacing.lg }}>
            Each bar shows how much one signal pushed your score up or down,
            relative to a typical account.
          </Txt>

          <View style={{ gap: spacing.lg }}>
            {ranked.map(([feature, value]) => {
              const helping = value < 0; // negative contribution = less risk
              const width = (Math.abs(value) / maxMagnitude) * 50;
              return (
                <View key={feature} style={{ gap: spacing.xs }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt variant="caption">{FEATURE_LABELS[feature] ?? feature}</Txt>
                    <Txt variant="caption" tone={helping ? 'success' : 'warning'}>
                      {helping ? 'Helping' : 'Hurting'}
                    </Txt>
                  </Row>

                  {/* Diverging bar: centre line, helping left, hurting right. */}
                  <View
                    style={{
                      height: 8,
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: radius.full,
                      flexDirection: 'row',
                    }}
                  >
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      {helping ? (
                        <View
                          style={{
                            width: `${width * 2}%`,
                            height: '100%',
                            backgroundColor: colors.success,
                            borderTopLeftRadius: radius.full,
                            borderBottomLeftRadius: radius.full,
                          }}
                        />
                      ) : null}
                    </View>
                    <View style={{ width: 1, backgroundColor: colors.borderStrong }} />
                    <View style={{ flex: 1 }}>
                      {!helping ? (
                        <View
                          style={{
                            width: `${width * 2}%`,
                            height: '100%',
                            backgroundColor: colors.warning,
                            borderTopRightRadius: radius.full,
                            borderBottomRightRadius: radius.full,
                          }}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      </View>

      {/* Model transparency */}
      <View style={{ gap: spacing.xs }}>
        <SectionHeader title="About this model" />
        <Card>
          <ModelRow label="Model" value={data.model_info.model_type} />
          <Divider style={{ marginVertical: spacing.md }} />
          <ModelRow
            label="Held-out accuracy"
            value={`ROC AUC ${data.model_info.metrics.roc_auc ?? '—'}`}
          />
          <Divider style={{ marginVertical: spacing.md }} />
          <ModelRow label="Explainability" value={data.model_info.explainability} />
          <Divider style={{ marginVertical: spacing.md }} />
          <ModelRow label="Version" value={data.model_info.model_version} />

          <View
            style={{
              marginTop: spacing.lg,
              padding: spacing.md,
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
            }}
          >
            <Txt variant="caption" tone="secondary">
              {data.model_info.trained_on}
            </Txt>
          </View>
        </Card>
      </View>

      <Card style={{ backgroundColor: colors.infoMuted, borderColor: colors.info }}>
        <Txt variant="captionStrong" tone="secondary">
          What this score does not do
        </Txt>
        <Txt variant="caption" style={{ marginTop: spacing.xs }}>
          It never blocks a payment, seizes funds, resolves a dispute or closes an
          account on its own. It is information for you, and a prompt for a person
          to look — nothing more.
        </Txt>
      </Card>
    </Screen>
  );
}

function ModelRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Txt variant="caption" tone="secondary">
        {label}
      </Txt>
      <Txt
        variant="captionStrong"
        style={{ flex: 1, textAlign: 'right', marginLeft: 16 }}
      >
        {value}
      </Txt>
    </Row>
  );
}
