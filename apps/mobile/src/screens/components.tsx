import { useState, type ReactNode } from 'react';
import { Button, Linking, StyleSheet, Text, View } from 'react-native';
import type { ApiRecommendationItem, ProviderStatusMap, ProviderStatusValue } from '@contextia/contracts';
import type { MobileFailure } from '../application/mobileController';
import type { ContextCollectionResult, NativeReadStatus } from '../context/types';
import { failureMessage, formatTime } from './presentation';

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f7f8' },
  content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40, gap: 16 },
  brand: { color: '#152b3a', fontSize: 28, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderColor: '#dce5e9', borderWidth: 1, borderRadius: 16, padding: 18, gap: 10 },
  heading: { color: '#152b3a', fontSize: 19, fontWeight: '600' },
  body: { color: '#405663', fontSize: 15, lineHeight: 24 },
  note: { color: '#5c707b', fontSize: 13, lineHeight: 20 },
  error: { color: '#9d2732', fontSize: 14, lineHeight: 22 },
  success: { color: '#1c563b', fontSize: 14, lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  item: { borderTopColor: '#dce5e9', borderTopWidth: 1, paddingTop: 12, gap: 8 },
  input: { borderColor: '#b9cbd4', borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, color: '#152b3a', backgroundColor: '#fff' }
});

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.card}><Text accessibilityRole="header" style={styles.heading}>{title}</Text>{children}</View>;
}
export function Failure({ error }: { error: MobileFailure }) {
  return <View accessibilityLiveRegion="polite">
    <Text style={styles.error}>{failureMessage(error)}</Text>
    {error.kind === 'http-error' && error.requestId && /^[A-Za-z0-9_-]{1,128}$/.test(error.requestId)
      ? <Text style={styles.note}>問い合わせ ID: {error.requestId}</Text> : null}
  </View>;
}
export function permissionLabel(status: NativeReadStatus): string {
  return status === 'granted' ? '取得済み' : status === 'denied' ? '許可なし' : '未取得';
}
export function CollectionSummary({ collection, timezone }: { collection: ContextCollectionResult | null; timezone: string | undefined }) {
  if (!collection) return <Text style={styles.note}>端末の情報はまだ読み取っていません。</Text>;
  if (collection.status !== 'ready') return <>
    <Text style={styles.error}>{collection.status === 'location-unavailable' ? '現在地を取得できませんでした。' : '取得した情報を確認できませんでした。'}</Text>
    <Text style={styles.note}>予定: {permissionLabel(collection.calendar)} / 歩数: {permissionLabel(collection.steps)}</Text>
  </>;
  const { input, permissions } = collection;
  return <>
    <Text style={styles.body}>現在地: {input.location.latitude.toFixed(5)}, {input.location.longitude.toFixed(5)}</Text>
    <Text style={styles.note}>取得時刻: {formatTime(input.location.capturedAt, timezone)}</Text>
    <Text style={styles.body}>予定: {input.calendar.length} 件 / {permissionLabel(permissions.calendar)}</Text>
    <Text style={styles.body}>今日の歩数: {input.activity?.stepsToday === null || input.activity?.stepsToday === undefined ? '未取得' : `${input.activity.stepsToday.toLocaleString('ja-JP')} 歩`}</Text>
    {input.activity?.stepGoal ? <Text style={styles.note}>歩数目標: {input.activity.stepGoal.toLocaleString('ja-JP')} 歩</Text> : null}
    {input.activity?.confidence === 'low' ? <Text style={styles.note}>歩数は前景センサーの参考値です。</Text> : null}
  </>;
}

const providerLabels: Record<keyof ProviderStatusMap, string> = {
  weather: '天気', places: '周辺の場所', routes: '移動経路', geocoding: '目的地の確認', bedrock: '提案の生成'
};
const providerStateLabels: Record<ProviderStatusValue, string> = {
  ok: '取得済み', degraded: '一部取得', unavailable: '取得できません',
  timeout: '時間切れ', error: '取得に失敗', not_requested: '未取得'
};
export function ProviderHealth({ value }: { value: ProviderStatusMap | undefined }) {
  return <Card title="情報の取得状況">{(Object.keys(providerLabels) as (keyof ProviderStatusMap)[]).map(key =>
    <Text key={key} style={styles.body}>{providerLabels[key]}: {value ? providerStateLabels[value[key].status] : '未取得'}</Text>
  )}</Card>;
}

export function RecommendationCards({ items, timezone }: { items: readonly ApiRecommendationItem[]; timezone: string | undefined }) {
  const [failedAction, setFailedAction] = useState<string | null>(null);
  const open = async (id: string, url: string) => {
    setFailedAction(null);
    try { await Linking.openURL(url); } catch { setFailedAction(id); }
  };
  return <>{items.map(item => {
    const url = item.action.type === 'NONE' ? null : item.action.url ?? (item.action.type === 'MAP' && item.place
      ? `https://www.google.com/maps/search/?api=1&query=${item.place.latitude},${item.place.longitude}` : null);
    return <View key={item.id} style={styles.item}>
      <Text style={styles.heading}>{item.title}</Text>
      <Text style={styles.body}>{item.reason}</Text>
      {item.place ? <Text style={styles.body}>{item.place.name}{item.place.distanceMeters === undefined ? '' : ` / ${Math.round(item.place.distanceMeters)} m`}</Text> : null}
      {item.route ? <>
        <Text style={styles.body}>移動時間: {Math.ceil(item.route.durationMinutes)} 分{item.route.transfers === undefined ? '' : ` / 乗換 ${item.route.transfers} 回`}</Text>
        {item.route.departAt ? <Text style={styles.note}>出発: {formatTime(item.route.departAt, timezone)}</Text> : null}
        {item.route.arriveAt ? <Text style={styles.note}>到着: {formatTime(item.route.arriveAt, timezone)}</Text> : null}
        {item.route.attributions?.map((attribution, index) => <View key={`${attribution.text}-${index}`}>
          <Text style={styles.note}>{attribution.text}</Text>
          {attribution.url ? <Button title="提供元を開く" onPress={() => void open(item.id, attribution.url!)} /> : null}
        </View>)}
      </> : null}
      {url ? <Button title={item.action.type === 'MAP' ? '地図を開く' : item.action.type === 'TRANSIT' ? '移動経路を開く' : 'Web サイトを開く'} onPress={() => void open(item.id, url)} /> : null}
      {failedAction === item.id ? <Text style={styles.error}>リンクを開けませんでした。</Text> : null}
    </View>;
  })}</>;
}
