import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from './_layout';

import { MILESTONE_TONE } from '@/components/product';
import { GlassProjectCard } from '@/components/uiverse';
import { formatMoney } from '@/lib/money';
import {
  Button,
  EmptyState,
  ErrorState,
  Row,
  Screen,
  Skeleton,
  Txt,
} from '@/components/ui';
import { useProjects } from '@/lib/queries';
import { useTheme } from '@/theme';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'awaiting', label: 'Awaiting you' },
  { key: 'done', label: 'Completed' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export default function Projects() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<FilterKey>('all');

  const projects = useProjects();

  const items = (projects.data?.items ?? []).filter((project) => {
    switch (filter) {
      case 'active':
        return project.status === 'ACTIVE';
      case 'awaiting':
        return project.status === 'AWAITING_ACCEPTANCE';
      case 'done':
        return ['COMPLETED', 'CANCELLED', 'DECLINED'].includes(project.status);
      default:
        return true;
    }
  });

  if (projects.isError) {
    return (
      <Screen>
        <ErrorState
          message={projects.error.message}
          onRetry={() => projects.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen
      contentStyle={{
        paddingTop: insets.top + spacing.md,
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
      }}
      refreshControl={
        <RefreshControl
          refreshing={projects.isRefetching}
          onRefresh={() => projects.refetch()}
        />
      }
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h1">Projects</Txt>
        <Button
          title="New"
          fullWidth={false}
          onPress={() => router.push('/project/create')}
          style={{ minHeight: 40, paddingHorizontal: spacing.lg }}
        />
      </Row>

      <Row gap={spacing.xs}>
        {FILTERS.map((item) => {
          const selected = filter === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setFilter(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.full,
                backgroundColor: selected ? colors.brand : colors.surface,
                borderWidth: 1,
                borderColor: selected ? colors.brand : colors.border,
              }}
            >
              <Txt
                variant="captionStrong"
                style={{ color: selected ? colors.onBrand : colors.textSecondary }}
              >
                {item.label}
              </Txt>
            </Pressable>
          );
        })}
      </Row>

      {projects.isLoading ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon="◫"
          title={filter === 'all' ? 'No projects yet' : 'Nothing in this filter'}
          body={
            filter === 'all'
              ? 'A project sets out the work, the milestones and what each one pays. Create one to get started.'
              : 'Try a different filter to see your other projects.'
          }
          action={
            filter === 'all' ? (
              <Button
                title="Create a project"
                fullWidth={false}
                onPress={() => router.push('/project/create')}
              />
            ) : null
          }
        />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {items.map((project) => {
            const counterparty =
              project.your_role === 'CLIENT'
                ? (project.receiver?.full_name ??
                  (project.invited_receiver_email
                    ? `${project.invited_receiver_email} · invited`
                    : 'No receiver yet'))
                : project.client.full_name;

            return (
              <GlassProjectCard
                key={project.id}
                badge={project.status.replace(/_/g, ' ')}
                title={project.title}
                subtitle={
                  (project.your_role === 'CLIENT' ? 'To ' : 'From ') + counterparty
                }
                onPress={() => router.push(`/project/${project.id}`)}
                footer={
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View>
                      <Txt variant="caption" style={{ color: 'rgba(0,137,78,0.7)' }}>
                        Protected
                      </Txt>
                      <Txt variant="h3" style={{ color: '#00894D' }}>
                        {formatMoney(project.protected_amount, project.currency)}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Txt variant="caption" style={{ color: 'rgba(0,137,78,0.7)' }}>
                        Milestones
                      </Txt>
                      <Txt variant="h3" style={{ color: '#00894D' }}>
                        {project.milestones_completed} / {project.milestones_total}
                      </Txt>
                    </View>
                  </Row>
                }
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}
