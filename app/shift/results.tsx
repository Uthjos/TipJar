import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Card, Muted, Screen, Segmented, Title } from '@/components/ui';
import { calculateShift, EngineValidationError } from '@/engine/calculate';
import { formatCents } from '@/engine/money';
import { roleLabel } from '@/engine/profiles';
import type { MissingRoleHandling, RoleResult, ShiftInput } from '@/engine/types';
import {
  buildShareText,
  changeNote,
  formatPercent,
  formatShiftDate,
  hasChangeNote,
  heldBackNote,
  keptShown as keptShownFor,
  roundingParts,
} from '@/lib/format';
import { userEarnings, userKeptEntry } from '@/lib/earnings';
import { buildShiftInput, selectProfile, useShiftStore } from '@/store/shiftStore';
import { font, MIN_TAP, spacing, useColors } from '@/theme';

function RoleRow({
  role,
  totalTips,
  userRole,
  handling,
  onHandlingChange,
}: {
  role: RoleResult;
  totalTips: number;
  userRole: ShiftInput['userRole'];
  handling: MissingRoleHandling;
  onHandlingChange: (h: MissingRoleHandling) => void;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const expandable = role.members.length > 0;
  const label = roleLabel(role.role);

  if (role.missing) {
    return (
      <View style={[styles.roleRow, { borderColor: c.border }]}>
        <View style={styles.roleHeader}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '600' }}>{label}</Body>
            <Muted>Nobody on shift</Muted>
          </View>
          <Body style={{ fontWeight: '600', color: c.textMuted }}>
            {handling === 'retain' ? `${formatCents(role.amount)} kept` : 'Shared out'}
          </Body>
        </View>
        <Segmented
          accessibilityLabel={`What to do with the ${label} share`}
          value={handling}
          onChange={onHandlingChange}
          options={[
            {
              value: 'retain',
              label: userRole === 'bartender' ? 'Keep for bartenders' : 'Keep for me',
            },
            { value: 'redistribute', label: 'Give to other roles' },
          ]}
        />
      </View>
    );
  }

  return (
    <View style={[styles.roleRow, { borderColor: c.border }]}>
      <Pressable
        accessibilityRole={expandable ? 'button' : undefined}
        accessibilityState={expandable ? { expanded: open } : undefined}
        accessibilityLabel={`${label} ${formatCents(role.amount)}, ${formatPercent(role.percentOfTips)} of tips`}
        disabled={!expandable}
        onPress={() => setOpen((o) => !o)}
        style={styles.roleHeader}
      >
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: '600' }}>
            {expandable ? (open ? '▾ ' : '▸ ') : ''}
            {label}
          </Body>
          <Muted>
            {formatPercent(role.percentOfTips)} of tips · {formatPercent(role.percentOfNetSales, 2)}{' '}
            of sales
          </Muted>
          {role.heldBack ? <Muted>{heldBackNote(role.heldBack)}</Muted> : null}
        </View>
        <Text style={[styles.amount, { color: c.text }]}>{formatCents(role.amount)}</Text>
      </Pressable>
      {open
        ? role.members.map((m) => (
            <View key={m.memberId} style={styles.memberRow}>
              <Body style={{ flex: 1 }}>
                {m.name}
                {m.hours > 0 ? (
                  <Muted> · {m.hours.toFixed(2).replace(/\.?0+$/, '')} h</Muted>
                ) : null}
              </Body>
              <Muted style={{ marginRight: spacing.md }}>
                {formatPercent(totalTips > 0 ? m.percentOfTips : 0)}
              </Muted>
              <Body style={{ fontWeight: '600' }}>{formatCents(m.amount)}</Body>
            </View>
          ))
        : null}
    </View>
  );
}

export default function ResultsScreen() {
  const c = useColors();
  const draft = useShiftStore((s) => s.draft);
  const profile = useShiftStore(selectProfile);
  const { setMissingRoleHandling, saveShift, resetDraft } = useShiftStore.getState();
  const [saving, setSaving] = useState(false);

  const computed = useMemo(() => {
    const input = buildShiftInput(draft, profile);
    try {
      const { result, warnings } = calculateShift(input, profile);
      return { ok: true as const, input, result, warnings };
    } catch (e) {
      if (e instanceof EngineValidationError) return { ok: false as const, message: e.message };
      throw e;
    }
  }, [draft, profile]);

  if (!computed.ok) {
    return (
      <Screen footer={<Button label="Back to fix" onPress={() => router.back()} />}>
        <Banner kind="error">{computed.message}</Banner>
      </Screen>
    );
  }

  const { input, result, warnings } = computed;
  const isBartender = input.userRole === 'bartender';
  const shareText = buildShareText(input, result);
  // Bartender flow with whole-dollar rounding: the headline is the whole dollars actually shared.
  const keptShown = keptShownFor(result);
  // Floor trim and tie-held dollars are shown as separate notes (review round 3, #37).
  const { floorTrim, heldFromRoles } = roundingParts(result);
  // Bartender flow: the user's own share (their keptSplit amount + the change), owner Q9.
  const mine = userKeptEntry(input, result);
  const earnings = userEarnings(input, result);

  const onShare = async () => {
    try {
      await Share.share({ message: shareText });
    } catch {
      // user dismissed / share unavailable — nothing to do
    }
  };
  const onCopy = async () => {
    await Clipboard.setStringAsync(shareText);
    Alert.alert('Copied', 'Summary copied — paste it in your group chat.');
  };
  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Pass the team as typed so placeholder names ("Barback 2") aren't remembered.
      await saveShift(input, result, draft.team);
    } catch (e) {
      setSaving(false);
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
      return;
    }
    resetDraft();
    router.dismissAll();
  };

  return (
    <Screen
      footer={
        <>
          <Button label={saving ? 'Saving…' : 'Save shift'} onPress={onSave} disabled={saving} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button variant="secondary" label="Share" onPress={onShare} style={{ flex: 1 }} />
            <Button variant="secondary" label="Copy" onPress={onCopy} style={{ flex: 1 }} />
            <Button
              variant="ghost"
              label="Edit"
              onPress={() => router.back()}
              style={{ flex: 1 }}
            />
          </View>
        </>
      }
    >
      <Card>
        <Muted>
          {formatShiftDate(input.date)} · {profile.name}
        </Muted>
        <View accessible accessibilityLabel={`Total tip-out ${formatCents(result.pool)}`}>
          <Muted>Total tip-out</Muted>
          <Text style={[styles.headline, { color: c.text }]}>{formatCents(result.pool)}</Text>
          <Muted>
            {formatPercent(result.poolPercentOfTips)} of tips ·{' '}
            {formatPercent(result.poolPercentOfNetSales, 2)} of net sales
          </Muted>
        </View>
        <View
          style={[styles.keptBox, { backgroundColor: c.accent }]}
          accessible
          accessibilityLabel={`${isBartender ? 'Bar keeps' : 'You keep'} ${formatCents(keptShown)}`}
        >
          <Body style={{ fontWeight: '600' }}>{isBartender ? 'Bar keeps' : 'You keep'}</Body>
          <Text style={[styles.kept, { color: c.primary }]}>{formatCents(keptShown)}</Text>
        </View>
        {isBartender && result.keptSplit && result.keptSplit.length > 0
          ? result.keptSplit.map((k) => (
              <View key={k.memberId} style={styles.memberRow}>
                <Body style={{ flex: 1 }}>
                  {k.name}
                  {k.memberId === mine?.memberId ? <Muted> (you)</Muted> : null}
                </Body>
                <Body style={{ fontWeight: '600' }}>{formatCents(k.amount)}</Body>
              </View>
            ))
          : null}
        {mine ? (
          <View
            style={styles.memberRow}
            accessible
            accessibilityLabel={`Your share ${formatCents(earnings)}`}
          >
            <Body style={{ flex: 1, fontWeight: '700' }}>
              Your share
              {result.keptChange > 0 ? (
                <Muted> (incl. {formatCents(result.keptChange)} change)</Muted>
              ) : null}
            </Body>
            <Body style={{ fontWeight: '700' }}>{formatCents(earnings)}</Body>
          </View>
        ) : null}
        {isBartender && (!result.keptSplit || result.keptSplit.length === 0) ? (
          <Banner kind="info">
            Add the bartenders on shift (including you) to split what the bar keeps.
          </Banner>
        ) : null}
        {hasChangeNote(result) ? (
          <Muted>{changeNote(result.keptChange, result.keptHeldBack)}</Muted>
        ) : null}
        {floorTrim > 0 ? (
          <Muted>
            Rounded down to the dollar — {formatCents(floorTrim)} stays with{' '}
            {isBartender ? 'the bar' : 'you'}.
          </Muted>
        ) : null}
        {heldFromRoles > 0 ? (
          <Muted>
            {formatCents(heldFromRoles)} kept back from tied whole-dollar shares — stays with{' '}
            {isBartender ? 'the bar' : 'you'}.
          </Muted>
        ) : null}
        {result.retained > 0 ? (
          <Muted>
            Includes {formatCents(result.retained)} kept from roles with nobody on shift.
          </Muted>
        ) : null}
      </Card>

      {warnings.map((w) => (
        // $0 shares are allowed (owner Q8): shown as an informational note, not a warning.
        <Banner key={w.code} kind={w.code === 'ZERO_SHARE_AFTER_ROUNDING' ? 'info' : 'warning'}>
          {w.message}
        </Banner>
      ))}

      <Card>
        <Title>Where it goes</Title>
        {result.roles.map((r) => (
          <RoleRow
            key={r.role}
            role={r}
            totalTips={input.totalTips}
            userRole={input.userRole}
            handling={draft.missingRoleHandling}
            onHandlingChange={setMissingRoleHandling}
          />
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headline: { fontSize: font.headline, fontWeight: '800' },
  keptBox: {
    borderRadius: 12,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kept: { fontSize: font.title + 4, fontWeight: '800' },
  roleRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  roleHeader: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP },
  amount: { fontSize: font.body + 2, fontWeight: '700' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingLeft: spacing.lg,
  },
});
