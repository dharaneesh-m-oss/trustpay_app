/**
 * TrustPay design tokens.
 *
 * The palette is derived from the ten Uiverse components this app's UI is built
 * on. Those were authored independently, in clashing colour schemes, so rather
 * than dropping each one in with its own palette they are harmonised here:
 * every component keeps its *shape and motion*, and takes its colour from this
 * file.
 *
 * Where each accent comes from:
 *   indigo   — the Stripe card in the wallet-pocket component (#635bff)
 *   iosBlue  — the floating glass tab bar (rgba(0,122,255,·))
 *   mint     — the 3D project card gradient (#00ffd6 → #08e260)
 *   amber    — the loader orb (#ffbf48 → #be4a1d)
 *   orchid   — the assistant card gradient (#d58feb → #f27ef1)
 *
 * The app is light-only. The earlier monochrome dark identity was dropped at
 * the user's request; `schemes.dark` is retained as a near-identical light map
 * so that any `isDark` branch still renders correctly rather than falling
 * through to undefined colours.
 */

export const palette = {
  /** TrustPay indigo — the primary brand colour. */
  brand: {
    50: '#EEF0FF',
    100: '#E0E2FF',
    200: '#C6C8FF',
    300: '#A5A6FF',
    400: '#8B87FF',
    500: '#635BFF',
    600: '#4F46E5',
    700: '#3F35C4',
    800: '#2F2894',
    900: '#211C69',
  },
  /** The tab bar's iOS blue. */
  iosBlue: {
    50: '#E8F2FF',
    200: '#A8CDFF',
    400: '#3B92FF',
    500: '#007AFF',
    600: '#0062CC',
  },
  /** Project cards and success states. */
  mint: {
    50: '#E6FFF8',
    200: '#9BF5DC',
    300: '#5CE8C2',
    400: '#00FFD6',
    500: '#08E260',
    600: '#00A855',
    700: '#00894D',
  },
  /** The loader orb, and warnings. */
  amber: {
    50: '#FFF6E3',
    200: '#FFDFA0',
    300: '#FFBF48',
    500: '#E08A00',
    600: '#BE4A1D',
  },
  /** The assistant. */
  orchid: {
    50: '#FBEEFF',
    200: '#EFC9F7',
    300: '#D58FEB',
    500: '#F27EF1',
    600: '#B44BC7',
  },
  red: { 50: '#FDECEC', 300: '#F58B8B', 500: '#E10600', 600: '#B42318' },
  /**
   * The neutral ramp the interface is actually built from.
   *
   * It is deliberately warm and narrow at the light end: the page sits on 100,
   * cards are pure white on top of it, and the separation comes from a wide,
   * faint shadow rather than a border. That is the whole trick of this style -
   * contrast is carried by depth, not by lines.
   */
  neutral: {
    0: '#FFFFFF',
    25: '#FBFBFB',
    50: '#F5F5F5',
    100: '#EBEBEB',
    150: '#E4E4E4',
    200: '#DCDCDC',
    300: '#C2C2C2',
    400: '#9B9B9B',
    500: '#7C7C7C',
    600: '#5A5A5A',
    700: '#3D3D3D',
    800: '#242424',
    900: '#141414',
    1000: '#000000',
  },
} as const;

export type ColorScheme = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;

  border: string;
  borderStrong: string;

  brand: string;
  brandStrong: string;
  brandMuted: string;
  onBrand: string;

  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  info: string;
  infoMuted: string;

  /** "This money is protected." */
  protected: string;
  protectedMuted: string;

  /** AI surfaces — the assistant and analysis cards. */
  accent: string;
  accentMuted: string;

  overlay: string;
};

const light: ColorScheme = {
  background: palette.neutral[100],
  surface: palette.neutral[0],
  surfaceRaised: palette.neutral[0],
  surfaceMuted: palette.neutral[50],

  textPrimary: palette.neutral[900],
  textSecondary: palette.neutral[400],
  textTertiary: palette.neutral[300],
  textInverse: palette.neutral[0],

  border: '#EFEFEF',
  borderStrong: palette.neutral[200],

  // Primary actions are graphite rather than indigo. On a page this quiet a
  // saturated button is the loudest thing on screen, and the reference style
  // earns its weight from near-black on near-white instead.
  brand: palette.neutral[900],
  brandStrong: palette.neutral[1000],
  brandMuted: palette.neutral[50],
  onBrand: palette.neutral[0],

  success: palette.mint[600],
  successMuted: palette.mint[50],
  warning: palette.amber[500],
  warningMuted: palette.amber[50],
  danger: palette.red[500],
  dangerMuted: palette.red[50],
  info: palette.iosBlue[500],
  infoMuted: palette.iosBlue[50],

  protected: palette.brand[600],
  protectedMuted: palette.brand[50],

  accent: palette.orchid[600],
  accentMuted: palette.orchid[50],

  overlay: 'rgba(21, 23, 29, 0.45)',
};

export const schemes = { light, dark: light } as const;

/**
 * Gradients lifted from the source components, kept together so a screen can
 * reach for one by name instead of re-deriving the stops.
 */
export const gradients = {
  /** Login / primary call to action (sharp-stingray-58, recoloured). */
  primary: ['#635BFF', '#4F46E5', '#3F35C4'] as const,
  /** Project cards (smart-liger-5). */
  project: ['#00FFD6', '#08E260'] as const,
  /** The assistant (hot-liger-0). */
  assistant: ['#ACFAE9', '#D58FEB', '#F27EF1'] as const,
  /** The loader orb (young-walrus-64). */
  loader: ['#FFBF48', '#BE4A1D'] as const,
  /** The wallet balance header. */
  wallet: ['#4F46E5', '#635BFF', '#8B87FF'] as const,
  /** Trust score, high band. */
  trustHigh: ['#00FFD6', '#08E260'] as const,
  trustMid: ['#FFBF48', '#E08A00'] as const,
  trustLow: ['#F58B8B', '#E10600'] as const,
} as const;

/** 4pt grid. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 44,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 24,
  xxl: 30,
  /** The very round corners the source cards use (50px on a 300px card). */
  card: 34,
  full: 999,
} as const;

/**
 * Type.
 *
 * Headings lost a weight class across the board. At 800 on a pale grey page
 * everything shouts and nothing leads; at 600-700 the hierarchy comes back and
 * the page reads calm. `amount` is deliberately light and large - a big number
 * set in regular weight looks considered, the same number in extra-bold looks
 * like a price tag.
 */
export const typography = {
  display: { fontSize: 40, lineHeight: 46, fontWeight: '600' as const, letterSpacing: -1.2 },
  amount: { fontSize: 40, lineHeight: 48, fontWeight: '400' as const, letterSpacing: -1.4 },
  h1: { fontSize: 25, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.6 },
  h2: { fontSize: 19, lineHeight: 26, fontWeight: '600' as const, letterSpacing: -0.4 },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  captionStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  /** Small, spaced and lowercase - the reference's section labels. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600' as const,
    letterSpacing: 1.4,
    textTransform: 'lowercase' as const,
  },
  mono: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const, letterSpacing: 0.4 },
} as const;

/**
 * Elevation.
 *
 * The source components lean on coloured shadows (`box-shadow: … rgba(59,130,246,.5)`),
 * which reads as glow rather than depth. `glow()` reproduces that; `sm`/`md`
 * stay neutral for ordinary cards.
 */
export const elevation = {
  none: {},
  /** Barely there - enough to lift a chip off the page. */
  sm: {
    shadowColor: '#7A7A7A',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  /** The default card. Wide and faint, so the edge reads as light not line. */
  md: {
    shadowColor: '#6E6E6E',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  lg: {
    shadowColor: '#5F5F5F',
    shadowOpacity: 0.2,
    shadowRadius: 44,
    shadowOffset: { width: 0, height: 20 },
    elevation: 9,
  },
} as const;

/** Coloured shadow, as used throughout the source components. */
export function glow(color: string, opacity = 0.45, radius = 18) {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  };
}

export const motion = {
  fast: 160,
  base: 260,
  slow: 420,
  ceremony: 900,
} as const;

export const HIT_SIZE = 44;
