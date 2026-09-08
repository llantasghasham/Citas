import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import type { Dictionary } from '@citas/core';

import { requestCode, verifyCode } from '../api';
import { theme } from '../theme';

interface SignInScreenProps {
  dictionary: Dictionary;
  onSignedIn: (token: string) => void;
}

const inputStyle = {
  borderWidth: 1,
  borderColor: theme.rule,
  backgroundColor: '#ffffff',
  paddingHorizontal: 16,
  paddingVertical: 12,
  fontSize: 16,
  color: theme.ink,
} as const;

function Button({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={{ backgroundColor: theme.ink, paddingVertical: 14, opacity: busy ? 0.5 : 1 }}
    >
      {busy ? (
        <ActivityIndicator color={theme.background} />
      ) : (
        <Text style={{ color: theme.background, textAlign: 'center', fontSize: 16 }}>{label}</Text>
      )}
    </Pressable>
  );
}

/** The same one-time-code sign-in as the web. No passwords anywhere. */
export function SignInScreen({ dictionary, onSignedIn }: SignInScreenProps) {
  const copy = dictionary.admin.signIn;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      await requestCode(email);
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      const { token } = await verifyCode(email, code);
      onSignedIn(token);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
      <Text style={{ fontSize: 28, color: theme.ink }}>{copy.title}</Text>

      {failed ? <Text style={{ color: theme.danger }}>{copy.invalid}</Text> : null}

      {sent ? (
        <>
          <Text style={{ color: theme.muted }}>{copy.sent}</Text>
          <Text style={{ color: theme.ink }}>{copy.codeLabel}</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            style={inputStyle}
          />
          <Button label={copy.verify} onPress={() => void verify()} busy={busy} />
          <Pressable
            onPress={() => {
              setSent(false);
              setCode('');
            }}
          >
            <Text style={{ color: theme.muted, textAlign: 'center' }}>{copy.otherEmail}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={{ color: theme.ink }}>{copy.emailLabel}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            // An address is always left-to-right, whatever the interface does.
            style={{ ...inputStyle, writingDirection: 'ltr' }}
          />
          <Text style={{ color: theme.muted }}>{copy.emailHint}</Text>
          <Button label={copy.send} onPress={() => void send()} busy={busy} />
        </>
      )}
    </View>
  );
}
