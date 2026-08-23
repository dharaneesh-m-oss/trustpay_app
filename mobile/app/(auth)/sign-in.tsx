/**
 * Sign in.
 *
 * Built around the gradient login button (SmookyDev/sharp-stingray-58), which
 * carries two labels — the original swapped them on hover; here the small one
 * sits above the action, since a phone has no hover to swap on.
 *
 * The layout is a gradient hero with the form on a card that overlaps it. That
 * overlap is what stops the screen reading as a generic centred form.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogoMark } from '@/components/Logo';
import { Button, Row, Txt } from '@/components/ui';
import { GradientButton } from '@/components/uiverse';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { available as googleAvailable, errorFrom, idTokenFrom, useGoogleAuth } from '@/lib/google';
import { getMode } from '@/lib/api';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/local/engine';
import { gradients, glow, useTheme } from '@/theme';

export default function SignIn() {
  const router = useRouter();
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const signIn = useAuth((state) => state.signIn);
  const signInWithGoogle = useAuth((state) => state.signInWithGoogle);
  const google = useGoogleAuth();
  // Google sign-in needs the real server to verify the token, so it is only
  // offered in live mode - in demo there is nothing to verify against.
  const canUseGoogle = googleAvailable() && getMode() === 'live';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [focused, setFocused] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = async (withEmail: string, withPassword: string) => {
    setError(null);
    setBusy(true);
    try {
      await signIn(withEmail.trim(), withPassword);
      router.replace('/(tabs)/home');
    } catch (caught) {
      // One message covers a wrong password and an unknown address alike, on
      // purpose. Showing it verbatim keeps that property.
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'We could not sign you in. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  // The Google response arrives asynchronously, after the browser returns.
  React.useEffect(() => {
    const token = idTokenFrom(google.response);
    if (token) {
      setBusy(true);
      signInWithGoogle(token)
        .then(() => router.replace('/(tabs)/home'))
        .catch((caught) =>
          setError(
            caught instanceof ApiError
              ? caught.message
              : 'Google sign-in could not be completed.',
          ),
        )
        .finally(() => setBusy(false));
      return;
    }
    const failure = errorFrom(google.response);
    if (failure) setError(failure);
  }, [google.response, signInWithGoogle, router]);

  const submit = () => {
    if (!email || !password) return;
    return enter(email, password);
  };

  const field = (
    label: string,
    value: string,
    onChange: (text: string) => void,
    options: Partial<React.ComponentProps<typeof TextInput>> & { key: string },
  ) => (
    <View style={{ gap: spacing.xs }}>
      <Txt variant="overline" tone="secondary">
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={colors.textTertiary}
        onFocus={() => setFocused(options.key)}
        onBlur={() => setFocused(null)}
        style={{
          ...typography.body,
          minHeight: 54,
          borderRadius: radius.lg,
          borderWidth: 2,
          borderColor: focused === options.key ? colors.brand : colors.border,
          backgroundColor: colors.surface,
          color: colors.textPrimary,
          paddingHorizontal: spacing.lg,
          ...(focused === options.key ? glow(colors.brand, 0.22, 12) : null),
        }}
        {...options}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: spacing.huge }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <LinearGradient
          colors={gradients.wallet as unknown as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingTop: insets.top + spacing.xxl,
            paddingHorizontal: spacing.xl,
            paddingBottom: spacing.huge + spacing.xxl,
            borderBottomLeftRadius: 40,
            borderBottomRightRadius: 40,
          }}
        >
          <Animated.View entering={FadeInDown.duration(400)}>
            <Row gap={spacing.sm}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.lg,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <LogoMark size={26} color="#FFFFFF" accent="rgba(255,255,255,0.7)" />
              </View>
              <Txt variant="h2" style={{ color: '#FFFFFF', letterSpacing: 1 }}>
                TrustPay
              </Txt>
            </Row>

            <Txt
              variant="display"
              style={{ color: '#FFFFFF', marginTop: spacing.xxl, fontSize: 32 }}
            >
              Welcome back.
            </Txt>
            <Txt
              variant="body"
              style={{ color: 'rgba(255,255,255,0.78)', marginTop: spacing.xs }}
            >
              Sign in to see your projects and protected funds.
            </Txt>
          </Animated.View>
        </LinearGradient>

        {/* Form card, overlapping the hero */}
        <Animated.View
          entering={FadeInUp.delay(120).duration(420)}
          style={{
            marginTop: -spacing.huge,
            marginHorizontal: spacing.lg,
            backgroundColor: colors.surface,
            borderRadius: radius.xxl,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.xl,
            gap: spacing.lg,
            shadowColor: '#15171D',
            shadowOpacity: 0.12,
            shadowRadius: 26,
            shadowOffset: { width: 0, height: 12 },
            elevation: 8,
          }}
        >
          {field('Email', email, setEmail, {
            key: 'email',
            placeholder: 'you@example.com',
            autoCapitalize: 'none',
            autoComplete: 'email',
            keyboardType: 'email-address',
            textContentType: 'emailAddress',
          })}

          {field('Password', password, setPassword, {
            key: 'password',
            placeholder: 'Your password',
            secureTextEntry: true,
            autoComplete: 'current-password',
            textContentType: 'password',
            returnKeyType: 'go',
            onSubmitEditing: submit,
          })}

          {error ? (
            <View
              style={{
                backgroundColor: colors.dangerMuted,
                borderRadius: radius.md,
                borderLeftWidth: 3,
                borderLeftColor: colors.danger,
                padding: spacing.md,
              }}
            >
              <Txt variant="caption" tone="danger">
                {error}
              </Txt>
            </View>
          ) : null}

          {/* The login button */}
          <GradientButton
            title="Sign in"
            subtitle="Welcome back"
            onPress={submit}
            loading={busy}
            disabled={!email || !password}
          />

          {canUseGoogle ? (
            <>
              <Row
                gap={spacing.md}
                style={{ alignItems: 'center', marginTop: spacing.xl }}
              >
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                <Txt variant="caption" tone="tertiary">
                  or
                </Txt>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              </Row>

              <Button
                title="Continue with Google"
                variant="secondary"
                disabled={!google.request || busy}
                onPress={() => {
                  setError(null);
                  google.promptAsync();
                }}
                style={{ marginTop: spacing.lg }}
              />
            </>
          ) : null}

          <Txt
            variant="captionStrong"
            tone="brand"
            accessibilityRole="button"
            style={{ textAlign: 'center', marginTop: spacing.lg }}
            onPress={() => enter(DEMO_EMAIL, DEMO_PASSWORD)}
          >
            Open the demo account
          </Txt>
          <Txt
            variant="caption"
            tone="tertiary"
            style={{ textAlign: 'center', marginTop: spacing.xs }}
          >
            Comes with a sample project already part-finished.
          </Txt>
        </Animated.View>

        <Row style={{ justifyContent: 'center', marginTop: spacing.xxl }} gap={spacing.xs}>
          <Txt variant="caption" tone="secondary">
            New to TrustPay?
          </Txt>
          <Txt
            variant="captionStrong"
            tone="brand"
            accessibilityRole="button"
            onPress={() => router.push('/(auth)/sign-up')}
          >
            Create an account
          </Txt>
        </Row>

        <Txt
          variant="caption"
          tone="tertiary"
          style={{ textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.xxl }}
        >
          TrustPay is not a bank. Funds shown in demo mode are simulated.
        </Txt>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
