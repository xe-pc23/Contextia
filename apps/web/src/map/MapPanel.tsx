/**
 * Placeholder until the restricted Amazon Location map configuration is
 * connected. Coordinates stay editable through the location editor meanwhile.
 */
export function MapPanel({ latitude, longitude }: { latitude: string; longitude: string }) {
  return (
    <div className="map-placeholder">
      <p className="map-status">地図（MapLibre + Amazon Location）は未接続です。</p>
      <p>地図用APIキーなどの接続設定を待っています。位置は下の緯度・経度とショートカットで指定できます。</p>
      <p className="coords">現在の座標 <strong>{latitude.trim() || '—'}, {longitude.trim() || '—'}</strong></p>
    </div>
  );
}
