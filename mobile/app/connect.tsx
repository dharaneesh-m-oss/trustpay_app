/**
 * Point the app at a deployed TrustPay server.
 *
 * Reachable while signed out, because being pointed at nothing is precisely
 * what stops you signing in. The auth guard treats it as public for the same
 * reason.
 *
 * The screen tests before it saves. An address that has not answered is not
 * worth storing, and "Connected" over a dead URL is a lie that costs twenty
 * minutes to unpick. The check also refuses a server whose database is down —
 * that one returns HTTP 200 and would otherwise look healthy right up until
 * sign-in fails.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, ScreenHeader, SoftCard, SoftSection } from '@/components/soft';
import { Button, Field, Row, Screen, Txt } from '@/components/ui';
import { connectToServer, getMode, switchMode } from '@/lib/api';
import {
  BUILT_IN_API_URL,
  normaliseServerUrl,
  probeServer,
  serverUrl,
  type ProbeResult,
} from '@/lib/mode';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function Connect() {
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const signOut = useAuth((state) => state.signOut);

  const [input, setInput] = React.useState(serverUrl() || BUILT_IN_API_URL);
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<ProbeResult | null>(null);
  const [connected, setConnected] = React.useState(false);

  const resolved = normaliseServerUrl(input);
  const mode = getMode();

  const test = async (): Promise<ProbeResult | null> => {
    if (!resolved) {
      setResult({ ok: false, reason: 'That does not look like an address.' });
      return null;
    }
    setTesting(true);
    setConnected(false);
    const outcome = await probeServer(resolved);
    setResult(outcome);
    setTesting(false);
    return outcome;
  };

  const connect = async () => {
    const outcome = await test();
    if (!outcome?.ok || !resolved) return;

    // Any session held here belongs to the on-device demo and means nothing to
    // a real server, so it goes before the switch rather than lingering as a
    // token the server will reject.
    await signOut().catch(() => undefined);
    await connectToServer(resolved);
    setConnected(true);
  };

  const backToDemo = async () => {
    await signOut().catch(() => undefined);
    await switchMode('demo');
    router.replace('/(auth)/sign-in');
  };

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md, gap: spacing.xl }}>
      <ScreenHeader
        title="connect_server"
        onBack={() => router.back()}
        right={<Chip label={mode} tone={mode === 'live' ? 'success' : 'neutral'} />}
      />

      <SoftCard>
        <Txt variant="h3">
          {mode === 'live' ? 'Connected to a server' : 'Running on this device'}
        </Txt>
        <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
          {mode === 'live'
            ? 'Accounts, projects and money live on the server. Google sign-in and UPI work here.'
            : 'Everything is stored on this phone. Nothing is shared with anyone, and Google sign-in and UPI are unavailable because there is no server to verify against.'}
        </Txt>
      </SoftCard>

      <View>
        <SoftSection title="server address" />
        <SoftCard>
          <Field
            label="Address"
            value={input}
            onChangeText={setInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="trustpay-api.onrender.com"
            hint={
              resolved && resolved !== input.trim()
                ? `Will connect to ${resolved}`
                : 'The host is enough — https and the path are filled in for you.'
            }
          />

          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <Button
              title={testing ? 'Checking…' : 'Connect'}
              loading={testing}
              disabled={!resolved || testing}
              onPress={connect}
            />
            <Button
              title="Test only"
              variant="secondary"
              loading={testing}
              disabled={!resolved || testing}
              onPress={test}
            />
          </View>

          {testing ? (
            <Txt variant="caption" tone="tertiary" style={{ marginTop: spacing.md }}>
              A free host that has gone to sleep can take up to a minute to answer
              its first request. This waits.
            </Txt>
          ) : null}
        </SoftCard>
      </View>

      {result ? (
        <SoftCard>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong">
              {result.ok ? 'Reached the server' : 'No luck'}
            </Txt>
            <Chip
              label={result.ok ? 'connected' : 'failed'}
              tone={result.ok ? 'success' : 'danger'}
            />
          </Row>
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
            {result.ok
              ? `Database ${result.database}, ${result.environment} environment.`
              : result.reason}
          </Txt>

          {connected ? (
            <View style={{ marginTop: spacing.lg }}>
              <Txt variant="caption" tone="secondary" style={{ marginBottom: spacing.md }}>
                You are now on the server. Create an account or sign in — the
                demo account does not exist there.
              </Txt>
              <Button
                title="Go to sign in"
                onPress={() => router.replace('/(auth)/sign-in')}
              />
            </View>
          ) : null}
        </SoftCard>
      ) : null}

      {mode === 'live' ? (
        <Button title="Go back to on-device mode" variant="ghost" onPress={backToDemo} />
      ) : null}

      <SoftCard>
        <Txt variant="captionStrong" tone="secondary">
          If it will not connect
        </Txt>
        <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
          Open the address in a browser with /health on the end. You want
          {' '}status healthy and database up. A free host sleeps after inactivity,
          so the first request may time out once and succeed on the second.
        </Txt>
      </SoftCard>
    </Screen>
  );
}
