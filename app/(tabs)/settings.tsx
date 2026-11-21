import { format } from 'date-fns';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { confirmAction, showError } from '@/components/confirm';
import {
  Body,
  Button,
  Card,
  ChipRow,
  Input,
  Muted,
  Screen,
  Segmented,
  Title,
  ToggleRow,
} from '@/components/ui';
import type { Coworker } from '@/db/repositories';
import type { RoleId, TipOutProfile } from '@/engine/types';
import { shareCsv } from '@/export/shareCsv';
import { payoutsCsv, shiftsCsv } from '@/lib/csv';
import { profileSummary, roleLabelFrom, roleNames } from '@/lib/profiles';
import { useShiftStore } from '@/store/shiftStore';
import { font, MIN_TAP, radius, spacing, useColors } from '@/theme';

function ProfileRow({ profile, isDefault }: { profile: TipOutProfile; isDefault: boolean }) {
  const c = useColors();
  const forWhom = profile.appliesTo === 'bartender' ? 'For bartenders' : 'For servers';
  return (
    <View style={[styles.row, { borderColor: c.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${profile.name}`}
        accessibilityHint={profileSummary(profile)}
        onPress={() => router.push(`/profile/${profile.id}`)}
        style={({ pressed }) => [{ minHeight: MIN_TAP, opacity: pressed ? 0.7 : 1 }]}
      >
        <Body style={{ fontWeight: '700' }}>
          {profile.name}
          {isDefault ? <Muted> · default</Muted> : null}
        </Body>
        <Muted>{forWhom}</Muted>
        <Muted>{profileSummary(profile)}</Muted>
      </Pressable>
      <Button
        compact
        variant="ghost"
        label="Duplicate"
        accessibilityHint={`Makes a copy of ${profile.name}`}
        onPress={() => router.push(`/profile/new?from=${encodeURIComponent(profile.id)}`)}
      />
    </View>
  );
}

function CoworkerRow({ coworker, roles }: { coworker: Coworker; roles: RoleId[] }) {
  const c = useColors();
  const [name, setName] = useState(coworker.name);
  const { renameCoworker, setCoworkerRole, deleteCoworker } = useShiftStore.getState();
  const profile = useShiftStore((s) =>
    s.profiles.find((p) => p.rules.some((r) => r.role === coworker.usualRole)),
  );
  const roleOptions = (
    roles.includes(coworker.usualRole) ? roles : [...roles, coworker.usualRole]
  ).map((r) => ({ value: r, label: roleNames(profile, r).singular }));

  const commitName = async () => {
    if (name.trim() === coworker.name) return;
    try {
      await renameCoworker(coworker.id, name);
    } catch (e) {
      setName(coworker.name);
      showError('Could not rename', e);
    }
  };

  return (
    <View style={[styles.row, { borderColor: c.border }]}>
      <View style={styles.rowTop}>
        <Input
          accessibilityLabel={`Name of ${coworker.name}`}
          value={name}
          onChangeText={setName}
          onEndEditing={commitName}
          onSubmitEditing={commitName}
          returnKeyType="done"
          autoCapitalize="words"
          style={{ flex: 1 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${coworker.name}`}
          onPress={() =>
            confirmAction(
              `Delete ${coworker.name}?`,
              'They will no longer show up in quick add. Saved shifts are not changed.',
              'Delete',
              () => {
                deleteCoworker(coworker.id).catch((e: unknown) => showError('Could not delete', e));
              },
            )
          }
          style={[styles.iconBtn, { backgroundColor: c.surfaceAlt }]}
        >
          <Text style={{ color: c.danger, fontSize: 20, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
      <ChipRow
        accessibilityLabel={`Usual role for ${coworker.name}`}
        value={coworker.usualRole}
        onChange={(role) =>
          setCoworkerRole(coworker.id, role).catch((e: unknown) =>
            showError('Could not change role', e),
          )
        }
        options={roleOptions}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const profiles = useShiftStore((s) => s.profiles);
  const settings = useShiftStore((s) => s.settings);
  const coworkers = useShiftStore((s) => s.coworkers);
  const savedShifts = useShiftStore((s) => s.savedShifts);
  const { setDefaultRoundToDollar, setDefaultProfile, setWholeDollarShares, setWeekStartsOn } =
    useShiftStore.getState();
  const [exporting, setExporting] = useState<'shifts' | 'payouts' | null>(null);

  const exportCsv = async (kind: 'shifts' | 'payouts') => {
    setExporting(kind);
    try {
      const stamp = format(new Date(), 'yyyy-MM-dd');
      const csv =
        kind === 'shifts'
          ? shiftsCsv(savedShifts, {
              profileName: (id) => profiles.find((p) => p.id === id)?.name,
            })
          : payoutsCsv(savedShifts, { roleLabel: roleLabelFrom(profiles) });
      await shareCsv(`tipjar-${kind}-${stamp}.csv`, csv);
    } catch (e) {
      showError('Could not export', e);
    } finally {
      setExporting(null);
    }
  };

  // Every role any profile tips out (custom ones included), for coworkers' usual role.
  const roles: RoleId[] = ['bartender'];
  for (const p of profiles) {
    for (const r of p.rules)
      if (r.role && r.role !== 'kitchen' && !roles.includes(r.role)) roles.push(r.role);
  }

  return (
    <Screen>
      <Card>
        <Title>Tip-out profiles</Title>
        <Muted>Tap a profile to change its percentages and roles.</Muted>
        {profiles.map((p) => (
          <ProfileRow key={p.id} profile={p} isDefault={p.id === settings.defaultProfileId} />
        ))}
        <View style={styles.buttons}>
          <Button
            variant="secondary"
            label="+ New server profile"
            onPress={() => router.push('/profile/new?appliesTo=server')}
            style={{ flex: 1 }}
          />
          <Button
            variant="secondary"
            label="+ New bartender profile"
            onPress={() => router.push('/profile/new?appliesTo=bartender')}
            style={{ flex: 1 }}
          />
        </View>
      </Card>

      <Card>
        <Title>Defaults</Title>
        <ToggleRow
          label="Round to nearest dollar"
          hint="Rounds down — tip-out never exceeds your tips"
          value={settings.defaultRoundToDollar}
          onValueChange={setDefaultRoundToDollar}
        />
        <ToggleRow
          label="Whole-dollar shares for each person"
          hint={
            settings.defaultRoundToDollar
              ? 'Split each role and the bar in whole dollars; leftover cents stay with you / the bar'
              : 'Only applies when rounding to the nearest dollar is on'
          }
          value={settings.wholeDollarShares}
          onValueChange={setWholeDollarShares}
          disabled={!settings.defaultRoundToDollar}
        />
        <Body style={{ fontWeight: '600' }}>Default profile</Body>
        <ChipRow
          accessibilityLabel="Default profile"
          value={settings.defaultProfileId}
          onChange={setDefaultProfile}
          options={profiles.map((p) => ({
            value: p.id,
            label: p.name,
            hint: p.appliesTo === 'bartender' ? 'Bartender' : 'Server',
          }))}
        />
        <Body style={{ fontWeight: '600' }}>Week starts on</Body>
        <Segmented
          accessibilityLabel="Week starts on"
          value={settings.weekStartsOn === 1 ? 'monday' : 'sunday'}
          onChange={(v) => setWeekStartsOn(v === 'monday' ? 1 : 0)}
          options={[
            { value: 'sunday', label: 'Sunday' },
            { value: 'monday', label: 'Monday' },
          ]}
        />
      </Card>

      <Card>
        <Title>Export data (CSV)</Title>
        <Muted>
          Makes a spreadsheet file and opens the share sheet. Nothing leaves your phone unless you
          send it somewhere.
        </Muted>
        <View style={styles.buttons}>
          <Button
            variant="secondary"
            label={exporting === 'shifts' ? 'Exporting…' : 'Shifts'}
            accessibilityHint="Exports one row per saved shift"
            onPress={() => exportCsv('shifts')}
            disabled={exporting !== null || savedShifts.length === 0}
            style={{ flex: 1 }}
          />
          <Button
            variant="secondary"
            label={exporting === 'payouts' ? 'Exporting…' : 'Payouts'}
            accessibilityHint="Exports one row per person or role paid"
            onPress={() => exportCsv('payouts')}
            disabled={exporting !== null || savedShifts.length === 0}
            style={{ flex: 1 }}
          />
        </View>
        {savedShifts.length === 0 ? <Muted>Save a shift first.</Muted> : null}
      </Card>

      <Card>
        <Title>Saved coworkers</Title>
        {coworkers.length === 0 ? (
          <Muted>
            People you add on &quot;Who worked&quot; are remembered here after you save a shift.
          </Muted>
        ) : (
          coworkers.map((cw) => <CoworkerRow key={cw.id} coworker={cw} roles={roles} />)
        )}
      </Card>
      <Muted style={{ textAlign: 'center', fontSize: font.small }}>
        Everything stays on this device.
      </Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
    width: MIN_TAP,
    height: MIN_TAP,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
