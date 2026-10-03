import { useState, type ReactNode } from 'react';
import { Button, Linking, StyleSheet, Text, View } from 'react-native';
import type { ApiRecommendationItem, ProviderStatusMap } from '@contextia/contracts';
import type { MobileFailure } from '../application/mobileController';
import type { ContextCollectionResult, NativeReadStatus } from '../context/types';
import { useMessages } from '../i18n/I18nContext';
import type { Messages } from '../i18n/messages';
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
  const t = useMessages();
  return <View accessibilityLiveRegion="polite">
    <Text style={styles.error}>{failureMessage(error, t)}</Text>
    {error.kind === 'http-error' && error.requestId && /^[A-Za-z0-9_-]{1,128}$/.test(error.requestId)
      ? <Text style={styles.note}>{t.failures.requestId}: {error.requestId}</Text> : null}
  </View>;
}
export function permissionLabel(status: NativeReadStatus, t: Messages): string {
  return status === 'granted' ? t.permission.granted : status === 'denied' ? t.permission.denied : t.permission.unknown;
}
export function CollectionSummary({ collection, timezone }: { collection: ContextCollectionResult | null; timezone: string | undefined }) {
  const t = useMessages();
  const c = t.collection;
  if (!collection) return <Text style={styles.note}>{c.notRead}</Text>;
  if (collection.status !== 'ready') return <>
    <Text style={styles.error}>{collection.status === 'location-unavailable' ? c.locationUnavailable : c.invalid}</Text>
    <Text style={styles.note}>{c.calendar}: {permissionLabel(collection.calendar, t)} / {t.signals.steps}: {permissionLabel(collection.steps, t)}</Text>
  </>;
  const { input, permissions } = collection;
  return <>
    <Text style={styles.body}>{c.location}: {input.location.latitude.toFixed(5)}, {input.location.longitude.toFixed(5)}</Text>
    <Text style={styles.note}>{c.capturedAt}: {formatTime(input.location.capturedAt, timezone, t)}</Text>
    <Text style={styles.body}>{c.calendar}: {c.calendarCount(input.calendar.length)} / {permissionLabel(permissions.calendar, t)}</Text>
    <Text style={styles.body}>{c.stepsToday}: {input.activity?.stepsToday === null || input.activity?.stepsToday === undefined ? t.common.notFetched : c.steps(input.activity.stepsToday.toLocaleString(t.intlLocale))}</Text>
    {input.activity?.stepGoal ? <Text style={styles.note}>{c.stepGoal}: {c.steps(input.activity.stepGoal.toLocaleString(t.intlLocale))}</Text> : null}
    {input.activity?.confidence === 'low' ? <Text style={styles.note}>{c.lowConfidenceSteps}</Text> : null}
  </>;
}

export function ProviderHealth({ value }: { value: ProviderStatusMap | undefined }) {
  const t = useMessages();
  return <Card title={t.providerHealthTitle}>{(Object.keys(t.providers) as (keyof ProviderStatusMap)[]).map(key =>
    <Text key={key} style={styles.body}>{t.providers[key]}: {value ? t.providerStates[value[key].status] : t.common.notFetched}</Text>
  )}</Card>;
}

export function RecommendationCards({ items, timezone }: { items: readonly ApiRecommendationItem[]; timezone: string | undefined }) {
  const t = useMessages();
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
        <Text style={styles.body}>{t.cards.travelTime(Math.ceil(item.route.durationMinutes))}{item.route.transfers === undefined ? '' : t.cards.transfers(item.route.transfers)}</Text>
        {item.route.departAt ? <Text style={styles.note}>{t.cards.depart}: {formatTime(item.route.departAt, timezone, t)}</Text> : null}
        {item.route.arriveAt ? <Text style={styles.note}>{t.cards.arrive}: {formatTime(item.route.arriveAt, timezone, t)}</Text> : null}
        {item.route.attributions?.map((attribution, index) => <View key={`${attribution.text}-${index}`}>
          <Text style={styles.note}>{attribution.text}</Text>
          {attribution.url ? <Button title={t.cards.openSource} onPress={() => void open(item.id, attribution.url!)} /> : null}
        </View>)}
      </> : null}
      {url ? <Button title={item.action.type === 'MAP' ? t.cards.openMap : item.action.type === 'TRANSIT' ? t.cards.openRoute : t.cards.openWebsite} onPress={() => void open(item.id, url)} /> : null}
      {failedAction === item.id ? <Text style={styles.error}>{t.cards.linkFailed}</Text> : null}
    </View>;
  })}</>;
}
