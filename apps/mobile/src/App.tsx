import { StyleSheet, Text, View } from 'react-native';
import { DeliveryModeSchema } from '@contextia/contracts';

const deliveryMode = DeliveryModeSchema.parse('proactive');

export function App() {
  return (
    <View style={styles.page}>
      <Text style={styles.brand}>Contextia</Text>
      <Text style={styles.status}>未接続</Text>
      <View style={styles.card}>
        <Text style={styles.title}>状況に合わせた提案を、これから。</Text>
        <Text style={styles.body}>ログイン、位置・予定・歩数の取得、評価APIはまだ接続していません。</Text>
        <Text style={styles.body}>{deliveryMode === 'proactive' ? '評価結果は未取得です。通知は送信していません。' : null}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f7f8', paddingHorizontal: 24, paddingTop: 72 },
  brand: { color: '#152b3a', fontSize: 28, fontWeight: '700' },
  status: { color: '#405663', fontSize: 14, marginTop: 12 },
  card: { backgroundColor: '#ffffff', borderColor: '#dce5e9', borderWidth: 1, borderRadius: 16, padding: 24, marginTop: 32 },
  title: { color: '#152b3a', fontSize: 22, fontWeight: '600', lineHeight: 34 },
  body: { color: '#4b616e', fontSize: 16, lineHeight: 28, marginTop: 16 }
});
