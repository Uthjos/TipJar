/**
 * On-device OCR (ML Kit text recognition via @infinitered/react-native-mlkit-text-recognition).
 * The native module only exists in the TipJar development build; in Expo Go it's missing, so it
 * is loaded lazily and `isOcrAvailable()` returns false instead of crashing. Nothing is uploaded.
 */
import { requireOptionalNativeModule } from 'expo';

import type { OcrLine } from './types';

/** Native module name registered by @infinitered/react-native-mlkit-text-recognition. */
const NATIVE_MODULE = 'RNMLKitTextRecognition';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface MlKitText {
  text: string;
  blocks: { text: string; frame?: Rect; lines: { text: string; frame?: Rect }[] }[];
}

/** Shown instead of scanning in Expo Go (no native OCR module). */
export const DEV_BUILD_MESSAGE = 'Scanning needs the TipJar development build.';

/** True when the ML Kit module is in this build (dev client), false in Expo Go. */
export function isOcrAvailable(): boolean {
  try {
    return requireOptionalNativeModule(NATIVE_MODULE) != null;
  } catch {
    return false;
  }
}

/** Map ML Kit blocks / lines to OcrLine with top / left / height in image pixels. */
export function toOcrLines(result: MlKitText): OcrLine[] {
  const out: OcrLine[] = [];
  for (const block of result.blocks ?? []) {
    const lines = block.lines?.length ? block.lines : [{ text: block.text, frame: block.frame }];
    for (const line of lines) {
      const f = line.frame;
      out.push(
        f
          ? { text: line.text, top: f.top, left: f.left, height: Math.max(0, f.bottom - f.top) }
          : { text: line.text },
      );
    }
  }
  return out;
}

/** Recognise text in a local image (file:// URI). Throws if OCR isn't available in this build. */
export async function recognizeImage(uri: string): Promise<OcrLine[]> {
  if (!isOcrAvailable()) {
    throw new Error(DEV_BUILD_MESSAGE);
  }
  // Lazy: the package calls requireNativeModule at import time, which throws in Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mlkit = require('@infinitered/react-native-mlkit-text-recognition') as {
    recognizeText: (path: string) => Promise<MlKitText>;
  };
  const result = await mlkit.recognizeText(uri);
  return toOcrLines(result);
}
