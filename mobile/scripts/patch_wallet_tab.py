"""Promote the pocket wallet to the Wallet tab, and lock the home balance.

The pocket wallet becomes the tab itself rather than a page hidden behind a
link — it is the wallet, so it should be what the Wallet tab shows.
"""

import pathlib


def swap(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"PATCH MISS: {label}")
    return text.replace(old, new)


# ── 1. Wallet tab: lead with the pocket, keep the statement below ──────────
p = pathlib.Path("app/(tabs)/wallet.tsx")
s = p.read_text(encoding="utf-8")

s = swap(
    s,
    "import {\n  SlideActionButton,\n  SlotTransactionRow,\n  WalletCardStack,\n  WalletHeaderCard,\n} from '@/components/uiverse';",
    "import { SlideActionButton, SlotTransactionRow } from '@/components/uiverse';\n"
    "import { PocketWallet } from '@/components/PocketWallet';",
    "wallet imports",
)

# Replace the header-card + stack block with the pocket wallet.
start = s.index("          {/* Balance header — weak-treefrog-3 */}")
end = s.index("          <Card>\n            <Txt variant=\"captionStrong\" tone=\"secondary\">\n              Why the three are separate")
s = (
    s[:start]
    + """          {/* The wallet itself — byllzz/rude-bat-50, gated on biometrics. */}
          <PocketWallet />

          <Row gap={spacing.sm}>
            <SlideActionButton
              label="Add money"
              glyph="＋"
              tone="brand"
              style={{ flex: 1 }}
              onPress={() => router.push('/wallet/add-money')}
            />
            <SlideActionButton
              label="Withdraw"
              glyph="↑"
              tone="dark"
              style={{ flex: 1 }}
              onPress={() => router.push('/wallet/withdraw')}
            />
          </Row>

"""
    + s[end:]
)

# The old expand/hide state belongs to the pocket now.
s = swap(
    s,
    "  const [hidden, setHidden] = useState(false);\n  const [expanded, setExpanded] = useState(false);",
    "",
    "wallet state",
)
s = s.replace("import React, { useState } from 'react';", "import React from 'react';")
p.write_text(s, encoding="utf-8")
print("wallet tab now leads with the pocket")


# ── 2. Home: the balance header respects the lock ─────────────────────────
p = pathlib.Path("src/components/rich.tsx")
s = p.read_text(encoding="utf-8")

s = swap(
    s,
    "import { Badge, BadgeTone, Card, Row, Txt } from '@/components/ui';",
    "import { LockedAmount } from '@/components/BalanceLock';\n"
    "import { Badge, BadgeTone, Card, Row, Txt } from '@/components/ui';",
    "rich imports",
)

s = swap(
    s,
    """  demoMode,
  trustScore,
  onPressTrust,
}: {
  available: string;
  protectedAmount: string;
  pending?: string;
  currency?: string;
  demoMode?: boolean;
  trustScore?: number;
  onPressTrust?: () => void;
}) {""",
    """  demoMode,
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
}) {""",
    "balance header props",
)

s = swap(
    s,
    """            <View style={{ marginTop: spacing.xs }}>
              <Amount
                value={available}
                currency={currency}
                size="display"
                tone="inverse"
              />
            </View>""",
    """            <View style={{ marginTop: spacing.xs }}>
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
            </View>""",
    "balance header amount",
)

# The protected/settling chips must respect the lock too.
s = swap(
    s,
    """        <Row gap={spacing.sm}>
          <PocketChip
            label="Protected"
            value={formatMoney(protectedAmount, currency)}
            glyph="🛡️"
          />
          <PocketChip
            label="Settling"
            value={formatMoney(pending ?? '0.00', currency)}
            glyph="◷"
          />
        </Row>""",
    """        <Row gap={spacing.sm}>
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
        </Row>""",
    "pocket chips",
)

# A hint so the mask does not look like a loading state.
s = swap(
    s,
    """        {demoMode ? (
          <Row gap={spacing.xs}>""",
    """        {!unlocked ? (
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
          <Row gap={spacing.xs}>""",
    "lock hint",
)
p.write_text(s, encoding="utf-8")
print("balance header respects the lock")


# ── 3. Home screen: drive the lock ───────────────────────────────────────
p = pathlib.Path("app/(tabs)/home.tsx")
s = p.read_text(encoding="utf-8")

s = swap(
    s,
    "import { LogoMark } from '@/components/Logo';",
    "import { useBalanceReveal } from '@/components/BalanceLock';\n"
    "import { LogoMark } from '@/components/Logo';",
    "home imports",
)

s = swap(
    s,
    "  const aiStatus = useAiStatus();",
    "  const aiStatus = useAiStatus();\n  const lock = useBalanceReveal();",
    "home lock",
)

s = swap(
    s,
    """          trustScore={trustScore.data?.score}
          onPressTrust={() => router.push('/trust-score')}
        />""",
    """          trustScore={trustScore.data?.score}
          onPressTrust={() => router.push('/trust-score')}
          unlocked={lock.unlocked}
          checking={lock.checking}
          onToggleBalance={lock.reveal}
        />""",
    "home balance props",
)

s = swap(
    s,
    """            {
              label: 'Protected',
              value: formatCompact(wallet.data.protected, wallet.data.currency),
              tone: 'primary',
            },""",
    """            {
              label: 'Protected',
              value: lock.unlocked
                ? formatCompact(wallet.data.protected, wallet.data.currency)
                : '••••',
              tone: 'primary',
            },""",
    "home stat strip",
)

s = swap(
    s,
    """      <Txt
        variant="caption"
        tone="tertiary"
        style={{ textAlign: 'center', marginTop: spacing.sm }}
      >
        TrustPay is not a bank. In demo mode all funds are simulated.
      </Txt>""",
    """      <Txt
        variant="caption"
        tone="tertiary"
        style={{ textAlign: 'center', marginTop: spacing.sm }}
      >
        TrustPay is not a bank. In demo mode all funds are simulated.
      </Txt>

      {lock.sheet}""",
    "home sheet",
)
p.write_text(s, encoding="utf-8")
print("home drives the lock")
