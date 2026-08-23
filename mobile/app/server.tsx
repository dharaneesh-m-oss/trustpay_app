/**
 * Server settings.
 *
 * Reachable without signing in, because the address being wrong is precisely
 * what stops you signing in. The screen tests before it saves: an address that
 * has not answered is not worth storing, and "Saved" on a dead address is a
 * lie that costs someone twenty minutes.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Badge,
  Button,
  Card,
  Field,
  Row,
  Screen,
  SectionHeader,
  Txt,
} from '@/components/ui';
import { getBaseUrl, persistBaseUrl, setBaseUrl } from '@/lib/api';
import {
  clearSavedServerUrl,
  defaultServerUrl,
  normaliseServerUrl,
  probeServer,
  type ProbeResult,
} from '@/lib/server-config';
import { useTheme } from '@/theme';

export default function ServerSettings() {
  const router = useRouter();
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const [input, setInput] = React.useState(getBaseUrl());
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<ProbeResult | null>(null);
  const [saved, setSaved] = React.useState(false);

  const resolved = normaliseServerUrl(input);

  const test = async (): Promise<ProbeResult | null> => {
    if (!resolved) {
      setResult({ ok: false, reason: 'That does not look like an address.' });
      return null;
    }
    setTesting(true);
    setSaved(false);
    const outcome = await probeServer(resolved);
    setResult(outcome);
    setTesting(false);
    return outcome;
  };

  const testAndSave = async () => {
    const outcome = await test();
    if (!outcome?.ok || !resolved) return;
    await persistBaseUrl(resolved);
    setSaved(true);
  };

  const reset = async () => {
    await clearSavedServerUrl();
    const fallback = defaultServerUrl();
    setBaseUrl(fallback);
    setInput(fallback);
    setResult(null);
    setSaved(false);
  };

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt
          variant="body"
          tone="secondary"
          accessibilityRole="button"
          onPress={() => router.back()}
        >
          ‹ Back
        </Txt>
        <Txt variant="overline" tone="secondary">
          Server settings
        </Txt>
      </Row>

      <SectionHeader title="Where is the backend?" />

      <Card>
        <Field
          label="Address"
          value={input}
          onChangeText={setInput}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="10.0.0.5"
          hint={
            resolved && resolved !== input.trim()
              ? `Will connect to ${resolved}`
              : 'Just the IP is enough — the port and path are filled in for you.'
          }
        />

        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          <Button
            title={testing ? 'Testing…' : 'Test and save'}
            loading={testing}
            disabled={!resolved}
            onPress={testAndSave}
          />
          <Button
            title="Test only"
            variant="secondary"
            loading={testing}
            disabled={!resolved}
            onPress={test}
          />
        </View>
      </Card>

      {result ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong">
              {result.ok ? 'Reached the server' : 'No luck'}
            </Txt>
            <Badge
              label={result.ok ? 'Connected' : 'Failed'}
              tone={result.ok ? 'success' : 'danger'}
            />
          </Row>
          <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
            {result.ok
              ? `Database ${result.database}, ${result.environment} environment.` +
                (saved ? ' Saved — you can go back and sign in.' : '')
              : result.reason}
          </Txt>
        </Card>
      ) : null}

      <Card>
        <Txt variant="captionStrong" tone="secondary">
          If it will not connect
        </Txt>
        <Txt variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
          The phone and the computer running the backend must be on the same
          Wi-Fi. The address is the computer's, and it changes when it rejoins a
          network — on Windows, `ipconfig` shows it. The backend must be started
          with `--host 0.0.0.0`, and Windows Firewall has to allow port 8000 in.
        </Txt>
      </Card>

      <Button title="Reset to this build's default" variant="ghost" onPress={reset} />
    </Screen>
  );
}
