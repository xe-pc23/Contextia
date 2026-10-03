import { useState } from 'react';
import { Button, Text, TextInput } from 'react-native';
import type { MobileState } from '../application/mobileController';
import { Card, Failure, RecommendationCards, styles } from './components';
import { formatTime } from './presentation';

export function RecommendationDetail({ state, retry, sendChat }: { state: MobileState; retry: () => void; sendChat: (message: string) => Promise<void> }) {
  const detail = state.detail;
  const [message, setMessage] = useState('');
  const sending = state.chat.status === 'loading';
  return <Card title="提案の詳細">
    {detail.status === 'loading' ? <Text style={styles.body}>取得しています…</Text> : null}
    {detail.status === 'error' ? <><Failure error={detail.error} /><Button title="再取得" onPress={retry} /></> : null}
    {detail.status === 'ready' ? <>
      <Text style={styles.note}>{formatTime(detail.data.createdAt, state.profile.data?.preferences.timezone)}</Text>
      <Text style={styles.body}>{detail.data.message}</Text>
      <RecommendationCards items={detail.data.recommendations} timezone={state.profile.data?.preferences.timezone} />
      <Text style={styles.body}>この提案について質問</Text>
      <TextInput accessibilityLabel="提案への質問" value={message} onChangeText={setMessage} multiline maxLength={1000} editable={!sending} style={styles.input} />
      <Button title={sending ? '送信中…' : '質問を送る'} disabled={sending || !message.trim()} onPress={() => void sendChat(message)} />
      {state.chat.status === 'error' ? <Failure error={state.chat.error} /> : null}
      {state.chat.status === 'ready' ? <>
        <Text style={styles.body}>{state.chat.data.reply}</Text>
        <RecommendationCards items={state.chat.data.recommendations} timezone={state.profile.data?.preferences.timezone} />
      </> : null}
    </> : null}
  </Card>;
}
