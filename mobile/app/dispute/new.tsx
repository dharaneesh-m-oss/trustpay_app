import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Row, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useRaiseDispute } from '@/lib/queries';
import { useTheme } from '@/theme';

const REASONS = [
  { key: 'WORK_NOT_DELIVERED', label: 'Work was not delivered' },
  { key: 'WORK_INCOMPLETE', label: 'Work is incomplete' },
  { key: 'QUALITY_NOT_AS_AGREED', label: 'Quality is not as agreed' },
  { key: 'PAYMENT_NOT_RELEASED', label: 'Payment has not been released' },
  { key: 'SCOPE_DISAGREEMENT', label: 'We disagree on the scope' },
  { key: 'DEADLINE_MISSED', label: 'The deadline was missed' },
  { key: 'OTHER', label: 'Something else' },
];

export default function NewDispute() {
  const { milestone } = useLocalSearchParams<{ milestone: string }>();
  const router = useRouter();
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();

  const raise = useRaiseDispute();
  const [reason, setReason] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      const dispute = await raise.mutateAsync({
        milestone_id: milestone,
        reason: reason!,
        description: description.trim(),
      });
      router.replace(`/dispute/${dispute.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'That did not go through.',
      );
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingTop: insets.top + spacing.md,
        gap: spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h1">Raise a dispute</Txt>
        <Txt
          variant="body"
          tone="secondary"
          accessibilityRole="button"
          onPress={() => router.back()}
        >
          Cancel
        </Txt>
      </Row>

      <Card style={{ backgroundColor: colors.warningMuted, borderColor: colors.warning }}>
        <Txt variant="caption" tone="warning">
          While a dispute is open, the protected funds cannot be released or
          cancelled by either of you. A TrustPay reviewer decides the outcome.
        </Txt>
      </Card>

      <View style={{ gap: spacing.sm }}>
        <Txt variant="overline" tone="secondary">
          What went wrong?
        </Txt>
        {REASONS.map((item) => {
          const selected = reason === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setReason(item.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                borderWidth: 1.5,
                borderColor: selected ? colors.brand : colors.border,
                backgroundColor: selected ? colors.brandMuted : colors.surface,
                borderRadius: radius.md,
                padding: spacing.lg,
              }}
            >
              <Txt variant="body" tone={selected ? 'brand' : 'primary'}>
                {item.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Txt variant="overline" tone="secondary">
          Explain what happened
        </Txt>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Be specific. What was agreed, and what actually happened?"
          placeholderTextColor={colors.textTertiary}
          multiline
          style={{
            ...typography.body,
            minHeight: 140,
            borderWidth: 1.5,
            borderColor: colors.border,
            borderRadius: radius.md,
            padding: spacing.lg,
            color: colors.textPrimary,
            backgroundColor: colors.surface,
            textAlignVertical: 'top',
          }}
        />
        <Txt variant="caption" tone="tertiary">
          The other party sees this and can respond.
        </Txt>
      </View>

      {error ? (
        <Card style={{ backgroundColor: colors.dangerMuted, borderColor: colors.danger }}>
          <Txt variant="caption" tone="danger">
            {error}
          </Txt>
        </Card>
      ) : null}

      <Button
        title="Raise dispute"
        variant="danger"
        loading={raise.isPending}
        disabled={!reason || description.trim().length < 10}
        onPress={submit}
      />
      <View style={{ height: spacing.huge }} />
    </ScrollView>
  );
}
