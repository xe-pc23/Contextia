import type { ProviderStatusMap } from '@contextia/contracts';
import { providerLabels, providerOrder, providerStatusLabels } from './labels.js';

const degradedStatuses = new Set(['degraded', 'unavailable', 'timeout', 'error']);

export function ProviderStatusPanel({ statuses }: { statuses: ProviderStatusMap }) {
  const degraded = providerOrder.filter(key => degradedStatuses.has(statuses[key].status));
  return (
    <section className="subpanel" aria-labelledby="provider-status-heading">
      <h3 id="provider-status-heading">プロバイダの状態</h3>
      {degraded.length > 0 ? (
        <p className="warning">
          {degraded.map(key => providerLabels[key]).join('・')} が正常に応答していません。取得できたデータだけで評価しています。
        </p>
      ) : null}
      <ul className="providers">
        {providerOrder.map(key => {
          const status = statuses[key];
          return (
            <li key={key} className={`provider status-${status.status}`}>
              <span className="provider-name">{providerLabels[key]}</span>
              <span className="provider-state">{providerStatusLabels[status.status]}</span>
              {status.latencyMs === undefined ? null : <span className="latency">{Math.round(status.latencyMs)} ms</span>}
              {status.code ? <code>{status.code}</code> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
