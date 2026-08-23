import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Card, ErrorState, Loading, Row, Screen, SectionHeader, Txt } from '@/components/ui';
import { useProjectAnalysis } from '@/lib/queries';
import { useTheme } from '@/theme';

const SEVERITY_TONE = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' } as const;

export default function ProjectAnalysis() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const analysis = useProjectAnalysis(id);

  if (analysis.isLoading) {
    return (
      <Screen>
        <Loading label="Reviewing the agreement" />
      </Screen>
    );
  }

  if (analysis.isError || !analysis.data) {
    return (
      <Screen>
        <ErrorState
          message={analysis.error?.message ?? 'Something went wrong.'}
          onRetry={() => analysis.refetch()}
        />
      </Screen>
    );
  }

  const data = analysis.data;

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md }}>
      <Txt variant="body" tone="secondary" accessibilityRole="button" onPress={() => router.back()}>
        ‹ Back
      </Txt>

      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h1">Agreement review</Txt>
        <Badge label={`${data.risk_level.toLowerCase()} risk`} tone={SEVERITY_TONE[data.risk_level]} />
      </Row>

      <Card>
        <Txt variant="body">{data.summary}</Txt>
      </Card>

      {data.findings.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <SectionHeader title={`Worth tightening (${data.findings.length})`} />
          <View style={{ gap: spacing.md }}>
            {data.findings.map((finding, index) => (
              <Card key={index}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt variant="captionStrong" tone="secondary">
                    {finding.area}
                  </Txt>
                  <Badge label={finding.severity.toLowerCase()} tone={SEVERITY_TONE[finding.severity as 'HIGH']} />
                </Row>
                <Txt variant="body" style={{ marginTop: spacing.sm }}>
                  {finding.issue}
                </Txt>
                <View
                  style={{
                    marginTop: spacing.md,
                    padding: spacing.md,
                    backgroundColor: colors.brandMuted,
                    borderRadius: radius.md,
                  }}
                >
                  <Txt variant="caption" tone="brand">
                    {finding.recommendation}
                  </Txt>
                </View>
              </Card>
            ))}
          </View>
        </View>
      ) : null}

      {data.strengths.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <SectionHeader title="What is already solid" />
          <Card>
            <View style={{ gap: spacing.sm }}>
              {data.strengths.map((strength) => (
                <Row key={strength} gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
                  <Txt variant="caption" tone="success">
                    ✓
                  </Txt>
                  <Txt variant="caption" style={{ flex: 1 }}>
                    {strength}
                  </Txt>
                </Row>
              ))}
            </View>
          </Card>
        </View>
      ) : null}

      <Card style={{ backgroundColor: colors.warningMuted, borderColor: colors.warning }}>
        <Txt variant="caption" tone="warning">
          {data.disclaimer}
        </Txt>
      </Card>
    </Screen>
  );
}
