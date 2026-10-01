import type { Dispatch } from 'react';
import { Field, errorProps, fieldId } from './fields.js';
import { scenarioTimeIso } from './form.js';
import type { FieldErrors, ScenarioForm, ScenarioFormAction } from './form.js';

const TIMEZONE_SUGGESTIONS = ['Asia/Tokyo', 'UTC', 'Asia/Seoul', 'Asia/Singapore', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles'];

export function ClockEditor({ form, errors, dispatch }: { form: ScenarioForm; errors: FieldErrors; dispatch: Dispatch<ScenarioFormAction> }) {
  const sentTime = scenarioTimeIso(form);
  return (
    <fieldset className="editor">
      <legend>時刻</legend>
      <div className="field-row">
        <Field fieldKey="scenarioTime" label="シナリオ日時" errors={errors} hint={sentTime ? `送信値: ${sentTime}` : undefined}>
          <input
            id={fieldId('scenarioTime')} type="datetime-local" step={60} value={form.scenarioTime}
            onChange={event => dispatch({ type: 'setText', field: 'scenarioTime', value: event.target.value })} {...errorProps('scenarioTime', errors)}
          />
        </Field>
        <Field fieldKey="timezone" label="タイムゾーン（IANA）" errors={errors} hint="日時・予定・通知上限の日付に使います">
          <input
            id={fieldId('timezone')} type="text" list="timezone-suggestions" autoComplete="off" spellCheck={false} value={form.timezone}
            onChange={event => dispatch({ type: 'setText', field: 'timezone', value: event.target.value })} {...errorProps('timezone', errors)}
          />
          <datalist id="timezone-suggestions">
            {TIMEZONE_SUGGESTIONS.map(zone => <option key={zone} value={zone} />)}
          </datalist>
        </Field>
      </div>
    </fieldset>
  );
}
