import { View } from 'react-native';

import { Body, Card, Muted, Screen, Title } from '@/components/ui';
import { formatCents } from '@/engine/money';
import { formatShiftDate, keptShown } from '@/lib/format';
import { useShiftStore } from '@/store/shiftStore';
import { spacing } from '@/theme';

/** Stub: week/month/year breakdown and charts arrive with persistence + history milestones. */
export default function HistoryScreen() {
  const saved = useShiftStore((s) => s.savedShifts);
  return (
    <Screen>
      <Card>
        <Title>History</Title>
        <Muted>
          Week / month / year breakdowns and charts are coming soon. Shifts saved in this session
          are listed below (they are not stored on the device yet).
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
              {/* Same figure as the Results headline (whole dollars shared in the bartender flow). */}
              <Muted>Kept {formatCents(keptShown(s.result))}</Muted>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
