import { useMemo, useReducer } from 'react';
import { RunControls } from './execution/RunControls.js';
import type { ScenarioEvaluator } from './execution/scenarioApiClient.js';
import { useScenarioRun } from './execution/useScenarioRun.js';
import { MapPanel } from './map/MapPanel.js';
import { ResultPanel } from './result/ResultPanel.js';
import { CalendarEditor } from './scenario/CalendarEditor.js';
import { ClockEditor } from './scenario/ClockEditor.js';
import { DEFAULT_TIMEZONE, buildScenarioRequest, formFromScenarioInput, scenarioFormReducer } from './scenario/form.js';
import type { FieldErrors } from './scenario/form.js';
import { LocationEditor } from './scenario/LocationEditor.js';
import { PreferencesEditor } from './scenario/PreferencesEditor.js';
import { CONSOLE_PRESETS, DEFAULT_PRESET_ID, createPresetInput } from './scenario/presets.js';
import { StepsEditor } from './scenario/StepsEditor.js';

export type EvaluationAccess =
  | { readonly status: 'unconnected'; readonly pending: readonly string[] }
  | { readonly status: 'ready'; readonly evaluator: ScenarioEvaluator; readonly accountLabel: string | null };

const NO_ERRORS: FieldErrors = {};
const systemNow = () => new Date();

export function App({ access, now = systemNow }: { access: EvaluationAccess; now?: () => Date }) {
  const [form, dispatch] = useReducer(scenarioFormReducer, undefined, () => formFromScenarioInput(createPresetInput(DEFAULT_PRESET_ID, now())));
  const build = useMemo(() => buildScenarioRequest(form), [form]);
  const errors = build.ok ? NO_ERRORS : build.errors;
  const { state, run } = useScenarioRun(access.status === 'ready' ? access.evaluator : null);
  const resultTimeZone = state.status === 'idle' ? DEFAULT_TIMEZONE : state.request.preferencesOverride?.timezone ?? DEFAULT_TIMEZONE;
  const inputsChanged = state.status !== 'idle' && (!build.ok || JSON.stringify(build.request) !== JSON.stringify(state.request));

  return (
    <div className="console">
      <header className="topbar">
        <div className="title">
          <span className="brand">Contextia</span>
          <span className="product">Scenario Console</span>
        </div>
        {access.status === 'ready'
          ? <span className="badge badge-ready">{access.accountLabel ?? 'ログイン中'}</span>
          : <span className="badge">未接続</span>}
      </header>

      {access.status === 'unconnected' ? (
        <section className="banner" aria-labelledby="connection-heading">
          <h2 id="connection-heading">評価APIに未接続です</h2>
          <p>入力の編集と送信内容の確認はできますが、評価は実行できません。結果欄には実際のAPI応答だけを表示し、仮の推薦は表示しません。</p>
          <p>接続待ち: {access.pending.join('、')}</p>
        </section>
      ) : null}

      <div className="workspace">
        <section className="panel" aria-labelledby="location-heading">
          <h2 id="location-heading">地図と位置</h2>
          <MapPanel latitude={form.latitude} longitude={form.longitude} />
          <LocationEditor form={form} errors={errors} dispatch={dispatch} />
        </section>

        <section className="panel" aria-labelledby="inputs-heading">
          <h2 id="inputs-heading">シナリオ入力</h2>
          <div className="presets" role="group" aria-label="プリセット">
            {CONSOLE_PRESETS.map(preset => (
              <button key={preset.id} type="button" className="preset" onClick={() => dispatch({ type: 'loadInput', input: createPresetInput(preset.id, now()) })}>
                <span className="preset-label">プリセット「{preset.label}」を読み込む</span>
                <span className="preset-description">{preset.description}</span>
              </button>
            ))}
            <p className="hint">読み込み時の現在時刻を基準に、予定との時間差を保って入力欄を埋めます。入力は自由に変更できます。結果は「シナリオを実行」で毎回APIに評価を依頼します。</p>
          </div>
          <ClockEditor form={form} errors={errors} dispatch={dispatch} />
          <StepsEditor form={form} errors={errors} dispatch={dispatch} />
          <CalendarEditor events={form.events} errors={errors} dispatch={dispatch} />
          <PreferencesEditor form={form} errors={errors} dispatch={dispatch} />
          <RunControls
            build={build} running={state.status === 'running'} onRun={request => void run(request)}
            blockedReason={access.status === 'ready' ? null : '評価APIとログインが未接続のため実行できません。'}
          />
        </section>
      </div>

      <ResultPanel state={state} timeZone={resultTimeZone} inputsChanged={inputsChanged} />
    </div>
  );
}
