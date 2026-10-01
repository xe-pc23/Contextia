import type { Dispatch } from 'react';
import { Field, errorProps, fieldId } from './fields.js';
import { stepGoalState } from './form.js';
import type { FieldErrors, ScenarioForm, ScenarioFormAction } from './form.js';

const goalStateLabels = { reached: '達成', below: '未達', unknown: '不明（歩数なし）', invalid: '—' } as const;

export function StepsEditor({ form, errors, dispatch }: { form: ScenarioForm; errors: FieldErrors; dispatch: Dispatch<ScenarioFormAction> }) {
  return (
    <fieldset className="editor">
      <legend>歩数</legend>
      <div className="field-row">
        <Field fieldKey="stepsToday" label="今日の歩数" errors={errors} hint="空欄は「不明」として送信します">
          <input
            id={fieldId('stepsToday')} type="text" inputMode="numeric" autoComplete="off" value={form.stepsToday}
            onChange={event => dispatch({ type: 'setText', field: 'stepsToday', value: event.target.value })} {...errorProps('stepsToday', errors)}
          />
        </Field>
        <Field fieldKey="stepGoal" label="目標歩数" errors={errors}>
          <input
            id={fieldId('stepGoal')} type="text" inputMode="numeric" autoComplete="off" value={form.stepGoal}
            onChange={event => dispatch({ type: 'setText', field: 'stepGoal', value: event.target.value })} {...errorProps('stepGoal', errors)}
          />
        </Field>
      </div>
      <p className="hint">目標達成: {goalStateLabels[stepGoalState(form)]}</p>
    </fieldset>
  );
}
