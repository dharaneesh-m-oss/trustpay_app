/**
 * Cancellation verification.
 *
 * This screen renders two entirely different things depending on who is
 * looking, and that difference is the product's central security guarantee:
 *
 *   the client  — sees only that the receiver has been notified, and waits.
 *   the receiver — sees the request, and can verify or decline it.
 *
 * The client is never shown a code entry field, because the server would refuse
 * them anyway. Showing it and then rejecting them would imply the rule is about
 * knowing the code rather than about who they are.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ErrorState, Loading, Row, Screen, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import {
  useCancellation,
  useDeclineCancellation,
  useVerifyCancellation,
} from '@/lib/queries';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

const OTP_LENGTH = 6;

export default function CancellationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuth((state) => state.user);

  const request = useCancellation(id);
  const verify = useVerifyCancellation(id);
  const decline = useDeclineCancellation(id);

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  if (request.isLoading) {
    return (
      <Screen>
        <Loading label="Loading request" />
      </Screen>
    );
  }

  if (request.isError || !request.data) {
    return (
      <Screen>
        <ErrorState
          message={request.error?.message ?? 'Something went wrong.'}
          onRetry={() => request.refetch()}
        />
      </Screen>
    );
  }

  const data = request.data;
  const isVerifier = user?.id === data.counterparty_id;
  const isPending = data.status === 'AWAITING_RECEIVER';

  const submit = async () => {
    setError(null);
    try {
      await verify.mutateAsync(code);
      router.replace(`/milestone/${data.milestone_id}`);
    } catch (caught) {
      setCode('');
      setError(
        caught instanceof ApiError ? caught.message : 'That did not go through.',
      );
    }
  };

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md }}>
      <Txt
        variant="body"
        tone="secondary"
        accessibilityRole="button"
        onPress={() => router.back()}
      >
        ‹ Back
      </Txt>

      {/* Resolved states */}
      {!isPending ? (
        <Card>
          <Txt variant="h2">
            {data.status === 'CONFIRMED'
              ? 'Cancellation confirmed'
              : data.status === 'DECLINED'
                ? 'Cancellation declined'
                : 'Request closed'}
          </Txt>
          <Txt variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
            {data.status === 'CONFIRMED'
              ? 'The protected funds were returned to the client.'
              : data.status === 'DECLINED'
                ? `The receiver declined. The funds remain protected.${
                    data.decline_reason ? ` “${data.decline_reason}”` : ''
                  }`
                : 'This request is no longer open.'}
          </Txt>
        </Card>
      ) : isVerifier ? (
        /* ---------------- receiver: verify or decline ---------------- */
        <>
          <View style={{ gap: spacing.xs }}>
            <Txt variant="h1">Verify cancellation</Txt>
            <Txt variant="body" tone="secondary">
              The client asked to cancel this milestone. Nothing happens to the
              protected funds unless you confirm it.
            </Txt>
          </View>

          <Card>
            <Txt variant="overline" tone="secondary">
              Their reason
            </Txt>
            <Txt variant="body" style={{ marginTop: spacing.xs }}>
              {data.reason}
            </Txt>
          </Card>

          <Card>
            <Txt variant="captionStrong" tone="secondary">
              Enter the code sent to {data.code_sent_to ?? 'your registered contact'}
            </Txt>

            <View style={{ marginTop: spacing.lg }}>
              {/* One real input behind six boxes — the standard trick, because
                  six separate inputs fight autofill and backspace. */}
              <TextInput
                ref={inputRef}
                value={code}
                onChangeText={(next) =>
                  setCode(next.replace(/\D/g, '').slice(0, OTP_LENGTH))
                }
                keyboardType="number-pad"
                maxLength={OTP_LENGTH}
                autoFocus
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                accessibilityLabel="Verification code"
                style={{
                  position: 'absolute',
                  opacity: 0,
                  width: '100%',
                  height: 56,
                }}
              />
              <Row gap={spacing.sm} style={{ justifyContent: 'space-between' }}>
                {Array.from({ length: OTP_LENGTH }).map((_, index) => {
                  const filled = index < code.length;
                  const active = index === code.length;
                  return (
                    <View
                      key={index}
                      onTouchEnd={() => inputRef.current?.focus()}
                      style={{
                        flex: 1,
                        height: 56,
                        borderRadius: radius.md,
                        borderWidth: 1.5,
                        borderColor: active
                          ? colors.brand
                          : filled
                            ? colors.borderStrong
                            : colors.border,
                        backgroundColor: colors.background,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Txt variant="h2">{code[index] ?? ''}</Txt>
                    </View>
                  );
                })}
              </Row>
            </View>

            {error ? (
              <Txt variant="caption" tone="danger" style={{ marginTop: spacing.md }}>
                {error}
              </Txt>
            ) : (
              <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.md }}>
                The code expires in 10 minutes and can be used once.
              </Txt>
            )}
          </Card>

          <View style={{ gap: spacing.sm }}>
            <Button
              title="Verify and cancel"
              variant="danger"
              loading={verify.isPending}
              disabled={code.length !== OTP_LENGTH}
              onPress={submit}
            />
            <Button
              title="Decline — keep the milestone"
              variant="secondary"
              loading={decline.isPending}
              onPress={async () => {
                setError(null);
                try {
                  await decline.mutateAsync('Work is already underway.');
                } catch (caught) {
                  setError(
                    caught instanceof ApiError ? caught.message : 'That did not work.',
                  );
                }
              }}
            />
          </View>
        </>
      ) : (
        /* ---------------- client: wait ---------------- */
        <>
          <View style={{ gap: spacing.xs }}>
            <Txt variant="h1">Waiting for the receiver</Txt>
            <Txt variant="body" tone="secondary">
              They have been notified and sent a verification code. The funds stay
              protected until they respond.
            </Txt>
          </View>

          <Card
            style={{ backgroundColor: colors.infoMuted, borderColor: colors.info }}
          >
            <Txt variant="captionStrong" tone="secondary">
              Why you cannot complete this yourself
            </Txt>
            <Txt variant="caption" style={{ marginTop: spacing.xs }}>
              A cancellation that the sender could approve alone would let anyone
              pull back money after work had started. Only the receiver can confirm
              it — the code goes to them, and only they can enter it.
            </Txt>
          </Card>

          <Card>
            <Txt variant="overline" tone="secondary">
              Your reason
            </Txt>
            <Txt variant="body" style={{ marginTop: spacing.xs }}>
              {data.reason}
            </Txt>
          </Card>

          <Button
            title="Back to milestone"
            variant="secondary"
            onPress={() => router.replace(`/milestone/${data.milestone_id}`)}
          />
        </>
      )}
    </Screen>
  );
}
