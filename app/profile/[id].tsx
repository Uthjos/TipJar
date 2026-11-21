import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { confirmAction, showError } from '@/components/confirm';
import {
  Banner,
  Body,
  Button,
  Card,
  ChipRow,
  Field,
  Input,
  Muted,
  NumberInput,
  Screen,
  Segmented,
  Title,
} from '@/components/ui';
import type { Basis, TipOutProfile, TipOutRule, UserRole } from '@/engine/types';
import { checkProfile, hasErrors, type ProfileIssue } from '@/lib/profileValidation';
import {
  addRule,
  displayRole,
  isBuiltInProfile,
  moveRule,
  removeRule,
  renameRolePatch,
  updateRule,
} from '@/lib/profiles';
import { useShiftStore } from '@/store/shiftStore';
import { font, MIN_TAP, radius, spacing, useColors } from '@/theme';

const BASIS_OPTIONS: { value: Basis; label: string }[] = [
  { value: 'totalTips', label: 'Tips' },
  { value: 'netSales', label: 'Net sales' },
  { value: 'foodSales', label: 'Food sales' },
];

/** Roles offered by "Add role" (custom names are typed in). */
const QUICK_ROLES = ['bartender', 'barback', 'host', 'kitchen'] as const;

let keySeq = 0;
const nextKey = () => `rule-${++keySeq}`;

function starterRule(role: string): TipOutRule {
  return role === 'kitchen'
    ? { role, type: 'percentOfBasis', basis: 'foodSales', percent: 2 }
    : { role, type: 'shareOfRemainder', weight: 1 };
}

function IssueText({ issues }: { issues: ProfileIssue[] }) {
  const c = useColors();
  return (
    <>
      {issues.map((i) => (
        <Text
          key={`${i.code}-${i.ruleIndex ?? 'p'}`}
          accessibilityRole="alert"
          style={{ color: i.severity === 'error' ? c.danger : c.warning, fontSize: font.small }}
        >
          {i.message}
        </Text>
      ))}
    </>
  );
}

function SmallButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallBtn,
        { backgroundColor: c.surfaceAlt, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={{ color: danger ? c.danger : c.text, fontSize: 18, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function RuleEditor({
  rule,
  index,
  count,
  issues,
  onChange,
  onMove,
  onRemove,
  roleFixed,
}: {
  rule: TipOutRule;
  index: number;
  count: number;
  issues: ProfileIssue[];
  onChange: (patch: Parameters<typeof updateRule>[2]) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  /** #61: false only while a newly added custom role is first being named. */
  roleFixed: boolean;
}) {
  const c = useColors();
  const name = displayRole(rule);
  const [nameText, setNameText] = useState(rule.role ? name : (rule.label ?? ''));
  const label = nameText.trim() || `Role ${index + 1}`;

  const onName = (text: string) => {
    setNameText(text);
    // #61 role id fixed once created (rename = label only); #62 built-in names carry no label.
    onChange(renameRolePatch(rule, text, roleFixed));
  };

  return (
    <View style={[styles.rule, { borderColor: c.border }]}>
      <View style={styles.ruleTop}>
        <Input
          accessibilityLabel={`Role ${index + 1} name`}
          value={nameText}
          onChangeText={onName}
          placeholder="Role name, e.g. Busser"
          autoCapitalize="words"
          style={{ flex: 1 }}
        />
        <SmallButton
          label="↑"
          accessibilityLabel={`Move ${label} up`}
          disabled={index === 0}
          onPress={() => onMove(index - 1)}
        />
        <SmallButton
          label="↓"
          accessibilityLabel={`Move ${label} down`}
          disabled={index === count - 1}
          onPress={() => onMove(index + 1)}
        />
        <SmallButton label="✕" accessibilityLabel={`Remove ${label}`} danger onPress={onRemove} />
      </View>
      <Segmented
        accessibilityLabel={`How ${label} is paid`}
        value={rule.type}
        onChange={(type) => onChange({ type })}
        options={[
          { value: 'percentOfBasis', label: 'Fixed % of…' },
          { value: 'shareOfRemainder', label: 'Share' },
        ]}
      />
      {rule.type === 'percentOfBasis' ? (
        <View style={{ gap: spacing.sm }}>
          <NumberInput
            accessibilityLabel={`${label} percent`}
            value={rule.percent}
            onChange={(percent) => onChange({ percent })}
            placeholder="2"
            suffix="%"
          />
          <ChipRow
            accessibilityLabel={`${label} percent of`}
            value={rule.basis}
            onChange={(basis) => onChange({ basis })}
            options={BASIS_OPTIONS}
          />
          <Muted>Taken out of the pool first.</Muted>
        </View>
      ) : (
        <View style={{ gap: spacing.xs }}>
          <NumberInput
            accessibilityLabel={`${label} share`}
            value={rule.weight}
            onChange={(weight) => onChange({ weight })}
            placeholder="1"
            suffix="parts"
          />
          <Muted>Shares split what&apos;s left of the pool, e.g. 4 : 3 : 1.</Muted>
        </View>
      )}
      <IssueText issues={issues} />
    </View>
  );
}

export default function ProfileEditorScreen() {
  const params = useLocalSearchParams<{ id: string; from?: string; appliesTo?: string }>();
  const profiles = useShiftStore((s) => s.profiles);
  const store = useShiftStore.getState();
  const isNew = params.id === 'new';

  const [draft, setDraft] = useState<TipOutProfile | null>(() => {
    if (!isNew) {
      const p = store.profiles.find((x) => x.id === params.id);
      return p ? { ...p, rules: p.rules.map((r) => ({ ...r })) } : null;
    }
    if (params.from) return store.duplicateProfile(params.from);
    return store.createProfile(params.appliesTo === 'bartender' ? 'bartender' : 'server');
  });
  const [keys, setKeys] = useState<string[]>(() => (draft?.rules ?? []).map(nextKey));
  const [busy, setBusy] = useState(false);
  // Keys of custom rows added in this session whose role id is still being set by typing (#61).
  const [unnamedKeys, setUnnamedKeys] = useState<Set<string>>(() => new Set());

  if (!draft) {
    return (
      <Screen>
        <Banner kind="error">That profile no longer exists.</Banner>
        <Button label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const issues = checkProfile(draft, profiles);
  const profileIssues = issues.filter((i) => i.ruleIndex === undefined);
  const blocked = hasErrors(issues);
  const builtIn = !isNew && isBuiltInProfile(draft.id);
  const saved = profiles.find((p) => p.id === draft.id);
  const lastForRole =
    !!saved && !profiles.some((p) => p.id !== saved.id && p.appliesTo === saved.appliesTo);

  const update = (p: TipOutProfile) => setDraft(p);
  const usedRoles = new Set(draft.rules.map((r) => r.role));

  const add = (role: string) => {
    update(addRule(draft, starterRule(role)));
    setKeys((k) => [...k, nextKey()]);
  };
  const addCustom = () => {
    update(addRule(draft, { role: '', type: 'shareOfRemainder', weight: 1 }));
    const key = nextKey();
    setKeys((k) => [...k, key]);
    setUnnamedKeys((s) => new Set(s).add(key));
  };

  const onSave = async () => {
    setBusy(true);
    try {
      await useShiftStore.getState().saveProfile(draft);
      router.back();
    } catch (e) {
      showError('Could not save', e);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () =>
    confirmAction(
      `Delete "${draft.name}"?`,
      'Shifts you already saved keep their numbers. This cannot be undone.',
      'Delete',
      async () => {
        try {
          await useShiftStore.getState().deleteProfile(draft.id);
          router.back();
        } catch (e) {
          showError('Could not delete', e);
        }
      },
    );

  const onReset = () =>
    confirmAction(
      `Reset "${draft.name}"?`,
      'This puts back the shipped percentages and roles.',
      'Reset',
      async () => {
        try {
          await useShiftStore.getState().resetProfile(draft.id);
          const fresh = useShiftStore.getState().profiles.find((p) => p.id === draft.id);
          if (fresh) {
            setDraft({ ...fresh, rules: fresh.rules.map((r) => ({ ...r })) });
            setKeys(fresh.rules.map(nextKey));
          }
        } catch (e) {
          showError('Could not reset', e);
        }
      },
    );

  return (
    <Screen
      footer={
        <Button
          label={busy ? 'Saving…' : 'Save profile'}
          onPress={onSave}
          disabled={blocked || busy}
          accessibilityHint={blocked ? 'Fix the problems shown in red first' : undefined}
        />
      }
    >
      <Stack.Screen options={{ title: isNew ? 'New profile' : 'Edit profile' }} />
      <Card>
        <Field label="Name">
          <Input
            accessibilityLabel="Profile name"
            value={draft.name}
            onChangeText={(name) => update({ ...draft, name })}
            placeholder="e.g. Friday patio"
          />
        </Field>
        <Field label="Who it's for">
          <Segmented
            accessibilityLabel="Who the profile is for"
            value={draft.appliesTo}
            onChange={(appliesTo: UserRole) => update({ ...draft, appliesTo })}
            options={[
              { value: 'server', label: 'Server' },
              { value: 'bartender', label: 'Bartender' },
            ]}
          />
        </Field>
        <Field label="Tip-out pool">
          <NumberInput
            accessibilityLabel="Tip-out pool percent"
            value={draft.totalTipOutPercentOfTips}
            onChange={(n) => update({ ...draft, totalTipOutPercentOfTips: n })}
            placeholder="30"
            suffix="%"
          />
          <ChipRow
            accessibilityLabel="Pool is a percent of"
            value={draft.poolBasis ?? 'totalTips'}
            onChange={(basis) => {
              const next: TipOutProfile = { ...draft, poolBasis: basis };
              if (basis === 'totalTips') delete next.poolBasis;
              update(next);
            }}
            options={BASIS_OPTIONS}
          />
        </Field>
        <IssueText issues={profileIssues} />
      </Card>

      <Card>
        <Title>Roles</Title>
        <Muted>Fixed amounts come out of the pool first; shares split what&apos;s left.</Muted>
        {draft.rules.map((rule, i) => (
          <RuleEditor
            key={keys[i] ?? i}
            roleFixed={!unnamedKeys.has(keys[i] ?? '')}
            rule={rule}
            index={i}
            count={draft.rules.length}
            issues={issues.filter((x) => x.ruleIndex === i)}
            onChange={(patch) => update(updateRule(draft, i, patch))}
            onMove={(to) => {
              update(moveRule(draft, i, to));
              setKeys((k) => {
                const out = [...k];
                const [key] = out.splice(i, 1);
                out.splice(to, 0, key!);
                return out;
              });
            }}
            onRemove={() => {
              update(removeRule(draft, i));
              setKeys((k) => k.filter((_, j) => j !== i));
            }}
          />
        ))}
        <Body style={{ fontWeight: '600' }}>Add role</Body>
        <View style={styles.addRow}>
          {QUICK_ROLES.filter((r) => !usedRoles.has(r)).map((r) => (
            <Button
              key={r}
              compact
              variant="secondary"
              label={`+ ${displayRole({ role: r }).replace(/\s*\(.*\)$/, '')}`}
              onPress={() => add(r)}
            />
          ))}
          <Button compact variant="secondary" label="+ Custom…" onPress={addCustom} />
        </View>
      </Card>

      {!isNew ? (
        <Card>
          {builtIn ? (
            <Button variant="ghost" label="Reset to shipped values" onPress={onReset} />
          ) : null}
          <Button
            variant="danger"
            label="Delete profile"
            onPress={onDelete}
            disabled={lastForRole}
          />
          {lastForRole ? (
            <Muted>
              This is your only {saved!.appliesTo} profile, so it can&apos;t be deleted. Create
              another {saved!.appliesTo} profile first.
            </Muted>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rule: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  ruleTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  smallBtn: {
    width: MIN_TAP - 8,
    height: MIN_TAP,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
