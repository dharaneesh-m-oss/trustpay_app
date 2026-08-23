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
  neutral: {
    0: '#FFFFFF',
    25: '#FCFCFE',
    50: '#F4F5F9',
    100: '#EDEEF3',
    200: '#DFDFDF',
    300: '#C6C9D4',
    400: '#8E8E8E',
    500: '#6F7585',
    600: '#4E5361',
    700: '#363A45',
    800: '#22252E',
    900: '#15171D',
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
  background: palette.neutral[50],
  surface: palette.neutral[0],
  surfaceRaised: palette.neutral[0],
  surfaceMuted: '#F0F0F0',

  textPrimary: palette.neutral[900],
  textSecondary: palette.neutral[400],
  textTertiary: palette.neutral[300],
  textInverse: palette.neutral[0],

  border: palette.neutral[200],
  borderStrong: palette.neutral[300],

  brand: palette.brand[500],
  brandStrong: palette.brand[700],
  brandMuted: palette.brand[50],
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  /** The very round corners the source cards use (50px on a 300px card). */
  card: 32,
  full: 999,
} as const;

export const typography = {
  display: { fontSize: 38, lineHeight: 44, fontWeight: '800' as const, letterSpacing: -1 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  captionStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  mono: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
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
  sm: {
    shadowColor: '#15171D',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#15171D',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  lg: {
    shadowColor: '#15171D',
    shadowOpacity: 0.14,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
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
