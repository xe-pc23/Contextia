import type { ApiRecommendationItem } from '@contextia/contracts';
import { formatClock, formatDistance } from './format.js';
import { routeModeLabels } from './labels.js';

const actionLabels = { MAP: '地図で開く', WEBSITE: 'Webサイトを開く', TRANSIT: '経路を開く', NONE: '操作なし' } as const;

function ActionLink({ action }: { action: ApiRecommendationItem['action'] }) {
  if (action.type === 'NONE') return null;
  // URLs passed the shared contract (HTTP(S) only) before reaching this component.
  if (action.url) return <a className="action" href={action.url} target="_blank" rel="noopener noreferrer">{actionLabels[action.type]}</a>;
  return <p className="muted">操作: {actionLabels[action.type]}（リンクなし）</p>;
}

function RouteSummary({ route, timeZone }: { route: NonNullable<ApiRecommendationItem['route']>; timeZone: string }) {
  const times = route.departAt && route.arriveAt ? `${formatClock(route.departAt, timeZone)} 発 → ${formatClock(route.arriveAt, timeZone)} 着` : null;
  return (
    <p className="route">
      経路: {routeModeLabels[route.mode]} {Math.round(route.durationMinutes)}分
      {times ? `（${times}）` : null}
      {route.transfers === undefined ? null : ` 乗換${route.transfers}回`}
    </p>
  );
}

/** Renders the validated recommendations; the contract caps them at three. */
export function RecommendationCards({ items, timeZone }: { items: readonly ApiRecommendationItem[]; timeZone: string }) {
  return (
    <ol className="cards" aria-label="おすすめ">
      {items.map(item => (
        <li key={item.id}>
          <article className="recommendation-card">
            <h3>{item.title}</h3>
            <p>{item.reason}</p>
            {item.place ? (
              <p className="place">
                場所: {item.place.name}
                {item.place.distanceMeters === undefined ? null : `（${formatDistance(item.place.distanceMeters)}）`}
              </p>
            ) : null}
            {item.route ? <RouteSummary route={item.route} timeZone={timeZone} /> : null}
            <ActionLink action={item.action} />
          </article>
        </li>
      ))}
    </ol>
  );
}
