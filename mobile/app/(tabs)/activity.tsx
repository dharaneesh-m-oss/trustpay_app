/**
 * Activity — the notification feed.
 *
 * Also the channel through which a receiver gets their cancellation
 * verification code in demo mode, which is why a CRITICAL notification is
 * visually unmissable rather than another grey row.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from './_layout';

import { formatDateTime } from '@/components/product';
import {
  Card,
  EmptyState,
  Row,
  Screen,
  Skeleton,
  Txt,
} from '@/components/ui';
import {
  Notification,
  useMarkAllRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/lib/queries';
import { useTheme } from '@/theme';

const SEVERITY_GLYPH: Record<Notification['severity'], string> = {
  INFO: 'ℹ',
  SUCCESS: '✓',
  WARNING: '!',
  CRITICAL: '⚑',
};

export default function Activity() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();

  const open = (notification: Notification) => {
    if (!notification.is_read) markRead.mutate(notification.id);

    const { screen, id } = notification.target ?? {};
    if (!screen || !id) return;

    const routes: Record<string, string> = {
      project: `/project/${id}`,
      milestone: `/milestone/${id}`,
      cancellation: `/cancellation/${id}`,
      dispute: `/dispute/${id}`,
    };
    const path = screen === 'trust-score' ? '/trust-score' : routes[screen];
    if (path) router.push(path);
  };

  const tone = (severity: Notification['severity']) =>
    severity === 'CRITICAL'
      ? { fg: colors.danger, bg: colors.dangerMuted }
      : severity === 'WARNING'
        ? { fg: colors.warning, bg: colors.warningMuted }
        : severity === 'SUCCESS'
          ? { fg: colors.success, bg: colors.successMuted }
          : { fg: colors.info, bg: colors.infoMuted };

  return (
    <Screen
      contentStyle={{
        paddingTop: insets.top + spacing.md,
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
      }}
      refreshControl={
        <RefreshControl
          refreshing={notifications.isRefetching}
          onRefresh={() => notifications.refetch()}
        />
      }
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h1">Activity</Txt>
        {(notifications.data?.unread ?? 0) > 0 ? (
          <Txt
            variant="captionStrong"
            tone="brand"
            accessibilityRole="button"
            onPress={() => markAll.mutate()}
          >
            Mark all read
          </Txt>
        ) : null}
      </Row>

      {notifications.isLoading ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : (notifications.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon="◔"
          title="Nothing yet"
          body="Funding, submissions, approvals and verification codes will show up here."
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {notifications.data!.items.map((notification) => {
            const palette = tone(notification.severity);
            return (
              <Pressable
                key={notification.id}
                onPress={() => open(notification)}
                accessibilityRole="button"
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              >
                <Card
                  style={{
                    borderLeftWidth: notification.is_read ? 1 : 3,
                    borderLeftColor: notification.is_read
                      ? colors.border
                      : palette.fg,
                    backgroundColor: notification.is_read
                      ? colors.surface
                      : colors.surfaceRaised,
                  }}
                >
                  <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: radius.full,
                        backgroundColor: palette.bg,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Txt variant="captionStrong" style={{ color: palette.fg }}>
                        {SEVERITY_GLYPH[notification.severity]}
                      </Txt>
                    </View>

                    <View style={{ flex: 1, gap: 2 }}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                          {notification.title}
                        </Txt>
                        {!notification.is_read ? (
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: radius.full,
                              backgroundColor: colors.brand,
                              marginLeft: spacing.sm,
                            }}
                          />
                        ) : null}
                      </Row>
                      <Txt variant="caption" tone="secondary">
                        {notification.body}
                      </Txt>
                      <Txt variant="caption" tone="tertiary">
                        {formatDateTime(notification.created_at)}
                      </Txt>
                    </View>
                  </Row>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
