import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Card, MoneyInput, Muted, Screen, Title } from '@/components/ui';
import type { Cents } from '@/engine/types';
import { parseReceipt } from '@/ocr/parseReceipt';
import { DEV_BUILD_MESSAGE, isOcrAvailable, recognizeImage } from '@/ocr/recognize';
import type { Confidence, FieldId, ReceiptParse } from '@/ocr/types';
import { useShiftStore } from '@/store/shiftStore';
import { font, radius, spacing, useColors } from '@/theme';

const FIELD_LABELS: Record<FieldId, string> = {
  totalTips: 'Total tips',
  netSales: 'Net sales',
  foodSales: 'Food sales',
};

const POS_NAMES: Record<ReceiptParse['pos'], string> = {
  toast: 'Toast',
  square: 'Square',
  aloha: 'Aloha',
  generic: 'your POS',
};

function Pill({ confidence }: { confidence: Confidence | 'missing' }) {
  const c = useColors();
  const { label, bg, fg } =
    confidence === 'high'
      ? { label: 'Found', bg: c.accent, fg: c.primary }
      : confidence === 'missing'
        ? { label: 'Not found', bg: c.dangerBg, fg: c.danger }
        : { label: 'Check this', bg: c.warningBg, fg: c.warning };
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: font.small, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/** Delete the picker's temp copy of the photo; the image is never kept (privacy). */
function deleteTemp(uri: string | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone, or not ours to delete — nothing else to do.
  }
}

type Step =
  | { kind: 'pick' }
  | { kind: 'denied'; what: 'camera' | 'photos' }
  | { kind: 'reading' }
  | { kind: 'confirm'; parse: ReceiptParse }
  | { kind: 'error'; message: string };

export default function ScanScreen() {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [values, setValues] = useState<Partial<Record<FieldId, Cents>>>({});
  const ocr = isOcrAvailable();

  const read = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !result.assets?.[0]) return;
    const uri = result.assets[0].uri;
    setStep({ kind: 'reading' });
    try {
      const lines = await recognizeImage(uri);
      const parse = parseReceipt(lines);
      const found: Partial<Record<FieldId, Cents>> = {};
      for (const [f, v] of Object.entries(parse.fields)) found[f as FieldId] = v.cents;
      setValues(found);
      setStep({ kind: 'confirm', parse });
    } catch (e) {
      setStep({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not read the photo.',
      });
    } finally {
      for (const a of result.assets) deleteTemp(a.uri);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setStep({ kind: 'denied', what: 'camera' });
      return;
    }
    await read(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }));
  };

  const choosePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setStep({ kind: 'denied', what: 'photos' });
      return;
    }
    await read(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
  };

  const useNumbers = () => {
    useShiftStore.getState().applyScan(values);
    router.back();
  };

  if (!ocr) {
    return (
      <Screen footer={<Button label="Back" onPress={() => router.back()} />}>
        <Banner kind="info">{DEV_BUILD_MESSAGE}</Banner>
        <Muted>You can still type your numbers on the New shift screen.</Muted>
      </Screen>
    );
  }

  if (step.kind === 'reading') {
    return (
      <Screen>
        <Card>
          <ActivityIndicator size="large" />
          <Body style={{ textAlign: 'center' }}>Reading your receipt…</Body>
          <Muted style={{ textAlign: 'center' }}>
            This happens on your phone; nothing is uploaded.
          </Muted>
        </Card>
      </Screen>
    );
  }

  if (step.kind === 'confirm') {
    const { parse } = step;
    return (
      <Screen
        footer={
          <>
            <Button label="Use these numbers" onPress={useNumbers} />
            <Button variant="ghost" label="Cancel" onPress={() => router.back()} />
          </>
        }
      >
        <Card>
          <Title>Check the numbers</Title>
          <Muted>
            Read from a {POS_NAMES[parse.pos]} report. Fix anything that looks wrong before you use
            them.
          </Muted>
        </Card>
        {(['totalTips', 'netSales', 'foodSales'] as const).map((f) => {
          const found = parse.fields[f];
          return (
            <Card key={f}>
              <View style={styles.fieldTop}>
                <Body style={{ fontWeight: '700', flex: 1 }}>{FIELD_LABELS[f]}</Body>
                <Pill confidence={found ? found.confidence : 'missing'} />
              </View>
              <MoneyInput
                label={`${FIELD_LABELS[f]} from receipt`}
                value={values[f]}
                onChange={(v) =>
                  setValues((prev) => {
                    const next = { ...prev };
                    if (v === undefined) delete next[f];
                    else next[f] = v;
                    return next;
                  })
                }
              />
              {found ? (
                <Muted>From: “{found.source}”</Muted>
              ) : (
                <Muted>Not found on the receipt — type it in if you have it.</Muted>
              )}
            </Card>
          );
        })}
        {parse.notes.length > 0 ? (
          <Card>
            {parse.notes.map((n) => (
              <Body key={n}>• {n}</Body>
            ))}
          </Card>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen footer={<Button variant="ghost" label="Cancel" onPress={() => router.back()} />}>
      <Card>
        <Title>Scan your checkout</Title>
        <Muted>
          Take a photo of your server checkout or shift report (Toast, Square, Aloha and most
          others). It&apos;s read on your phone and the photo is deleted straight away.
        </Muted>
        <Button label="Take photo" onPress={takePhoto} />
        <Button variant="secondary" label="Choose photo" onPress={choosePhoto} />
      </Card>
      {step.kind === 'denied' ? (
        <Card>
          <Banner kind="warning">
            {step.what === 'camera'
              ? 'TipJar needs camera access to take a photo of your receipt.'
              : 'TipJar needs photo access to read a receipt from your library.'}
          </Banner>
          <Button
            variant="secondary"
            label="Open settings"
            onPress={() => Linking.openSettings()}
          />
        </Card>
      ) : null}
      {step.kind === 'error' ? (
        <Banner kind="error">{`Couldn't read that photo: ${step.message} Try again in better light, or type the numbers in.`}</Banner>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pill: { borderRadius: radius.lg, paddingHorizontal: spacing.sm, paddingVertical: 2 },
});
