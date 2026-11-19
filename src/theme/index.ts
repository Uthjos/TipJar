import { useColorScheme } from 'react-native';

export const palette = {
  light: {
    background: '#F6F7F9',
    surface: '#FFFFFF',
    surfaceAlt: '#EEF0F3',
    border: '#D5D9E0',
    text: '#11181C',
    textMuted: '#5B6470',
    primary: '#1F7A4D',
    primaryText: '#FFFFFF',
    accent: '#E8F5EE',
    danger: '#B42318',
    dangerBg: '#FDECEA',
    warning: '#8A5A00',
    warningBg: '#FFF4D6',
  },
  dark: {
    background: '#0E1113',
    surface: '#181C1F',
    surfaceAlt: '#22272B',
    border: '#343B41',
    text: '#ECEDEE',
    textMuted: '#A3ACB5',
    primary: '#3DBB7C',
    primaryText: '#05140C',
    accent: '#14301F',
    danger: '#FF8A80',
    dangerBg: '#3A1714',
    warning: '#FFD27A',
    warningBg: '#3A2E10',
  },
} as const;

export type Colors = { [K in keyof typeof palette.light]: string };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16 } as const;

/** Minimum touch target (pt) — big targets for one-handed use at the end of a shift. */
export const MIN_TAP = 52;

export const font = {
  body: 17,
  label: 15,
  small: 13,
  title: 22,
  headline: 34,
} as const;

export function useColors(): Colors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? palette.dark : palette.light;
}
