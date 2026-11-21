import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { type ColorValue, Text } from 'react-native';

import { needsOnboarding, useShiftStore } from '@/store/shiftStore';
import { useColors } from '@/theme';

function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return (
    <Text style={{ color, fontSize: 20, fontWeight: '700' }} accessibilityElementsHidden>
      {glyph}
    </Text>
  );
}

export default function TabsLayout() {
  const c = useColors();
  // First launch: onboarding comes before the tabs (m5 contract).
  const onboard = useShiftStore(needsOnboarding);
  if (onboard) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        tabBarLabelStyle: { fontSize: 13 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'New shift',
          tabBarIcon: ({ color }) => <TabGlyph glyph="$" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => <TabGlyph glyph="≡" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabGlyph glyph="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}
