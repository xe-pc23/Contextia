import { Button, Text } from 'react-native';
import type { MobileState } from '../application/mobileController';
import { Card, Failure, RecommendationCards, styles } from './components';
import { formatTime } from './presentation';

export function RecommendationDetail({ state, retry }: { state: MobileState; retry: () => void }) {
  const detail = state.detail;
  return <Card title="提案の詳細">
    {detail.status === 'loading' ? <Text style={styles.body}>取得しています…</Text> : null}
    {detail.status === 'error' ? <><Failure error={detail.error} /><Button title="再取得" onPress={retry} /></> : null}
    {detail.status === 'ready' ? <>
      <Text style={styles.note}>{formatTime(detail.data.createdAt, state.profile.data?.preferences.timezone)}</Text>
      <Text style={styles.body}>{detail.data.message}</Text>
      <RecommendationCards items={detail.data.recommendations} timezone={state.profile.data?.preferences.timezone} />
    </> : null}
  </Card>;
}
