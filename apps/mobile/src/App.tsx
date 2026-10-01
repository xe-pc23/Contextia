import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, ScrollView, Text, View } from 'react-native';
import { apiBaseUrl, createBackendClient, type BackendClient } from './api/backendClient';
import { MobileController } from './application/mobileController';
import { readCognitoConfiguration, type CognitoConfiguration } from './auth/cognitoConfig';
import { useCognitoAuth, type CognitoAuthState } from './auth/useCognitoAuth';
import { ContextCollector, SystemClock } from './context/contextCollector';
import { ExpoCalendarSource } from './context/expoCalendarSource';
import { ExpoLocationSource } from './context/expoLocationSource';
import { Card, styles } from './screens/components';
import { Dashboard } from './screens/Dashboard';
import { RecommendationDetail } from './screens/RecommendationDetail';
import { Settings } from './screens/Settings';

function ForegroundApp({ client }: { client: BackendClient }) {
  const clock = useMemo(() => new SystemClock(), []);
  const controller = useMemo(() => new MobileController({
    client, collector: new ContextCollector(new ExpoLocationSource(), new ExpoCalendarSource(), clock)
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
  const openDetail = (id: string) => {
    setDetailId(id);
    setScreen('detail');
    void controller.openDetail(id);
  };
  const navigate = (target: 'dashboard' | 'settings') => {
    controller.closeDetail();
    setDetailId(null);
    setScreen(target);
  };
  return <>
    <View style={styles.row}>
      <Button title="ホーム" onPress={() => navigate('dashboard')} />
      <Button title="設定" onPress={() => navigate('settings')} />
    </View>
    {screen === 'dashboard' ? <Dashboard state={state} controller={controller} clock={clock} openDetail={openDetail} /> : null}
    {screen === 'settings' ? <Settings state={state} controller={controller} /> : null}
    {screen === 'detail' ? <RecommendationDetail state={state} retry={() => { if (detailId) void controller.openDetail(detailId); }} /> : null}
  </>;
}

function AuthPanel({ auth }: { auth: CognitoAuthState }) {
  return <Card title="アカウント">
    <Text style={styles.body}>{auth.status === 'signed-in' ? 'サインイン済み' : auth.status === 'loading' ? '認証を確認しています…' : 'サインインして提案を受け取る'}</Text>
    {auth.status === 'signed-in'
      ? <Button title={auth.busy ? '処理中…' : 'サインアウト'} disabled={auth.busy} onPress={() => void auth.signOut()} />
      : <Button title={auth.busy ? '処理中…' : 'サインイン'} disabled={auth.busy || auth.status === 'loading'} onPress={() => void auth.signIn()} />}
    {auth.message ? <Text style={styles.error}>{auth.message}</Text> : null}
  </Card>;
}

function AuthenticatedApp({ config, baseUrl }: { config: CognitoConfiguration; baseUrl: string | null }) {
  const auth = useCognitoAuth(config);
  const client = useMemo(() => baseUrl ? createBackendClient({ baseUrl, getAccessToken: auth.getAccessToken, getSessionSignal: auth.getSessionSignal }) : null, [baseUrl, auth.getAccessToken, auth.getSessionSignal]);
  return <View style={styles.page}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={styles.brand}>Contextia</Text>
    <AuthPanel auth={auth} />
    {!baseUrl ? <Card title="接続先が未設定です"><Text style={styles.body}>アプリの API 接続設定を用意してから、再度開いてください。</Text></Card> : null}
    {auth.status === 'signed-in' && client ? <ForegroundApp client={client} /> : null}
  </ScrollView></View>;
}

export function App() {
  const config = readCognitoConfiguration({
    EXPO_PUBLIC_STAGE: process.env.EXPO_PUBLIC_STAGE,
    EXPO_PUBLIC_COGNITO_ISSUER: process.env.EXPO_PUBLIC_COGNITO_ISSUER,
    EXPO_PUBLIC_COGNITO_CLIENT_ID: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID,
    EXPO_PUBLIC_COGNITO_REDIRECT_URI: process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI
  });
  const baseUrl = apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (config) return <AuthenticatedApp config={config} baseUrl={baseUrl} />;
  return <View style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.brand}>Contextia</Text>
    <Card title="認証が未設定です"><Text style={styles.body}>アプリの認証設定を用意してから、再度開いてください。</Text><Button title="サインイン" disabled /></Card>
  </ScrollView></View>;
}
