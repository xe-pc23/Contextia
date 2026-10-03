import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, ScrollView, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { apiBaseUrl, createBackendClient, type BackendClient } from './api/backendClient';
import { MobileController } from './application/mobileController';
import { readCognitoConfiguration, type CognitoConfiguration } from './auth/cognitoConfig';
import { useCognitoAuth, type CognitoAuthState } from './auth/useCognitoAuth';
import { ContextCollector, SystemClock } from './context/contextCollector';
import { ExpoCalendarSource } from './context/expoCalendarSource';
import { ExpoLocationSource } from './context/expoLocationSource';
import { createNativeStepSource } from './context/nativeSteps';
import { Card, styles } from './screens/components';
import { Dashboard } from './screens/Dashboard';
import { RecommendationDetail } from './screens/RecommendationDetail';
import { Settings } from './screens/Settings';
import { BackgroundControl } from './screens/BackgroundControl';
import { subscribeToRecommendationNotifications } from './notifications/nativeNotifications';
import { I18nProvider, useMessages } from './i18n/I18nContext';
import { languageForLocale, messagesFor, resolveLanguage, type Language } from './i18n/messages';
import { secureLanguageStore } from './i18n/languageStore';

function ForegroundApp({ client, config, getSessionSignal, onLocale }: {
  client: BackendClient; config: CognitoConfiguration; getSessionSignal: () => AbortSignal; onLocale: (locale: string) => void;
}) {
  const t = useMessages();
  const clock = useMemo(() => new SystemClock(), []);
  const controller = useMemo(() => new MobileController({
    client, collector: new ContextCollector(new ExpoLocationSource(), new ExpoCalendarSource(), clock, createNativeStepSource())
  }), [client, clock]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [screen, setScreen] = useState<'dashboard' | 'settings' | 'detail'>('dashboard');
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    controller.activate();
    void controller.loadProfile();
    void controller.loadHistory();
    return () => controller.dispose();
  }, [controller]);
  const openDetail = useCallback((id: string) => {
    setDetailId(id);
    setScreen('detail');
    void controller.openDetail(id);
  }, [controller]);
  useEffect(() => subscribeToRecommendationNotifications(openDetail), [openDetail]);
  const locale = state.profile.data?.preferences.locale;
  useEffect(() => { if (locale) onLocale(locale); }, [locale, onLocale]);
  const navigate = (target: 'dashboard' | 'settings') => {
    controller.closeDetail();
    setDetailId(null);
    setScreen(target);
  };
  return <>
    <View style={styles.row}>
      <Button title={t.nav.home} onPress={() => navigate('dashboard')} />
      <Button title={t.nav.settings} onPress={() => navigate('settings')} />
    </View>
    {screen === 'dashboard' ? <Dashboard state={state} controller={controller} clock={clock} openDetail={openDetail} /> : null}
    {screen === 'settings' ? <><Settings state={state} controller={controller} /><BackgroundControl config={config} client={client} getSessionSignal={getSessionSignal} /></> : null}
    {screen === 'detail' ? <RecommendationDetail key={detailId} state={state} sendChat={message => controller.sendChat(message)} retry={() => { if (detailId) void controller.openDetail(detailId); }} /> : null}
  </>;
}

// Language names stay in their own language so either can be found from the other.
const languageChoices = [['ja', '日本語'], ['en', 'English']] as const;

/** The app's own display-language choice, persisted on the device; the iPhone language is not used. */
function useAppLanguage() {
  const [saved, setSaved] = useState<Language | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void secureLanguageStore.read().then(value => {
      if (!active) return;
      setSaved(previous => previous ?? value);
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);
  const choose = useCallback((language: Language) => {
    setSaved(language);
    void secureLanguageStore.write(language);
  }, []);
  return { saved, loaded, choose };
}

function LanguageSwitch({ current, choose }: { current: Language; choose: (language: Language) => void }) {
  const t = useMessages();
  return <View style={styles.row}>
    <Text style={styles.note}>{t.auth.language}</Text>
    {languageChoices.map(([language, label]) =>
      <Button key={language} title={`${current === language ? '✓ ' : ''}${label}`} onPress={() => choose(language)} />)}
  </View>;
}

function AuthPanel({ auth, language, chooseLanguage }: { auth: CognitoAuthState; language: Language; chooseLanguage: (language: Language) => void }) {
  const t = useMessages();
  const a = t.auth;
  return <Card title={a.title}>
    <Text style={styles.body}>{auth.status === 'signed-in' ? a.signedIn : auth.status === 'loading' ? a.checking : a.signInPrompt}</Text>
    {auth.status === 'signed-in'
      ? <Button title={auth.busy ? t.common.processing : a.signOut} disabled={auth.busy} onPress={() => void auth.signOut()} />
      : <Button title={auth.busy ? t.common.processing : a.signIn} disabled={auth.busy || auth.status === 'loading'} onPress={() => void auth.signIn()} />}
    {auth.message ? <Text style={styles.error}>{a.messages[auth.message]}</Text> : null}
    {auth.status !== 'signed-in' ? <LanguageSwitch current={language} choose={chooseLanguage} /> : null}
  </Card>;
}

function AuthenticatedApp({ config, baseUrl, savedLanguage, chooseLanguage }: {
  config: CognitoConfiguration; baseUrl: string | null; savedLanguage: Language | null; chooseLanguage: (language: Language) => void;
}) {
  const auth = useCognitoAuth(config);
  const client = useMemo(() => baseUrl ? createBackendClient({
    baseUrl, createIdempotencyKey: randomUUID, getAccessToken: auth.getAccessToken,
    getSessionSignal: auth.getSessionSignal, onUnauthorized: auth.rejectAccessToken
  }) : null, [baseUrl, auth.getAccessToken, auth.getSessionSignal, auth.rejectAccessToken]);
  // While signed in, the saved profile locale (also used for model prose) decides the language and is
  // remembered on the device, so the next sign-in screen keeps it after sign-out.
  const [profileLocale, setProfileLocale] = useState<string | undefined>(undefined);
  useEffect(() => { if (auth.status !== 'signed-in') setProfileLocale(undefined); }, [auth.status]);
  const adoptProfileLocale = useCallback((locale: string) => {
    setProfileLocale(locale);
    chooseLanguage(languageForLocale(locale));
  }, [chooseLanguage]);
  const language = resolveLanguage(auth.status === 'signed-in' ? profileLocale : undefined, savedLanguage);
  const t = messagesFor(language);
  return <I18nProvider messages={t}><View style={styles.page}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={styles.brand}>Contextia</Text>
    <AuthPanel auth={auth} language={language} chooseLanguage={chooseLanguage} />
    {!baseUrl ? <Card title={t.auth.apiNotConfiguredTitle}><Text style={styles.body}>{t.auth.apiNotConfiguredBody}</Text></Card> : null}
    {auth.status === 'signed-in' && client ? <ForegroundApp client={client} config={config} getSessionSignal={auth.getSessionSignal} onLocale={adoptProfileLocale} /> : null}
  </ScrollView></View></I18nProvider>;
}

export function App() {
  const { saved, loaded, choose } = useAppLanguage();
  const config = readCognitoConfiguration({
    EXPO_PUBLIC_STAGE: process.env.EXPO_PUBLIC_STAGE,
    EXPO_PUBLIC_COGNITO_ISSUER: process.env.EXPO_PUBLIC_COGNITO_ISSUER,
    EXPO_PUBLIC_COGNITO_CLIENT_ID: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID,
    EXPO_PUBLIC_COGNITO_REDIRECT_URI: process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI
  });
  const baseUrl = apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  // Wait for the saved choice so the first screen does not flash in the other language.
  if (!loaded) return <View style={styles.page} />;
  if (config) return <AuthenticatedApp config={config} baseUrl={baseUrl} savedLanguage={saved} chooseLanguage={choose} />;
  const t = messagesFor(resolveLanguage(undefined, saved));
  return <View style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.brand}>Contextia</Text>
    <Card title={t.auth.notConfiguredTitle}><Text style={styles.body}>{t.auth.notConfiguredBody}</Text><Button title={t.auth.signIn} disabled /></Card>
  </ScrollView></View>;
}
