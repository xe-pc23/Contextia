import type { Dispatch } from 'react';
import { Field, FieldErrorList, errorProps, fieldId } from './fields.js';
import { MAX_CALENDAR_EVENTS } from './form.js';
import type { CalendarEventForm, EventPatch, FieldErrors, ScenarioFormAction } from './form.js';

type EventField = 'title' | 'startAt' | 'endAt' | 'location';

function EventRow({ event, index, errors, dispatch }: { event: CalendarEventForm; index: number; errors: FieldErrors; dispatch: Dispatch<ScenarioFormAction> }) {
  const update = (patch: EventPatch) => dispatch({ type: 'updateEvent', id: event.id, patch });
  const key = (field: EventField) => `event.${event.id}.${field}` as const;
  return (
    <li className="event-row" aria-label={`予定 ${index + 1}`}>
      <div className="field-row">
        <Field fieldKey={key('title')} label="タイトル" errors={errors}>
          <input id={fieldId(key('title'))} type="text" value={event.title} onChange={change => update({ title: change.target.value })} {...errorProps(key('title'), errors)} />
        </Field>
        <Field fieldKey={key('location')} label="場所（任意）" errors={errors}>
          <input id={fieldId(key('location'))} type="text" value={event.location} onChange={change => update({ location: change.target.value })} {...errorProps(key('location'), errors)} />
        </Field>
      </div>
      <div className="field-row">
        <Field fieldKey={key('startAt')} label="開始" errors={errors}>
          <input id={fieldId(key('startAt'))} type="datetime-local" step={60} value={event.startAt} onChange={change => update({ startAt: change.target.value })} {...errorProps(key('startAt'), errors)} />
        </Field>
        <Field fieldKey={key('endAt')} label="終了" errors={errors}>
          <input id={fieldId(key('endAt'))} type="datetime-local" step={60} value={event.endAt} onChange={change => update({ endAt: change.target.value })} {...errorProps(key('endAt'), errors)} />
        </Field>
      </div>
      <div className="event-actions">
        <label className="checkbox">
          <input type="checkbox" checked={event.allDay} onChange={change => update({ allDay: change.target.checked })} /> 終日
        </label>
        <button type="button" className="link-button" onClick={() => dispatch({ type: 'removeEvent', id: event.id })}>この予定を削除</button>
      </div>
    </li>
  );
}

export function CalendarEditor({ events, errors, dispatch }: { events: readonly CalendarEventForm[]; errors: FieldErrors; dispatch: Dispatch<ScenarioFormAction> }) {
  return (
    <fieldset className="editor">
      <legend>予定（{events.length}件）</legend>
      {events.length === 0 ? <p className="muted">予定はありません。</p> : (
        <ol className="event-list">
          {events.map((event, index) => <EventRow key={event.id} event={event} index={index} errors={errors} dispatch={dispatch} />)}
        </ol>
      )}
      <FieldErrorList fieldKey="calendar" errors={errors} />
      <button type="button" onClick={() => dispatch({ type: 'addEvent' })} disabled={events.length >= MAX_CALENDAR_EVENTS}>予定を追加</button>
      <p className="hint">送信するのはタイトル・開始・終了・場所・終日だけです（参加者やメモは扱いません）。</p>
    </fieldset>
  );
}
