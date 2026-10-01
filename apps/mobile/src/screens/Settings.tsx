import { useState } from 'react';
import { Button, Switch, Text, TextInput, View } from 'react-native';
import type { Profile } from '@contextia/contracts';
import type { MobileController, MobileState } from '../application/mobileController';
import { Card, Failure, styles } from './components';
import { parsePreferencesDraft, preferencesDraft, type PreferencesDraft } from './presentation';

function PreferencesForm({ profile, state, controller }: { profile: Profile; state: MobileState; controller: MobileController }) {
  const [draft, setDraft] = useState(() => preferencesDraft(profile.preferences));
  const parsed = parsePreferencesDraft(draft);
  const disabled = state.saving || state.collecting || state.evaluation.status === 'loading' || state.profile.status === 'loading';
  const update = <K extends keyof PreferencesDraft>(key: K, value: PreferencesDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const textField = (label: string, key: 'interests' | 'stepGoal' | 'locale' | 'timezone') => <View style={{ gap: 6 }}>
    <Text style={styles.body}>{label}</Text>
    <TextInput accessibilityLabel={label} style={styles.input} value={draft[key]} editable={!disabled}
      autoCapitalize="none" autoCorrect={false} keyboardType={key === 'stepGoal' ? 'number-pad' : 'default'}
      onChangeText={value => update(key, value)} />
  </View>;
  return <>
    {textField('興味・好み（カンマ区切り）', 'interests')}
    {textField('歩数目標', 'stepGoal')}
    <Text style={styles.body}>通知の頻度</Text>
    <View style={styles.row}>{([['low', '控えめ'], ['normal', '標準'], ['high', '多め']] as const).map(([value, label]) =>
      <Button key={value} title={`${draft.notificationFrequency === value ? '✓ ' : ''}${label}`} disabled={disabled} onPress={() => update('notificationFrequency', value)} />
    )}</View>
    <View style={styles.row}><Text style={styles.body}>通知を有効にする</Text><Switch accessibilityLabel="通知を有効にする" disabled={disabled} value={draft.notificationsEnabled} onValueChange={value => update('notificationsEnabled', value)} /></View>
    {textField('言語（例: ja-JP）', 'locale')}
    {textField('タイムゾーン（例: Asia/Tokyo）', 'timezone')}
    {!parsed.success ? <Text style={styles.error}>歩数目標は 1～200000 の整数、好みは各64文字以内で20件まで、タイムゾーンは IANA 名で入力してください。</Text> : null}
    <Button title={state.saving ? '保存中…' : '設定を保存'} disabled={disabled || !parsed.success} onPress={() => { if (parsed.success) void controller.savePreferences(parsed.data); }} />
    {state.saveResult === 'saved' ? <Text accessibilityLiveRegion="polite" style={styles.success}>設定を保存しました。</Text> : null}
    {typeof state.saveResult === 'object' ? <Failure error={state.saveResult} /> : null}
  </>;
}

export function Settings({ state, controller }: { state: MobileState; controller: MobileController }) {
  return <Card title="設定">
    <Button title={state.profile.status === 'loading' ? '取得中…' : '設定を再取得'} disabled={state.profile.status === 'loading' || state.saving} onPress={() => void controller.loadProfile()} />
    {state.profile.status === 'loading' ? <Text style={styles.body}>設定を取得しています…</Text> : null}
    {state.profile.status === 'error' ? <Failure error={state.profile.error} /> : null}
    {state.profile.data ? <PreferencesForm key={JSON.stringify(state.profile.data.preferences)} profile={state.profile.data} state={state} controller={controller} /> : <Text style={styles.note}>設定の取得後に編集できます。</Text>}
  </Card>;
}
