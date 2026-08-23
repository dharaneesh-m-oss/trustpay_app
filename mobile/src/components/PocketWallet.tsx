/**
 * The wallet pocket.
 *
 * Rebuilt from byllzz/rude-bat-50. Every dimension, colour and offset is taken
 * from the original CSS:
 *
 *   wallet        280 × 230
 *   wallet-back   280 × 200, #1e341e, radius 22 22 60 60
 *   card          260 × 140, radius 16, padding 18, left 10
 *   card 1        #635bff, bottom 90  →  open: translateY(-75) rotate(-3deg)
 *   card 2        #9bd86a, bottom 65  →  open: translateY(-45) rotate(2deg)
 *   card 3        #ffffff / #003087, bottom 40 → open: translateY(-10)
 *   pocket        280 × 160
 *   balance       masked #839e7b → revealed #a7c59e
 *   entry         slideIntoPocket, staggered 0.1s / 0.2s / 0.3s
 *   card:hover    lift that card, straighten it, reveal its number
 *
 * Two deliberate changes:
 *
 * 1. The original drives everything from `:hover`, which does not exist on a
 *    phone. The pocket is the tap target for opening; tapping a single card
 *    lifts it and reveals its amount, which is the original's second hover
 *    state.
 *
 * 2. Opening requires Face ID, a fingerprint, or a PIN. The effect itself is
 *    untouched — the cards still fan, the balance still fades in — but the
 *    reveal is gated on proving who you are, so an unlocked phone left on a
 *    table does not show someone's money.
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { LockedAmount, useBalanceReveal } from '@/components/BalanceLock';
import { Txt } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { useWallet } from '@/lib/queries';
import { useTheme } from '@/theme';

/* Geometry, verbatim from the source component. */
const WALLET_W = 280;
const WALLET_H = 230;
const BACK_H = 200;
const CARD_W = 260;
const CARD_H = 140;
const POCKET_H = 160;

/** transition: transform .6s cubic-bezier(0.34, 1.56, 0.64, 1) */
const OPEN_EASING = Easing.bezier(0.34, 1.56, 0.64, 1);
/** animation: slideIntoPocket .8s cubic-bezier(0.2, 0.8, 0.2, 1) backwards */
const ENTRY_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

type PocketCard = {
  key: string;
  label: string;
  caption: string;
  holder: string;
  amount: string;
  background: string;
  foreground: string;
  chip: string;
  bottom: number;
  lift: number;
  rotate: string;
  soloLift: number;
  delay: number;
};

export function PocketWallet({ showCaption = true }: { showCaption?: boolean }) {
  const { spacing } = useTheme();

  const wallet = useWallet();
  const lock = useBalanceReveal();
  const [solo, setSolo] = useState<string | null>(null);

  // The wallet is open exactly when the balance is unlocked: one source of
  // truth, so the cards and the figures can never disagree about what is shown.
  const open = lock.unlocked;

  const currency = wallet.data?.currency ?? 'INR';
  const money = (value: string | undefined) =>
    value ? formatMoney(value, currency) : '—';

  const unlockHint = lock.capability?.biometricsAvailable
    ? 'Tap to unlock with biometrics'
    : 'Tap to unlock with your PIN';

  const cards: PocketCard[] = [
    {
      key: 'available',
      label: 'Available',
      caption: 'Spendable now',
      holder: 'TRUSTPAY WALLET',
      amount: money(wallet.data?.available),
      background: '#635bff',
      foreground: '#FFFFFF',
      chip: 'rgba(255,255,255,0.2)',
      bottom: 90,
      lift: 75,
      rotate: '-3deg',
      soloLift: 60,
      delay: 100,
    },
    {
      key: 'protected',
      label: 'Protected',
      caption: 'Held for milestones',
      holder: 'ESCROW',
      amount: money(wallet.data?.protected),
      background: '#9bd86a',
      foreground: '#1e341e',
      chip: 'rgba(255,255,255,0.28)',
      bottom: 65,
      lift: 45,
      rotate: '2deg',
      soloLift: 70,
      delay: 200,
    },
    {
      key: 'pending',
      label: 'Settling',
      caption: 'On its way out',
      holder: 'PAYOUT',
      amount: money(wallet.data?.pending_settlement),
      background: '#ffffff',
      foreground: '#003087',
      chip: 'rgba(0,0,0,0.05)',
      bottom: 40,
      lift: 10,
      rotate: '0deg',
      soloLift: 60,
      delay: 300,
    },
  ];

  return (
    <View style={{ alignItems: 'center', paddingTop: spacing.xxl }}>
      {/* A plain View, not a Pressable: it contains the card buttons, and a
          button nested inside a button is invalid HTML. The pocket below is
          the tap target. */}
      <View
        style={{
          width: WALLET_W,
          height: WALLET_H + 60,
          justifyContent: 'flex-end',
        }}
      >
        {/* .wallet-back */}
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            width: WALLET_W,
            height: BACK_H,
            backgroundColor: '#1e341e',
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            borderBottomLeftRadius: 60,
            borderBottomRightRadius: 60,
          }}
        >
          {/* Stand-in for the original's two inset shadows, which RN has no
              equivalent for: a darker wash down the inside top. */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 60,
              backgroundColor: 'rgba(0,0,0,0.35)',
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
            }}
          />
        </View>

        {/* .card ×3 — lowest z first */}
        {cards.map((card, index) => (
          <PocketCardView
            key={card.key}
            card={card}
            open={open}
            unlocked={lock.unlocked}
            solo={solo === card.key}
            zIndex={10 + index * 10}
            onSolo={() =>
              setSolo((current) => (current === card.key ? null : card.key))
            }
          />
        ))}

        {/* .pocket — covers the lower half of the stack, and is the tap target */}
        <Pressable
          onPress={() => {
            setSolo(null);
            lock.reveal();
          }}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Hide balance' : 'Unlock to show balance'}
          accessibilityState={{ expanded: open }}
          style={{
            position: 'absolute',
            bottom: 0,
            width: WALLET_W,
            height: POCKET_H,
            zIndex: 40,
            backgroundColor: '#1e341e',
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            borderBottomLeftRadius: 60,
            borderBottomRightRadius: 60,
            shadowColor: 'rgb(20, 40, 20)',
            shadowOpacity: 0.4,
            shadowRadius: 25,
            shadowOffset: { width: 0, height: 15 },
            elevation: 12,
          }}
        >
          {/* The dashed inner seam. */}
          <View
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              right: 10,
              bottom: 10,
              borderRadius: 18,
              borderBottomLeftRadius: 52,
              borderBottomRightRadius: 52,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: 'rgba(131,158,123,0.45)',
            }}
          />

          {/* .pocket-content */}
          <View
            style={{
              position: 'absolute',
              top: 45,
              width: '100%',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <View style={{ height: 34, justifyContent: 'center' }}>
              <LockedAmount
                value={money(wallet.data?.total)}
                unlocked={open}
                checking={lock.checking}
                style={{ color: '#a7c59e', fontSize: 26, fontWeight: '700' }}
                maskedStyle={{ color: '#839e7b', fontSize: 24, letterSpacing: 4 }}
              />
            </View>

            <Text style={{ color: '#839e7b', fontSize: 13, fontWeight: '600' }}>
              Total Balance
            </Text>

            {/* .eye-icon-wrapper — 0.3 opacity closed, full when open */}
            <Text
              style={{
                fontSize: 17,
                marginTop: 4,
                opacity: open ? 1 : 0.3,
                color: '#3be60b',
              }}
            >
              {open ? '👁' : '🔒'}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* .wallet::after */}
      {showCaption ? (
        <Txt
          variant="caption"
          style={{
            marginTop: spacing.xl,
            color: '#003087',
            fontStyle: 'italic',
            fontWeight: '600',
            textDecorationLine: 'underline',
          }}
        >
          {open ? 'Tap the wallet to hide balance' : unlockHint}
        </Txt>
      ) : null}

      {lock.sheet}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function PocketCardView({
  card,
  open,
  unlocked,
  solo,
  zIndex,
  onSolo,
}: {
  card: PocketCard;
  open: boolean;
  unlocked: boolean;
  solo: boolean;
  zIndex: number;
  onSolo: () => void;
}) {
  const entry = useSharedValue(0);
  const lift = useSharedValue(0);
  const soloLift = useSharedValue(0);

  React.useEffect(() => {
    // @keyframes slideIntoPocket — drops in from -100px, staggered per card.
    entry.value = withDelay(
      card.delay,
      withTiming(1, { duration: 800, easing: ENTRY_EASING }),
    );
  }, [entry, card.delay]);

  React.useEffect(() => {
    lift.value = withTiming(open ? 1 : 0, { duration: 600, easing: OPEN_EASING });
  }, [open, lift]);

  React.useEffect(() => {
    soloLift.value = withTiming(solo ? 1 : 0, {
      duration: 600,
      easing: OPEN_EASING,
    });
  }, [solo, soloLift]);

  const animated = useAnimatedStyle(() => {
    // Open lifts to `lift`; picking one card out overrides that with `soloLift`
    // and straightens it, exactly as the original's `.card:hover` does.
    const travel =
      lift.value * card.lift + soloLift.value * (card.soloLift - card.lift);

    return {
      opacity: entry.value,
      transform: [
        { translateY: (1 - entry.value) * -100 - travel },
        { rotate: solo ? '0deg' : open ? card.rotate : '0deg' },
        { scale: 1 + soloLift.value * 0.05 },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 10,
          bottom: card.bottom,
          width: CARD_W,
          height: CARD_H,
          zIndex: solo ? 100 : zIndex,
        },
        animated,
      ]}
    >
      <Pressable
        onPress={onSolo}
        accessibilityRole="button"
        accessibilityLabel={`${card.label}: ${
          solo && unlocked ? card.amount : 'hidden'
        }`}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 16,
          padding: 18,
          backgroundColor: card.background,
          justifyContent: 'space-between',
          shadowColor: '#000000',
          shadowOpacity: 0.1,
          shadowRadius: 15,
          shadowOffset: { width: 0, height: -4 },
          elevation: 5,
        }}
      >
        {/* .card-top */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 14,
              letterSpacing: 1,
              textTransform: 'uppercase',
              fontWeight: '700',
              color: card.foreground,
            }}
          >
            {card.label}
          </Text>
          {/* .chip */}
          <View
            style={{
              width: 32,
              height: 24,
              borderRadius: 4,
              backgroundColor: card.chip,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.1)',
            }}
          />
        </View>

        {/* .card-bottom */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <View>
            <Text
              style={{
                fontSize: 8,
                opacity: 0.7,
                textTransform: 'uppercase',
                marginBottom: 2,
                color: card.foreground,
              }}
            >
              {card.caption}
            </Text>
            <Text
              style={{ fontSize: 10, fontWeight: '500', color: card.foreground }}
            >
              {card.holder}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            {solo && unlocked ? (
              <Text
                style={{
                  fontSize: 14,
                  letterSpacing: 1,
                  fontWeight: '700',
                  color: card.foreground,
                }}
              >
                {card.amount}
              </Text>
            ) : (
              <Text
                style={{ fontSize: 16, letterSpacing: 2, color: card.foreground }}
              >
                •••• ••••
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
