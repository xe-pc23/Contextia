import type { ScenarioContextInput } from '@contextia/contracts';
import { DebugContext } from '../result/DebugContext.js';
import type { BuildResult } from '../scenario/form.js';

function errorCount(build: BuildResult): number {
  return build.ok ? 0 : Object.values(build.errors).reduce((total, messages) => total + (messages?.length ?? 0), 0);
}

export function RunControls({ build, blockedReason, running, onRun }: {
  build: BuildResult; blockedReason: string | null; running: boolean; onRun: (request: ScenarioContextInput) => void;
}) {
  const unmappedErrors = build.ok ? [] : build.errors.form ?? [];
  const reason = blockedReason ?? (build.ok ? null : `入力エラーが${errorCount(build)}件あります。修正すると実行できます。`);
  return (
    <div className="run-controls">
      <p className="delivery-note">
        評価は <code>mode=simulation</code>・<code>deliveryMode=preview</code> に固定しています。通知は送信されず、通知回数にも数えません。
      </p>
      {unmappedErrors.length > 0 ? <ul className="field-errors">{unmappedErrors.map(message => <li key={message}>{message}</li>)}</ul> : null}
      <button
        type="button" className="primary" disabled={reason !== null || running}
        aria-describedby={reason ? 'run-blocked-reason' : undefined}
        onClick={() => {
          if (build.ok) onRun(build.request);
        }}
      >
        {running ? '評価中…' : 'シナリオを実行'}
      </button>
      {reason ? <p className="hint" id="run-blocked-reason">{reason}</p> : null}
      {build.ok ? <DebugContext request={build.request} label="送信するコンテキストを表示（共通スキーマ検証済み）" /> : null}
    </div>
  );
}
