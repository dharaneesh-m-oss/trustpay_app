"""One-off patch: wire the balance lock into the pocket wallet.

Kept as a file rather than an inline shell heredoc because the replacements
contain backticks and quotes that the shell mangles.
"""

import pathlib

p = pathlib.Path("app/wallet/cards.tsx")
s = p.read_text(encoding="utf-8")


def swap(old: str, new: str, label: str) -> None:
    global s
    if old not in s:
        raise SystemExit(f"PATCH MISS: {label}")
    s = s.replace(old, new)


swap(
    """ * The one unavoidable change: the original drives all of this from `:hover`,
 * which does not exist on a phone. Tapping the wallet opens and closes it;
 * tapping a single card lifts that one and shows its amount in full, which is
 * the original's second hover state. It opens by default so the effect is
 * visible on arrival rather than hidden behind an interaction.
 */""",
    """ * Two deliberate changes:
 *
 * 1. The original drives everything from `:hover`, which does not exist on a
 *    phone. Tapping the pocket opens and closes the wallet; tapping a single
 *    card lifts it and shows its amount, which is the original's second hover
 *    state.
 *
 * 2. Opening the wallet requires Face ID, a fingerprint, or a PIN. The effect
 *    itself is untouched - the cards still fan and the balance still fades in -
 *    but the reveal is gated on proving who you are, so an unlocked phone left
 *    on a table does not show someone's money.
 */""",
    "header",
)

swap(
    "import { Card, Row, Screen, Txt } from '@/components/ui';",
    "import { LockedAmount, useBalanceReveal } from '@/components/BalanceLock';\n"
    "import { Card, Row, Screen, Txt } from '@/components/ui';",
    "import",
)

swap(
    """  const wallet = useWallet();
  const [open, setOpen] = useState(true);
  const [solo, setSolo] = useState<string | null>(null);""",
    """  const wallet = useWallet();
  const lock = useBalanceReveal();
  const [solo, setSolo] = useState<string | null>(null);

  // The wallet is open exactly when the balance is unlocked: one source of
  // truth, so the cards and the figures can never disagree about what is shown.
  const open = lock.unlocked;""",
    "state",
)

swap(
    """          <Pressable
            onPress={() => {
              setOpen((value) => !value);
              setSolo(null);
            }}
            accessibilityRole="button"
            accessibilityLabel={open ? 'Hide balance' : 'Show balance'}""",
    """          <Pressable
            onPress={() => {
              setSolo(null);
              lock.reveal();
            }}
            accessibilityRole="button"
            accessibilityLabel={open ? 'Hide balance' : 'Unlock to show balance'}""",
    "pocket press",
)

swap(
    """              <View style={{ height: 34, justifyContent: 'center' }}>
                {open ? (
                  <Animated.Text
                    entering={FadeIn.duration(300)}
                    style={{ color: '#a7c59e', fontSize: 26, fontWeight: '700' }}
                  >
                    {money(wallet.data?.total)}
                  </Animated.Text>
                ) : (
                  <Text
                    style={{ color: '#839e7b', fontSize: 24, letterSpacing: 4 }}
                  >
                    ••••••
                  </Text>
                )}
              </View>""",
    """              <View style={{ height: 34, justifyContent: 'center' }}>
                <LockedAmount
                  value={money(wallet.data?.total)}
                  unlocked={open}
                  checking={lock.checking}
                  style={{ color: '#a7c59e', fontSize: 26, fontWeight: '700' }}
                  maskedStyle={{ color: '#839e7b', fontSize: 24, letterSpacing: 4 }}
                />
              </View>""",
    "pocket balance",
)

swap(
    "                {open ? '\U0001f441' : '\U0001f648'}",
    "                {open ? '\U0001f441' : '\U0001f512'}",
    "eye glyph",
)

swap(
    "          {open ? 'Tap the wallet to hide balance' : 'Tap to see balance'}",
    "          {open ? 'Tap the wallet to hide balance' : unlockHint}",
    "caption",
)

swap(
    """  const currency = wallet.data?.currency ?? 'INR';""",
    """  const currency = wallet.data?.currency ?? 'INR';
  const unlockHint = lock.capability?.biometricsAvailable
    ? 'Tap to unlock with biometrics'
    : 'Tap to unlock with your PIN';""",
    "hint",
)

swap(
    """            <PocketCardView
              key={card.key}
              card={card}
              open={open}
              solo={solo === card.key}""",
    """            <PocketCardView
              key={card.key}
              card={card}
              open={open}
              unlocked={lock.unlocked}
              solo={solo === card.key}""",
    "card props",
)

swap(
    """function PocketCardView({
  card,
  open,
  solo,
  zIndex,
  onSolo,
}: {
  card: PocketCard;
  open: boolean;
  solo: boolean;
  zIndex: number;
  onSolo: () => void;
}) {""",
    """function PocketCardView({
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
}) {""",
    "card signature",
)

swap(
    """            {solo ? (
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
            ) : (""",
    """            {solo && unlocked ? (
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
            ) : (""",
    "card amount",
)

swap(
    "        accessibilityLabel={`${card.label}: ${solo ? card.amount : 'hidden'}`}",
    "        accessibilityLabel={`${card.label}: ${\n"
    "          solo && unlocked ? card.amount : 'hidden'\n"
    "        }`}",
    "card a11y",
)

swap(
    """      <Card>
        <Txt variant="captionStrong" tone="secondary">
          Why three cards
        </Txt>""",
    """      <Card>
        <Txt variant="captionStrong" tone="secondary">
          Why your balance is hidden
        </Txt>
        <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
          Amounts stay masked until you unlock them, and they re-lock after a
          minute or as soon as you leave the app. This protects the screen, not
          the account - sign out if you are handing the phone to someone else.
        </Txt>
      </Card>

      <Card>
        <Txt variant="captionStrong" tone="secondary">
          Why three cards
        </Txt>""",
    "lock explainer",
)

swap(
    """          milestone is cancelled. Tap a card to see its amount.
        </Txt>
      </Card>
    </Screen>""",
    """          milestone is cancelled. Tap a card to see its amount.
        </Txt>
      </Card>

      {lock.sheet}
    </Screen>""",
    "sheet mount",
)

p.write_text(s, encoding="utf-8")
print("pocket wallet patched")
