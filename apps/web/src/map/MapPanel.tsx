import { useEffect, useRef, useState } from 'react';
import type { Map as LocationMap, Marker } from 'maplibre-gl';
import type { GeoPoint } from '@contextia/contracts';
import type { WebConfig } from '../runtimeConfig.js';
import { mapStyleUrl, parseMapPoint } from './mapConfig.js';

export function MapPanel({ latitude, longitude, config, onSelect }: {
  latitude: string; longitude: string; config?: WebConfig['map']; onSelect?: (point: GeoPoint) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LocationMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const current = useRef({ latitude, longitude, onSelect });
  current.current = { latitude, longitude, onSelect };
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!config || !container.current) return;
    let disposed = false;
    const element = container.current;
    setStatus('loading');
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url')]).then(([library, worker]) => {
      if (disposed) return;
      library.setWorkerUrl(worker.default);
      const point = parseMapPoint(current.current.latitude, current.current.longitude) ?? { latitude: 35.681236, longitude: 139.767125 };
      const instance = new library.Map({ container: element, style: mapStyleUrl(config), center: [point.longitude, point.latitude], zoom: 14 });
      map.current = instance;
      marker.current = new library.Marker({ color: '#287369' }).setLngLat([point.longitude, point.latitude]).addTo(instance);
      instance.addControl(new library.NavigationControl(), 'top-right');
      instance.on('load', () => { if (!disposed) setStatus('ready'); });
      instance.on('error', () => { if (!disposed) setStatus('error'); });
      instance.on('click', event => {
        const selected = parseMapPoint(event.lngLat.lat, event.lngLat.lng);
        if (selected) current.current.onSelect?.(selected);
      });
    }).catch(() => { if (!disposed) setStatus('error'); });
    return () => { disposed = true; marker.current?.remove(); marker.current = null; map.current?.remove(); map.current = null; };
  }, [config]);
  useEffect(() => {
    const point = parseMapPoint(latitude, longitude);
    if (point) { marker.current?.setLngLat([point.longitude, point.latitude]); map.current?.jumpTo({ center: [point.longitude, point.latitude] }); }
  }, [latitude, longitude]);
  if (config) return <div className="map-panel">
    <div className="live-map" ref={container} aria-label="位置を選択する地図" />
    <p className="hint" role="status">{status === 'loading' ? '地図を読み込み中…' : status === 'error' ? '地図を読み込めません。下の緯度・経度で位置を指定できます。' : '地図をクリックして位置を選択できます。'}</p>
    <p className="coords">現在の座標 <strong>{latitude.trim() || '—'}, {longitude.trim() || '—'}</strong></p>
  </div>;
  return (
    <div className="map-placeholder">
      <p className="map-status">地図（MapLibre + Amazon Location）は未接続です。</p>
      <p>地図用APIキーなどの接続設定を待っています。位置は下の緯度・経度とショートカットで指定できます。</p>
      <p className="coords">現在の座標 <strong>{latitude.trim() || '—'}, {longitude.trim() || '—'}</strong></p>
    </div>
  );
}
