import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Share, View } from 'react-native';

import { confirmAction, showError } from '@/components/confirm';
import { ShiftResultView } from '@/components/ShiftResultView';
import { Banner, Button, Muted, Screen } from '@/components/ui';
import { buildShareText, formatShiftDate } from '@/lib/format';
import { useShiftStore } from '@/store/shiftStore';
import { spacing } from '@/theme';

/** A saved shift, read-only (the snapshot as saved), with Edit / Share / Copy / Delete (M7). */
export default function ShiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shift = useShiftStore((s) => s.savedShifts.find((x) => x.id === id));
  const profile = useShiftStore((s) => s.profiles.find((p) => p.id === shift?.input.profileId));

  if (!shift) {
    return (
      <Screen footer={<Button label="Back" onPress={() => router.back()} />}>
        <Banner kind="info">This shift was deleted.</Banner>
      </Screen>
    );
  }

  const { input, result } = shift;
  const shareText = buildShareText(input, result, profile);

  const onShare = async () => {
    try {
      await Share.share({ message: shareText });
    } catch {
      // dismissed / unavailable
    }
  };
  const onCopy = async () => {
    await Clipboard.setStringAsync(shareText);
    Alert.alert('Copied', 'Summary copied — paste it in your group chat.');
  };
  const onEdit = () => {
    useShiftStore.getState().startEditShift(shift);
    // Back to the tabs and into New Shift with the saved numbers loaded.
    router.dismissAll();
    router.navigate('/');
  };
  const onDelete = () =>
    confirmAction(
      'Delete this shift?',
      `${formatShiftDate(input.date)} will be removed from this device. This can't be undone.`,
      'Delete',
      async () => {
        try {
          await useShiftStore.getState().deleteShift(shift.id);
          router.back();
        } catch (e) {
          showError('Could not delete', e);
        }
      },
    );

  return (
    <Screen
      footer={
        <>
          <Button label="Edit shift" onPress={onEdit} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button variant="secondary" label="Share" onPress={onShare} style={{ flex: 1 }} />
            <Button variant="secondary" label="Copy" onPress={onCopy} style={{ flex: 1 }} />
            <Button variant="danger" label="Delete" onPress={onDelete} style={{ flex: 1 }} />
          </View>
        </>
      }
    >
      <ShiftResultView
        input={input}
        result={result}
        profile={profile}
        header={`${formatShiftDate(input.date)} · ${profile?.name ?? 'Deleted profile'}`}
      />
      <Muted>Saved {new Date(shift.savedAt).toLocaleString()}</Muted>
    </Screen>
  );
}
