import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { palette } from '@/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const c = dark ? palette.dark : palette.light;
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: c.primary,
      background: c.background,
      card: c.surface,
      text: c.text,
      border: c.border,
    },
  };

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="shift/team" options={{ title: 'Who worked' }} />
        <Stack.Screen name="shift/results" options={{ title: 'Results' }} />
      </Stack>
    </ThemeProvider>
  );
}
