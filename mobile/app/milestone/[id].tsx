/**
 * Milestone detail — where money actually moves.
 *
 * The available actions depend on who is looking and what state the milestone
 * is in, so the screen decides that once, up front, rather than scattering
 * conditionals through the layout. Every destructive or financial action states
 * its consequence before it is taken.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Modal, RefreshControl, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Amount, MILESTONE_TONE, formatDate, formatDateTime } from '@/components/product';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeader,
  Txt,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import {
  useApproveMilestone,
  useFundMilestone,
  useMilestone,
  useProject,
  useRequestChanges,
  useRequestCancellation,
  useSubmitMilestone,
  useSubmissions,
  useWallet,
} from '@/lib/queries';
import { useTheme } from '@/theme';

import { ProtectionCeremony } from '@/components/ProtectionCeremony';

export default function MilestoneDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const milestone = useMilestone(id);
  const submissions = useSubmissions(id);
  const wallet = useWallet();
  const project = useProject(milestone.data?.project_id ?? '');

  const fund = useFundMilestone(id);
  const approve = useApproveMilestone(id);
  const submit = useSubmitMilestone(id);
  const requestChanges = useRequestChanges(id);
  const cancel = useRequestCancellation();

  const [sheet, setSheet] = useState<null | 'submit' | 'changes' | 'cancel'>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  if (milestone.isLoading) {
    return (
      <Screen>
        <Loading label="Loading milestone" />
      </Screen>
    );
  }

  if (milestone.isError || !milestone.data) {
    return (
      <Screen>
        <ErrorState
          message={milestone.error?.message ?? 'Something went wrong.'}
          onRetry={() => milestone.refetch()}
        />
      </Screen>
    );
  }

  const data = milestone.data;
  const role = project.data?.your_role;
  const isClient = role === 'CLIENT';
  const isReceiver = role === 'RECEIVER';

  const canFund = isClient && data.status === 'PENDING_FUNDING';
  const canSubmit =
    isReceiver && ['FUNDED', 'IN_PROGRESS', 'CHANGES_REQUESTED'].includes(data.status);
  const canReview = isClient && data.status === 'SUBMITTED';
  const canCancel =
    isClient && ['FUNDED', 'IN_PROGRESS', 'CHANGES_REQUESTED'].includes(data.status);
  const canDispute = ['FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED'].includes(
    data.status,
  );

  const insufficientFunds =
    canFund &&
    wallet.data &&
    Number(wallet.data.available.replace(/,/g, '')) <
      Number(data.amount.replace(/,/g, ''));

  const run = async (action: () => Promise<unknown>, onDone?: () => void) => {
    setError(null);
    try {
      await action();
      setSheet(null);
      setNote('');
      onDone?.();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'That did not go through.',
      );
    }
  };

  return (
    <>
      <Screen
        contentStyle={{ paddingTop: insets.top + spacing.md }}
        refreshControl={
          <RefreshControl
            refreshing={milestone.isRefetching}
            onRefresh={() => {
              milestone.refetch();
              submissions.refetch();
            }}
          />
        }
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt
            variant="body"
            tone="secondary"
            accessibilityRole="button"
            onPress={() => router.back()}
          >
            ‹ Back
          </Txt>
          <Badge
            label={data.status_label}
            tone={MILESTONE_TONE[data.status] ?? 'neutral'}
          />
        </Row>

        <View style={{ gap: spacing.xs }}>
          <Txt variant="overline" tone="secondary">
            Milestone {String(data.sequence).padStart(2, '0')}
          </Txt>
          <Txt variant="h1">{data.title}</Txt>
        </View>

        {/* The amount, and what condition releases it */}
        <Card
          style={
            data.is_funded && !data.is_released
              ? { borderColor: colors.protected, borderWidth: 1.5 }
              : undefined
          }
        >
          <Txt variant="overline" tone="secondary">
            {data.is_released
              ? 'Paid'
              : data.is_funded
                ? 'Protected'
                : 'Milestone value'}
          </Txt>
          <Amount
            value={data.amount}
            currency={data.currency}
            tone={data.is_released ? 'success' : data.is_funded ? 'brand' : 'primary'}
          />

          <View
            style={{
              marginTop: spacing.lg,
              padding: spacing.md,
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
            }}
          >
            <Txt variant="captionStrong" tone="secondary">
              Release condition
            </Txt>
            <Txt variant="caption" style={{ marginTop: 2 }}>
              {data.is_released
                ? 'Released to the receiver after client approval.'
                : 'The client approves after the receiver submits the agreed work.'}
            </Txt>
          </View>
        </Card>

        {/* Terms */}
        <Card>
          <SectionHeader title="What was agreed" />
          <Txt variant="body">{data.description}</Txt>

          <Divider style={{ marginVertical: spacing.lg }} />

          <Txt variant="captionStrong" tone="secondary">
            Completion criteria
          </Txt>
          <Txt variant="body" style={{ marginTop: spacing.xs }}>
            {data.completion_criteria}
          </Txt>

          <Row style={{ marginTop: spacing.lg, justifyContent: 'space-between' }}>
            <Txt variant="caption" tone="tertiary">
              {data.due_date ? `Due ${formatDate(data.due_date)}` : 'No due date'}
            </Txt>
            <Txt variant="caption" tone="tertiary">
              Revisions: {data.revisions_used} / {data.revision_limit}
            </Txt>
          </Row>
        </Card>

        {/* Submissions */}
        {(submissions.data?.length ?? 0) > 0 ? (
          <View style={{ gap: spacing.xs }}>
            <SectionHeader title="Submitted work" />
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              {submissions.data!.map((submission, index) => (
                <View key={submission.id}>
                  {index > 0 ? <Divider /> : null}
                  <View style={{ paddingVertical: spacing.lg, gap: spacing.xs }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Txt variant="captionStrong" tone="secondary">
                        Attempt {submission.attempt}
                      </Txt>
                      <Txt variant="caption" tone="tertiary">
                        {formatDateTime(submission.created_at)}
                      </Txt>
                    </Row>
                    <Txt variant="body">{submission.note}</Txt>
                    {submission.evidence.length > 0 ? (
                      <Txt variant="caption" tone="brand">
                        {submission.evidence.length} attachment(s)
                      </Txt>
                    ) : null}
                    {submission.review_note ? (
                      <View
                        style={{
                          marginTop: spacing.sm,
                          padding: spacing.md,
                          borderRadius: radius.md,
                          backgroundColor: colors.warningMuted,
                        }}
                      >
                        <Txt variant="captionStrong" tone="warning">
                          Changes requested
                        </Txt>
                        <Txt variant="caption" style={{ marginTop: 2 }}>
                          {submission.review_note}
                        </Txt>
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {error ? (
          <Card
            style={{ backgroundColor: colors.dangerMuted, borderColor: colors.danger }}
          >
            <Txt variant="caption" tone="danger">
              {error}
            </Txt>
          </Card>
        ) : null}

        {/* Actions */}
        <View style={{ gap: spacing.sm }}>
          {canFund ? (
            <>
              {insufficientFunds ? (
                <Card
                  style={{
                    backgroundColor: colors.warningMuted,
                    borderColor: colors.warning,
                  }}
                >
                  <Txt variant="caption" tone="warning">
                    You need {formatMoney(data.amount, data.currency)} available to
                    protect this milestone. Add money first.
                  </Txt>
                </Card>
              ) : null}
              <Button
                title={`Protect ${formatMoney(data.amount, data.currency)}`}
                loading={fund.isPending}
                disabled={Boolean(insufficientFunds)}
                onPress={() =>
                  run(
                    () => fund.mutateAsync(),
                    () => setCelebrating(true),
                  )
                }
              />
            </>
          ) : null}

          {canSubmit ? (
            <Button title="Submit work for review" onPress={() => setSheet('submit')} />
          ) : null}

          {canReview ? (
            <>
              <Button
                title={`Approve and release ${formatMoney(data.amount, data.currency)}`}
                loading={approve.isPending}
                onPress={() => run(() => approve.mutateAsync())}
              />
              <Button
                title="Request changes"
                variant="secondary"
                onPress={() => setSheet('changes')}
              />
            </>
          ) : null}

          {canCancel ? (
            <Button
              title="Request cancellation"
              variant="ghost"
              onPress={() => setSheet('cancel')}
            />
          ) : null}

          {canDispute ? (
            <Button
              title="Raise a dispute"
              variant="ghost"
              onPress={() => router.push(`/dispute/new?milestone=${id}`)}
            />
          ) : null}
        </View>
      </Screen>

      {/* Sheets */}
      <NoteSheet
        visible={sheet === 'submit'}
        title="Submit your work"
        body="Describe what you delivered. The client reviews this against the agreed completion criteria."
        placeholder="What did you deliver?"
        confirmLabel="Submit for review"
        note={note}
        setNote={setNote}
        loading={submit.isPending}
        onCancel={() => setSheet(null)}
        onConfirm={() =>
          run(() =>
            submit.mutateAsync({
              note,
              completion_percentage: 100,
              evidence: [],
            }),
          )
        }
      />

      <NoteSheet
        visible={sheet === 'changes'}
        title="Request changes"
        body="Say specifically what is missing. The receiver sees this against their submission."
        placeholder="What needs to change?"
        confirmLabel="Send request"
        note={note}
        setNote={setNote}
        loading={requestChanges.isPending}
        onCancel={() => setSheet(null)}
        onConfirm={() => run(() => requestChanges.mutateAsync({ note }))}
      />

      <NoteSheet
        visible={sheet === 'cancel'}
        title="Cancel protected payment?"
        body={`${formatMoney(data.amount, data.currency)} is currently protected. Cancelling needs the receiver's verification — they will be sent a code, and only they can enter it.`}
        placeholder="Why are you cancelling?"
        confirmLabel="Request cancellation"
        danger
        note={note}
        setNote={setNote}
        loading={cancel.isPending}
        onCancel={() => setSheet(null)}
        onConfirm={() =>
          run(async () => {
            const request = await cancel.mutateAsync({
              milestone_id: id,
              reason: note,
            });
            router.push(`/cancellation/${request.id}`);
          })
        }
      />

      {celebrating ? (
        <ProtectionCeremony
          amount={formatMoney(data.amount, data.currency)}
          onDone={() => setCelebrating(false)}
        />
      ) : null}
    </>
  );
}

function NoteSheet({
  visible,
  title,
  body,
  placeholder,
  confirmLabel,
  note,
  setNote,
  loading,
  onCancel,
  onConfirm,
  danger = false,
}: {
  visible: boolean;
  title: string;
  body: string;
  placeholder: string;
  confirmLabel: string;
  note: string;
  setNote: (value: string) => void;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  danger?: boolean;
}) {
  const { colors, spacing, radius, typography } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xxl,
            borderTopRightRadius: radius.xxl,
            padding: spacing.xl,
            paddingBottom: spacing.xxxl,
            gap: spacing.lg,
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: radius.full,
              backgroundColor: colors.borderStrong,
              alignSelf: 'center',
            }}
          />

          <View style={{ gap: spacing.xs }}>
            <Txt variant="h2" tone={danger ? 'danger' : 'primary'}>
              {title}
            </Txt>
            <Txt variant="body" tone="secondary">
              {body}
            </Txt>
          </View>

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={placeholder}
            placeholderTextColor={colors.textTertiary}
            multiline
            numberOfLines={4}
            style={{
              ...typography.body,
              minHeight: 104,
              borderWidth: 1.5,
              borderColor: colors.border,
              borderRadius: radius.md,
              padding: spacing.lg,
              color: colors.textPrimary,
              backgroundColor: colors.background,
              textAlignVertical: 'top',
            }}
          />

          <Row gap={spacing.sm}>
            <View style={{ flex: 1 }}>
              <Button title="Back" variant="secondary" onPress={onCancel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={confirmLabel}
                variant={danger ? 'danger' : 'primary'}
                loading={loading}
                disabled={note.trim().length < 3}
                onPress={onConfirm}
              />
            </View>
          </Row>
        </View>
      </View>
    </Modal>
  );
}
