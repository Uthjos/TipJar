import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Share, View } from 'react-native';

import { ShiftResultView } from '@/components/ShiftResultView';
import { Banner, Button, Screen } from '@/components/ui';
import { calculateShift, EngineValidationError } from '@/engine/calculate';
import { buildShareText, formatShiftDate } from '@/lib/format';
import { buildShiftInput, engineOptions, selectProfile, useShiftStore } from '@/store/shiftStore';
import { spacing } from '@/theme';

export default function ResultsScreen() {
  const draft = useShiftStore((s) => s.draft);
  const profile = useShiftStore(selectProfile);
  const settings = useShiftStore((s) => s.settings);
  const { setMissingRoleHandling, saveShift, resetDraft } = useShiftStore.getState();
  const [saving, setSaving] = useState(false);
  const editing = !!draft.editingShiftId;

  const computed = useMemo(() => {
    const input = buildShiftInput(draft, profile);
    try {
      const { result, warnings } = calculateShift(input, profile, engineOptions(settings));
      return { ok: true as const, input, result, warnings };
    } catch (e) {
      if (e instanceof EngineValidationError) return { ok: false as const, message: e.message };
      throw e;
    }
  }, [draft, profile, settings]);

  if (!computed.ok) {
    return (
      <Screen footer={<Button label="Back to fix" onPress={() => router.back()} />}>
        <Banner kind="error">{computed.message}</Banner>
      </Screen>
    );
  }

  const { input, result, warnings } = computed;
  const shareText = buildShareText(input, result, profile);

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
      // While editing a saved shift this updates it (same id, keeps savedAt).
      await saveShift(input, result, draft.team);
    } catch (e) {
      setSaving(false);
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
      return;
    }
    resetDraft();
    router.dismissAll();
  };

  const saveLabel = editing ? 'Update shift' : 'Save shift';
  return (
    <Screen
      footer={
        <>
          <Button label={saving ? 'Saving…' : saveLabel} onPress={onSave} disabled={saving} />
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
      {editing ? (
        <Banner kind="info">Editing a saved shift — &quot;Update shift&quot; replaces it.</Banner>
      ) : null}
      {draft.editingNote ? <Banner kind="warning">{draft.editingNote}</Banner> : null}
      <ShiftResultView
        input={input}
        result={result}
        warnings={warnings}
        profile={profile}
        header={`${formatShiftDate(input.date)} · ${profile.name}`}
        onHandlingChange={setMissingRoleHandling}
      />
    </Screen>
  );
}
