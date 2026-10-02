import { useCallback, useMemo, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { readCognitoConfiguration } from './auth/cognitoConfig';
import { useCognitoAuth, type CognitoAuthState } from './auth/useCognitoAuth';
import { ContextCollector, SystemClock } from './context/contextCollector';
import { ExpoCalendarSource } from './context/expoCalendarSource';
import { ExpoLocationSource } from './context/expoLocationSource';
import type { ContextCollectionResult } from './context/types';

type AuthView = Pick<CognitoAuthState, 'status' | 'busy' | 'message' | 'signIn' | 'signOut'> | {
  status: 'not-configured';
  busy: false;
  message: string;
  signIn?: never;
  signOut?: never;
};

function ConfiguredApp({ issuer }: { issuer: string }) {
  const config = readCognitoConfiguration({
    EXPO_PUBLIC_STAGE: process.env.EXPO_PUBLIC_STAGE,
    EXPO_PUBLIC_COGNITO_ISSUER: issuer,
    EXPO_PUBLIC_COGNITO_CLIENT_ID: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID,
    EXPO_PUBLIC_COGNITO_REDIRECT_URI: process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI
  });
  if (!config) return <ContextDashboard auth={unconfiguredAuth} />;
  return <AuthenticatedApp config={config} />;
}

function AuthenticatedApp({ config }: { config: NonNullable<ReturnType<typeof readCognitoConfiguration>> }) {
  const auth = useCognitoAuth(config);
  return <ContextDashboard auth={auth} />;
}

const unconfiguredAuth: AuthView = {
  status: 'not-configured',
  busy: false,
  message: 'Cognito の Issuer と client ID は D 担当の環境設定後に有効になります。'
};

function ContextDashboard({ auth }: { auth: AuthView }) {
  const collector = useMemo(() => new ContextCollector(
    new ExpoLocationSource(),
    new ExpoCalendarSource(),
    new SystemClock()
  ), []);
  const [collection, setCollection] = useState<ContextCollectionResult | null>(null);
  const [collecting, setCollecting] = useState(false);

  const collectContext = useCallback(async () => {
    setCollecting(true);
    try {
      setCollection(await collector.collect());
    } finally {
      setCollecting(false);
    }
  }, [collector]);

  const authTitle = auth.status === 'signed-in'
    ? 'サインイン済み'
    : auth.status === 'loading'
      ? '認証設定を確認中'
      : auth.status === 'not-configured'
        ? 'Cognito 未設定'
        : auth.status === 'error'
          ? 'サインインできません'
          : '未サインイン';

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>Contextia</Text>
        <Text style={styles.status}>Phase 1 — 前景コンテキスト試作</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>認証</Text>
          <Text style={styles.body}>{authTitle}</Text>
          {auth.status === 'signed-in' ? (
            <Button title={auth.busy ? '処理中…' : 'サインアウト'} disabled={auth.busy} onPress={() => void auth.signOut?.()} />
          ) : (
            <Button
              title={auth.busy ? '処理中…' : 'Cognito でサインイン'}
              disabled={auth.busy || auth.status === 'loading' || auth.status === 'not-configured'}
              onPress={() => void auth.signIn?.()}
            />
          )}
          {auth.message ? <Text style={styles.note}>{auth.message}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>端末 context</Text>
          <Text style={styles.body}>位置情報と予定は、このボタンを押した時だけ読み取ります。</Text>
          <Text style={styles.note}>送信候補は現在地と予定の ID ハッシュ・タイトル・時刻・場所だけです。参加者、メール、説明、メモ、会議 URL は含めません。</Text>
          <View style={styles.button}>
            <Button
              title={collecting ? '読み取り中…' : '端末の位置と予定を読み取る'}
              disabled={collecting}
              onPress={() => void collectContext()}
            />
          </View>
          {collection ? <CollectionSummary result={collection} /> : null}
        </View>

        <Text style={styles.footer}>この段階では端末内で ContextInput を検証します。評価 API 接続は Phase 2 です。</Text>
      </ScrollView>
    </View>
  );
}

function CollectionSummary({ result }: { result: ContextCollectionResult }) {
  if (result.status === 'location-unavailable') {
    return (
      <View style={styles.result}>
        <Text style={styles.resultTitle}>位置情報: {result.location === 'denied' ? '許可されていません' : '取得できません'}</Text>
        <Text style={styles.body}>予定の状態: {permissionLabel(result.calendar)}。位置情報がないため、評価用 ContextInput は作成していません。</Text>
      </View>
    );
  }
  if (result.status === 'invalid-context') {
    return <Text style={styles.error}>取得した値が共通 ContextInput schema に合いませんでした。</Text>;
  }

  return (
    <View style={styles.result}>
      <Text style={styles.resultTitle}>ContextInput 検証済み</Text>
      <Text style={styles.body}>現在地: {result.input.location.latitude.toFixed(5)}, {result.input.location.longitude.toFixed(5)}</Text>
      <Text style={styles.body}>位置情報: 許可済み / 予定: {permissionLabel(result.permissions.calendar)}</Text>
      <Text style={styles.body}>予定: {result.input.calendar.length} 件（許可フィールドのみ）</Text>
      <Text style={styles.body}>記録時刻: {result.input.capturedAt}</Text>
    </View>
  );
}

function permissionLabel(status: 'granted' | 'denied' | 'unavailable'): string {
  if (status === 'granted') return '許可済み';
  if (status === 'denied') return '許可されていません';
  return '取得できません';
}

export function App() {
  const issuer = process.env.EXPO_PUBLIC_COGNITO_ISSUER;
  if (!issuer) return <ContextDashboard auth={unconfiguredAuth} />;
  return <ConfiguredApp issuer={issuer} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f7f8' },
  content: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 40 },
  brand: { color: '#152b3a', fontSize: 28, fontWeight: '700' },
  status: { color: '#405663', fontSize: 14, marginTop: 12 },
  card: { backgroundColor: '#ffffff', borderColor: '#dce5e9', borderWidth: 1, borderRadius: 16, padding: 20, marginTop: 24 },
  sectionTitle: { color: '#152b3a', fontSize: 19, fontWeight: '600', marginBottom: 12 },
  body: { color: '#4b616e', fontSize: 15, lineHeight: 24, marginTop: 8 },
  note: { color: '#5c707b', fontSize: 13, lineHeight: 20, marginTop: 12 },
  button: { marginTop: 16 },
  result: { borderTopColor: '#dce5e9', borderTopWidth: 1, marginTop: 18, paddingTop: 14 },
  resultTitle: { color: '#1c563b', fontSize: 15, fontWeight: '600' },
  error: { color: '#9d2732', fontSize: 14, lineHeight: 22, marginTop: 16 },
  footer: { color: '#5c707b', fontSize: 13, lineHeight: 20, marginTop: 24 }
});
