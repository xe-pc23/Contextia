import { Button, Text, View } from 'react-native';
import type { MobileController, MobileState } from '../application/mobileController';
import type { ClockSource } from '../context/types';
import { useMessages } from '../i18n/I18nContext';
import { Card, CollectionSummary, Failure, ProviderHealth, RecommendationCards, styles } from './components';
import { evaluationPresentation, formatTime, nextCalendarEvent, weatherPresentation } from './presentation';

export function Dashboard({ state, controller, clock, openDetail }: {
  state: MobileState; controller: MobileController; clock: ClockSource; openDetail: (id: string) => void;
}) {
  const t = useMessages();
  const d = t.dashboard;
  const timezone = state.profile.data?.preferences.timezone;
  const busy = state.collecting || state.evaluation.status === 'loading' || state.saving;
  const context = state.collection?.status === 'ready' ? state.collection.input : null;
  const nextEvent = nextCalendarEvent(context?.calendar ?? [], clock.now());
  const evaluation = state.evaluation.data;
  const view = evaluation ? evaluationPresentation(evaluation.result, t) : null;
  const weather = weatherPresentation(evaluation?.result.weather, timezone, t);
  return <>
    <Card title={d.contextTitle}>
      <Text style={styles.note}>{d.contextNote}</Text>
      <CollectionSummary collection={state.collection} timezone={timezone} />
      {nextEvent ? <View style={styles.item}>
        <Text style={styles.body}>{d.nextEvent}: {nextEvent.title}</Text>
        <Text style={styles.note}>{formatTime(nextEvent.startAt, timezone, t)}{nextEvent.location ? ` / ${nextEvent.location}` : ''}</Text>
      </View> : context && state.collection?.status === 'ready' && state.collection.permissions.calendar === 'granted'
        ? <Text style={styles.note}>{d.noNextEvent}</Text> : null}
      <Text style={styles.note}>{d.calendarPrivacy}</Text>
      <Button title={state.collecting ? d.reading : d.read} disabled={busy} onPress={() => void controller.readContext()} />
      <Button title={state.evaluation.status === 'loading' ? d.evaluating : d.evaluate} disabled={busy || state.profile.status === 'loading'} onPress={() => void controller.evaluate()} />
      {state.collectionError ? <Failure error={state.collectionError} /> : null}
    </Card>
    <Card title={view?.title ?? d.latestTitle}>
      {state.evaluation.status === 'idle' ? <Text style={styles.note}>{d.idleHint}</Text> : null}
      {state.evaluation.status === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.body}>{d.evaluatingBody}</Text> : null}
      {state.evaluation.status === 'error' ? <Failure error={state.evaluation.error} /> : null}
      {view && evaluation ? <>
        {view.message ? <Text style={styles.body}>{view.message}</Text> : null}
        <Text style={styles.note}>{view.reason}</Text>
        {view.signals.length ? <Text style={styles.note}>{d.usedSignals}: {view.signals.join(t.common.listSeparator)}</Text> : null}
        {view.guards.map(guard => <Text key={guard} style={styles.note}>{guard}</Text>)}
        <RecommendationCards items={view.cards} timezone={timezone} />
        {evaluation.result.recommendationId ? <Button title={d.viewDetail} onPress={() => openDetail(evaluation.result.recommendationId ?? '')} /> : null}
      </> : null}
    </Card>
    <Card title={d.weatherTitle}>
      <Text style={styles.body}>{weather.condition} / {weather.temperature}</Text>
      {weather.period ? <Text style={styles.note}>{weather.period}</Text> : <Text style={styles.note}>
        {evaluation?.result.providerStatus.weather.status === 'not_requested' ? d.weatherNotRequested : evaluation ? d.weatherUnavailable : d.weatherHint}
      </Text>}
    </Card>
    <ProviderHealth value={evaluation?.result.providerStatus} />
    <Card title={d.historyTitle}>
      <Button title={state.history.status === 'loading' ? t.common.fetching : d.refresh} disabled={state.history.status === 'loading'} onPress={() => void controller.loadHistory()} />
      {state.history.status === 'error' ? <Failure error={state.history.error} /> : null}
      {state.history.status === 'ready' && !state.history.data.items.length ? <Text style={styles.note}>{d.noHistory}</Text> : null}
      {state.history.data?.items.map(item => <View key={item.id} style={styles.item}>
        <Text style={styles.note}>{formatTime(item.createdAt, timezone, t)}</Text>
        <Text style={styles.body}>{item.message}</Text>
        <Button title={d.detail} onPress={() => openDetail(item.id)} />
      </View>)}
      {state.history.data?.nextCursor ? <Button title={d.loadMore} disabled={state.history.status === 'loading'} onPress={() => void controller.loadHistory(true)} /> : null}
    </Card>
  </>;
}
