import { Alert, Platform, View } from 'react-native';

import { Body, Button, Card, Muted, Screen, Title } from '@/components/ui';
import { formatCents } from '@/engine/money';
import { userEarnings } from '@/lib/earnings';
import { formatShiftDate } from '@/lib/format';
import { type SavedShift, useShiftStore } from '@/store/shiftStore';
import { spacing } from '@/theme';

function confirmDelete(shift: SavedShift, onConfirm: () => void) {
  const title = 'Delete this shift?';
  const message = `${formatShiftDate(shift.input.date)} will be removed from this device. This can't be undone.`;
  if (Platform.OS === 'web') {
    // Alert buttons aren't supported on web.
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

/** Saved shifts from the on-device database. Week/month/year breakdowns arrive in milestone 7. */
export default function HistoryScreen() {
  const saved = useShiftStore((s) => s.savedShifts);
  const deleteShift = useShiftStore((s) => s.deleteShift);

  const onDelete = (shift: SavedShift) =>
    confirmDelete(shift, () => {
      deleteShift(shift.id).catch((e: unknown) =>
        Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.'),
      );
    });

  return (
    <Screen>
      <Card>
        <Title>History</Title>
        <Muted>
          Your saved shifts, newest first. Week / month / year breakdowns are coming soon.
        </Muted>
      </Card>
      {saved.length === 0 ? (
        <Muted>No shifts saved yet.</Muted>
      ) : (
        saved.map((s) => (
          <Card key={s.id}>
            <Body style={{ fontWeight: '600' }}>{formatShiftDate(s.input.date)}</Body>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}
            >
              <Muted>Tipped out {formatCents(s.result.pool)}</Muted>
              {/* The user's own earnings (owner Q9): server keeps `kept`; bartender = own
                  share + change. */}
              <Muted>You earned {formatCents(userEarnings(s.input, s.result))}</Muted>
            </View>
            <Button
              compact
              variant="danger"
              label="Delete"
              accessibilityHint={`Deletes the shift from ${formatShiftDate(s.input.date)}`}
              onPress={() => onDelete(s)}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}
