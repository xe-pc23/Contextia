import type { EvaluationResult } from '@contextia/contracts';
import type { RunState } from '../execution/runState.js';
import type { EvaluateFailure, IssueSummary } from '../execution/scenarioApiClient.js';
import { DebugContext } from './DebugContext.js';
import { DeliveryDiagnostics } from './DeliveryDiagnostics.js';
import { formatDateTime } from './format.js';
import { triggerLabels, urgencyLabels } from './labels.js';
import { ProviderStatusPanel } from './ProviderStatusPanel.js';
import { RecommendationCards } from './RecommendationCards.js';
import { UsedSignals } from './UsedSignals.js';

const SENT_CONTEXT_LABEL = '送信したコンテキストを表示（共通スキーマ検証済み）';

function httpFailureText(status: number): { title: string; hint: string } {
  if (status === 400) return { title: '入力がAPIの検証で拒否されました。', hint: '下の詳細を確認して入力を修正してください。' };
  if (status === 401) return { title: 'ログインの有効期限が切れたか、認証に失敗しました。', hint: '再ログインしてから実行してください。' };
  if (status === 403) return { title: 'このアカウントではシナリオのプレビュー評価が許可されていません。', hint: 'Scenario Console用のデモアカウントでログインしてください。' };
  if (status === 404) return { title: '評価APIが見つかりません。', hint: 'API URLの設定を確認してください。' };
  if (status === 429) return { title: 'リクエストが多すぎます。', hint: '少し待ってから再実行してください。' };
  if (status >= 500) return { title: 'サーバー側でエラーが発生しました。', hint: '時間をおいて再実行してください。' };
  return { title: `評価APIがエラーを返しました（HTTP ${status}）。`, hint: '下の詳細を確認してください。' };
}

function failureText(failure: EvaluateFailure): { title: string; hint: string } {
  switch (failure.kind) {
    case 'invalid-request':
      return { title: '入力が共通スキーマに一致しないため送信しませんでした。', hint: '入力欄のエラーを確認してください。' };
    case 'unauthenticated':
      return { title: 'ログインが必要です。', hint: 'ログインしてから実行してください。' };
    case 'http-error':
      return httpFailureText(failure.status);
    case 'invalid-response':
      return { title: 'APIの応答が共通スキーマに一致しないため、結果を表示しません。', hint: 'APIの実装と共通契約の差分を確認してください。' };
    case 'network-error':
      return { title: '評価APIに接続できませんでした。', hint: 'ネットワーク、API URL、CORSの設定を確認してください。' };
    case 'timeout':
      return { title: `評価APIが${Math.round(failure.timeoutMs / 1000)}秒以内に応答しませんでした。`, hint: '時間をおいて再実行してください。' };
  }
}

function IssueList({ issues }: { issues: readonly IssueSummary[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues">
      {issues.map(issue => <li key={`${issue.path}:${issue.message}`}>{issue.path ? <code>{issue.path}</code> : null} {issue.message}</li>)}
    </ul>
  );
}

function FailureView({ failure }: { failure: EvaluateFailure }) {
  const text = failureText(failure);
  return (
    <div className="failure" role="alert">
      <p className="failure-title">{text.title}</p>
      <p>{text.hint}</p>
      {failure.kind === 'http-error' ? (
        <>
          <p>コード <code>{failure.code}</code>{failure.message ? `：${failure.message}` : null}</p>
          <IssueList issues={failure.details} />
        </>
      ) : null}
      {failure.kind === 'invalid-request' || failure.kind === 'invalid-response' ? <IssueList issues={failure.issues} /> : null}
      {(failure.kind === 'http-error' || failure.kind === 'invalid-response') && failure.requestId ? <p className="muted">requestId <code>{failure.requestId}</code></p> : null}
    </div>
  );
}

function EvaluationView({ result, requestId, elapsedMs, timeZone }: { result: EvaluationResult; requestId: string; elapsedMs: number; timeZone: string }) {
  return (
    <div className="evaluation">
      <div className={`decision decision-${result.decision}`}>
        {result.decision === 'notify' ? (
          <>
            <p className="decision-label">通知する判断</p>
            <p className="message">{result.message}</p>
            <dl className="facts">
              <div><dt>きっかけ</dt><dd>{triggerLabels[result.triggerType]} <code>{result.triggerType}</code></dd></div>
              <div><dt>緊急度</dt><dd>{urgencyLabels[result.urgency]}</dd></div>
              <div><dt>判断の要約</dt><dd>{result.decisionReason}</dd></div>
            </dl>
          </>
        ) : (
          <>
            <p className="decision-label">今は通知しない判断（silent）</p>
            <dl className="facts">
              <div><dt>判断の要約</dt><dd>{result.decisionReason}</dd></div>
            </dl>
          </>
        )}
      </div>
      {result.decision === 'notify' ? <RecommendationCards items={result.recommendations} timeZone={timeZone} /> : null}
      <div className="diagnostics">
        <UsedSignals used={result.usedSignals} />
        <ProviderStatusPanel statuses={result.providerStatus} />
        <DeliveryDiagnostics delivery={result.delivery} />
      </div>
      <dl className="meta">
        <div><dt>requestId</dt><dd><code>{requestId}</code></dd></div>
        <div><dt>evaluationId</dt><dd><code>{result.evaluationId}</code></dd></div>
        <div><dt>recommendationId</dt><dd>{result.recommendationId ? <code>{result.recommendationId}</code> : 'なし'}</dd></div>
        <div><dt>コンテキストの保持期限</dt><dd>{formatDateTime(result.contextExpiresAt, timeZone)}</dd></div>
        <div><dt>応答時間</dt><dd>{elapsedMs} ms</dd></div>
      </dl>
    </div>
  );
}

/** Shows only API responses that passed the shared contract; it never fabricates a result. */
export function ResultPanel({ state, timeZone, inputsChanged = false }: { state: RunState; timeZone: string; inputsChanged?: boolean }) {
  return (
    <section className="panel result" aria-labelledby="result-heading" aria-live="polite" aria-busy={state.status === 'running'}>
      <h2 id="result-heading">評価結果</h2>
      {state.status !== 'idle' && inputsChanged ? (
        <p className="warning">入力は送信時から変更されています。この欄は送信したコンテキストの評価を表示します。変更後の入力は、次の実行で評価します。</p>
      ) : null}
      {state.status === 'idle' ? (
        <p className="muted">まだ評価していません。「シナリオを実行」を押すと、モバイルと同じ評価APIの結果をここに表示します。</p>
      ) : null}
      {state.status === 'running' ? <p className="loading">評価中… 外部プロバイダとBedrockの応答を待っています。</p> : null}
      {state.status === 'failed' ? <FailureView failure={state.failure} /> : null}
      {state.status === 'succeeded' ? <EvaluationView result={state.result} requestId={state.requestId} elapsedMs={state.elapsedMs} timeZone={timeZone} /> : null}
      {state.status === 'idle' ? null : <DebugContext request={state.request} label={SENT_CONTEXT_LABEL} />}
    </section>
  );
}
