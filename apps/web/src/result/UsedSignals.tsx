import { SignalNameSchema } from '@contextia/contracts';
import type { SignalName } from '@contextia/contracts';
import { signalLabels } from './labels.js';

export function UsedSignals({ used }: { used: readonly SignalName[] }) {
  const usedSet = new Set(used);
  return (
    <section className="subpanel" aria-labelledby="used-signals-heading">
      <h3 id="used-signals-heading">使ったシグナル</h3>
      <ul className="signals">
        {SignalNameSchema.options.map(signal => {
          const isUsed = usedSet.has(signal);
          return (
            <li key={signal} className={isUsed ? 'signal used' : 'signal'}>
              <span aria-hidden="true">{isUsed ? '✓' : '○'}</span> {signalLabels[signal]}
              <span className="visually-hidden">{isUsed ? '（使用）' : '（未使用）'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
