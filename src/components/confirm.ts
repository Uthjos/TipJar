import { Alert, Platform } from 'react-native';

/** Ask before a destructive action. Alert buttons aren't supported on web, so use confirm(). */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
): void {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

/** Show a store / validation error to the user. */
export function showError(title: string, e: unknown): void {
  Alert.alert(title, e instanceof Error ? e.message : 'Please try again.');
}
