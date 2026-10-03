import type { DeliveryDiagnostics as Delivery } from '@contextia/contracts';
import { guardCodeLabels } from './labels.js';

export function DeliveryDiagnostics({ delivery }: { delivery: Delivery }) {
  return (
    <section className="subpanel" aria-labelledby="delivery-heading">
      <h3 id="delivery-heading">配信の診断</h3>
      <p>
        モード <code>{delivery.mode}</code> / 状態 <code>{delivery.status}</code>
        {delivery.mode === 'preview' ? '：プレビューのため通知は送信されず、通知回数にも数えません。' : null}
      </p>
      <p>実際の配信なら抑止するか: <code>wouldSuppress={String(delivery.wouldSuppress)}</code></p>
      {delivery.wouldSuppress ? (
        <>
          <p className="warning">実際の配信なら、次の理由で通知は抑止されます。</p>
          <ul className="guard-codes">
            {delivery.guardCodes.map(code => <li key={code}>{guardCodeLabels[code]} <code>{code}</code></li>)}
          </ul>
        </>
      ) : <p>実際の配信でも抑止条件には該当しません。</p>}
    </section>
  );
}
