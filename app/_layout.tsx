import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Button } from '@/components/ui';
import { getDb } from '@/db/client';
import { useShiftStore } from '@/store/shiftStore';
import { font, palette, spacing } from '@/theme';

function loadFromDevice() {
  const { hydrate, setLoadError } = useShiftStore.getState();
  useShiftStore.setState({ status: 'loading' });
  getDb()
    .then(hydrate)
    .catch((e: unknown) =>
      setLoadError(e instanceof Error ? e.message : 'Could not open saved data.'),
    );
}

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
  const status = useShiftStore((s) => s.status);
  const loadError = useShiftStore((s) => s.loadError);

  useEffect(() => {
    loadFromDevice();
  }, []);

  if (status !== 'ready') {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        {status === 'loading' ? (
          <>
            <ActivityIndicator size="large" color={c.primary} />
            <Text style={{ color: c.textMuted, fontSize: font.body }}>Loading your shifts…</Text>
          </>
        ) : (
          <>
            <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: font.body }}>
              {loadError ?? 'Could not open saved data.'}
            </Text>
            <Button label="Try again" onPress={loadFromDevice} />
          </>
        )}
      </View>
    );
  }

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="shift/team" options={{ title: 'Who worked' }} />
        <Stack.Screen name="shift/results" options={{ title: 'Results' }} />
        <Stack.Screen name="profile/[id]" options={{ title: 'Profile' }} />
        <Stack.Screen name="history/[id]" options={{ title: 'Shift' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan receipt' }} />
        <Stack.Screen name="onboarding" options={{ title: 'Welcome', gestureEnabled: false }} />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
});
