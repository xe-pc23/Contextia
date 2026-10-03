import type { ReactNode } from 'react';
import type { FieldErrors, FieldKey } from './form.js';

export function fieldId(key: FieldKey): string {
  return `field-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/** ARIA attributes linking an input to its validation messages. */
export function errorProps(key: FieldKey, errors: FieldErrors): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return (errors[key]?.length ?? 0) > 0 ? { 'aria-invalid': true, 'aria-describedby': `${fieldId(key)}-error` } : {};
}

export function FieldErrorList({ fieldKey, errors }: { fieldKey: FieldKey; errors: FieldErrors }) {
  const messages = errors[fieldKey];
  if (!messages || messages.length === 0) return null;
  return <ul className="field-errors" id={`${fieldId(fieldKey)}-error`}>{messages.map(message => <li key={message}>{message}</li>)}</ul>;
}

export function Field({ fieldKey, label, errors, hint, children }: { fieldKey: FieldKey; label: string; errors: FieldErrors; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={fieldId(fieldKey)}>{label}</label>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
      <FieldErrorList fieldKey={fieldKey} errors={errors} />
    </div>
  );
}
