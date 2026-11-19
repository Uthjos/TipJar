import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card, Input, Muted, Screen, Segmented, Title } from '@/components/ui';
import { roleLabel, roleSingular } from '@/engine/profiles';
import type { RoleId, TeamMember } from '@/engine/types';
import { quickAddCoworkers, selectProfile, teamRolesFor, useShiftStore } from '@/store/shiftStore';
import { font, MIN_TAP, radius, spacing, useColors } from '@/theme';

function singular(role: RoleId) {
  return roleSingular(role).toLowerCase();
}

type HoursMode = 'hours' | 'clock';

function MemberRow({ member, placeholder }: { member: TeamMember; placeholder: string }) {
  const c = useColors();
  const { updateMember, removeMember } = useShiftStore.getState();
  const hasHours =
    member.hours !== undefined || member.clockIn !== undefined || member.clockOut !== undefined;
  const [open, setOpen] = useState(hasHours);
  const [mode, setMode] = useState<HoursMode>(
    member.clockIn || member.clockOut ? 'clock' : 'hours',
  );
  const [hoursText, setHoursText] = useState(
    member.hours !== undefined ? String(member.hours) : '',
  );

  const switchMode = (m: HoursMode) => {
    setMode(m);
    // Only one source of hours at a time.
    setHoursText('');
    updateMember(member.id, { hours: undefined, clockIn: undefined, clockOut: undefined });
  };

  const clearHours = () => {
    setHoursText('');
    updateMember(member.id, { hours: undefined, clockIn: undefined, clockOut: undefined });
    setOpen(false);
  };

  return (
    <View style={[styles.member, { borderColor: c.border }]}>
      <View style={styles.memberTop}>
        <Input
          accessibilityLabel={`${singular(member.role)} name`}
          value={member.name}
          onChangeText={(name) => updateMember(member.id, { name })}
          placeholder={placeholder}
          autoCapitalize="words"
          returnKeyType="done"
          style={{ flex: 1 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${member.name || placeholder}`}
          onPress={() => removeMember(member.id)}
          style={[styles.iconBtn, { backgroundColor: c.surfaceAlt }]}
        >
          <Text style={{ color: c.danger, fontSize: 20, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>

      {!open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add hours for ${member.name || placeholder}`}
          onPress={() => setOpen(true)}
          style={styles.linkBtn}
        >
          <Text style={{ color: c.primary, fontSize: font.label, fontWeight: '600' }}>
            + Hours (optional)
          </Text>
        </Pressable>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Segmented
            accessibilityLabel="How to enter hours"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'hours', label: 'Total hours' },
              { value: 'clock', label: 'Clock in / out' },
            ]}
          />
          {mode === 'hours' ? (
            <Input
              accessibilityLabel={`Hours worked by ${member.name || placeholder}`}
              value={hoursText}
              onChangeText={(t) => {
                setHoursText(t);
                const n = Number(t.replace(',', '.'));
                updateMember(member.id, {
                  hours: t.trim() === '' || !Number.isFinite(n) ? undefined : n,
                });
              }}
              placeholder="e.g. 6.5"
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Input
                accessibilityLabel={`Clock in time for ${member.name || placeholder}`}
                value={member.clockIn ?? ''}
                onChangeText={(t) => updateMember(member.id, { clockIn: t.trim() || undefined })}
                placeholder="In 17:00"
                keyboardType="numbers-and-punctuation"
                style={{ flex: 1 }}
              />
              <Input
                accessibilityLabel={`Clock out time for ${member.name || placeholder}`}
                value={member.clockOut ?? ''}
                onChangeText={(t) => updateMember(member.id, { clockOut: t.trim() || undefined })}
                placeholder="Out 01:30"
                keyboardType="numbers-and-punctuation"
                style={{ flex: 1 }}
              />
            </View>
          )}
          <Pressable accessibilityRole="button" onPress={clearHours} style={styles.linkBtn}>
            <Text style={{ color: c.textMuted, fontSize: font.label }}>
              Clear hours (split evenly)
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function TeamScreen() {
  const draft = useShiftStore((s) => s.draft);
  const profile = useShiftStore(selectProfile);
  const { addMember } = useShiftStore.getState();
  const roles = teamRolesFor(profile);
  const coworkers = useShiftStore((s) => s.coworkers);
  const quickAdd = quickAddCoworkers(coworkers, draft.team, roles);
  const c = useColors();

  return (
    <Screen footer={<Button label="See tip-out" onPress={() => router.push('/shift/results')} />}>
      <Muted>
        Add everyone who worked. Leave hours blank to split evenly — use 24h times like 17:00 for
        clock in/out (overnight shifts are fine).
      </Muted>
      {quickAdd.length > 0 ? (
        <Card>
          <Title>Quick add</Title>
          <View style={styles.chips}>
            {quickAdd.map((cw) => (
              <Pressable
                key={cw.id}
                accessibilityRole="button"
                accessibilityLabel={`Add ${cw.name} as ${singular(cw.usualRole)}`}
                onPress={() => addMember(cw.usualRole, cw.name)}
                style={({ pressed }) => [
                  styles.chip,
                  { backgroundColor: c.surfaceAlt, borderColor: c.border },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={{ color: c.text, fontSize: font.label, fontWeight: '600' }}>
                  + {cw.name}
                </Text>
                <Text style={{ color: c.textMuted, fontSize: font.small }}>
                  {roleSingular(cw.usualRole)}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
      {roles.map((role) => {
        const members = draft.team.filter((m) => m.role === role);
        const isBarShare = profile.appliesTo === 'bartender' && role === 'bartender';
        return (
          <Card key={role}>
            <View>
              <Title>{isBarShare ? 'Bartenders (incl. you)' : roleLabel(role)}</Title>
              {isBarShare ? <Muted>Share what the bar keeps after tip-out.</Muted> : null}
            </View>
            {members.length === 0 ? (
              <Body style={{ fontStyle: 'italic' }}>Nobody yet</Body>
            ) : (
              members.map((m, i) => (
                <MemberRow key={m.id} member={m} placeholder={`${roleSingular(role)} ${i + 1}`} />
              ))
            )}
            <Button
              variant="secondary"
              label={`+ Add ${singular(role)}`}
              onPress={() => addMember(role)}
            />
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  member: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  memberTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  iconBtn: {
    width: MIN_TAP,
    height: MIN_TAP,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
  },
});
