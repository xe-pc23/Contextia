import { useState } from 'react';
import { Button, Switch, Text, TextInput, View } from 'react-native';
import type { Profile } from '@contextia/contracts';
import type { MobileController, MobileState } from '../application/mobileController';
import { useMessages } from '../i18n/I18nContext';
import { languageForLocale } from '../i18n/messages';
import { Card, Failure, styles } from './components';
import { parsePreferencesDraft, preferencesDraft, type PreferencesDraft } from './presentation';

// Language names stay in their own language so either can be found from the other.
const languageChoices = [['ja-JP', '日本語'], ['en-US', 'English']] as const;

function PreferencesForm({ profile, state, controller }: { profile: Profile; state: MobileState; controller: MobileController }) {
  const t = useMessages();
  const s = t.settings;
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
    {textField(s.interests, 'interests')}
    {textField(s.stepGoal, 'stepGoal')}
    <Text style={styles.body}>{s.frequency}</Text>
    <View style={styles.row}>{(['low', 'normal', 'high'] as const).map(value =>
      <Button key={value} title={`${draft.notificationFrequency === value ? '✓ ' : ''}${s.frequencies[value]}`} disabled={disabled} onPress={() => update('notificationFrequency', value)} />
    )}</View>
    <View style={styles.row}><Text style={styles.body}>{s.notificationsEnabled}</Text><Switch accessibilityLabel={s.notificationsEnabled} disabled={disabled} value={draft.notificationsEnabled} onValueChange={value => update('notificationsEnabled', value)} /></View>
    <Text style={styles.body}>{s.languageQuick}</Text>
    <View style={styles.row}>{languageChoices.map(([locale, label]) =>
      <Button key={locale} title={`${languageForLocale(draft.locale) === languageForLocale(locale) ? '✓ ' : ''}${label}`} disabled={disabled} onPress={() => update('locale', locale)} />
    )}</View>
    {textField(s.language, 'locale')}
    {textField(s.timezone, 'timezone')}
    {!parsed.success ? <Text style={styles.error}>{s.invalid}</Text> : null}
    <Button title={state.saving ? s.saving : s.save} disabled={disabled || !parsed.success} onPress={() => { if (parsed.success) void controller.savePreferences(parsed.data); }} />
    {state.saveResult === 'saved' ? <Text accessibilityLiveRegion="polite" style={styles.success}>{s.saved}</Text> : null}
    {typeof state.saveResult === 'object' ? <Failure error={state.saveResult} /> : null}
  </>;
}

export function Settings({ state, controller }: { state: MobileState; controller: MobileController }) {
  const t = useMessages();
  const s = t.settings;
  return <Card title={s.title}>
    <Button title={state.profile.status === 'loading' ? t.common.fetching : s.reload} disabled={state.profile.status === 'loading' || state.saving} onPress={() => void controller.loadProfile()} />
    {state.profile.status === 'loading' ? <Text style={styles.body}>{s.loadingBody}</Text> : null}
    {state.profile.status === 'error' ? <Failure error={state.profile.error} /> : null}
    {state.profile.data ? <PreferencesForm key={JSON.stringify(state.profile.data.preferences)} profile={state.profile.data} state={state} controller={controller} /> : <Text style={styles.note}>{s.editAfterLoad}</Text>}
  </Card>;
}
