/**
 * Create a project.
 *
 * The rule that shapes this screen: milestone amounts must add up to the project
 * total (section 10). Rather than letting someone fill in six fields and then
 * rejecting the lot, the running total is shown live and the submit button
 * stays disabled until it balances.
 */

import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Amount } from '@/components/product';
import { Button, Card, Field, Row, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { addAmounts, formatMoney } from '@/lib/money';
import { useCreateProject } from '@/lib/queries';
import { useTheme } from '@/theme';

type MilestoneDraft = {
  title: string;
  description: string;
  completion_criteria: string;
  amount: string;
};

const emptyMilestone = (): MilestoneDraft => ({
  title: '',
  description: '',
  completion_criteria: '',
  amount: '',
});

export default function CreateProject() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const create = useCreateProject();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [receiverEmail, setReceiverEmail] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([emptyMilestone()]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const milestoneTotal = useMemo(
    () =>
      milestones.reduce(
        (sum, milestone) => addAmounts(sum, normalise(milestone.amount)),
        '0.00',
      ),
    [milestones],
  );

  const targetTotal = normalise(totalAmount);
  const balances = targetTotal !== '0.00' && milestoneTotal === targetTotal;
  const difference = subtract(targetTotal, milestoneTotal);

  const canSubmit =
    title.trim().length >= 3 &&
    description.trim().length >= 3 &&
    balances &&
    milestones.every(
      (milestone) =>
        milestone.title.trim().length >= 3 &&
        milestone.description.trim().length >= 3 &&
        milestone.completion_criteria.trim().length >= 3,
    );

  const update = (index: number, patch: Partial<MilestoneDraft>) => {
    setMilestones((current) =>
      current.map((milestone, position) =>
        position === index ? { ...milestone, ...patch } : milestone,
      ),
    );
  };

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    try {
      const project = await create.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        receiver_email: receiverEmail.trim() || null,
        total_amount: targetTotal,
        milestones: milestones.map((milestone) => ({
          title: milestone.title.trim(),
          description: milestone.description.trim(),
          completion_criteria: milestone.completion_criteria.trim(),
          amount: normalise(milestone.amount),
        })),
      });
      router.replace(`/project/${project.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fieldErrors);
        setError(caught.message);
      } else {
        setError('We could not create the project.');
      }
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: insets.top + spacing.md,
          paddingBottom: spacing.huge * 2,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="h1">New project</Txt>
          <Txt
            variant="body"
            tone="secondary"
            accessibilityRole="button"
            onPress={() => router.back()}
          >
            Cancel
          </Txt>
        </Row>

        <Card style={{ gap: spacing.lg }}>
          <Field
            label="Project name"
            value={title}
            onChangeText={setTitle}
            placeholder="Website development"
          />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="What is being built, and for whom?"
            multiline
            style={{ minHeight: 80, textAlignVertical: 'top' }}
          />
          <Field
            label="Receiver's email"
            value={receiverEmail}
            onChangeText={setReceiverEmail}
            placeholder="them@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            error={fieldErrors.receiver_email}
            hint="They must already have a TrustPay account. You can invite them later."
          />
          <Field
            label="Total value"
            value={totalAmount}
            onChangeText={setTotalAmount}
            placeholder="20000"
            keyboardType="decimal-pad"
            error={fieldErrors.total_amount}
          />
        </Card>

        {/* The balance check, always visible */}
        <Card
          style={{
            borderColor: balances ? colors.success : colors.border,
            backgroundColor: balances ? colors.successMuted : colors.surface,
          }}
        >
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Txt variant="overline" tone="secondary">
                Milestones total
              </Txt>
              <Amount
                value={milestoneTotal}
                size="h2"
                tone={balances ? 'success' : 'primary'}
              />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt variant="overline" tone="secondary">
                Project total
              </Txt>
              <Amount value={targetTotal} size="h2" tone="secondary" />
            </View>
          </Row>
          <Txt
            variant="caption"
            tone={balances ? 'success' : 'secondary'}
            style={{ marginTop: spacing.sm }}
          >
            {balances
              ? 'Milestones add up exactly to the project total.'
              : targetTotal === '0.00'
                ? 'Enter the total value, then split it across milestones.'
                : `${formatMoney(difference.replace('-', ''))} ${
                    difference.startsWith('-') ? 'over' : 'still to allocate'
                  }.`}
          </Txt>
        </Card>

        {/* Milestones */}
        {milestones.map((milestone, index) => (
          <Card key={index} style={{ gap: spacing.lg }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="overline" tone="secondary">
                Milestone {String(index + 1).padStart(2, '0')}
              </Txt>
              {milestones.length > 1 ? (
                <Txt
                  variant="captionStrong"
                  tone="danger"
                  accessibilityRole="button"
                  onPress={() =>
                    setMilestones((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >
                  Remove
                </Txt>
              ) : null}
            </Row>

            <Field
              label="Name"
              value={milestone.title}
              onChangeText={(value) => update(index, { title: value })}
              placeholder="Design"
            />
            <Field
              label="Description"
              value={milestone.description}
              onChangeText={(value) => update(index, { description: value })}
              placeholder="What this stage covers"
              multiline
              style={{ minHeight: 64, textAlignVertical: 'top' }}
            />
            <Field
              label="Completion criteria"
              value={milestone.completion_criteria}
              onChangeText={(value) => update(index, { completion_criteria: value })}
              placeholder="What must be delivered for this to count as done?"
              multiline
              style={{ minHeight: 64, textAlignVertical: 'top' }}
              hint="Be specific. Vague criteria are the most common cause of disputes."
            />
            <Field
              label="Amount"
              value={milestone.amount}
              onChangeText={(value) => update(index, { amount: value })}
              placeholder="5000"
              keyboardType="decimal-pad"
            />
          </Card>
        ))}

        <Pressable
          onPress={() => setMilestones((current) => [...current, emptyMilestone()])}
          accessibilityRole="button"
          style={{
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.borderStrong,
            borderRadius: radius.lg,
            padding: spacing.lg,
            alignItems: 'center',
          }}
        >
          <Txt variant="bodyStrong" tone="brand">
            ＋ Add milestone
          </Txt>
        </Pressable>

        {error ? (
          <Card
            style={{ backgroundColor: colors.dangerMuted, borderColor: colors.danger }}
          >
            <Txt variant="caption" tone="danger">
              {error}
            </Txt>
          </Card>
        ) : null}

        <Button
          title="Create project"
          onPress={submit}
          loading={create.isPending}
          disabled={!canSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** "5000" or "5,000.5" → "5000.00" */
function normalise(input: string): string {
  const cleaned = input.replace(/[^\d.]/g, '');
  if (!cleaned) return '0.00';
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return `${whole || '0'}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function subtract(a: string, b: string): string {
  const toPaise = (value: string) => {
    const [whole = '0', fraction = '00'] = value.split('.');
    return Number(whole) * 100 + Number(fraction);
  };
  const result = toPaise(a) - toPaise(b);
  const sign = result < 0 ? '-' : '';
  const abs = Math.abs(result);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
