import { useEffect, useState } from 'react';
import { Button, Text } from 'react-native';
import type { BackendClient } from '../api/backendClient';
import type { CognitoConfiguration } from '../auth/cognitoConfig';
import { backgroundEnabled, disableBackground, enableBackground } from '../background/control';
import { Card, styles } from './components';

export function BackgroundControl({ config, client, getSessionSignal }: { config: CognitoConfiguration; client: BackendClient; getSessionSignal: () => AbortSignal }) {
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
        if (!started) setMessage('開始できませんでした。通知設定、位置情報の「常に許可」、認証を確認してください。');
      }
    } catch { setMessage('端末の設定を確認できませんでした。もう一度お試しください。'); }
    finally { setBusy(false); }
  };
  return <Card title="バックグラウンドの提案">
    <Text style={styles.body}>{enabled ? '有効' : '無効'}</Text>
    <Text style={styles.note}>許可すると、OS が位置の変化を知らせた時に提案を確認します。実行間隔は端末により異なります。認証が期限切れの時はアプリを開いてください。</Text>
    <Button title={busy ? '設定中…' : enabled ? 'バックグラウンドを停止' : 'バックグラウンドを有効にする'} disabled={busy} onPress={() => void toggle()} />
    {message ? <Text style={styles.error}>{message}</Text> : null}
  </Card>;
}
