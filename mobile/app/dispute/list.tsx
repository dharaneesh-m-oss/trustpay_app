import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDateTime } from '@/components/product';
import { Badge, Card, EmptyState, Row, Screen, Skeleton, Txt } from '@/components/ui';
import { useDisputes } from '@/lib/queries';
import { useTheme } from '@/theme';

export default function DisputeList() {
  const router = useRouter();
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const disputes = useDisputes();

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h1">Disputes</Txt>
        <Txt
          variant="body"
          tone="secondary"
          accessibilityRole="button"
          onPress={() => router.back()}
        >
          Close
        </Txt>
      </Row>

      {disputes.isLoading ? (
        <Skeleton height={90} />
      ) : (disputes.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="⚖"
          title="No disputes"
          body="If work and payment ever disagree, a dispute puts a reviewer in the middle. Nothing here means nothing has gone wrong."
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {disputes.data!.map((dispute) => (
            <Pressable
              key={dispute.id}
              onPress={() => router.push(`/dispute/${dispute.id}`)}
              accessibilityRole="button"
            >
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt variant="bodyStrong" style={{ flex: 1 }}>
                    {dispute.reason.replace(/_/g, ' ').toLowerCase()}
                  </Txt>
                  <Badge
                    label={dispute.status.toLowerCase()}
                    tone={dispute.status === 'RESOLVED' ? 'success' : 'danger'}
                  />
                </Row>
                <Txt variant="caption" tone="secondary" numberOfLines={2} style={{ marginTop: spacing.xs }}>
                  {dispute.description}
                </Txt>
                <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
                  {formatDateTime(dispute.created_at)}
                </Txt>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
