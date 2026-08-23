/**
 * The TrustPay assistant.
 *
 * Every answer comes from the backend, which assembles them from verified
 * database reads. The client never composes an answer itself, and the
 * disclaimer stays visible — an assistant that sounds authoritative about
 * someone's money needs to be honest about what it is.
 */

import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Row, Txt } from '@/components/ui';
import { AssistantCard } from '@/components/uiverse';
import { ApiError } from '@/lib/api';
import { useAssistant } from '@/lib/queries';
import { useTheme } from '@/theme';

type Message = { role: 'user' | 'assistant'; text: string; disclaimer?: string };

const SUGGESTIONS = [
  'Where is my payment?',
  'Why is my payment protected?',
  'What is my Trust Score?',
  'How do I cancel?',
];

export default function Assistant() {
  const router = useRouter();
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const ask = useAssistant();
  const scrollRef = useRef<ScrollView>(null);

  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Ask me about your balance, protected funds, milestones, Trust Score, cancellations or disputes.',
    },
  ]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((current) => [...current, { role: 'user', text: trimmed }]);
    setQuestion('');

    try {
      const reply = await ask.mutateAsync(trimmed);
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: reply.answer, disclaimer: reply.disclaimer },
      ]);
    } catch (caught) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text:
            caught instanceof ApiError
              ? caught.message
              : 'I could not reach TrustPay just now.',
        },
      ]);
    }
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={spacing.sm}>
            <Txt variant="h2">✦</Txt>
            <Txt variant="h2">Assistant</Txt>
          </Row>
          <Txt
            variant="body"
            tone="secondary"
            accessibilityRole="button"
            onPress={() => router.back()}
          >
            Close
          </Txt>
        </Row>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      >
        {messages.map((message, index) => (
          <Animated.View
            key={index}
            entering={FadeInDown.duration(220)}
            style={{
              alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '88%',
            }}
          >
            <View
              style={{
                backgroundColor:
                  message.role === 'user' ? colors.brand : colors.surface,
                borderWidth: message.role === 'user' ? 0 : 1,
                borderColor: colors.border,
                borderRadius: radius.lg,
                borderBottomRightRadius: message.role === 'user' ? 4 : radius.lg,
                borderBottomLeftRadius: message.role === 'user' ? radius.lg : 4,
                padding: spacing.lg,
              }}
            >
              <Txt
                variant="body"
                style={{
                  color:
                    message.role === 'user' ? colors.onBrand : colors.textPrimary,
                }}
              >
                {message.text}
              </Txt>
              {message.disclaimer ? (
                <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
                  {message.disclaimer}
                </Txt>
              ) : null}
            </View>
          </Animated.View>
        ))}

        {ask.isPending ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Card>
              <Txt variant="caption" tone="secondary">
                Checking your account…
              </Txt>
            </Card>
          </View>
        ) : null}

        {messages.length === 1 ? (
          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            {/* hot-liger-0 — the gradient card, tilt replaced by press */}
            <AssistantCard
              title="Ask about your money"
              body="Balances, protected funds, milestone status, your Trust Score, cancellations and disputes. Answers come from your account, never guesses."
            />
            {SUGGESTIONS.map((suggestion) => (
              <Pressable
                key={suggestion}
                onPress={() => send(suggestion)}
                accessibilityRole="button"
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.full,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  backgroundColor: colors.surface,
                  alignSelf: 'flex-start',
                }}
              >
                <Txt variant="caption" tone="brand">
                  {suggestion}
                </Txt>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View
        style={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Row gap={spacing.sm}>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="Ask about your account"
            placeholderTextColor={colors.textTertiary}
            onSubmitEditing={() => send(question)}
            returnKeyType="send"
            style={{
              ...typography.body,
              flex: 1,
              minHeight: 48,
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: spacing.lg,
              color: colors.textPrimary,
              backgroundColor: colors.background,
            }}
          />
          <Pressable
            onPress={() => send(question)}
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!question.trim()}
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.full,
              backgroundColor: question.trim() ? colors.brand : colors.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt
              variant="h3"
              style={{
                color: question.trim() ? colors.onBrand : colors.textTertiary,
              }}
            >
              ↑
            </Txt>
          </Pressable>
        </Row>
      </View>
    </KeyboardAvoidingView>
  );
}
