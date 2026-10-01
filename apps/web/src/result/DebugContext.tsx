import type { ScenarioContextInput } from '@contextia/contracts';

/** Shows the exact validated context that was (or will be) sent to the API. */
export function DebugContext({ request, label }: { request: ScenarioContextInput; label: string }) {
  return (
    <details className="debug">
      <summary>{label}</summary>
      <pre>{JSON.stringify(request, null, 2)}</pre>
    </details>
  );
}
