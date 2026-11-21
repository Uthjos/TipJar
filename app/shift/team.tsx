import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  Banner,
  Body,
  Button,
  Card,
  Input,
  Muted,
  Screen,
  Segmented,
  Title,
} from '@/components/ui';
import type { RoleId, TeamMember } from '@/engine/types';
import {
  checkTeamHours,
  clockHours,
  formatHours,
  type HoursIssue,
  parseHoursInput,
  parseTimeInput,
} from '@/lib/hoursInput';
import { roleNames } from '@/lib/profiles';
import {
  placeholderName,
  quickAddCoworkers,
  selectProfile,
  teamRolesFor,
  typedTeam,
  useShiftStore,
} from '@/store/shiftStore';
import { font, MIN_TAP, radius, spacing, useColors } from '@/theme';

function singular(role: RoleId) {
  return roleNames(selectProfile(useShiftStore.getState()), role).singular.toLowerCase();
}

const TIME_HINT = 'e.g. 5pm, 17:00, 1730';

function MemberRow({
  member,
  placeholder,
  issues,
  roleCount,
}: {
  member: TeamMember;
  placeholder: string;
  /** This member's hours issues (checkTeamHours). */
  issues: HoursIssue[];
  /** How many people are in this member's role. */
  roleCount: number;
}) {
  const c = useColors();
  const { updateMember, removeMember, setTyped, copyHoursToRole } = useShiftStore.getState();
  const typed = useShiftStore((s) => s.draft.typed[member.id]);
  const who = member.name.trim() || placeholder;

  const hoursText = typed?.hoursText ?? (member.hours !== undefined ? String(member.hours) : '');
  const clockInText = typed?.clockInText ?? member.clockIn ?? '';
  const clockOutText = typed?.clockOutText ?? member.clockOut ?? '';
  const hasEntry =
    hoursText.trim() !== '' || clockInText.trim() !== '' || clockOutText.trim() !== '';
  const mode =
    typed?.mode ??
    (member.clockIn !== undefined || member.clockOut !== undefined ? 'clock' : 'hours');

  const [userOpen, setUserOpen] = useState(false);
  // Opens by itself when the member has hours or a problem to fix.
  const open = userOpen || hasEntry || issues.length > 0;
  const hasError = issues.some((i) => i.severity === 'error');
  const span =
    mode === 'clock' && member.clockIn && member.clockOut
      ? clockHours(member.clockIn, member.clockOut)
      : null;
  const canCopy = hasEntry && !hasError && roleCount >= 2;

  const clearAll = () =>
    updateMember(member.id, { hours: undefined, clockIn: undefined, clockOut: undefined });

  const switchMode = (m: 'hours' | 'clock') => {
    // Only one source of hours at a time.
    setTyped(member.id, { mode: m, hoursText: '', clockInText: '', clockOutText: '' });
    clearAll();
    setUserOpen(true);
  };

  const clearHours = () => {
    setTyped(member.id, { mode: undefined, hoursText: '', clockInText: '', clockOutText: '' });
    clearAll();
    setUserOpen(false);
  };

  const onClock = (field: 'clockIn' | 'clockOut', text: string) => {
    setTyped(member.id, field === 'clockIn' ? { clockInText: text } : { clockOutText: text });
    // Commit only a normalised "HH:mm" (never ISO); anything unreadable stays uncommitted.
    updateMember(member.id, { [field]: parseTimeInput(text) ?? undefined });
  };
  /**
   * On blur, rewrite the field's text to its normalised form. Reads the latest typed text and the
   * committed value from the store (not this render's closure, which can be a keystroke behind),
   * and only rewrites when the normalised text equals the committed value, so normalising can
   * never make the field and the money disagree.
   */
  const normaliseClock = (field: 'clockIn' | 'clockOut') => {
    const { draft } = useShiftStore.getState();
    const typedNow = draft.typed[member.id];
    const committed = draft.team.find((m) => m.id === member.id)?.[field];
    const text = field === 'clockIn' ? typedNow?.clockInText : typedNow?.clockOutText;
    if (text === undefined) return;
    const t = parseTimeInput(text);
    if (t && t === committed) {
      setTyped(member.id, field === 'clockIn' ? { clockInText: t } : { clockOutText: t });
    }
  };
  const normaliseHours = () => {
    const { draft } = useShiftStore.getState();
    const text = draft.typed[member.id]?.hoursText;
    const committed = draft.team.find((m) => m.id === member.id)?.hours;
    if (text === undefined) return;
    const h = parseHoursInput(text);
    if (h !== null && h === committed) setTyped(member.id, { hoursText: String(h) });
  };

  return (
    <View style={[styles.member, { borderColor: hasError ? c.danger : c.border }]}>
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
          accessibilityLabel={`Remove ${who}`}
          onPress={() => removeMember(member.id)}
          style={[styles.iconBtn, { backgroundColor: c.surfaceAlt }]}
        >
          <Text style={{ color: c.danger, fontSize: 20, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>

      {!open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add hours for ${who}`}
          onPress={() => setUserOpen(true)}
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
              accessibilityLabel={`Hours worked by ${who}`}
              value={hoursText}
              onChangeText={(t) => {
                setTyped(member.id, { hoursText: t });
                updateMember(member.id, { hours: parseHoursInput(t) ?? undefined });
              }}
              onEndEditing={normaliseHours}
              placeholder="e.g. 6.5 or 6:30"
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          ) : (
            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Input
                  accessibilityLabel={`Clock in time for ${who}`}
                  value={clockInText}
                  onChangeText={(t) => onClock('clockIn', t)}
                  onEndEditing={() => normaliseClock('clockIn')}
                  placeholder="In 5pm"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  style={{ flex: 1 }}
                />
                <Input
                  accessibilityLabel={`Clock out time for ${who}`}
                  value={clockOutText}
                  onChangeText={(t) => onClock('clockOut', t)}
                  onEndEditing={() => normaliseClock('clockOut')}
                  placeholder="Out 1:30am"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  style={{ flex: 1 }}
                />
              </View>
              {span ? (
                <Body style={{ fontWeight: '600' }}>
                  = {formatHours(span.hours)}
                  {span.overnight ? ' · ends next day' : ''}
                </Body>
              ) : (
                <Muted>{TIME_HINT}</Muted>
              )}
            </View>
          )}
          {issues.map((i) => (
            <Text
              key={`${i.code}-${i.message}`}
              accessibilityRole="alert"
              style={{ color: i.severity === 'error' ? c.danger : c.warning, fontSize: font.small }}
            >
              {i.message}
            </Text>
          ))}
          <View style={styles.links}>
            {canCopy ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Same hours for everyone in this role as ${who}`}
                onPress={() => copyHoursToRole(member.id)}
                style={styles.linkBtn}
              >
                <Text style={{ color: c.primary, fontSize: font.label, fontWeight: '600' }}>
                  Same for everyone in this role
                </Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={clearHours} style={styles.linkBtn}>
              <Text style={{ color: c.textMuted, fontSize: font.label }}>
                Clear hours (split evenly)
              </Text>
            </Pressable>
          </View>
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

  // Check what was typed (with placeholder names so messages read well), before Results.
  const issues = checkTeamHours(
    typedTeam(draft).map((m) => ({
      ...m,
      name: m.name.trim() || placeholderName(draft.team, m, profile),
    })),
    roles,
  );
  const errorCount = issues.filter((i) => i.severity === 'error').length;

  return (
    <Screen
      footer={
        <>
          {errorCount > 0 ? (
            <Banner kind="error">
              {errorCount === 1
                ? 'Fix 1 hours problem above to see the tip-out.'
                : `Fix ${errorCount} hours problems above to see the tip-out.`}
            </Banner>
          ) : null}
          <Button
            label="See tip-out"
            onPress={() => router.push('/shift/results')}
            disabled={errorCount > 0}
          />
        </>
      }
    >
      <Muted>
        Add everyone who worked. Leave hours blank to split evenly, or enter total hours or clock in
        / out times like 5pm or 17:00 (overnight shifts are fine).
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
                  {roleNames(profile, cw.usualRole).singular}
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
              <Title>
                {isBarShare ? 'Bartenders (incl. you)' : roleNames(profile, role).plural}
              </Title>
              {isBarShare ? <Muted>Share what the bar keeps after tip-out.</Muted> : null}
            </View>
            {members.length === 0 ? (
              <Body style={{ fontStyle: 'italic' }}>Nobody yet</Body>
            ) : (
              members.map((m, i) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  placeholder={`${roleNames(profile, role).singular} ${i + 1}`}
                  issues={issues.filter((x) => x.memberId === m.id)}
                  roleCount={members.length}
                />
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
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg },
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
