import { useState } from 'react';
import { Button, Text, TextInput } from 'react-native';
import type { MobileState } from '../application/mobileController';
import { useMessages } from '../i18n/I18nContext';
import { Card, Failure, RecommendationCards, styles } from './components';
import { formatTime } from './presentation';

export function RecommendationDetail({ state, retry, sendChat }: { state: MobileState; retry: () => void; sendChat: (message: string) => Promise<void> }) {
  const t = useMessages();
  const detail = state.detail;
  const [message, setMessage] = useState('');
  const sending = state.chat.status === 'loading';
  return <Card title={t.detail.title}>
    {detail.status === 'loading' ? <Text style={styles.body}>{t.detail.loading}</Text> : null}
    {detail.status === 'error' ? <><Failure error={detail.error} /><Button title={t.detail.retry} onPress={retry} /></> : null}
    {detail.status === 'ready' ? <>
      <Text style={styles.note}>{formatTime(detail.data.createdAt, state.profile.data?.preferences.timezone, t)}</Text>
      <Text style={styles.body}>{detail.data.message}</Text>
      <RecommendationCards items={detail.data.recommendations} timezone={state.profile.data?.preferences.timezone} />
      <Text style={styles.body}>{t.detail.ask}</Text>
      <TextInput accessibilityLabel={t.detail.questionLabel} value={message} onChangeText={setMessage} multiline maxLength={1000} editable={!sending} style={styles.input} />
      <Button title={sending ? t.detail.sending : t.detail.send} disabled={sending || !message.trim()} onPress={() => void sendChat(message)} />
      {state.chat.status === 'error' ? <Failure error={state.chat.error} /> : null}
      {state.chat.status === 'ready' ? <>
        <Text style={styles.body}>{state.chat.data.reply}</Text>
        <RecommendationCards items={state.chat.data.recommendations} timezone={state.profile.data?.preferences.timezone} />
      </> : null}
    </> : null}
  </Card>;
}
