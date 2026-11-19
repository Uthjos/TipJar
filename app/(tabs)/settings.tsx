import { Body, Card, Muted, Screen, Title } from '@/components/ui';
import { roleLabel } from '@/engine/profiles';
import { basisLabel } from '@/lib/format';
import { useShiftStore } from '@/store/shiftStore';

/** Stub: profile editing, saved coworkers and CSV export arrive in later milestones. */
export default function SettingsScreen() {
  const profiles = useShiftStore((s) => s.profiles);
  return (
    <Screen>
      <Card>
        <Title>Settings</Title>
        <Muted>Editing tip-out profiles, saved coworkers and export are coming soon.</Muted>
      </Card>
      {profiles.map((p) => (
        <Card key={p.id}>
          <Body style={{ fontWeight: '700' }}>{p.name}</Body>
          <Muted>
            Tip-out pool: {p.totalTipOutPercentOfTips}% of {basisLabel(p.poolBasis)}
          </Muted>
          {p.rules.map((r) => (
            <Muted key={r.role}>
              {roleLabel(r.role)}:{' '}
              {r.type === 'percentOfBasis'
                ? `${r.percent}% of ${basisLabel(r.basis)} (taken first)`
                : `weight ${r.weight} of the remainder`}
            </Muted>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
