import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Body, Button, Card, Muted, Screen, Title } from '@/components/ui';
import type { UserRole } from '@/engine/types';
import { basisLabel } from '@/lib/format';
import { displayRole, profileSummary } from '@/lib/profiles';
import { useShiftStore } from '@/store/shiftStore';
import { spacing } from '@/theme';

/**
 * First launch only (m5 contract): pick Server / Bartender, review that role's built-in profile,
 * optionally edit it, done. Shown when `onboarded` isn't set and there are no saved shifts.
 */
export default function OnboardingScreen() {
  const [role, setRole] = useState<UserRole | null>(null);
  const profileId = role === 'bartender' ? 'bartender-default' : 'server-default';
  const profile = useShiftStore((s) => s.profiles.find((p) => p.id === profileId));
  const { chooseOnboardingRole, finishOnboarding } = useShiftStore.getState();

  const pick = (r: UserRole) => {
    chooseOnboardingRole(r);
    setRole(r);
  };

  const done = () => {
    finishOnboarding();
    router.replace('/');
  };

  if (!role) {
    return (
      <Screen>
        <Card>
          <Title>Welcome to TipJar</Title>
          <Body>
            Enter your tips at the end of a shift and TipJar works out everyone&apos;s tip-out.
          </Body>
        </Card>
        <Card>
          <Title>What do you usually work?</Title>
          <Button label="Server" onPress={() => pick('server')} />
          <Button label="Bartender" onPress={() => pick('bartender')} />
          <Muted>You can switch any time on the New shift screen.</Muted>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button label="Looks good" onPress={done} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              variant="secondary"
              label="Edit"
              onPress={() => router.push(`/profile/${profileId}`)}
              style={{ flex: 1 }}
            />
            <Button
              variant="ghost"
              label="Back"
              onPress={() => setRole(null)}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      }
    >
      <Card>
        <Title>Your tip-out</Title>
        {profile ? (
          <>
            <Muted>{profileSummary(profile)}</Muted>
            <Body>
              {profile.totalTipOutPercentOfTips}% of {basisLabel(profile.poolBasis)} goes to the
              tip-out pool.
            </Body>
            {profile.rules.map((r) => (
              <Body key={r.role}>
                • {displayRole(r)}:{' '}
                {r.type === 'percentOfBasis'
                  ? `${r.percent}% of ${basisLabel(r.basis)}, taken first`
                  : `${r.weight} part${r.weight === 1 ? '' : 's'} of what's left`}
              </Body>
            ))}
            {role === 'bartender' ? (
              <Muted>What the bar keeps is split among the bartenders on shift, by hours.</Muted>
            ) : null}
          </>
        ) : (
          <Muted>Profile not found — you can set one up in Settings.</Muted>
        )}
      </Card>
      <Muted>These match most restaurants. Tap Edit to change the numbers or roles.</Muted>
    </Screen>
  );
}
