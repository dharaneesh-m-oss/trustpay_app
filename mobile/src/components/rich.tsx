/**
 * The components that give TrustPay the density and polish of a real payments
 * app rather than a form on a card.
 *
 * The reference points are the apps people in India already use daily: a
 * gradient balance header, a grid of labelled action tiles, avatar rows for
 * counterparties, compact stat strips, and an insight carousel. What is
 * deliberately *not* borrowed is their visual identity — the palette, the
 * protected-funds language and the trust gauge are TrustPay's own.
 */

import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

import { LockedAmount } from '@/components/BalanceLock';
import { Badge, BadgeTone, Card, Row, Txt } from '@/components/ui';
import { formatCompact, formatMoney } from '@/lib/money';
import { useTheme } from '@/theme';

import { Amount } from './product';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/* ------------------------------------------------------------------ avatar */

/** Initials avatar with a hue derived from the name, so people are recognisable
 *  by colour before the label is read. */
export function Avatar({
  name,
  size = 40,
  tone,
}: {
  name: string;
  size?: number;
  tone?: string;
}) {
  const { colors, radius, typography } = useTheme();

  const initials = name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // Stable per-name hue: same person, same colour, every screen.
  const hue = React.useMemo(() => {
    let total = 0;
    for (let index = 0; index < name.length; index += 1) {
      total = (total + name.charCodeAt(index) * 31) % 360;
    }
    return total;
  }, [name]);

  const background = tone ?? `hsl(${hue}, 62%, 92%)`;
  const foreground = tone ? colors.onBrand : `hsl(${hue}, 55%, 32%)`;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          ...typography.captionStrong,
          color: foreground,
          fontSize: size * 0.36,
        }}
      >
        {initials || '?'}
      </Text>
    </View>
  );
}

/* ----------------------------------------------------------- balance header */

/**
 * The gradient header the app opens on.
 *
 * Available is the headline because it answers "what can I spend right now?".
 * Protected sits directly beneath it as a separate figure — never summed into
 * one number, because the whole product exists to keep those two apart.
 */
export function BalanceHeader({
  available,
  protectedAmount,
  pending,
  currency = 'INR',
  demoMode,
  trustScore,
  onPressTrust,
  unlocked = false,
  checking = false,
  onToggleBalance,
}: {
  available: string;
  protectedAmount: string;
  pending?: string;
  currency?: string;
  demoMode?: boolean;
  trustScore?: number;
  onPressTrust?: () => void;
  /** Whether the balance may be shown. Defaults to hidden. */
  unlocked?: boolean;
  checking?: boolean;
  onToggleBalance?: () => void;
}) {
  const { colors, spacing, radius, typography, isDark } = useTheme();

  const gradient = isDark
    ? (['#1E1B57', '#151533', '#0B0B0F'] as const)
    : (['#5B5FEF', '#4640D6', '#3A33AC'] as const);

  return (
    <Animated.View entering={FadeInDown.duration(320)}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: radius.xl,
          padding: spacing.xl,
          gap: spacing.lg,
        }}
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text
              style={{
                ...typography.overline,
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              Available balance
            </Text>
            <View style={{ marginTop: spacing.xs }}>
              {unlocked ? (
                <Pressable
                  onPress={onToggleBalance}
                  accessibilityRole="button"
                  accessibilityLabel="Hide balance"
                >
                  <Amount
                    value={available}
                    currency={currency}
                    size="display"
                    tone="inverse"
                  />
                </Pressable>
              ) : (
                <LockedAmount
                  value={available}
                  unlocked={false}
                  checking={checking}
                  onPress={onToggleBalance}
                  style={{
                    ...typography.display,
                    color: '#FFFFFF',
                  }}
                  mask="••••••"
                />
              )}
            </View>
          </View>

          {trustScore !== undefined ? (
            <Pressable
              onPress={onPressTrust}
              accessibilityRole="button"
              accessibilityLabel={`Trust Score ${trustScore} out of 100`}
              style={{ alignItems: 'center' }}
            >
              <TrustRing score={trustScore} size={56} inverse />
            </Pressable>
          ) : null}
        </Row>

        <Row gap={spacing.sm}>
          <PocketChip
            label="Protected"
            value={unlocked ? formatMoney(protectedAmount, currency) : '••••'}
            glyph="🛡️"
          />
          <PocketChip
            label="Settling"
            value={unlocked ? formatMoney(pending ?? '0.00', currency) : '••••'}
            glyph="◷"
          />
        </Row>

        {!unlocked ? (
          <Row gap={spacing.xs}>
            <Text style={{ fontSize: 11 }}>🔒</Text>
            <Text
              style={{
                ...typography.caption,
                color: 'rgba(255,255,255,0.75)',
                fontSize: 11,
              }}
            >
              Tap the balance to unlock
            </Text>
          </Row>
        ) : null}

        {demoMode ? (
          <Row gap={spacing.xs}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: radius.full,
                backgroundColor: 'rgba(255,255,255,0.6)',
              }}
            />
            <Text
              style={{
                ...typography.caption,
                color: 'rgba(255,255,255,0.68)',
                fontSize: 11,
              }}
            >
              Demo mode — simulated funds, no real money moves
            </Text>
          </Row>
        ) : null}
      </LinearGradient>
    </Animated.View>
  );
}

function PocketChip({
  label,
  value,
  glyph,
}: {
  label: string;
  value: string;
  glyph: string;
}) {
  const { spacing, radius, typography } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderRadius: radius.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
      }}
    >
      <Text style={{ fontSize: 14 }}>{glyph}</Text>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            ...typography.caption,
            color: 'rgba(255,255,255,0.7)',
            fontSize: 10,
          }}
        >
          {label}
        </Text>
        <Text
          style={{ ...typography.captionStrong, color: '#FFFFFF' }}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------- trust ring */

/**
 * Circular score gauge.
 *
 * The arc sweeps from 0 to the score on mount. It is the one piece of
 * decoration in the app that earns its place: it makes the score feel measured
 * rather than asserted, which matters for a number people are asked to trust.
 */
export function TrustRing({
  score,
  size = 120,
  inverse = false,
  showLabel = false,
}: {
  score: number;
  size?: number;
  inverse?: boolean;
  showLabel?: boolean;
}) {
  const { colors, typography } = useTheme();

  const strokeWidth = size < 70 ? 4 : 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withDelay(
      150,
      withTiming(Math.max(0, Math.min(100, score)) / 100, { duration: 900 }),
    );
  }, [score, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  const band =
    score >= 75 ? colors.success : score >= 50 ? colors.warning : colors.danger;
  const track = inverse ? 'rgba(255,255,255,0.25)' : colors.surfaceMuted;
  const stroke = inverse ? '#FFFFFF' : band;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={track}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          // Start the sweep at 12 o'clock instead of 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>

      <View style={{ alignItems: 'center' }}>
        <Text
          style={{
            ...(size < 70 ? typography.captionStrong : typography.h1),
            color: inverse ? '#FFFFFF' : colors.textPrimary,
          }}
        >
          {score}
        </Text>
        {showLabel ? (
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>
            out of 100
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* ----------------------------------------------------------- action grid */

export type ActionTile = {
  key: string;
  label: string;
  glyph: string;
  onPress: () => void;
  tone?: BadgeTone;
  badge?: string;
};

/** The labelled tile grid every Indian payments app opens with. */
export function ActionGrid({ actions }: { actions: ActionTile[] }) {
  const { colors, spacing, radius, typography } = useTheme();
  const { width } = useWindowDimensions();

  // Four across on a phone, more on a wide screen, never fewer than three.
  const columns = width >= 620 ? 6 : 4;
  const gap = spacing.sm;

  const toneColor: Record<string, string> = {
    brand: colors.brand,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.info,
    neutral: colors.textSecondary,
  };
  const toneBackground: Record<string, string> = {
    brand: colors.brandMuted,
    success: colors.successMuted,
    warning: colors.warningMuted,
    danger: colors.dangerMuted,
    info: colors.infoMuted,
    neutral: colors.surfaceMuted,
  };

  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          rowGap: spacing.lg,
        }}
      >
        {actions.map((action) => {
          const tone = action.tone ?? 'brand';
          return (
            <Pressable
              key={action.key}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => ({
                width: `${100 / columns}%`,
                alignItems: 'center',
                gap: spacing.xs,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.lg,
                  backgroundColor: toneBackground[tone],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 20, color: toneColor[tone] }}>
                  {action.glyph}
                </Text>
                {action.badge ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -6,
                      minWidth: 18,
                      paddingHorizontal: 5,
                      height: 18,
                      borderRadius: radius.full,
                      backgroundColor: colors.danger,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}
                    >
                      {action.badge}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={{
                  ...typography.caption,
                  color: colors.textSecondary,
                  fontSize: 11,
                  textAlign: 'center',
                }}
                numberOfLines={2}
              >
                {action.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------- stat strip */

export function StatStrip({
  items,
}: {
  items: { label: string; value: string; tone?: 'primary' | 'success' | 'warning' | 'brand' }[];
}) {
  const { colors, spacing, radius } = useTheme();

  return (
    <Row gap={spacing.sm}>
      {items.map((item) => (
        <View
          key={item.label}
          style={{
            flex: 1,
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.md,
            gap: 2,
          }}
        >
          <Txt variant="caption" tone="tertiary" numberOfLines={1}>
            {item.label}
          </Txt>
          <Txt variant="h3" tone={item.tone ?? 'primary'} numberOfLines={1}>
            {item.value}
          </Txt>
        </View>
      ))}
    </Row>
  );
}

/* --------------------------------------------------------- people carousel */

/** Horizontal row of counterparties — the "send again" pattern, adapted to
 *  projects rather than contacts. */
export function PeopleRow({
  people,
  onPress,
  onAdd,
}: {
  people: { id: string; name: string; subtitle?: string }[];
  onPress: (id: string) => void;
  onAdd?: () => void;
}) {
  const { colors, spacing, radius } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.lg, paddingVertical: spacing.xs }}
    >
      {onAdd ? (
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Start a new project"
          style={{ alignItems: 'center', width: 64, gap: spacing.xs }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.full,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: colors.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt variant="h3" tone="brand">
              ＋
            </Txt>
          </View>
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            New
          </Txt>
        </Pressable>
      ) : null}

      {people.map((person) => (
        <Pressable
          key={person.id}
          onPress={() => onPress(person.id)}
          accessibilityRole="button"
          accessibilityLabel={person.name}
          style={{ alignItems: 'center', width: 64, gap: spacing.xs }}
        >
          <Avatar name={person.name} size={48} />
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {person.name.split(' ')[0]}
          </Txt>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/* ------------------------------------------------------- insight carousel */

export function InsightCarousel({
  items,
}: {
  items: {
    key: string;
    title: string;
    body: string;
    tone?: BadgeTone;
    onPress?: () => void;
  }[];
}) {
  const { colors, spacing, radius } = useTheme();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 72, 300);

  const accent: Record<string, string> = {
    brand: colors.brand,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.info,
    neutral: colors.textSecondary,
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + spacing.md}
      decelerationRate="fast"
      contentContainerStyle={{ gap: spacing.md }}
    >
      {items.map((item) => (
        <Pressable
          key={item.key}
          onPress={item.onPress}
          accessibilityRole={item.onPress ? 'button' : undefined}
          style={{ width: cardWidth }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              borderLeftWidth: 3,
              borderLeftColor: accent[item.tone ?? 'brand'],
              padding: spacing.lg,
              gap: spacing.xs,
              minHeight: 108,
            }}
          >
            <Row gap={spacing.xs}>
              <Txt variant="caption">✦</Txt>
              <Txt variant="overline" tone="secondary" numberOfLines={1}>
                {item.title}
              </Txt>
            </Row>
            <Txt variant="caption" tone="secondary" numberOfLines={4}>
              {item.body}
            </Txt>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/* ------------------------------------------------------- milestone strip */

/** Compact progress pips for a project card — how far along, at a glance. */
export function MilestonePips({
  total,
  completed,
  active,
}: {
  total: number;
  completed: number;
  active?: number;
}) {
  const { colors, spacing, radius } = useTheme();

  return (
    <Row gap={4}>
      {Array.from({ length: total }).map((_, index) => {
        const isDone = index < completed;
        const isActive = active !== undefined && index === active;
        return (
          <View
            key={index}
            style={{
              flex: 1,
              height: 4,
              borderRadius: radius.full,
              backgroundColor: isDone
                ? colors.success
                : isActive
                  ? colors.brand
                  : colors.surfaceMuted,
            }}
          />
        );
      })}
    </Row>
  );
}

/* ----------------------------------------------------------- engine badge */

/** Says whether Claude or the built-in checks produced an AI answer.
 *  Being explicit about this is the difference between an AI feature and an
 *  AI claim. */
export function EngineBadge({ engine, model }: { engine?: string; model?: string | null }) {
  if (!engine) return null;
  const isModel = engine === 'claude';
  return (
    <Badge
      label={isModel ? (model ?? 'Claude') : 'Built-in checks'}
      tone={isModel ? 'brand' : 'neutral'}
      icon={isModel ? '✦' : '⚙'}
    />
  );
}
