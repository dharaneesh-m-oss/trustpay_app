/**
 * TrustPay's signature components.
 *
 * These carry the product's meaning, not just its layout: what money is
 * available versus protected, how far a project has travelled, and why the AI
 * scored someone the way it did.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Badge, BadgeTone, Card, Divider, Row, Txt } from '@/components/ui';
import { formatMoney, formatSigned, splitAmount, symbolFor } from '@/lib/money';
import { useTheme } from '@/theme';

/* ------------------------------------------------------------- money display */

/**
 * A monetary amount rendered with the paise de-emphasised.
 *
 * Payments apps do this because the rupees are the number people read and the
 * paise are the number they verify. Showing both at the same weight makes the
 * figure harder to scan at a glance.
 */
export function Amount({
  value,
  currency = 'INR',
  size = 'display',
  tone = 'primary',
}: {
  value: string;
  currency?: string;
  size?: 'display' | 'h1' | 'h2' | 'h3' | 'body';
  tone?: 'primary' | 'secondary' | 'inverse' | 'success' | 'danger' | 'brand';
}) {
  const { typography, colors } = useTheme();
  const [whole, fraction] = splitAmount(value);

  const tones = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    inverse: colors.textInverse,
    success: colors.success,
    danger: colors.danger,
    brand: colors.brand,
  };
  const base = typography[size];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Text
        style={{
          ...base,
          color: tones[tone],
          fontSize: base.fontSize * 0.62,
          marginRight: 1,
        }}
      >
        {symbolFor(currency)}
      </Text>
      <Text style={{ ...base, color: tones[tone] }}>{whole}</Text>
      <Text
        style={{
          ...base,
          color: tones[tone],
          fontSize: base.fontSize * 0.58,
          opacity: 0.65,
        }}
      >
        .{fraction}
      </Text>
    </View>
  );
}

/* --------------------------------------------------------------- balance card */

/**
 * The card at the top of the home screen.
 *
 * Available is the headline because it answers "what can I spend?". Protected
 * sits beside it rather than being folded into a single total — conflating the
 * two is exactly the confusion TrustPay exists to remove.
 */
export function BalanceCard({
  available,
  protectedAmount,
  currency = 'INR',
  demoMode,
  onAddMoney,
  onWithdraw,
}: {
  available: string;
  protectedAmount: string;
  currency?: string;
  demoMode?: boolean;
  onAddMoney: () => void;
  onWithdraw: () => void;
}) {
  const { colors, spacing, radius, typography } = useTheme();

  return (
    <Animated.View entering={FadeInDown.duration(320)}>
      <View
        style={{
          backgroundColor: colors.brand,
          borderRadius: radius.xl,
          padding: spacing.xl,
          gap: spacing.lg,
          overflow: 'hidden',
        }}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="overline" style={{ color: 'rgba(255,255,255,0.72)' }}>
            Available balance
          </Txt>
          {demoMode ? (
            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.18)',
                borderRadius: radius.full,
                paddingHorizontal: spacing.sm,
                paddingVertical: 3,
              }}
            >
              <Text
                style={{
                  ...typography.overline,
                  color: '#FFFFFF',
                  fontSize: 9,
                }}
              >
                Demo mode
              </Text>
            </View>
          ) : null}
        </Row>

        <Amount value={available} currency={currency} size="display" tone="inverse" />

        <View
          style={{
            backgroundColor: 'rgba(255,255,255,0.14)',
            borderRadius: radius.md,
            padding: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
          }}
        >
          <Text style={{ fontSize: 15 }}>🛡️</Text>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                ...typography.caption,
                color: 'rgba(255,255,255,0.75)',
                fontSize: 11,
              }}
            >
              Protected in milestones
            </Text>
            <Text style={{ ...typography.bodyStrong, color: '#FFFFFF' }}>
              {formatMoney(protectedAmount, currency)}
            </Text>
          </View>
        </View>

        <Row gap={spacing.sm}>
          <QuickAction label="Add money" glyph="＋" onPress={onAddMoney} inverse />
          <QuickAction label="Withdraw" glyph="↑" onPress={onWithdraw} inverse />
        </Row>
      </View>
    </Animated.View>
  );
}

/** The tile grid every Indian payments app opens with. */
export function QuickAction({
  label,
  glyph,
  onPress,
  inverse = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  inverse?: boolean;
}) {
  const { colors, radius, spacing, typography } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 48,
        borderRadius: radius.md,
        backgroundColor: inverse ? 'rgba(255,255,255,0.18)' : colors.surface,
        borderWidth: inverse ? 0 : 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: spacing.xs,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ fontSize: 15, color: inverse ? '#FFFFFF' : colors.brand }}>
        {glyph}
      </Text>
      <Text
        style={{
          ...typography.captionStrong,
          color: inverse ? '#FFFFFF' : colors.textPrimary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------ trust score */

const BAND_TONE: Record<string, BadgeTone> = {
  VERY_LOW: 'success',
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
  VERY_HIGH: 'danger',
};

export type TrustScoreData = {
  score: number;
  band: string;
  band_label: string;
  confidence: string;
  positive_reasons: string[];
  risk_reasons: string[];
  delta: number | null;
  limited_data_notice: string | null;
};

/**
 * The Trust Score, with its reasons.
 *
 * The number alone would be a black box, and section 21 is explicit that a user
 * must be able to see why. The arc animates on mount — the one piece of motion
 * that earns its place here, because it makes the score feel measured rather
 * than asserted.
 */
export function TrustScoreCard({
  data,
  compact = false,
  onPress,
}: {
  data: TrustScoreData;
  compact?: boolean;
  onPress?: () => void;
}) {
  const { colors, spacing, radius, typography } = useTheme();
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withDelay(120, withTiming(data.score / 100, { duration: 900 }));
  }, [data.score, progress]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const tone = BAND_TONE[data.band] ?? 'neutral';
  const barColor =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.danger
          : colors.brand;

  const body = (
    <Card>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: spacing.xxs }}>
          <Txt variant="overline" tone="secondary">
            Trust Score
          </Txt>
          <Row gap={spacing.xs} style={{ alignItems: 'baseline' }}>
            <Text style={{ ...typography.display, color: colors.textPrimary }}>
              {data.score}
            </Text>
            <Txt variant="body" tone="tertiary">
              / 100
            </Txt>
          </Row>
        </View>

        <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
          <Badge label={data.band_label} tone={tone} />
          {data.delta !== null && data.delta !== 0 ? (
            <Txt
              variant="caption"
              tone={data.delta > 0 ? 'success' : 'danger'}
            >
              {data.delta > 0 ? '▲' : '▼'} {Math.abs(data.delta)} since last check
            </Txt>
          ) : null}
        </View>
      </Row>

      <View
        style={{
          height: 6,
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius.full,
          marginTop: spacing.lg,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={[
            { height: '100%', backgroundColor: barColor, borderRadius: radius.full },
            barStyle,
          ]}
        />
      </View>

      <Row style={{ marginTop: spacing.sm, justifyContent: 'space-between' }}>
        <Txt variant="caption" tone="tertiary">
          Confidence: {data.confidence.toLowerCase()}
        </Txt>
        {compact ? (
          <Txt variant="caption" tone="brand">
            Why this score →
          </Txt>
        ) : null}
      </Row>

      {!compact ? (
        <>
          <Divider style={{ marginVertical: spacing.lg }} />
          <Txt variant="captionStrong" tone="secondary" style={{ marginBottom: spacing.sm }}>
            Why this score?
          </Txt>
          <View style={{ gap: spacing.sm }}>
            {data.positive_reasons.map((reason) => (
              <Row key={reason} gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
                <Text style={{ color: colors.success, fontSize: 13 }}>✓</Text>
                <Txt variant="caption" style={{ flex: 1 }}>
                  {reason}
                </Txt>
              </Row>
            ))}
            {data.risk_reasons.map((reason) => (
              <Row key={reason} gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
                <Text style={{ color: colors.warning, fontSize: 13 }}>!</Text>
                <Txt variant="caption" style={{ flex: 1 }}>
                  {reason}
                </Txt>
              </Row>
            ))}
          </View>

          {data.limited_data_notice ? (
            <View
              style={{
                marginTop: spacing.lg,
                padding: spacing.md,
                backgroundColor: colors.infoMuted,
                borderRadius: radius.md,
              }}
            >
              <Txt variant="caption" tone="secondary">
                {data.limited_data_notice}
              </Txt>
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );

  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    body
  );
}

/* -------------------------------------------------------------- milestones */

export const MILESTONE_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  PENDING_FUNDING: 'warning',
  FUNDED: 'brand',
  IN_PROGRESS: 'info',
  SUBMITTED: 'warning',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  PAYMENT_RELEASED: 'success',
  DISPUTED: 'danger',
  CANCELLATION_REQUESTED: 'danger',
  CANCELLED: 'neutral',
};

export type Milestone = {
  id: string;
  project_id: string;
  sequence: number;
  title: string;
  description: string;
  completion_criteria: string;
  amount: string;
  currency: string;
  due_date: string | null;
  status: string;
  status_label: string;
  revision_limit: number;
  revisions_used: number;
  is_funded: boolean;
  is_released: boolean;
};

/**
 * The vertical timeline on a project.
 *
 * Each step shows its number, state and amount. The connector between steps is
 * filled for completed work and hairline for what is still ahead, so progress
 * is legible without reading a single label.
 */
export function MilestoneTimelineItem({
  milestone,
  isLast,
  onPress,
}: {
  milestone: Milestone;
  isLast: boolean;
  onPress: () => void;
}) {
  const { colors, spacing, radius, typography } = useTheme();

  const done = milestone.status === 'PAYMENT_RELEASED';
  const cancelled = milestone.status === 'CANCELLED';
  const active = !done && !cancelled && milestone.status !== 'PENDING_FUNDING';

  const markerColor = done
    ? colors.success
    : cancelled
      ? colors.textTertiary
      : active
        ? colors.brand
        : colors.border;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Milestone ${milestone.sequence}, ${milestone.title}, ${milestone.status_label}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row' })}
    >
      {/* Rail */}
      <View style={{ width: 32, alignItems: 'center' }}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: radius.full,
            borderWidth: 2,
            borderColor: markerColor,
            backgroundColor: done ? colors.success : colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              ...typography.overline,
              fontSize: 10,
              color: done ? '#FFFFFF' : markerColor,
            }}
          >
            {done ? '✓' : String(milestone.sequence).padStart(2, '0')}
          </Text>
        </View>
        {!isLast ? (
          <View
            style={{
              flex: 1,
              width: done ? 2 : 1,
              backgroundColor: done ? colors.success : colors.border,
              marginVertical: 4,
            }}
          />
        ) : null}
      </View>

      {/* Content */}
      <View style={{ flex: 1, paddingBottom: isLast ? 0 : spacing.lg, gap: spacing.xs }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {milestone.title}
          </Txt>
          <Amount value={milestone.amount} currency={milestone.currency} size="body" />
        </Row>

        <Row style={{ justifyContent: 'space-between' }}>
          <Badge
            label={milestone.status_label}
            tone={MILESTONE_TONE[milestone.status] ?? 'neutral'}
          />
          {milestone.due_date ? (
            <Txt variant="caption" tone="tertiary">
              Due {formatDate(milestone.due_date)}
            </Txt>
          ) : null}
        </Row>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------- transactions */

export type Transaction = {
  id: string;
  transaction_type: string;
  status: string;
  amount: string;
  currency: string;
  description: string;
  created_at: string;
  direction_for_user: 'CREDIT' | 'DEBIT' | 'INTERNAL';
  net_effect: string;
  is_simulated: boolean;
};

const TRANSACTION_GLYPH: Record<string, string> = {
  TOP_UP: '↓',
  WITHDRAWAL: '↑',
  MILESTONE_FUNDING: '🛡️',
  PAYMENT_RELEASE: '✓',
  REFUND: '↩',
  FEE: '%',
  ADJUSTMENT: '⇄',
};

export function TransactionRow({ transaction }: { transaction: Transaction }) {
  const { colors, spacing, radius } = useTheme();

  const isCredit = transaction.direction_for_user === 'CREDIT';
  const isInternal = transaction.direction_for_user === 'INTERNAL';

  return (
    <Row style={{ paddingVertical: spacing.md }} gap={spacing.md}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.full,
          backgroundColor: isInternal
            ? colors.brandMuted
            : isCredit
              ? colors.successMuted
              : colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 15 }}>
          {TRANSACTION_GLYPH[transaction.transaction_type] ?? '•'}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {transaction.description}
        </Txt>
        <Txt variant="caption" tone="tertiary">
          {formatDateTime(transaction.created_at)}
        </Txt>
      </View>

      <View style={{ alignItems: 'flex-end' }}>
        {isInternal ? (
          <Txt variant="bodyStrong" tone="brand">
            {formatMoney(transaction.amount, transaction.currency)}
          </Txt>
        ) : (
          <Txt variant="bodyStrong" tone={isCredit ? 'success' : 'primary'}>
            {formatSigned(transaction.net_effect, transaction.currency)}
          </Txt>
        )}
        {isInternal ? (
          <Txt variant="caption" tone="tertiary">
            Protected
          </Txt>
        ) : null}
      </View>
    </Row>
  );
}

/* ----------------------------------------------------------------- project */

export type Project = {
  id: string;
  title: string;
  status: string;
  total_amount: string;
  currency: string;
  protected_amount: string;
  released_amount: string;
  your_role: string;
  milestones_total: number;
  milestones_completed: number;
  client: { id: string; full_name: string };
  receiver: { id: string; full_name: string } | null;
  invited_receiver_email?: string | null;
};

const PROJECT_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  AWAITING_ACCEPTANCE: 'warning',
  ACTIVE: 'brand',
  ON_HOLD: 'warning',
  UNDER_DISPUTE: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  DECLINED: 'neutral',
};

export function ProjectCard({ project }: { project: Project }) {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();

  const progress =
    project.milestones_total > 0
      ? project.milestones_completed / project.milestones_total
      : 0;

  const counterparty =
    project.your_role === 'CLIENT'
      ? (project.receiver?.full_name ??
        // An invitation can be waiting on someone who has not joined yet.
        (project.invited_receiver_email
          ? `${project.invited_receiver_email} (invited)`
          : 'No receiver yet'))
      : project.client.full_name;

  return (
    <Pressable
      onPress={() => router.push(`/project/${project.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <Card>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="h3" numberOfLines={1}>
              {project.title}
            </Txt>
            <Txt variant="caption" tone="secondary">
              {project.your_role === 'CLIENT' ? 'To' : 'From'} {counterparty}
            </Txt>
          </View>
          <Badge
            label={project.status.replace(/_/g, ' ').toLowerCase()}
            tone={PROJECT_TONE[project.status] ?? 'neutral'}
          />
        </Row>

        <Row style={{ marginTop: spacing.lg, justifyContent: 'space-between' }}>
          <View>
            <Txt variant="caption" tone="tertiary">
              Protected
            </Txt>
            <Amount
              value={project.protected_amount}
              currency={project.currency}
              size="h3"
              tone={project.protected_amount === '0.00' ? 'secondary' : 'brand'}
            />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt variant="caption" tone="tertiary">
              Milestones
            </Txt>
            <Txt variant="h3">
              {project.milestones_completed} / {project.milestones_total}
            </Txt>
          </View>
        </Row>

        <View
          style={{
            height: 4,
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.full,
            marginTop: spacing.md,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              backgroundColor: colors.success,
              borderRadius: radius.full,
            }}
          />
        </View>
      </Card>
    </Pressable>
  );
}

/* ------------------------------------------------------------- AI insight */

export function AIInsightCard({
  title,
  body,
  tone = 'brand',
  footer,
  onPress,
}: {
  title: string;
  body: string;
  tone?: BadgeTone;
  footer?: string;
  onPress?: () => void;
}) {
  const { colors, spacing, radius } = useTheme();

  const accent =
    tone === 'danger'
      ? colors.danger
      : tone === 'warning'
        ? colors.warning
        : tone === 'success'
          ? colors.success
          : colors.brand;

  const content = (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 3,
        borderLeftColor: accent,
        padding: spacing.lg,
        gap: spacing.xs,
      }}
    >
      <Row gap={spacing.xs}>
        <Text style={{ fontSize: 12 }}>✦</Text>
        <Txt variant="overline" tone="secondary">
          {title}
        </Txt>
      </Row>
      <Txt variant="body">{body}</Txt>
      {footer ? (
        <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.xs }}>
          {footer}
        </Txt>
      ) : null}
    </View>
  );

  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button">
      {content}
    </Pressable>
  ) : (
    content
  );
}

/* ------------------------------------------------------------------- dates */

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();

  if (isToday) {
    return `Today, ${date.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  }
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}
