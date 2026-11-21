import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EarnedChart } from '@/components/EarnedChart';
import { Body, Card, Muted, Screen, Segmented, Title } from '@/components/ui';
import { formatCents } from '@/engine/money';
import type { RoleId } from '@/engine/types';
import { userEarnings } from '@/lib/earnings';
import { formatShiftDate } from '@/lib/format';
import { inRange, type Period, periodRange, shiftPeriod, summarize } from '@/lib/history';
import { roleLabelFrom } from '@/lib/profiles';
import { todayIso, useShiftStore } from '@/store/shiftStore';
import { font, MIN_TAP, radius, spacing, useColors } from '@/theme';

// #90: the device's local date (never toISOString(), which is UTC).
const today = todayIso;

function StepButton({
  label,
  glyph,
  onPress,
  disabled,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        { backgroundColor: c.surfaceAlt, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>{glyph}</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${value}`}
      style={[styles.stat, { backgroundColor: c.surfaceAlt }]}
    >
      <Muted>{label}</Muted>
      <Text style={{ color: c.text, fontSize: font.title, fontWeight: '800' }}>{value}</Text>
    </View>
  );
}

function ListRow({ title, detail, amount }: { title: string; detail: string; amount: string }) {
  return (
    <View style={styles.listRow} accessible accessibilityLabel={`${title}, ${detail}, ${amount}`}>
      <View style={{ flex: 1 }}>
        <Body style={{ fontWeight: '600' }}>{title}</Body>
        <Muted>{detail}</Muted>
      </View>
      <Body style={{ fontWeight: '700' }}>{amount}</Body>
    </View>
  );
}

const shiftsWord = (n: number) => `${n} shift${n === 1 ? '' : 's'}`;

export default function HistoryScreen() {
  const c = useColors();
  const saved = useShiftStore((s) => s.savedShifts);
  const profiles = useShiftStore((s) => s.profiles);
  const weekStartsOn = useShiftStore((s) => s.settings.weekStartsOn);
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(today);

  const range = periodRange(period, anchor, weekStartsOn);
  const atCurrent = range.to >= today();
  const roleLabel = roleLabelFrom(profiles);
  const summary = summarize(saved, range, { weekStartsOn, roleLabel });
  // listShifts order: newest date first, then newest save.
  const shifts = saved.filter((s) => inRange(s.input.date, range));
  const bucketWord = period === 'year' ? 'month' : 'day';

  const step = (dir: -1 | 1) => setAnchor(shiftPeriod(range, dir, weekStartsOn).from);

  return (
    <Screen>
      <Card>
        <Segmented
          accessibilityLabel="History period"
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setAnchor(today());
          }}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Year' },
          ]}
        />
        <View style={styles.stepRow}>
          <StepButton label={`Previous ${period}`} glyph="‹" onPress={() => step(-1)} />
          <Title>{range.label}</Title>
          <StepButton
            label={`Next ${period}`}
            glyph="›"
            onPress={() => step(1)}
            disabled={atCurrent}
          />
        </View>
      </Card>

      {summary.shiftCount === 0 ? (
        <Card>
          <Body>
            {atCurrent ? `No shifts this ${period} yet.` : `No shifts in ${range.label}.`}
          </Body>
          <Muted>Shifts you save show up here.</Muted>
        </Card>
      ) : (
        <>
          <View style={styles.stats}>
            {/* "You earned" = the user's own earnings (owner Q9), as on Results. */}
            <Stat label="You earned" value={formatCents(summary.earned)} />
            <Stat label="Tipped out" value={formatCents(summary.tippedOut)} />
            <Stat label="Shifts" value={String(summary.shiftCount)} />
            <Stat label="Average per shift" value={formatCents(summary.averageEarned)} />
          </View>

          <Card>
            <Title>What you earned</Title>
            <EarnedChart
              series={summary.series}
              description={`What you earned per ${bucketWord}, ${range.label}`}
            />
          </Card>

          <Card>
            <Title>Where your tip-outs went</Title>
            <Muted>By role</Muted>
            {summary.byRole.map((r) => (
              <ListRow
                key={r.role}
                title={r.label}
                detail={shiftsWord(r.shifts)}
                amount={formatCents(r.amount)}
              />
            ))}
            {summary.byCoworker.length > 0 ? (
              <>
                <Muted>By coworker</Muted>
                {summary.byCoworker.map((p) => (
                  <ListRow
                    key={p.key}
                    title={p.name}
                    detail={`${p.roles.map((r: RoleId) => roleLabel(r)).join(', ')} · ${shiftsWord(p.shifts)}`}
                    amount={formatCents(p.amount)}
                  />
                ))}
              </>
            ) : null}
          </Card>

          <Card>
            <Title>Shifts</Title>
            {shifts.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`Shift on ${formatShiftDate(s.input.date)}, you earned ${formatCents(userEarnings(s.input, s.result))}`}
                onPress={() => router.push(`/history/${s.id}`)}
                style={({ pressed }) => [
                  styles.shiftRow,
                  { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '600' }}>{formatShiftDate(s.input.date)}</Body>
                  <Muted>Tipped out {formatCents(s.result.pool)}</Muted>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Muted>You earned</Muted>
                  <Body style={{ fontWeight: '700' }}>
                    {formatCents(userEarnings(s.input, s.result))}
                  </Body>
                </View>
                <Text style={{ color: c.textMuted, fontSize: 22, marginLeft: spacing.sm }}>›</Text>
              </Pressable>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  step: {
    width: MIN_TAP,
    height: MIN_TAP,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  listRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TAP + 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
});
