import { DeliveryModeSchema } from '@contextia/contracts';

const deliveryMode = DeliveryModeSchema.parse('preview');

export function App() {
  return (
    <main>
      <header><span className="brand">Contextia</span><span className="badge">未接続</span></header>
      <section className="intro">
        <p className="eyebrow">Scenario Console</p>
        <h1>その状況に、役立つきっかけを。</h1>
        <p>位置・時刻・歩数・予定を使って、今の状況を評価するコンソールです。</p>
      </section>
      <section className="notice" aria-label="接続状態">
        <h2>評価の接続を準備しています</h2>
        <p>ログインと評価APIはまだ接続していません。評価結果は未取得です。</p>
        <p>{deliveryMode === 'preview' ? 'コンソールでの評価は通知を送らないプレビューです。' : null}</p>
        <button type="button" disabled>評価を実行（未接続）</button>
      </section>
    </main>
  );
}
