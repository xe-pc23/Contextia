import { Button, Text, View } from 'react-native';
import type { MobileController, MobileState } from '../application/mobileController';
import type { ClockSource } from '../context/types';
import { Card, CollectionSummary, Failure, ProviderHealth, RecommendationCards, styles } from './components';
import { evaluationPresentation, formatTime, nextCalendarEvent } from './presentation';

export function Dashboard({ state, controller, clock, openDetail }: {
  state: MobileState; controller: MobileController; clock: ClockSource; openDetail: (id: string) => void;
}) {
  const timezone = state.profile.data?.preferences.timezone;
  const busy = state.collecting || state.evaluation.status === 'loading' || state.saving;
  const context = state.collection?.status === 'ready' ? state.collection.input : null;
  const nextEvent = nextCalendarEvent(context?.calendar ?? [], clock.now());
  const evaluation = state.evaluation.data;
  const view = evaluation ? evaluationPresentation(evaluation.result) : null;
  return <>
    <Card title="現在地と予定">
      <Text style={styles.note}>位置と予定は操作した時に読み取ります。「今評価」では、読み取った情報を送って提案を確認します。</Text>
      <CollectionSummary collection={state.collection} timezone={timezone} />
      {nextEvent ? <View style={styles.item}>
        <Text style={styles.body}>次の予定: {nextEvent.title}</Text>
        <Text style={styles.note}>{formatTime(nextEvent.startAt, timezone)}{nextEvent.location ? ` / ${nextEvent.location}` : ''}</Text>
      </View> : context && state.collection?.status === 'ready' && state.collection.permissions.calendar === 'granted'
        ? <Text style={styles.note}>読み取った範囲に次の予定はありません。</Text> : null}
      <Text style={styles.note}>送る予定情報は ID ハッシュ・タイトル・日時・場所だけです。参加者や説明・メモは含みません。</Text>
      <Button title={state.collecting ? '読み取り中…' : '端末の情報を読み取る'} disabled={busy} onPress={() => void controller.readContext()} />
      <Button title={state.evaluation.status === 'loading' ? '評価中…' : '今評価'} disabled={busy} onPress={() => void controller.evaluate()} />
      {state.collectionError ? <Failure error={state.collectionError} /> : null}
    </Card>
    <Card title={view?.title ?? '最新の評価'}>
      {state.evaluation.status === 'idle' ? <Text style={styles.note}>「今評価」で現在の状況に合う提案を確認できます。</Text> : null}
      {state.evaluation.status === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.body}>端末の情報と提案を確認しています…</Text> : null}
      {state.evaluation.status === 'error' ? <Failure error={state.evaluation.error} /> : null}
      {view && evaluation ? <>
        {view.message ? <Text style={styles.body}>{view.message}</Text> : null}
        <Text style={styles.note}>{view.reason}</Text>
        {view.signals.length ? <Text style={styles.note}>使った情報: {view.signals.join('、')}</Text> : null}
        {view.guards.map(guard => <Text key={guard} style={styles.note}>{guard}</Text>)}
        <RecommendationCards items={view.cards} timezone={timezone} />
        {evaluation.result.recommendationId ? <Button title="提案の詳細を見る" onPress={() => openDetail(evaluation.result.recommendationId ?? '')} /> : null}
      </> : null}
    </Card>
    <ProviderHealth value={evaluation?.result.providerStatus} />
    <Card title="最近の提案">
      <Button title={state.history.status === 'loading' ? '取得中…' : '一覧を更新'} disabled={state.history.status === 'loading'} onPress={() => void controller.loadHistory()} />
      {state.history.status === 'error' ? <Failure error={state.history.error} /> : null}
      {state.history.status === 'ready' && !state.history.data.items.length ? <Text style={styles.note}>最近の提案はありません。</Text> : null}
      {state.history.data?.items.map(item => <View key={item.id} style={styles.item}>
        <Text style={styles.note}>{formatTime(item.createdAt, timezone)}</Text>
        <Text style={styles.body}>{item.message}</Text>
        <Button title="詳細を見る" onPress={() => openDetail(item.id)} />
      </View>)}
      {state.history.data?.nextCursor ? <Button title="続きを読み込む" disabled={state.history.status === 'loading'} onPress={() => void controller.loadHistory(true)} /> : null}
    </Card>
  </>;
}
