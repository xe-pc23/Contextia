import type { Dispatch } from 'react';
import { Field, errorProps, fieldId } from './fields.js';
import type { FieldErrors, ScenarioForm, ScenarioFormAction, TextField } from './form.js';

const SHORTCUTS = [
  { label: '東京駅', latitude: 35.681236, longitude: 139.767125 },
  { label: '大阪駅', latitude: 34.702485, longitude: 135.495951 }
] as const;

type Props = { form: ScenarioForm; errors: FieldErrors; dispatch: Dispatch<ScenarioFormAction> };

function NumberInput({ field, form, errors, dispatch }: Props & { field: TextField }) {
  return (
    <input
      id={fieldId(field)} type="text" inputMode="decimal" autoComplete="off" value={form[field]}
      onChange={event => dispatch({ type: 'setText', field, value: event.target.value })} {...errorProps(field, errors)}
    />
  );
}

export function LocationEditor(props: Props) {
  const { errors, dispatch } = props;
  return (
    <fieldset className="editor">
      <legend>位置</legend>
      <div className="field-row">
        <Field fieldKey="latitude" label="緯度" errors={errors}><NumberInput field="latitude" {...props} /></Field>
        <Field fieldKey="longitude" label="経度" errors={errors}><NumberInput field="longitude" {...props} /></Field>
        <Field fieldKey="accuracyMeters" label="精度（m・任意）" errors={errors}><NumberInput field="accuracyMeters" {...props} /></Field>
      </div>
      <div className="shortcuts" role="group" aria-label="位置のショートカット">
        {SHORTCUTS.map(shortcut => (
          <button key={shortcut.label} type="button" onClick={() => dispatch({ type: 'setLocation', latitude: shortcut.latitude, longitude: shortcut.longitude })}>
            {shortcut.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
