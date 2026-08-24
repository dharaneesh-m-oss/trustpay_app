/**
 * Sign in.
 *
 * Same surface as the rest of the app: pale ground, one white card, graphite
 * text. The old full-bleed indigo hero was a second design language living on
 * the first screen anyone sees, which made this feel like two different apps
 * stitched together.
 *
 * The gradient survives in exactly one place — the sign-in button itself
 * (SmookyDev/sharp-stingray-58), which keeps its two labels; the original
 * swapped them on hover, and a phone has no hover to swap on. On a page this
 * quiet, one saturated element reads as *the* action, which is what that button
 * is.
 */

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogoMark } from '@/components/Logo';
import { Chip, SoftCard } from '@/components/soft';
import { Button, Row, Txt } from '@/components/ui';
import { GradientButton } from '@/components/uiverse';
import { ApiError, getMode } from '@/lib/api';
import {
  available as googleAvailable,
  errorFrom,
  idTokenFrom,
  useGoogleAuth,
} from '@/lib/google';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/local/engine';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function SignIn() {
  const router = useRouter();
  const { colors, spacing, radius, typography, elevation } = useTheme();
  const insets = useSafeAreaInsets();

  const signIn = useAuth((state) => state.signIn);
  const signInWithGoogle = useAuth((state) => state.signInWithGoogle);
  const google = useGoogleAuth();

  // Google sign-in needs the real server to verify the token, so it is only
  // offered in live mode — in demo there is nothing to verify against.
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
      <Txt variant="caption" tone="tertiary">
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
          borderWidth: 1.5,
          borderColor: focused === options.key ? colors.brand : colors.border,
          backgroundColor: colors.surfaceMuted,
          color: colors.textPrimary,
          paddingHorizontal: spacing.lg,
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
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + spacing.xxxl,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.huge,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ---------------------------------------------------------- mark */}
        <Animated.View
          entering={FadeInDown.duration(360)}
          style={{ alignItems: 'center', gap: spacing.lg }}
        >
          <View
            style={[
              {
                width: 68,
                height: 68,
                borderRadius: 24,
                backgroundColor: colors.brand,
                alignItems: 'center',
                justifyContent: 'center',
              },
              elevation.md,
            ]}
          >
            <LogoMark size={34} color="#FFFFFF" accent="rgba(255,255,255,0.6)" />
          </View>

          <View style={{ alignItems: 'center', gap: spacing.xs }}>
            <Txt variant="h1">Welcome back</Txt>
            <Txt
              variant="caption"
              tone="secondary"
              style={{ textAlign: 'center', maxWidth: 280 }}
            >
              Sign in to see your projects and protected funds.
            </Txt>
          </View>

          <Txt accessibilityRole="button" onPress={() => router.push('/connect')}>
            <Chip
              label={getMode() === 'live' ? 'connected · tap to change' : 'on this device · tap to connect'}
            />
          </Txt>
        </Animated.View>

        {/* ---------------------------------------------------------- form */}
        <Animated.View
          entering={FadeInDown.delay(90).duration(400)}
          style={{ marginTop: spacing.xxxl }}
        >
          <SoftCard>
            <View style={{ gap: spacing.lg }}>
              {field('Email', email, setEmail, {
                key: 'email',
                placeholder: 'you@example.com',
                autoCapitalize: 'none',
                autoComplete: 'email',
                keyboardType: 'email-address',
                autoCorrect: false,
              })}

              {field('Password', password, setPassword, {
                key: 'password',
                placeholder: '••••••••',
                secureTextEntry: true,
                autoCapitalize: 'none',
                autoComplete: 'password',
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

              <GradientButton
                title="Sign in"
                subtitle="Welcome back"
                onPress={submit}
                loading={busy}
                disabled={!email || !password}
              />

              {canUseGoogle ? (
                <>
                  <Row gap={spacing.md} style={{ alignItems: 'center' }}>
                    <View
                      style={{ flex: 1, height: 1, backgroundColor: colors.border }}
                    />
                    <Txt variant="caption" tone="tertiary">
                      or
                    </Txt>
                    <View
                      style={{ flex: 1, height: 1, backgroundColor: colors.border }}
                    />
                  </Row>

                  <Button
                    title="Continue with Google"
                    variant="secondary"
                    disabled={!google.request || busy}
                    onPress={() => {
                      setError(null);
                      google.promptAsync();
                    }}
                  />
                </>
              ) : null}
            </View>
          </SoftCard>
        </Animated.View>

        {/* -------------------------------------------------------- footer */}
        <Animated.View
          entering={FadeInDown.delay(180).duration(400)}
          style={{ marginTop: spacing.xxl, gap: spacing.lg }}
        >
          <Row style={{ justifyContent: 'center' }} gap={spacing.xs}>
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

          <SoftCard depth="sm" onPress={() => enter(DEMO_EMAIL, DEMO_PASSWORD)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Txt variant="bodyStrong">Open the demo account</Txt>
                <Txt variant="caption" tone="secondary">
                  A sample project, already part-finished.
                </Txt>
              </View>
              <Txt variant="body" tone="secondary">
                →
              </Txt>
            </Row>
          </SoftCard>

          <Txt
            variant="caption"
            tone="tertiary"
            style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}
          >
            TrustPay is not a bank. Funds shown in demo mode are simulated.
          </Txt>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
