import type { Dispatch } from 'react';
import { UserPreferencesSchema } from '@contextia/contracts';
import { Field, errorProps, fieldId } from './fields.js';
import type { FieldErrors, NotificationFrequency, ScenarioForm, ScenarioFormAction } from './form.js';

const FrequencySchema = UserPreferencesSchema.shape.notificationFrequency;
const frequencyLabels: Readonly<Record<NotificationFrequency, string>> = { low: '少なめ', normal: '標準', high: '多め' };

export function PreferencesEditor({ form, errors, dispatch }: { form: ScenarioForm; errors: FieldErrors; dispatch: Dispatch<ScenarioFormAction> }) {
  return (
    <fieldset className="editor">
      <legend>好み・通知設定</legend>
      <Field fieldKey="interests" label="興味（カンマ区切り）" errors={errors} hint="例: cafe, park（最大20件）">
        <input
          id={fieldId('interests')} type="text" autoComplete="off" value={form.interests}
          onChange={event => dispatch({ type: 'setText', field: 'interests', value: event.target.value })} {...errorProps('interests', errors)}
        />
      </Field>
      <div className="field-row">
        <Field fieldKey="notificationFrequency" label="通知頻度" errors={errors}>
          <select
            id={fieldId('notificationFrequency')} value={form.notificationFrequency}
            onChange={event => {
              const parsed = FrequencySchema.safeParse(event.target.value);
              if (parsed.success) dispatch({ type: 'setNotificationFrequency', value: parsed.data });
            }}
          >
            {FrequencySchema.options.map(value => <option key={value} value={value}>{frequencyLabels[value]}（{value}）</option>)}
          </select>
        </Field>
        <Field fieldKey="locale" label="ロケール" errors={errors}>
          <input
            id={fieldId('locale')} type="text" autoComplete="off" spellCheck={false} value={form.locale}
            onChange={event => dispatch({ type: 'setText', field: 'locale', value: event.target.value })} {...errorProps('locale', errors)}
          />
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={form.notificationsEnabled} onChange={event => dispatch({ type: 'setNotificationsEnabled', value: event.target.checked })} />
        通知を有効にする
      </label>
    </fieldset>
  );
}
