import { useEffect, useState } from 'react';
import { Button, Text } from 'react-native';
import type { BackendClient } from '../api/backendClient';
import type { CognitoConfiguration } from '../auth/cognitoConfig';
import { backgroundEnabled, disableBackground, enableBackground } from '../background/control';
import { useMessages } from '../i18n/I18nContext';
import { Card, styles } from './components';

export function BackgroundControl({ config, client, getSessionSignal }: { config: CognitoConfiguration; client: BackendClient; getSessionSignal: () => AbortSignal }) {
  const t = useMessages();
  const b = t.background;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void backgroundEnabled(config).then(value => { if (active) setEnabled(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [config]);
  const toggle = async () => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      if (enabled) { await disableBackground(config); setEnabled(false); }
      else {
        const started = await enableBackground(config, client, getSessionSignal()); setEnabled(started);
        if (!started) setMessage(b.startFailed);
      }
    } catch { setMessage(b.checkFailed); }
    finally { setBusy(false); }
  };
  return <Card title={b.title}>
    <Text style={styles.body}>{enabled ? b.enabled : b.disabled}</Text>
    <Text style={styles.note}>{b.note}</Text>
    <Button title={busy ? b.configuring : enabled ? b.stop : b.start} disabled={busy} onPress={() => void toggle()} />
    {message ? <Text style={styles.error}>{message}</Text> : null}
  </Card>;
}
