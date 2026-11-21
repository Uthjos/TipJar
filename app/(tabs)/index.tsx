import { format, isValid, parseISO, subDays } from 'date-fns';
import { router } from 'expo-router';
import { View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  ChipRow,
  Field,
  Input,
  MoneyInput,
  Screen,
  ToggleRow,
} from '@/components/ui';
import { selectProfile, useShiftStore } from '@/store/shiftStore';
import { spacing } from '@/theme';

export default function NewShiftScreen() {
  const draft = useShiftStore((s) => s.draft);
  const profiles = useShiftStore((s) => s.profiles);
  const profile = useShiftStore(selectProfile);
  const { setMoney, setDate, setRoundToDollar, setProfile } = useShiftStore.getState();

  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && isValid(parseISO(draft.date));
  const foodOverNet =
    draft.foodSales !== undefined &&
    draft.netSales !== undefined &&
    draft.foodSales > draft.netSales;
  const canContinue = (draft.totalTips ?? 0) > 0 && dateValid;

  return (
    <Screen
      footer={
        <Button
          label="Next: who worked"
          onPress={() => router.push('/shift/team')}
          disabled={!canContinue}
          accessibilityHint={canContinue ? undefined : 'Enter your total tips first'}
        />
      }
    >
      <Card>
        <Field label="I'm checking out as">
          <ChipRow
            accessibilityLabel="Tip-out profile"
            value={profile.id}
            onChange={setProfile}
            options={profiles.map((p) => ({
              value: p.id,
              label: p.name,
              hint: p.appliesTo === 'bartender' ? 'Bartender' : 'Server',
            }))}
          />
        </Field>
      </Card>

      <Card>
        <MoneyInput
          label="Total tips"
          value={draft.totalTips}
          onChange={(v) => setMoney('totalTips', v)}
          hint="Card + cash tips"
        />
        <MoneyInput
          label="Net sales"
          value={draft.netSales}
          onChange={(v) => setMoney('netSales', v)}
        />
        <MoneyInput
          label="Food sales"
          value={draft.foodSales}
          onChange={(v) => setMoney('foodSales', v)}
          hint="Used for the kitchen tip-out"
        />
        {foodOverNet ? (
          <Banner kind="warning">Food sales are higher than net sales — double-check.</Banner>
        ) : null}
        <Button
          label="Scan receipt (coming soon)"
          variant="ghost"
          disabled
          onPress={() => {}}
          accessibilityHint="Receipt scanning is not available yet"
        />
      </Card>

      <Card>
        <Field label="Shift date" hint={dateValid ? undefined : 'Use the format YYYY-MM-DD'}>
          <Input
            accessibilityLabel="Shift date"
            value={draft.date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
          />
        </Field>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            compact
            variant={draft.date === today ? 'primary' : 'secondary'}
            label="Today"
            onPress={() => setDate(today)}
            style={{ flex: 1 }}
          />
          <Button
            compact
            variant={draft.date === yesterday ? 'primary' : 'secondary'}
            label="Yesterday"
            onPress={() => setDate(yesterday)}
            style={{ flex: 1 }}
          />
        </View>
        <ToggleRow
          label="Round to nearest dollar"
          hint="Rounds down — tip-out never exceeds your tips"
          value={draft.roundToDollar}
          onValueChange={setRoundToDollar}
        />
      </Card>
    </Screen>
  );
}
