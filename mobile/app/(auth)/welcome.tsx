/**
 * Onboarding.
 *
 * Three panels, in the order the spec sets out: your money is protected,
 * payment follows milestones, and the AI helps you judge risk.
 *
 * Each panel is a full-bleed gradient with a floating glass tile, so the three
 * read as distinct places rather than three paragraphs on one grey page.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogoMark } from '@/components/Logo';
import { Row, Txt } from '@/components/ui';
import { GradientButton } from '@/components/uiverse';
import { gradients, useTheme } from '@/theme';

const PANELS = [
  {
    glyph: '🛡️',
    title: 'Your money.\nProtected.',
    body: 'Funds you commit to a milestone leave your spendable balance and are held. They move only when the agreed work is done.',
    gradient: gradients.wallet,
    tint: '#4F46E5',
  },
  {
    glyph: '◷',
    title: 'Pay by\nmilestone.',
    body: 'Break a project into stages with clear completion criteria. Payment is released stage by stage, as the work lands.',
    gradient: gradients.project,
    tint: '#00894D',
  },
  {
    glyph: '✦',
    title: 'Trust, with\nintelligence.',
    body: 'An AI Trust Score and an agreement review tell you where the risk is before you commit — and explain why.',
    gradient: gradients.assistant,
    tint: '#B44BC7',
  },
] as const;

export default function Welcome() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  const isLast = index === PANELS.length - 1;
  const panel = PANELS[index];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {PANELS.map((item) => (
          <LinearGradient
            key={item.title}
            colors={item.gradient as unknown as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width,
              paddingTop: insets.top + spacing.xxl,
              paddingHorizontal: spacing.xl,
              justifyContent: 'center',
              gap: spacing.xxl,
            }}
          >
            {/* Floating glass tile, echoing the project card's frosted panel. */}
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 34,
                borderTopRightRadius: 70,
                backgroundColor: 'rgba(255,255,255,0.82)',
                borderLeftWidth: 1,
                borderBottomWidth: 1,
                borderColor: 'rgba(255,255,255,0.95)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Txt variant="display" style={{ fontSize: 40 }}>
                {item.glyph}
              </Txt>
            </View>

            <Txt
              variant="display"
              style={{ fontSize: 36, lineHeight: 42, color: '#FFFFFF' }}
            >
              {item.title}
            </Txt>

            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.9)',
                borderRadius: radius.xl,
                padding: spacing.xl,
                maxWidth: 360,
              }}
            >
              <Txt variant="body" style={{ color: item.tint }}>
                {item.body}
              </Txt>
            </View>
          </LinearGradient>
        ))}
      </ScrollView>

      {/* Header floats over the gradient. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + spacing.md,
          left: spacing.xl,
          right: spacing.xl,
        }}
        pointerEvents="box-none"
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={spacing.sm}>
            <LogoMark size={26} color="#FFFFFF" accent="rgba(255,255,255,0.75)" />
            <Txt variant="h3" style={{ color: '#FFFFFF' }}>
              TrustPay
            </Txt>
          </Row>
          <Txt
            variant="captionStrong"
            style={{ color: 'rgba(255,255,255,0.9)' }}
            accessibilityRole="button"
            onPress={() => router.push('/(auth)/sign-in')}
          >
            Skip
          </Txt>
        </Row>
      </View>

      {/* Controls */}
      <View
        style={{
          paddingHorizontal: spacing.xl,
          paddingTop: spacing.xl,
          paddingBottom: insets.bottom + spacing.xl,
          gap: spacing.lg,
          backgroundColor: colors.background,
        }}
      >
        <Row gap={spacing.xs} style={{ justifyContent: 'center' }}>
          {PANELS.map((item, panelIndex) => (
            <Animated.View
              key={item.title}
              entering={FadeIn}
              style={{
                width: panelIndex === index ? 26 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor:
                  panelIndex === index ? panel.tint : colors.borderStrong,
              }}
            />
          ))}
        </Row>

        <GradientButton
          title={isLast ? 'Get started' : 'Next'}
          subtitle={isLast ? 'Create your account' : `${index + 1} of ${PANELS.length}`}
          reflection={false}
          onPress={() => {
            if (isLast) {
              router.push('/(auth)/sign-up');
            } else {
              scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
            }
          }}
        />

        <Txt
          variant="captionStrong"
          tone="brand"
          style={{ textAlign: 'center' }}
          accessibilityRole="button"
          onPress={() => router.push('/(auth)/sign-in')}
        >
          I already have an account
        </Txt>
      </View>
    </View>
  );
}
