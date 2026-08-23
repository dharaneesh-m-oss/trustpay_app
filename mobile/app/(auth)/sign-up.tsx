import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';

import { LogoMark } from '@/components/Logo';
import { Field, Row, Txt } from '@/components/ui';
import { GradientButton } from '@/components/uiverse';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { gradients, useTheme } from '@/theme';

export default function SignUp() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const register = useAuth((state) => state.register);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      await register({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() || undefined,
      });
      router.replace('/(tabs)/home');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fieldErrors);
        // A field-level error is already shown against the field; repeating it
        // at the top would be shouting.
        setError(Object.keys(caught.fieldErrors).length ? null : caught.message);
      } else {
        setError('We could not create your account. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

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
        <LinearGradient
          colors={gradients.project as unknown as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingTop: insets.top + spacing.xxl,
            paddingHorizontal: spacing.xl,
            paddingBottom: spacing.huge + spacing.xl,
            borderBottomLeftRadius: 40,
            borderBottomRightRadius: 40,
          }}
        >
          <Row gap={spacing.sm}>
            <LogoMark size={26} color="#00894D" accent="rgba(0,137,77,0.6)" />
            <Txt variant="h3" style={{ color: '#00894D' }}>
              TrustPay
            </Txt>
          </Row>
          <Txt
            variant="display"
            style={{ fontSize: 30, color: '#00894D', marginTop: spacing.xl }}
          >
            Create your account
          </Txt>
          <Txt
            variant="body"
            style={{ color: 'rgba(0,137,77,0.8)', marginTop: spacing.xs }}
          >
            A wallet is opened for you automatically.
          </Txt>
        </LinearGradient>

        <View
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
          <Field
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your name"
            autoComplete="name"
            error={fieldErrors.full_name}
          />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            error={fieldErrors.email}
          />
          <Field
            label="Phone (optional)"
            value={phone}
            onChangeText={setPhone}
            placeholder="+91 98765 43210"
            keyboardType="phone-pad"
            error={fieldErrors.phone}
            hint="Needed later to receive cancellation verification codes."
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 10 characters"
            secureTextEntry
            autoComplete="new-password"
            error={fieldErrors.password}
            hint="Use letters and numbers, at least 10 characters."
          />

          {error ? (
            <View
              style={{
                backgroundColor: colors.dangerMuted,
                padding: spacing.md,
                borderRadius: 12,
              }}
            >
              <Txt variant="caption" tone="danger">
                {error}
              </Txt>
            </View>
          ) : null}

          <GradientButton
            title="Create account"
            subtitle="Join TrustPay"
            onPress={submit}
            loading={busy}
            disabled={!fullName || !email || password.length < 10}
          />
        </View>

        <Row style={{ justifyContent: 'center', marginTop: spacing.xxl }} gap={spacing.xs}>
          <Txt variant="caption" tone="secondary">
            Already have an account?
          </Txt>
          <Txt
            variant="captionStrong"
            tone="brand"
            onPress={() => router.push('/(auth)/sign-in')}
            accessibilityRole="button"
          >
            Sign in
          </Txt>
        </Row>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
