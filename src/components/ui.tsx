import { type ReactNode, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { centsToInputString, parseMoneyToCents } from '@/engine/money';
import type { Cents } from '@/engine/types';
import { font, MIN_TAP, radius, spacing, useColors } from '@/theme';

export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        contentContainerStyle={styles.screenContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.surface }]}>
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>
      {children}
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
      {children}
    </Text>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const c = useColors();
  return <Text style={[{ color: c.textMuted, fontSize: font.small }, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: ReactNode; style?: object }) {
  const c = useColors();
  return <Text style={[{ color: c.text, fontSize: font.body }, style]}>{children}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  accessibilityHint,
  style,
  compact,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
  compact?: boolean;
}) {
  const c = useColors();
  const bg =
    variant === 'primary' ? c.primary : variant === 'secondary' ? c.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? c.primaryText : variant === 'danger' ? c.danger : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={compact ? 8 : 0}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        {
          backgroundColor: bg,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
          borderColor: variant === 'ghost' || variant === 'danger' ? c.border : bg,
        },
        style,
      ]}
    >
      <Text style={[styles.buttonText, compact && { fontSize: font.label }, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{label}</Text>
      {children}
      {hint ? <Muted style={{ marginTop: spacing.xs }}>{hint}</Muted> : null}
    </View>
  );
}

export function Input(props: TextInputProps) {
  const c = useColors();
  return (
    <TextInput
      placeholderTextColor={c.textMuted}
      {...props}
      style={[
        styles.input,
        { backgroundColor: c.surfaceAlt, color: c.text, borderColor: c.border },
        props.style,
      ]}
    />
  );
}

/**
 * Money entry with a decimal keypad. Holds the raw text locally and reports integer cents
 * (undefined when blank / invalid) — no float dollars.
 */
export function MoneyInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: Cents | undefined;
  onChange: (c: Cents | undefined) => void;
  hint?: string;
}) {
  const c = useColors();
  const [text, setText] = useState(value === undefined ? '' : centsToInputString(value));
  const [lastValue, setLastValue] = useState(value);
  // Keep local text in sync when the value is changed from outside (e.g. reset / OCR prefill).
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== parseMoneyToCents(text)) {
      setText(value === undefined ? '' : centsToInputString(value));
    }
  }
  const invalid = text.trim() !== '' && parseMoneyToCents(text) === undefined;
  return (
    <Field label={label} hint={invalid ? 'Enter an amount like 123.45' : hint}>
      <View
        style={[
          styles.moneyRow,
          { backgroundColor: c.surfaceAlt, borderColor: invalid ? c.danger : c.border },
        ]}
      >
        <Text style={[styles.moneyPrefix, { color: c.textMuted }]}>$</Text>
        <TextInput
          accessibilityLabel={label}
          value={text}
          onChangeText={(t) => {
            setText(t);
            const cents = parseMoneyToCents(t);
            setLastValue(cents);
            onChange(cents);
          }}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder="0.00"
          placeholderTextColor={c.textMuted}
          returnKeyType="done"
          style={[styles.moneyInput, { color: c.text }]}
        />
      </View>
    </Field>
  );
}

export function ToggleRow({
  label,
  value,
  onValueChange,
  hint,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  hint?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      style={styles.toggleRow}
    >
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Body>{label}</Body>
        {hint ? <Muted>{hint}</Muted> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: c.primary, false: c.border }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.segmented, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && { backgroundColor: c.primary }]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: selected ? c.primaryText : c.text },
                selected && { fontWeight: '700' },
              ]}
              numberOfLines={2}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Banner({
  kind,
  children,
}: {
  kind: 'error' | 'warning' | 'info';
  children: ReactNode;
}) {
  const c = useColors();
  const bg = kind === 'error' ? c.dangerBg : kind === 'warning' ? c.warningBg : c.accent;
  const fg = kind === 'error' ? c.danger : kind === 'warning' ? c.warning : c.text;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: font.label }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontSize: font.title, fontWeight: '700' },
  button: {
    minHeight: MIN_TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: { minHeight: 44, paddingHorizontal: spacing.md },
  buttonText: { fontSize: font.body, fontWeight: '600' },
  field: { gap: spacing.xs },
  fieldLabel: { fontSize: font.label, fontWeight: '600' },
  input: {
    minHeight: MIN_TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    fontSize: font.body,
  },
  moneyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TAP + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  moneyPrefix: { fontSize: font.title, marginRight: spacing.xs },
  moneyInput: { flex: 1, fontSize: font.title, fontWeight: '600', paddingVertical: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TAP,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  segmentText: { fontSize: font.label, textAlign: 'center' },
  banner: { borderRadius: radius.md, padding: spacing.md },
});
