/**
 * Write a CSV to the app's cache directory and open the system share sheet (M7).
 * Nothing leaves the device unless the user picks a share target.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function shareCsv(fileName: string, csv: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  // #87: UTF-8 BOM so Excel shows names like "Zoë" correctly (kept out of the pure builders).
  await file.write(`﻿${csv}`);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    dialogTitle: fileName,
    UTI: 'public.comma-separated-values-text',
  });
}
